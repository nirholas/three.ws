// Bucket objects a deleted forge creation still owes. Table:
// api/_lib/migrations/20261120130000_forge_storage_purges.sql.
//
// forgeStore.deleteCreation removes a creation's objects before its row. When
// object storage is down (a rejected credential, an unreachable endpoint), the
// row still comes down and every object it could not remove is queued here:
//
//   queueStoragePurges   called by deleteCreation; must succeed before the row
//                        is deleted, so no object is ever left without a handle.
//   isPurgePending       /cdn/ asks before serving a forge key, so a removed
//                        model is not served from three.ws while its bytes wait.
//   drainStoragePurges   /api/cron/forge-storage-purge retries the queue.
//
// A 'prefix' entry stands for a listing that failed as well (the creation's own
// prefix, or a preview's resized variants); the drain lists and deletes it whole.

import { sql } from './db.js';
import { deleteObject, listObjectsPage, isStorageInfrastructureError } from './r2.js';

const BLOCK_CACHE_MS = 60_000;
const BLOCK_CACHE_MAX = 20_000;
const BLOCK_REFRESH_WAIT_MS = 1500;

// Only the forge namespace and the /cdn/ resized variants of its images: a
// corrupted entry can never purge anything else in the bucket.
function purgeable(target) {
	return typeof target === 'string' && !target.includes('..') && (target.startsWith('forge/') || target.startsWith('variants/'));
}

/**
 * Queue objects and prefixes for a later purge.
 * @param {{ creationId?: string|null, entries: Array<{ target: string, kind: 'object'|'prefix' }> }} args
 */
export async function queueStoragePurges({ creationId = null, entries }) {
	const list = (entries || []).filter((e) => purgeable(e?.target));
	if (!list.length) return 0;
	const targets = list.map((e) => e.target);
	const kinds = list.map((e) => (e.kind === 'prefix' ? 'prefix' : 'object'));
	await sql`
		insert into forge_storage_purges (target, kind, creation_id)
		select t, k, ${creationId}::uuid from unnest(${targets}::text[], ${kinds}::text[]) as q(t, k)
		on conflict (target) do update
			set kind = excluded.kind, creation_id = coalesce(excluded.creation_id, forge_storage_purges.creation_id),
				purged_at = null
	`;
	blockCache.at = 0;
	return list.length;
}

const blockCache = { at: 0, objects: new Set(), prefixes: [], loading: null };

async function refreshBlockCache() {
	try {
		const rows = await sql`
			select target, kind from forge_storage_purges
			where purged_at is null
			order by created_at desc
			limit ${BLOCK_CACHE_MAX}
		`;
		blockCache.objects = new Set(rows.filter((r) => r.kind === 'object').map((r) => r.target));
		blockCache.prefixes = rows.filter((r) => r.kind === 'prefix').map((r) => r.target);
	} catch (err) {
		// Serving must never depend on this table: keep the last good set.
		console.warn('[forge-storage-purges] block list refresh failed:', err?.message);
	}
	blockCache.at = Date.now();
}

/**
 * True when `key` belongs to a deleted creation whose bytes are still queued
 * for removal. Cached for a minute per process; never throws.
 */
export async function isPurgePending(key) {
	if (!purgeable(key)) return false;
	if (Date.now() - blockCache.at > BLOCK_CACHE_MS) {
		blockCache.loading ||= refreshBlockCache().finally(() => {
			blockCache.loading = null;
		});
		// A slow database must not stall /cdn/: past the cap, answer from the
		// last good set and let the refresh land for the next request.
		let timer;
		await Promise.race([
			blockCache.loading,
			new Promise((resolve) => {
				timer = setTimeout(resolve, BLOCK_REFRESH_WAIT_MS);
				timer.unref?.();
			}),
		]);
		clearTimeout(timer);
	}
	if (blockCache.objects.has(key)) return true;
	return blockCache.prefixes.some((p) => key.startsWith(p));
}

async function prefixKeys(prefix) {
	const keys = [];
	let token;
	for (let page = 0; page < 10; page++) {
		const out = await listObjectsPage({ prefix, continuationToken: token, maxKeys: 1000 });
		for (const o of out?.objects || []) if (o?.key) keys.push(o.key);
		token = out?.nextToken;
		if (!token) break;
	}
	return keys;
}

/**
 * Retry pending purges, oldest first. Stops at the first storage
 * infrastructure fault: storage is still down and every later entry would fail
 * the same way. Resolves { attempted, purged, pending, storageDown }.
 */
export async function drainStoragePurges({ limit = 200 } = {}) {
	const rows = await sql`
		select target, kind from forge_storage_purges
		where purged_at is null
		order by created_at asc
		limit ${Math.min(Math.max(Number(limit) || 200, 1), 1000)}
	`;
	let purged = 0;
	let attempted = 0;
	let storageDown = false;
	for (const row of rows) {
		attempted++;
		try {
			const keys = row.kind === 'prefix' ? await prefixKeys(row.target) : [row.target];
			for (const k of keys) await deleteObject(k);
			await sql`update forge_storage_purges set purged_at = now(), attempts = attempts + 1, last_attempt_at = now(), last_error = null where target = ${row.target}`;
			purged++;
		} catch (err) {
			await sql`
				update forge_storage_purges
				set attempts = attempts + 1, last_attempt_at = now(), last_error = ${String(err?.message || err).slice(0, 500)}
				where target = ${row.target}
			`;
			if (isStorageInfrastructureError(err)) {
				storageDown = true;
				break;
			}
		}
	}
	if (purged) blockCache.at = 0;
	const [{ n }] = await sql`select count(*)::int as n from forge_storage_purges where purged_at is null`;
	return { attempted, purged, pending: n, storageDown };
}

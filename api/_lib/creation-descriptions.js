// Florence-2 descriptions for 3D creations (work order 819).
//
// Every finished creation gets a caption, a detailed caption, tags and object
// boxes from its poster image, produced by the model-florence2 worker
// (workers/model-florence2). The results live in forge_creation_descriptions,
// one row per creation, stamped with the model and the exact weights revision
// that produced them.
//
// Flow:
//   materializeCreation  -> enqueueCreationDescription (fire-and-forget; a
//                           describe never blocks or fails a creation)
//   cron / backfill      -> claimDescribeBatch -> describeViaWorker
//                           -> storeDescription | markDescribeFailed
//   GPU batch job import -> storeDescription for each result
//   owner edit           -> setOwnerTags (a later re-describe keeps the edit)
//
// Claiming is a lease: a claimed row has attempts incremented and updated_at
// stamped, and is only re-claimable after LEASE_MINUTES, so two overlapping
// ticks never describe the same row. After MAX_ATTEMPTS a row is 'failed'.
//
// Backfill is folded into the claim: when the queue holds fewer rows than the
// batch wants, the newest finished creations that have no row yet are inserted
// already leased. So the cron, the bulk script and the batch-job export all
// walk the backlog newest-first through one ledger.

import { sql } from './db.js';
import { normalizeStoredUrl } from './r2.js';
import { normalizeTags } from './creation-tags.js';
import { containsHateSlur } from './display-name-safety.js';
import { renderPosterUrl, renderableGlb } from './creation-jsonld.js';

export const MAX_ATTEMPTS = 3;
export const LEASE_MINUTES = 10;
const ORIGIN = 'https://three.ws';
const MAX_CAPTION = 200;
const MAX_DETAILED = 1000;
const MAX_OBJECTS = 24;

/** The describe worker's base URL, or '' when it is not wired. */
export function describeWorkerUrl() {
	return String(process.env.MODEL_FLORENCE2_URL || '')
		.trim()
		.replace(/\/+$/, '');
}

/** The bearer the GPU workers share (avatar-reconstruction-key). */
export function describeWorkerKey() {
	return String(process.env.GCP_RECONSTRUCTION_KEY || '').trim();
}

/**
 * The image to describe for one creation row: its stored poster, else a
 * server render of the GLB (the same renderer the og:image uses), else null.
 */
export function posterUrlFor(row, origin = ORIGIN) {
	const preview = normalizeStoredUrl(row?.preview_image_url);
	if (preview) return preview;
	const glb = renderableGlb([
		{ url: normalizeStoredUrl(row?.web_glb_url), sizeBytes: row?.web_size_bytes },
		{ url: normalizeStoredUrl(row?.glb_url), sizeBytes: row?.size_bytes },
	]);
	return glb ? renderPosterUrl(origin, glb) : null;
}

function cleanText(value, max) {
	if (typeof value !== 'string') return null;
	const t = value.replace(/\s+/g, ' ').trim();
	if (!t || containsHateSlur(t)) return null;
	return t.length > max ? t.slice(0, max) : t;
}

function cleanObjects(objects) {
	if (!Array.isArray(objects)) return [];
	const out = [];
	for (const o of objects) {
		const label = cleanText(o?.label, 48);
		const box = Array.isArray(o?.box) ? o.box.map(Number) : [];
		if (!label || box.length !== 4 || box.some((v) => !Number.isFinite(v) || v < 0 || v > 1)) continue;
		out.push({ label: label.toLowerCase(), box });
		if (out.length >= MAX_OBJECTS) break;
	}
	return out;
}

/**
 * Validate a worker result before it touches the database. The worker is ours,
 * but its output is model text: lengths are capped, tags re-normalized through
 * the shared rules and blocklist, and a caption carrying a slur is dropped.
 */
export function sanitizeDescribeResult(result) {
	const r = result && typeof result === 'object' ? result : {};
	const latency = Number(r.latency_ms);
	return {
		caption: cleanText(r.caption, MAX_CAPTION),
		detailed: cleanText(r.detailed, MAX_DETAILED),
		tags: normalizeTags(r.tags),
		objects: cleanObjects(r.objects),
		model: cleanText(r.model, 200),
		modelVersion: cleanText(r.model_version, 100),
		latencyMs: Number.isFinite(latency) && latency >= 0 ? Math.round(latency) : null,
	};
}

/** Queue a creation for describing. Idempotent; never throws. */
export async function enqueueCreationDescription(creationId) {
	if (!creationId) return false;
	try {
		await sql`
			insert into forge_creation_descriptions (creation_id)
			values (${creationId})
			on conflict (creation_id) do nothing
		`;
		return true;
	} catch (err) {
		console.error('[creation-descriptions] enqueue failed:', err?.message);
		return false;
	}
}

/**
 * Lease up to `limit` creations to describe: expired-or-fresh queued rows
 * first, then (when `backfill`) the newest finished creations with no row.
 * Returns [{ id, imageUrl }] plus the ids that have no image at all, which are
 * marked 'skipped' here so they are never claimed again.
 */
export async function claimDescribeBatch({ limit = 8, backfill = true, origin = ORIGIN } = {}) {
	const want = Math.min(Math.max(Number(limit) || 8, 1), 1000);
	const claimed = await sql`
		update forge_creation_descriptions
		set attempts = attempts + 1, updated_at = now()
		where creation_id in (
			select creation_id from forge_creation_descriptions
			where status = 'queued' and attempts < ${MAX_ATTEMPTS}
				and (attempts = 0 or updated_at < now() - make_interval(mins => ${LEASE_MINUTES}))
			order by created_at desc
			limit ${want}
			for update skip locked
		)
		returning creation_id
	`;
	let ids = claimed.map((r) => r.creation_id);
	if (backfill && ids.length < want) {
		const fresh = await sql`
			insert into forge_creation_descriptions (creation_id, attempts, updated_at)
			select fc.id, 1, now()
			from forge_creations fc
			where fc.status = 'done' and fc.glb_url is not null
				and not exists (select 1 from forge_creation_descriptions d where d.creation_id = fc.id)
			order by fc.created_at desc
			limit ${want - ids.length}
			on conflict (creation_id) do nothing
			returning creation_id
		`;
		ids = ids.concat(fresh.map((r) => r.creation_id));
	}
	if (!ids.length) return { items: [], skipped: [] };

	const rows = await sql`
		select id, preview_image_url, glb_url, web_glb_url, size_bytes, web_size_bytes, created_at
		from forge_creations where id = any(${ids}::uuid[])
		order by created_at desc
	`;
	const items = [];
	const skipped = [];
	for (const row of rows) {
		const imageUrl = posterUrlFor(row, origin);
		if (imageUrl) items.push({ id: row.id, imageUrl });
		else skipped.push(row.id);
	}
	if (skipped.length) {
		await sql`
			update forge_creation_descriptions
			set status = 'skipped', error = 'no poster and no renderable GLB', updated_at = now()
			where creation_id = any(${skipped}::uuid[])
		`;
	}
	return { items, skipped };
}

/**
 * Store one describe result. Upserts, so the batch-job import works whether or
 * not the row was claimed first. Owner-edited tags are never overwritten;
 * generated_tags always holds what the model produced.
 */
export async function storeDescription({ creationId, result, sourceImageUrl = null }) {
	const r = sanitizeDescribeResult(result);
	if (!r.caption && !r.detailed && !r.tags.length) {
		await markDescribeFailed({ creationId, error: 'empty describe result' });
		return false;
	}
	const rows = await sql`
		insert into forge_creation_descriptions (
			creation_id, status, caption, detailed, tags, generated_tags, objects,
			model, model_version, latency_ms, source_image_url, described_at, updated_at
		) values (
			${creationId}, 'done', ${r.caption}, ${r.detailed}, ${r.tags}, ${r.tags}, ${JSON.stringify(r.objects)}::jsonb,
			${r.model}, ${r.modelVersion}, ${r.latencyMs}, ${sourceImageUrl}, now(), now()
		)
		on conflict (creation_id) do update set
			status = 'done',
			caption = excluded.caption,
			detailed = excluded.detailed,
			generated_tags = excluded.generated_tags,
			tags = case when forge_creation_descriptions.tags_edited_at is null
				then excluded.tags else forge_creation_descriptions.tags end,
			objects = excluded.objects,
			model = excluded.model,
			model_version = excluded.model_version,
			latency_ms = excluded.latency_ms,
			source_image_url = excluded.source_image_url,
			error = null,
			described_at = now(),
			updated_at = now()
		returning creation_id
	`;
	return rows.length > 0;
}

/** Record a failed attempt; the row goes back to the queue until MAX_ATTEMPTS. */
export async function markDescribeFailed({ creationId, error }) {
	const message = String(error || 'describe failed').slice(0, 500);
	await sql`
		insert into forge_creation_descriptions (creation_id, status, error, attempts, updated_at)
		values (${creationId}, 'queued', ${message}, 1, now())
		on conflict (creation_id) do update set
			status = case when forge_creation_descriptions.attempts >= ${MAX_ATTEMPTS} then 'failed' else 'queued' end,
			error = excluded.error,
			updated_at = now()
	`;
}

/** POST one image to the describe worker. Throws with the worker's reason. */
export async function describeViaWorker({ imageUrl, url = describeWorkerUrl(), key = describeWorkerKey(), timeoutMs = 90_000 }) {
	if (!url) throw new Error('MODEL_FLORENCE2_URL is not set');
	if (!key) throw new Error('GCP_RECONSTRUCTION_KEY is not set');
	const res = await fetch(`${url}/describe`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
		body: JSON.stringify({ image_url: imageUrl }),
		signal: AbortSignal.timeout(timeoutMs),
	});
	const text = await res.text();
	let body = null;
	try {
		body = JSON.parse(text);
	} catch {
		body = null;
	}
	if (!res.ok) {
		const detail = body?.detail || text.slice(0, 200) || res.statusText;
		const err = new Error(`describe worker ${res.status}: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
		err.status = res.status;
		throw err;
	}
	if (!body || typeof body !== 'object') throw new Error('describe worker returned a non-JSON body');
	return body;
}

/**
 * Claim, describe and store one batch. `deadlineMs` stops claiming new work
 * when a cron tick is near its budget; already-claimed rows simply expire back
 * to the queue.
 */
export async function runDescribeBatch({ limit = 8, concurrency = 2, backfill = true, url, key, deadlineMs = 0, onResult } = {}) {
	const { items, skipped } = await claimDescribeBatch({ limit, backfill });
	const out = { claimed: items.length + skipped.length, described: 0, failed: 0, skipped: skipped.length, latencies: [] };
	const queue = items.slice();
	const started = Date.now();
	async function lane() {
		while (queue.length) {
			if (deadlineMs && Date.now() - started > deadlineMs) return;
			const item = queue.shift();
			try {
				const result = await describeViaWorker({ imageUrl: item.imageUrl, url, key });
				const stored = await storeDescription({ creationId: item.id, result, sourceImageUrl: item.imageUrl });
				if (stored) {
					out.described += 1;
					if (Number.isFinite(result?.latency_ms)) out.latencies.push(result.latency_ms);
				} else out.failed += 1;
				onResult?.({ id: item.id, ok: stored, result });
			} catch (err) {
				out.failed += 1;
				await markDescribeFailed({ creationId: item.id, error: err?.message });
				onResult?.({ id: item.id, ok: false, error: err?.message });
			}
		}
	}
	await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, 8)) }, lane));
	return out;
}

/**
 * Owner tag edit. Tags are normalized through the same rules as generated
 * ones; an empty list removes every tag. Marks the row edited so a later
 * re-describe never overwrites the owner's choice. Creates the row when the
 * creation was never described.
 */
export async function setOwnerTags({ creationId, tags }) {
	const clean = normalizeTags(tags);
	const rows = await sql`
		insert into forge_creation_descriptions (creation_id, tags, tags_edited_at, updated_at)
		values (${creationId}, ${clean}, now(), now())
		on conflict (creation_id) do update set
			tags = excluded.tags, tags_edited_at = now(), updated_at = now()
		returning tags, generated_tags
	`;
	return { tags: rows[0]?.tags ?? clean, generatedTags: rows[0]?.generated_tags ?? [] };
}

/**
 * Re-apply the current tag rules (creation-tags.js) to every stored
 * description, so a rule change reaches existing rows without spending GPU
 * time on a re-describe. generated_tags is re-normalized; tags follows it
 * unless the owner edited them (an owner's list is theirs). Walks the table
 * in creation_id order, `pageSize` rows at a time. Returns counts.
 */
export async function renormalizeStoredTags({ pageSize = 500, dryRun = false } = {}) {
	let after = '00000000-0000-0000-0000-000000000000';
	let scanned = 0;
	let changed = 0;
	for (;;) {
		const rows = await sql`
			select creation_id, generated_tags, tags, tags_edited_at
			from forge_creation_descriptions
			where status = 'done' and creation_id > ${after}::uuid
			order by creation_id
			limit ${pageSize}
		`;
		if (!rows.length) break;
		for (const r of rows) {
			scanned += 1;
			const generated = normalizeTags(r.generated_tags || []);
			const same = (a, b) => a.length === b.length && a.every((t, i) => t === b[i]);
			const tagsFollow = !r.tags_edited_at;
			if (same(generated, r.generated_tags || []) && (!tagsFollow || same(generated, r.tags || []))) continue;
			changed += 1;
			if (dryRun) continue;
			await sql`
				update forge_creation_descriptions set
					generated_tags = ${generated},
					tags = case when tags_edited_at is null then ${generated}::text[] else tags end,
					updated_at = now()
				where creation_id = ${r.creation_id}
			`;
		}
		after = rows[rows.length - 1].creation_id;
	}
	return { scanned, changed };
}

/** Coverage numbers for the cron's dry run and the backfill script's progress. */
export async function describeStats() {
	const [row] = await sql`
		select
			(select count(*)::int from forge_creations where status = 'done' and glb_url is not null) as creations,
			count(*) filter (where d.status = 'done')::int as done,
			count(*) filter (where d.status = 'queued')::int as queued,
			count(*) filter (where d.status = 'failed')::int as failed,
			count(*) filter (where d.status = 'skipped')::int as skipped,
			count(*) filter (where d.tags_edited_at is not null)::int as owner_edited,
			percentile_disc(0.5) within group (order by d.latency_ms) filter (where d.status = 'done') as latency_ms_p50
		from forge_creation_descriptions d
	`;
	const creations = row?.creations ?? 0;
	const described = row?.done ?? 0;
	return {
		creations,
		described,
		queued: row?.queued ?? 0,
		failed: row?.failed ?? 0,
		skipped: row?.skipped ?? 0,
		ownerEdited: row?.owner_edited ?? 0,
		remaining: Math.max(0, creations - described - (row?.failed ?? 0) - (row?.skipped ?? 0)),
		latencyMsP50: row?.latency_ms_p50 ?? null,
	};
}

/** The public `described` block for a creation, from joined columns. */
export function describedBlock(r) {
	if (!r || (r.d_status !== 'done' && !r.d_tags_edited_at)) return null;
	return {
		caption: r.d_caption || null,
		detailed: r.d_detailed || null,
		tags: Array.isArray(r.d_tags) ? r.d_tags : [],
		generatedTags: Array.isArray(r.d_generated_tags) ? r.d_generated_tags : [],
		model: r.d_model || null,
		modelVersion: r.d_model_version || null,
		describedAt: r.d_described_at ? new Date(r.d_described_at).toISOString() : null,
		tagsEdited: Boolean(r.d_tags_edited_at),
	};
}

/**
 * IndexNow outbox: enqueue, drain, reconcile.
 * -------------------------------------------
 * Bing (and through it Copilot answers), Yandex, Seznam and Naver index a URL
 * minutes after it is announced over IndexNow, instead of at the next crawl.
 * This module is the one path every announcement takes.
 *
 *   enqueueIndexNow  Write paths call it on create, update and delete of a
 *                    public resource. It upserts the canonical URL into
 *                    indexnow_urls and never throws, so a database hiccup can
 *                    never fail the user's request.
 *   drainIndexNow    Posts pending URLs to api.indexnow.org in batches of up
 *                    to 10,000, logs each request to indexnow_submissions, and
 *                    stamps the URLs it got through.
 *   reconcileIndexNow  Scans every public table for rows changed since its
 *                    cursor and enqueues anything a write path missed (a
 *                    backfill, a direct SQL fix, a path without a hook).
 *
 * Dedupe: one row per URL. Ten edits in a minute are one pending row.
 * Rate limits, all three enforced here:
 *   - a URL submitted in the last 24 hours is held until the floor passes,
 *     unless the change is a delete (the page now 404s or says noindex, and
 *     the engine should drop it now);
 *   - after an HTTP 429 the drain pauses for an hour;
 *   - a URL that fails five requests in a row is parked until it changes.
 * Privacy: a URL is only ever announced while its resource is public. When a
 * resource goes private or unlisted, its URL is announced again (so the engine
 * re-crawls and drops it) only if this pipeline announced it before; a URL
 * that was never public is never sent anywhere.
 *
 * Schema: api/_lib/migrations/20261111163200_indexnow.sql.
 * Runbook: docs/ops/bing-and-indexnow.md.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sql } from './db.js';
import { pingIndexNow, INDEXNOW_ORIGIN, INDEXNOW_BATCH_MAX } from './indexnow.js';
import { resourceUrl, RESOURCE_TYPES, isIndexableCreation, isIndexableManifestPage } from './seo-resources.js';
import { isIndexableAgent, isIndexableAvatar } from './indexable-entity.js';

/** A URL submitted within this window is not re-announced for an update. */
export const RESUBMIT_FLOOR_HOURS = 24;
/** After a 429 the drain sits out this long. */
export const RATE_LIMIT_COOLDOWN_MINUTES = 60;
/** A URL that failed this many requests in a row waits for its next change. */
export const MAX_ATTEMPTS = 5;
/** Rows read per reconcile query, and queries per type per run. */
export const RECONCILE_PAGE = 5_000;
export const RECONCILE_MAX_PAGES = 10;
/** The first reconcile of a type looks back this far. */
export const DEFAULT_LOOKBACK_HOURS = 24;

const REASONS = new Set(['create', 'update', 'delete']);
const TYPES = new Set(RESOURCE_TYPES);
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

function toDate(v, fallback) {
	if (v instanceof Date && !Number.isNaN(v.getTime())) return v;
	if (v) {
		const d = new Date(v);
		if (!Number.isNaN(d.getTime())) return d;
	}
	return fallback;
}

/**
 * Turn enqueue items into upsert rows: canonical URL, validated type and
 * reason, the time the resource changed. Invalid items are dropped and a URL
 * that appears twice keeps its last entry, which is the newest state.
 *
 * @param {Array<{type:string,key:string,reason?:string,changedAt?:Date|string}>} items
 * @param {Date} now
 */
export function normalizeItems(items, now = new Date()) {
	const byUrl = new Map();
	for (const it of Array.isArray(items) ? items : [items]) {
		if (!it || !TYPES.has(it.type)) continue;
		const reason = REASONS.has(it.reason) ? it.reason : 'update';
		const url = resourceUrl(INDEXNOW_ORIGIN, it.type, it.key);
		if (!url) continue;
		byUrl.delete(url);
		byUrl.set(url, { url, type: it.type, reason, changedAt: toDate(it.changedAt, now) });
	}
	return [...byUrl.values()];
}

/**
 * Upsert URLs into the outbox. A URL already submitted after the resource's
 * change time is left alone, so re-reading an unchanged row is a no-op.
 *
 * With `onlyAnnounced`, only URLs this pipeline has submitted before are
 * touched: the path for a resource that went private or unlisted.
 *
 * Never throws. Returns the number of rows written (0 on any failure).
 *
 * @param {Array<{type:string,key:string,reason?:string,changedAt?:Date|string}>|object} items
 * @param {{source?:string, onlyAnnounced?:boolean}} [opts]
 */
export async function enqueueIndexNow(items, { source = 'app', onlyAnnounced = false } = {}) {
	const rows = normalizeItems(items);
	if (!rows.length) return 0;
	const urls = rows.map((r) => r.url);
	const types = rows.map((r) => r.type);
	const reasons = rows.map((r) => r.reason);
	const changed = rows.map((r) => r.changedAt.toISOString());
	try {
		if (onlyAnnounced) {
			const out = await sql`
				update indexnow_urls n
				set reason = v.reason, source = ${source}, attempts = 0,
				    enqueued_at = greatest(v.changed_at, n.submitted_at + interval '1 millisecond')
				from unnest(${urls}::text[], ${reasons}::text[], ${changed}::timestamptz[]) as v(url, reason, changed_at)
				where n.url = v.url
				  and n.submitted_at is not null
				  and n.submitted_at <= v.changed_at
				returning n.url
			`;
			return out.length;
		}
		const out = await sql`
			insert into indexnow_urls (url, resource_type, reason, source, enqueued_at)
			select v.url, v.type, v.reason, ${source}, v.changed_at
			from unnest(${urls}::text[], ${types}::text[], ${reasons}::text[], ${changed}::timestamptz[])
				as v(url, type, reason, changed_at)
			on conflict (url) do update
			set resource_type = excluded.resource_type,
			    reason = excluded.reason,
			    source = excluded.source,
			    enqueued_at = greatest(
			        indexnow_urls.enqueued_at,
			        excluded.enqueued_at,
			        indexnow_urls.submitted_at + interval '1 millisecond'
			    ),
			    attempts = 0
			where indexnow_urls.submitted_at is null
			   or indexnow_urls.submitted_at <= excluded.enqueued_at
			returning url
		`;
		return out.length;
	} catch (err) {
		console.warn('[indexnow] enqueue failed:', err?.message || err);
		return 0;
	}
}

/**
 * Fire-and-forget form for request handlers: enqueue one resource change and
 * return immediately. The promise is caught here, so callers never await it.
 *
 * @param {'page'|'agent'|'avatar'|'creation'|'widget'|'profile'} type
 * @param {string} key  id, username, or page path
 * @param {'create'|'update'|'delete'} reason
 * @param {string} [source]
 */
export function notifyIndexNow(type, key, reason = 'update', source = 'app') {
	enqueueIndexNow([{ type, key, reason }], { source }).catch(() => {});
}

/**
 * The one call a write path makes after it changes a resource. Fire-and-forget.
 *
 *   indexable  the resource is public and indexable now: announce it
 *              ('create' or 'update').
 *   wasPublic  it is not indexable now but was public before this change
 *              (deleted or made private): announce the URL so the engine drops it.
 *   neither    announce only if this pipeline announced the URL before, so a
 *              URL that was never public is never sent anywhere.
 *
 * @param {'page'|'agent'|'avatar'|'creation'|'widget'|'profile'} type
 * @param {string} key
 * @param {{indexable:boolean, wasPublic?:boolean, reason?:'create'|'update'|'delete', source?:string}} state
 */
export function announceIndexNow(type, key, { indexable, wasPublic = false, reason, source = 'app' }) {
	const job = indexable
		? enqueueIndexNow([{ type, key, reason: reason === 'create' ? 'create' : 'update' }], { source })
		: enqueueIndexNow([{ type, key, reason: 'delete' }], { source, onlyAnnounced: !wasPublic });
	job.catch(() => {});
}

async function recentRateLimit() {
	const rows = await sql`
		select submitted_at from indexnow_submissions
		where status = 429
		  and submitted_at > now() - make_interval(mins => ${RATE_LIMIT_COOLDOWN_MINUTES})
		order by submitted_at desc
		limit 1
	`;
	return rows[0]?.submitted_at ?? null;
}

async function pickPending(limit) {
	return sql`
		select url, enqueued_at
		from indexnow_urls
		where (submitted_at is null or enqueued_at > submitted_at)
		  and attempts < ${MAX_ATTEMPTS}
		  and (
			submitted_at is null
			or reason = 'delete'
			or submitted_at < now() - make_interval(hours => ${RESUBMIT_FLOOR_HOURS})
		  )
		order by enqueued_at
		limit ${limit}
	`;
}

async function logSubmission({ source, urls, result }) {
	await sql`
		insert into indexnow_submissions (source, url_count, status, ok, error, sample_urls)
		values (
			${source}, ${urls.length}, ${result.status ?? null}, ${Boolean(result.ok)},
			${result.ok ? null : (result.error || `HTTP ${result.status}`)},
			${urls.slice(0, 5)}::text[]
		)
	`;
}

/**
 * Post pending URLs to IndexNow. Stops at the first failed request: a 429 or
 * a key problem will not clear by retrying in the same minute.
 *
 * @param {{source?:string, maxBatches?:number, batchSize?:number, send?:Function}} [opts]
 * @returns {Promise<{submitted:number, batches:Array<object>, skipped?:string, until?:string}>}
 */
export async function drainIndexNow({
	source = 'cron',
	maxBatches = 3,
	batchSize = INDEXNOW_BATCH_MAX,
	send = pingIndexNow,
} = {}) {
	const limitedAt = await recentRateLimit();
	if (limitedAt) {
		const until = new Date(new Date(limitedAt).getTime() + RATE_LIMIT_COOLDOWN_MINUTES * 60_000);
		return { submitted: 0, batches: [], skipped: 'rate_limited', until: until.toISOString() };
	}
	const size = Math.max(1, Math.min(INDEXNOW_BATCH_MAX, batchSize));
	const batches = [];
	let submitted = 0;
	for (let i = 0; i < maxBatches; i++) {
		const picked = await pickPending(size);
		if (!picked.length) break;
		const urls = picked.map((r) => r.url);
		// A URL re-enqueued while this request is in flight keeps a newer
		// enqueued_at than this, so it stays pending for the next batch.
		const cutoff = picked.reduce((m, r) => {
			const t = toDate(r.enqueued_at, null);
			return t && (!m || t > m) ? t : m;
		}, null);
		// submitted_at is when the engine was asked, not when it answered: a
		// change made during the request happened after the engine's fetch. It
		// is a JS millisecond, the precision change times arrive in, so a change
		// stamped in that same millisecond still counts as newer (enqueue
		// compares with <=) instead of losing to sub-millisecond database time.
		const sentAt = new Date();
		const result = await send(urls);
		await logSubmission({ source, urls, result });
		batches.push({ urls: urls.length, ok: Boolean(result.ok), status: result.status ?? null, error: result.ok ? undefined : result.error });
		if (result.ok) {
			await sql`
				update indexnow_urls
				set submitted_at = ${sentAt.toISOString()}::timestamptz, last_status = ${result.status ?? null}, attempts = 0
				where url = any(${urls}::text[])
				  and enqueued_at <= ${cutoff ? cutoff.toISOString() : new Date().toISOString()}::timestamptz
			`;
			submitted += urls.length;
			if (urls.length < size) break;
			continue;
		}
		await sql`
			update indexnow_urls
			set attempts = attempts + 1, last_status = ${result.status ?? null}
			where url = any(${urls}::text[])
		`;
		break;
	}
	return { submitted, batches };
}

// ── Reconcile ────────────────────────────────────────────────────────────────

/**
 * Per-type scanners. Each reads up to `limit` rows changed after the keyset
 * (ts, id) in (updated_at, id) order and returns them with the verdict the
 * reconciler acts on:
 *   indexable  public, live, and passes the same rule as the sitemap;
 *   deleted    soft-deleted while still marked public, so it was announced
 *              (or listed in a sitemap) and should be dropped.
 * Anything else is "not public now", announced only if announced before.
 */
const SCANNERS = {
	agent: {
		async scan(ts, id, limit) {
			const rows = await sql`
				select id::text as id, updated_at as ts, created_at, deleted_at, is_public,
				       name, left(description, 64) as description
				from agent_identities
				where (updated_at, id) > (${ts}::timestamptz, ${id || ZERO_UUID}::uuid)
				order by updated_at, id
				limit ${limit}
			`;
			return rows.map((r) => ({
				key: r.id,
				id: r.id,
				ts: r.ts,
				createdAt: r.created_at,
				indexable: !r.deleted_at && r.is_public === true && isIndexableAgent(r),
				deleted: Boolean(r.deleted_at) && r.is_public === true,
			}));
		},
	},
	avatar: {
		async scan(ts, id, limit) {
			const rows = await sql`
				select id::text as id, updated_at as ts, created_at, deleted_at, visibility,
				       name, left(description, 64) as description, left(alt_text, 64) as alt_text
				from avatars
				where (updated_at, id) > (${ts}::timestamptz, ${id || ZERO_UUID}::uuid)
				order by updated_at, id
				limit ${limit}
			`;
			return rows.map((r) => ({
				key: r.id,
				id: r.id,
				ts: r.ts,
				createdAt: r.created_at,
				indexable: !r.deleted_at && r.visibility === 'public' && isIndexableAvatar(r),
				deleted: Boolean(r.deleted_at) && r.visibility === 'public',
			}));
		},
	},
	creation: {
		// Forge rows are hard-deleted (deleteCreation announces those itself),
		// so a scan only ever sees live rows.
		async scan(ts, id, limit) {
			const rows = await sql`
				select id::text as id, updated_at as ts, created_at, status, glb_url, outcome, visibility
				from forge_creations
				where (updated_at, id) > (${ts}::timestamptz, ${id || ZERO_UUID}::uuid)
				order by updated_at, id
				limit ${limit}
			`;
			return rows.map((r) => ({
				key: r.id,
				id: r.id,
				ts: r.ts,
				createdAt: r.created_at,
				indexable: r.status === 'done' && Boolean(r.glb_url) && isIndexableCreation(r),
				deleted: false,
			}));
		},
	},
	widget: {
		async scan(ts, id, limit) {
			const rows = await sql`
				select id, updated_at as ts, created_at, deleted_at, is_public
				from widgets
				where (updated_at, id) > (${ts}::timestamptz, ${id || ''}::text)
				order by updated_at, id
				limit ${limit}
			`;
			return rows.map((r) => ({
				key: r.id,
				id: r.id,
				ts: r.ts,
				createdAt: r.created_at,
				indexable: !r.deleted_at && r.is_public === true,
				deleted: Boolean(r.deleted_at) && r.is_public === true,
			}));
		},
	},
	profile: {
		async scan(ts, id, limit) {
			const rows = await sql`
				select id::text as id, username, updated_at as ts, created_at, deleted_at
				from users
				where (updated_at, id) > (${ts}::timestamptz, ${id || ZERO_UUID}::uuid)
				  and service_account = false
				  and username is not null
				order by updated_at, id
				limit ${limit}
			`;
			return rows.map((r) => ({
				key: r.username,
				id: r.id,
				ts: r.ts,
				createdAt: r.created_at,
				indexable: !r.deleted_at,
				deleted: Boolean(r.deleted_at),
			}));
		},
	},
};

/** The entity types the reconciler scans, in run order. */
export const RECONCILE_TYPES = Object.freeze(['agent', 'avatar', 'creation', 'widget', 'profile', 'page']);

/**
 * Split scanned rows into the three enqueue calls the reconciler makes.
 *
 * @param {'agent'|'avatar'|'creation'|'widget'|'profile'|'page'} type
 * @param {Array<{key:string,ts:Date|string,createdAt?:Date|string,indexable:boolean,deleted:boolean}>} rows
 * @param {Date} cursorTs  rows created after this are "create", the rest "update"
 */
export function classifyRows(type, rows, cursorTs) {
	const live = [];
	const gone = [];
	const hidden = [];
	for (const r of rows) {
		if (r.indexable) {
			const created = toDate(r.createdAt, null);
			live.push({ type, key: r.key, reason: created && created > cursorTs ? 'create' : 'update', changedAt: r.ts });
		} else if (r.deleted) {
			gone.push({ type, key: r.key, reason: 'delete', changedAt: r.ts });
		} else {
			hidden.push({ type, key: r.key, reason: 'delete', changedAt: r.ts });
		}
	}
	return { live, gone, hidden };
}

async function readCursor(type, since) {
	if (since) return { ts: since, id: '' };
	const rows = await sql`select cursor_ts, cursor_id from indexnow_cursors where resource_type = ${type}`;
	if (rows[0]) return { ts: toDate(rows[0].cursor_ts, null), id: rows[0].cursor_id || '' };
	return { ts: new Date(Date.now() - DEFAULT_LOOKBACK_HOURS * 3_600_000), id: '' };
}

async function writeCursor(type, ts, id) {
	await sql`
		insert into indexnow_cursors (resource_type, cursor_ts, cursor_id, updated_at)
		values (${type}, ${toDate(ts, new Date()).toISOString()}::timestamptz, ${id}, now())
		on conflict (resource_type) do update
		set cursor_ts = excluded.cursor_ts, cursor_id = excluded.cursor_id, updated_at = now()
	`;
}

async function loadManifest() {
	for (const file of [path.join(process.cwd(), 'data', 'pages.json'), path.join(process.cwd(), 'public', 'features.json')]) {
		try {
			return JSON.parse(await readFile(file, 'utf8'));
		} catch {
			// try next
		}
	}
	return null;
}

/**
 * Public pages from data/pages.json whose lastmod/added date is on or after
 * `since`. Dates are day-granular, so a page dated today is re-read on every
 * run today; enqueue ignores it once it has been submitted since that date.
 */
export function changedManifestPages(manifest, since) {
	const day = since.toISOString().slice(0, 10);
	const out = [];
	for (const section of manifest?.sections || []) {
		for (const p of section.pages || []) {
			if (!isIndexableManifestPage(section, p)) continue;
			const d = String(p.lastmod || p.added || '').slice(0, 10);
			if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d < day) continue;
			out.push({ type: 'page', key: p.path, reason: p.lastmod && p.lastmod !== p.added ? 'update' : 'create', changedAt: `${d}T00:00:00Z` });
		}
	}
	return out;
}

async function reconcileType(type, { since, dryRun, source, pageSize, manifest, isLive }) {
	const cursor = await readCursor(type, since);
	const summary = { type, from: cursor.ts.toISOString(), scanned: 0, live: 0, gone: 0, hidden: 0, enqueued: 0 };

	if (type === 'page') {
		const changed = changedManifestPages(manifest ?? (await loadManifest()), cursor.ts);
		summary.scanned = changed.length;
		// The cron runs inside the deployed container, so every page in its
		// manifest is live. A manual run from a checkout ahead of production
		// passes `isLive`, and a page production does not serve yet waits.
		const items = [];
		const skipped = [];
		for (const item of changed) {
			const url = resourceUrl(INDEXNOW_ORIGIN, 'page', item.key);
			if (!isLive || (await isLive(url))) items.push(item);
			else skipped.push(url);
		}
		summary.live = items.length;
		summary.notLive = skipped.length;
		summary.skipped = skipped;
		if (!dryRun) {
			summary.enqueued = await enqueueIndexNow(items, { source });
			// Hold the cursor while any page is waiting on a deploy, so the
			// next run (or the deployed cron) still sees it.
			if (!skipped.length) await writeCursor('page', new Date(), '');
		}
		summary.urls = items.map((i) => resourceUrl(INDEXNOW_ORIGIN, 'page', i.key));
		return summary;
	}

	let { ts, id } = cursor;
	const sample = [];
	for (let page = 0; page < RECONCILE_MAX_PAGES; page++) {
		const rows = await SCANNERS[type].scan(ts.toISOString(), id, pageSize);
		if (!rows.length) break;
		summary.scanned += rows.length;
		const { live, gone, hidden } = classifyRows(type, rows, cursor.ts);
		summary.live += live.length;
		summary.gone += gone.length;
		summary.hidden += hidden.length;
		for (const i of live) if (sample.length < 20) sample.push(resourceUrl(INDEXNOW_ORIGIN, type, i.key));
		const last = rows[rows.length - 1];
		ts = toDate(last.ts, ts);
		id = last.id;
		if (!dryRun) {
			summary.enqueued += await enqueueIndexNow([...live, ...gone], { source });
			summary.enqueued += await enqueueIndexNow(hidden, { source, onlyAnnounced: true });
			await writeCursor(type, ts, id);
		}
		if (rows.length < pageSize) break;
	}
	summary.to = ts.toISOString();
	summary.urls = sample;
	return summary;
}

/**
 * Enqueue every public change since each type's cursor, then (unless
 * `drain` is false or this is a dry run) submit the outbox.
 *
 * `manifest` overrides data/pages.json for the page type, and `isLive(url)`
 * gates each catalog page on production actually serving it.
 *
 * @param {{since?:Date, types?:string[], dryRun?:boolean, drain?:boolean, source?:string, send?:Function, pageSize?:number, manifest?:object, isLive?:(url:string)=>Promise<boolean>}} [opts]
 */
export async function reconcileIndexNow({
	since = null,
	types = RECONCILE_TYPES,
	dryRun = false,
	drain = true,
	source = 'reconcile',
	send,
	pageSize = RECONCILE_PAGE,
	manifest = null,
	isLive = null,
} = {}) {
	const results = [];
	for (const type of types) {
		if (!RECONCILE_TYPES.includes(type)) throw new Error(`unknown resource type: ${type}`);
		try {
			results.push(await reconcileType(type, { since, dryRun, source, pageSize, manifest, isLive }));
		} catch (err) {
			results.push({ type, error: err?.message || String(err) });
		}
	}
	const drained = !dryRun && drain ? await drainIndexNow({ source, ...(send ? { send } : {}) }) : null;
	return { types: results, drain: drained };
}

/** The newest submissions and the outbox depth, for the cron response and ops. */
export async function indexNowStatus() {
	const [pending, recent] = await Promise.all([
		sql`
			select count(*)::int as n from indexnow_urls
			where (submitted_at is null or enqueued_at > submitted_at) and attempts < ${MAX_ATTEMPTS}
		`,
		sql`
			select submitted_at, source, url_count, status, ok, error
			from indexnow_submissions order by submitted_at desc limit 5
		`,
	]);
	return { pending: pending[0]?.n ?? 0, recent };
}

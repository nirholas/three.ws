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
 * Only an http(s) preview counts: some older rows stored the preview inline as
 * a data: URI, which the worker's SSRF guard refuses to fetch.
 */
export function posterUrlFor(row, origin = ORIGIN) {
	const preview = normalizeStoredUrl(row?.preview_image_url);
	if (preview && /^https?:\/\//i.test(preview)) return preview;
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

/**
 * Marker on a row whose stored preview came back blank: the next claim
 * describes it from the GLB render instead of the preview.
 */
export const BLANK_POSTER_ERROR = 'blank poster';

const RENDER_PATH = '/api/render/glb';

/**
 * True when Florence-2 says the image has nothing in it. Some stored previews
 * are an all-black or all-white image; the model then answers "unanswerable"
 * or "The image is blank ...", and that text must never become a creation's
 * meta description or alt text. A dark render that still names a subject
 * ("The image is completely black. There is a small model of ...") is a real
 * description and is kept.
 */
export function isBlankDescribeResult(result) {
	if (!result || typeof result !== 'object') return false;
	const caption = typeof result.caption === 'string' ? result.caption.trim() : '';
	const detailed = typeof result.detailed === 'string' ? result.detailed.trim() : '';
	if (/^unanswerable\W*$/i.test(caption)) return true;
	if (/^an? (blank|empty)\b.*\bno (image|picture|content)\b/i.test(caption)) return true;
	return /^the (image|picture) is (completely |entirely |totally )?(blank|empty)\b/i.test(detailed);
}

/**
 * A blank result is never stored as 'done'. From the stored preview, the row
 * goes back to the queue marked BLANK_POSTER_ERROR so the next claim uses the
 * GLB render; from the render itself, there is nothing better to describe and
 * the row is skipped. Generated text is cleared; owner-edited tags are kept.
 */
async function markBlankPoster({ creationId, sourceImageUrl }) {
	const fromRender = typeof sourceImageUrl === 'string' && sourceImageUrl.includes(RENDER_PATH);
	const status = fromRender ? 'skipped' : 'queued';
	const error = fromRender ? 'blank poster and blank GLB render' : BLANK_POSTER_ERROR;
	// A re-queued row is released at once (lease backdated), so the very next
	// claim tries the render; attempts still counts toward MAX_ATTEMPTS.
	await sql`
		insert into forge_creation_descriptions (creation_id, status, error, attempts, updated_at)
		select id, ${status}, ${error}, 1, now() - make_interval(mins => ${LEASE_MINUTES})
		from forge_creations where id = ${creationId}
		on conflict (creation_id) do update set
			status = excluded.status,
			error = excluded.error,
			caption = null,
			detailed = null,
			generated_tags = '{}',
			tags = case when forge_creation_descriptions.tags_edited_at is null
				then '{}'::text[] else forge_creation_descriptions.tags end,
			objects = '[]'::jsonb,
			source_image_url = ${sourceImageUrl},
			updated_at = now()
	`;
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
		select fc.id, fc.preview_image_url, fc.glb_url, fc.web_glb_url, fc.size_bytes, fc.web_size_bytes,
			fc.created_at, d.error as d_error
		from forge_creations fc
		left join forge_creation_descriptions d on d.creation_id = fc.id
		where fc.id = any(${ids}::uuid[])
		order by fc.created_at desc
	`;
	const items = [];
	const skipped = [];
	try {
		for (const row of rows) {
			// A preview that already came back blank is not worth a second look:
			// describe the GLB render instead.
			const source = row.d_error === BLANK_POSTER_ERROR ? { ...row, preview_image_url: null } : row;
			const imageUrl = posterUrlFor(source, origin);
			if (imageUrl) items.push({ id: row.id, imageUrl });
			else skipped.push(row.id);
		}
	} catch (err) {
		// URL resolution failing is a process misconfiguration (no object
		// storage env), not a property of these rows: give the leases and the
		// spent attempt back so nothing drifts toward 'failed'.
		await sql`
			update forge_creation_descriptions
			set attempts = greatest(attempts - 1, 0), updated_at = now() - make_interval(mins => ${LEASE_MINUTES})
			where creation_id = any(${ids}::uuid[]) and status = 'queued'
		`;
		throw err;
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
 * generated_tags always holds what the model produced. A creation deleted
 * after it was leased stores nothing and returns false (the insert selects
 * from forge_creations, so the foreign key never fires).
 */
export async function storeDescription({ creationId, result, sourceImageUrl = null }) {
	const r = sanitizeDescribeResult(result);
	if (isBlankDescribeResult(r)) {
		await markBlankPoster({ creationId, sourceImageUrl });
		return false;
	}
	if (!r.caption && !r.detailed && !r.tags.length) {
		await markDescribeFailed({ creationId, error: 'empty describe result' });
		return false;
	}
	const rows = await sql`
		insert into forge_creation_descriptions (
			creation_id, status, caption, detailed, tags, generated_tags, objects,
			model, model_version, latency_ms, source_image_url, described_at, updated_at
		)
		select
			id, 'done', ${r.caption}, ${r.detailed}, ${r.tags}, ${r.tags}, ${JSON.stringify(r.objects)}::jsonb,
			${r.model}, ${r.modelVersion}, ${r.latencyMs}, ${sourceImageUrl}, now(), now()
		from forge_creations where id = ${creationId}
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

/**
 * Record a failed attempt; the row goes back to the queue until MAX_ATTEMPTS.
 * A creation deleted since the lease is skipped.
 */
export async function markDescribeFailed({ creationId, error }) {
	const message = String(error || 'describe failed').slice(0, 500);
	await sql`
		insert into forge_creation_descriptions (creation_id, status, error, attempts, updated_at)
		select id, 'queued', ${message}, 1, now() from forge_creations where id = ${creationId}
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

/**
 * Send descriptions stored from a blank poster (before isBlankDescribeResult
 * existed) back to the queue, to be described from the GLB render. Clears the
 * generated text so the page falls back to the prompt meanwhile, keeps
 * owner-edited tags, and resets attempts so the render gets a full budget.
 * Walks the table in creation_id order. Returns counts.
 */
export async function requeueBlankDescriptions({ pageSize = 500, dryRun = false } = {}) {
	let after = '00000000-0000-0000-0000-000000000000';
	let scanned = 0;
	let requeued = 0;
	for (;;) {
		const rows = await sql`
			select creation_id, caption, detailed
			from forge_creation_descriptions
			where status = 'done' and creation_id > ${after}::uuid
			order by creation_id
			limit ${pageSize}
		`;
		if (!rows.length) break;
		const blank = [];
		for (const r of rows) {
			scanned += 1;
			if (isBlankDescribeResult(r)) blank.push(r.creation_id);
		}
		requeued += blank.length;
		if (blank.length && !dryRun) {
			await sql`
				update forge_creation_descriptions set
					status = 'queued',
					error = ${BLANK_POSTER_ERROR},
					attempts = 0,
					caption = null,
					detailed = null,
					generated_tags = '{}',
					tags = case when tags_edited_at is null then '{}'::text[] else tags end,
					objects = '[]'::jsonb,
					updated_at = now()
				where creation_id = any(${blank}::uuid[]) and status = 'done'
			`;
		}
		after = rows[rows.length - 1].creation_id;
	}
	return { scanned, requeued };
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

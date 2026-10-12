/**
 * Forge batch: submit up to MAX_ITEMS /api/forge generations in one call,
 * concurrency-capped by the caller's $THREE holder tier, and poll the group.
 *
 *   POST /api/forge-batch  { items: [ <any /api/forge POST body>, ... ] }
 *     -> { batch_id, items: [{ index, ok, job_id?, status?, glb_url?, error? }] }
 *   GET  /api/forge-batch?batch=<id>
 *     -> { batch_id, status: 'queued'|'running'|'done'|'partial', items: [...] }
 *
 * Each item is a full, independent /api/forge submission (api/forge.js),
 * called over HTTP against this deployment's own origin (the same self-call
 * idiom api/_mcp-studio/forge-client.js uses), so every lane-selection,
 * gating, and caching rule /api/forge already enforces applies per item
 * unchanged. This endpoint adds only the fan-out, the concurrency cap, and
 * the group bookkeeping: it never touches the database directly, since each
 * item's /api/forge call already persists its own durable forge_creations row.
 *
 * Concurrency cap: the $THREE holder-tier rate multiplier that already lifts
 * the free generation ceiling (freeLaneMultiplier in forge.js) also lifts how
 * many items of one batch submit at once (BASE_CONCURRENCY * multiplier,
 * capped at MAX_CONCURRENCY): the resolution is re-implemented locally from
 * the same primitives (three-tier.js, comp-access.js) rather than imported
 * from forge.js, which keeps the multiplier private to that module.
 *
 * Per-item isolation: one item's failure never fails the batch (mirrors
 * api/x402/mint-to-mesh-batch.js's convention): a submit error on item 2
 * still returns items 0, 1, 3... with their own real job ids.
 *
 * Group state lives in Redis only (fr:batch: prefix, mirrors the best-effort,
 * fail-open pattern in forge-job-options.js): a Redis outage at submit time
 * degrades to an un-grouped response (every item still carries a real job id
 * the caller can poll individually via GET /api/forge?job=); at poll time it
 * is a 404 for the group endpoint specifically, never a broken item result.
 */

import { randomUUID } from 'node:crypto';
import { cors, json, method, readJson, wrap, rateLimited } from './_lib/http.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { getRedis } from './_lib/redis.js';
import { selfOrigin } from './_lib/self-origin.js';
import { TIERS, verifyTierPass } from './_lib/three-tier.js';
import { resolveCompAccess, COMP_TIER } from './_lib/comp-access.js';

const PREFIX = 'fr:batch:';
const TTL_S = 3600;
const MAX_ITEMS = 8;
const BASE_CONCURRENCY = 2;
const MAX_CONCURRENCY = 8;
const SUBMIT_TIMEOUT_MS = 90_000;
const TERMINAL_STATUSES = new Set(['done', 'failed']);

// Same resolution as forge.js's private freeLaneMultiplier: a verified $THREE
// tier pass wins outright; a comped account (cookie-guarded, zero cost on the
// anonymous path) is the fallback. Re-implemented here rather than imported
// because freeLaneMultiplier is private to forge.js.
async function batchConcurrency(req, body) {
	const token = req.headers?.['x-three-tier-pass'] || body?.tier_pass || null;
	let multiplier = 1;
	if (token) {
		const payload = verifyTierPass(token);
		const tier = payload ? TIERS.find((t) => t.level === payload.level) : null;
		multiplier = tier?.rateMultiplier || 1;
	}
	if (multiplier <= 1) {
		const { comped } = await resolveCompAccess(req);
		if (comped) multiplier = COMP_TIER.rateMultiplier || 1;
	}
	const concurrency = Math.min(MAX_CONCURRENCY, Math.max(BASE_CONCURRENCY, Math.round(BASE_CONCURRENCY * multiplier)));
	return { multiplier, concurrency };
}

// Concurrency-capped fan-out: no p-limit-style utility exists in api/_lib, so
// a small inline worker pool runs `limit` workers pulling from a shared index.
async function runPool(items, limit, worker) {
	const results = new Array(items.length);
	let next = 0;
	async function runner() {
		for (;;) {
			const i = next++;
			if (i >= items.length) return;
			results[i] = await worker(items[i], i);
		}
	}
	await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, runner));
	return results;
}

async function submitOne(base, headers, item, index) {
	let res;
	try {
		res = await fetch(`${base}/api/forge`, {
			method: 'POST',
			headers,
			body: JSON.stringify(item),
			signal: AbortSignal.timeout(SUBMIT_TIMEOUT_MS),
		});
	} catch (err) {
		const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
		return {
			index,
			ok: false,
			error: timedOut ? 'timeout' : 'provider_error',
			message: timedOut
				? 'the 3D generator took too long to accept this item'
				: `the 3D generator is unreachable: ${err?.message || err}`,
		};
	}
	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		return {
			index,
			ok: false,
			error: data?.error || 'provider_error',
			message: data?.message || `the 3D generator returned ${res.status} for this item`,
		};
	}
	return {
		index,
		ok: true,
		job_id: data.job_id ?? null,
		creation_id: data.creation_id ?? null,
		status: data.status || (data.job_id ? 'queued' : 'done'),
		glb_url: data.glb_url ?? null,
		path: data.path ?? null,
		tier: data.tier ?? null,
		backend: data.backend ?? null,
	};
}

async function pollOne(base, item) {
	if (!item.ok || !item.job_id || TERMINAL_STATUSES.has(item.status)) return item;
	let res;
	try {
		res = await fetch(`${base}/api/forge?job=${encodeURIComponent(item.job_id)}`, {
			signal: AbortSignal.timeout(15_000),
		});
	} catch {
		return item; // transient poll failure: keep the last known status, try again next poll
	}
	const data = await res.json().catch(() => null);
	if (!data) return item;
	return {
		...item,
		status: data.status || item.status,
		glb_url: data.glb_url ?? item.glb_url,
		...(data.status === 'failed' && data.error ? { error: 'generation_failed', message: data.error } : {}),
	};
}

function itemTerminal(item) {
	return item.ok === false || TERMINAL_STATUSES.has(item.status);
}

function groupStatus(items) {
	if (items.every(itemTerminal)) {
		return items.every((i) => i.ok && i.status === 'done') ? 'done' : 'partial';
	}
	return items.some((i) => i.ok && i.status && i.status !== 'queued') ? 'running' : 'queued';
}

async function storeBatch(batchId, record) {
	const r = getRedis();
	if (!r) return;
	try {
		await r.set(`${PREFIX}${batchId}`, JSON.stringify(record), { ex: TTL_S });
	} catch {
		/* best-effort: items already carry their own job ids */
	}
}

async function loadBatch(batchId) {
	const r = getRedis();
	if (!r) return null;
	try {
		const raw = await r.get(`${PREFIX}${batchId}`);
		if (!raw) return null;
		return typeof raw === 'string' ? JSON.parse(raw) : raw;
	} catch {
		return null;
	}
}

async function startBatch(req, res) {
	const body = await readJson(req, 64_000).catch(() => null);
	const rawItems = Array.isArray(body?.items) ? body.items : null;
	if (!rawItems || !rawItems.length) {
		return json(res, 400, {
			error: 'missing_items',
			message: `Pass items: an array of 1..${MAX_ITEMS} /api/forge request bodies.`,
		});
	}
	if (rawItems.length > MAX_ITEMS) {
		return json(res, 400, {
			error: 'too_many_items',
			message: `A batch holds at most ${MAX_ITEMS} items; split into multiple batches.`,
			max_items: MAX_ITEMS,
		});
	}
	for (let i = 0; i < rawItems.length; i++) {
		if (!rawItems[i] || typeof rawItems[i] !== 'object' || Array.isArray(rawItems[i])) {
			return json(res, 400, {
				error: 'invalid_item',
				message: `items[${i}] must be an object, the same shape as a /api/forge POST body.`,
			});
		}
	}

	const ip = clientIp(req);
	const { multiplier, concurrency } = await batchConcurrency(req, body);
	const rl = await limits.forgeBatchSubmit(ip, multiplier);
	if (!rl.success) return rateLimited(res, rl);

	const base = selfOrigin(req);
	// Forward the real caller's IP as x-forwarded-for so /api/forge's own
	// per-IP free-lane limiter and $THREE tier gate attribute to the actual
	// caller rather than this server's own egress address; forward the
	// session cookie and tier pass so the holder/comp perk this endpoint
	// already resolved for the concurrency cap also applies inside each
	// item's own /api/forge submission. Never the internal seed header: a
	// batch submit is never platform-funded.
	const forwardHeaders = {
		'content-type': 'application/json',
		'x-forwarded-for': ip,
		...(req.headers.cookie ? { cookie: req.headers.cookie } : {}),
		...(req.headers['x-three-tier-pass'] ? { 'x-three-tier-pass': req.headers['x-three-tier-pass'] } : {}),
		...(req.headers['x-forge-client'] ? { 'x-forge-client': req.headers['x-forge-client'] } : {}),
	};

	const items = await runPool(rawItems, concurrency, (item, index) => submitOne(base, forwardHeaders, item, index));

	const batchId = randomUUID();
	await storeBatch(batchId, { batch_id: batchId, created_at: Date.now(), items });

	return json(res, 200, { batch_id: batchId, status: groupStatus(items), items });
}

async function pollBatch(req, res, batchId) {
	const rl = await limits.forgeBatchStatus(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const record = await loadBatch(batchId);
	if (!record) {
		return json(res, 404, {
			error: 'batch_not_found',
			message: 'Unknown or expired batch id. Poll each item individually via GET /api/forge?job=<id> instead.',
		});
	}

	const base = selfOrigin(req);
	const items = await Promise.all(record.items.map((item) => pollOne(base, item)));
	const status = groupStatus(items);
	await storeBatch(batchId, { ...record, items });

	return json(res, 200, { batch_id: batchId, status, items });
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS' })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	if (req.method === 'POST') return startBatch(req, res);

	const url = new URL(req.url, 'http://localhost');
	const batchId = (url.searchParams.get('batch') || '').trim();
	if (!batchId) {
		return json(res, 400, { error: 'missing_batch', message: 'Pass ?batch=<id> to poll a batch.' });
	}
	return pollBatch(req, res, batchId);
});

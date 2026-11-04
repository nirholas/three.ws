// Solana RPC call accounting: who spends the quota.
//
// Every upstream JSON-RPC call the rotating fetch makes (api/_lib/solana/
// connection.js) is counted here under (caller, method, lane), in hourly
// buckets. The caller is the API route template or cron path the request
// context carries (server/index.mjs sets it per dispatch), or `script:<name>`
// for a process that is not the API server. The lane is the provider host.
//
// Storage is the shared cache (api/_lib/cache.js), with no new vendor. The cache
// only offers GET/SET, so a fleet-wide counter cannot be an atomic increment.
// Each instance instead owns one SHARD per hour (`rpcspend:v1:h:<hour>:<id>`),
// holding its own cumulative counts for that hour, and overwrites it at most
// once a minute. Readers merge every shard named in the hour's index key. Only
// the index is read-modify-write, and every flush re-checks membership, so a
// lost race heals on the next flush instead of dropping an instance for good.
//
// Two pseudo-lanes record work that never reached a provider: `cache` (a fresh
// read served from the short read cache) and `coalesced` (a duplicate of an
// in-flight identical read that shared its upstream promise). They are reported
// as `saved`, never as calls.
//
// Browser-safe on purpose: connection.js is in the browser bundle, so nothing
// here imports a Node built-in at module scope. The request context is loaded
// through a runtime-assembled specifier for the same reason the brownout bridge
// in connection.js is (rollup would otherwise bind node:async_hooks).

const HOUR_MS = 3_600_000;
const FLUSH_INTERVAL_MS = 60_000;
const SHARD_TTL_SECONDS = 26 * 3600;
// Distinct (caller, method, lane) keys one instance tracks per hour. The key
// space is bounded by routes x methods x lanes; this is the backstop for a
// caller tag that somehow carries an id.
const MAX_KEYS_PER_HOUR = 4000;
const KEY_SEP = '\t';
const OVERFLOW_CALLER = 'other';
export const SAVED_LANES = new Set(['cache', 'coalesced']);
export const SPEND_PREFIX = 'rpcspend:v1';

function isServer() {
	return typeof window === 'undefined' && typeof process !== 'undefined';
}

let _cachePromise = null;
function sharedCache() {
	if (!isServer()) return null;
	if (!_cachePromise) _cachePromise = import('../cache.js').catch(() => null);
	return _cachePromise;
}

let _ctxMod = null;
globalThis.__threewsRpcSpendCtxSpecifier ||= ['..', 'request-context.js'].join('/');
if (isServer()) {
	import(/* @vite-ignore */ globalThis.__threewsRpcSpendCtxSpecifier)
		.then((m) => {
			_ctxMod = m;
		})
		.catch(() => {});
}

let _instanceId = null;
function instanceId() {
	if (!_instanceId) {
		const rev = (isServer() && process.env.K_REVISION) || 'local';
		_instanceId = `${rev}-${Math.random().toString(36).slice(2, 10)}`;
	}
	return _instanceId;
}

let _processTag = null;
function processTag() {
	if (_processTag) return _processTag;
	const entry = isServer() ? String(process.argv?.[1] || '') : '';
	const base = entry.split(/[\\/]/).pop() || 'unknown';
	_processTag = /^index\.m?js$/.test(base) && /server[\\/]index\.m?js$/.test(entry) ? 'server:background' : `script:${base}`;
	return _processTag;
}

/** The caller tag for the current async context. */
export function currentRpcCaller() {
	const ctx = _ctxMod?.requestContext?.();
	if (ctx?.rpcCaller) return String(ctx.rpcCaller);
	return processTag();
}

export const hourStart = (t) => Math.floor(t / HOUR_MS) * HOUR_MS;
const shardKey = (hour, id) => `${SPEND_PREFIX}:h:${hour}:${id}`;
const indexKey = (hour) => `${SPEND_PREFIX}:idx:${hour}`;

/** @type {Map<number, Map<string, number>>} hour start -> (caller\tmethod\tlane -> calls) */
const _local = new Map();
let _dirty = false;
let _timer = null;
let _flushing = null;

/**
 * Count calls. `methods` lists one entry per JSON-RPC call (a 3-call batch of
 * getBalance is ['getBalance','getBalance','getBalance']), because providers
 * meter batch members individually.
 * @param {{ lane: string, methods: string[], caller?: string, now?: number }} rec
 */
export function recordRpcSpend({ lane, methods, caller, now = Date.now() }) {
	if (!isServer() || !lane || !Array.isArray(methods) || methods.length === 0) return;
	const who = caller || currentRpcCaller();
	const hour = hourStart(now);
	let bucket = _local.get(hour);
	if (!bucket) {
		bucket = new Map();
		_local.set(hour, bucket);
	}
	for (const m of methods) {
		const method = typeof m === 'string' && m ? m : 'unknown';
		let key = `${who}${KEY_SEP}${method}${KEY_SEP}${lane}`;
		if (!bucket.has(key) && bucket.size >= MAX_KEYS_PER_HOUR) key = `${OVERFLOW_CALLER}${KEY_SEP}${method}${KEY_SEP}${lane}`;
		bucket.set(key, (bucket.get(key) || 0) + 1);
	}
	_dirty = true;
	scheduleFlush();
}

function scheduleFlush() {
	if (_timer || !isServer()) return;
	_timer = setTimeout(() => {
		_timer = null;
		flushRpcSpend().catch(() => {});
	}, FLUSH_INTERVAL_MS);
	_timer.unref?.();
}

/** Write this instance's shards for every hour it has counts for. */
export async function flushRpcSpend(now = Date.now()) {
	if (_flushing) return _flushing;
	if (!_dirty) return;
	_flushing = (async () => {
		_dirty = false;
		const cache = await sharedCache();
		if (!cache) return;
		const id = instanceId();
		const cutoff = hourStart(now) - HOUR_MS;
		for (const [hour, bucket] of _local) {
			if (hour < cutoff) {
				_local.delete(hour);
				continue;
			}
			try {
				await cache.cacheSet(shardKey(hour, id), { at: now, counts: Object.fromEntries(bucket) }, SHARD_TTL_SECONDS);
				const idx = await cache.cacheGetFresh(indexKey(hour));
				const ids = Array.isArray(idx) ? idx : [];
				if (!ids.includes(id)) await cache.cacheSet(indexKey(hour), [...ids, id], SHARD_TTL_SECONDS);
			} catch {
				_dirty = true;
			}
		}
	})().finally(() => {
		_flushing = null;
	});
	return _flushing;
}

async function mapLimit(items, limit, fn) {
	const out = new Array(items.length);
	let i = 0;
	const worker = async () => {
		while (i < items.length) {
			const n = i++;
			out[n] = await fn(items[n]);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	return out;
}

/**
 * Fleet-wide counts over the last `hours` hours (the current hour included),
 * merged across every instance shard. This instance's own counts come from
 * memory, so they are current to the call rather than to the last flush.
 * @returns {Promise<{ from: number, to: number, instances: number, rows: Array<{caller:string,method:string,lane:string,calls:number}> }>}
 */
export async function readRpcSpend({ hours = 24, now = Date.now(), since = null } = {}) {
	const current = hourStart(now);
	const first = since != null ? hourStart(since) : current - (Math.max(1, hours) - 1) * HOUR_MS;
	const hourList = [];
	for (let h = first; h <= current; h += HOUR_MS) hourList.push(h);
	const cache = await sharedCache();
	const id = instanceId();
	const merged = new Map();
	const add = (counts) => {
		for (const [k, v] of Object.entries(counts || {})) merged.set(k, (merged.get(k) || 0) + (Number(v) || 0));
	};
	const instances = new Set();
	await mapLimit(hourList, 6, async (hour) => {
		const local = _local.get(hour);
		if (local) {
			instances.add(id);
			add(Object.fromEntries(local));
		}
		if (!cache) return;
		const idx = await cache.cacheGetFresh(indexKey(hour)).catch(() => null);
		const ids = (Array.isArray(idx) ? idx : []).filter((x) => x !== id || !local);
		await mapLimit(ids, 8, async (other) => {
			const shard = await cache.cacheGetFresh(shardKey(hour, other)).catch(() => null);
			if (shard?.counts) {
				instances.add(other);
				add(shard.counts);
			}
		});
	});
	const rows = [];
	for (const [k, calls] of merged) {
		const [caller, method, lane] = k.split(KEY_SEP);
		rows.push({ caller, method, lane, calls });
	}
	rows.sort((a, b) => b.calls - a.calls);
	return { from: first, to: current + HOUR_MS, instances: instances.size, rows };
}

/**
 * Roll rows up for a report: upstream calls vs reads saved, top (caller, method)
 * pairs, per-lane totals, and the top caller.
 */
export function summarizeRpcSpend(rows, top = 20) {
	const pairs = new Map();
	const lanes = new Map();
	const callers = new Map();
	let calls = 0;
	let saved = 0;
	for (const r of rows) {
		const isSaved = SAVED_LANES.has(r.lane);
		const key = `${r.caller}${KEY_SEP}${r.method}`;
		const p = pairs.get(key) || { caller: r.caller, method: r.method, calls: 0, saved: 0 };
		if (isSaved) {
			p.saved += r.calls;
			saved += r.calls;
		} else {
			p.calls += r.calls;
			calls += r.calls;
			lanes.set(r.lane, (lanes.get(r.lane) || 0) + r.calls);
			callers.set(r.caller, (callers.get(r.caller) || 0) + r.calls);
		}
		pairs.set(key, p);
	}
	const topPairs = [...pairs.values()].sort((a, b) => b.calls - a.calls || b.saved - a.saved).slice(0, top);
	const byLane = [...lanes].map(([lane, n]) => ({ lane, calls: n })).sort((a, b) => b.calls - a.calls);
	const byCaller = [...callers].map(([caller, n]) => ({ caller, calls: n })).sort((a, b) => b.calls - a.calls);
	return { calls, saved, top: topPairs, byLane, topCaller: byCaller[0] || null, byCaller: byCaller.slice(0, top) };
}

// Per-lane daily budget guard.
//
// RPC_LANE_BUDGETS is a JSON object keyed by lane host. A value is either the
// lane's daily call quota (number) or { daily, fraction }. Once a lane's
// fleet-wide calls for the current UTC day cross fraction x daily (default
// RPC_LANE_BUDGET_FRACTION, else 0.8), non-money callers are routed to it last,
// so the remaining quota is kept for settles, sends and verifies.
const DEFAULT_BUDGET_FRACTION = 0.8;
// Five minutes: a refresh reads every shard for the day, and the guard only
// needs to notice a lane approaching its ceiling, not track it to the call.
const LANE_SPEND_REFRESH_MS = 5 * 60_000;
let _budgetsRaw;
let _budgets = new Map();

/** @returns {Map<string, { daily: number, fraction: number }>} */
export function laneBudgets() {
	const raw = isServer() ? process.env.RPC_LANE_BUDGETS || '' : '';
	if (raw === _budgetsRaw) return _budgets;
	_budgetsRaw = raw;
	_budgets = new Map();
	if (!raw) return _budgets;
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch {
		console.warn('[solana-rpc] RPC_LANE_BUDGETS is not valid JSON; budget guard disabled');
		return _budgets;
	}
	const envFraction = Number(process.env.RPC_LANE_BUDGET_FRACTION);
	const defFraction = envFraction > 0 && envFraction <= 1 ? envFraction : DEFAULT_BUDGET_FRACTION;
	for (const [host, v] of Object.entries(parsed || {})) {
		const daily = Number(typeof v === 'object' && v ? v.daily : v);
		const f = Number(typeof v === 'object' && v ? v.fraction : NaN);
		if (!(daily > 0)) continue;
		_budgets.set(String(host).replace(/^https?:\/\//, '').replace(/\/.*$/, ''), {
			daily,
			fraction: f > 0 && f <= 1 ? f : defFraction,
		});
	}
	return _budgets;
}

const dayStart = (t) => Math.floor(t / 86_400_000) * 86_400_000;
let _laneSpend = { day: 0, at: 0, byLane: new Map() };
let _laneSpendRefresh = null;

function refreshLaneSpend(now) {
	if (_laneSpendRefresh) return _laneSpendRefresh;
	_laneSpendRefresh = readRpcSpend({ since: dayStart(now), now })
		.then(({ rows }) => {
			const byLane = new Map();
			for (const r of rows) if (!SAVED_LANES.has(r.lane)) byLane.set(r.lane, (byLane.get(r.lane) || 0) + r.calls);
			_laneSpend = { day: dayStart(now), at: Date.now(), byLane };
		})
		.catch(() => {})
		.finally(() => {
			_laneSpendRefresh = null;
		});
	return _laneSpendRefresh;
}

/** Fleet calls today on `lane`, from the last refresh (kicked off in the background when stale). */
export function laneCallsToday(lane, now = Date.now()) {
	if (_laneSpend.day !== dayStart(now)) {
		refreshLaneSpend(now);
		return 0;
	}
	if (now - _laneSpend.at > LANE_SPEND_REFRESH_MS) refreshLaneSpend(now);
	return _laneSpend.byLane.get(lane) || 0;
}

/** True when `lane` has used its configured share of today's quota. */
export function isLaneOverBudget(lane, now = Date.now()) {
	const budget = laneBudgets().get(lane);
	if (!budget) return false;
	return laneCallsToday(lane, now) >= budget.daily * budget.fraction;
}

/** Await a lane-spend refresh now. For tests and the health probe. */
export function refreshLaneSpendNow(now = Date.now()) {
	return refreshLaneSpend(now);
}

/** Test hook: forget every local count, budget parse and lane-spend snapshot. */
export function _resetRpcSpend() {
	_local.clear();
	_dirty = false;
	if (_timer) clearTimeout(_timer);
	_timer = null;
	_budgetsRaw = undefined;
	_budgets = new Map();
	_laneSpend = { day: 0, at: 0, byLane: new Map() };
}

// The Forge waiting line: an honest queue in front of the reference-image step.
//
// Why it exists. A text prompt is painted into a reference image by a ladder of
// text-to-image providers before any GPU lane sees it. On 2026-11-26 the only
// rung serving allowed one image per 45 seconds for the whole service, and a
// refused request restarted that window. Twenty prompts in one minute meant one
// image and nineteen 429s that each said "queued behind a few others" while no
// queue existed: every retry was a fresh race that pushed the provider's window
// out again and spent another unit of the person's hourly allowance, and the page
// called it "Generation limit reached". Nobody had a place, nobody had a real
// wait, and the last person waited about 19 x 45 s with no fairness at all.
//
// What it does. When the reference rung is saturated (a provider stated a wait,
// or people are already waiting) a text request gets a place instead of a race:
//   - one place per identity (a signed-in account, else the browser, else the
//     IP), so one person can never hold several;
//   - the head of the line is the only request allowed to try the rung, behind a
//     fleet-wide lock, and only once the provider's stated wait has passed;
//   - the wait estimate is built from measured numbers: the provider's stated
//     wait and the median gap between recent serves;
//   - a place lasts while its holder checks in (GET /api/forge?line=1), so an
//     abandoned tab frees its place on its own;
//   - past a defined depth the line is full, and the answer says so and when to
//     come back, instead of pretending to queue a wait nobody would sit through.
// When nothing is saturated the line is inactive and costs one read per request.
//
// Storage. Shared state lives in Upstash Redis so every instance sees one line.
// When Redis is absent or erroring the line runs per instance in memory: it
// fails open (people still generate) but stays bounded (the same depth cap and
// one attempt at a time per instance), never an unbounded free-for-all.

import { getRedis } from './redis.js';

const redis = getRedis();

function intEnv(name, fallback) {
	const v = typeof process !== 'undefined' ? process.env?.[name] : null;
	const n = v == null || v === '' ? NaN : Number(v);
	return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

export const LINE_LIMITS = Object.freeze({
	// Places before the line is full. 20 x the 45 s keyless-rung interval is a
	// 15 minute wait, the longest we ask anyone to sit through.
	maxDepth: intEnv('FORGE_LINE_MAX_DEPTH', 20),
	// A waiting place survives this long past its last check-in. The page checks
	// in at most every maxCheckS seconds, so three missed check-ins free it.
	holdMs: intEnv('FORGE_LINE_HOLD_MS', 45_000),
	// The head's hold on the rung while its image step runs: the director pass
	// plus the 60 s ladder budget, with slack. Released explicitly on every exit;
	// this expiry only matters for an instance that died mid-request.
	servingMs: 150_000,
	// The wait assumed per place before any serve has been measured: the stated
	// interval of the keyless rung, the slowest rung that serves.
	fallbackIntervalMs: 45_000,
	// The longest the page waits between check-ins.
	maxCheckS: 15,
	// How long a provider's stated wait keeps pacing the line after it was said.
	statedWaitTtlMs: 10 * 60_000,
	// Serve timestamps kept for the measured interval, and how far back they count.
	servedSamples: 12,
	servedWindowMs: 30 * 60_000,
	// A queued person whose throttled attempt already spent an allowance unit is
	// not charged again on their turn, if it comes within this window.
	prepaidTtlMs: 20 * 60_000,
});

// The line in front of the reference-image ladder.
export const REFERENCE_LINE = 'reference';

const PREFIX = 'fc:line:';
const KEY_TTL_S = 3600;

// ── Stores ──────────────────────────────────────────────────────────────────
// Both stores expose the same small async surface so the line logic is written
// once. The memory store is per instance and is what the line falls back to.

function memoryStore() {
	const lines = new Map();
	const at = (name) => {
		let l = lines.get(name);
		if (!l) {
			l = { q: new Map(), exp: new Map(), until: 0, lock: null, stated: null, served: [], paid: new Map() };
			lines.set(name, l);
		}
		return l;
	};
	const ordered = (l) => [...l.q.entries()].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
	return {
		kind: 'memory',
		async prune(name, now) {
			const l = at(name);
			for (const [id, exp] of l.exp) {
				if (exp < now) {
					l.exp.delete(id);
					l.q.delete(id);
				}
			}
			if (l.lock && l.lock.until < now) l.lock = null;
		},
		async place(name, id) {
			const l = at(name);
			if (!l.q.has(id)) return null;
			return { rank: ordered(l).findIndex(([m]) => m === id), depth: l.q.size };
		},
		async depth(name) {
			return at(name).q.size;
		},
		async join(name, id, joinedAt, expiresAt) {
			const l = at(name);
			if (!l.q.has(id)) l.q.set(id, joinedAt);
			l.exp.set(id, expiresAt);
		},
		async touch(name, id, expiresAt) {
			const l = at(name);
			if (l.q.has(id)) l.exp.set(id, expiresAt);
		},
		async remove(name, id) {
			const l = at(name);
			l.q.delete(id);
			l.exp.delete(id);
		},
		async getUntil(name) {
			return at(name).until;
		},
		async raiseUntil(name, ms) {
			const l = at(name);
			l.until = Math.max(l.until, ms);
		},
		async clearUntil(name) {
			at(name).until = 0;
		},
		async lock(name, id, ms, now) {
			const l = at(name);
			if (l.lock && l.lock.until >= now) return false;
			l.lock = { id, until: now + ms };
			return true;
		},
		async lockHolder(name, now) {
			const l = at(name);
			return l.lock && l.lock.until >= now ? l.lock.id : null;
		},
		async unlock(name, id) {
			const l = at(name);
			if (l.lock?.id === id) l.lock = null;
		},
		async setStatedWait(name, ms, now) {
			at(name).stated = { ms, until: now + LINE_LIMITS.statedWaitTtlMs };
		},
		async getStatedWait(name, now) {
			const s = at(name).stated;
			return s && s.until >= now ? s.ms : null;
		},
		async pushServed(name, ts) {
			const l = at(name);
			l.served.unshift(ts);
			l.served.length = Math.min(l.served.length, LINE_LIMITS.servedSamples);
		},
		async served(name) {
			return [...at(name).served];
		},
		async markPrepaid(name, id, now) {
			at(name).paid.set(id, now + LINE_LIMITS.prepaidTtlMs);
		},
		async takePrepaid(name, id, now) {
			const l = at(name);
			const exp = l.paid.get(id);
			l.paid.delete(id);
			return exp != null && exp >= now;
		},
	};
}

function redisStore(r) {
	const k = (name, part) => `${PREFIX}${name}:${part}`;
	const keep = (key) => r.expire(key, KEY_TTL_S);
	return {
		kind: 'redis',
		async prune(name, now) {
			const stale = await r.zrange(k(name, 'exp'), 0, now - 1, { byScore: true });
			if (Array.isArray(stale) && stale.length) {
				await r.zrem(k(name, 'q'), ...stale);
				await r.zrem(k(name, 'exp'), ...stale);
			}
		},
		async place(name, id) {
			const rank = await r.zrank(k(name, 'q'), id);
			if (rank == null) return null;
			return { rank: Number(rank), depth: Number(await r.zcard(k(name, 'q'))) || 0 };
		},
		async depth(name) {
			return Number(await r.zcard(k(name, 'q'))) || 0;
		},
		async join(name, id, joinedAt, expiresAt) {
			await r.zadd(k(name, 'q'), { nx: true }, { score: joinedAt, member: id });
			await r.zadd(k(name, 'exp'), { score: expiresAt, member: id });
			await keep(k(name, 'q'));
			await keep(k(name, 'exp'));
		},
		async touch(name, id, expiresAt) {
			if ((await r.zscore(k(name, 'q'), id)) == null) return;
			await r.zadd(k(name, 'exp'), { score: expiresAt, member: id });
		},
		async remove(name, id) {
			await r.zrem(k(name, 'q'), id);
			await r.zrem(k(name, 'exp'), id);
		},
		async getUntil(name) {
			return Number(await r.get(k(name, 'until'))) || 0;
		},
		async raiseUntil(name, ms) {
			const current = Number(await r.get(k(name, 'until'))) || 0;
			if (ms <= current) return;
			await r.set(k(name, 'until'), String(ms), { px: Math.max(1000, ms - Date.now() + 60_000) });
		},
		async clearUntil(name) {
			await r.del(k(name, 'until'));
		},
		async lock(name, id, ms) {
			return (await r.set(k(name, 'serving'), id, { nx: true, px: ms })) === 'OK';
		},
		async lockHolder(name) {
			const v = await r.get(k(name, 'serving'));
			return v == null ? null : String(v);
		},
		async unlock(name, id) {
			const v = await r.get(k(name, 'serving'));
			if (v != null && String(v) === id) await r.del(k(name, 'serving'));
		},
		async setStatedWait(name, ms) {
			await r.set(k(name, 'wait'), String(ms), { px: LINE_LIMITS.statedWaitTtlMs });
		},
		async getStatedWait(name) {
			const v = await r.get(k(name, 'wait'));
			const n = Number(v);
			return v == null || !Number.isFinite(n) ? null : n;
		},
		async pushServed(name, ts) {
			await r.lpush(k(name, 'served'), String(ts));
			await r.ltrim(k(name, 'served'), 0, LINE_LIMITS.servedSamples - 1);
			await keep(k(name, 'served'));
		},
		async served(name) {
			const list = await r.lrange(k(name, 'served'), 0, -1);
			return (Array.isArray(list) ? list : []).map(Number).filter(Number.isFinite);
		},
		async markPrepaid(name, id) {
			await r.set(k(name, `paid:${id}`), '1', { px: LINE_LIMITS.prepaidTtlMs });
		},
		async takePrepaid(name, id) {
			return Number(await r.del(k(name, `paid:${id}`))) > 0;
		},
	};
}

const memory = memoryStore();
const shared = redis ? redisStore(redis) : null;
let warnedFallback = false;

// Run `fn` against the shared store, or the per-instance store when Redis is
// absent or a command fails mid-way. A failure re-runs the whole step on memory
// so a half-applied Redis step never leaves the caller without an answer.
async function withStore(fn) {
	if (shared) {
		try {
			return await fn(shared);
		} catch (err) {
			if (!warnedFallback) {
				warnedFallback = true;
				console.warn(`[forge-line] shared store unavailable, line runs per instance: ${err?.message || err}`);
			}
		}
	}
	return fn(memory);
}

// ── Measurement ─────────────────────────────────────────────────────────────

function median(values) {
	if (!values.length) return null;
	const s = [...values].sort((a, b) => a - b);
	const mid = Math.floor(s.length / 2);
	return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

// The interval between serves the line is moving at, in ms. The median gap
// between recent serves when at least two are on record; otherwise the wait the
// provider last stated; otherwise the keyless rung's published interval.
export function lineServiceIntervalMs({ served = [], statedWaitMs = null, now = Date.now(), limits = LINE_LIMITS }) {
	const recent = served.filter((t) => now - t <= limits.servedWindowMs).sort((a, b) => b - a);
	const gaps = [];
	for (let i = 0; i + 1 < recent.length; i++) {
		const gap = recent[i] - recent[i + 1];
		if (gap >= 1000 && gap <= 15 * 60_000) gaps.push(gap);
	}
	const measured = median(gaps);
	if (measured != null) return Math.max(measured, statedWaitMs || 0);
	if (statedWaitMs && statedWaitMs > 0) return statedWaitMs;
	return limits.fallbackIntervalMs;
}

// Seconds until the person at 1-based `position` reaches the rung: whatever is
// left of the provider's stated wait, plus one interval per person ahead.
export function lineWaitSeconds({ position, intervalMs, saturatedUntil = 0, now = Date.now() }) {
	const left = Math.max(0, saturatedUntil - now);
	return Math.max(1, Math.ceil((left + Math.max(0, position - 1) * intervalMs) / 1000));
}

async function intervalFor(s, name, now, limits) {
	const [served, statedWaitMs] = await Promise.all([s.served(name), s.getStatedWait(name, now)]);
	return lineServiceIntervalMs({ served, statedWaitMs, now, limits });
}

function queuedDecision({ rank, depth, intervalMs, until, now, limits }) {
	const position = rank + 1;
	const etaSeconds = lineWaitSeconds({ position, intervalMs, saturatedUntil: until, now });
	return {
		action: 'queued',
		position,
		ahead: rank,
		depth,
		maxDepth: limits.maxDepth,
		etaSeconds,
		intervalSeconds: Math.round(intervalMs / 1000),
		checkAgainSeconds: Math.max(1, Math.min(limits.maxCheckS, etaSeconds)),
	};
}

function fullDecision({ depth, intervalMs, until, now, limits }) {
	// The first place opens when the person at maxDepth is served: everyone from
	// there to the back has to move up by one before a newcomer fits.
	const over = Math.max(1, depth - limits.maxDepth + 1);
	const retryAfter = Math.max(1, Math.ceil((Math.max(0, until - now) + over * intervalMs) / 1000));
	return { action: 'full', depth, maxDepth: limits.maxDepth, retryAfterSeconds: retryAfter, intervalSeconds: Math.round(intervalMs / 1000) };
}

// ── The line ────────────────────────────────────────────────────────────────

// Is anyone waiting, or has a provider stated a wait that has not passed?
export async function lineSnapshot(name, { now = Date.now() } = {}) {
	return withStore(async (s) => {
		await s.prune(name, now);
		const [depth, until] = await Promise.all([s.depth(name), s.getUntil(name)]);
		return { depth, saturatedUntil: until, active: depth > 0 || until > now };
	});
}

// Decide what a request from `identity` does now:
//   { action: 'proceed', inLine, prepaid }  run the reference step. inLine means
//       it holds the head place and the rung lock and must call lineServed,
//       lineThrottled or lineLeave when done. prepaid means its last throttled
//       attempt already spent an allowance unit, so this turn is not charged.
//   { action: 'queued', position, ahead, depth, etaSeconds, checkAgainSeconds }
//   { action: 'full', retryAfterSeconds }
export async function admitToLine(name, identity, { now = Date.now(), limits = LINE_LIMITS } = {}) {
	return withStore(async (s) => {
		await s.prune(name, now);
		const [depth, until] = await Promise.all([s.depth(name), s.getUntil(name)]);
		let place = await s.place(name, identity);
		if (!place && depth === 0 && until <= now) return { action: 'proceed', inLine: false, prepaid: false };

		if (!place) {
			if (depth >= limits.maxDepth) {
				return fullDecision({ depth, intervalMs: await intervalFor(s, name, now, limits), until, now, limits });
			}
			await s.join(name, identity, now, now + limits.holdMs);
			place = await s.place(name, identity);
			// Simultaneous arrivals can all pass the depth check before any joins;
			// whoever lands past the cap gives the place back.
			if (!place || place.rank >= limits.maxDepth) {
				await s.remove(name, identity);
				const after = await s.depth(name);
				return fullDecision({ depth: after, intervalMs: await intervalFor(s, name, now, limits), until, now, limits });
			}
		} else {
			await s.touch(name, identity, now + limits.holdMs);
		}

		if (place.rank === 0 && until <= now && (await s.lock(name, identity, limits.servingMs, now))) {
			await s.touch(name, identity, now + limits.servingMs);
			return { action: 'proceed', inLine: true, prepaid: await s.takePrepaid(name, identity, now) };
		}
		return queuedDecision({ ...place, intervalMs: await intervalFor(s, name, now, limits), until, now, limits });
	});
}

// The reference step for `identity` was refused by a provider that stated a
// wait. Believe it: nobody tries the rung again before then, and this request
// keeps (or takes) its place in arrival order instead of racing the retry.
export async function lineThrottled(
	name,
	identity,
	{ retryAfterSeconds, joinedAt, now = Date.now(), limits = LINE_LIMITS } = {},
) {
	const waitMs = Math.max(1, Number(retryAfterSeconds) || 0) * 1000;
	return withStore(async (s) => {
		await s.prune(name, now);
		await s.raiseUntil(name, now + waitMs);
		await s.setStatedWait(name, waitMs, now);
		await s.unlock(name, identity);
		let place = await s.place(name, identity);
		if (!place) {
			const depth = await s.depth(name);
			const until = await s.getUntil(name);
			if (depth >= limits.maxDepth) {
				return fullDecision({ depth, intervalMs: await intervalFor(s, name, now, limits), until, now, limits });
			}
			await s.join(name, identity, Number.isFinite(joinedAt) ? joinedAt : now, now + limits.holdMs);
			place = await s.place(name, identity);
		} else {
			await s.touch(name, identity, now + limits.holdMs);
		}
		await s.markPrepaid(name, identity, now);
		const until = await s.getUntil(name);
		return queuedDecision({ ...place, intervalMs: await intervalFor(s, name, now, limits), until, now, limits });
	});
}

// The reference step for `identity` succeeded. Its place is done, the serve is
// recorded for the measured interval, and the next person is paced by the wait
// the provider last stated (a rung that refuses inside its window restarts it).
export async function lineServed(name, identity, { now = Date.now() } = {}) {
	return withStore(async (s) => {
		await s.remove(name, identity);
		await s.unlock(name, identity);
		await s.pushServed(name, now);
		if ((await s.depth(name)) === 0) {
			await s.clearUntil(name);
			return;
		}
		const stated = await s.getStatedWait(name, now);
		if (stated) await s.raiseUntil(name, now + stated);
	});
}

// `identity` gives up its place (left the page, or its request ended another way).
export async function lineLeave(name, identity) {
	return withStore(async (s) => {
		await s.remove(name, identity);
		await s.unlock(name, identity);
	});
}

// A check-in from someone waiting: refreshes their place and says where they are.
export async function lineStatus(name, identity, { now = Date.now(), limits = LINE_LIMITS } = {}) {
	return withStore(async (s) => {
		await s.prune(name, now);
		const place = await s.place(name, identity);
		const until = await s.getUntil(name);
		if (!place) {
			const depth = await s.depth(name);
			return { inLine: false, depth, active: depth > 0 || until > now };
		}
		await s.touch(name, identity, now + limits.holdMs);
		const holder = await s.lockHolder(name, now);
		const q = queuedDecision({ ...place, intervalMs: await intervalFor(s, name, now, limits), until, now, limits });
		const yourTurn = place.rank === 0 && until <= now && (holder == null || holder === identity);
		return { inLine: true, ...q, yourTurn, checkAgainSeconds: yourTurn ? 0 : q.checkAgainSeconds };
	});
}

// ── HTTP answers ────────────────────────────────────────────────────────────

const LINE_URL = '/api/forge?line=1';

function minutesText(seconds) {
	if (seconds < 60) return `about ${Math.max(5, Math.round(seconds / 5) * 5)} seconds`;
	const m = Math.round(seconds / 60);
	return m <= 1 ? 'about a minute' : `about ${m} minutes`;
}

// The status, headers and body a line decision is answered with. Queued is a
// 429 (non-2xx so no client or idempotency layer treats it as a finished
// generation) whose `error` says what is really going on; full is a 503.
export function lineAnswer(decision) {
	if (decision.action === 'full') {
		return {
			status: 503,
			headers: { 'retry-after': String(decision.retryAfterSeconds) },
			body: {
				error: 'forge_full',
				queued: false,
				depth: decision.depth,
				max_depth: decision.maxDepth,
				retry_after: decision.retryAfterSeconds,
				message: `Forge is full right now: ${decision.depth} people are already waiting for the image step. Come back in ${minutesText(decision.retryAfterSeconds)}.`,
			},
		};
	}
	return {
		status: 429,
		headers: { 'retry-after': String(decision.checkAgainSeconds) },
		body: {
			error: 'forge_queued',
			queued: true,
			position: decision.position,
			ahead: decision.ahead,
			depth: decision.depth,
			eta_seconds: decision.etaSeconds,
			interval_seconds: decision.intervalSeconds,
			retry_after: decision.checkAgainSeconds,
			check_again_seconds: decision.checkAgainSeconds,
			line_url: LINE_URL,
			message:
				decision.position === 1
					? `You're next. Your generation starts in ${minutesText(decision.etaSeconds)}.`
					: `You're number ${decision.position} in line. Your generation starts in ${minutesText(decision.etaSeconds)}.`,
		},
	};
}

// The check-in answer: always 200, so a poller can tell "still waiting" from a
// broken request.
export function lineStatusBody(status) {
	if (!status.inLine) return { in_line: false, your_turn: false, depth: status.depth, active: status.active };
	return {
		in_line: true,
		your_turn: status.yourTurn,
		position: status.position,
		ahead: status.ahead,
		depth: status.depth,
		eta_seconds: status.yourTurn ? 0 : status.etaSeconds,
		interval_seconds: status.intervalSeconds,
		check_again_seconds: status.checkAgainSeconds,
	};
}

// The answer a background job gets while people are waiting: it yields.
export function lineYieldAnswer(snapshot, { now = Date.now() } = {}) {
	const retryAfter = Math.max(30, Math.ceil(Math.max(0, snapshot.saturatedUntil - now) / 1000));
	return {
		status: 503,
		headers: { 'retry-after': String(retryAfter) },
		body: {
			error: 'forge_yielding',
			retry_after: retryAfter,
			message: 'People are waiting for the image step, so background generation is paused until the line clears.',
		},
	};
}

// ── Wiring helpers for the submit handler ───────────────────────────────────
// Kept here so api/forge.js and api/gpt-forge.js carry one call per step instead
// of the line's rules.

// Who holds a place. A signed-in account first, so one person is one place on
// every network and device; then a platform job acting for an outside person;
// then the browser's forge client id; then the network.
export function lineIdentityFor({ accountId = null, onBehalf = null, clientKey = null, ipHash = null } = {}) {
	if (accountId) return `user:${accountId}`;
	const behalf = Array.isArray(onBehalf) ? onBehalf[0] : onBehalf;
	if (behalf) return `behalf:${String(behalf).slice(0, 200)}`;
	if (clientKey) return `client:${clientKey}`;
	return `ip:${ipHash || 'unknown'}`;
}

// Whether a request will paint its reference image on the shared text-to-image
// ladder, the one step the line meters. Image-to-3D brings its own view; sketch,
// native text-to-geometry, BYOK engines and the NIM draft lane never touch it.
export function needsReferenceRung({ isImageMode, path, backendId, byok = false }) {
	return !isImageMode && path !== 'sketch' && path !== 'geometry' && backendId !== 'nvidia' && !byok;
}

// Who may share an identical in-flight generation. A public model can be handed
// to anyone who asks for the same thing; anything else is shared only with the
// same person, so a private or unlisted result never reaches a stranger.
export function coalesceOwnerFor({ visibility = null, showcase = false, identity }) {
	return showcase || visibility === 'public' ? 'public' : identity;
}

// The gate a text request passes before it spends an allowance unit. Returns
// { proceed: true, inLine, prepaid } or { answer: { status, headers, body } }.
// A background (showcase) job never joins: it yields while anyone is waiting.
export async function gateReferenceRung(identity, { platformJob = false, now = Date.now() } = {}) {
	if (platformJob) {
		const snap = await lineSnapshot(REFERENCE_LINE, { now });
		return snap.active ? { answer: lineYieldAnswer(snap, { now }) } : { proceed: true, inLine: false, prepaid: false };
	}
	const d = await admitToLine(REFERENCE_LINE, identity, { now });
	if (d.action === 'proceed') return { proceed: true, inLine: d.inLine, prepaid: Boolean(d.prepaid) };
	return { answer: lineAnswer(d) };
}

// The reference step finished for a request (`line` is the handler's per-request
// record). Frees the head place and records the serve the wait estimate is built
// from. Later throttles in the same request (a reconstructor's own 429) are not
// the line's to answer.
export async function referenceServed(line) {
	line.served = true;
	if (line.inLine) {
		line.inLine = false;
		await lineServed(REFERENCE_LINE, line.identity);
	}
}

// The reference rung refused this request with a stated wait. Keeps (or takes)
// the person's place, marks the turn as paid, and returns the answer to send.
export async function referenceThrottled(line, retryAfterSeconds) {
	const decision = await lineThrottled(REFERENCE_LINE, line.identity, {
		retryAfterSeconds,
		joinedAt: line.arrivedAt,
	});
	line.inLine = false;
	return lineAnswer(decision);
}

// The request ended without reaching the rung (refused earlier, or an error
// before the reference step) while holding the head place: give it up so the
// next person is not held behind a request that is gone.
export async function releaseLinePlace(line) {
	if (line.inLine && !line.served) {
		line.inLine = false;
		await lineLeave(REFERENCE_LINE, line.identity);
	}
}

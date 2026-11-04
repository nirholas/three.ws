// World chat scrollback: a capped, expiring tail of in-world chat per world.
//
// In-world chat is a relay (WalkRoom._handleChat broadcasts and forgets), so a
// player who joins an event late used to land in an empty log with no sign
// anything was happening. The room now appends every relayed line here and
// hands each arrival the tail in ONE batched `chat_history` message.
//
// Values (owner-visible, change here only):
//   SCROLLBACK_CAP   200 lines per world. Trimmed on every write.
//   SCROLLBACK_TTL_S 3 days. The Redis key expires 3 days after the last line,
//                    and any line older than 3 days is dropped on read even in a
//                    busy world, so nothing outlives the window.
//   JOIN_TAIL        60 lines sent on join (about 10 KB), enough to read the
//                    room's mood without stalling a phone on a slow link.
//
// Privacy: a stored line is { mid, name, text, ts } and nothing else. No session
// id, account id, wallet address or IP is kept; a display name that is itself a
// wallet address is shortened. Lines must already have passed the slur gate,
// and the module re-checks it so no caller can store one by mistake. A trimmed
// or expired line is gone for good: this is not an archive.
//
// Storage: the same Upstash env the activity feed uses (multiplayer/src/feed.js:
// UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN). Every call is best-effort:
// Redis unreachable means no history, never a thrown error in a room handler.
// Without Redis the server runs with an in-process memory store, which keeps
// scrollback per server instance (exactly how social-hub degrades locally).

import { randomBytes } from 'node:crypto';
import { containsHateSlur } from './display-name-safety.js';

export const SCROLLBACK_CAP = 200;
export const SCROLLBACK_TTL_S = 3 * 24 * 60 * 60;
export const JOIN_TAIL = 60;

const KEY_PREFIX = 'chat:scrollback:';
const MAX_TEXT = 200;
const MAX_NAME = 24;

const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** The Redis key for one world. General and Holders worlds are separate. */
export function scrollbackKey(worldKey) {
	const k = typeof worldKey === 'string' && worldKey.trim() ? worldKey.trim() : 'mainland';
	return KEY_PREFIX + k;
}

function newMid(ts) {
	return `${ts.toString(36)}-${randomBytes(5).toString('hex')}`;
}

function safeName(name) {
	const n = String(name ?? '').trim().slice(0, 64);
	if (SOLANA_ADDRESS.test(n)) return `${n.slice(0, 4)}…${n.slice(-4)}`;
	if (EVM_ADDRESS.test(n)) return `${n.slice(0, 6)}…${n.slice(-4)}`;
	return n.slice(0, MAX_NAME) || 'Guest';
}

/**
 * Reduce a relayed chat line to what may be stored. Returns null when the line
 * must not be kept (empty, non-string, or caught by the slur gate).
 * @param {{name?: string, text?: unknown, mid?: string, ts?: number}} input
 * @param {{now?: () => number}} [opts]
 */
export function toScrollbackRecord(input, { now = Date.now } = {}) {
	if (typeof input?.text !== 'string') return null;
	const text = input.text.trim().slice(0, MAX_TEXT);
	if (!text || containsHateSlur(text)) return null;
	const ts = Number.isFinite(input.ts) ? input.ts : now();
	const mid = typeof input.mid === 'string' && /^[a-z0-9-]{8,40}$/.test(input.mid) ? input.mid : newMid(ts);
	return { mid, name: safeName(input.name), text, ts };
}

function parseRecord(raw) {
	const r = typeof raw === 'string' ? safeJson(raw) : raw;
	if (!r || typeof r !== 'object') return null;
	if (typeof r.mid !== 'string' || typeof r.text !== 'string' || !Number.isFinite(r.ts)) return null;
	return { mid: r.mid, name: typeof r.name === 'string' ? r.name : 'Guest', text: r.text, ts: r.ts };
}

function safeJson(s) {
	try { return JSON.parse(s); } catch { return null; }
}

/**
 * In-process store with the same newest-first list semantics as the Redis one.
 * Used for local runs without Upstash and for the unit tests.
 * @param {{now?: () => number}} [opts]
 */
export function createMemoryStore({ now = Date.now } = {}) {
	const lists = new Map(); // key -> { items: string[] newest first, expiresAt }
	const live = (key) => {
		const entry = lists.get(key);
		if (!entry) return null;
		if (entry.expiresAt <= now()) { lists.delete(key); return null; }
		return entry;
	};
	return {
		async push(key, record, { cap, ttlS }) {
			const entry = live(key) || { items: [], expiresAt: 0 };
			if (entry.items.some((s) => parseRecord(s)?.mid === record.mid)) return;
			entry.items.unshift(JSON.stringify(record));
			entry.items.length = Math.min(entry.items.length, cap);
			entry.expiresAt = now() + ttlS * 1000;
			lists.set(key, entry);
		},
		async range(key, count) {
			const entry = live(key);
			return entry ? entry.items.slice(0, count).map(parseRecord).filter(Boolean) : [];
		},
		/** Everything the store holds, serialised. Tests use it to prove a trim is final. */
		dump() {
			return JSON.stringify([...lists.entries()]);
		},
	};
}

/**
 * Upstash-backed store. LPUSH + LTRIM + EXPIRE run as one pipeline so a write
 * can never leave the list over the cap.
 * @param {import('@upstash/redis').Redis} redis
 */
export function createRedisStore(redis) {
	return {
		async push(key, record, { cap, ttlS }) {
			const p = redis.pipeline();
			p.lpush(key, JSON.stringify(record));
			p.ltrim(key, 0, cap - 1);
			p.expire(key, ttlS);
			await p.exec();
		},
		async range(key, count) {
			const rows = await redis.lrange(key, 0, count - 1);
			return (rows || []).map(parseRecord).filter(Boolean);
		},
	};
}

export class ChatScrollback {
	/**
	 * @param {{store: ReturnType<typeof createMemoryStore> | null, now?: () => number,
	 *   cap?: number, ttlS?: number, tail?: number, log?: {warn: Function}}} opts
	 */
	constructor({ store, now = Date.now, cap = SCROLLBACK_CAP, ttlS = SCROLLBACK_TTL_S, tail = JOIN_TAIL, log = console } = {}) {
		this.store = store || null;
		this.now = now;
		this.cap = cap;
		this.ttlS = ttlS;
		this.tailSize = Math.min(tail, cap);
		this.log = log;
	}

	/**
	 * Store one relayed line. Resolves with the stored record (callers broadcast
	 * its `mid` so clients can dedupe), or null when the line may not be kept.
	 * The record is returned even when the store write fails: the live relay
	 * must not depend on history.
	 */
	async append(key, input) {
		const record = toScrollbackRecord(input, { now: this.now });
		if (!record || !this.store) return record;
		try {
			await this.store.push(key, record, { cap: this.cap, ttlS: this.ttlS });
		} catch (err) {
			this.log?.warn?.('[chat-scrollback] write failed:', err?.message || err);
		}
		return record;
	}

	/** The join tail, oldest first, deduped by id, with expired lines dropped. */
	async tail(key) {
		if (!this.store) return [];
		let rows;
		try {
			rows = await this.store.range(key, this.tailSize);
		} catch (err) {
			this.log?.warn?.('[chat-scrollback] read failed:', err?.message || err);
			return [];
		}
		const oldest = this.now() - this.ttlS * 1000;
		const seen = new Set();
		const out = [];
		for (const r of rows) {
			if (r.ts < oldest || seen.has(r.mid)) continue;
			seen.add(r.mid);
			out.push(r);
		}
		return out.reverse();
	}
}

let _shared = null;

/** The process-wide scrollback: Upstash when configured and reachable, memory otherwise. */
export function chatScrollback() {
	if (_shared) return _shared;
	const url = process.env.UPSTASH_REDIS_REST_URL || '';
	const token = process.env.UPSTASH_REDIS_REST_TOKEN || '';
	const memory = createMemoryStore();
	_shared = new ChatScrollback({ store: memory });
	if (url && token) {
		import('@upstash/redis')
			.then(async ({ Redis }) => {
				const redis = new Redis({ url, token });
				await redis.ping();
				_shared.store = createRedisStore(redis);
				console.log('[chat-scrollback] world chat scrollback: Upstash Redis (verified)');
			})
			.catch((err) => {
				console.warn('[chat-scrollback] Redis unreachable, scrollback is per instance:', err?.message);
			});
	} else {
		console.log('[chat-scrollback] world chat scrollback: in-process memory (no UPSTASH_REDIS_REST_URL/_TOKEN)');
	}
	return _shared;
}

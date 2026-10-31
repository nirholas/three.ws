// Signature wall store: the persistent, append-only list behind the $THREE
// world's signature wall near spawn (docs/signature-wall.md).
//
// Store choice: Upstash Redis (the same layer as api/_lib/builds-store.js), not
// Postgres. The data is an append-only list of tiny records read by rank and by
// cursor, never joined to anything, and written at event bursts; a sorted set
// does exactly that in O(log n) with no schema, no migration against the shared
// Neon DB and no connection-pool pressure. Persistence is the Upstash database
// itself (no TTL is ever set on a signature), so the wall outlives the event.
//
// Layout (all keys under `sigwall:v1:`):
//   idx            sorted set  member = id, score = no (monotonic signature number)
//   sigs           hash        id -> JSON { id, no, n, l, t, v }   (RENDERED record:
//                                display text only, never a wallet address)
//   seq            counter     source of `no`
//   claim:wallet   hash        wallet -> id   (a signed-in wallet signs once, ever)
//   claim:guest:<session>  string  id with a 7 day TTL (a guest signs once per session)
//
// A claim is taken atomically BEFORE the record is written (HSETNX / SET NX), so
// two concurrent POSTs from one wallet cannot both land.

import { getRedis } from './redis.js';
import { containsHateSlur } from './display-name-safety.js';

const P = 'sigwall:v1:';
export const KEY = {
	idx: `${P}idx`,
	sigs: `${P}sigs`,
	seq: `${P}seq`,
	wallets: `${P}claim:wallet`,
	guest: (session) => `${P}claim:guest:${session}`,
};

export const NAME_MAX = 24;
export const LINE_MAX = 80;
const GUEST_CLAIM_TTL_S = 7 * 24 * 3600;
export const MAX_PAGE = 200;

/** Thrown for any refusal the client should show; `code` is stable for routing. */
export class WallError extends Error {
	constructor(code, message, extra = {}) {
		super(message);
		this.name = 'WallError';
		this.code = code;
		this.extra = extra;
	}
}

// Characters that are never legitimate in a signature: C0/C1 controls, zero-width
// and bidi overrides (they reorder or hide text), the BOM and line/paragraph
// separators. Removed rather than rejected so a stray paste still signs.
// eslint-disable-next-line no-control-regex
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g;

/**
 * Normalize untrusted display text: NFC, drop invisible/control characters,
 * collapse whitespace, cap by code points. The result is still untrusted and is
 * only ever drawn with canvas fillText / satori text nodes, never as HTML.
 */
export function cleanText(input, max) {
	if (typeof input !== 'string') return '';
	const s = input.normalize('NFC').replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim();
	return Array.from(s).slice(0, max).join('').trim();
}

// Links and contract addresses are advertising, not signatures. The wall is the
// community's artifact; it must not become a billboard for scam CAs.
const URLISH = /(?:https?:\/\/|www\.|\b[a-z0-9-]+\.(?:com|io|xyz|app|net|org|fun|gg|ly|me|co|sol)\b)/i;
const ADDRESSISH = /(?:\b0x[0-9a-fA-F]{20,}\b|\b[1-9A-HJ-NP-Za-km-z]{32,44}\b)/;

/**
 * Validate and normalize a submission. Returns { name, line } or throws WallError.
 * Runs the same hate-slur gate the in-world chat uses (display-name-safety.js).
 */
export function validateSignature({ name, line }) {
	const n = cleanText(name, NAME_MAX);
	const l = cleanText(line ?? '', LINE_MAX);
	if (!n) throw new WallError('name_required', 'Add a name to sign the wall.');
	if (URLISH.test(n) || URLISH.test(l) || ADDRESSISH.test(n) || ADDRESSISH.test(l)) {
		throw new WallError('no_links', 'Links and addresses cannot go on the wall. Keep it to a name and a few words.');
	}
	if (containsHateSlur(n) || containsHateSlur(l) || containsHateSlur(`${n} ${l}`)) {
		throw new WallError('not_allowed', 'That text is not allowed on the wall.');
	}
	return { name: n, line: l };
}

function redis() {
	const r = getRedis();
	if (!r) throw new WallError('unavailable', 'The wall is resting. Try again in a moment.');
	return r;
}

function parse(v) {
	if (v == null) return null;
	if (typeof v !== 'string') return v; // Upstash auto-parses JSON values
	try { return JSON.parse(v); } catch { return null; }
}

function publicRecord(rec) {
	return { id: rec.id, no: rec.no, name: rec.n, line: rec.l, ts: rec.t, verified: !!rec.v };
}

/** Total live signatures. */
export async function countSignatures() {
	return Number(await redis().zcard(KEY.idx)) || 0;
}

async function hydrate(r, ids) {
	if (!ids.length) return [];
	const got = await r.hmget(KEY.sigs, ...ids);
	const byId = Array.isArray(got) ? Object.fromEntries(ids.map((id, i) => [id, got[i]])) : (got || {});
	const out = [];
	for (const id of ids) {
		const rec = parse(byId[id]);
		if (rec?.id) out.push(publicRecord(rec));
	}
	return out;
}

/**
 * Newest-first page by rank. `offset` 0 is the newest signature. Random access, so
 * the wall can cycle any page of a 5,000 signature wall without loading the rest.
 */
export async function listByOffset(offset = 0, limit = 60) {
	const r = redis();
	const start = Math.max(0, Math.floor(offset));
	const size = Math.min(MAX_PAGE, Math.max(1, Math.floor(limit)));
	const ids = await r.zrange(KEY.idx, start, start + size - 1, { rev: true });
	return hydrate(r, ids.map(String));
}

/** Signatures with `no` greater than `since`, oldest first (live catch-up). */
export async function listSince(since, limit = MAX_PAGE) {
	const r = redis();
	const size = Math.min(MAX_PAGE, Math.max(1, Math.floor(limit)));
	const ids = await r.zrange(KEY.idx, `(${Math.floor(since)}`, '+inf', { byScore: true, offset: 0, count: size });
	return hydrate(r, ids.map(String));
}

/** One signature by id (public record), or null. */
export async function getSignature(id) {
	const rec = parse(await redis().hget(KEY.sigs, id));
	return rec?.id ? publicRecord(rec) : null;
}

/**
 * Append a signature. `identity` is { wallet } for a signed-in player or
 * { session } for a guest. Throws WallError('already_signed') when the identity
 * has signed (with the existing signature attached when it is still on the wall).
 */
export async function addSignature({ name, line }, identity, now = Date.now()) {
	const r = redis();
	const id = (globalThis.crypto?.randomUUID?.() || `s${now.toString(36)}${Math.random().toString(36).slice(2, 10)}`).replace(/-/g, '').slice(0, 20);

	let release;
	let claimedExisting = null;
	if (identity.wallet) {
		const won = Number(await r.hsetnx(KEY.wallets, identity.wallet, id)) === 1;
		if (!won) claimedExisting = String(await r.hget(KEY.wallets, identity.wallet));
		release = () => r.hdel(KEY.wallets, identity.wallet);
	} else {
		const key = KEY.guest(identity.session);
		const res = await r.set(key, id, { nx: true, ex: GUEST_CLAIM_TTL_S });
		if (res == null) claimedExisting = String(await r.get(key));
		release = () => r.del(key);
	}
	if (claimedExisting) {
		const existing = await getSignature(claimedExisting).catch(() => null);
		throw new WallError('already_signed', identity.wallet
			? 'This wallet has already signed the wall. One signature per wallet, forever.'
			: 'You already signed the wall this session.', { existing });
	}

	try {
		const no = Number(await r.incr(KEY.seq));
		const rec = { id, no, n: name, l: line, t: now, v: identity.wallet ? 1 : 0 };
		await r.hset(KEY.sigs, { [id]: JSON.stringify(rec) });
		await r.zadd(KEY.idx, { score: no, member: id });
		return publicRecord(rec);
	} catch (err) {
		await Promise.resolve(release()).catch(() => {});
		throw err;
	}
}

/**
 * Moderation: remove a signature by id. The author's claim is left in place on
 * purpose, so a removed signer cannot immediately sign again. Returns whether a
 * record was removed.
 */
export async function removeSignature(id) {
	const r = redis();
	const existed = Number(await r.hdel(KEY.sigs, id)) > 0;
	await r.zrem(KEY.idx, id);
	return existed;
}

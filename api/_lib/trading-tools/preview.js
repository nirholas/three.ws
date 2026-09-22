// Signed, single-use previews for the financial trading tools.
//
// Every tool that moves funds or cannot be undone (swap_execute, launch_buy,
// dca_create, limit_order_create, add_to_whitelist, wallet_transfer, ...) is
// the second half of a pair. Its preview tool (swap_quote, launch_quote,
// dca_preview, order_preview, whitelist_preview, transfer_preview) reads live
// state, runs the same guards the execute path will run, and returns an id.
// The financial tool takes only that id plus its named confirm flag, so it can
// never act on anything other than what the owner was shown.
//
// The id is an HMAC-signed token that pins:
//   - the tool family it was issued for (a swap quote cannot authorize a
//     transfer, a limit-order preview cannot create a DCA),
//   - the caller (user id), and the agent when there is one,
//   - every parameter the execute step will use.
// It lives ten minutes (the MCP tool policy's preview window) and is spent once:
// `consumePreview` takes a cross-instance lock on its nonce, so a second
// execute is refused instead of acting twice. A failed execute releases the
// lock so the owner can retry the same approved preview.

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import { env } from '../env.js';
import { acquireLock, releaseLock } from '../cache.js';

/** How long a preview authorizes its financial tool. Matches the MCP policy window. */
export const PREVIEW_TTL_MS = 10 * 60 * 1000;

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function sign(payload) {
	return createHmac('sha256', `trading-preview:${env.JWT_SECRET}`).update(payload).digest();
}

/** A refusal the tool layer turns into an error result naming the preview tool. */
export class PreviewError extends Error {
	/**
	 * @param {string} code  preview_required | preview_invalid | preview_mismatch | preview_stale | preview_used
	 * @param {string} message
	 */
	constructor(code, message) {
		super(message);
		this.code = code;
	}
}

/**
 * Issue a preview id.
 * @param {string} kind     'swap' | 'launch' | 'dca' | 'order' | 'allowlist' | 'transfer'
 * @param {object} claims   pinned parameters; must include userId
 * @param {{ prefix?: 'q'|'p', now?: number }} [opts]  'q' for quotes (quote_id), 'p' for previews (preview_id)
 * @returns {{ id: string, expires_at: string }}
 */
export function issuePreview(kind, claims, { prefix = 'p', now = Date.now() } = {}) {
	if (!claims?.userId) throw new Error('issuePreview: claims.userId is required');
	const exp = now + PREVIEW_TTL_MS;
	const payload = b64url(JSON.stringify({ k: kind, n: randomUUID(), exp, c: claims }));
	return { id: `${prefix}_${payload}.${b64url(sign(payload))}`, expires_at: new Date(exp).toISOString() };
}

/**
 * Verify a preview id and return its pinned claims and nonce.
 * @param {unknown} id
 * @param {string|string[]} kind  accepted kind(s)
 * @param {{ userId: string, now?: number }} who
 * @returns {{ claims: object, nonce: string, kind: string, expires_at: string }}
 */
export function verifyPreview(id, kind, { userId, now = Date.now() }) {
	if (typeof id !== 'string' || !/^[qp]_[\w-]+\.[\w-]+$/.test(id)) {
		throw new PreviewError('preview_required', 'A preview id from the matching preview tool is required.');
	}
	const [payload, sig] = id.slice(2).split('.');
	const expected = sign(payload);
	const given = Buffer.from(sig, 'base64url');
	if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
		throw new PreviewError('preview_invalid', 'This preview id failed verification.');
	}
	let parsed;
	try {
		parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
	} catch {
		throw new PreviewError('preview_invalid', 'This preview id is malformed.');
	}
	const kinds = Array.isArray(kind) ? kind : [kind];
	if (!kinds.includes(parsed.k)) {
		throw new PreviewError('preview_mismatch', `This id was issued for a ${parsed.k} preview, not this action.`);
	}
	if (parsed.c?.userId !== userId) {
		throw new PreviewError('preview_mismatch', 'This preview belongs to a different account.');
	}
	if (!Number.isFinite(parsed.exp) || parsed.exp < now) {
		throw new PreviewError('preview_stale', 'This preview is older than ten minutes, so it no longer reflects live prices and balances.');
	}
	return { claims: parsed.c, nonce: parsed.n, kind: parsed.k, expires_at: new Date(parsed.exp).toISOString() };
}

const lockKey = (nonce) => `trading-preview:used:${nonce}`;

// Process-local record of spent nonces. acquireLock degrades to "granted" when
// Redis is not configured or unreachable, so without this a single instance
// could spend one preview twice during a Redis outage.
const spentLocal = new Map();

function sweepLocal(now) {
	for (const [k, exp] of spentLocal) if (exp < now) spentLocal.delete(k);
}

/**
 * Spend a preview. Resolves a release function when this caller holds it, and
 * throws preview_used when another execute already spent it.
 * @param {string} nonce
 * @returns {Promise<() => Promise<void>>} call on failure to let the owner retry
 */
export async function consumePreview(nonce) {
	const key = lockKey(nonce);
	const now = Date.now();
	sweepLocal(now);
	if (spentLocal.has(key)) throw new PreviewError('preview_used', 'This preview was already used. Request a fresh one.');
	// Held past the preview's own lifetime, so a spent id stays spent until it
	// could no longer verify anyway.
	const ttlSeconds = Math.ceil(PREVIEW_TTL_MS / 1000) + 60;
	const ok = await acquireLock(key, ttlSeconds);
	if (!ok) throw new PreviewError('preview_used', 'This preview was already used. Request a fresh one.');
	spentLocal.set(key, now + ttlSeconds * 1000);
	return async () => {
		spentLocal.delete(key);
		await releaseLock(key);
	};
}

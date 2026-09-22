// Signed, short-lived quote ids for the v1 fund-moving routes.
//
// A fund-moving call (wallet transfer, custodial swap) is two steps: a quote
// route previews the action and returns a `quoteId`, and the execute route
// takes `{ quoteId, confirm: true }`. The quote id is an HMAC-signed token that
// pins every parameter the owner saw (agent, user, destination, amount, asset,
// network), so execute can never act on anything other than what was
// previewed. It carries a random nonce that the execute route uses as the
// underlying handler's idempotency key, which makes each quote single-use: a
// second execute of the same quote replays the first result instead of moving
// funds again.

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { env } from '../env.js';
import { apiError } from './http.js';

export const QUOTE_TTL_MS = 5 * 60 * 1000;

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function sign(payload) {
	return createHmac('sha256', `v1-quote:${env.JWT_SECRET}`).update(payload).digest();
}

/**
 * @param {string} kind    'transfer' | 'swap'
 * @param {object} claims  the pinned parameters
 * @returns {{ quoteId: string, expiresAt: string, nonce: string }}
 */
export function issueQuote(kind, claims) {
	const nonce = randomUUID();
	const exp = Date.now() + QUOTE_TTL_MS;
	const payload = b64url(JSON.stringify({ k: kind, n: nonce, exp, c: claims }));
	return { quoteId: `q_${payload}.${b64url(sign(payload))}`, expiresAt: new Date(exp).toISOString(), nonce };
}

/**
 * Verify a quote id and return its claims. Throws a 400 `invalid_quote` for a
 * malformed or tampered id, 410 `quote_expired` once it has lapsed, and 400
 * `quote_mismatch` when it was issued for a different kind or owner.
 */
export function verifyQuote(quoteId, kind, { userId, agentId = null }) {
	if (typeof quoteId !== 'string' || !quoteId.startsWith('q_')) {
		throw apiError(400, 'invalid_quote', 'quoteId is missing or malformed. Request a new quote first.', { parameter: 'quoteId' });
	}
	const [payload, sig] = quoteId.slice(2).split('.');
	if (!payload || !sig) throw apiError(400, 'invalid_quote', 'quoteId is malformed.', { parameter: 'quoteId' });
	const expected = sign(payload);
	const given = Buffer.from(sig, 'base64url');
	if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
		throw apiError(400, 'invalid_quote', 'quoteId failed verification. Request a new quote.', { parameter: 'quoteId' });
	}
	let parsed;
	try {
		parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
	} catch {
		throw apiError(400, 'invalid_quote', 'quoteId is malformed.', { parameter: 'quoteId' });
	}
	if (parsed.k !== kind || parsed.c?.userId !== userId || (agentId && parsed.c?.agentId !== agentId)) {
		throw apiError(400, 'quote_mismatch', 'This quote was issued for a different action, account or agent.', { parameter: 'quoteId' });
	}
	if (!Number.isFinite(parsed.exp) || parsed.exp < Date.now()) {
		throw apiError(410, 'quote_expired', 'This quote has expired. Request a new one and confirm it within five minutes.', {
			parameter: 'quoteId',
		});
	}
	return { claims: parsed.c, nonce: parsed.n, expiresAt: new Date(parsed.exp).toISOString() };
}

/** Throw the shared 400 every fund-moving route returns when `confirm` is not literally true. */
export function requireConfirm(body, previewMethod, previewRoute) {
	if (body?.confirm === true) return;
	throw apiError(
		400,
		'confirmation_required',
		`This action moves funds. Call ${previewRoute} first, review the quote, then send { quoteId, confirm: true }.`,
		{ confirmFlag: 'confirm', previewMethod, previewRoute },
	);
}

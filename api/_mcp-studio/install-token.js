// Install tokens: a free, anonymous identity for keyless studio callers.
//
// A cloud agent (Grok Bot, the xAI Responses API, any hosted MCP client) reaches
// the free studio from its vendor's shared egress, so keying the per-caller
// generation caps on its IP rations every user of that agent as one caller. An
// install token gives one installation its own budget without an account:
// POST /api/mcp-studio/install mints one, and the connector URL carries it as
// `?install=<token>` on any studio surface (./handler.js reads it).
//
// The token is self-authenticating, so nothing is stored and no request pays a
// database round trip: `tws_<created>_<nonce><sig>`, where created is the mint
// time in base-36 seconds, nonce is 16 random bytes and sig is a truncated
// HMAC-SHA256 over both under a key derived from MCP_INSTALL_SECRET (falling
// back to JWT_SECRET, domain-separated so the two can never be confused). A
// caller cannot forge one, and minting is rate-limited per IP (limits.
// studioInstallMint), so a token buys exactly one more caller-sized budget per
// mint and every token still shares the per-IP pool cap and the global breaker.
// A token is a rate-limit key and nothing else: it unlocks no tool, no account
// and no spend, so there is nothing to revoke.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '../_lib/env.js';

const PREFIX = 'tws_';
const KEY_LABEL = 'three.ws mcp-studio install token v1';
// 16 random bytes and a 16-byte MAC, both hex.
const TOKEN_RE = /^tws_([0-9a-z]{1,10})_([0-9a-f]{32})([0-9a-f]{32})$/;
// A token minted on a host whose clock runs ahead is still honored.
const FUTURE_SKEW_S = 300;

/** The query parameter a connector URL carries the token in. */
export const INSTALL_PARAM = 'install';

function signingKey() {
	const root = process.env.MCP_INSTALL_SECRET || process.env.JWT_SECRET;
	if (!root) return null;
	return createHmac('sha256', root).update(KEY_LABEL).digest();
}

/** True when this deployment can mint and verify install tokens. */
export function installTokensConfigured() {
	return signingKey() !== null;
}

function mac(key, created, nonce) {
	return createHmac('sha256', key).update(`${created}.${nonce}`).digest('hex').slice(0, 32);
}

/**
 * Mint a new install token.
 * @returns {{ token: string, id: string, createdAt: Date } | null} null when no signing secret is configured.
 */
export function mintInstallToken({ now = Date.now() } = {}) {
	const key = signingKey();
	if (!key) return null;
	const created = Math.floor(now / 1000).toString(36);
	const nonce = randomBytes(16).toString('hex');
	return {
		token: `${PREFIX}${created}_${nonce}${mac(key, created, nonce)}`,
		id: nonce,
		createdAt: new Date(parseInt(created, 36) * 1000),
	};
}

/**
 * Verify a token. Returns its stable id (the nonce, used as the rate-limit key)
 * and mint time, or null for anything this deployment did not mint.
 * @param {unknown} token
 * @returns {{ id: string, createdAt: Date } | null}
 */
export function verifyInstallToken(token, { now = Date.now() } = {}) {
	if (typeof token !== 'string') return null;
	const m = TOKEN_RE.exec(token);
	if (!m) return null;
	const key = signingKey();
	if (!key) return null;
	const [, created, nonce, sig] = m;
	const expected = Buffer.from(mac(key, created, nonce), 'hex');
	if (!timingSafeEqual(expected, Buffer.from(sig, 'hex'))) return null;
	const createdS = parseInt(created, 36);
	if (!Number.isFinite(createdS) || createdS > now / 1000 + FUTURE_SKEW_S) return null;
	return { id: nonce, createdAt: new Date(createdS * 1000) };
}

/** The raw `install` query value on a request, or null. */
export function installParam(req) {
	const fromQuery = req?.query?.[INSTALL_PARAM];
	if (typeof fromQuery === 'string') return fromQuery;
	const url = typeof req?.url === 'string' ? req.url : '';
	const q = url.indexOf('?');
	if (q < 0) return null;
	return new URLSearchParams(url.slice(q + 1)).get(INSTALL_PARAM);
}

/** The verified install token on a request, or null (missing, malformed, forged). */
export function installTokenFrom(req) {
	return verifyInstallToken(installParam(req));
}

/** The site origin connector URLs are built on (PUBLIC_APP_ORIGIN, else https://three.ws). */
export function studioOrigin() {
	return env.APP_ORIGIN;
}

/** The connector URL for one studio surface path, with the token attached. */
export function connectorUrl(token, path = '/api/mcp-studio') {
	return `${studioOrigin()}${path}?${INSTALL_PARAM}=${encodeURIComponent(token)}`;
}

// Per-creation manage token: the credential that lets the maker of a forge
// creation delete it or change its visibility without the browser id it was
// forged under (issue #639).
//
// Anonymous forge ownership used to rest on the x-forge-client header alone. A
// Forge API caller that never sent one (every such caller shares the 'anon'
// bucket, see forgeStore.ANON_CLIENT_KEY) or that lost the id it sent had no
// way to take its own model down. The forge now hands back `manage_token` with
// every response that carries a creation_id, and DELETE / PATCH on
// /api/forge-creation accept it in the `x-forge-manage-token` header.
//
// Stateless: `fm1.<base64url(creation id)>.<HMAC-SHA256>`, signed with the
// server JWT_SECRET under its own domain-separation label, so it can never be
// replayed as a forge job handle (forge-job-token.js) or any other token keyed
// from the same secret. It grants exactly one creation and nothing else, and
// is only ever returned to a caller that already holds that creation's job id
// or client id.

import { createHmac, timingSafeEqual } from 'node:crypto';

import { env } from './env.js';

const PREFIX = 'fm1.';
const LABEL = 'forge-manage:v1:';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sign(payload) {
	return createHmac('sha256', env.JWT_SECRET).update(LABEL + payload).digest('base64url');
}

/**
 * @param {string} creationId
 * @returns {string|null} the token, or null for anything that is not a creation id
 */
export function mintManageToken(creationId) {
	if (typeof creationId !== 'string' || !UUID_RE.test(creationId)) return null;
	const payload = Buffer.from(creationId.toLowerCase(), 'utf8').toString('base64url');
	return `${PREFIX}${payload}.${sign(payload)}`;
}

/**
 * @param {unknown} token
 * @returns {string|null} the creation id the token grants, or null when invalid
 */
export function verifyManageToken(token) {
	if (typeof token !== 'string' || token.length > 256 || !token.startsWith(PREFIX)) return null;
	const parts = token.split('.');
	if (parts.length !== 3) return null;
	const [, payload, sig] = parts;
	if (!payload || !sig) return null;
	try {
		const expected = Buffer.from(sign(payload), 'utf8');
		const actual = Buffer.from(sig, 'utf8');
		if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
		const id = Buffer.from(payload, 'base64url').toString('utf8');
		return UUID_RE.test(id) ? id.toLowerCase() : null;
	} catch {
		return null;
	}
}

/**
 * Add `manage_token` to a forge response body that names a creation. Bodies
 * without a creation id pass through untouched.
 * @template T
 * @param {T} body
 * @returns {T}
 */
export function withManageToken(body) {
	if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
	const id = /** @type {any} */ (body).creation_id;
	if (typeof id !== 'string' || /** @type {any} */ (body).manage_token) return body;
	// Adding the token must never break a response that worked without it: a
	// deployment missing JWT_SECRET answers exactly as it did before.
	let token = null;
	try {
		token = mintManageToken(id);
	} catch (err) {
		console.warn('[forge-manage-token] could not mint a manage token:', err?.message);
	}
	return token ? { ...body, manage_token: token } : body;
}

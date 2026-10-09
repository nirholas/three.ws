// Install tokens for the keyless 3D Studio MCP servers.
//
// A token is a free, anonymous, per-installation identity: `inst_` plus 32 hex
// characters of CSPRNG output. Only its SHA-256 is stored (table
// mcp_studio_installs, migration 20261009120000_mcp_studio_installs.sql). The
// studio handler (api/_mcp-studio/handler.js) resolves ?install=<token> to a
// per-caller rate-limit key; an unknown or malformed token resolves to null and
// the caller is treated exactly as if it had sent none.

import { createHash, randomBytes } from 'node:crypto';
import { sql } from './db.js';

const TOKEN_RE = /^inst_[0-9a-f]{32}$/;
const POSITIVE_TTL_MS = 5 * 60_000;
const NEGATIVE_TTL_MS = 30_000;
const CACHE_MAX = 5000;

/** @type {Map<string, { ok: boolean, until: number }>} */
const cache = new Map();

export function isInstallTokenShape(token) {
	return typeof token === 'string' && TOKEN_RE.test(token);
}

export function hashInstallToken(token) {
	return createHash('sha256').update(token).digest('hex');
}

/** The limiter key an install token maps to. Not reversible to the token. */
export function installCallerKey(token) {
	return `inst:${hashInstallToken(token).slice(0, 32)}`;
}

function remember(hash, ok) {
	if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
	cache.set(hash, { ok, until: Date.now() + (ok ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS) });
}

/** Mint and store a new token. Returns the plaintext token, shown to its owner once. */
export async function createInstallToken() {
	const token = `inst_${randomBytes(16).toString('hex')}`;
	const hash = hashInstallToken(token);
	await sql`insert into mcp_studio_installs (token_hash) values (${hash})`;
	remember(hash, true);
	return token;
}

/**
 * The limiter key for a token that exists, or null for anything else (absent,
 * malformed, unknown, or the database being unreachable: the caller then keeps
 * today's keying rather than being denied a free feature).
 */
export async function resolveInstallToken(token) {
	if (!isInstallTokenShape(token)) return null;
	const hash = hashInstallToken(token);
	const hit = cache.get(hash);
	if (hit && hit.until > Date.now()) return hit.ok ? installCallerKey(token) : null;
	try {
		const rows = await sql`select 1 from mcp_studio_installs where token_hash = ${hash} limit 1`;
		const ok = rows.length > 0;
		remember(hash, ok);
		return ok ? installCallerKey(token) : null;
	} catch (err) {
		console.warn('[mcp-studio] install token lookup failed, keying on the default:', err.message);
		return null;
	}
}

/** Test seam: forget every cached lookup. */
export function clearInstallCache() {
	cache.clear();
}

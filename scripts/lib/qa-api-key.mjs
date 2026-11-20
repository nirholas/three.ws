// A short-lived three.ws API key for the production QA account, minted the way
// the dashboard does: sign in, read a CSRF token, POST /api/api-keys. Scripts
// that need a real signed-in leg (a free generation, a connector review) use it
// when THREE_WS_API_KEY is not set, and revoke the key when they finish.
//
// Credentials come from AUDIT_EMAIL / AUDIT_PASSWORD in the environment or in
// the repo's .env. Without them mintQaKey returns null and the caller decides.

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The Cookie header a browser would send back after this Set-Cookie list. */
export function cookieHeader(setCookies) {
	return setCookies
		.map((c) => c.split(';')[0].trim())
		.filter(Boolean)
		.join('; ');
}

/** The POST /api/api-keys body: a connector-preset key that expires on its own. */
export function keyRequestBody(name, ttlMs, now = Date.now()) {
	return { name, preset: 'connector', expires_at: new Date(now + ttlMs).toISOString() };
}

// CSRF tokens are single use: every state-changing call reads a fresh one.
async function csrfToken(origin, cookie) {
	const res = await fetch(`${origin}/api/csrf-token`, { headers: { cookie } });
	if (!res.ok) throw new Error(`csrf-token answered ${res.status}`);
	return (await res.json()).token;
}

/**
 * @param {{ origin?: string, name: string, ttlMs?: number }} opts
 * @returns {Promise<{ id: string, token: string, origin: string, cookie: string } | null>}
 */
export async function mintQaKey({ origin = 'https://three.ws', name, ttlMs = 2 * 3600_000 }) {
	const envFile = join(ROOT, '.env');
	if (existsSync(envFile)) process.loadEnvFile(envFile);
	const { AUDIT_EMAIL: email, AUDIT_PASSWORD: password } = process.env;
	if (!email || !password) return null;
	const login = await fetch(`${origin}/api/auth/login`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ email, password }),
	});
	if (!login.ok) throw new Error(`QA login answered ${login.status}`);
	const cookie = cookieHeader(login.headers.getSetCookie());
	const res = await fetch(`${origin}/api/api-keys`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': await csrfToken(origin, cookie) },
		body: JSON.stringify(keyRequestBody(name, ttlMs)),
	});
	if (!res.ok) throw new Error(`api-keys answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
	const { data } = await res.json();
	return { id: data.id, token: data.token, origin, cookie };
}

/**
 * Revoke a key from mintQaKey with the signed-in session that minted it (a
 * connector-preset key cannot manage keys). Reports, never throws: the key
 * also expires on its own.
 */
export async function revokeQaKey(key) {
	let why;
	try {
		const res = await fetch(`${key.origin}/api/api-keys/${key.id}`, {
			method: 'DELETE',
			headers: { cookie: key.cookie, 'x-csrf-token': await csrfToken(key.origin, key.cookie) },
		});
		if (res.ok) return true;
		why = `HTTP ${res.status}`;
	} catch (err) {
		why = err?.message || String(err);
	}
	console.error(`could not revoke key ${key.id} (${why}); it expires on its own, or revoke it at ${key.origin}/settings/api-keys`);
	return false;
}

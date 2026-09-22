// Signing in, and asking the platform who we are.
//
// Three ways in, one stored shape (see store.js):
//   oauth   browser + loopback redirect + PKCE; refreshable, 1h access tokens
//   device  browser on any machine approves a code; yields an API key
//   key     paste an sk_live_ key from /dashboard/api
// All three are verified with GET /api/cli/whoami before anything is stored,
// so a typo'd key or a half-finished flow never lands in the store.

import os from 'node:os';
import { requestJson, ApiError } from './http.js';
import { authorizeInBrowser, bearerFor, revokeOAuth } from './oauth.js';
import { deviceLogin } from './device.js';
import { readStore, writeStore, updateStore } from './store.js';
import { systemEnv } from './paths.js';

const BASE_SCOPES = ['profile', 'avatars:read', 'avatars:write', 'memory:read', 'memory:write', 'agents:read', 'wallet:read'];
const FINANCIAL_SCOPES = ['wallet:write', 'services:write'];

/** Scopes to request. Money-moving scopes only when the person opted in. */
export function scopesFor({ financial = false, oauth = false } = {}) {
	return [...(oauth ? ['offline_access'] : []), ...BASE_SCOPES, ...(financial ? FINANCIAL_SCOPES : [])].join(' ');
}

export async function whoami(origin, bearer) {
	return requestJson(`${origin}/api/cli/whoami`, { headers: { authorization: `Bearer ${bearer}` } });
}

export function looksLikeKey(value) {
	return /^sk_(live|test)_[A-Za-z0-9_-]{16,}$/.test(String(value || '').trim());
}

async function persist({ origin, auth, env }) {
	const bearer = auth.type === 'apikey' ? auth.key : auth.access_token;
	const me = await whoami(origin, bearer);
	const store = readStore(env);
	// Switching accounts: the old account's stdio key must not be written into
	// the new account's clients.
	if (store.account?.user_id && store.account.user_id !== me.user.id) store.stdio_key = null;
	store.origin = origin;
	store.auth = auth;
	store.account = { user_id: me.user.id, email: me.user.email || null };
	writeStore(store, env);
	return me;
}

export async function loginOAuth({ origin, financial, env = systemEnv(), onUrl }) {
	const auth = await authorizeInBrowser({ origin, scope: scopesFor({ financial, oauth: true }), env, onUrl });
	return persist({ origin, auth, env });
}

export async function loginDevice({ origin, financial, env = systemEnv(), onCode }) {
	const { auth } = await deviceLogin({ origin, scope: scopesFor({ financial }), env, onCode });
	return persist({ origin, auth, env });
}

export async function loginKey({ origin, key, env = systemEnv() }) {
	const trimmed = String(key || '').trim();
	if (!looksLikeKey(trimmed)) throw new ApiError('that does not look like a three.ws API key (they start with sk_live_). Create one at https://three.ws/dashboard/api.');
	let me;
	try {
		me = await whoami(origin, trimmed);
	} catch (err) {
		if (err.status === 401) throw new ApiError('three.ws does not recognize that key; it may be revoked or expired. Create a new one at https://three.ws/dashboard/api.', { status: 401 });
		throw err;
	}
	const store = readStore(env);
	if (store.account?.user_id && store.account.user_id !== me.user.id) store.stdio_key = null;
	store.origin = origin;
	store.auth = { type: 'apikey', key: trimmed, prefix: me.credential?.api_key?.prefix || trimmed.slice(0, 12), key_id: null, scope: me.credential?.scope || '' };
	store.account = { user_id: me.user.id, email: me.user.email || null };
	writeStore(store, env);
	return me;
}

/** The current account, refreshing an OAuth token when needed. null when signed out. */
export async function currentIdentity({ origin, env = systemEnv() }) {
	const bearer = await bearerFor(env, { origin });
	if (!bearer) return null;
	return whoami(origin, bearer);
}

/**
 * The API key written into stdio package env blocks. With an API key login it
 * is that key. With OAuth, a dedicated key is minted once through the
 * authenticated /api/api-keys route and reused, so a stdio package never
 * holds an access token that expires in an hour.
 */
export async function ensureStdioKey({ origin, env = systemEnv() }) {
	const store = readStore(env);
	if (store.auth?.type === 'apikey') return store.auth.key;
	if (store.stdio_key?.key) return store.stdio_key.key;
	const bearer = await bearerFor(env, { origin });
	if (!bearer) throw new ApiError('sign in first: `npx three-ws login`');
	const scope = (store.auth?.scope || '').split(/\s+/).filter((s) => s && s !== 'offline_access').join(' ');
	const res = await requestJson(`${origin}/api/api-keys`, {
		method: 'POST',
		headers: { authorization: `Bearer ${bearer}` },
		json: { name: `three-ws CLI stdio on ${os.hostname()}`.slice(0, 80), scope: scope || 'profile avatars:read' },
	});
	const minted = res.data;
	updateStore((s) => {
		s.stdio_key = { key: minted.token, prefix: minted.prefix, key_id: minted.id, scope: minted.scope };
		return s;
	}, env);
	return minted.token;
}

export async function logout({ origin, env = systemEnv() }) {
	const store = readStore(env);
	let revoked = false;
	if (store.auth?.type === 'oauth') {
		try { revoked = await revokeOAuth(store.auth, origin); } catch { revoked = false; }
	}
	const had = Boolean(store.auth || store.stdio_key);
	store.auth = null;
	store.stdio_key = null;
	store.account = null;
	writeStore(store, env);
	return { had, revoked };
}

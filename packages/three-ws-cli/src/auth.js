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
export function scopesFor({ financial = false, oauth = false, extra = [] } = {}) {
	return [...new Set([...(oauth ? ['offline_access'] : []), ...BASE_SCOPES, ...extra, ...(financial ? FINANCIAL_SCOPES : [])])].join(' ');
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
	if (store.account?.user_id && store.account.user_id !== me.user.id) { store.stdio_key = null; store.connector_key = null; }
	store.origin = origin;
	store.auth = auth;
	store.account = { user_id: me.user.id, email: me.user.email || null };
	writeStore(store, env);
	return me;
}

export async function loginOAuth({ origin, financial, extraScopes = [], env = systemEnv(), onUrl }) {
	const auth = await authorizeInBrowser({ origin, scope: scopesFor({ financial, oauth: true, extra: extraScopes }), env, onUrl });
	return persist({ origin, auth, env });
}

export async function loginDevice({ origin, financial, extraScopes = [], env = systemEnv(), onCode }) {
	const { auth } = await deviceLogin({ origin, scope: scopesFor({ financial, extra: extraScopes }), env, onCode });
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
	if (store.account?.user_id && store.account.user_id !== me.user.id) { store.stdio_key = null; store.connector_key = null; }
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

/**
 * The key Grok Bot holds as its connector secret: the "connector" preset, which
 * reads, generates and edits agents and can never spend. Minted once through the
 * bearer-reachable /api/api-keys route and reused, so re-running setup never
 * piles up keys. A key the account no longer has (revoked, deleted) is replaced.
 */
export async function ensureConnectorKey({ origin, env = systemEnv() }) {
	const store = readStore(env);
	if (store.connector_key?.key && store.account?.user_id === store.connector_key.user_id) return { ...store.connector_key, minted: false };
	const bearer = await bearerFor(env, { origin });
	if (!bearer) throw new ApiError('sign in first: `npx three-ws login`');
	const res = await requestJson(`${origin}/api/api-keys`, {
		method: 'POST',
		headers: { authorization: `Bearer ${bearer}` },
		json: { name: `Grok Bot connector (${os.hostname()})`.slice(0, 80), preset: 'connector' },
	});
	const minted = res.data;
	const record = { key: minted.token, prefix: minted.prefix, key_id: minted.id, scope: minted.scope, user_id: readStore(env).account?.user_id || null };
	updateStore((s) => {
		s.connector_key = record;
		return s;
	}, env);
	return { ...record, minted: true };
}

export async function logout({ origin, env = systemEnv() }) {
	const store = readStore(env);
	let revoked = false;
	if (store.auth?.type === 'oauth') {
		try { revoked = await revokeOAuth(store.auth, origin); } catch { revoked = false; }
	}
	const had = Boolean(store.auth || store.stdio_key || store.connector_key);
	store.auth = null;
	store.stdio_key = null;
	store.connector_key = null;
	store.account = null;
	writeStore(store, env);
	return { had, revoked };
}

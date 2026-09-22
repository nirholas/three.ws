// OAuth 2.1 against the three.ws authorization server, as a native app
// (RFC 8252): dynamic client registration once per origin, then authorization
// code + PKCE with the code delivered to a loopback listener on an ephemeral
// port. The server accepts any port on a registered 127.0.0.1 redirect, so the
// one registration is reused for every later login.

import http from 'node:http';
import crypto from 'node:crypto';
import { request, requestJson, ApiError, VERSION } from './http.js';
import { openBrowser } from './browser.js';
import { readStore, writeStore, withStoreLock } from './store.js';
import { systemEnv } from './paths.js';

export const REDIRECT_PATH = '/callback';
const REGISTERED_REDIRECT = `http://127.0.0.1${REDIRECT_PATH}`;

// Everything the CLI could ever ask for; the scope actually requested at
// authorize time is narrower (see scopesFor in auth.js) and the consent screen
// lists exactly that narrower set.
export const REGISTRATION_SCOPE = 'profile offline_access avatars:read avatars:write memory:read memory:write agents:read agents:write wallet:read wallet:write services:write';

export async function discover(origin) {
	const meta = await requestJson(`${origin}/.well-known/oauth-authorization-server`);
	for (const k of ['authorization_endpoint', 'token_endpoint', 'registration_endpoint']) {
		if (!meta?.[k]) throw new ApiError(`${origin} does not advertise ${k}; is this a three.ws server?`);
	}
	return meta;
}

function base64url(buf) {
	return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function pkcePair() {
	const verifier = base64url(crypto.randomBytes(32));
	const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
	return { verifier, challenge };
}

export async function ensureClient(origin, meta, env = systemEnv()) {
	const store = readStore(env);
	const cached = store.oauth_clients?.[origin];
	if (cached?.client_id && cached.scope === REGISTRATION_SCOPE) return cached.client_id;
	const reg = await requestJson(meta.registration_endpoint, {
		method: 'POST',
		json: {
			client_name: 'three-ws CLI',
			client_uri: 'https://three.ws/docs/cli',
			redirect_uris: [REGISTERED_REDIRECT],
			grant_types: ['authorization_code', 'refresh_token'],
			response_types: ['code'],
			token_endpoint_auth_method: 'none',
			scope: REGISTRATION_SCOPE,
			software_id: 'three-ws-cli',
			software_version: VERSION,
		},
	});
	const next = readStore(env);
	next.oauth_clients = { ...(next.oauth_clients || {}), [origin]: { client_id: reg.client_id, redirect_uri: REGISTERED_REDIRECT, scope: REGISTRATION_SCOPE } };
	writeStore(next, env);
	return reg.client_id;
}

const CALLBACK_PAGE = (ok, detail) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>three-ws CLI</title><style>:root{color-scheme:light dark}body{font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0b10;color:#eee;padding:24px}.c{max-width:420px;background:#14141c;border:1px solid #2a2a36;border-radius:16px;padding:28px}h1{font-size:20px;margin:0 0 8px}p{color:#aaa;margin:0}</style></head><body><div class="c"><h1>${ok ? 'Signed in. Back to your terminal.' : 'Sign-in did not finish'}</h1><p>${detail}</p></div></body></html>`;

function escapeHtml(s) {
	return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/**
 * Run the browser half of the flow and resolve with the token response.
 * `onUrl(url, opened)` lets the caller print the URL (always) and say whether
 * the browser opened.
 */
export async function authorizeInBrowser({ origin, scope, env = systemEnv(), onUrl = () => {}, timeoutMs = 5 * 60_000 }) {
	const meta = await discover(origin);
	const clientId = await ensureClient(origin, meta, env);
	const { verifier, challenge } = pkcePair();
	const state = base64url(crypto.randomBytes(16));
	const resource = `${origin}/api/mcp`;

	let settle;
	const done = new Promise((resolve, reject) => { settle = { resolve, reject }; });
	const server = http.createServer((req, res) => {
		const url = new URL(req.url, 'http://127.0.0.1');
		if (url.pathname !== REDIRECT_PATH) {
			res.writeHead(404).end();
			return;
		}
		const send = (ok, detail) => {
			res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
			res.end(CALLBACK_PAGE(ok, escapeHtml(detail)));
		};
		if (url.searchParams.get('state') !== state) {
			send(false, 'The response did not match this sign-in. Run the command again.');
			return;
		}
		const err = url.searchParams.get('error');
		if (err) {
			send(false, err === 'access_denied' ? 'You cancelled the sign-in. Nothing was granted.' : `The server said: ${err}`);
			settle.reject(new ApiError(err === 'access_denied' ? 'sign-in cancelled in the browser' : `authorization failed: ${err}`, { code: err }));
			return;
		}
		const code = url.searchParams.get('code');
		if (!code) {
			send(false, 'No authorization code came back. Run the command again.');
			return;
		}
		send(true, 'You can close this tab. The three-ws CLI is finishing setup.');
		settle.resolve(code);
	});
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', resolve);
	});
	const redirectUri = `http://127.0.0.1:${server.address().port}${REDIRECT_PATH}`;
	const authUrl = new URL(meta.authorization_endpoint);
	authUrl.search = new URLSearchParams({
		response_type: 'code',
		client_id: clientId,
		redirect_uri: redirectUri,
		scope,
		state,
		code_challenge: challenge,
		code_challenge_method: 'S256',
		resource,
	}).toString();

	const opened = await openBrowser(authUrl.toString(), { env: env.vars });
	onUrl(authUrl.toString(), opened);
	const timer = setTimeout(() => settle.reject(new ApiError('timed out waiting for the browser sign-in (5 minutes). Run the command again, or use --device.')), timeoutMs);
	let code;
	try {
		code = await done;
	} finally {
		clearTimeout(timer);
		server.close();
	}
	const token = await requestJson(meta.token_endpoint, {
		method: 'POST',
		form: { grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier, client_id: clientId, resource },
	});
	return {
		type: 'oauth',
		access_token: token.access_token,
		refresh_token: token.refresh_token || null,
		expires_at: Date.now() + (Number(token.expires_in) || 3600) * 1000,
		scope: token.scope || scope,
		client_id: clientId,
		token_endpoint: meta.token_endpoint,
		revocation_endpoint: meta.revocation_endpoint || null,
	};
}

const REFRESH_MARGIN_MS = 90_000;

export function needsRefresh(auth, now = Date.now()) {
	return auth?.type === 'oauth' && (!auth.expires_at || auth.expires_at - now < REFRESH_MARGIN_MS);
}

/**
 * A usable bearer for the stored credential, refreshing an OAuth token first
 * when it is close to expiry. `force` refreshes even a fresh token (after a 401).
 */
export async function bearerFor(env = systemEnv(), { force = false, origin } = {}) {
	const store = readStore(env);
	const auth = store.auth;
	if (!auth) return null;
	if (auth.type === 'apikey') return auth.key;
	if (!force && !needsRefresh(auth)) return auth.access_token;
	if (!auth.refresh_token) throw new ApiError('your three.ws session expired. Run `npx three-ws login`.', { code: 'login_required' });
	return withStoreLock(async () => {
		// Another process may have refreshed while this one waited on the lock.
		const fresh = readStore(env);
		const current = fresh.auth;
		if (current?.type !== 'oauth') return current?.key || null;
		if (current.access_token !== auth.access_token && !needsRefresh(current)) return current.access_token;
		const endpoint = current.token_endpoint || `${origin || fresh.origin}/api/oauth/token`;
		let token;
		try {
			token = await requestJson(endpoint, {
				method: 'POST',
				form: { grant_type: 'refresh_token', refresh_token: current.refresh_token, client_id: current.client_id, resource: `${origin || fresh.origin}/api/mcp` },
			});
		} catch (err) {
			if (err.status === 400 || err.status === 401) {
				throw new ApiError('your three.ws session was revoked or expired. Run `npx three-ws login`.', { code: 'login_required', status: err.status });
			}
			throw err;
		}
		fresh.auth = {
			...current,
			access_token: token.access_token,
			refresh_token: token.refresh_token || current.refresh_token,
			expires_at: Date.now() + (Number(token.expires_in) || 3600) * 1000,
			scope: token.scope || current.scope,
		};
		writeStore(fresh, env);
		return fresh.auth.access_token;
	}, env);
}

/** Best-effort revocation of a stored OAuth refresh token (RFC 7009). */
export async function revokeOAuth(auth, origin) {
	if (auth?.type !== 'oauth' || !auth.refresh_token) return false;
	const endpoint = auth.revocation_endpoint || `${origin}/api/oauth/revoke`;
	const res = await request(endpoint, {
		method: 'POST',
		form: { token: auth.refresh_token, token_type_hint: 'refresh_token', client_id: auth.client_id },
	});
	return res.ok;
}

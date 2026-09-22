// The signed-in session: who you are, which server, and the tokens that prove
// it. Electron-free; the caller injects a `store` (read/write/clear of one JSON
// object, encrypted at rest by src/main/secure-store.js) and an `openBrowser`.
//
// The renderer never sees a token. It asks the main process for data, and the
// main process attaches the bearer here, refreshes it a minute before expiry,
// and retries a request once if the server says the token went stale.

import {
	registerClient, listenForCallback, pkcePair, randomState,
	buildAuthorizeUrl, exchangeCode, refreshTokens, revokeToken,
} from './oauth.js';

export const DEFAULT_API_BASE = 'https://three.ws';
const REFRESH_SKEW_MS = 60_000;

export class AuthError extends Error {
	constructor(message, code = 'signed_out') {
		super(message);
		this.code = code;
		this.status = 401;
	}
}

export class ApiError extends Error {
	constructor(message, { status, code, details } = {}) {
		super(message);
		this.status = status;
		this.code = code || `http_${status}`;
		this.details = details || null;
	}
}

export function normalizeApiBase(value) {
	const raw = String(value || '').trim() || DEFAULT_API_BASE;
	const url = new URL(raw);
	if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
		throw new Error('The server must use https (plain http is allowed only for a local development server).');
	}
	return url.origin;
}

// Both error envelopes the platform speaks: the v1 `{ error: { code, message } }`
// and the older flat `{ error: 'code', error_description | message }`.
export function errorFromBody(status, body, fallback) {
	const e = body?.error;
	if (e && typeof e === 'object') return new ApiError(e.message || fallback, { status, code: e.code, details: e.details });
	const message = body?.error_description || body?.message || (typeof e === 'string' ? e.replace(/_/g, ' ') : null) || fallback;
	return new ApiError(message, { status, code: typeof e === 'string' ? e : undefined, details: body?.details });
}

export function createSession({ store, version, openBrowser, fetchImpl = fetch, onChange = () => {} }) {
	let state = store.read() || {};
	let refreshing = null;
	let pendingSignIn = null;

	const apiBase = () => state.apiBase || DEFAULT_API_BASE;

	function save(next) {
		state = next;
		if (state.accessToken || state.clientId) store.write(state);
		else store.clear();
		onChange(status());
	}

	function status() {
		return {
			signedIn: Boolean(state.accessToken),
			apiBase: apiBase(),
			user: state.user || null,
			scope: state.scope || '',
			signingIn: Boolean(pendingSignIn),
		};
	}

	async function ensureClient(base) {
		if (state.clientId && state.clientApiBase === base) return state.clientId;
		const { clientId } = await registerClient({ apiBase: base, version, fetchImpl });
		state = { ...state, clientId, clientApiBase: base };
		store.write(state);
		return clientId;
	}

	async function signIn({ apiBase: requestedBase } = {}) {
		if (pendingSignIn) return pendingSignIn.promise;
		const base = normalizeApiBase(requestedBase || apiBase());
		const run = (async () => {
			const clientId = await ensureClient(base);
			const { verifier, challenge } = pkcePair();
			const stateParam = randomState();
			const listener = await listenForCallback({ state: stateParam });
			pendingSignIn.cancel = listener.cancel;
			onChange(status());
			await openBrowser(buildAuthorizeUrl({ apiBase: base, clientId, redirectUri: listener.redirectUri, challenge, state: stateParam }));
			const code = await listener.code;
			const tokens = await exchangeCode({ apiBase: base, clientId, code, redirectUri: listener.redirectUri, verifier, fetchImpl });
			state = { ...state, apiBase: base, ...tokens, user: null };
			store.write(state);
			const user = await loadUser();
			save({ ...state, user });
			return status();
		})();
		pendingSignIn = { promise: run, cancel: null };
		onChange(status());
		try {
			return await run;
		} finally {
			pendingSignIn = null;
			onChange(status());
		}
	}

	function cancelSignIn() {
		pendingSignIn?.cancel?.();
	}

	async function loadUser() {
		const body = await request('/api/me');
		const u = body?.user || {};
		return {
			id: u.id || null,
			name: u.display_name || u.username || u.handle || 'Your account',
			username: u.username || u.handle || null,
			avatarUrl: u.avatar_url || null,
		};
	}

	async function refresh() {
		if (refreshing) return refreshing;
		refreshing = (async () => {
			if (!state.refreshToken || !state.clientId) {
				save({ clientId: state.clientId, clientApiBase: state.clientApiBase, apiBase: apiBase() });
				throw new AuthError('Your session ended. Sign in again.');
			}
			try {
				const tokens = await refreshTokens({ apiBase: apiBase(), clientId: state.clientId, refreshToken: state.refreshToken, fetchImpl });
				save({ ...state, ...tokens });
			} catch (err) {
				// A 400 invalid_grant means the refresh token was revoked or already
				// rotated elsewhere: the session is over. Anything else (offline, a 5xx)
				// keeps the session so the next request can try again.
				if (err.status >= 400 && err.status < 500) {
					save({ clientId: state.clientId, clientApiBase: state.clientApiBase, apiBase: apiBase() });
					throw new AuthError('Your session ended. Sign in again.');
				}
				throw err;
			}
		})();
		try {
			return await refreshing;
		} finally {
			refreshing = null;
		}
	}

	async function authorizedFetch(path, init = {}) {
		if (!state.accessToken) throw new AuthError('Sign in to continue.');
		if (!String(path).startsWith('/api/')) throw new ApiError('Only /api paths are reachable', { status: 400, code: 'bad_path' });
		if (state.expiresAt && state.expiresAt - REFRESH_SKEW_MS < Date.now()) await refresh();
		const attempt = () => fetchImpl(`${apiBase()}${path}`, {
			...init,
			headers: { accept: 'application/json', ...(init.headers || {}), authorization: `Bearer ${state.accessToken}` },
		});
		let res = await attempt();
		if (res.status === 401 && state.refreshToken) {
			await refresh();
			res = await attempt();
		}
		if (res.status === 401) {
			save({ clientId: state.clientId, clientApiBase: state.clientApiBase, apiBase: apiBase() });
			throw new AuthError('Your session ended. Sign in again.');
		}
		return res;
	}

	// JSON request. Throws ApiError with the server's own message on a non-2xx.
	async function request(path, { method = 'GET', body, signal } = {}) {
		const res = await authorizedFetch(path, {
			method,
			signal,
			...(body !== undefined ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
		});
		let parsed = null;
		const text = await res.text();
		if (text) {
			try {
				parsed = JSON.parse(text);
			} catch {
				parsed = null;
			}
		}
		if (!res.ok) throw errorFromBody(res.status, parsed, `${method} ${path} failed with ${res.status}`);
		return parsed;
	}

	async function signOut() {
		const { refreshToken, accessToken, clientId } = state;
		save({ clientId: state.clientId, clientApiBase: state.clientApiBase, apiBase: apiBase() });
		// Revocation is best effort: the local session is already gone, and an
		// offline machine must still be able to sign out.
		const base = apiBase();
		await Promise.allSettled([
			refreshToken && clientId ? revokeToken({ apiBase: base, clientId, token: refreshToken, fetchImpl }) : null,
			accessToken && clientId ? revokeToken({ apiBase: base, clientId, token: accessToken, fetchImpl }) : null,
		]);
		return status();
	}

	async function refreshUser() {
		if (!state.accessToken) return status();
		const user = await loadUser();
		save({ ...state, user });
		return status();
	}

	return { status, signIn, cancelSignIn, signOut, request, authorizedFetch, refreshUser, apiBase };
}

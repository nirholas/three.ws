// OAuth 2.1 sign-in for a native app (RFC 8252), with no Electron in it so the
// whole flow is unit-testable from Node.
//
// The shape: register once as a public client whose redirect is the loopback
// IP literal, then on every sign-in bind an ephemeral port on 127.0.0.1, send
// the browser to /api/oauth/authorize with a PKCE challenge, and catch the code
// on that port. The authorization server accepts any port on a registered
// loopback IP redirect (RFC 8252 §7.3, api/oauth/[action].js), so the client
// registers exactly once per server and never burns the per-IP registration
// budget re-registering.

import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';

export const CALLBACK_PATH = '/callback';
export const REGISTERED_REDIRECT = `http://127.0.0.1${CALLBACK_PATH}`;

// What the console reads and does. `wallet:write` is here because approving a
// previewed send is a console feature; every such send still stops at the
// preview-id rule and a native confirmation (src/main/previews.js).
export const DESKTOP_SCOPES = Object.freeze([
	'profile',
	'offline_access',
	'agents:read',
	'agents:write',
	'avatars:read',
	'memory:read',
	'wallet:read',
	'wallet:write',
]);

const SIGN_IN_TIMEOUT_MS = 5 * 60_000;

function base64url(buf) {
	return Buffer.from(buf).toString('base64url');
}

export function pkcePair() {
	const verifier = base64url(randomBytes(32));
	const challenge = base64url(createHash('sha256').update(verifier).digest());
	return { verifier, challenge };
}

export function randomState() {
	return base64url(randomBytes(16));
}

async function readOAuthJson(res, what) {
	let body = null;
	try {
		body = await res.json();
	} catch {
		body = null;
	}
	if (!res.ok) {
		const code = body?.error || `http_${res.status}`;
		const detail = body?.error_description || body?.message || res.statusText;
		const err = new Error(`${what} failed: ${detail}`);
		err.code = code;
		err.status = res.status;
		throw err;
	}
	return body || {};
}

export async function registerClient({ apiBase, version, fetchImpl = fetch }) {
	const res = await fetchImpl(`${apiBase}/api/oauth/register`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			client_name: 'three.ws Desktop',
			client_uri: 'https://three.ws/desktop',
			logo_uri: 'https://three.ws/apple-touch-icon.png',
			redirect_uris: [REGISTERED_REDIRECT],
			token_endpoint_auth_method: 'none',
			grant_types: ['authorization_code', 'refresh_token'],
			response_types: ['code'],
			scope: DESKTOP_SCOPES.join(' '),
			software_id: 'ws.three.desktop',
			software_version: String(version || '0.0.0'),
		}),
	});
	const body = await readOAuthJson(res, 'Client registration');
	if (!body.client_id) throw new Error('Client registration returned no client_id');
	return { clientId: body.client_id, scope: body.scope || DESKTOP_SCOPES.join(' ') };
}

export function buildAuthorizeUrl({ apiBase, clientId, redirectUri, challenge, state, scope }) {
	const url = new URL('/api/oauth/authorize', apiBase);
	url.search = new URLSearchParams({
		response_type: 'code',
		client_id: clientId,
		redirect_uri: redirectUri,
		scope: scope || DESKTOP_SCOPES.join(' '),
		state,
		code_challenge: challenge,
		code_challenge_method: 'S256',
	}).toString();
	return url.toString();
}

const DONE_PAGE = (title, line) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>:root{color-scheme:dark light}body{margin:0;min-height:100vh;display:grid;place-items:center;font:15px/1.5 -apple-system,system-ui,Segoe UI,Roboto,sans-serif;background:#0d0d10;color:#e7e9ee}@media (prefers-color-scheme:light){body{background:#f5f5f7;color:#111}}.card{max-width:380px;padding:28px;text-align:center}h1{font-size:19px;margin:0 0 8px}p{margin:0;opacity:.7}</style></head><body><div class="card"><h1>${title}</h1><p>${line}</p></div></body></html>`;

function escapeHtml(s) {
	return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// Binds 127.0.0.1 on a port the OS picks and resolves with the authorization
// code once the browser comes back with a matching `state`. Any other request
// to the port gets a 404 and changes nothing.
export function listenForCallback({ state, timeoutMs = SIGN_IN_TIMEOUT_MS } = {}) {
	return new Promise((resolveListen, rejectListen) => {
		let settle;
		const codePromise = new Promise((resolve, reject) => {
			settle = { resolve, reject };
		});
		const server = createServer((req, res) => {
			const url = new URL(req.url, 'http://127.0.0.1');
			if (url.pathname !== CALLBACK_PATH) {
				res.writeHead(404).end();
				return;
			}
			const send = (status, title, line) => {
				res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
				res.end(DONE_PAGE(escapeHtml(title), escapeHtml(line)));
			};
			if (url.searchParams.get('state') !== state) {
				send(400, 'Sign-in did not match', 'This link belongs to a different sign-in attempt. Start again from the app.');
				return;
			}
			const oauthError = url.searchParams.get('error');
			if (oauthError) {
				send(200, 'Sign-in cancelled', 'Nothing was shared. You can close this tab.');
				const err = new Error(oauthError === 'access_denied' ? 'You cancelled the sign-in.' : `Sign-in failed: ${oauthError}`);
				err.code = oauthError;
				finish(err);
				return;
			}
			const code = url.searchParams.get('code');
			if (!code) {
				send(400, 'Sign-in failed', 'The server sent no authorization code. Start again from the app.');
				finish(new Error('The server returned no authorization code.'));
				return;
			}
			send(200, 'You are signed in', 'Return to three.ws Desktop. You can close this tab.');
			finish(null, code);
		});

		let timer = null;
		let done = false;
		function finish(err, code) {
			if (done) return;
			done = true;
			clearTimeout(timer);
			server.close();
			if (err) settle.reject(err);
			else settle.resolve(code);
		}

		server.on('error', (err) => rejectListen(err));
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address();
			timer = setTimeout(() => {
				const err = new Error('Sign-in timed out. Start again from the app.');
				err.code = 'timeout';
				finish(err);
			}, timeoutMs);
			resolveListen({
				redirectUri: `http://127.0.0.1:${port}${CALLBACK_PATH}`,
				code: codePromise,
				cancel: () => {
					const err = new Error('Sign-in cancelled.');
					err.code = 'cancelled';
					finish(err);
				},
			});
		});
	});
}

function tokenSet(body) {
	if (!body.access_token) throw new Error('The token endpoint returned no access token');
	return {
		accessToken: body.access_token,
		refreshToken: body.refresh_token || null,
		scope: body.scope || '',
		expiresAt: Date.now() + Number(body.expires_in || 3600) * 1000,
	};
}

async function postForm(url, form, fetchImpl) {
	return fetchImpl(url, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
		body: new URLSearchParams(form).toString(),
	});
}

export async function exchangeCode({ apiBase, clientId, code, redirectUri, verifier, fetchImpl = fetch }) {
	const res = await postForm(`${apiBase}/api/oauth/token`, {
		grant_type: 'authorization_code',
		client_id: clientId,
		code,
		redirect_uri: redirectUri,
		code_verifier: verifier,
	}, fetchImpl);
	return tokenSet(await readOAuthJson(res, 'Sign-in'));
}

// Refresh tokens rotate on every use (api/_lib/auth.js rotateRefreshToken), so
// the caller must persist the returned set before using it.
export async function refreshTokens({ apiBase, clientId, refreshToken, fetchImpl = fetch }) {
	const res = await postForm(`${apiBase}/api/oauth/token`, {
		grant_type: 'refresh_token',
		client_id: clientId,
		refresh_token: refreshToken,
	}, fetchImpl);
	return tokenSet(await readOAuthJson(res, 'Session refresh'));
}

export async function revokeToken({ apiBase, clientId, token, fetchImpl = fetch }) {
	const res = await postForm(`${apiBase}/api/oauth/revoke`, { client_id: clientId, token }, fetchImpl);
	return res.ok;
}

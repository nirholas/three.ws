// OAuth 2.1 authorization endpoint.
//   GET  → renders consent page (or redirects to login if no session)
//   POST → user accepted; issues an authorization code and redirects back.
//
// PKCE is mandatory (S256). No implicit flow. No password grant.

import { sql } from '../_lib/db.js';
import { getSessionUser, csrfTokenFor, verifyCsrfToken, isSameSiteOrigin } from '../_lib/auth.js';
import { randomToken } from '../_lib/crypto.js';
import { cors, method, wrap, error, redirect, readForm } from '../_lib/http.js';
import { env } from '../_lib/env.js';

const CODE_TTL_SEC = 60;

// OAuth 2.1 §3.1.2.2 — exact match on protocol/host/port/pathname.
// Request URI must carry no extra query params or fragment.
function redirectUriMatches(requested, registered) {
	let reqUrl;
	try {
		reqUrl = new URL(requested);
	} catch {
		return false;
	}
	if (reqUrl.hash) return false;
	if (reqUrl.search) return false;
	return registered.some((entry) => {
		let regUrl;
		try {
			regUrl = new URL(entry);
		} catch {
			return false;
		}
		return (
			reqUrl.protocol === regUrl.protocol &&
			reqUrl.host === regUrl.host &&
			reqUrl.port === regUrl.port &&
			reqUrl.pathname === regUrl.pathname
		);
	});
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	const params = req.method === 'POST' ? await readForm(req) : parseQuery(req.url);
	const {
		response_type,
		client_id,
		redirect_uri,
		scope,
		state,
		code_challenge,
		code_challenge_method,
		resource,
	} = params;

	if (response_type !== 'code')
		return error(res, 400, 'unsupported_response_type', 'only response_type=code supported');
	if (!client_id) return error(res, 400, 'invalid_request', 'client_id required');
	if (!redirect_uri) return error(res, 400, 'invalid_request', 'redirect_uri required');
	if (!code_challenge)
		return error(res, 400, 'invalid_request', 'code_challenge required (PKCE)');
	if (!code_challenge_method)
		return error(res, 400, 'invalid_request', 'code_challenge_method required (must be S256)');
	if (code_challenge_method !== 'S256')
		return error(res, 400, 'invalid_request', 'code_challenge_method must be S256');

	const rows = await sql`select * from oauth_clients where client_id = ${client_id} limit 1`;
	const client = rows[0];
	if (!client) return error(res, 400, 'invalid_client', 'unknown client');
	if (!redirectUriMatches(redirect_uri, client.redirect_uris)) {
		return error(res, 400, 'invalid_redirect_uri', 'redirect_uri not registered');
	}

	const user = await getSessionUser(req);
	if (!user) {
		// Bounce to login, preserving the consent URL.
		const next = encodeURIComponent(`/oauth/consent?${new URLSearchParams(params).toString()}`);
		return redirect(res, `/login?next=${next}`);
	}

	if (req.method === 'GET') {
		// Render a simple consent page. Kept server-side to avoid shipping extra JS.
		const csrf = await csrfTokenFor(req);
		return renderConsent(res, { client, user, params, csrf });
	}

	// POST — user confirmed consent. Reject cross-site POSTs (Origin check) and
	// forged submissions (CSRF token bound to the session cookie).
	if (!isSameSiteOrigin(req)) return error(res, 403, 'forbidden', 'cross-site request blocked');
	if (!(await verifyCsrfToken(req, params.csrf)))
		return error(res, 403, 'forbidden', 'invalid csrf token');

	if (params.decision !== 'allow') {
		const denied = new URL(redirect_uri);
		denied.searchParams.set('error', 'access_denied');
		if (state) denied.searchParams.set('state', state);
		return redirect(res, denied.toString());
	}

	const code = randomToken(24);
	const grantedScope = intersectScopes(scope || client.scope, client.scope);
	await sql`
		insert into oauth_auth_codes (code, client_id, user_id, redirect_uri, scope, resource, code_challenge, code_challenge_method, expires_at)
		values (${code}, ${client_id}, ${user.id}, ${redirect_uri}, ${grantedScope}, ${resource ?? env.MCP_RESOURCE},
		        ${code_challenge}, 'S256', now() + ${`${CODE_TTL_SEC} seconds`}::interval)
	`;

	const back = new URL(redirect_uri);
	back.searchParams.set('code', code);
	if (state) back.searchParams.set('state', state);
	return redirect(res, back.toString());
});

function parseQuery(url) {
	const q = new URL(url, 'http://x').searchParams;
	return Object.fromEntries(q);
}

function intersectScopes(requested, allowed) {
	const a = new Set(allowed.split(/\s+/).filter(Boolean));
	return (
		requested
			.split(/\s+/)
			.filter((s) => a.has(s))
			.join(' ') || allowed
	);
}

function renderConsent(res, { client, user, params, csrf }) {
	res.statusCode = 200;
	res.setHeader('content-type', 'text/html; charset=utf-8');
	res.setHeader('cache-control', 'no-store');
	// Harden the consent page against clickjacking, mixed content, and
	// extension/CDN script injection. form-action restricts where the form
	// can POST; frame-ancestors blocks iframing of the consent UI.
	res.setHeader(
		'content-security-policy',
		"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
	);
	res.setHeader('x-frame-options', 'DENY');
	res.setHeader('x-content-type-options', 'nosniff');
	res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
	res.setHeader('strict-transport-security', 'max-age=63072000; includeSubDomains; preload');
	const scope = params.scope || client.scope;
	const scopeList = scope.split(/\s+/).filter(Boolean);
	res.end(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Authorize ${esc(client.name)} · three.ws</title>
<style>
	:root { color-scheme: light dark; }
	body { font: 16px/1.5 -apple-system,system-ui,Segoe UI,Roboto,sans-serif; background:#0b0b10; color:#eee; margin:0; min-height:100vh; display:grid; place-items:center; padding:24px; }
	.card { background:#14141c; border:1px solid #2a2a36; border-radius:16px; padding:28px 28px 24px; max-width:440px; width:100%; box-shadow:0 10px 40px rgba(0,0,0,.4); }
	h1 { font-size:20px; margin:0 0 8px; }
	.sub { color:#aaa; margin:0 0 20px; }
	.who { display:flex; align-items:center; gap:10px; margin-bottom:16px; padding:10px 12px; background:#1b1b25; border-radius:10px; }
	.dot { width:32px; height:32px; border-radius:50%; background:linear-gradient(135deg,#6a5cff,#ff5ca8); display:grid; place-items:center; color:#fff; font-weight:600; }
	ul { margin:12px 0 20px; padding-left:0; list-style:none; }
	li { padding:8px 0; border-bottom:1px solid #22222e; display:flex; gap:10px; }
	li:last-child { border:0; }
	li::before { content:"✓"; color:#6a5cff; }
	.actions { display:flex; gap:10px; }
	button { flex:1; padding:12px 16px; border-radius:10px; border:0; font-size:15px; font-weight:600; cursor:pointer; }
	.allow { background:#6a5cff; color:#fff; }
	.deny { background:transparent; color:#aaa; border:1px solid #2a2a36; }
	.foot { margin-top:16px; font-size:12px; color:#777; }
	a { color:#9a8cff; }
</style>
</head><body><form class="card" method="post" action="/api/oauth/authorize">
	<h1>Authorize <b>${esc(client.name)}</b></h1>
	<p class="sub">Grant this application access to your three.ws account.</p>
	<div class="who"><div class="dot">${esc((user.display_name || user.email)[0].toUpperCase())}</div><div><div>${esc(user.display_name || user.email)}</div><div style="color:#888;font-size:13px">${esc(user.email)}</div></div></div>
	<p style="margin:0 0 4px"><b>${esc(client.name)}</b> will be able to:</p>
	<ul>${scopeList.map((s) => `<li>${scopeLabel(s)}</li>`).join('')}</ul>
	<input type="hidden" name="csrf" value="${esc(csrf || '')}">
	${Object.entries(params)
		.filter(([k]) => k !== 'csrf' && k !== 'decision')
		.map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
		.join('')}
	<div class="actions">
		<button class="deny"  type="submit" name="decision" value="deny">Cancel</button>
		<button class="allow" type="submit" name="decision" value="allow">Authorize</button>
	</div>
	<p class="foot">You can revoke access any time from your <a href="/dashboard/connections">dashboard</a>.</p>
</form></body></html>`);
}

function scopeLabel(s) {
	const labels = {
		'avatars:read': 'Read your avatars',
		'avatars:write': 'Create and update avatars',
		'avatars:delete': 'Delete your avatars',
		profile: 'See your name and email',
		offline_access: 'Stay signed in across sessions',
	};
	return labels[s] || esc(s);
}

function esc(s) {
	return String(s).replace(
		/[&<>"']/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
	);
}

// Sign in with Google: a direct OpenID Connect authorization code flow with
// PKCE. Dispatches on ?action=start|callback|confirm|status|unlink.
//
// Env required: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET (a "Web
// application" OAuth client in the Google Cloud console whose authorized
// redirect URI is `${APP_ORIGIN}/api/auth/google/callback`). Unset, /start
// sends a browser back to /login with ?error=google_unavailable and answers an
// API caller 501 not_configured, so the button on /login and the choice on the
// MCP authorization screen simply do not appear (api/config.js googleEnabled).
//
// Three intents share one round trip to Google (api/_lib/identities.js):
//
//   login   no session needed. A Google account that is already linked signs
//           straight in. One that is not: when Google vouches for the email
//           and a three.ws account with that verified email exists, the person
//           is shown a confirm step ("link Google to this account?") and only
//           their explicit yes links it; otherwise a new account is created
//           with no password, signed in with Google alone.
//   link    needs a session. Links the Google account to the signed-in user.
//   reauth  needs a session. Fresh credential entry (prompt=login, max_age=0),
//           granting the five-minute proof that unlinking honors.
//
// Signing in creates a session and never destroys the person's other sessions,
// so a second MCP client connecting (Claude, then ChatGPT) does not sign the
// first one out.
//
// Error states, all clean: a login failure lands on /login?error=google_<code>
// with a message the page knows; a link or reauth failure lands back on the
// settings card with ?google=<code>; never a raw JSON body in the address bar.

import { sql } from '../../_lib/db.js';
import {
	getSessionUser, createSession, sessionCookie, verifyPassword,
} from '../../_lib/auth.js';
import { requireCsrf } from '../../_lib/csrf.js';
import {
	cors, method, wrap, error, json, redirect, readForm, readJson, rateLimited, wantsHtmlNavigation,
} from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { env } from '../../_lib/env.js';
import { logAudit } from '../../_lib/audit.js';
import { seedDefaultAgent } from '../../_lib/seed-default-agent.js';
import { safeNext } from '../../../src/safe-next.js';
import {
	googleConfigured, startGoogleFlow, readGoogleFlow, exchangeGoogleCode, verifyGoogleIdToken,
	findUserByIdentity, touchIdentity, linkIdentity, listSignInMethods, reauthCookie, readReauth,
	unlinkIdentity, IdentityError, INTENTS, FLOW_COOKIE, REAUTH_TTL_SEC, cookie, clearCookie,
	readCookie, signIdentityPayload, unsignIdentityPayload,
} from '../../_lib/identities.js';

const PROVIDER = 'google';
const SETTINGS_URL = '/dashboard/settings#sign-in-methods';
// The pending "link to your existing account?" decision rides in its own
// signed cookie: the claims Google verified, the account they matched, and
// where to go afterwards. Five minutes is long enough to read the page.
const LINK_COOKIE = '__Host-glink';
const LINK_TTL_SEC = 300;

function loginUrl(code, next) {
	const q = new URLSearchParams({ error: code });
	if (next) q.set('next', next);
	return `/login?${q.toString()}`;
}

function settingsUrl(outcome) {
	return `/dashboard/settings?google=${encodeURIComponent(outcome)}#sign-in-methods`;
}

// Where a flow that started on /login ends. The MCP authorize path sends the
// browser to /login?next=/oauth/consent?..., so this is what carries a person
// from Google straight back to the consent screen.
function finish(res, next) {
	return redirect(res, safeNext(next, '/dashboard'));
}

async function signIn(req, res, userId, { isNew = false } = {}) {
	// No destroySession: the person may be signing in from a second client
	// while the first stays connected, and each session is its own cookie.
	const token = await createSession({ userId, userAgent: req.headers['user-agent'], ip: clientIp(req) });
	const cookies = [sessionCookie(token), clearCookie(FLOW_COOKIE), clearCookie(LINK_COOKIE)];
	res.setHeader('set-cookie', cookies);
	logAudit({ userId, action: isNew ? 'register:google' : 'login:google', req });
	if (isNew) queueMicrotask(() => seedDefaultAgent(userId));
}

// ── start ─────────────────────────────────────────────────────────────────────

async function handleStart(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;
	const url = new URL(req.url, 'http://x');
	const intent = url.searchParams.get('intent') || 'login';
	const next = safeNext(url.searchParams.get('next'), '/dashboard');
	if (!INTENTS.includes(intent)) return error(res, 400, 'validation_error', `intent must be one of ${INTENTS.join(', ')}`);
	if (!googleConfigured()) {
		if (wantsHtmlNavigation(req)) {
			return redirect(res, intent === 'login' ? loginUrl('google_unavailable', next) : settingsUrl('unavailable'));
		}
		return error(res, 501, 'not_configured', 'Google sign-in is not configured');
	}
	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) {
		if (wantsHtmlNavigation(req)) return redirect(res, intent === 'login' ? loginUrl('rate_limited', next) : settingsUrl('rate_limited'));
		return rateLimited(res, rl);
	}
	let userId = null;
	let loginHint = null;
	if (intent !== 'login') {
		const user = await getSessionUser(req, res);
		if (!user) return redirect(res, `/login?next=${encodeURIComponent(SETTINGS_URL)}`);
		const rlLink = await limits.identityLink(user.id);
		if (!rlLink.success) return redirect(res, settingsUrl('rate_limited'));
		userId = user.id;
		if (intent === 'reauth') {
			const [linked] = await sql`select email from user_identities where user_id = ${userId} and provider = ${PROVIDER} limit 1`;
			if (!linked) return redirect(res, settingsUrl('not_linked'));
			loginHint = linked.email;
		}
	}
	const { url: authUrl, cookie: flowCookie } = await startGoogleFlow({ intent, userId, next, loginHint });
	res.setHeader('set-cookie', flowCookie);
	return redirect(res, authUrl);
}

// ── callback ──────────────────────────────────────────────────────────────────

// Google's own error codes, mapped onto the one the login page explains.
function googleDeniedCode(googleError) {
	if (googleError === 'access_denied' || googleError === 'interaction_required') return 'google_cancelled';
	return 'google_failed';
}

async function handleCallback(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;
	const url = new URL(req.url, 'http://x');
	const state = url.searchParams.get('state');
	const flow = state ? await readGoogleFlow(req, state) : null;
	const back = (code) => {
		res.setHeader('set-cookie', clearCookie(FLOW_COOKIE));
		if (!flow || flow.intent === 'login') return redirect(res, loginUrl(code, flow?.next));
		return redirect(res, settingsUrl(code.replace(/^google_/, '')));
	};
	if (!flow) return back('google_expired');
	if (url.searchParams.get('error')) return back(googleDeniedCode(url.searchParams.get('error')));
	const code = url.searchParams.get('code');
	if (!code) return back('google_failed');
	if (!googleConfigured()) return back('google_unavailable');

	let claims;
	try {
		const idToken = await exchangeGoogleCode({ code, verifier: flow.verifier });
		claims = await verifyGoogleIdToken(idToken, {
			nonce: flow.nonce,
			maxAuthAgeSec: flow.intent === 'reauth' ? REAUTH_TTL_SEC : null,
		});
	} catch (err) {
		if (err instanceof IdentityError) return back(`google_${err.code}`);
		throw err;
	}

	if (flow.intent === 'link') return completeLink(req, res, flow, claims);
	if (flow.intent === 'reauth') return completeReauth(req, res, flow, claims);
	return completeLogin(req, res, flow, claims);
}

async function completeLogin(req, res, flow, claims) {
	const linked = await findUserByIdentity(PROVIDER, claims.subject);
	if (linked) {
		if (linked.deleted_at) return redirect(res, loginUrl('account_deleted'));
		await touchIdentity(linked.identity_id);
		await signIn(req, res, linked.id);
		return finish(res, flow.next);
	}
	// Not linked yet. Google must vouch for the address before it can reach an
	// existing account or name a new one.
	if (!claims.email || !claims.email_verified) return redirect(res, loginUrl('google_email_unverified', flow.next));
	const [existing] = await sql`
		select id, deleted_at, email_verified from users where email = ${claims.email} limit 1
	`;
	if (existing?.deleted_at) return redirect(res, loginUrl('account_deleted'));
	if (existing) {
		// An account this platform never verified may belong to someone who
		// registered the address ahead of its owner; linking it would hand the
		// real owner the squatter's account (api/auth/privy/verify.js has the
		// same rule). The person signs in with that account's own method and
		// links Google from settings, where a session proves ownership.
		if (!existing.email_verified) return redirect(res, loginUrl('google_unverified_account', flow.next));
		// Verified email match: never silently merge. Show the confirm step.
		const pending = await signIdentityPayload({
			c: claims,
			u: existing.id,
			x: flow.next,
			e: Math.floor(Date.now() / 1000) + LINK_TTL_SEC,
		});
		res.setHeader('set-cookie', [cookie(LINK_COOKIE, pending, LINK_TTL_SEC), clearCookie(FLOW_COOKIE)]);
		return renderConfirm(res, { claims, next: flow.next });
	}
	const userId = await createGoogleUser(claims);
	await linkIdentity({ userId, provider: PROVIDER, claims });
	await signIn(req, res, userId, { isNew: true });
	return finish(res, flow.next);
}

// A new passwordless account from verified Google claims. Google verified the
// address, so the row is born email_verified: the welcome and recovery mail
// goes to an inbox we know the person owns.
async function createGoogleUser(claims) {
	const displayName = claims.display_name || claims.email.split('@')[0];
	const [row] = await sql`
		insert into users (email, display_name, email_verified)
		values (${claims.email}, ${displayName}, true)
		on conflict (email) do update set email_verified = true
		returning id, deleted_at
	`;
	if (row.deleted_at) throw new IdentityError('account_deleted', 'this account has been deleted', 403);
	return row.id;
}

async function completeLink(req, res, flow, claims) {
	const user = await getSessionUser(req, res);
	if (!user || user.id !== flow.userId) return redirect(res, settingsUrl('session_changed'));
	try {
		const result = await linkIdentity({ userId: user.id, provider: PROVIDER, claims });
		logAudit({ userId: user.id, action: 'identity:link', meta: { provider: PROVIDER, relinked: result.relinked }, req });
	} catch (err) {
		if (err instanceof IdentityError) return redirect(res, settingsUrl(err.code));
		throw err;
	}
	res.setHeader('set-cookie', clearCookie(FLOW_COOKIE));
	return redirect(res, settingsUrl('linked'));
}

async function completeReauth(req, res, flow, claims) {
	const user = await getSessionUser(req, res);
	if (!user || user.id !== flow.userId) return redirect(res, settingsUrl('session_changed'));
	const linked = await findUserByIdentity(PROVIDER, claims.subject);
	if (!linked || linked.id !== user.id) return redirect(res, settingsUrl('wrong_account'));
	res.setHeader('set-cookie', [await reauthCookie(user.id, PROVIDER), clearCookie(FLOW_COOKIE)]);
	return redirect(res, reauthReturnUrl(flow.next));
}

// A re-authentication started from another page (an owner approving an agent's
// limit change on /commerce) returns there; one started from settings, which
// passes no next, lands back on settings with its outcome banner.
function reauthReturnUrl(next) {
	const back = safeNext(next, '/dashboard');
	if (back === '/dashboard') return settingsUrl('reauthenticated');
	const url = new URL(back, 'https://three.ws');
	url.searchParams.set('google', 'reauthenticated');
	return `${url.pathname}${url.search}${url.hash}`;
}

// ── confirm (link Google to an existing account by verified email) ───────────

function esc(s) {
	return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function renderConfirm(res, { claims, next }) {
	res.statusCode = 200;
	res.setHeader('content-type', 'text/html; charset=utf-8');
	res.setHeader('cache-control', 'no-store');
	res.setHeader('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; img-src https:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
	res.setHeader('x-frame-options', 'DENY');
	res.setHeader('x-content-type-options', 'nosniff');
	res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
	const name = claims.display_name || claims.email;
	res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Link Google to your account · three.ws</title><style>:root{color-scheme:light dark}body{font:16px/1.5 -apple-system,system-ui,Segoe UI,Roboto,sans-serif;background:#0b0b10;color:#eee;margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}.card{background:#14141c;border:1px solid #2a2a36;border-radius:16px;padding:28px 28px 24px;max-width:440px;width:100%;box-shadow:0 10px 40px rgba(0,0,0,.4)}h1{font-size:20px;margin:0 0 8px}.sub{color:#aaa;margin:0 0 20px}.who{display:flex;align-items:center;gap:10px;margin-bottom:16px;padding:10px 12px;background:#1b1b25;border-radius:10px}.who img,.dot{width:32px;height:32px;border-radius:50%}.dot{background:linear-gradient(135deg,#6a5cff,#ff5ca8);display:grid;place-items:center;color:#fff;font-weight:600}.email{color:#888;font-size:13px}.note{margin:0 0 20px;padding:10px 12px;border-radius:10px;background:#1b1b25;border:1px solid #2a2a36;font-size:13px;color:#bbb}.actions{display:flex;gap:10px}button{flex:1;padding:12px 16px;border-radius:10px;border:0;font-size:15px;font-weight:600;cursor:pointer;transition:filter .15s,transform .15s}button:hover{filter:brightness(1.1)}button:active{transform:scale(.98)}button:focus-visible{outline:2px solid #9a8cff;outline-offset:2px}.allow{background:#6a5cff;color:#fff}.deny{background:transparent;color:#aaa;border:1px solid #2a2a36}.foot{margin-top:16px;font-size:12px;color:#777}</style></head><body><form class="card" method="post" action="/api/auth/google/confirm"><h1>Link Google to your account?</h1><p class="sub">A three.ws account already uses this email address.</p><div class="who">${claims.avatar_url ? `<img src="${esc(claims.avatar_url)}" alt="" referrerpolicy="no-referrer">` : `<div class="dot">${esc(name[0].toUpperCase())}</div>`}<div><div>${esc(name)}</div><div class="email">${esc(claims.email)}</div></div></div><p class="note">Google confirmed you own <b>${esc(claims.email)}</b>, and so did three.ws when that account verified its email. Linking lets you sign in to that account with Google from now on. Your password and wallets keep working. You can unlink Google any time from Settings.</p><input type="hidden" name="next" value="${esc(next || '')}"><div class="actions"><button class="deny" type="submit" name="decision" value="cancel">Not my account</button><button class="allow" type="submit" name="decision" value="link">Link and sign in</button></div><p class="foot">If this is not your account, choose "Not my account" and nothing is changed.</p></form></body></html>`);
}

async function handleConfirm(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;
	const form = await readForm(req);
	const pending = await unsignIdentityPayload(readCookie(req, LINK_COOKIE));
	if (!pending?.c?.subject || !pending.u) {
		res.setHeader('set-cookie', clearCookie(LINK_COOKIE));
		return redirect(res, loginUrl('google_expired'));
	}
	const next = safeNext(pending.x, '/dashboard');
	if (form.decision !== 'link') {
		res.setHeader('set-cookie', clearCookie(LINK_COOKIE));
		return redirect(res, loginUrl('google_not_linked', next));
	}
	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return redirect(res, loginUrl('rate_limited', next));
	const [user] = await sql`select id, deleted_at, email_verified from users where id = ${pending.u} limit 1`;
	if (!user || user.deleted_at) return redirect(res, loginUrl('account_deleted'));
	if (!user.email_verified) return redirect(res, loginUrl('google_unverified_account', next));
	try {
		await linkIdentity({ userId: user.id, provider: PROVIDER, claims: pending.c });
	} catch (err) {
		if (err instanceof IdentityError) return redirect(res, loginUrl(`google_${err.code}`, next));
		throw err;
	}
	logAudit({ userId: user.id, action: 'identity:link', meta: { provider: PROVIDER, via: 'login_confirm' }, req });
	await signIn(req, res, user.id);
	return finish(res, next);
}

// ── status / unlink (settings card) ───────────────────────────────────────────

async function handleStatus(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;
	const user = await getSessionUser(req, res);
	if (!user) return error(res, 401, 'unauthorized', 'sign in to see your sign-in methods');
	const methods = await listSignInMethods(user.id);
	const google = methods.identities.find((i) => i.provider === PROVIDER) || null;
	return json(res, 200, {
		configured: googleConfigured(),
		google,
		password: methods.password,
		email_code: methods.email_code,
		wallets: methods.wallets.length,
		count: methods.count,
		reauthenticated: (await readReauth(req, user.id)) === PROVIDER,
	});
}

async function handleUnlink(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;
	const user = await getSessionUser(req, res);
	if (!user) return error(res, 401, 'unauthorized', 'sign in first');
	if (!(await requireCsrf(req, res, user.id))) return;
	const body = await readJson(req);
	// Unlinking a sign-in method needs a fresh proof the person at the keyboard
	// owns the account: the account password, or having just signed in to the
	// linked Google account again (the reauth intent, five-minute cookie).
	let proven = (await readReauth(req, user.id)) === PROVIDER;
	if (!proven && typeof body?.password === 'string' && body.password) {
		const [row] = await sql`select password_hash from users where id = ${user.id} limit 1`;
		proven = Boolean(row?.password_hash) && (await verifyPassword(body.password, row.password_hash));
	}
	if (!proven) return error(res, 401, 'reauth_required', 'confirm your password, or sign in with Google again, before unlinking');
	try {
		const result = await unlinkIdentity({ userId: user.id, provider: PROVIDER });
		logAudit({ userId: user.id, action: 'identity:unlink', meta: { provider: PROVIDER }, req });
		return json(res, 200, result);
	} catch (err) {
		if (err instanceof IdentityError) return error(res, err.status, err.code, err.message, err.extra);
		throw err;
	}
}

// ── dispatcher ────────────────────────────────────────────────────────────────

const DISPATCH = {
	start: handleStart,
	callback: handleCallback,
	confirm: handleConfirm,
	status: handleStatus,
	unlink: handleUnlink,
};

export default wrap(async (req, res) => {
	const action = req.query?.action ?? new URL(req.url, 'http://x').pathname.split('/').pop();
	const fn = DISPATCH[action];
	if (!fn) return error(res, 404, 'not_found', `unknown google auth action: ${action}`);
	return fn(req, res);
});

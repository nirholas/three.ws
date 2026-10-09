// /api/auth/handoff: carry a signed-in session from the iOS app into Safari.
//
//   POST { next }        (app WebView, session cookie) -> { url, expires_at }
//   GET  ?code=&next=    (Safari) -> 302 to next with a fresh session cookie
//   GET  ?next=          (Safari) -> 302 to next, signed out (no session to carry)
//
// Why this exists: the iOS app sends payments, token launches and trading out
// to Safari (App Review guidelines 3.1.1 and 3.1.5; ios/docs/REVIEW-RISK.md).
// Safari keeps its own cookie jar, so the __Host-sid cookie the app's WebView
// holds never reaches it, and without a handoff the visitor would land signed
// out on the one page that exists to spend their money. The WebView mints a
// code here, same-origin, and the app opens the returned URL in Safari, which
// exchanges it for a session of its own.
//
// The code is the credential, so it is treated like one: 32 random bytes,
// stored only as a sha256, valid for sixty seconds, and consumed by the same
// statement that checks it, so a URL that leaks (history, a screenshot, a
// shoulder) is dead by the time anyone could reuse it. Minting requires the
// request to come from three.ws itself, the same posture as extension-token.js.
// The landing path is validated as same-origin at both ends, so the endpoint
// can never be turned into an open redirect.
//
// Every app-to-Safari hop goes through this path, signed in or not, because
// /api/* is the one part of three.ws the apple-app-site-association file
// (api/wk.js) keeps out of universal links. Opening https://three.ws/launch
// directly from the app would be claimed by the app again and never reach
// Safari; /api/auth/handoff?next=/launch always does.

import { createSession, destroySession, getSessionUser, isSameSiteOrigin, sessionCookie } from '../_lib/auth.js';
import { logAudit } from '../_lib/audit.js';
import { randomToken, sha256 } from '../_lib/crypto.js';
import { sql } from '../_lib/db.js';
import { env } from '../_lib/env.js';
import { cors, error, json, method, rateLimited, readJson, redirect, wrap } from '../_lib/http.js';
import { clientIp, limits } from '../_lib/rate-limit.js';

export const HANDOFF_TTL_SEC = 60;
const MAX_NEXT_LENGTH = 2048;

/**
 * A same-origin path, or null. Rejects protocol-relative (`//host`) and
 * backslash (`/\host`, which browsers normalise to `//host`) forms, control
 * characters, and anything that is not a path at all.
 */
export function safeHandoffPath(next) {
	if (typeof next !== 'string' || next.length === 0 || next.length > MAX_NEXT_LENGTH) return null;
	if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return null;
	// eslint-disable-next-line no-control-regex
	if (/[\u0000-\u001f\u007f]/.test(next)) return null;
	try {
		const url = new URL(next, 'https://three.ws');
		if (url.origin !== 'https://three.ws') return null;
		return `${url.pathname}${url.search}${url.hash}`;
	} catch {
		return null;
	}
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST'])) return;
	if (req.method === 'POST') return mint(req, res);
	return exchange(req, res);
});

async function mint(req, res) {
	// Only three.ws itself may mint. A foreign page cannot read the response
	// anyway (CORS), but refusing it outright keeps the surface to one origin.
	if (!isSameSiteOrigin(req)) return error(res, 403, 'forbidden', 'handoff codes are minted from three.ws only');

	const session = await getSessionUser(req);
	if (!session) return error(res, 401, 'unauthorized', 'sign in first');

	const rl = await limits.sessionHandoffUser(session.id);
	if (!rl.success) return rateLimited(res, rl);

	const body = await readJson(req, 8_192);
	const next = safeHandoffPath(body?.next);
	if (!next) return error(res, 400, 'invalid_next', 'next must be a path on three.ws');

	const code = randomToken(32);
	const expiresAt = new Date(Date.now() + HANDOFF_TTL_SEC * 1000);
	await sql`
		insert into session_handoffs (code_hash, user_id, next_path, expires_at)
		values (${await sha256(code)}, ${session.id}, ${next}, ${expiresAt.toISOString()})
	`;

	const url = new URL('/api/auth/handoff', env.APP_ORIGIN);
	url.searchParams.set('code', code);
	// Carried in the clear only so an expired code can still send the visitor
	// to sign in with their destination intact; the code's own row is what
	// decides where a successful exchange lands.
	url.searchParams.set('next', next);
	res.setHeader('cache-control', 'no-store');
	return json(res, 200, { url: url.href, expires_at: expiresAt.toISOString() });
}

async function exchange(req, res) {
	const url = new URL(req.url, env.APP_ORIGIN);
	const code = url.searchParams.get('code') || '';
	const fallbackNext = safeHandoffPath(url.searchParams.get('next')) || '/';
	const toLogin = (reason) => redirect(res, `${env.APP_ORIGIN}/login?error=${reason}&next=${encodeURIComponent(fallbackNext)}`);
	// The landing page must not see this URL as its referrer, consumed or not.
	res.setHeader('referrer-policy', 'no-referrer');

	// No code: a signed-out visitor leaving the app. Nothing to exchange, just
	// land them on the page they asked for.
	if (!url.searchParams.has('code')) return redirect(res, `${env.APP_ORIGIN}${fallbackNext}`);

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return toLogin('rate_limited');
	if (!/^[A-Za-z0-9_-]{32,128}$/.test(code)) return toLogin('handoff_expired');

	const [row] = await sql`
		update session_handoffs h
		set consumed_at = now()
		from users u
		where h.code_hash = ${await sha256(code)}
		  and h.consumed_at is null
		  and h.expires_at > now()
		  and u.id = h.user_id
		  and u.deleted_at is null
		returning h.user_id, h.next_path
	`;
	// Housekeeping rides along with real traffic instead of needing a cron.
	sql`delete from session_handoffs where created_at < now() - interval '1 day'`.catch(() => {});
	if (!row) return toLogin('handoff_expired');

	// Whoever this browser was signed in as before, it is now the app's user:
	// the visitor asked the app to continue here as themselves.
	await destroySession(req);
	const token = await createSession({ userId: row.user_id, userAgent: req.headers['user-agent'], ip: clientIp(req) });
	res.setHeader('set-cookie', sessionCookie(token));
	logAudit({ userId: row.user_id, action: 'login', req, meta: { method: 'ios_handoff' } });
	return redirect(res, `${env.APP_ORIGIN}${safeHandoffPath(row.next_path) || '/'}`);
}

// First-touch attribution for visitors who arrive from X.
//
// The @trythreews pipeline had no way to tell whether a post brought anyone in:
// the landing analytics only ran on the home page and went through a PostHog
// facade that is never loaded, so every event was a no-op. This records it
// first-party, with no third party and no personal data:
//
//   1. A page navigation whose Referer is X (t.co, x.com, twitter.com) and that
//      carries no touch yet gets an HttpOnly cookie naming the source, the page
//      it landed on, and when.
//   2. The first later request that carries both that cookie and a session
//      claims it: if the account was created after the touch, it is an X signup
//      and is written to acquisition_touches; either way the cookie is cleared.
//      Claiming on the server covers every way to sign up (password, OAuth,
//      wallet, Privy, Telegram) without touching each of them.
//
// The x-content plan reads acquisition_touches back per landing page, which is
// how a post's link is tied to the signups it brought.

export const TOUCH_COOKIE = 'tws_touch';
export const TOUCH_MAX_AGE_SECONDS = 30 * 24 * 3600;

const X_HOSTS = /^(?:t\.co|(?:[a-z0-9-]+\.)?(?:x|twitter)\.com)$/i;

// The source a Referer header names, or null for anything we do not attribute.
export function referralSource(referer) {
	try {
		const host = new URL(String(referer || '')).hostname;
		return X_HOSTS.test(host) ? 'x' : null;
	} catch {
		return null;
	}
}

// A page path safe to keep in a cookie and a column: the path only (no query,
// which can carry tokens), bounded, and limited to URL path characters.
export function landingPath(path) {
	const clean = String(path || '/').split(/[?#]/)[0].replace(/[^A-Za-z0-9/_.~-]/g, '');
	return (clean.startsWith('/') ? clean : `/${clean}`).slice(0, 160) || '/';
}

export function encodeTouch({ source, landing, at }) {
	return `${source}.${Buffer.from(landingPath(landing)).toString('base64url')}.${Math.floor(at / 1000)}`;
}

export function decodeTouch(value) {
	const match = /^([a-z]{1,16})\.([A-Za-z0-9_-]{1,240})\.(\d{9,11})$/.exec(String(value || ''));
	if (!match) return null;
	return { source: match[1], landing: landingPath(Buffer.from(match[2], 'base64url').toString('utf8')), at: Number(match[3]) * 1000 };
}

export function readCookie(header, name) {
	for (const part of String(header || '').split(';')) {
		const at = part.indexOf('=');
		if (at > 0 && part.slice(0, at).trim() === name) return decodeURIComponent(part.slice(at + 1).trim());
	}
	return null;
}

const cookieLine = (value, maxAge) => `${TOUCH_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;

function appendCookie(res, line) {
	const existing = res.getHeader('set-cookie') || [];
	res.setHeader('set-cookie', [...(Array.isArray(existing) ? existing : [existing]), line]);
}

// A top-level page load, not an asset, an API call, or a prefetch.
export function isNavigation(req) {
	if (req.method !== 'GET') return false;
	const dest = req.headers['sec-fetch-dest'];
	if (dest) return dest === 'document';
	return /text\/html/.test(String(req.headers.accept || ''));
}

// Whether the account counts as a signup this touch brought: created after the
// visitor arrived from X, within the cookie's lifetime.
export function broughtSignup(touch, createdAt) {
	const created = Date.parse(createdAt);
	return Number.isFinite(created) && created >= touch.at && created - touch.at <= TOUCH_MAX_AGE_SECONDS * 1000;
}

// Express middleware. `deps` exists so tests can run it without a database.
export function acquisitionMiddleware(deps = {}) {
	const now = deps.now || (() => Date.now());
	const sessionUser = deps.sessionUser || sessionAccount;
	const record = deps.record || recordTouch;
	const hasSession = deps.hasSession || ((req) => /(?:^|;\s*)__Host-sid=/.test(String(req.headers.cookie || '')));
	return async function acquisition(req, res, next) {
		// Page loads only: an asset burst would claim the same touch twenty times.
		if (!isNavigation(req)) return next();
		try {
			const touch = decodeTouch(readCookie(req.headers.cookie, TOUCH_COOKIE));
			if (touch && hasSession(req)) {
				const user = await sessionUser(req);
				if (user) {
					if (broughtSignup(touch, user.created_at)) await record({ userId: user.id, ...touch });
					appendCookie(res, cookieLine('', 0));
				}
			} else if (!touch) {
				const source = referralSource(req.headers.referer);
				if (source) appendCookie(res, cookieLine(encodeTouch({ source, landing: req.path, at: now() }), TOUCH_MAX_AGE_SECONDS));
			}
		} catch (err) {
			console.warn('[acquisition] touch skipped:', err?.message || err);
		}
		next();
	};
}

// The signed-in account and when it was created. getSessionUser does not
// select created_at, so it is read here, only for a request carrying a touch.
async function sessionAccount(req) {
	const { getSessionUser } = await import('./auth.js');
	const user = await getSessionUser(req);
	if (!user) return null;
	const { sql } = await import('./db.js');
	const [row] = await sql`select created_at from users where id = ${user.id}`;
	return row ? { id: user.id, created_at: row.created_at } : null;
}

export async function recordTouch({ userId, source, landing, at }) {
	const { sql } = await import('./db.js');
	await sql`
		insert into acquisition_touches (user_id, source, landing_path, touched_at)
		values (${userId}, ${source}, ${landing}, ${new Date(at).toISOString()})
		on conflict (user_id) do nothing
	`;
}

// Signups per landing page from one source since a date, most first.
export async function signupsByLanding({ source = 'x', since }) {
	const { sql } = await import('./db.js');
	return sql`
		select landing_path, count(*)::int as signups, max(touched_at) as last_touch
		from acquisition_touches
		where source = ${source} and touched_at >= ${since}
		group by landing_path
		order by signups desc, landing_path
	`;
}

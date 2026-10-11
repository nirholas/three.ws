// Sign in with Telegram. Dispatches on ?action=start|callback|magic|poll|status|unlink.
//
// Two ways in, both verified server-side (api/_lib/account-link/telegram-login.js):
//
//   widget  /start sends the browser to Telegram's login widget and Telegram
//           sends it back to /callback with the signed payload in the query
//           string. The HMAC is checked against the bot token, auth_date must
//           be fresh, and every accepted payload hash is recorded so a replay
//           of the same URL fails.
//   magic   /magic mints a one-time token and a t.me deep link (shown as a QR
//           on /login). Tapping it sends /start <token> to the bot; the webhook
//           (api/gateway/telegram.js) claims the token for the Telegram user
//           who sent it, and the page polling /poll with the poll secret from
//           /magic completes the sign-in. A token is claimed once and expires
//           in ten minutes.
//
// Intents, as for Google (api/auth/google/[action].js): `login` needs no
// session and signs in or creates an account; `link` needs a session and
// attaches the Telegram account to it; `reauth` (widget only) needs a session
// and proves the linked Telegram account is at hand, which unlock an unlink
// for five minutes on accounts without a password. A link completes only in
// the session that asked for it, so a code claimed by someone else cannot
// link their Telegram to the wrong account. Every link and unlink is in the
// audit log.

import { sql } from '../../_lib/db.js';
import { getSessionUser, createSession, sessionCookie, verifyPassword } from '../../_lib/auth.js';
import { requireCsrf } from '../../_lib/csrf.js';
import { cors, method, wrap, error, json, redirect, readJson, rateLimited, wantsHtmlNavigation } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { env } from '../../_lib/env.js';
import { logAudit } from '../../_lib/audit.js';
import { seedDefaultAgent } from '../../_lib/seed-default-agent.js';
import { safeNext } from '../../../src/safe-next.js';
import {
	findUserByIdentity, touchIdentity, linkIdentity, listSignInMethods, readReauth, reauthCookie, unlinkIdentity,
	IdentityError, cookie, clearCookie, readCookie, signIdentityPayload, unsignIdentityPayload, REAUTH_TTL_SEC,
} from '../../_lib/identities.js';
import {
	PROVIDER, INTENTS, MAGIC_TTL_SEC, TelegramLoginError, telegramLoginConfigured, widgetAuthUrl,
	verifyWidgetPayload, claimsFrom, recordWidgetPayload, issueMagicToken, readMagicToken,
	completeMagicToken, resolveLoginUser,
} from '../../_lib/account-link/telegram-login.js';
import { telegramUsername } from '../../_lib/gateway/bots.js';

const SETTINGS_URL = '/dashboard/settings#sign-in-methods';
// The widget round trip carries intent, next and the asking session's user id
// in a signed cookie, so the callback cannot be steered to link a Telegram
// account into whatever session happens to be open.
const FLOW_COOKIE = '__Host-tgflow';
const FLOW_TTL_SEC = 600;
// The widget intents; the magic link only knows login and link.
const WIDGET_INTENTS = Object.freeze([...INTENTS, 'reauth']);

function loginUrl(code, next) {
	const q = new URLSearchParams({ error: code });
	if (next) q.set('next', next);
	return `/login?${q.toString()}`;
}

function settingsUrl(outcome) {
	return `/dashboard/settings?telegram=${encodeURIComponent(outcome)}#sign-in-methods`;
}

function finish(res, next) {
	return redirect(res, safeNext(next, '/dashboard'));
}

async function signIn(req, res, userId, { isNew = false, via = 'widget' } = {}) {
	const token = await createSession({ userId, userAgent: req.headers['user-agent'], ip: clientIp(req) });
	res.setHeader('set-cookie', [sessionCookie(token), clearCookie(FLOW_COOKIE)]);
	logAudit({ userId, action: isNew ? 'register:telegram' : 'login:telegram', meta: { via }, req });
	if (isNew) queueMicrotask(() => seedDefaultAgent(userId));
}

function telegramError(res, err) {
	if (err instanceof TelegramLoginError || err instanceof IdentityError) return error(res, err.status, err.code, err.message, err.extra);
	throw err;
}

// ── start ─────────────────────────────────────────────────────────────────────

async function handleStart(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;
	const url = new URL(req.url, 'http://x');
	const intent = url.searchParams.get('intent') || 'login';
	const next = safeNext(url.searchParams.get('next'), '/dashboard');
	if (!WIDGET_INTENTS.includes(intent)) return error(res, 400, 'validation_error', `intent must be one of ${WIDGET_INTENTS.join(', ')}`);
	if (!telegramLoginConfigured()) {
		if (wantsHtmlNavigation(req)) return redirect(res, intent === 'login' ? loginUrl('telegram_unavailable', next) : settingsUrl('unavailable'));
		return error(res, 501, 'not_configured', 'Telegram sign-in is not configured');
	}
	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) {
		if (wantsHtmlNavigation(req)) return redirect(res, intent === 'login' ? loginUrl('rate_limited', next) : settingsUrl('rate_limited'));
		return rateLimited(res, rl);
	}
	let userId = null;
	if (intent !== 'login') {
		const user = await getSessionUser(req, res);
		if (!user) return redirect(res, `/login?next=${encodeURIComponent(SETTINGS_URL)}`);
		const rlLink = await limits.identityLink(user.id);
		if (!rlLink.success) return redirect(res, settingsUrl('rate_limited'));
		userId = user.id;
	}
	const flow = await signIdentityPayload({ i: intent, n: next, u: userId, e: Math.floor(Date.now() / 1000) + FLOW_TTL_SEC });
	res.setHeader('set-cookie', cookie(FLOW_COOKIE, flow, FLOW_TTL_SEC));
	const origin = env.APP_ORIGIN;
	return redirect(res, widgetAuthUrl({ origin, returnTo: `${origin}/api/auth/telegram/callback` }));
}

// ── callback (widget) ─────────────────────────────────────────────────────────

async function handleCallback(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;
	const url = new URL(req.url, 'http://x');
	const flow = (await unsignIdentityPayload(readCookie(req, FLOW_COOKIE))) || { i: 'login', n: '/dashboard', u: null };
	const intent = WIDGET_INTENTS.includes(flow.i) ? flow.i : 'login';
	const back = (code) => {
		res.setHeader('set-cookie', clearCookie(FLOW_COOKIE));
		if (intent === 'login') return redirect(res, loginUrl(code, flow.n));
		return redirect(res, settingsUrl(code.replace(/^telegram_/, '')));
	};
	if (!telegramLoginConfigured()) return back('telegram_unavailable');
	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return back('rate_limited');

	let verified;
	try {
		verified = verifyWidgetPayload(Object.fromEntries(url.searchParams));
		await recordWidgetPayload(verified.payloadHash, verified.authDate);
	} catch (err) {
		if (err instanceof TelegramLoginError) return back(`telegram_${err.code}`);
		throw err;
	}
	const claims = claimsFrom(verified.claims);

	if (intent === 'reauth') {
		const user = await getSessionUser(req, res);
		if (!user || user.id !== flow.u) return back('telegram_session_changed');
		// A reauth must be a fresh press, not a widget payload Telegram cached
		// from an earlier sign-in: the payload's own auth_date bounds it.
		if ((Date.now() - verified.authDate.getTime()) / 1000 > REAUTH_TTL_SEC) return back('telegram_reauth_stale');
		const owner = await findUserByIdentity(PROVIDER, claims.subject);
		if (!owner || owner.id !== user.id) return back('telegram_wrong_account');
		await touchIdentity(owner.identity_id);
		logAudit({ userId: user.id, action: 'reauth:telegram', resourceId: claims.subject, req });
		res.setHeader('set-cookie', [await reauthCookie(user.id, PROVIDER), clearCookie(FLOW_COOKIE)]);
		return redirect(res, settingsUrl('reauthenticated'));
	}

	if (intent === 'link') {
		const user = await getSessionUser(req, res);
		if (!user || user.id !== flow.u) return back('telegram_wrong_account');
		try {
			const linked = await linkIdentity({ userId: user.id, provider: PROVIDER, claims });
			logAudit({ userId: user.id, action: 'link_identity_telegram', resourceId: claims.subject, meta: { via: 'widget', username: claims.username, relinked: linked.relinked }, req });
		} catch (err) {
			if (err instanceof IdentityError) return back(`telegram_${err.code}`);
			throw err;
		}
		res.setHeader('set-cookie', clearCookie(FLOW_COOKIE));
		return redirect(res, settingsUrl('linked'));
	}

	const linked = await findUserByIdentity(PROVIDER, claims.subject);
	if (linked?.deleted_at) return back('account_deleted');
	let userId;
	let isNew = false;
	if (linked) {
		await touchIdentity(linked.identity_id);
		userId = linked.id;
	} else {
		const created = await resolveLoginUser(claims);
		userId = created.userId;
		isNew = created.isNew;
	}
	await signIn(req, res, userId, { isNew, via: 'widget' });
	return finish(res, flow.n);
}

// ── magic link ────────────────────────────────────────────────────────────────

async function handleMagic(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;
	if (!telegramLoginConfigured()) return error(res, 501, 'not_configured', 'Telegram sign-in is not configured');
	const rl = await limits.telegramMagicIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);
	const body = (await readJson(req)) || {};
	const intent = body.intent === 'link' ? 'link' : 'login';
	const next = safeNext(body.next, '/dashboard');
	let userId = null;
	if (intent === 'link') {
		const user = await getSessionUser(req, res);
		if (!user) return error(res, 401, 'unauthorized', 'sign in first');
		if (!(await requireCsrf(req, res, user.id))) return;
		const rlLink = await limits.identityLink(user.id);
		if (!rlLink.success) return rateLimited(res, rlLink);
		userId = user.id;
	}
	try {
		const issued = await issueMagicToken({ intent, userId, next });
		return json(res, 200, {
			id: issued.id,
			poll_secret: issued.pollSecret,
			deep_link: issued.deepLink,
			bot_username: await telegramUsername().catch(() => null),
			expires_at: issued.expiresAt,
			expires_in: MAGIC_TTL_SEC,
			intent,
		});
	} catch (err) {
		return telegramError(res, err);
	}
}

async function handlePoll(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;
	const url = new URL(req.url, 'http://x');
	const id = url.searchParams.get('id');
	const pollSecret = url.searchParams.get('secret');
	if (!id || !pollSecret) return error(res, 400, 'validation_error', 'id and secret are required');
	const rl = await limits.telegramMagicPoll(id);
	if (!rl.success) return rateLimited(res, rl, 'slow down');
	const row = await readMagicToken({ id, pollSecret });
	if (!row) return error(res, 404, 'not_found', 'unknown or expired login request');
	if (row.status !== 'claimed') {
		return json(res, 200, { status: row.status, intent: row.intent, expires_at: row.expires_at });
	}
	const sessionUser = row.intent === 'link' ? await getSessionUser(req, res) : null;
	if (row.intent === 'link' && !sessionUser) return error(res, 401, 'unauthorized', 'sign in first');
	let done;
	try {
		done = await completeMagicToken({ id, pollSecret, sessionUserId: sessionUser?.id || null });
	} catch (err) {
		return telegramError(res, err);
	}
	if (done.intent === 'link') {
		logAudit({ userId: sessionUser.id, action: 'link_identity_telegram', resourceId: done.claims.subject, meta: { via: 'magic', username: done.claims.username, relinked: done.relinked }, req });
		return json(res, 200, { status: 'completed', intent: 'link', telegram: { username: done.claims.username, display_name: done.claims.display_name } });
	}
	await signIn(req, res, done.userId, { isNew: done.isNew, via: 'magic' });
	return json(res, 200, { status: 'completed', intent: 'login', next: safeNext(done.next, '/dashboard'), is_new: done.isNew });
}

// ── status / unlink ───────────────────────────────────────────────────────────

async function handleStatus(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;
	const user = await getSessionUser(req, res);
	if (!user) return error(res, 401, 'unauthorized', 'sign in to see your sign-in methods');
	const methods = await listSignInMethods(user.id);
	const telegram = methods.identities.find((i) => i.provider === PROVIDER) || null;
	return json(res, 200, {
		configured: telegramLoginConfigured(),
		bot_username: telegramLoginConfigured() ? await telegramUsername().catch(() => null) : null,
		telegram,
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
	let proven = (await readReauth(req, user.id)) === PROVIDER;
	if (!proven && typeof body?.password === 'string' && body.password) {
		const [row] = await sql`select password_hash from users where id = ${user.id} limit 1`;
		proven = Boolean(row?.password_hash) && (await verifyPassword(body.password, row.password_hash));
	}
	if (!proven) return error(res, 401, 'reauth_required', 'confirm your password before unlinking');
	try {
		const result = await unlinkIdentity({ userId: user.id, provider: PROVIDER });
		logAudit({ userId: user.id, action: 'unlink_identity_telegram', meta: { provider: PROVIDER }, req });
		return json(res, 200, result);
	} catch (err) {
		return telegramError(res, err);
	}
}

// ── dispatcher ────────────────────────────────────────────────────────────────

const DISPATCH = {
	start: handleStart,
	callback: handleCallback,
	magic: handleMagic,
	poll: handlePoll,
	status: handleStatus,
	unlink: handleUnlink,
};

export default wrap(async (req, res) => {
	const action = req.query?.action ?? new URL(req.url, 'http://x').pathname.split('/').pop();
	const fn = DISPATCH[action];
	if (!fn) return error(res, 404, 'not_found', `unknown telegram auth action: ${action}`);
	return fn(req, res);
});

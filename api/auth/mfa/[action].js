// Account two-step verification (authenticator app + recovery codes).
//
//   GET  /api/auth/mfa/status          the Security settings panel's state
//   POST /api/auth/mfa/setup           start enrolment: secret, otpauth URI, QR SVG
//   POST /api/auth/mfa/enable          { code } finish enrolment; returns recovery codes once
//   POST /api/auth/mfa/disable         { code } turn it off
//   POST /api/auth/mfa/recovery-codes  { code } replace every recovery code; returns them once
//   GET  /api/auth/mfa/pending         what /login/verify should ask for
//   POST /api/auth/mfa/verify          { code, next } finish a pending sign-in, or
//                                      step up a signed-in session that has not
//                                      passed a second factor yet
//
// Logic lives in api/_lib/account-mfa.js; the sign-in gate itself is in
// createSession (api/_lib/auth.js). Every change lands in the account's
// security log (audit_log), which /settings shows and exports.

import { getSessionUser, createSession, sessionCookie, readSessionCookie } from '../../_lib/auth.js';
import { cors, json, error, method, wrap, readJson, rateLimited } from '../../_lib/http.js';
import { requireCsrf } from '../../_lib/csrf.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { logAudit } from '../../_lib/audit.js';
import {
	MfaError, isPendingToken, findPendingSession, completePendingSession, mfaStatus,
	beginSetup, confirmSetup, disableMfa, regenerateRecoveryCodes, stepUpSession, userHasMfa,
} from '../../_lib/account-mfa.js';

/** Same-origin path to land on after verifying; anything else falls back to /dashboard. */
export function safeNext(raw) {
	const next = typeof raw === 'string' ? raw.trim() : '';
	if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return '/dashboard';
	if (next.startsWith('/login')) return '/dashboard';
	return next.slice(0, 2048);
}

function sendMfaError(res, err) {
	if (err instanceof MfaError) return error(res, err.status, err.code, err.message);
	throw err;
}

async function readCode(req) {
	const body = await readJson(req).catch(() => null);
	return { code: String(body?.code ?? '').trim().slice(0, 32), next: body?.next };
}

/** Per-IP and per-account caps on code guesses, on top of the pending session's own 5. */
async function codeRateOk(req, res, userId) {
	const ip = await limits.authIp(clientIp(req));
	if (!ip.success) { rateLimited(res, ip); return false; }
	const acct = await limits.authAccount(`mfa:${userId}`);
	if (!acct.success) { rateLimited(res, acct); return false; }
	return true;
}

async function signedIn(req, res, { csrf }) {
	const user = await getSessionUser(req);
	if (!user) { error(res, 401, 'unauthorized', 'sign in required'); return null; }
	if (csrf && !(await requireCsrf(req, res, user.id))) return null;
	return user;
}

async function handleStatus(req, res) {
	if (!method(req, res, ['GET'])) return;
	const user = await signedIn(req, res, { csrf: false });
	if (!user) return;
	return json(res, 200, await mfaStatus(user), { 'cache-control': 'no-store' });
}

async function handleSetup(req, res) {
	if (!method(req, res, ['POST'])) return;
	const user = await signedIn(req, res, { csrf: true });
	if (!user) return;
	try {
		const out = await beginSetup(user);
		return json(res, 200, out, { 'cache-control': 'no-store' });
	} catch (err) {
		return sendMfaError(res, err);
	}
}

async function handleEnable(req, res) {
	if (!method(req, res, ['POST'])) return;
	const user = await signedIn(req, res, { csrf: true });
	if (!user) return;
	if (!(await codeRateOk(req, res, user.id))) return;
	const { code } = await readCode(req);
	try {
		const out = await confirmSetup(user, code);
		logAudit({ userId: user.id, action: 'mfa_enabled', meta: { method: 'totp' }, req });
		return json(res, 200, out, { 'cache-control': 'no-store' });
	} catch (err) {
		return sendMfaError(res, err);
	}
}

async function handleDisable(req, res) {
	if (!method(req, res, ['POST'])) return;
	const user = await signedIn(req, res, { csrf: true });
	if (!user) return;
	if (!(await codeRateOk(req, res, user.id))) return;
	const { code } = await readCode(req);
	try {
		await disableMfa(user, code);
		logAudit({ userId: user.id, action: 'mfa_disabled', req });
		return json(res, 200, { ok: true });
	} catch (err) {
		return sendMfaError(res, err);
	}
}

async function handleRecoveryCodes(req, res) {
	if (!method(req, res, ['POST'])) return;
	const user = await signedIn(req, res, { csrf: true });
	if (!user) return;
	if (!(await codeRateOk(req, res, user.id))) return;
	const { code } = await readCode(req);
	try {
		const out = await regenerateRecoveryCodes(user, code);
		logAudit({ userId: user.id, action: 'mfa_recovery_regenerated', req });
		return json(res, 200, out, { 'cache-control': 'no-store' });
	} catch (err) {
		return sendMfaError(res, err);
	}
}

async function handlePending(req, res) {
	if (!method(req, res, ['GET'])) return;
	const token = readSessionCookie(req);
	if (isPendingToken(token)) {
		const pending = await findPendingSession(token);
		return json(res, 200, { mode: pending ? 'sign_in' : 'expired' }, { 'cache-control': 'no-store' });
	}
	const user = token ? await getSessionUser(req) : null;
	if (user && (await userHasMfa(user.id))) {
		return json(res, 200, { mode: user.mfa_verified_at ? 'verified' : 'step_up' }, { 'cache-control': 'no-store' });
	}
	return json(res, 200, { mode: user ? 'not_enabled' : 'signed_out' }, { 'cache-control': 'no-store' });
}

async function handleVerify(req, res) {
	if (!method(req, res, ['POST'])) return;
	const token = readSessionCookie(req);
	const { code, next } = await readCode(req);
	const landing = safeNext(next);

	if (isPendingToken(token)) {
		const pending = await findPendingSession(token);
		if (!pending) return error(res, 401, 'mfa_expired', 'this sign-in expired; sign in again');
		if (!(await codeRateOk(req, res, pending.user_id))) return;
		try {
			const out = await completePendingSession({
				token,
				code,
				createSession,
				userAgent: req.headers['user-agent'] || null,
				ip: clientIp(req),
			});
			res.setHeader('set-cookie', sessionCookie(out.token));
			logAudit({ userId: out.userId, action: 'mfa_verified', meta: { method: out.method }, req });
			logAudit({ userId: out.userId, action: 'login', meta: { second_factor: out.method }, req });
			return json(res, 200, { ok: true, next: landing, method: out.method, recovery_codes_left: out.recoveryCodesLeft });
		} catch (err) {
			if (err instanceof MfaError && (err.code === 'invalid_code' || err.code === 'too_many_attempts')) {
				logAudit({ userId: pending.user_id, action: 'mfa_failed', meta: { reason: err.code }, req });
			}
			return sendMfaError(res, err);
		}
	}

	const user = token ? await getSessionUser(req) : null;
	if (!user) return error(res, 401, 'mfa_expired', 'sign in first');
	if (!(await codeRateOk(req, res, user.id))) return;
	try {
		const used = await stepUpSession(user, code);
		logAudit({ userId: user.id, action: 'mfa_verified', meta: { method: used, step_up: true }, req });
		return json(res, 200, { ok: true, next: landing, method: used });
	} catch (err) {
		if (err instanceof MfaError && err.code === 'invalid_code') {
			logAudit({ userId: user.id, action: 'mfa_failed', meta: { reason: err.code, step_up: true }, req });
		}
		return sendMfaError(res, err);
	}
}

const HANDLERS = {
	status: handleStatus,
	setup: handleSetup,
	enable: handleEnable,
	disable: handleDisable,
	'recovery-codes': handleRecoveryCodes,
	pending: handlePending,
	verify: handleVerify,
};

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;
	const action = req.query?.action ?? new URL(req.url, 'http://x').pathname.split('/').filter(Boolean).pop();
	const handler = HANDLERS[action];
	if (!handler) return error(res, 404, 'not_found', `unknown two-step action: ${action}`);
	return handler(req, res);
});

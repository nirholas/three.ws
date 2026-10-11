// Link codes: one short-lived code links a phone, a desktop app, a CLI or a
// Telegram chat to the signed-in account. Dispatches on
// ?action=mint|claim|poll|pending|decide|devices|revoke.
//
// The flow (api/_lib/account-link/link-codes.js):
//   mint     the signed-in session asks for a code for one device kind. Shown
//            once, eight letters, ten minutes, single use; minting a new code
//            for the same kind retires the old one.
//   claim    the device sends the code with a description of itself and gets
//            a claim secret back. No sign-in: the code is the only proof, so
//            this is rate limited per IP and a wrong code reveals nothing.
//   pending  the session lists codes a device has claimed but nobody decided.
//   decide   the session that minted the code confirms or rejects it after
//            seeing exactly what will be linked. Only that account can decide
//            (wrong_account otherwise); a confirm mints the credential: a
//            session for a phone, an API key for a CLI or desktop app, a
//            gateway link for a Telegram chat.
//   poll     the device polls with its claim secret until the decision lands;
//            the credential is handed over once and then wiped from the row.
//   devices  every linked device with its last use and a live flag.
//   revoke   one click: the credential behind the device is revoked too.
// Every mint, link, reject and revoke is in the audit log.

import { getSessionUser, sessionCookie, isSameSiteOrigin } from '../../_lib/auth.js';
import { requireCsrf } from '../../_lib/csrf.js';
import { cors, method, wrap, error, json, readJson, rateLimited } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import {
	LinkCodeError, DEVICE_KINDS, DEVICE_LABELS, LINKABLE_SCOPES, DEFAULT_SCOPES, LINK_CODE_TTL_SEC,
	mintLinkCode, claimLinkCode, describeClaim, listPendingLinkCodes, readLinkCode, decideLinkCode,
	pollLinkCode, listLinkedDevices, revokeLinkedDevice,
} from '../../_lib/account-link/link-codes.js';

function fail(res, err) {
	if (err instanceof LinkCodeError) return error(res, err.status, err.code, err.message, err.extra);
	throw err;
}

async function sessionOrFail(req, res, { csrf = true } = {}) {
	const user = await getSessionUser(req, res);
	if (!user) {
		error(res, 401, 'unauthorized', 'sign in first');
		return null;
	}
	if (csrf && !(await requireCsrf(req, res, user.id))) return null;
	return user;
}

// ── mint (session) ────────────────────────────────────────────────────────────

async function handleMint(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;
	const user = await sessionOrFail(req, res);
	if (!user) return;
	// A code minted from another origin would let a page the person happens to
	// have open hand out link codes for their account.
	if (!isSameSiteOrigin(req)) return error(res, 403, 'forbidden', 'link codes are minted from three.ws only');
	const rl = await limits.linkCodeUser(user.id);
	if (!rl.success) return rateLimited(res, rl);
	const body = (await readJson(req)) || {};
	try {
		const code = await mintLinkCode({ userId: user.id, deviceKind: body.device_kind, label: body.label, requestedScope: body.scopes, req });
		return json(res, 200, { ...code, kinds: DEVICE_LABELS, expires_in: LINK_CODE_TTL_SEC });
	} catch (err) {
		return fail(res, err);
	}
}

// ── claim and poll (device, unauthenticated) ──────────────────────────────────

async function handleClaim(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS' })) return;
	if (!method(req, res, ['POST'])) return;
	const ip = clientIp(req);
	const rl = await limits.linkCodeClaimIp(ip);
	if (!rl.success) return rateLimited(res, rl);
	const body = (await readJson(req)) || {};
	const expectKind = DEVICE_KINDS.includes(body.device_kind) ? body.device_kind : null;
	try {
		const claim = describeClaim(body.device || {}, { ip, userAgent: req.headers['user-agent'] || null });
		const claimed = await claimLinkCode({ code: body.code, claim, expectKind });
		return json(res, 200, { ...claimed, poll_every_ms: 2000 });
	} catch (err) {
		return fail(res, err);
	}
}

async function handlePoll(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;
	const url = new URL(req.url, 'http://x');
	const id = url.searchParams.get('id');
	const claimSecret = url.searchParams.get('secret');
	if (!id || !claimSecret) return error(res, 400, 'validation_error', 'id and secret are required');
	const rl = await limits.linkCodePoll(id);
	if (!rl.success) return rateLimited(res, rl, 'slow down');
	try {
		const result = await pollLinkCode({ id, claimSecret });
		// A phone gets its session as the cookie the rest of the site expects;
		// the secret is still in the body for a native app that stores it itself.
		if (result.status === 'confirmed' && result.credential?.kind === 'session') {
			res.setHeader('set-cookie', sessionCookie(result.credential.secret));
		}
		return json(res, 200, result);
	} catch (err) {
		return fail(res, err);
	}
}

// ── pending and decide (session) ──────────────────────────────────────────────

async function handlePending(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;
	const user = await sessionOrFail(req, res, { csrf: false });
	if (!user) return;
	const url = new URL(req.url, 'http://x');
	const id = url.searchParams.get('id');
	if (id) {
		const code = await readLinkCode({ id, userId: user.id });
		if (!code) return error(res, 404, 'not_found', 'no such link code');
		return json(res, 200, code);
	}
	return json(res, 200, { pending: await listPendingLinkCodes(user.id), kinds: DEVICE_LABELS, scopes: LINKABLE_SCOPES, defaults: DEFAULT_SCOPES });
}

async function handleDecide(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;
	const user = await sessionOrFail(req, res);
	if (!user) return;
	if (!isSameSiteOrigin(req)) return error(res, 403, 'forbidden', 'link requests are confirmed from three.ws only');
	const body = (await readJson(req)) || {};
	const decision = body.decision === 'confirm' ? 'confirm' : body.decision === 'reject' ? 'reject' : null;
	if (!body.id || !decision) return error(res, 400, 'validation_error', 'id and decision (confirm|reject) are required');
	try {
		return json(res, 200, await decideLinkCode({ id: body.id, userId: user.id, decision, scopes: body.scopes, req }));
	} catch (err) {
		return fail(res, err);
	}
}

// ── devices (session) ─────────────────────────────────────────────────────────

async function handleDevices(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;
	const user = await sessionOrFail(req, res, { csrf: false });
	if (!user) return;
	return json(res, 200, { devices: await listLinkedDevices(user.id), kinds: DEVICE_LABELS });
}

async function handleRevoke(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;
	const user = await sessionOrFail(req, res);
	if (!user) return;
	const body = (await readJson(req)) || {};
	if (!body.id) return error(res, 400, 'validation_error', 'id is required');
	try {
		return json(res, 200, await revokeLinkedDevice({ id: body.id, userId: user.id, req }));
	} catch (err) {
		return fail(res, err);
	}
}

const DISPATCH = {
	mint: handleMint,
	claim: handleClaim,
	poll: handlePoll,
	pending: handlePending,
	decide: handleDecide,
	devices: handleDevices,
	revoke: handleRevoke,
};

export default wrap(async (req, res) => {
	const action = req.query?.action ?? new URL(req.url, 'http://x').pathname.split('/').pop();
	const fn = DISPATCH[action];
	if (!fn) return error(res, 404, 'not_found', `unknown link code action: ${action}`);
	return fn(req, res);
});

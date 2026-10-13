// VRoid Hub social connect for /import/vroid.
// Routes: /api/auth/vroid/connect,    redirect to VRoid Hub OAuth (PKCE)
//         /api/auth/vroid/callback,   exchange code, store encrypted token
//         /api/auth/vroid/status,     connection status for the signed-in user
//         /api/auth/vroid/disconnect, drop the stored grant
//
// PKCE is mandatory on this provider (verified against the live authorize
// endpoint, see api/_lib/vroid/config.js), so the code_verifier has to
// survive the round trip to VRoid Hub and back. It travels inside the same
// HMAC-signed `state` blob as the CSRF nonce, exactly like GitHub's connect
// flow (api/auth/github/[action].js) signs {userId, agentId, ts}: one fewer
// moving part than a second cookie, and it is already tamper-evident.

import { getSessionUser } from '../../_lib/auth.js';
import { hmacSha256, constantTimeEquals } from '../../_lib/crypto.js';
import { cors, json, redirect, error, method, wrap } from '../../_lib/http.js';
import { limits, clientIp } from '../../_lib/rate-limit.js';
import { env } from '../../_lib/env.js';
import { vroidConfigured, authorizeUrl } from '../../_lib/vroid/config.js';
import { createPkcePair, exchangeCode } from '../../_lib/vroid/client.js';
import { saveVroidToken, vroidConnectionStatus, disconnectVroid } from '../../_lib/vroid/token-store.js';

const RETURN_PATH = '/import/vroid';

async function makeState(payload) {
	const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
	const sig = await hmacSha256(env.JWT_SECRET, data);
	return `${data}.${sig}`;
}

async function verifyState(state) {
	const dotIdx = state.lastIndexOf('.');
	if (dotIdx < 0) throw Object.assign(new Error('invalid state'), { status: 400 });
	const data = state.slice(0, dotIdx);
	const sig = state.slice(dotIdx + 1);
	const expected = await hmacSha256(env.JWT_SECRET, data);
	if (!constantTimeEquals(sig, expected)) throw Object.assign(new Error('invalid state signature'), { status: 400 });
	return JSON.parse(Buffer.from(data, 'base64url').toString());
}

async function handleConnect(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	if (!vroidConfigured()) {
		return error(res, 501, 'not_configured', 'VRoid Hub OAuth is not configured yet');
	}

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many attempts, try again shortly');

	const session = await getSessionUser(req);
	if (!session) return error(res, 401, 'unauthorized', 'sign in required');

	const { verifier, challenge } = await createPkcePair();
	const state = await makeState({ userId: session.id, codeVerifier: verifier, ts: Date.now() });

	return redirect(res, authorizeUrl({ state, codeChallenge: challenge }));
}

async function handleCallback(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	if (!vroidConfigured()) {
		return error(res, 501, 'not_configured', 'VRoid Hub OAuth is not configured yet');
	}

	const rl = await limits.authIp(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many attempts, try again shortly');

	const url = new URL(req.url, 'http://x');
	const code = url.searchParams.get('code');
	const stateParam = url.searchParams.get('state');
	const hubError = url.searchParams.get('error');

	if (hubError) {
		return redirect(res, `${env.APP_ORIGIN}${RETURN_PATH}?vroid=denied`);
	}
	if (!code || !stateParam) return error(res, 400, 'bad_request', 'missing code or state');

	let stateData;
	try {
		stateData = await verifyState(stateParam);
	} catch {
		return error(res, 400, 'invalid_state', 'invalid or tampered state parameter');
	}
	if (Date.now() - stateData.ts > 10 * 60 * 1000) {
		return redirect(res, `${env.APP_ORIGIN}${RETURN_PATH}?vroid=expired`);
	}

	// Session-bind like the GitHub flow: the state is a signed token, not a
	// browser-bound one, so without this check an attacker could start a
	// connect on their own account and hand the link to a signed-out victim.
	const callbackSession = await getSessionUser(req).catch(() => null);
	if (!callbackSession || callbackSession.id !== stateData.userId) {
		return redirect(res, `${env.APP_ORIGIN}${RETURN_PATH}?vroid=error`);
	}

	let tokenData;
	try {
		tokenData = await exchangeCode(code, stateData.codeVerifier);
	} catch (err) {
		console.error('[vroid-hub] token exchange failed', err?.message || err);
		return redirect(res, `${env.APP_ORIGIN}${RETURN_PATH}?vroid=error`);
	}

	await saveVroidToken(stateData.userId, tokenData);

	return redirect(res, `${env.APP_ORIGIN}${RETURN_PATH}?vroid=connected`);
}

async function handleStatus(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;

	const session = await getSessionUser(req);
	if (!session) return error(res, 401, 'unauthorized', 'sign in required');

	const configured = vroidConfigured();
	const status = await vroidConnectionStatus(session.id);

	return json(res, 200, { configured, ...status });
}

async function handleDisconnect(req, res) {
	if (cors(req, res, { methods: 'POST,DELETE,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST', 'DELETE'])) return;

	const session = await getSessionUser(req);
	if (!session) return error(res, 401, 'unauthorized', 'sign in required');

	await disconnectVroid(session.id);

	return json(res, 200, { disconnected: true });
}

async function route(req, res) {
	const url = new URL(req.url, 'http://x');
	const action = url.searchParams.get('action');
	switch (action) {
		case 'connect':
			return handleConnect(req, res);
		case 'callback':
			return handleCallback(req, res);
		case 'status':
			return handleStatus(req, res);
		case 'disconnect':
			return handleDisconnect(req, res);
		default:
			return error(res, 404, 'not_found', `unknown action: ${action}`);
	}
}

export default wrap(route);

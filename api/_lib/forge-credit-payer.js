// Who pays when a Forge High request asks for pay_with:'credits'.
//
// A browser caller is the signed-in session. A machine caller (the Omniverse
// Kit extension, the Python client, a script) presents a three.ws API key or an
// OAuth access token as `Authorization: Bearer`. Prepaid credits are the
// account's own platform balance (not a custodial wallet), and /api/credits and
// /api/tts already let a bearer read or spend it, so a bearer may pay here too,
// provided it was granted generation rights (`avatars:write`, the scope the
// `generate` key preset carries). A narrower key gets a 403 it can explain.
//
// Returns { ok: true, user: { id, wallet_address }, source } or
// { ok: false, status, error, message } for the route to render as-is.

import { getSessionUser, authenticateBearer, extractBearer, hasScope } from './auth.js';
import { sql } from './db.js';

export const FORGE_CREDIT_SCOPE = 'avatars:write';

export async function resolveForgeCreditPayer(req) {
	const session = await getSessionUser(req).catch(() => null);
	if (session) return { ok: true, user: session, source: 'session' };

	const token = extractBearer(req);
	if (!token) {
		return {
			ok: false,
			status: 401,
			error: 'unauthorized',
			message: 'Sign in, or send a three.ws API key as a Bearer token, to pay with credits.',
		};
	}

	const bearer = await authenticateBearer(token).catch(() => null);
	if (!bearer) return invalidKey();
	if (!hasScope(bearer.scope, FORGE_CREDIT_SCOPE)) {
		return {
			ok: false,
			status: 403,
			error: 'insufficient_scope',
			message: `This API key lacks the ${FORGE_CREDIT_SCOPE} scope needed to generate with credits. Create a key with the Generate preset at three.ws/dashboard/api.`,
		};
	}

	const [user] = await sql`
		select id, wallet_address from users where id = ${bearer.userId} and deleted_at is null limit 1
	`;
	if (!user) return invalidKey();
	return { ok: true, user, source: 'bearer' };
}

function invalidKey() {
	return {
		ok: false,
		status: 401,
		error: 'invalid_api_key',
		message: 'That three.ws API key is invalid, expired or revoked. Create a new one at three.ws/dashboard/api.',
	};
}

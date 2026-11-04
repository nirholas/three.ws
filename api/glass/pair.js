/**
 * Pair a /glass lens session with a signed-in phone.
 *
 * POST /api/glass/pair {}               lens: start a pairing -> { code, expires_in }
 * POST /api/glass/pair { code }         phone, signed in: claim it -> { ok, name }
 * GET  /api/glass/pair?code=ABC234      lens: poll -> { state: waiting|paired|expired, name? }
 *
 * The lens shows the code and polls. The phone opens /glass/pair (or scans the
 * lens QR) while signed in, and the claim binds the account to the lens session
 * for the length of the code. Nothing is stored beyond the short-lived code.
 */

import { cors, json, wrap, error, rateLimited, readJson } from '../_lib/http.js';
import { getSessionUser } from '../_lib/auth.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { startPairing, claimPairing, pairingStatus, normalizeCode } from '../_lib/glass-codes.js';

export default wrap(async (req, res) => {
	cors(req, res, { methods: ['GET', 'POST', 'OPTIONS'], credentials: true });
	if (req.method === 'OPTIONS') return res.end();
	if (req.method !== 'GET' && req.method !== 'POST') {
		return error(res, 405, 'method_not_allowed', 'method not allowed');
	}

	const rl = await limits.glassHandoffIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	if (req.method === 'GET') {
		const code = normalizeCode(req.query?.code);
		if (!code) return error(res, 400, 'invalid_code', 'codes are six letters and digits');
		return json(res, 200, await pairingStatus(code), { 'cache-control': 'no-store' });
	}

	const body = (await readJson(req).catch(() => null)) ?? {};
	if (body.code == null) {
		const { code, expires_in } = await startPairing();
		return json(res, 200, { code, expires_in }, { 'cache-control': 'no-store' });
	}

	const user = await getSessionUser(req).catch(() => null);
	if (!user) return error(res, 401, 'sign_in_required', 'sign in on your phone to pair these glasses');
	const out = await claimPairing(body.code, user);
	if (!out.ok) {
		const status = out.reason === 'malformed' ? 400 : out.reason === 'taken' ? 409 : 404;
		return error(res, status, `pair_${out.reason}`, 'that pairing code is not valid any more');
	}
	return json(res, 200, { ok: true, name: out.name }, { 'cache-control': 'no-store' });
});

/**
 * Lens to phone handoff for the /glass Meta Ray-Ban Display app.
 *
 * POST /api/glass/handoff  { pinId }   mint a six-character code for a pin
 *   -> { code, url, expires_in }       url is https://three.ws/g/<code>
 * GET  /api/glass/handoff?code=ABC234  resolve a code (also behind /g/<code>)
 *   -> 200 { pinId, location }         or 404 when unknown or expired
 *
 * Browsers that follow three.ws/g/<code> send `Accept: text/html` and are
 * redirected straight to /irl?pin=<id>&from=glass, where /irl opens the pin
 * card. Anything else gets JSON. Owner-free: a code only ever points at a pin
 * that already appears in the public nearby feed (published, unhidden, unexpired).
 */

import { cors, json, wrap, error, rateLimited, readJson } from '../_lib/http.js';
import { sql } from '../_lib/db.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { isPinId, mintHandoff, resolveHandoff, normalizeCode } from '../_lib/glass-codes.js';

const ORIGIN = 'https://three.ws';

async function pinIsPublic(pinId) {
	const rows = await sql`
		SELECT id FROM irl_pins
		WHERE id = ${pinId}::uuid
		  AND hidden_at IS NULL
		  AND published IS NOT FALSE
		  AND (expires_at IS NULL OR expires_at > NOW())
		LIMIT 1
	`;
	return rows.length > 0;
}

export default wrap(async (req, res) => {
	cors(req, res, { methods: ['GET', 'POST', 'OPTIONS'] });
	if (req.method === 'OPTIONS') return res.end();
	if (req.method !== 'GET' && req.method !== 'POST') {
		return error(res, 405, 'method_not_allowed', 'method not allowed');
	}

	const rl = await limits.glassHandoffIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	if (req.method === 'POST') {
		const body = (await readJson(req).catch(() => null)) ?? {};
		if (!isPinId(body.pinId)) return error(res, 400, 'invalid_pin', 'pinId must be a pin id');
		if (!(await pinIsPublic(body.pinId))) return error(res, 404, 'pin_not_found', 'that agent is no longer standing there');
		const { code, expires_in } = await mintHandoff(body.pinId);
		return json(res, 200, { code, url: `${ORIGIN}/g/${code}`, expires_in }, { 'cache-control': 'no-store' });
	}

	const raw = req.query?.code;
	const code = normalizeCode(raw);
	if (!code) return error(res, 400, 'invalid_code', 'codes are six letters and digits');
	const hit = await resolveHandoff(code);
	if (!hit) return error(res, 404, 'unknown_code', 'that code is unknown or has expired');

	const location = `/irl?pin=${encodeURIComponent(hit.pinId)}&from=glass`;
	const accept = String(req.headers?.accept || '');
	if (accept.includes('text/html')) {
		res.statusCode = 302;
		res.setHeader('location', location);
		res.setHeader('cache-control', 'no-store');
		return res.end();
	}
	return json(res, 200, { pinId: hit.pinId, location }, { 'cache-control': 'no-store' });
});

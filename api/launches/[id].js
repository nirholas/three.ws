/**
 * Launch status and lane config.
 *
 *   GET /api/launches/lanes   public: every launch lane from live config
 *   GET /api/launches/:id     the signed-in owner's launch record
 *
 * A record is created by POST /api/agents/:id/paired/launch and
 * POST /api/agents/:id/uniswap/launch (both take an Idempotency-Key header).
 * The record reports the stages the launch has passed until it is finalized or
 * failed, and settles itself here when the transaction landed after the request
 * that sent it went away. See docs/launch-lanes.md.
 */

import { getSessionUser, authenticateBearer, extractBearer } from '../_lib/auth.js';
import { cors, json, method, wrap, error, rateLimited, serverError } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { isUuid } from '../_lib/validate.js';
import { getLaunchRecord, publicRecord, settleLaunch, OPEN_STATUSES } from '../_lib/evm-launch-records.js';
import { launchLanes } from '../_lib/launch-lanes.js';

async function lanes(req, res) {
	const rl = await limits.authedReadIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);
	const data = await launchLanes();
	res.setHeader('cache-control', 'public, max-age=30, stale-while-revalidate=120');
	return json(res, 200, { data: { lanes: data } });
}

async function record(req, res, id) {
	const session = await getSessionUser(req);
	const userId = session?.id || (await authenticateBearer(extractBearer(req)))?.userId;
	if (!userId) return error(res, 401, 'unauthorized', 'sign in or send an API key');
	const rl = await limits.authedReadIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);
	if (!isUuid(id)) return error(res, 404, 'not_found', 'launch not found');

	let row = await getLaunchRecord(id, userId);
	if (!row) return error(res, 404, 'not_found', 'launch not found');
	if (OPEN_STATUSES.has(row.status)) {
		const { settlers } = await import('../_lib/evm-launch-settlers.js');
		row = await settleLaunch(row, settlers);
	}
	res.setHeader('cache-control', 'no-store');
	return json(res, 200, { data: publicRecord(row) });
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;
	const id = req.query?.id || new URL(req.url, 'http://x').pathname.split('/').filter(Boolean).pop();
	try {
		if (id === 'lanes') return await lanes(req, res);
		return await record(req, res, id);
	} catch (err) {
		return serverError(res, 500, 'internal', err);
	}
});

// POST /api/microsoft-teams/messages: the Bot Framework messaging endpoint for
// the three.ws Teams app: message-extension search, agent link unfurling, and
// "Create a 3D model" (the action command, the `forge` bot command and its
// live Adaptive Card actions). Registered as the messaging endpoint of
// the Azure Bot whose app id is MS_TEAMS_BOT_APP_ID. Logic: api/_lib/teams-bot.js.
//
// Every activity that reaches token verification is recorded in
// microsoft_surface_events (api/_lib/microsoft-surface-events.js) with its final
// status, so /admin/microsoft can show usage and the alert cron can see 5xx.

import { wrap, method, json, error, readJson } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { verifyBotToken, handleActivity, TeamsBotError } from '../_lib/teams-bot.js';
import { recordTeamsActivity } from '../_lib/microsoft-surface-events.js';
import { originFromReq } from '../_mcp-studio/gpt-forge-client.js';
import { selfOrigin } from '../_lib/self-origin.js';

export default wrap(async (req, res) => {
	if (!method(req, res, ['POST'])) return;
	const rl = await limits.widgetRead(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');
	const activity = await readJson(req);
	if (!activity || typeof activity !== 'object') return error(res, 400, 'validation_error', 'a Bot Framework activity is required');
	const started = Date.now();
	const record = (status, err = null, verified = true) =>
		recordTeamsActivity(activity, { status, latencyMs: Date.now() - started, error: err, verified });
	try {
		await verifyBotToken(req.headers.authorization, { serviceUrl: activity.serviceUrl });
	} catch (err) {
		if (err instanceof TeamsBotError) {
			// Unverified: the tenant and conversation in the body are not trusted.
			record(err.status, err.code, false);
			return error(res, err.status, err.code, err.message);
		}
		record(500, err?.message || String(err), false);
		throw err;
	}
	let body;
	try {
		body = await handleActivity(activity, { origin: originFromReq(req), selfBase: selfOrigin(req) });
	} catch (err) {
		record(err?.status && err.status < 500 ? err.status : 500, err?.message || String(err));
		throw err;
	}
	record(200);
	if (body == null) {
		res.statusCode = 200;
		return res.end();
	}
	return json(res, 200, body, { 'cache-control': 'no-store' });
});

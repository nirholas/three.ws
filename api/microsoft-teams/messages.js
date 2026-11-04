// POST /api/microsoft-teams/messages: the Bot Framework messaging endpoint for
// the three.ws Teams app's message extension (search agents, unfurl agent
// links into Glance Adaptive Cards). Registered as the messaging endpoint of
// the Azure Bot whose app id is MS_TEAMS_BOT_APP_ID. Logic: api/_lib/teams-bot.js.

import { wrap, method, json, error, readJson } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { verifyBotToken, handleActivity, TeamsBotError } from '../_lib/teams-bot.js';

export default wrap(async (req, res) => {
	if (!method(req, res, ['POST'])) return;
	const rl = await limits.widgetRead(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');
	const activity = await readJson(req);
	if (!activity || typeof activity !== 'object') return error(res, 400, 'validation_error', 'a Bot Framework activity is required');
	try {
		await verifyBotToken(req.headers.authorization, { serviceUrl: activity.serviceUrl });
	} catch (err) {
		if (err instanceof TeamsBotError) return error(res, err.status, err.code, err.message);
		throw err;
	}
	const body = await handleActivity(activity);
	if (body == null) {
		res.statusCode = 200;
		return res.end();
	}
	return json(res, 200, body, { 'cache-control': 'no-store' });
});

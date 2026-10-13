// GET /api/discord-activity/config: the public (non-secret) piece of the
// Discord Activity's identity. The Embedded App SDK needs a client_id to call
// discordSdk.commands.authorize({ client_id }); that id is already visible in
// the Activity's own URL inside Discord, so serving it from env rather than
// baking it into the built bundle is what lets the Activity be configured
// (or disabled) without a redeploy.

import { cors, json, method, wrap } from '../_lib/http.js';

export default wrap(async function handler(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS', payments: false })) return;
	if (!method(req, res, ['GET'])) return;

	const clientId = process.env.DISCORD_ACTIVITY_CLIENT_ID || null;
	return json(
		res,
		200,
		{ configured: Boolean(clientId), clientId },
		{ 'cache-control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=3600' },
	);
});

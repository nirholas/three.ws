// POST /api/gateway/discord-activity-token: the OAuth2 code-for-token swap the
// Discord Embedded App SDK's `authorize()` hands off to a server (Discord
// never lets the client hold DISCORD_CLIENT_SECRET). The client calls this
// right after authorize(), then feeds the returned access_token into its own
// `discordSdk.commands.authenticate({ access_token })`.

import { cors, json, method, error, readJson, wrap } from '../_lib/http.js';
import { exchangeActivityCode, discordActivityConfigured, DiscordActivityAuthError } from '../_lib/gateway/discord-activity-auth.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS' })) return;
	if (!method(req, res, ['POST'])) return;

	if (!discordActivityConfigured()) return error(res, 503, 'not_configured', 'the Discord Activity is not configured');

	const body = (await readJson(req, 4_096)) || {};
	try {
		const { accessToken } = await exchangeActivityCode(body.code);
		return json(res, 200, { access_token: accessToken });
	} catch (e) {
		if (e instanceof DiscordActivityAuthError) return error(res, e.status, e.code, e.message);
		throw e;
	}
});

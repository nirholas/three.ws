// POST /api/discord-activity/token: the only step of the Activity OAuth dance
// that needs the client secret, so it is the only step that runs server-side.
//
// Flow (Discord's Embedded App SDK pattern): the Activity frontend calls
// discordSdk.commands.authorize({ client_id, response_type:'code', ... }) and
// gets back a `code`. It POSTs that code here. We exchange it for an access
// token at Discord's own OAuth2 endpoint using DISCORD_ACTIVITY_CLIENT_ID /
// DISCORD_ACTIVITY_CLIENT_SECRET, and hand the access token back. The frontend
// then calls discordSdk.commands.authenticate({ access_token }), which is what
// actually identifies the Discord user inside the Activity. No redirect_uri:
// Activities authorize through the embedded SDK's own channel, not a browser
// redirect, so Discord's token endpoint does not require one for this flow.
//
// Body: { code: string }
// Reply: { access_token: string }

import { cors, error, json, method, rateLimited, readJson, wrap } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { fetchUpstream } from '../_lib/upstream-fetch.js';

const DISCORD_TOKEN_URL = 'https://discord.com/api/v10/oauth2/token';

export default wrap(async function handler(req, res) {
	if (cors(req, res, { methods: 'POST,OPTIONS', payments: false })) return;
	if (!method(req, res, ['POST'])) return;

	const rl = await limits.discordActivityTokenIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const clientId = process.env.DISCORD_ACTIVITY_CLIENT_ID;
	const clientSecret = process.env.DISCORD_ACTIVITY_CLIENT_SECRET;
	if (!clientId || !clientSecret) {
		return error(res, 503, 'not_configured', 'The Discord Activity is not configured yet.');
	}

	const body = (await readJson(req)) || {};
	const code = String(body.code || '').trim();
	if (!code) return error(res, 400, 'missing_code', 'code is required.');

	let tokenRes;
	try {
		tokenRes = await fetchUpstream(
			DISCORD_TOKEN_URL,
			{
				method: 'POST',
				headers: { 'content-type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({
					client_id: clientId,
					client_secret: clientSecret,
					grant_type: 'authorization_code',
					code,
				}),
			},
			{ name: 'discord-activity:oauth-token', attempts: 1, timeoutMs: 8_000 },
		);
	} catch (e) {
		const status = e?.status && e.status >= 400 && e.status < 500 ? e.status : 502;
		let message = e?.message || 'Discord did not accept that code.';
		try {
			const parsed = JSON.parse(e?.body || '{}');
			if (parsed.error_description || parsed.error) message = parsed.error_description || parsed.error;
		} catch {
			// Discord's error body is always JSON in practice; a non-JSON body just
			// falls through to the UpstreamError message above.
		}
		return error(res, status, 'discord_rejected', message);
	}

	const data = await tokenRes.json();
	if (!data.access_token) return error(res, 502, 'bad_upstream_response', 'Discord did not return an access token.');
	return json(res, 200, { access_token: data.access_token });
});

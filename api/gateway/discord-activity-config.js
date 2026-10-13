// GET /api/gateway/discord-activity-config: the handful of public values the
// Activity's client bundle needs before it can call discordSdk.ready(): the
// OAuth client id (public by design, Discord's own authorize() call sends it)
// and the CDN host Discord must proxy for R2-hosted previews. Baking these into
// the build would mean a rebuild every time the Developer Portal app changes;
// reading them from the Cloud Run service's env lets the owner wire a real
// Discord application without touching code.

import { cors, json, method, error, wrap } from '../_lib/http.js';
import { env } from '../_lib/env.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	const clientId = process.env.DISCORD_CLIENT_ID;
	if (!clientId) return error(res, 503, 'not_configured', 'the Discord Activity is not configured');

	let cdnHost = null;
	try {
		cdnHost = new URL(env.S3_PUBLIC_DOMAIN).host;
	} catch {
		cdnHost = null;
	}

	return json(res, 200, { client_id: clientId, cdn_host: cdnHost }, { 'cache-control': 'public, max-age=60' });
});

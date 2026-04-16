// Public client-config. Returns non-secret config values the browser needs
// (Privy app id, etc.). Lets us keep values in env vars instead of hardcoded
// in static HTML in public/.

import { cors, json, method, wrap } from './_lib/http.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: false })) return;
	if (!method(req, res, ['GET'])) return;

	return json(res, 200, {
		privyAppId: process.env.PRIVY_APP_ID || '',
	});
});

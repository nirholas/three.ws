// Public client-config. Returns non-secret config values the browser needs.

import { cors, json, method, wrap } from './_lib/http.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: false })) return;
	if (!method(req, res, ['GET'])) return;

	return json(res, 200, {
		walletConnectProjectId: process.env.VITE_WALLETCONNECT_PROJECT_ID || '',
	});
});

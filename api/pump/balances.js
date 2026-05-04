// GET /api/pump/balances — thin wrapper that delegates to the consolidated
// /api/pump/[action] dispatcher so each action keeps a stable URL.

import dispatcher from './[action].js';

export default async function handler(req, res) {
	req.query = { ...(req.query || {}), action: 'balances' };
	return dispatcher(req, res);
}

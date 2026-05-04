// POST /api/pump/withdraw-confirm — thin wrapper delegating to the
// consolidated /api/pump/[action] dispatcher.

import dispatcher from './[action].js';

export default async function handler(req, res) {
	req.query = { ...(req.query || {}), action: 'withdraw-confirm' };
	return dispatcher(req, res);
}

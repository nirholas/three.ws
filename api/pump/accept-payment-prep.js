// POST /api/pump/accept-payment-prep — thin wrapper delegating to the
// consolidated /api/pump/[action] dispatcher.

import dispatcher from './[action].js';

export default async function handler(req, res) {
	req.query = { ...(req.query || {}), action: 'accept-payment-prep' };
	return dispatcher(req, res);
}

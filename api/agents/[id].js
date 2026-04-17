/**
 * /api/agents/:id  and  /api/agents/:id/wallet
 * Routes to the appropriate handler in api/agents.js
 */
import { handleGetOne, handleWallet } from '../agents.js';
import { cors, error, wrap } from '../_lib/http.js';

export default wrap(async function handler(req, res) {
	const url = new URL(req.url, 'http://x');
	const parts = url.pathname.split('/').filter(Boolean);
	// parts: ['api', 'agents', ':id'] or ['api', 'agents', ':id', 'wallet']
	const id = parts[2];
	const sub = parts[3];

	if (!id) {
		if (cors(req, res)) return;
		return error(res, 400, 'bad_request', 'missing agent id');
	}

	if (sub === 'wallet') return handleWallet(req, res, id);
	return handleGetOne(req, res, id);
});

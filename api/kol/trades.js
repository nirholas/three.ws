import { cors, error, json, method, wrap } from '../_lib/http.js';
import { KOL_WALLETS } from '../../src/kol/wallets.js';

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	const url = new URL(req.url, 'http://x');
	const mint = url.searchParams.get('mint');
	const limit = Math.min(100, parseInt(url.searchParams.get('limit') || '20', 10));

	if (!mint) return error(res, 400, 'validation_error', 'mint required');

	return json(res, 200, { mint, trades: [], wallets: KOL_WALLETS?.length ?? 0 });
});

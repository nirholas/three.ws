// GET /api/x402-prepaid/balance?payer=<solana address>
//
// A payer's prepaid x402 balance (USDC atomics). Balances are not secret: the
// ledger is keyed by a public wallet address and the deposit that funded it is on-chain.

import { cors, error, json, method, wrap } from '../_lib/http.js';
import { clientIp, limits } from '../_lib/rate-limit.js';
import { rateLimited } from '../_lib/http.js';
import { getBalance, isLedgerUnavailable } from '../_lib/x402/prepaid-ledger.js';
import { PREPAID_ASSET, PREPAID_NETWORK } from '../_lib/x402/prepaid-chain.js';

const SOL_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;
	const rl = await limits.x402ProbeIp(clientIp(req));
	if (!rl.success) return rateLimited(res, rl);

	const payer = String(req.query?.payer || new URL(req.url, 'http://x').searchParams.get('payer') || '');
	if (!SOL_ADDRESS.test(payer)) return error(res, 400, 'bad_request', 'payer must be a Solana address');
	try {
		const balance = await getBalance({ payer, network: PREPAID_NETWORK, asset: PREPAID_ASSET });
		return json(res, 200, {
			payer,
			network: PREPAID_NETWORK,
			asset: PREPAID_ASSET,
			balance_atomics: balance.toString(),
			balance_usd: Number(balance) / 1e6,
		});
	} catch (err) {
		if (isLedgerUnavailable(err)) {
			return error(res, 503, 'prepaid_unavailable', 'prepaid balances are not enabled on this deployment yet');
		}
		throw err;
	}
});

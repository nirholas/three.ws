// GET /api/me/wallet?network=mainnet|devnet
//
// The signed-in account's own primary linked Solana wallet with live SOL and
// USDC balances. Read only: the platform never holds this key. Needs a session
// or a bearer token with wallet:read.

import { cors, json, method, rateLimited, wrap } from '../_lib/http.js';
import { limits } from '../_lib/rate-limit.js';
import { requirePrincipal } from '../_lib/custody/auth.js';
import { answerCustody } from '../_lib/custody/http.js';
import { readPrivateWallet } from '../_lib/custody/private-wallet.js';

export default wrap(async function handler(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET'])) return;
	return answerCustody(res, async () => {
		const principal = await requirePrincipal(req, 'wallet:read');
		const rl = await limits.walletRead(principal.userId);
		if (!rl.success) return rateLimited(res, rl);
		const network = new URL(req.url, 'http://x').searchParams.get('network');
		const data = await readPrivateWallet(principal.userId, network);
		return json(res, 200, { data }, { 'cache-control': 'private, max-age=15' });
	});
});

// GET /api/crypto/funding-graph: who funded a Solana wallet, and who funded
// them, two hops back. Nodes and edges ready to render as a force graph.
//
// Funder = the account that paid the wallet's first-ever SOL into existence, read
// from its first transaction. A funder whose history is too long to reach (an
// exchange, a router) is marked `service` and the trace stops there.
//
// Query:
//   wallet = <Solana wallet>  (required)
//
// Response: { wallet, hops, nodes[{id,hop,kind,first_time,history_complete,service}],
//   edges[{source,target,hop,lamports,at}], truncated, ts }

import { cors, method, wrap, error, json, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { isValidSolanaAddress, isValidEvmAddress } from '../_lib/validate.js';
import { traceFundingGraph } from '../_lib/token-due-diligence.js';

const EXAMPLE = '/api/crypto/funding-graph?wallet=<solana wallet>';

export default wrap(async (req, res) => {
	if (cors(req, res, { origins: '*', methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	const ip = clientIp(req);
	const [ipRl, ddRl, globalRl] = await Promise.all([
		limits.cryptoDataIp(ip),
		limits.cryptoHoldersIp(ip),
		limits.cryptoDataGlobal(),
	]);
	if (!ipRl.success) return rateLimited(res, ipRl);
	if (!ddRl.success) return rateLimited(res, ddRl);
	if (!globalRl.success) return rateLimited(res, globalRl);

	const url = new URL(req.url, 'http://localhost');
	const wallet = (url.searchParams.get('wallet') || '').trim();
	if (!wallet) return error(res, 400, 'missing_wallet', 'query param `wallet` is required. Pass a Solana wallet address', { example: EXAMPLE });
	if (isValidEvmAddress(wallet)) return error(res, 400, 'unsupported_chain', 'this endpoint traces Solana wallets only', { example: EXAMPLE });
	if (!isValidSolanaAddress(wallet)) return error(res, 400, 'invalid_address', '`wallet` must be a base58 Solana address (32-44 chars)', { wallet, example: EXAMPLE });

	let graph;
	try {
		graph = await traceFundingGraph(wallet);
	} catch (err) {
		console.warn('[funding-graph] trace failed:', err?.message);
		return json(res, 503, {
			error: 'upstream_unavailable',
			error_description: 'chain data sources are temporarily unreachable, retry shortly',
			wallet,
			retry_after: 15,
			ts: new Date().toISOString(),
		}, { 'cache-control': 'no-store', 'retry-after': '15' });
	}
	return json(res, 200, { ...graph, ts: new Date().toISOString() }, {
		'cache-control': 'public, s-maxage=300, stale-while-revalidate=600',
	});
});

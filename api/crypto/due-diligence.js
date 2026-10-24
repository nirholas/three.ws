// GET /api/crypto/due-diligence: who holds a Solana token and how those holders
// relate. Insider hold rate, sniper share, bundler exposure, fresh-wallet ratio
// and smart-money holders, each as a share of total supply, plus a two-hop
// funding graph of the largest holders.
//
// Part of the free Crypto Data API (/api/crypto/*). Computed from chain data and
// our own tracked wallet history (no third-party labels), cached per mint for
// five minutes. Field definitions and thresholds: docs/token-due-diligence.md.
//
// Query:
//   address = <Solana mint>   (required)
//
// Response: { address, chain, status, computed_at, ttl_seconds, fields, holders,
//   clusters, coverage, notes, graph, thresholds, definitions, ts }
// A field is null (never a guess) when the data it needs could not be read;
// `coverage` and `notes` say which reads failed.

import { cors, method, wrap, error, json, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { isValidSolanaAddress, isValidEvmAddress } from '../_lib/validate.js';
import { getTokenDueDiligence } from '../_lib/token-due-diligence.js';

const EXAMPLE = '/api/crypto/due-diligence?address=FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';

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
	const address = (url.searchParams.get('address') || '').trim();
	if (!address) {
		return error(res, 400, 'missing_address', 'query param `address` is required. Pass a Solana token mint', { example: EXAMPLE });
	}
	if (isValidEvmAddress(address)) {
		return error(res, 400, 'unsupported_chain', 'this endpoint reads Solana holders only. Pass a base58 Solana mint address', { example: EXAMPLE });
	}
	if (!isValidSolanaAddress(address)) {
		return error(res, 400, 'invalid_address', '`address` must be a base58 Solana mint address (32-44 chars)', { address, example: EXAMPLE });
	}

	const report = await getTokenDueDiligence(address);
	if (report.status === 'not_found') {
		return error(res, 400, 'token_not_found', `${address} is not an on-chain token mint. Check the address, or discover live tokens at /api/crypto/trending`, { address });
	}
	if (report.status !== 'ok') {
		return json(res, 503, {
			error: 'upstream_unavailable',
			error_description: 'chain data sources are temporarily unreachable, retry shortly',
			address,
			retry_after: 15,
			ts: new Date().toISOString(),
		}, { 'cache-control': 'no-store', 'retry-after': '15' });
	}

	return json(res, 200, { address, chain: 'solana', ...report, ts: new Date().toISOString() }, {
		'cache-control': 'public, s-maxage=60, stale-while-revalidate=120',
	});
});

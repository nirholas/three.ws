// GET /api/crypto/security: free, keyless token safety / rug-signal check.
//
// Agent use-case: before an agent buys or LPs into a token, it needs a fast
// "is this a honeypot / rug?" read: mint & freeze authority, holder
// concentration, liquidity depth, metadata mutability, LP custody. This is the
// single most-requested pre-trade check in crypto agent workflows; one keyless
// GET answers it with on-chain FACTS and a documented, deterministic riskLevel,
// never an LLM opinion, never a guessed "safe".
//
// Part of the free Crypto Data API (/api/crypto/*). Plain-handler pattern: no
// account, no key, generous per-IP limit. Real data only, from Solana RPC (failover
// chain), DexScreener, pump.fun public records, Metaplex metadata. Solana-only
// by design: the checks (SPL authorities, getTokenLargestAccounts) are Solana
// concepts; an EVM address gets an honest 400, not a half-built passthrough.
//
// Query:
//   address = <Solana mint>            (required)
//   chain   = solana                   (optional; only 'solana'/'sol' accepted)
//
// Response: { address, chain, checks: { mintAuthorityRevoked,
//   freezeAuthorityRevoked, metadataMutable, lpBurnedOrLocked, liquidityUsd,
//   topHolderPctFlag }, riskLevel: low|medium|high|unknown, reasons[], ts,
//   sources[] }. Unknowns are null/'unknown', never guessed.

import { cors, method, wrap, error, json, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { isValidSolanaAddress, isValidEvmAddress } from '../_lib/validate.js';
import { composeTokenSecurity } from '../_lib/crypto-token-security.js';
import { cacheGet, cacheSet } from '../_lib/cache.js';
import { staleEnvelope } from '../_lib/rpc-degrade.js';

// One record per mint, two tiers (the same shape /api/crypto/holders uses):
//  - fresh: a repeat check inside the 60s edge max-age is answered from it, so
//    a scanner that misses the edge (every production request on 2026-11-04 did)
//    never re-reads three accounts it was handed seconds ago.
//  - last-good: the previous verdict, served marked stale while every source is
//    down. Authorities change rarely; a stale verdict says how old it is, a 503
//    says nothing.
const SECURITY_FRESH_MS = 60_000;
const SECURITY_LKG_TTL_S = 6 * 3600;
const securityKey = (address) => `crypto:security:v1:${address}`;

const EXAMPLE = '/api/crypto/security?address=FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';

export default wrap(async (req, res) => {
	if (cors(req, res, { origins: '*', methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	const ip = clientIp(req);
	const [ipRl, globalRl] = await Promise.all([limits.cryptoDataIp(ip), limits.cryptoDataGlobal()]);
	if (!ipRl.success) return rateLimited(res, ipRl);
	if (!globalRl.success) return rateLimited(res, globalRl);

	const url = new URL(req.url, 'http://localhost');
	const address = (url.searchParams.get('address') || '').trim();
	const rawChain = (url.searchParams.get('chain') || '').trim().toLowerCase();

	if (!address) {
		return error(res, 400, 'missing_address', 'query param `address` is required. Pass a Solana token mint', {
			example: EXAMPLE,
		});
	}
	// EVM is a deliberate, honest 400 (matches the v1 security reader): SPL
	// mint/freeze authorities and getTokenLargestAccounts have no EVM equivalent
	// here, and a half-answered EVM check would read as a fake "safe".
	if (isValidEvmAddress(address) || (rawChain && rawChain !== 'solana' && rawChain !== 'sol')) {
		return error(res, 400, 'unsupported_chain', 'this endpoint checks Solana tokens only. Pass a base58 Solana mint address', {
			example: EXAMPLE,
		});
	}
	if (!isValidSolanaAddress(address)) {
		return error(res, 400, 'invalid_address', '`address` must be a base58 Solana mint address (32-44 chars)', {
			address,
			example: EXAMPLE,
		});
	}

	const key = securityKey(address);
	const cached = await cacheGet(key).catch(() => null);
	if (cached && cached.body && typeof cached.at === 'number' && Date.now() - cached.at < SECURITY_FRESH_MS) {
		return json(res, 200, cached.body, {
			'cache-control': 'public, s-maxage=60, stale-while-revalidate=30',
			'x-security-cache': 'hit',
		});
	}

	const result = await composeTokenSecurity({ address });
	const ts = new Date().toISOString();

	// Valid mint shape, but neither the chain nor any market/pump source knows it:
	// client input, matching the bundle's /token and /bonding conventions.
	if (result.status === 'not_found') {
		return error(res, 400, 'token_not_found', `${address} is not a token any live source can resolve. Check the mint, or discover live tokens at /api/crypto/trending`, {
			address,
		});
	}

	// Every source unreachable: never 500, and never a fabricated verdict; 503 +
	// Retry-After so the agent backs off and retries.
	if (result.status === 'upstream_down') {
		if (cached && cached.body && typeof cached.at === 'number') {
			return json(res, 200, staleEnvelope(cached.body, cached.at), {
				'cache-control': 'public, s-maxage=30, stale-while-revalidate=60',
				'x-security-stale': '1',
			});
		}
		return json(res, 503, {
			error: 'upstream_unavailable',
			error_description: 'security data sources are temporarily unreachable, retry shortly; no verdict is fabricated while sources are down',
			address,
			retry_after: 15,
			ts,
		}, { 'cache-control': 'no-store', 'retry-after': '15' });
	}

	const body = {
		address,
		chain: 'solana',
		checks: result.checks,
		riskLevel: result.riskLevel,
		reasons: result.reasons,
		ts,
		sources: result.sources,
	};
	cacheSet(key, { body, at: Date.now() }, SECURITY_LKG_TTL_S).catch(() => {});

	// Authorities/holders move rarely; 60s edge cache absorbs polling agents
	// without staleness that matters for a pre-trade check.
	return json(res, 200, body, { 'cache-control': 'public, s-maxage=60, stale-while-revalidate=30' });
});

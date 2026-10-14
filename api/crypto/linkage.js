// GET /api/crypto/linkage: are these Solana wallets the same person?
//
// Agent use-case: a sniper or copy-trade agent vetting early buyers of a coin
// needs to know whether they are independent actors or the creator's own
// alts. One call answers it: pairwise 0-100 same-controller scores with
// evidence, across 2-10 addresses, combined by noisy-OR over six real
// on-chain signals (shared fee payer, first-funder, SPL token-account
// control, direct transfer, funding burst). Keyless, real RPC history, never
// a mock.
//
// Part of the free Crypto Data API (/api/crypto/*). Backed by
// @three-ws/wallet-linkage (ported from the owner's proprietary
// wallet-sleuth), given this deployment's own Solana RPC failover chain as
// its injected client so it never talks to a hardcoded endpoint.
//
// Query:
//   addresses = <Solana address>,<Solana address>[,...]   (required, 2-10)
//
// Response: { addresses[], pairs: [{ a, b, score, band, topSignal, signals[],
//   evidence[] }], complete, ts }
// `complete:false` means at least one address's history walk hit its time or
// request budget before finishing: scores are still real, just possibly
// based on partial history.

import { analyzeLinkage } from '@three-ws/wallet-linkage';

import { cors, method, wrap, error, json, rateLimited } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { isValidSolanaAddress, isValidEvmAddress } from '../_lib/validate.js';
import { solanaConnection } from '../_lib/solana/connection.js';
import { cacheGet, cacheSet } from '../_lib/cache.js';
import { staleEnvelope } from '../_lib/rpc-degrade.js';

const MIN_ADDRESSES = 2;
const MAX_ADDRESSES = 10;

// Repeat lookups of the same set absorb into this window; linkage facts move
// slowly (new transactions, not price), so a few minutes of staleness is a
// correct answer, not a stale one.
const LINKAGE_FRESH_MS = 5 * 60_000;
const LINKAGE_LKG_TTL_S = 24 * 3600;

const EXAMPLE = '/api/crypto/linkage?addresses=FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump,11111111111111111111111111111111';

const linkageLkgKey = (addresses) => `crypto:linkage:lkg:${addresses.join(',')}`;

export default wrap(async (req, res) => {
	if (cors(req, res, { origins: '*', methods: 'GET,OPTIONS' })) return;
	if (!method(req, res, ['GET'])) return;

	const ip = clientIp(req);
	const [ipRl, linkageRl, globalRl, linkageGlobalRl] = await Promise.all([
		limits.cryptoDataIp(ip),
		limits.cryptoLinkageIp(ip),
		limits.cryptoDataGlobal(),
		limits.cryptoLinkageGlobal(),
	]);
	if (!ipRl.success) return rateLimited(res, ipRl);
	if (!linkageRl.success) return rateLimited(res, linkageRl);
	if (!globalRl.success) return rateLimited(res, globalRl);
	if (!linkageGlobalRl.success) return rateLimited(res, linkageGlobalRl);

	const url = new URL(req.url, 'http://localhost');
	const raw = (url.searchParams.get('addresses') || '').trim();
	if (!raw) {
		return error(res, 400, 'missing_addresses', 'query param `addresses` is required: 2 to 10 comma-separated Solana addresses', {
			example: EXAMPLE,
		});
	}

	const addresses = [...new Set(raw.split(',').map((a) => a.trim()).filter(Boolean))];
	if (addresses.length < MIN_ADDRESSES || addresses.length > MAX_ADDRESSES) {
		return error(res, 400, 'invalid_address_count', `pass between ${MIN_ADDRESSES} and ${MAX_ADDRESSES} distinct addresses`, {
			received: addresses.length,
			example: EXAMPLE,
		});
	}
	const evm = addresses.find(isValidEvmAddress);
	if (evm) {
		return error(res, 400, 'unsupported_chain', 'this endpoint reads Solana wallet linkage only (Solana first). Pass base58 Solana addresses', {
			address: evm,
			example: EXAMPLE,
		});
	}
	const invalid = addresses.find((a) => !isValidSolanaAddress(a));
	if (invalid) {
		return error(res, 400, 'invalid_address', '`addresses` must each be a base58 Solana address (32-44 chars)', {
			address: invalid,
			example: EXAMPLE,
		});
	}

	const lkgKey = linkageLkgKey(addresses);
	const cached = await cacheGet(lkgKey);
	if (cached && cached.body && typeof cached.at === 'number' && Date.now() - cached.at < LINKAGE_FRESH_MS) {
		return json(res, 200, cached.body, {
			'cache-control': 'public, s-maxage=120, stale-while-revalidate=120',
			'x-linkage-cache': 'hit',
		});
	}

	const ts = new Date().toISOString();
	let result;
	try {
		const connection = solanaConnection({ network: 'mainnet' });
		result = await analyzeLinkage(connection, addresses);
	} catch (err) {
		if (cached && cached.body && typeof cached.at === 'number') {
			return json(res, 200, staleEnvelope(cached.body, cached.at), {
				'cache-control': 'public, s-maxage=30, stale-while-revalidate=60',
				'x-linkage-stale': '1',
			});
		}
		return json(res, 503, {
			error: 'upstream_unavailable',
			error_description: 'Solana RPC is temporarily unreachable, retry shortly',
			message: err?.message || String(err),
			retry_after: 15,
			ts,
		}, { 'cache-control': 'no-store', 'retry-after': '15' });
	}

	const body = {
		addresses: result.addresses,
		pairs: result.pairs,
		complete: result.complete,
		ts,
	};
	cacheSet(lkgKey, { body, at: Date.now() }, LINKAGE_LKG_TTL_S).catch(() => {});

	return json(res, 200, body, {
		'cache-control': 'public, s-maxage=120, stale-while-revalidate=120',
	});
});

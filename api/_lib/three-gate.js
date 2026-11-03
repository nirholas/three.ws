// Shared $THREE holder gate utility.
//
// Checks whether a Solana wallet holds at least `min` raw $THREE tokens.
// $THREE is a Token-2022 mint; we query with the standard RPC filter which
// works across both token programs when querying by specific mint.
//
// Used by:
//   - api/pump/check-three-balance.js (public HTTP endpoint)
//   - api/agents/x402/[action].js     (inline gate check in skill executor)

import { PublicKey } from '@solana/web3.js';
import { solanaConnection } from './agent-pumpfun.js';
import { getRedis } from './redis.js';

export const THREE_CA = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const CACHE_TTL_S = 30;

const READ_ATTEMPTS = 2;

async function readBalance(wallet) {
	const conn = solanaConnection('mainnet');
	const accts = await conn.getParsedTokenAccountsByOwner(
		new PublicKey(wallet),
		{ mint: new PublicKey(THREE_CA) },
		'confirmed',
	);
	let balance = 0;
	for (const { account } of accts.value) {
		const amt = account?.data?.parsed?.info?.tokenAmount?.amount;
		if (amt) balance += Number(BigInt(amt));
	}
	return balance;
}

/**
 * Returns { wallet, balance, min, eligible } for a completed read, or
 * { wallet, balance: null, min, eligible: false, unavailable: true,
 *   reason: 'rpc_unavailable' } when the balance could not be read.
 * Never throws. Fails CLOSED: an RPC outage is never eligible, so a paid gate
 * cannot be bypassed by a zero-balance caller during an outage. The read is
 * attempted twice (the connection rotates lanes per request) before declaring
 * the balance unavailable. Unavailable results are never cached.
 */
export async function checkThreeBalance(wallet, min = 1) {
	const minNum = Math.max(0, parseInt(min, 10) || 0);

	const cacheKey = `three-gate:${wallet}:${minNum}`;
	const redis = getRedis();
	if (redis) {
		try {
			const cached = await redis.get(cacheKey);
			if (cached) return cached;
		} catch { /* continue */ }
	}

	let balance = null;
	for (let attempt = 0; attempt < READ_ATTEMPTS && balance === null; attempt++) {
		try {
			balance = await readBalance(wallet);
		} catch { /* retry on the next lane, then report unavailable */ }
	}
	if (balance === null) {
		return { wallet, balance: null, min: minNum, eligible: false, unavailable: true, reason: 'rpc_unavailable' };
	}

	const result = { wallet, balance, min: minNum, eligible: balance >= minNum };

	if (redis) {
		redis.set(cacheKey, result, { ex: CACHE_TTL_S }).catch(() => {});
	}

	return result;
}

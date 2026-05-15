// Public surface of the coin (lottery + reflection) library.
// Re-exports the building blocks so cron handlers and API endpoints can
// import from one stable path.

export { claimCreatorFees, isValidPubkey } from './creator-fees.js';
export {
	loadCoinTreasury,
	loadCoinCreatorFromCoin,
	lamportsToSol,
	sendSolTransfer,
	sendSolBatched,
} from './treasury.js';
export {
	fetchHolderBalances,
	persistHolderSnapshot,
	readEligibleHolders,
} from './holders.js';
export {
	DRAND,
	roundForTime,
	timeForRound,
	fetchDrandRound,
	verifyDrandSignature,
	drandRoundMessage,
	seedFor,
	weightedPick,
	weightsHash,
	bigintPRNG,
} from './randomness.js';
export {
	snapshotHolders,
	claimAndSplit,
	commitLottery,
	resolveLottery,
	resolvePendingDraws,
	allocateReflection,
} from './distribution.js';
export { drainPendingPayouts } from './payouts.js';

import { sql } from '../db.js';

/**
 * Load a coin_launches row by mint pubkey. Returns null if not found.
 */
export async function loadCoinByMint(mint) {
	const [row] = await sql`
		select * from coin_launches where mint = ${mint} limit 1
	`;
	return row || null;
}

/**
 * Load a coin_launches row by uuid id.
 */
export async function loadCoinById(id) {
	const [row] = await sql`
		select * from coin_launches where id = ${id} limit 1
	`;
	return row || null;
}

/**
 * List all coins marked active. Used by cron handlers to sweep every coin.
 */
export async function listActiveCoins() {
	return sql`
		select * from coin_launches
		where is_active = true
		order by created_at asc
	`;
}

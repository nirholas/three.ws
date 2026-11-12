// Token launches from the venue catalog. An ERC-20 emits Transfer(0x0, to, n)
// when its supply is minted, so scanning those logs and attributing each to the
// contract that the transaction called finds launches on every venue at once,
// including ones that emit no launch event of their own.

import { parseAbi } from 'viem';
import { venueForCall } from './venues.js';
import { isTransientRpcError } from './rpc.js';
import { scanLogRanges } from './scan.js';

export const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const ZERO_TOPIC = `0x${'0'.repeat(64)}`;

const poolAbi = parseAbi(['function token0() view returns (address)']);

const toHex = (n) => `0x${BigInt(n).toString(16)}`;

/**
 * Pick the supply mints out of raw Transfer-from-zero logs. ERC-721 shares the
 * Transfer topic but indexes the token id (four topics, no data), so it is
 * dropped here, otherwise every position NFT would read as a coin.
 */
export function parseMintLogs(logs) {
	const first = new Map(); // token(lower) → earliest mint
	for (const log of logs) {
		if (!Array.isArray(log.topics) || log.topics.length !== 3 || !log.data || log.data === '0x') continue;
		const blockNumber = BigInt(log.blockNumber);
		const logIndex = Number(BigInt(log.logIndex ?? 0));
		const key = log.address.toLowerCase();
		const cur = first.get(key);
		if (!cur || blockNumber < cur.blockNumber || (blockNumber === cur.blockNumber && logIndex < cur.logIndex)) {
			first.set(key, { token: log.address, blockNumber, logIndex, transactionHash: log.transactionHash });
		}
	}
	return [...first.values()].sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));
}

/**
 * Turn a mint and the transaction that produced it into a launch, or null when
 * the transaction did not call a catalogued venue.
 */
export function launchFromMint(mint, tx) {
	const venue = venueForCall(tx?.to, tx?.input);
	if (!venue) return null;
	return {
		launchpad: venue.id,
		venue,
		token: mint.token,
		creator: tx.from,
		pool: null,
		blockNumber: mint.blockNumber,
		transactionHash: mint.transactionHash,
	};
}

/**
 * Every Transfer-from-zero log in [from, to], scanned in chunks. Throttling,
 * provider reset hints and the matched-log cap are handled by scanLogRanges
 * (scan.js), so a wide backfill on the public RPC slows down instead of aborting.
 *
 * @param {(args: {method: string, params: unknown[]}) => Promise<any>} request viem `client.request`
 * @param {bigint|number} from
 * @param {bigint|number} to
 * @param {Parameters<typeof scanLogRanges>[3]} [opts]
 */
export async function getMintLogs(request, from, to, opts = {}) {
	return scanLogRanges((start, end) => request({
		method: 'eth_getLogs',
		params: [{ topics: [TRANSFER_TOPIC, ZERO_TOPIC], fromBlock: toHex(start), toBlock: toHex(end) }],
	}), from, to, { chunk: 4_000n, ...opts });
}

/** An AMM pair mints LP shares from zero exactly like a coin does; pairs answer token0(). */
export async function isPoolToken(readContract, address) {
	try {
		await readContract({ address, abi: poolAbi, functionName: 'token0' });
		return true;
	} catch (err) {
		// A revert means "not a pair". A transport failure says nothing about the
		// address, so it must not be read as an answer.
		if (isTransientRpcError(err)) throw err;
		return false;
	}
}

/**
 * Attribute mints to venues. Transactions are fetched once per hash and the
 * pool check runs only for mints that already matched a venue, so a quiet
 * launchpad costs one transaction read per mint, not one per ERC-20 on chain.
 *
 * @param {{ getTransaction: (hash: string) => Promise<any>, readContract: Function }} rpc
 * @param {Array<object>} mints output of parseMintLogs
 * @returns {Promise<Array<object>>} launches, oldest first
 */
export async function launchesFromMints(rpc, mints, { concurrency = 8 } = {}) {
	const txs = new Map(); // hash → Promise<tx|null>
	const txFor = (hash) => {
		if (!txs.has(hash)) txs.set(hash, Promise.resolve(rpc.getTransaction(hash)));
		return txs.get(hash);
	};
	const out = new Array(mints.length).fill(null);
	let next = 0;
	await Promise.all(Array.from({ length: Math.min(concurrency, mints.length) }, async () => {
		while (next < mints.length) {
			const i = next++;
			const mint = mints[i];
			const launch = launchFromMint(mint, await txFor(mint.transactionHash));
			if (!launch) continue;
			if (await isPoolToken(rpc.readContract, mint.token)) continue;
			out[i] = launch;
		}
	}));
	return out.filter(Boolean);
}

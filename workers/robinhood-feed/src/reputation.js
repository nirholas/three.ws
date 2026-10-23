// Deployer reputation and the dev-sold flag, derived from chain state only.
// Nothing is scraped, self-reported or model-scored, and every figure states
// the window it covers so a thin record is never read as a clean one.
//
//   dev allocation  Transfer logs into the creator inside the launch
//                   transaction, summed per token. A creator who received
//                   nothing has no allocation to sell, so `dev_sold` is null
//                   for them rather than a false "sold".
//   dev sold        The creator's balance has since fallen to zero.
//   prior launches  Launches by the same creator that this process observed
//                   before the current one (cold-start backfill + live).
//   prior dev exits Those prior launches where the creator received an
//                   allocation and now holds none of it. A heuristic: it
//                   reads "the deployer walked away from a token", which is
//                   what a rug looks like from the deployer's side, but a
//                   transfer to another wallet reads the same.

import { erc20Abi } from 'viem';

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

const topicAddress = (topic) => `0x${topic.slice(-40)}`.toLowerCase();

/**
 * What the creator was handed by the launch transaction, in token base units.
 *
 * @param {Array<{address: string, topics: string[], data: string}>} logs receipt logs
 * @returns {bigint}
 */
export function devAllocation(logs, token, creator) {
	const tokenKey = token.toLowerCase();
	const creatorKey = creator.toLowerCase();
	let total = 0n;
	for (const log of logs) {
		if (log.address.toLowerCase() !== tokenKey) continue;
		if (log.topics?.length !== 3 || log.topics[0] !== TRANSFER_TOPIC) continue;
		if (topicAddress(log.topics[2]) !== creatorKey) continue;
		total += BigInt(log.data);
	}
	return total;
}

/**
 * @param {bigint} allocation what the creator received at launch
 * @param {bigint|null} balance the creator's balance now, null when unreadable
 * @returns {{dev_sold: boolean|null, dev_sold_pct: number|null}}
 */
export function devStatus(allocation, balance) {
	if (allocation <= 0n || balance === null || balance === undefined) return { dev_sold: null, dev_sold_pct: null };
	const held = balance > allocation ? allocation : balance;
	const soldBp = Number(((allocation - held) * 10_000n) / allocation);
	return { dev_sold: balance === 0n, dev_sold_pct: soldBp / 100 };
}

/** Thresholds for the flags below. Exported so the tests and the docs state the same numbers. */
export const FLAG_RULES = Object.freeze({ serialDeployerLaunches: 5, serialExitCount: 2 });

/**
 * @param {{dev_sold: boolean|null}} dev
 * @param {{prior_launches: number, prior_dev_exits: number}} deployer
 * @returns {string[]}
 */
export function riskFlags(dev, deployer) {
	const flags = [];
	if (dev.dev_sold === true) flags.push('dev_sold');
	if (deployer.prior_dev_exits >= FLAG_RULES.serialExitCount) flags.push('serial_exit');
	else if (deployer.prior_dev_exits >= 1) flags.push('prior_dev_exit');
	if (deployer.prior_launches >= FLAG_RULES.serialDeployerLaunches) flags.push('serial_deployer');
	return flags;
}

/**
 * The launch index and the reads that grade a deployer against it.
 *
 * @param {{ readContract: Function, multicall: Function }} rpc
 * @param {{ maxCreators?: number, maxPerCreator?: number, maxInspect?: number, windowBlocks?: number }} [opts]
 */
export function createReputation(rpc, { maxCreators = 5_000, maxPerCreator = 100, maxInspect = 10, windowBlocks = 0 } = {}) {
	const byCreator = new Map(); // creator(lower) → [{ token, blockNumber, allocation }]

	function record({ creator, token, blockNumber, allocation }) {
		const key = creator.toLowerCase();
		const list = byCreator.get(key) || [];
		if (list.some((l) => l.token.toLowerCase() === token.toLowerCase())) return;
		list.push({ token, blockNumber: BigInt(blockNumber), allocation: allocation ?? 0n });
		list.sort((a, b) => (a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : 0));
		while (list.length > maxPerCreator) list.shift();
		byCreator.delete(key);
		byCreator.set(key, list); // refresh LRU position
		while (byCreator.size > maxCreators) byCreator.delete(byCreator.keys().next().value);
	}

	/**
	 * @param {string} creator
	 * @param {bigint|number} beforeBlock only launches strictly before this block count as prior
	 */
	async function assess(creator, beforeBlock) {
		const before = BigInt(beforeBlock);
		const prior = (byCreator.get(creator.toLowerCase()) || []).filter((l) => l.blockNumber < before);
		const inspectable = prior.filter((l) => l.allocation > 0n).slice(-maxInspect);
		let exits = 0;
		let inspected = 0;
		if (inspectable.length) {
			const results = await rpc.multicall({
				contracts: inspectable.map((l) => ({ address: l.token, abi: erc20Abi, functionName: 'balanceOf', args: [creator] })),
				allowFailure: true,
			}).catch(() => null);
			if (results) {
				results.forEach((r, i) => {
					if (r.status !== 'success') return;
					inspected += 1;
					if (devStatus(inspectable[i].allocation, r.result).dev_sold === true) exits += 1;
				});
			}
		}
		return {
			prior_launches: prior.length,
			prior_dev_exits: exits,
			inspected,
			window_blocks: windowBlocks || null,
		};
	}

	return { record, assess, size: () => byCreator.size };
}

/**
 * Batch-read current balances for a set of (token, holder) pairs.
 * Returns a bigint per pair, or null where the read failed.
 */
export async function readBalances(rpc, pairs) {
	if (!pairs.length) return [];
	const results = await rpc.multicall({
		contracts: pairs.map((p) => ({ address: p.token, abi: erc20Abi, functionName: 'balanceOf', args: [p.holder] })),
		allowFailure: true,
	});
	return results.map((r) => (r.status === 'success' ? r.result : null));
}

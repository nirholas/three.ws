#!/usr/bin/env node
// Census of Uniswap v4 hooks actually in use on a chain, compared against the
// public hooklist registry (https://github.com/Uniswap/hooklist).
//
// Reads every PoolManager `Initialize` event, collects the distinct non-zero hook
// addresses, and reports how many of them the registry does not list yet.
//
// Usage:
//   node scripts/uniswap-v4-hook-census.mjs <rpcUrl> <poolManager> <chainId> <hooklistChain> [fromBlock]
// Example (Robinhood Chain, about 680 RPC calls):
//   node scripts/uniswap-v4-hook-census.mjs https://rpc.mainnet.chain.robinhood.com \
//     0x8366a39cc670b4001a1121b8f6a443a643e40951 4663 robinhood
//
// SPAN sets the eth_getLogs block range (default 100000). Lower it for RPCs with a
// tighter cap; the scan also shrinks the range on its own when a call is refused.

import { ethers } from 'ethers';

const [rpcUrl, poolManager, chainIdArg, hooklistChain, fromArg] = process.argv.slice(2);
if (!rpcUrl || !poolManager || !chainIdArg || !hooklistChain) {
	console.error(
		'usage: uniswap-v4-hook-census.mjs <rpcUrl> <poolManager> <chainId> <hooklistChain> [fromBlock]',
	);
	process.exit(1);
}

const HOOKLIST_URL = 'https://raw.githubusercontent.com/Uniswap/hooklist/main/hooklist.json';
const INITIALIZE_TOPIC = ethers.id(
	'Initialize(bytes32,address,address,uint24,int24,address,uint160,int24)',
);
const ZERO_HOOK = '0x' + '0'.repeat(40);
const MAX_SPAN = Number(process.env.SPAN || 100000);
const MIN_SPAN = 100;

// `hooks` is the third non-indexed field: fee, tickSpacing, hooks, sqrtPriceX96, tick.
function hookFromLogData(data) {
	return ('0x' + data.slice(2 + 64 * 2 + 24, 2 + 64 * 3)).toLowerCase();
}

async function scanHooks(provider) {
	const latest = await provider.getBlockNumber();
	const poolsByHook = new Map();
	let pools = 0;
	let from = Number(fromArg || 0);
	let span = MAX_SPAN;
	while (from <= latest) {
		const to = Math.min(from + span - 1, latest);
		let logs;
		try {
			logs = await provider.getLogs({
				address: poolManager,
				topics: [INITIALIZE_TOPIC],
				fromBlock: from,
				toBlock: to,
			});
		} catch (err) {
			if (span === MIN_SPAN) throw err;
			span = Math.max(MIN_SPAN, Math.floor(span / 4));
			continue;
		}
		for (const log of logs) {
			pools++;
			const hook = hookFromLogData(log.data);
			if (hook !== ZERO_HOOK) poolsByHook.set(hook, (poolsByHook.get(hook) || 0) + 1);
		}
		from = to + 1;
		span = Math.min(MAX_SPAN, span * 2);
	}
	return { latest, pools, poolsByHook };
}

async function listedHooks(chain) {
	const res = await fetch(HOOKLIST_URL);
	if (!res.ok) throw new Error(`hooklist fetch failed: HTTP ${res.status}`);
	const entries = await res.json();
	return new Set(
		entries.filter((e) => e.hook.chain === chain).map((e) => e.hook.address.toLowerCase()),
	);
}

const provider = new ethers.JsonRpcProvider(rpcUrl, Number(chainIdArg), { staticNetwork: true });
const [{ latest, pools, poolsByHook }, listed] = await Promise.all([
	scanHooks(provider),
	listedHooks(hooklistChain),
]);

const unlisted = [...poolsByHook.entries()]
	.filter(([hook]) => !listed.has(hook))
	.sort((a, b) => b[1] - a[1]);

console.error(
	JSON.stringify({
		chainId: Number(chainIdArg),
		latestBlock: latest,
		poolsInitialized: pools,
		distinctHooksOnChain: poolsByHook.size,
		listedInRegistry: listed.size,
		onChainButUnlisted: unlisted.length,
	}),
);
// stdout: one "<hook> <poolCount>" line per unlisted hook, busiest first.
for (const [hook, count] of unlisted) console.log(`${hook} ${count}`);

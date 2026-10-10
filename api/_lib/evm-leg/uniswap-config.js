// The Uniswap lane's static facts and live config: contract addresses on Base,
// fee tiers, lock modes, and what the deployed launcher
// (contracts/src/ThreeWsUniswapLauncher.sol) charges. The lane is available
// once UNISWAP_LAUNCHER_ADDRESS points at a deployed launcher; every fee shown
// to a user is read from that contract, never restated here.

import { getAddress } from 'viem';
import { cacheWrap } from '../cache.js';
import { EVM_LEG_CHAINS, evmLegPublicClient } from './chains.js';

export const UNISWAP_CHAIN = EVM_LEG_CHAINS.base;
export const UNISWAP_VENUE = 'uniswap';

/** Uniswap V3 on Base. The launcher reads the factory from the position manager at deploy time. */
export const BASE_POSITION_MANAGER = '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1';
export const BASE_WETH = '0x4200000000000000000000000000000000000006';

export const TOTAL_SUPPLY_WHOLE = 1_000_000_000n;
export const TOTAL_SUPPLY = TOTAL_SUPPLY_WHOLE * 10n ** 18n;

/** Pool fee tiers V3 supports. `fee` is in hundredths of a basis point. */
export const FEE_TIERS = Object.freeze(
	[100, 500, 3000, 10000].map((fee) => Object.freeze({ fee, bps: fee / 100, tickSpacing: { 100: 1, 500: 10, 3000: 60, 10000: 200 }[fee] })),
);
export const DEFAULT_FEE_TIER = 10000;

export const LOCK_MODES = Object.freeze([
	Object.freeze({ id: 'none', value: 0, label: 'No lock', description: 'The liquidity position stays in your agent\'s wallet. You can withdraw it at any time.' }),
	Object.freeze({ id: 'timelock', value: 1, label: 'Timelock', description: 'The position is held by the launcher until a date you choose (1 day to 10 years). Fees can be collected the whole time.' }),
	Object.freeze({ id: 'permanent', value: 2, label: 'Permanent lock', description: 'The position is held by the launcher forever. Nobody can withdraw the liquidity. Fees can still be collected.' }),
]);

export const MIN_LOCK_DAYS = 1;
export const MAX_LOCK_DAYS = 3650;

/** Market cap bounds, in ETH, at the first block (price times the whole supply). */
export const MIN_START_MARKET_CAP_ETH = 0.01;
export const MAX_START_MARKET_CAP_ETH = 100_000;
export const DEFAULT_START_MARKET_CAP_ETH = 4;

export const launcherAbi = [
	{
		name: 'launch',
		type: 'function',
		stateMutability: 'payable',
		inputs: [{
			name: 'p',
			type: 'tuple',
			components: [
				{ name: 'name', type: 'string' },
				{ name: 'symbol', type: 'string' },
				{ name: 'fee', type: 'uint24' },
				{ name: 'startTick', type: 'int24' },
				{ name: 'creator', type: 'address' },
				{ name: 'feeRecipient', type: 'address' },
				{ name: 'lockMode', type: 'uint8' },
				{ name: 'unlockAt', type: 'uint64' },
				{ name: 'metadataHash', type: 'bytes32' },
				{ name: 'metadataURI', type: 'string' },
				{ name: 'deadline', type: 'uint256' },
			],
		}],
		outputs: [{ name: 'token', type: 'address' }, { name: 'pool', type: 'address' }, { name: 'tokenId', type: 'uint256' }],
	},
	{ name: 'collectFees', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ type: 'uint256' }, { type: 'uint256' }] },
	{ name: 'setFeeRecipient', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'tokenId', type: 'uint256' }, { name: 'newRecipient', type: 'address' }], outputs: [] },
	{ name: 'withdraw', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [] },
	{
		name: 'positionInfo',
		type: 'function',
		stateMutability: 'view',
		inputs: [{ name: 'tokenId', type: 'uint256' }],
		outputs: [{ name: 'creator', type: 'address' }, { name: 'feeRecipient', type: 'address' }, { name: 'lockMode', type: 'uint8' }, { name: 'unlockAt', type: 'uint64' }],
	},
	{ name: 'launchFeeWei', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
	{ name: 'platformShareBps', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint16' }] },
	{ name: 'treasury', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
	{ name: 'weth', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
	{ name: 'positionManager', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
];

export const launchedEvent = {
	type: 'event',
	name: 'Launched',
	inputs: [
		{ name: 'token', type: 'address', indexed: true },
		{ name: 'pool', type: 'address', indexed: true },
		{ name: 'tokenId', type: 'uint256', indexed: true },
		{ name: 'creator', type: 'address', indexed: false },
		{ name: 'feeRecipient', type: 'address', indexed: false },
		{ name: 'fee', type: 'uint24', indexed: false },
		{ name: 'lockMode', type: 'uint8', indexed: false },
		{ name: 'unlockAt', type: 'uint64', indexed: false },
		{ name: 'startTick', type: 'int24', indexed: false },
		{ name: 'metadataHash', type: 'bytes32', indexed: false },
		{ name: 'metadataURI', type: 'string', indexed: false },
	],
};

/** The deployed launcher, or null until one is configured. */
export function launcherAddress() {
	const configured = String(process.env.UNISWAP_LAUNCHER_ADDRESS || '').trim();
	return /^0x[0-9a-fA-F]{40}$/.test(configured) ? getAddress(configured) : null;
}

/**
 * Tick of the coin's price in WETH for a starting market cap, rounded to the
 * tier's tick spacing. The contract flips the sign when the coin sorts second,
 * so one number is right for either ordering.
 */
export function startTickFor(marketCapEth, tickSpacing) {
	const price = marketCapEth / Number(TOTAL_SUPPLY_WHOLE);
	const raw = Math.log(price) / Math.log(1.0001);
	return Math.round(raw / tickSpacing) * tickSpacing;
}

/** The market cap in ETH a tick actually gives, for quoting the rounded value. */
export function marketCapEthAt(tick) {
	return 1.0001 ** tick * Number(TOTAL_SUPPLY_WHOLE);
}

/** What the launcher charges and which options it offers, read from the contract. */
export async function uniswapLaneConfig() {
	const launcher = launcherAddress();
	const base = {
		chain: UNISWAP_CHAIN.slug,
		chainId: UNISWAP_CHAIN.chainId,
		totalSupply: TOTAL_SUPPLY_WHOLE.toLocaleString('en-US'),
		feeTiers: FEE_TIERS,
		lockModes: LOCK_MODES.map(({ id, label, description }) => ({ id, label, description })),
	};
	if (!launcher) {
		return {
			...base,
			available: false,
			launcher: null,
			unavailable_reason: 'The launcher contract is not deployed on Base yet. The lane opens as soon as its address is configured.',
		};
	}
	try {
		return await cacheWrap(`uniswap:config:${launcher}`, 60, async () => {
			const client = evmLegPublicClient(UNISWAP_CHAIN);
			const read = (functionName) => client.readContract({ address: launcher, abi: launcherAbi, functionName });
			const [launchFeeWei, platformShareBps, treasury, weth, positionManager] = await Promise.all([
				read('launchFeeWei'), read('platformShareBps'), read('treasury'), read('weth'), read('positionManager'),
			]);
			return {
				...base,
				available: true,
				launcher,
				launchFeeWei: launchFeeWei.toString(),
				platformShareBps: Number(platformShareBps),
				treasury,
				weth,
				positionManager,
				unavailable_reason: null,
			};
		});
	} catch (err) {
		return { ...base, available: false, launcher, unavailable_reason: `The launcher could not be read: ${String(err?.shortMessage || err?.message || err).slice(0, 120)}` };
	}
}

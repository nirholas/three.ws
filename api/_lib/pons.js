// Pons V2 launchpad on Robinhood Chain (chain 4663): read terms, build the
// launch transaction, quote the creator's opening buy, and read a launch back.
//
// Pons (ponsfamily.com) is the chain's busiest launchpad. Its V2 generation
// mints the full supply onto a per-launch constant-product bonding curve
// quoted in native ETH, then graduates into a permanently locked full-range
// Uniswap V4 pool. Source is MIT and verified on chain:
// https://github.com/ponsdotdev/pons-labs (contractsV2/src/v2).
//
// Every ABI fragment below is copied from that source, and the launch calldata
// is proven against real mainnet launches in tests/pons.test.js: re-encoding a
// decoded `launchAndBuy` / `launchToken` input reproduces the original bytes,
// and the dev-buy quote reproduces the tokensOut the curve actually paid.
//
// A launch with an opening buy goes through PonsV2LaunchAndBuy (the factory's
// trusted `launchForwarder`), the same router the Pons frontend uses: it
// deploys the curve and token, records the signer as the real deployer, and
// settles the creator's opening buy in the same transaction. Atomic matters on
// a chain with 100ms blocks: a separate buy transaction would hand the first
// fill to whichever sniper watches the factory. A launch with no buy calls the
// factory directly, since the router refuses a zero buy.

import { encodeFunctionData, getAddress, keccak256, parseEventLogs, toHex } from 'viem';
import { erc20Metadata, publicClient } from './robinhood.js';
import { cacheWrap } from './cache.js';

export const PONS_CHAIN_ID = 4663;
export const PONS_V2_FACTORY = '0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e';
export const PONS_V2_LAUNCH_AND_BUY = '0xe33E9E479dF8802cb0866d5d05258bEc4cF62948';
export const PONS_V2_MEME_HOOK = '0xE5e702641Ea86F4ae6cC3cDaeD2B886f976Be044';
// Native ETH quote. Pons also approves ERC-20 quote assets, but the native
// curve is the default launch on ponsfamily.com and the only one an agent
// wallet can fund without an approval round trip.
export const NATIVE_PAIR = '0x0000000000000000000000000000000000000000';
export const DEFAULT_LAUNCH_CONFIG_ID = 0n;

// On-chain caps enforced by PonsV2LaunchDeployer._requireMetadataWithinLimits.
// Checked here first so an oversize field fails before any gas is spent.
export const LIMITS = Object.freeze({
	name: 64,
	symbol: 16,
	logo: 512,
	description: 2048,
	social: 256,
});

const BASIS_POINTS = 10_000n;
const SOCIAL_KEYS = ['twitter', 'telegram', 'discord', 'website', 'farcaster'];

const TOKEN_PARAMS = {
	type: 'tuple',
	name: 'params',
	components: [
		{ type: 'string', name: 'name' },
		{ type: 'string', name: 'symbol' },
		{ type: 'string', name: 'logo' },
		{ type: 'string', name: 'description' },
		{
			type: 'tuple',
			name: 'socials',
			components: SOCIAL_KEYS.map((name) => ({ type: 'string', name })),
		},
		{ type: 'address', name: 'creatorFeeRecipient' },
		{ type: 'uint16', name: 'creatorTaxBps' },
		{ type: 'bool', name: 'buybackEnabled' },
		{ type: 'bytes32', name: 'expectedEconomics' },
		{ type: 'bytes32', name: 'salt' },
	],
};

export const PONS_ABI = [
	{
		type: 'function',
		name: 'launchAndBuy',
		stateMutability: 'payable',
		inputs: [
			TOKEN_PARAMS,
			{ type: 'uint256', name: 'launchConfigId' },
			{ type: 'address', name: 'pairToken' },
			{ type: 'uint256', name: 'quoteIn' },
			{ type: 'uint256', name: 'minTokensOut' },
			{ type: 'address', name: 'recipient' },
			{ type: 'address[]', name: 'snipeTaxExemptions' },
		],
		outputs: [{ type: 'address', name: 'token' }, { type: 'address', name: 'curve' }],
	},
	{
		type: 'function',
		name: 'launchToken',
		stateMutability: 'payable',
		inputs: [
			TOKEN_PARAMS,
			{ type: 'uint256', name: 'launchConfigId' },
			{ type: 'address', name: 'pairToken' },
			{ type: 'address[]', name: 'snipeTaxExemptions' },
		],
		outputs: [{ type: 'address', name: 'token' }, { type: 'address', name: 'curve' }],
	},
	{ type: 'function', name: 'launchEnabled', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
	{ type: 'function', name: 'launchFee', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
	{ type: 'function', name: 'maxCreatorTaxBps', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
	{ type: 'function', name: 'launchForwarder', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
	{
		type: 'function',
		name: 'canLaunch',
		stateMutability: 'view',
		inputs: [{ type: 'address', name: 'launcher' }],
		outputs: [{ type: 'bool' }],
	},
	{
		type: 'function',
		name: 'getLaunchConfig',
		stateMutability: 'view',
		inputs: [{ type: 'uint256', name: 'id' }],
		outputs: [
			{
				type: 'tuple',
				components: [
					{ type: 'uint256', name: 'supply' },
					{ type: 'uint256', name: 'curveFeeBps' },
					{ type: 'uint256', name: 'phantomQuote' },
					{ type: 'uint256', name: 'graduationThreshold' },
					{ type: 'uint24', name: 'poolFee' },
					{ type: 'int24', name: 'tickSpacing' },
					{ type: 'bool', name: 'enabled' },
				],
			},
		],
	},
	{
		type: 'function',
		name: 'previewLaunchEconomics',
		stateMutability: 'view',
		inputs: [{ type: 'uint256', name: 'launchConfigId' }, { type: 'address', name: 'pairToken' }],
		outputs: [{ type: 'bytes32' }],
	},
	{
		type: 'event',
		name: 'TokenLaunched',
		inputs: [
			{ type: 'address', name: 'token', indexed: true },
			{ type: 'address', name: 'curve', indexed: true },
			{ type: 'address', name: 'deployer', indexed: true },
			{ type: 'address', name: 'pairToken', indexed: false },
			{ type: 'uint256', name: 'launchConfigId', indexed: false },
			{ type: 'uint256', name: 'graduationThreshold', indexed: false },
		],
	},
	{
		type: 'event',
		name: 'CurveBuy',
		inputs: [
			{ type: 'address', name: 'buyer', indexed: true },
			{ type: 'address', name: 'recipient', indexed: true },
			{ type: 'uint256', name: 'quoteIn', indexed: false },
			{ type: 'uint256', name: 'tokensOut', indexed: false },
			{ type: 'uint256', name: 'fee', indexed: false },
			{ type: 'uint256', name: 'tax', indexed: false },
		],
	},
];

export const PONS_CURVE_ABI = [
	{
		type: 'function',
		name: 'getReserves',
		stateMutability: 'view',
		inputs: [],
		outputs: [{ type: 'uint256', name: 'quoteReserve' }, { type: 'uint256', name: 'tokenReserve' }],
	},
	{ type: 'function', name: 'realQuoteReserve', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
	{ type: 'function', name: 'graduationThreshold', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
	{ type: 'function', name: 'graduated', stateMutability: 'view', inputs: [], outputs: [{ type: 'bool' }] },
	{ type: 'function', name: 'token', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
];

const ERC20_SUPPLY_ABI = [
	{ type: 'function', name: 'totalSupply', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
];

/** keccak256 of the TokenLaunched signature: the factory-log filter topic. */
export const TOKEN_LAUNCHED_TOPIC = keccak256(
	toHex('TokenLaunched(address,address,address,address,uint256,uint256)'),
);

export class PonsError extends Error {
	constructor(code, message, status = 400) {
		super(message);
		this.name = 'PonsError';
		this.code = code;
		this.status = status;
	}
}

/**
 * Live launch terms from the factory: whether public launching is open, the
 * flat launch fee, the config the curve will be built from, the creator-tax
 * ceiling, and the economics digest a launch pins so an owner re-peg between
 * quote and send reverts instead of silently repricing.
 */
export async function readLaunchTerms({ launchConfigId = DEFAULT_LAUNCH_CONFIG_ID, pairToken = NATIVE_PAIR } = {}) {
	const client = publicClient(false);
	const read = (functionName, args = []) =>
		client.readContract({ address: PONS_V2_FACTORY, abi: PONS_ABI, functionName, args });
	const [launchEnabled, launchFee, maxCreatorTaxBps, forwarder, config, economics] = await Promise.all([
		read('launchEnabled'),
		read('launchFee'),
		read('maxCreatorTaxBps'),
		read('launchForwarder'),
		read('getLaunchConfig', [launchConfigId]),
		read('previewLaunchEconomics', [launchConfigId, pairToken]),
	]);
	// The router address is hardcoded for calldata proofs; if Pons rotates its
	// forwarder the factory would reject our launch with NotLaunchForwarder.
	// Refuse up front with a clear reason instead of burning gas on a revert.
	if (getAddress(forwarder) !== getAddress(PONS_V2_LAUNCH_AND_BUY)) {
		throw new PonsError(
			'pons_router_rotated',
			`Pons rotated its launch router to ${forwarder}; three.ws needs an update before launching.`,
			503,
		);
	}
	return {
		launchEnabled,
		launchFee,
		maxCreatorTaxBps,
		launchConfigId,
		pairToken,
		config: {
			supply: config.supply,
			curveFeeBps: config.curveFeeBps,
			phantomQuote: config.phantomQuote,
			graduationThreshold: config.graduationThreshold,
			poolFee: config.poolFee,
			tickSpacing: config.tickSpacing,
			enabled: config.enabled,
		},
		expectedEconomics: economics,
	};
}

/**
 * Tokens the creator's opening buy receives. The curve is brand new inside
 * the launch transaction, so its reserves are exactly (phantomQuote, supply)
 * and nobody can trade ahead of the buy: the quote is deterministic, and it is
 * the same integer arithmetic PonsV2BondingCurve.buy runs, fee and creator tax
 * taken off the quote leg first. Clamped to the sellable allocation the curve
 * reserves for graduation.
 */
export function quoteOpeningBuy({ quoteIn, config, creatorTaxBps = 0 }) {
	const spent = BigInt(quoteIn);
	if (spent <= 0n) return 0n;
	const fee = (spent * BigInt(config.curveFeeBps)) / BASIS_POINTS;
	const tax = (spent * BigInt(creatorTaxBps)) / BASIS_POINTS;
	const net = spent - fee - tax;
	const reserveIn = BigInt(config.phantomQuote);
	const reserveOut = BigInt(config.supply);
	const out = (net * BASIS_POINTS * reserveOut) / (reserveIn * BASIS_POINTS + net * BASIS_POINTS);
	const reserved = (reserveOut * reserveIn) / (reserveIn + BigInt(config.graduationThreshold));
	const sellable = reserveOut - reserved;
	return out > sellable ? sellable : out;
}

function cleanText(value, max, field) {
	const text = String(value ?? '').trim();
	if (Buffer.byteLength(text, 'utf8') > max) {
		throw new PonsError('field_too_long', `${field} is longer than Pons allows (${max} bytes).`);
	}
	return text;
}

/**
 * Validate and normalise the coin a caller wants to launch into the exact
 * TokenParams struct the factory takes. Byte limits mirror the on-chain caps.
 */
export function buildTokenParams({
	name,
	symbol,
	logo = '',
	description = '',
	socials = {},
	creatorFeeRecipient,
	creatorTaxBps = 0,
	buybackEnabled = false,
	expectedEconomics,
	salt,
}) {
	const cleanName = cleanText(name, LIMITS.name, 'Name');
	const cleanSymbol = cleanText(symbol, LIMITS.symbol, 'Symbol').replace(/^\$/, '').toUpperCase();
	if (!cleanName) throw new PonsError('name_required', 'A coin name is required.');
	if (!cleanSymbol) throw new PonsError('symbol_required', 'A ticker symbol is required.');
	if (!/^[A-Z0-9]+$/.test(cleanSymbol)) {
		throw new PonsError('symbol_invalid', 'Ticker may only use letters and digits.');
	}
	const cleanLogo = cleanText(logo, LIMITS.logo, 'Logo URL');
	if (cleanLogo && !/^(https:\/\/|ipfs:\/\/|ar:\/\/)/i.test(cleanLogo)) {
		throw new PonsError('logo_invalid', 'Logo must be an https://, ipfs:// or ar:// URL.');
	}
	const cleanSocials = {};
	for (const key of SOCIAL_KEYS) {
		const v = cleanText(socials?.[key], LIMITS.social, `${key} link`);
		if (v && !/^https:\/\//i.test(v)) {
			throw new PonsError('social_invalid', `The ${key} link must be an https:// URL.`);
		}
		cleanSocials[key] = v;
	}
	const tax = Number(creatorTaxBps);
	if (!Number.isInteger(tax) || tax < 0) {
		throw new PonsError('tax_invalid', 'Creator tax must be a whole number of basis points.');
	}
	if (!/^0x[0-9a-fA-F]{64}$/.test(String(salt || ''))) {
		throw new PonsError('salt_invalid', 'Launch salt must be 32 bytes of hex.', 500);
	}
	return {
		name: cleanName,
		symbol: cleanSymbol,
		logo: cleanLogo,
		description: cleanText(description, LIMITS.description, 'Description'),
		socials: cleanSocials,
		creatorFeeRecipient: getAddress(creatorFeeRecipient),
		creatorTaxBps: tax,
		buybackEnabled: Boolean(buybackEnabled),
		expectedEconomics: expectedEconomics || `0x${'0'.repeat(64)}`,
		salt,
	};
}

/**
 * The launch transaction: target, calldata and value. With an opening buy it
 * goes through PonsV2LaunchAndBuy, whose `msg.value` is the flat launch fee
 * plus the buy, and the buy's recipient is the signer, so the creator's bag
 * lands in the wallet that will later sell it. Without one it goes straight
 * to the factory: the router reverts ZeroAmount() on a zero buy, and the
 * factory's own launchToken is the path real bare launches take.
 */
export function buildLaunchTx({ params, terms, quoteIn = 0n, recipient }) {
	if (params.creatorTaxBps > Number(terms.maxCreatorTaxBps)) {
		throw new PonsError(
			'tax_too_high',
			`Creator tax is capped at ${Number(terms.maxCreatorTaxBps) / 100}% on Pons.`,
		);
	}
	const buy = BigInt(quoteIn);
	if (buy <= 0n) {
		return {
			to: PONS_V2_FACTORY,
			data: encodeFunctionData({
				abi: PONS_ABI,
				functionName: 'launchToken',
				args: [params, terms.launchConfigId, terms.pairToken, []],
			}),
			value: BigInt(terms.launchFee),
			minTokensOut: 0n,
		};
	}
	const minTokensOut = quoteOpeningBuy({ quoteIn: buy, config: terms.config, creatorTaxBps: params.creatorTaxBps });
	const data = encodeFunctionData({
		abi: PONS_ABI,
		functionName: 'launchAndBuy',
		args: [
			params,
			terms.launchConfigId,
			terms.pairToken,
			buy,
			minTokensOut,
			getAddress(recipient),
			[],
		],
	});
	return {
		to: PONS_V2_LAUNCH_AND_BUY,
		data,
		value: BigInt(terms.launchFee) + buy,
		minTokensOut,
	};
}

/**
 * Read the token, curve and opening fill out of a launch receipt. The factory
 * emits TokenLaunched; the curve emits CurveBuy when there was an opening buy.
 */
export function parseLaunchReceipt(receipt) {
	const events = parseEventLogs({ abi: PONS_ABI, logs: receipt.logs || [] });
	const launched = events.find(
		(e) => e.eventName === 'TokenLaunched' && getAddress(e.address) === getAddress(PONS_V2_FACTORY),
	);
	if (!launched) return null;
	const curve = launched.args.curve;
	const buy = events.find(
		(e) => e.eventName === 'CurveBuy' && getAddress(e.address) === getAddress(curve),
	);
	return {
		token: getAddress(launched.args.token),
		curve: getAddress(curve),
		deployer: getAddress(launched.args.deployer),
		pairToken: launched.args.pairToken,
		launchConfigId: launched.args.launchConfigId,
		graduationThreshold: launched.args.graduationThreshold,
		openingBuy: buy
			? { quoteIn: buy.args.quoteIn, tokensOut: buy.args.tokensOut, fee: buy.args.fee, tax: buy.args.tax }
			: null,
	};
}

/**
 * Live bonding-curve progress for a launched coin: real ETH raised against the
 * graduation threshold, and whether it has already moved to its V4 pool.
 */
export async function curveProgress(curve) {
	const client = publicClient(false);
	const read = (functionName) =>
		client.readContract({ address: curve, abi: PONS_CURVE_ABI, functionName });
	const [raised, threshold, graduated] = await Promise.all([
		read('realQuoteReserve'),
		read('graduationThreshold'),
		read('graduated'),
	]);
	const pct = threshold > 0n ? Number((raised * 10_000n) / threshold) / 100 : 0;
	return { raisedWei: raised, thresholdWei: threshold, graduated, progressPct: graduated ? 100 : Math.min(100, pct) };
}

export function ponsCoinUrl(token) {
	return `https://ponsfamily.com/launchpad/${getAddress(token)}`;
}

export function explorerTxUrl(hash) {
	return `https://robinhoodchain.blockscout.com/tx/${hash}`;
}

// Pons launches roughly every two minutes, so an hour of 100ms blocks holds
// dozens of them while staying inside the public RPC's eth_getLogs range cap.
const RECENT_LAUNCH_BLOCKS = 36_000n;

/**
 * Spot price and graduation progress of a native-quoted curve from its
 * multicall results: price is quote reserve over token reserve (the curve's
 * marginal price, virtual reserve included), progress is real ETH raised over
 * the threshold. Null fields when a read failed or the coin has graduated,
 * since a graduated coin's price lives in its V4 pool, not here.
 */
export function curveState([reservesRes, raisedRes, graduatedRes] = [], threshold) {
	const graduated = graduatedRes?.status === 'success' ? Boolean(graduatedRes.result) : null;
	if (reservesRes?.status !== 'success' || graduated) {
		return { graduated, priceEth: null, progressPct: graduated ? 100 : null };
	}
	const [quote, tokens] = reservesRes.result;
	const priceEth = tokens > 0n ? Number(quote) / Number(tokens) : null;
	const raised = raisedRes?.status === 'success' ? raisedRes.result : null;
	const progressPct = raised != null && threshold > 0n
		? Math.min(100, Number((raised * 10_000n) / threshold) / 100)
		: null;
	return { graduated: graduated ?? false, priceEth, progressPct };
}

/**
 * Newest Pons V2 launches, read straight from the factory's TokenLaunched logs
 * over RPC (no indexer in the path), with each coin's name and symbol from one
 * multicall and its launch time from its block. Cached 30s.
 */
export async function recentPonsLaunches({ limit = 40 } = {}) {
	const rows = await cacheWrap('pons:v2:recent', 30, async () => {
		const client = publicClient(false);
		const head = await client.getBlockNumber();
		const logs = await client.getLogs({
			address: PONS_V2_FACTORY,
			event: PONS_ABI.find((x) => x.type === 'event' && x.name === 'TokenLaunched'),
			fromBlock: head > RECENT_LAUNCH_BLOCKS ? head - RECENT_LAUNCH_BLOCKS : 0n,
			toBlock: head,
		});
		const newest = logs.slice(-60).reverse();
		const blockNumbers = [...new Set(newest.map((l) => l.blockNumber))];
		const [meta, blocks, reserves] = await Promise.all([
			erc20Metadata(newest.map((l) => l.args.token)),
			Promise.all(blockNumbers.map((n) => client.getBlock({ blockNumber: n }).catch(() => null))),
			client
				.multicall({
					contracts: newest.flatMap((l) => [
						{ address: l.args.curve, abi: PONS_CURVE_ABI, functionName: 'getReserves' },
						{ address: l.args.curve, abi: PONS_CURVE_ABI, functionName: 'realQuoteReserve' },
						{ address: l.args.curve, abi: PONS_CURVE_ABI, functionName: 'graduated' },
						{ address: l.args.token, abi: ERC20_SUPPLY_ABI, functionName: 'totalSupply' },
					]),
					allowFailure: true,
				})
				.catch(() => []),
		]);
		const time = new Map(blockNumbers.map((n, i) => [n, blocks[i]?.timestamp ?? null]));
		return newest.map((l, i) => {
			const m = meta[l.args.token.toLowerCase()] || {};
			const ts = time.get(l.blockNumber);
			const curve = curveState(reserves.slice(i * 4, i * 4 + 3), l.args.graduationThreshold);
			// An ERC-20-quoted curve (Pons approves Stock Tokens as quotes) prices
			// in that token, so its reserve ratio is not an ETH price.
			if (l.args.pairToken !== NATIVE_PAIR) curve.priceEth = null;
			const supplyRes = reserves[i * 4 + 3];
			const decimals = m.decimals ?? 18;
			return {
				launchpad: 'Pons',
				type: 'bonding-curve',
				token: getAddress(l.args.token),
				curve: getAddress(l.args.curve),
				deployer: getAddress(l.args.deployer),
				quote: l.args.pairToken === NATIVE_PAIR ? 'ETH' : l.args.pairToken,
				graduationThreshold: l.args.graduationThreshold.toString(),
				block: Number(l.blockNumber),
				txHash: l.transactionHash,
				timestamp: ts != null ? new Date(Number(ts) * 1000).toISOString() : null,
				symbol: m.symbol || null,
				name: m.name || null,
				url: ponsCoinUrl(l.args.token),
				totalSupply: supplyRes?.status === 'success' ? Number(supplyRes.result) / 10 ** decimals : null,
				...curve,
			};
		});
	});
	return rows.slice(0, limit);
}

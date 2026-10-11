// Paired launchpad: coins on Robinhood Chain (4663) quoted in up to five assets.
//
// A paired coin has a fixed 1B supply split across one to five constant-product
// curves, one per quote asset (a tokenized stock, WETH, a stablecoin, a chain
// coin). Each curve starts from a virtual quote reserve, so launching costs only
// the flat ETH fee and the creator never needs to hold the assets it pairs
// against. Liquidity never migrates and nobody can withdraw it. The creator
// earns 70% of every swap fee, in each quote asset it trades in.
//
// The contract is the paired.exchange launchpad, vendored at
// contracts/paired-launchpad/ and proven byte-identical to the deployment below.
// It is the only source of truth: which coins exist, which assets they pair
// with, prices and reserves all come from it, so nothing here can show a coin
// or a market the chain does not have.
//
// Quote assets do not share decimals (stock tokens and WETH are 18, USDG is 6,
// cbBTC is 8), so every amount is formatted with the decimals of the asset it is
// denominated in, never an assumed 18.

import { formatUnits, parseAbiItem } from 'viem';
import { cacheWrap } from './cache.js';
import { BLOCKSCOUT_BASE, HOOD_MAINNET, erc20Metadata, publicClient } from './robinhood.js';

export const PAIRED_CHAIN_ID = HOOD_MAINNET.id;
export const DEFAULT_LAUNCHPAD = '0x6a546350f79DE0Fc83ADfCe99233183aA090fa15';
/** First block the launchpad emitted anything; log scans never start earlier. */
export const LAUNCHPAD_START_BLOCK = 48_325_951n;

export const TOTAL_SUPPLY = 1_000_000_000n * 10n ** 18n;
export const TOKEN_DECIMALS = 18;
export const BPS = 10_000;
export const MAX_MARKETS = 5;
export const NO_DEV_BUY = 255;
export const CREATOR_FEE_SHARE_BPS = 7_000;

/** The deployed launchpad, overridable for a fresh deployment. */
export function launchpadAddress() {
	const configured = String(process.env.PAIRED_LAUNCHPAD || '').trim();
	return /^0x[0-9a-fA-F]{40}$/.test(configured) ? configured : DEFAULT_LAUNCHPAD;
}

export const explorerAddress = (address) => `${BLOCKSCOUT_BASE}/address/${address}`;
export const explorerTx = (hash) => `${BLOCKSCOUT_BASE}/tx/${hash}`;

export const LAUNCHPAD_ERRORS = [
	'NotOwner', 'Reentrancy', 'Expired', 'BadFee', 'NoMarkets', 'TooManyMarkets', 'WeightsMustTotalBps',
	'DuplicateMarket', 'QuoteNotEnabled', 'UnknownMarket', 'ZeroAmount', 'SlippageExceeded', 'NothingToClaim',
	'BadDevBuy', 'NameOrSymbolEmpty', 'NotFeeRecipient', 'FeeTooHigh', 'TransferToTreasuryFailed',
];

const CURVE_TUPLE = {
	type: 'tuple',
	components: [
		{ name: 'virtualQuote', type: 'uint256' },
		{ name: 'virtualToken', type: 'uint256' },
		{ name: 'realQuote', type: 'uint256' },
		{ name: 'tokensLeft', type: 'uint256' },
		{ name: 'weightBps', type: 'uint16' },
		{ name: 'exists', type: 'bool' },
	],
};

const view = (name, inputs, outputs) => ({ name, type: 'function', stateMutability: 'view', inputs, outputs });
const addr = { type: 'address' };
const u256 = { type: 'uint256' };

export const launchpadAbi = [
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
				{ name: 'metadataURI', type: 'string' },
				{ name: 'metadataHash', type: 'bytes32' },
				{
					name: 'allocations',
					type: 'tuple[]',
					components: [{ name: 'quoteToken', type: 'address' }, { name: 'weightBps', type: 'uint16' }],
				},
				{ name: 'creatorFeeRecipient', type: 'address' },
				{ name: 'devBuyMarket', type: 'uint8' },
				{ name: 'devBuyQuoteIn', type: 'uint256' },
				{ name: 'devBuyMinTokensOut', type: 'uint256' },
				{ name: 'deadline', type: 'uint256' },
			],
		}],
		outputs: [{ name: 'token', type: 'address' }],
	},
	{
		name: 'buy',
		type: 'function',
		stateMutability: 'nonpayable',
		inputs: [{ name: 'token', ...addr }, { name: 'quoteToken', ...addr }, { name: 'quoteIn', ...u256 }, { name: 'minTokensOut', ...u256 }],
		outputs: [{ name: 'tokensOut', ...u256 }],
	},
	{
		name: 'sell',
		type: 'function',
		stateMutability: 'nonpayable',
		inputs: [{ name: 'token', ...addr }, { name: 'quoteToken', ...addr }, { name: 'tokensIn', ...u256 }, { name: 'minQuoteOut', ...u256 }],
		outputs: [{ name: 'quoteOut', ...u256 }],
	},
	{ name: 'claimFees', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'assets', type: 'address[]' }], outputs: [u256] },
	{ name: 'setFeeRecipient', type: 'function', stateMutability: 'nonpayable', inputs: [addr, addr], outputs: [] },
	{
		name: 'setQuoteConfig',
		type: 'function',
		stateMutability: 'nonpayable',
		inputs: [{ name: 'quoteToken', ...addr }, { name: 'virtualQuote', type: 'uint128' }, { name: 'enabled', type: 'bool' }],
		outputs: [],
	},
	view('owner', [], [addr]),
	view('treasury', [], [addr]),
	view('launchFeeWei', [], [u256]),
	view('swapFeeBps', [], [{ type: 'uint16' }]),
	view('tokenCount', [], [u256]),
	view('tokenAt', [u256], [addr]),
	view('quoteTokens', [], [{ type: 'address[]' }]),
	view('quoteConfig', [addr], [{ name: 'virtualQuote', type: 'uint128' }, { name: 'enabled', type: 'bool' }]),
	view('marketsOf', [addr], [{ type: 'address[]' }]),
	view('curveOf', [addr, addr], [CURVE_TUPLE]),
	view('creatorOf', [addr], [addr]),
	view('feeRecipientOf', [addr], [addr]),
	view('claimable', [addr, addr], [u256]),
	view('priceOf', [addr, addr], [u256]),
	view('quoteBuy', [addr, addr, u256], [{ name: 'tokensOut', ...u256 }, { name: 'fee', ...u256 }]),
	view('quoteSell', [addr, addr, u256], [{ name: 'quoteOut', ...u256 }, { name: 'fee', ...u256 }]),
	...LAUNCHPAD_ERRORS.map((name) => ({ name, type: 'error', inputs: [] })),
];

export const erc20Abi = [
	view('name', [], [{ type: 'string' }]),
	view('symbol', [], [{ type: 'string' }]),
	view('decimals', [], [{ type: 'uint8' }]),
	view('totalSupply', [], [u256]),
	view('balanceOf', [addr], [u256]),
	view('allowance', [addr, addr], [u256]),
	view('metadataURI', [], [{ type: 'string' }]),
	view('metadataHash', [], [{ type: 'bytes32' }]),
	{ name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [addr, u256], outputs: [{ type: 'bool' }] },
];

export const launchedEvent = parseAbiItem(
	'event Launched(address indexed token, address indexed creator, string name, string symbol, string metadataURI, (address quoteToken, uint16 weightBps)[] allocations)',
);
export const swapEvent = parseAbiItem(
	'event Swap(address indexed token, address indexed quoteToken, address indexed trader, bool isBuy, uint256 quoteAmount, uint256 tokenAmount, uint256 feeAmount)',
);

const read = (functionName, args = []) =>
	publicClient(false).readContract({ address: launchpadAddress(), abi: launchpadAbi, functionName, args });

/** Launch fee, swap fee and ownership as the contract has them right now. */
export async function launchpadConfig() {
	return cacheWrap(`paired:config:${launchpadAddress()}`, 60, async () => {
		const [launchFeeWei, swapFeeBps, owner, treasury, tokenCount] = await Promise.all([
			read('launchFeeWei'), read('swapFeeBps'), read('owner'), read('treasury'), read('tokenCount'),
		]);
		return {
			chainId: PAIRED_CHAIN_ID,
			launchpad: launchpadAddress(),
			launchFeeWei: launchFeeWei.toString(),
			launchFeeEth: formatUnits(launchFeeWei, 18),
			swapFeeBps: Number(swapFeeBps),
			creatorShareBps: CREATOR_FEE_SHARE_BPS,
			maxMarkets: MAX_MARKETS,
			totalSupply: formatUnits(TOTAL_SUPPLY, TOKEN_DECIMALS),
			owner,
			treasury,
			tokenCount: Number(tokenCount),
			explorer: explorerAddress(launchpadAddress()),
		};
	});
}

/**
 * Every quote asset the launchpad has ever registered, with its on-chain
 * config and ERC-20 metadata, in one multicall per field. Disabled quotes are
 * included (with `enabled: false`) so an existing coin's disabled pool still
 * renders with the right symbol and decimals.
 */
export async function quoteRegistry() {
	return cacheWrap(`paired:quotes:${launchpadAddress()}`, 300, async () => {
		const quotes = await read('quoteTokens');
		if (!quotes.length) return [];
		const client = publicClient(false);
		const configs = await client.multicall({
			contracts: quotes.map((q) => ({ address: launchpadAddress(), abi: launchpadAbi, functionName: 'quoteConfig', args: [q] })),
			allowFailure: true,
		});
		const meta = await erc20Metadata(quotes);
		return quotes.map((address, i) => {
			const cfg = configs[i]?.status === 'success' ? configs[i].result : [0n, false];
			const m = meta[address.toLowerCase()] || {};
			const decimals = m.decimals ?? 18;
			return {
				address,
				symbol: m.symbol || '?',
				name: m.name || m.symbol || address,
				decimals,
				enabled: Boolean(cfg[1]),
				virtualQuote: formatUnits(cfg[0], decimals),
				virtualQuoteRaw: cfg[0].toString(),
			};
		});
	});
}

/** Token address → registry row, for formatting amounts in the right decimals. */
export async function quoteIndex() {
	const rows = await quoteRegistry();
	return new Map(rows.map((r) => [r.address.toLowerCase(), r]));
}

/** Quote units per whole coin at the curve's current point. */
export function curvePrice(virtualQuote, virtualToken, quoteDecimals) {
	const vt = Number(formatUnits(BigInt(virtualToken), TOKEN_DECIMALS));
	return vt > 0 ? Number(formatUnits(BigInt(virtualQuote), quoteDecimals)) / vt : 0;
}

/**
 * A launched coin with every pool it trades in. Prices are quote units per
 * whole coin; `raised` is the real quote a pool holds, the only number here
 * that is a claim on something rather than a quote.
 */
export async function loadCoin(token) {
	const client = publicClient(false);
	const lp = launchpadAddress();
	const [name, symbol, metadataURI, creator, feeRecipient, markets] = await Promise.all([
		client.readContract({ address: token, abi: erc20Abi, functionName: 'name' }),
		client.readContract({ address: token, abi: erc20Abi, functionName: 'symbol' }),
		client.readContract({ address: token, abi: erc20Abi, functionName: 'metadataURI' }).catch(() => ''),
		read('creatorOf', [token]),
		read('feeRecipientOf', [token]),
		read('marketsOf', [token]),
	]);
	if (!markets.length) return null;

	const quotes = await quoteIndex();
	const curves = await client.multicall({
		contracts: markets.map((q) => ({ address: lp, abi: launchpadAbi, functionName: 'curveOf', args: [token, q] })),
		allowFailure: false,
	});

	const pairs = markets.map((quoteToken, i) => {
		const curve = curves[i];
		const q = quotes.get(quoteToken.toLowerCase()) || { symbol: '?', decimals: 18 };
		const allocation = (TOTAL_SUPPLY * BigInt(curve.weightBps)) / BigInt(BPS);
		const sold = allocation > curve.tokensLeft ? allocation - curve.tokensLeft : 0n;
		// Price from the reserves rather than priceOf(), which rounds to whole
		// quote base units: on a 6-decimal stablecoin that truncates a young
		// coin's price to one or two significant digits.
		const price = curvePrice(curve.virtualQuote, curve.virtualToken, q.decimals);
		return {
			quoteToken,
			quoteSymbol: q.symbol,
			quoteDecimals: q.decimals,
			weightBps: Number(curve.weightBps),
			price,
			// Market cap in the quote asset: the whole supply at this pool's price.
			marketCap: price * 1e9,
			raised: formatUnits(curve.realQuote, q.decimals),
			tokensLeft: formatUnits(curve.tokensLeft, TOKEN_DECIMALS),
			soldPct: allocation === 0n ? 0 : Number((sold * 10_000n) / allocation) / 100,
			virtualQuote: curve.virtualQuote.toString(),
			virtualToken: curve.virtualToken.toString(),
		};
	});

	return {
		address: token,
		chainId: PAIRED_CHAIN_ID,
		name,
		symbol,
		metadataURI,
		creator,
		feeRecipient,
		pairs,
		explorer: explorerAddress(token),
	};
}

export const coinCached = (token) => cacheWrap(`paired:coin:${String(token).toLowerCase()}`, 10, () => loadCoin(token));

/** Coins newest first; the contract appends, so the tail is the front page. */
export async function listCoins({ limit = 24, offset = 0 } = {}) {
	const count = Number(await read('tokenCount'));
	const indices = [];
	for (let i = count - 1 - offset; i >= 0 && indices.length < limit; i--) indices.push(BigInt(i));
	const client = publicClient(false);
	const addresses = indices.length
		? await client.multicall({
			contracts: indices.map((i) => ({ address: launchpadAddress(), abi: launchpadAbi, functionName: 'tokenAt', args: [i] })),
			allowFailure: false,
		})
		: [];
	const coins = await Promise.all(addresses.map((a) => coinCached(a).catch(() => null)));
	return { items: coins.filter(Boolean), total: count };
}

/** Fees a wallet can claim right now, per quote asset it has earned in. */
export async function claimableFees(wallet) {
	const quotes = await quoteRegistry();
	if (!quotes.length) return [];
	const amounts = await publicClient(false).multicall({
		contracts: quotes.map((q) => ({ address: launchpadAddress(), abi: launchpadAbi, functionName: 'claimable', args: [wallet, q.address] })),
		allowFailure: true,
	});
	return quotes
		.map((q, i) => ({ quoteToken: q.address, symbol: q.symbol, decimals: q.decimals, raw: amounts[i]?.status === 'success' ? amounts[i].result : 0n }))
		.filter((r) => r.raw > 0n)
		.map((r) => ({ quoteToken: r.quoteToken, symbol: r.symbol, amount: formatUnits(r.raw, r.decimals), raw: r.raw.toString() }));
}

/**
 * Read-only AMM swap quote using @pump-fun/pump-swap-sdk.
 * No signing, no transaction sending.
 */

import { SOLANA_RPC } from '../erc8004/solana-deploy.js';

const WSOL = 'So11111111111111111111111111111111111111112';
const QUOTE_TTL_MS = 10_000;

// Module cache — loaded once, reused across calls.
let _mods = null;

async function loadMods() {
	if (!_mods) {
		const [amm, web3, BNMod] = await Promise.all([
			import('@pump-fun/pump-swap-sdk'),
			import('@solana/web3.js'),
			import('bn.js'),
		]);
		_mods = { amm, web3, BN: BNMod.default || BNMod };
	}
	return _mods;
}

/**
 * Get a read-only price quote for a pump AMM swap.
 *
 * @param {object}        opts
 * @param {string}        opts.inputMint       Base58 mint address. One side must be wSOL.
 * @param {string}        opts.outputMint      Base58 mint address.
 * @param {number|string} opts.amountIn        Input amount in raw base units (lamports for SOL).
 * @param {number}        [opts.slippageBps=100]
 * @returns {Promise<{amountOut: string, priceImpactBps: number, route: string, expiresAtMs: number}>}
 */
export async function quoteSwap({ inputMint, outputMint, amountIn, slippageBps = 100 }) {
	const { amm, web3, BN } = await loadMods();
	const { canonicalPumpPoolPda, OnlinePumpAmmSdk, buyQuoteInput, sellBaseInput } = amm;
	const { Connection, PublicKey } = web3;

	let inputPk, outputPk;
	try {
		inputPk = new PublicKey(inputMint);
	} catch {
		throw new Error(`Invalid inputMint: ${inputMint}`);
	}
	try {
		outputPk = new PublicKey(outputMint);
	} catch {
		throw new Error(`Invalid outputMint: ${outputMint}`);
	}

	const amountBn = new BN(String(amountIn));

	// wSOL is always the quote token in canonical pump AMM pools.
	let baseMintPk, direction;
	if (inputMint === WSOL) {
		baseMintPk = outputPk;
		direction = 'quoteToBase';
	} else if (outputMint === WSOL) {
		baseMintPk = inputPk;
		direction = 'baseToQuote';
	} else {
		throw new Error(`One of inputMint or outputMint must be wSOL (${WSOL})`);
	}

	const connection = new Connection(SOLANA_RPC.mainnet, 'confirmed');
	const sdk = new OnlinePumpAmmSdk(connection);
	const poolKey = canonicalPumpPoolPda(baseMintPk);

	let state;
	try {
		// SystemProgram as dummy user — user ATAs will be null, which is fine for quoting.
		state = await sdk.swapSolanaState(poolKey, new PublicKey('11111111111111111111111111111111'));
	} catch (err) {
		throw new Error(`Pool unavailable for ${baseMintPk.toBase58()}: ${err.message}`);
	}

	const { globalConfig, feeConfig, pool, poolBaseAmount, poolQuoteAmount, baseMintAccount } = state;
	const slippage = slippageBps / 10_000;
	const shared = {
		slippage,
		baseReserve: poolBaseAmount,
		quoteReserve: poolQuoteAmount,
		globalConfig,
		baseMintAccount,
		baseMint: pool.baseMint,
		coinCreator: pool.coinCreator,
		creator: pool.creator,
		feeConfig,
	};

	let amountOut, priceImpactBps;

	if (direction === 'quoteToBase') {
		const result = buyQuoteInput({ quote: amountBn, ...shared });
		amountOut = result.base;
		// impact = (execPrice / spotPrice − 1) × 10000
		// execPrice = amountIn / amountOut;  spotPrice = quoteReserve / baseReserve
		const num = amountBn.mul(poolBaseAmount);
		const denom = amountOut.mul(poolQuoteAmount);
		priceImpactBps = denom.isZero()
			? 0
			: Math.max(0, num.muln(10_000).div(denom).subn(10_000).toNumber());
	} else {
		const result = sellBaseInput({ base: amountBn, ...shared });
		amountOut = result.uiQuote;
		// impact = (1 − execPrice / spotPrice) × 10000
		// spotPrice = quoteReserve / baseReserve;  execPrice = amountOut / amountIn
		const spot = poolQuoteAmount.mul(amountBn);
		const exec = amountOut.mul(poolBaseAmount);
		priceImpactBps = spot.isZero()
			? 0
			: Math.max(0, spot.sub(exec).muln(10_000).div(spot).toNumber());
	}

	return {
		amountOut: amountOut.toString(),
		priceImpactBps,
		route: poolKey.toBase58(),
		expiresAtMs: Date.now() + QUOTE_TTL_MS,
	};
}

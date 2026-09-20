// Meteora Dynamic Bonding Curve wrapper for the three.ws native launchpad.
//
// Lazy-loads the DBC SDK (same pattern as api/_lib/pump.js lazy-loads the
// pump SDKs) and reuses the pump facade's connection + unsigned-tx plumbing
// so both lanes share RPC selection, rotation, and priority-fee behavior.

import { getConnection, buildUnsignedTxBase64, solanaPubkey, txProgramIds } from '../pump.js';
import { curveBuildParams, configKeyFor, quoteMintFor, NATIVE_LANE } from './config.js';

let _sdk = null;
async function sdk() {
	if (!_sdk) _sdk = await import('@meteora-ag/dynamic-bonding-curve-sdk');
	return _sdk;
}

export const DBC_PROGRAM_ID = 'dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN';

const clients = new Map(); // network -> DynamicBondingCurveClient

export async function getDbcClient({ network = 'mainnet' } = {}) {
	if (!clients.has(network)) {
		const { DynamicBondingCurveClient } = await sdk();
		clients.set(network, new DynamicBondingCurveClient(getConnection({ network }), 'confirmed'));
	}
	return clients.get(network);
}

// The full ConfigParameters for the three.ws curve, built through the SDK so
// the numbers in config.js are always run through Meteora's own validators.
export async function buildThreeWsCurveConfig() {
	const { buildCurveWithMarketCap } = await sdk();
	return buildCurveWithMarketCap(curveBuildParams());
}

export function requireConfigKey(network) {
	const key = configKeyFor(network);
	if (!key) {
		throw Object.assign(
			new Error(
				`native launchpad config not deployed on ${network} — run scripts/native-launchpad-create-config.mjs and set ${
					network === 'devnet' ? 'NATIVE_LAUNCH_CONFIG_KEY_DEVNET' : 'NATIVE_LAUNCH_CONFIG_KEY'
				}`,
			),
			{ status: 503, code: 'lane_not_configured' },
		);
	}
	return key;
}

// The mint this lane is quoted in on `network`, as a PublicKey. A lane with no quote
// mint (devnet before the stand-in is created) is unconfigured, same as no config key.
function requireQuoteMint(network) {
	const mint = solanaPubkey(quoteMintFor(network));
	if (!mint) {
		throw Object.assign(
			new Error(`native launchpad quote mint not set on ${network}: set NATIVE_LAUNCH_QUOTE_MINT_DEVNET`),
			{ status: 503, code: 'lane_not_configured' },
		);
	}
	return mint;
}

// The DBC program takes the quote mint's token program as an ordinary account, so a
// Token-2022 quote like $THREE is supported on-chain. The SDK (1.5.x) nevertheless
// hardcodes the legacy SPL Token program into `token_quote_program` when it builds a
// pool-initialize instruction, and the instruction then dies with IncorrectProgramId
// the moment the program tries to create the quote vault. Swaps are unaffected (the
// SDK reads the token program from the config for those). Until the SDK is fixed
// upstream, rewrite that one account, located by its position in the program's own
// IDL so a base mint that legitimately uses the legacy program is never touched.
const POOL_INIT_INSTRUCTIONS = ['initialize_virtual_pool_with_spl_token', 'initialize_virtual_pool_with_token2022'];

export async function withQuoteTokenProgram(instructions, quoteTokenProgramId) {
	const { DynamicBondingCurveIdl: idl } = await sdk();
	const byDiscriminator = new Map();
	for (const name of POOL_INIT_INSTRUCTIONS) {
		const ix = idl.instructions.find((i) => i.name === name);
		const index = ix.accounts.findIndex((a) => a.name === 'token_quote_program');
		byDiscriminator.set(Buffer.from(ix.discriminator).toString('hex'), index);
	}
	for (const ix of instructions) {
		if (ix.programId.toBase58() !== DBC_PROGRAM_ID) continue;
		const index = byDiscriminator.get(Buffer.from(ix.data.subarray(0, 8)).toString('hex'));
		if (index === undefined) continue;
		ix.keys[index] = { ...ix.keys[index], pubkey: quoteTokenProgramId };
	}
	return instructions;
}

// The token program that owns the quote mint on `network`, read from the chain.
async function quoteTokenProgramFor(network, quoteMint) {
	const info = await getConnection({ network }).getAccountInfo(quoteMint);
	if (!info) {
		throw Object.assign(new Error(`quote mint ${quoteMint.toBase58()} not found on ${network}`), {
			status: 503,
			code: 'lane_not_configured',
		});
	}
	return info.owner;
}

const QUOTE_UNIT = 10 ** NATIVE_LANE.quoteDecimals;
const BASE_UNIT = 10 ** NATIVE_LANE.decimals;
const toAtomics = (amount, unit) => Math.round(amount * unit);
const fromAtomics = (v, unit) => Number((v ?? 0).toString()) / unit;

// Unsigned create-pool (+ optional first buy) transaction, base64. The base
// mint keypair and the payer wallet both sign client-side. The server never
// holds user keys, matching the pump lane's prep/confirm custody model.
export async function buildCreatePoolTx({
	network = 'mainnet',
	payer, // pays gas + funds the first buy
	creator, // on-chain pool creator (fee recipient)
	baseMint,
	name,
	symbol,
	uri,
	threeBuyIn = 0, // creator's optional first buy, in $THREE
} = {}) {
	const configKey = requireConfigKey(network);
	const quoteMint = requireQuoteMint(network);
	const client = await getDbcClient({ network });
	const { deriveDbcPoolAddress } = await sdk();
	const BN = (await import('bn.js')).default;

	const payerPk = solanaPubkey(payer);
	const creatorPk = solanaPubkey(creator);
	const mintPk = solanaPubkey(baseMint);
	const configPk = solanaPubkey(configKey);
	if (!payerPk || !creatorPk || !mintPk) {
		throw Object.assign(new Error('invalid pubkey'), { status: 400, code: 'validation_error' });
	}

	const tx = await client.creator.createPoolWithFirstBuy({
		createPoolParam: {
			name,
			symbol,
			uri,
			payer: payerPk,
			poolCreator: creatorPk,
			config: configPk,
			baseMint: mintPk,
		},
		firstBuyParam:
			threeBuyIn > 0
				? {
						buyer: payerPk,
						buyAmount: new BN(toAtomics(threeBuyIn, QUOTE_UNIT)),
						minimumAmountOut: new BN(1),
						referralTokenAccount: null,
					}
				: undefined,
	});

	const pool = deriveDbcPoolAddress(quoteMint, mintPk, configPk);
	const instructions = await withQuoteTokenProgram(tx.instructions, await quoteTokenProgramFor(network, quoteMint));

	const txBase64 = await buildUnsignedTxBase64({
		network,
		payer: payerPk,
		instructions,
	});
	return { txBase64, pool: pool.toBase58(), configKey };
}

// True when a parsed/landed transaction invoked the DBC program: the confirm
// step uses this to refuse signatures that aren't native-lane launches.
export function txInvokesDbcProgram(tx) {
	return txProgramIds(tx).has(DBC_PROGRAM_ID);
}

export async function derivePool({ network = 'mainnet', mint } = {}) {
	const { deriveDbcPoolAddress } = await sdk();
	const configKey = requireConfigKey(network);
	return deriveDbcPoolAddress(requireQuoteMint(network), solanaPubkey(mint), solanaPubkey(configKey));
}

async function fetchPool({ network, mint }) {
	const client = await getDbcClient({ network });
	const pool = await derivePool({ network, mint });

	// The SDK has returned both a bare account and a { poolState } wrapper across
	// versions; normalise so callers can rely on one shape.
	const raw = await client.state.getPool(pool);
	const account = raw?.poolState ?? raw;
	if (!account?.config) {
		throw Object.assign(new Error('no native pool for mint'), {
			status: 404,
			code: 'pool_not_found',
		});
	}
	const wrapped = raw?.poolState ? raw : { poolState: account };
	return { client, pool, account, wrapped };
}

export async function getPoolState({ network = 'mainnet', mint } = {}) {
	const { client, pool, account } = await fetchPool({ network, mint });
	const [progress, threshold] = await Promise.all([
		client.state.getPoolQuoteTokenCurveProgress(pool),
		client.state.getPoolMigrationQuoteThreshold(pool),
	]);
	return {
		pool: pool.toBase58(),
		config: account.config.toBase58(),
		creator: account.creator.toBase58(),
		migrated: Number(account.isMigrated ?? 0) === 1,
		curve_progress: progress, // 0..1
		quote_mint: quoteMintFor(network),
		migration_quote_threshold_three: fromAtomics(threshold, QUOTE_UNIT),
		quote_reserve_three: fromAtomics(account.quoteReserve, QUOTE_UNIT),
	};
}

// Live quote against the curve. side 'buy': `amountIn` $THREE -> tokens out.
// side 'sell': `amountIn` tokens -> $THREE out. Amounts are whole units, pre-slippage.
async function quoteSwap({ network, mint, side, amountIn, slippageBps }) {
	const BN = (await import('bn.js')).default;
	const { client, pool, account, wrapped } = await fetchPool({ network, mint });
	const config = await client.state.getPoolConfig(account.config);
	const slot = await getConnection({ network }).getSlot();
	const selling = side === 'sell';
	// client.pool.swapQuote takes a params object; the module-level swapQuote
	// export is positional. Use the client so an argument-order change in the
	// SDK can't silently mis-price a quote.
	const quote = client.pool.swapQuote({
		virtualPool: wrapped,
		config,
		swapBaseForQuote: selling,
		amountIn: new BN(toAtomics(amountIn, selling ? BASE_UNIT : QUOTE_UNIT)),
		slippageBps,
		hasReferral: false,
		eligibleForFirstSwapWithMinFee: false,
		currentPoint: new BN(slot),
	});
	return { pool, quote, selling };
}

export async function quoteBuy({ network = 'mainnet', mint, threeIn, slippageBps = 100 } = {}) {
	const { pool, quote } = await quoteSwap({ network, mint, side: 'buy', amountIn: threeIn, slippageBps });
	return {
		pool: pool.toBase58(),
		side: 'buy',
		three_in: threeIn,
		slippage_bps: slippageBps,
		tokens_out: fromAtomics(quote.outputAmount, BASE_UNIT),
		min_tokens_out: fromAtomics(quote.minimumAmountOut ?? quote.outputAmount, BASE_UNIT),
		trading_fee_three: fromAtomics(quote.tradingFee, QUOTE_UNIT),
		protocol_fee_three: fromAtomics(quote.protocolFee, QUOTE_UNIT),
	};
}

export async function quoteSell({ network = 'mainnet', mint, tokensIn, slippageBps = 100 } = {}) {
	const { pool, quote } = await quoteSwap({ network, mint, side: 'sell', amountIn: tokensIn, slippageBps });
	return {
		pool: pool.toBase58(),
		side: 'sell',
		tokens_in: tokensIn,
		slippage_bps: slippageBps,
		three_out: fromAtomics(quote.outputAmount, QUOTE_UNIT),
		min_three_out: fromAtomics(quote.minimumAmountOut ?? quote.outputAmount, QUOTE_UNIT),
		trading_fee_three: fromAtomics(quote.tradingFee, QUOTE_UNIT),
		protocol_fee_three: fromAtomics(quote.protocolFee, QUOTE_UNIT),
	};
}

// Unsigned buy or sell on a live curve, for the trader's own wallet to sign. The
// quote is taken in the same call, so the slippage floor in the transaction is the
// one the trader was just shown.
export async function buildSwapTx({ network = 'mainnet', mint, trader, side, amountIn, slippageBps = 100 } = {}) {
	const BN = (await import('bn.js')).default;
	const traderPk = solanaPubkey(trader);
	if (!traderPk) throw Object.assign(new Error('invalid trader pubkey'), { status: 400, code: 'validation_error' });

	const { pool, quote, selling } = await quoteSwap({ network, mint, side, amountIn, slippageBps });
	const client = await getDbcClient({ network });
	const tx = await client.pool.swap({
		owner: traderPk,
		payer: traderPk,
		pool,
		amountIn: new BN(toAtomics(amountIn, selling ? BASE_UNIT : QUOTE_UNIT)),
		minimumAmountOut: quote.minimumAmountOut ?? quote.outputAmount,
		swapBaseForQuote: selling,
		referralTokenAccount: null,
	});
	const txBase64 = await buildUnsignedTxBase64({ network, payer: traderPk, instructions: tx.instructions });
	const outUnit = selling ? QUOTE_UNIT : BASE_UNIT;
	return {
		txBase64,
		pool: pool.toBase58(),
		side: selling ? 'sell' : 'buy',
		amount_in: amountIn,
		expected_out: fromAtomics(quote.outputAmount, outUnit),
		min_out: fromAtomics(quote.minimumAmountOut ?? quote.outputAmount, outUnit),
		slippage_bps: slippageBps,
	};
}

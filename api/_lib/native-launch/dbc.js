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
//
// $THREE is a Token-2022 mint, and the SDK refuses to quote a Token-2022-quoted
// curve without the parsed quote mint and the current epoch, which it needs to
// price any transfer fee the mint carries. They are passed for every quote; on a
// plain SPL quote mint the SDK ignores them.
//
// client.pool.swapQuote takes a params object; the module-level swapQuote export
// is positional. Use the client so an argument-order change in the SDK can't
// silently mis-price a quote.
export async function swapQuoteOnCurve({ client, connection, wrapped, config, quoteMint, selling, amountAtomics, slippageBps, hasReferral = false }) {
	const [{ default: BN }, { unpackMint }] = await Promise.all([import('bn.js'), import('@solana/spl-token')]);
	const [slot, { epoch }, mintInfo] = await Promise.all([
		connection.getSlot(),
		connection.getEpochInfo(),
		connection.getAccountInfo(quoteMint),
	]);
	if (!mintInfo) {
		throw Object.assign(new Error(`quote mint ${quoteMint.toBase58()} not found`), { status: 503, code: 'lane_not_configured' });
	}
	return client.pool.swapQuote({
		quoteMint: unpackMint(quoteMint, mintInfo, mintInfo.owner),
		currentEpoch: epoch,
		virtualPool: wrapped,
		config,
		swapBaseForQuote: selling,
		amountIn: new BN(amountAtomics),
		slippageBps,
		hasReferral,
		eligibleForFirstSwapWithMinFee: false,
		currentPoint: new BN(slot),
	});
}

async function quoteSwap({ network, mint, side, amountIn, slippageBps, hasReferral = false }) {
	const { client, pool, account, wrapped } = await fetchPool({ network, mint });
	const config = await client.state.getPoolConfig(account.config);
	const selling = side === 'sell';
	const quote = await swapQuoteOnCurve({
		client,
		connection: getConnection({ network }),
		wrapped,
		config,
		quoteMint: solanaPubkey(quoteMintFor(network)),
		selling,
		amountAtomics: toAtomics(amountIn, selling ? BASE_UNIT : QUOTE_UNIT),
		slippageBps,
		hasReferral,
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
//
// `referralTokenAccount` (optional) is the referrer's token account for the quote mint:
// the program pays it the referral share of the protocol fee, taken out of the
// protocol's cut so the trader's price is unchanged.
export async function buildSwapInstructions({ network = 'mainnet', mint, trader, side, amountIn, slippageBps = 100, referralTokenAccount = null } = {}) {
	const BN = (await import('bn.js')).default;
	const traderPk = solanaPubkey(trader);
	if (!traderPk) throw Object.assign(new Error('invalid trader pubkey'), { status: 400, code: 'validation_error' });
	const referralPk = referralTokenAccount ? solanaPubkey(referralTokenAccount) : null;
	if (referralTokenAccount && !referralPk) {
		throw Object.assign(new Error('invalid referral token account'), { status: 400, code: 'validation_error' });
	}

	const { pool, quote, selling } = await quoteSwap({ network, mint, side, amountIn, slippageBps, hasReferral: Boolean(referralPk) });
	const client = await getDbcClient({ network });
	const tx = await client.pool.swap({
		owner: traderPk,
		payer: traderPk,
		pool,
		amountIn: new BN(toAtomics(amountIn, selling ? BASE_UNIT : QUOTE_UNIT)),
		minimumAmountOut: quote.minimumAmountOut ?? quote.outputAmount,
		swapBaseForQuote: selling,
		referralTokenAccount: referralPk,
	});
	const outUnit = selling ? QUOTE_UNIT : BASE_UNIT;
	return {
		traderPk,
		instructions: tx.instructions,
		summary: {
			pool: pool.toBase58(),
			side: selling ? 'sell' : 'buy',
			amount_in: amountIn,
			expected_out: fromAtomics(quote.outputAmount, outUnit),
			min_out: fromAtomics(quote.minimumAmountOut ?? quote.outputAmount, outUnit),
			slippage_bps: slippageBps,
			referral: Boolean(referralPk),
		},
	};
}

export async function buildSwapTx(args = {}) {
	const { traderPk, instructions, summary } = await buildSwapInstructions(args);
	const txBase64 = await buildUnsignedTxBase64({ network: args.network ?? 'mainnet', payer: traderPk, instructions });
	return { txBase64, ...summary };
}

const tradeCache = new Map(); // `${network}:${mint}:${limit}:${before}` -> { at, value }
const TRADE_CACHE_MS = 6000;

// Recent swaps on a native pool, read from chain. Each trade is the change in the
// pool's own base and quote vaults in that transaction, so it is exact for any route
// into the pool (a plain $THREE buy, a sell, or a Jupiter SOL buy that ends in a curve
// buy). `three` is what the curve vault received or paid, net of the protocol fee.
// Pages by signature: pass the last signature back as `before`.
export async function getRecentTrades({ network = 'mainnet', mint, limit = 20, before = null } = {}) {
	const key = `${network}:${mint}:${limit}:${before ?? ''}`;
	const hit = tradeCache.get(key);
	if (hit && Date.now() - hit.at < TRADE_CACHE_MS) return hit.value;

	const { account, pool } = await fetchPool({ network, mint });
	const baseVault = account.baseVault.toBase58();
	const quoteVault = account.quoteVault.toBase58();
	const connection = getConnection({ network });
	const sigs = await connection.getSignaturesForAddress(pool, { limit, ...(before ? { before } : {}) }, 'confirmed');
	const ok = sigs.filter((s) => !s.err);
	const txs = ok.length
		? await connection.getParsedTransactions(
				ok.map((s) => s.signature),
				{ maxSupportedTransactionVersion: 0, commitment: 'confirmed' },
			)
		: [];

	const trades = [];
	txs.forEach((tx, i) => {
		const trade = tradeFromTx(tx, baseVault, quoteVault);
		if (trade) trades.push({ signature: ok[i].signature, time: ok[i].blockTime ?? null, ...trade });
	});
	const value = {
		pool: pool.toBase58(),
		trades,
		next_before: sigs.length === limit ? sigs[sigs.length - 1].signature : null,
	};
	tradeCache.set(key, { at: Date.now(), value });
	if (tradeCache.size > 200) tradeCache.delete(tradeCache.keys().next().value);
	return value;
}

// Pure: one parsed transaction -> a trade, or null when it did not swap on this pool.
export function tradeFromTx(tx, baseVault, quoteVault) {
	if (!tx?.meta || tx.meta.err) return null;
	const keys = tx.transaction.message.accountKeys.map((k) => (typeof k === 'string' ? k : k.pubkey.toBase58 ? k.pubkey.toBase58() : String(k.pubkey)));
	const amt = (list, idx) => Number(list?.find((b) => b.accountIndex === idx)?.uiTokenAmount?.amount ?? 0);
	const deltaAt = (idx) => amt(tx.meta.postTokenBalances, idx) - amt(tx.meta.preTokenBalances, idx);
	const delta = (vault) => {
		const idx = keys.indexOf(vault);
		return idx < 0 ? 0 : deltaAt(idx);
	};
	const baseIdx = keys.indexOf(baseVault);
	const baseDelta = delta(baseVault);
	const quoteDelta = delta(quoteVault);
	if (baseDelta === 0 || quoteDelta === 0) return null;
	// The pool-creation transaction mints the curve supply into the base vault and
	// carries the creator's first buy, so the vault has no pre-balance and its net
	// change is the mint, not the trade. There, the tokens bought are what every
	// other holder of the base mint received in the same transaction.
	const vaultCreated = !tx.meta.preTokenBalances?.some((b) => b.accountIndex === baseIdx);
	const baseMint = tx.meta.postTokenBalances?.find((b) => b.accountIndex === baseIdx)?.mint;
	const received = vaultCreated && baseMint
		? (tx.meta.postTokenBalances ?? [])
				.filter((b) => b.mint === baseMint && b.accountIndex !== baseIdx)
				.reduce((sum, b) => sum + Math.max(0, deltaAt(b.accountIndex)), 0)
		: 0;
	const tokens = (received || Math.abs(baseDelta)) / BASE_UNIT;
	const three = Math.abs(quoteDelta) / QUOTE_UNIT;
	return {
		// $THREE is never minted into the quote vault, so its direction is the side:
		// $THREE arriving means someone bought.
		side: quoteDelta > 0 ? 'buy' : 'sell',
		trader: keys[0],
		tokens,
		three,
		price_three: three / tokens,
	};
}

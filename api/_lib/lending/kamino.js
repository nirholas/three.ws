// Lending venue adapter: the largest Solana lending market by TVL, integrated
// through its maintained TypeScript SDK (@kamino-finance/klend-sdk).
//
// This file is the only place that knows the venue. It implements the venue
// contract documented in api/_lib/lending/index.js:
//
//   listMarkets()                 every suppliable token in the main market
//   getReserve(mintOrReserve)     one normalized market row
//   getPosition(owner)            the owner's obligation: deposits, borrows,
//                                 health factor (null when nothing is open)
//   buildDeposit / buildWithdraw  web3.js instructions + lookup tables for the
//                                 platform's execution engine to sign and land
//
// The SDK is large (thousands of modules) and speaks @solana/kit, so it is
// imported lazily on first use and never on a cold start of an unrelated
// route. Every read goes through the failover RPC transport in ./rpc.js.
//
// Nothing here signs. Builders take the owner ADDRESS and return unsigned
// instructions; the engine simulates them, bounds what they may move, and
// only then decrypts the agent key.

import { PublicKey, TransactionInstruction } from '@solana/web3.js';
import { LendingError } from './errors.js';
import { lendingRpc } from './rpc.js';

export const VENUE_ID = 'kamino';
export const VENUE_NAME = 'Kamino Lend';
// The venue's primary lending market on Solana mainnet (the "Main" market).
export const MAIN_MARKET = '7u3HeHxYDLhnCoErrtycNokbQYbWGzLs6JSDqGAv5PfF';
export const PROGRAM_ID = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';
export const APP_URL = 'https://app.kamino.finance';

// A cached market is reused for reads for this long; a build refreshes it if
// older than BUILD_MAX_AGE_MS so instructions are made against fresh state.
const READ_MAX_AGE_MS = 30_000;
const BUILD_MAX_AGE_MS = 5_000;

let sdkPromise = null;
/** The venue SDK, loaded once per process on first use. */
export function loadSdk() {
	if (!sdkPromise) {
		sdkPromise = import('@kamino-finance/klend-sdk').catch((err) => {
			sdkPromise = null;
			throw err;
		});
	}
	return sdkPromise;
}

const marketCache = { market: null, loadedAt: 0, inflight: null };

async function freshMarket(maxAgeMs) {
	const now = Date.now();
	if (marketCache.market && now - marketCache.loadedAt <= maxAgeMs) return marketCache.market;
	if (marketCache.inflight) return marketCache.inflight;
	marketCache.inflight = (async () => {
		const sdk = await loadSdk();
		const { address } = await import('@solana/kit');
		const rpc = lendingRpc('mainnet');
		let market;
		try {
			if (marketCache.market) {
				await marketCache.market.reload();
				market = marketCache.market;
			} else {
				market = await sdk.KaminoMarket.load(rpc, address(MAIN_MARKET), sdk.DEFAULT_RECENT_SLOT_DURATION_MS);
			}
		} catch (err) {
			throw new LendingError('venue_unavailable', 'The lending market could not be read from Solana right now. Try again in a moment.', 503, { message: String(err?.message || err).slice(0, 200) });
		}
		if (!market) throw new LendingError('venue_unavailable', 'The lending market account was not found on chain.', 503);
		marketCache.market = market;
		marketCache.loadedAt = Date.now();
		return market;
	})().finally(() => {
		marketCache.inflight = null;
	});
	return marketCache.inflight;
}

async function ledgerInstant() {
	const sdk = await loadSdk();
	return sdk.getCurrentLedgerInstant(lendingRpc('mainnet'));
}

function dec(v) {
	if (v == null) return null;
	const n = typeof v === 'number' ? v : Number(v.toString());
	return Number.isFinite(n) ? n : null;
}

function finiteOr(v, fallback = 0) {
	return Number.isFinite(v) ? v : fallback;
}

/**
 * Turn one SDK reserve into the venue-agnostic market row every surface
 * renders. Exported so tests can run it over reserves decoded from recorded
 * mainnet account data.
 */
export function normalizeReserve(reserve, instant, referralFeeBps = 0) {
	const decimals = reserve.stats.decimals;
	const scale = 10 ** decimals;
	const price = dec(reserve.getOracleMarketPrice());
	const totalSupplyRaw = dec(reserve.getTotalSupply()) ?? 0;
	const borrowedRaw = dec(reserve.getBorrowedAmount()) ?? 0;
	const availableRaw = dec(reserve.getLiquidityAvailableAmount()) ?? 0;
	const depositLimitRaw = dec(reserve.stats.reserveDepositLimit) ?? 0;
	const borrowLimitRaw = dec(reserve.stats.reserveBorrowLimit) ?? 0;
	const totalSupply = totalSupplyRaw / scale;
	const supplyApy = finiteOr(reserve.totalSupplyAPY(instant));
	const borrowApy = finiteOr(reserve.totalBorrowAPY(instant));
	const utilization = finiteOr(reserve.calculateUtilizationRatio());
	const depositCapacity = depositLimitRaw > 0 ? Math.max(0, (depositLimitRaw - totalSupplyRaw) / scale) : null;
	return {
		reserve: String(reserve.address),
		mint: String(reserve.getLiquidityMint()),
		symbol: reserve.symbol,
		decimals,
		price_usd: price,
		supply_apy: supplyApy,
		borrow_apy: borrowApy,
		utilization,
		total_supply: totalSupply,
		total_supply_usd: price != null ? totalSupply * price : null,
		total_borrow: borrowedRaw / scale,
		available_liquidity: availableRaw / scale,
		available_liquidity_usd: price != null ? (availableRaw / scale) * price : null,
		deposit_limit: depositLimitRaw / scale,
		deposit_capacity_remaining: depositCapacity,
		borrow_limit: borrowLimitRaw / scale,
		risk: {
			loan_to_value: reserve.stats.loanToValue,
			liquidation_threshold: reserve.stats.liquidationThreshold,
			borrow_factor: reserve.stats.borrowFactor,
			min_liquidation_bonus: reserve.stats.minLiquidationBonus,
			max_liquidation_bonus: reserve.stats.maxLiquidationBonus,
			protocol_take_rate: reserve.stats.protocolTakeRate,
		},
		status: String(reserve.stats.status),
		deprecated: reserve.stats.isUIDeprecated === true,
		debt_term_seconds: Number(reserve.state?.config?.debtTermSeconds ?? 0),
		referral_fee_bps: referralFeeBps,
	};
}

async function canonicalRows() {
	const [market, instant] = await Promise.all([freshMarket(READ_MAX_AGE_MS), ledgerInstant()]);
	const { selectCanonicalReserves } = await import('./math.js');
	const referral = Number(market.state.referralFeeBps ?? 0);
	const rows = [];
	for (const r of market.reserves.values()) {
		try {
			rows.push(normalizeReserve(r, instant, referral));
		} catch {
			// A reserve whose oracle price is unavailable cannot be priced or
			// supplied safely; leave it out rather than show made-up numbers.
		}
	}
	const canonical = selectCanonicalReserves(
		rows.map((r) => ({ ...r, address: r.reserve, totalSupplyUsd: r.total_supply_usd ?? 0, debtTermSeconds: r.debt_term_seconds })),
	).map(({ address: _a, totalSupplyUsd: _t, debtTermSeconds: _d, ...row }) => row);
	return { market, instant, rows: canonical };
}

/** Every suppliable token in the main market, deepest first. */
export async function listMarkets() {
	const { instant, rows } = await canonicalRows();
	return {
		venue: VENUE_ID,
		venue_name: VENUE_NAME,
		market: MAIN_MARKET,
		slot: String(instant.slot),
		block_time: new Date(Number(instant.blockTime) * 1000).toISOString(),
		markets: rows,
	};
}

/** The canonical market row for a mint (or reserve address). Throws 404. */
export async function getReserve(mintOrReserve) {
	const { rows } = await canonicalRows();
	const key = String(mintOrReserve || '');
	const row = rows.find((r) => r.mint === key || r.reserve === key);
	if (!row) throw new LendingError('unsupported_token', 'That token has no active lending market here. List markets to see what can be supplied.', 404, { token: key });
	return row;
}

function positionRow(pos, market, kind) {
	const reserve = market.getReserveByAddress(pos.reserveAddress);
	const decimals = reserve?.stats?.decimals ?? 0;
	const amountRaw = BigInt(pos.amount.floor().toFixed(0));
	return {
		kind,
		reserve: String(pos.reserveAddress),
		mint: String(pos.mintAddress),
		symbol: reserve?.symbol || null,
		decimals,
		amount_raw: amountRaw.toString(),
		amount: Number(amountRaw) / 10 ** decimals,
		value_usd: dec(pos.marketValueRefreshed),
	};
}

/**
 * The owner's position in the main market, or null when the owner never
 * opened one. Amounts include interest accrued up to the market's last load.
 */
export async function getPosition(owner) {
	const market = await freshMarket(READ_MAX_AGE_MS);
	const sdk = await loadSdk();
	const { address } = await import('@solana/kit');
	let obligation;
	try {
		obligation = await market.getObligationByWallet(address(owner), new sdk.VanillaObligation(address(PROGRAM_ID)));
	} catch (err) {
		throw new LendingError('venue_unavailable', 'The lending position could not be read from Solana right now. Try again in a moment.', 503, { message: String(err?.message || err).slice(0, 200) });
	}
	if (!obligation) return null;
	const s = obligation.refreshedStats;
	const { healthFactor } = await import('./math.js');
	return {
		obligation: String(obligation.obligationAddress),
		deposits: obligation.getDeposits().map((p) => positionRow(p, market, 'deposit')),
		borrows: obligation.getBorrows().map((p) => positionRow(p, market, 'borrow')),
		stats: {
			deposited_usd: dec(s.userTotalDeposit),
			borrowed_usd: dec(s.userTotalBorrow),
			net_value_usd: dec(s.netAccountValue),
			borrow_limit_usd: dec(s.borrowLimit),
			liquidation_limit_usd: dec(s.borrowLiquidationLimit),
			loan_to_value: dec(s.loanToValue),
			liquidation_ltv: dec(s.liquidationLtv),
			health_factor: healthFactor({ unhealthyBorrowValue: dec(s.borrowLiquidationLimit), borrowedValueAdjusted: dec(s.userTotalBorrowBorrowFactorAdjusted) }),
		},
	};
}

// @solana/kit AccountRole: 0 readonly, 1 writable, 2 readonly signer, 3 writable signer.
function toLegacyInstruction(ix) {
	return new TransactionInstruction({
		programId: new PublicKey(String(ix.programAddress)),
		keys: (ix.accounts || []).map((a) => ({
			pubkey: new PublicKey(String(a.address)),
			isSigner: a.role >= 2,
			isWritable: (a.role & 1) === 1,
		})),
		data: Buffer.from(ix.data || []),
	});
}

async function scopeRefreshConfig() {
	const { Scope } = await import('@kamino-finance/scope-sdk');
	const scope = new Scope('mainnet-beta', lendingRpc('mainnet'));
	return { scope, scopeConfigurations: await scope.getAllConfigurations() };
}

async function buildAction(kind, { owner, reserve, amountRaw, refreshOracles = false }) {
	const [market, sdk, kit] = await Promise.all([freshMarket(BUILD_MAX_AGE_MS), loadSdk(), import('@solana/kit')]);
	const instant = await ledgerInstant();
	const ownerAddr = kit.address(owner);
	const reserveAddr = kit.address(reserve);
	const signer = kit.createNoopSigner(ownerAddr);
	const existing = await market.getObligationByWallet(ownerAddr, new sdk.VanillaObligation(kit.address(PROGRAM_ID))).catch(() => null);
	const BN = (await import('bn.js')).default;
	const props = {
		kaminoMarket: market,
		amount: new BN(BigInt(amountRaw).toString()),
		reserveAddress: reserveAddr,
		owner: signer,
		obligation: existing || new sdk.VanillaObligation(kit.address(PROGRAM_ID)),
		useV2Ixs: true,
		scopeRefreshConfig: refreshOracles ? await scopeRefreshConfig() : undefined,
		includeAtaIxs: true,
		requestElevationGroup: false,
		// A user metadata account is required once per wallet; its optional
		// per-user lookup table is not, and would cost extra rent and a second
		// transaction. The market's own tables cover the account set.
		initUserMetadata: { skipInitialization: false, skipLutCreation: true },
		currentLedgerInstant: instant,
	};
	let action;
	try {
		action = kind === 'deposit' ? await sdk.KaminoAction.buildDepositTxns(props) : await sdk.KaminoAction.buildWithdrawTxns(props);
	} catch (err) {
		throw new LendingError('build_failed', `The ${kind} transaction could not be built against the current market state.`, 422, { message: String(err?.message || err).slice(0, 240) });
	}
	const instructions = sdk.KaminoAction.actionToIxs(action).map(toLegacyInstruction);
	const labels = sdk.KaminoAction.actionToIxLabels(action);
	return {
		venue: VENUE_ID,
		instructions,
		labels,
		lookup_table_addresses: [...new Set((action.luts || []).map(String))],
		obligation: String(await action.getObligationPda()),
		first_deposit: !existing,
		refreshed_oracles: refreshOracles,
	};
}

/** Unsigned instructions that supply `amountRaw` of the reserve's token. */
export function buildDeposit({ owner, reserve, amountRaw, refreshOracles }) {
	return buildAction('deposit', { owner, reserve, amountRaw, refreshOracles });
}

/** Unsigned instructions that withdraw `amountRaw` (U64_MAX for everything). */
export function buildWithdraw({ owner, reserve, amountRaw, refreshOracles }) {
	return buildAction('withdraw', { owner, reserve, amountRaw, refreshOracles });
}

/** Drop the cached market so the next read reloads it (after a landed action). */
export function invalidateMarket() {
	marketCache.loadedAt = 0;
}

export const venue = {
	id: VENUE_ID,
	name: VENUE_NAME,
	chain: 'solana',
	network: 'mainnet',
	market: MAIN_MARKET,
	program: PROGRAM_ID,
	app_url: APP_URL,
	capabilities: { deposit: true, withdraw: true, borrow: false, repay: false },
	listMarkets,
	getReserve,
	getPosition,
	buildDeposit,
	buildWithdraw,
	invalidateMarket,
};

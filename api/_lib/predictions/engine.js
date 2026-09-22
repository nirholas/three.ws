// Prediction orders from the agent's custodial Solana wallet.
//
// One engine behind the REST routes (api/v1/agents/[id]/predictions/) and the
// MCP tools (api/_mcpagent/predictions-tools.js), so both are held to the same
// guards, ledger and confirmation rules:
//
//   preview  price the action against the live venue, run every guard, store
//            the result, return a preview_id (ten-minute life)
//   execute  requires confirm_trade === true and a fresh preview_id for the
//            same agent and action; re-runs the guards; builds the venue
//            transaction; SIMULATES it and refuses unless the wallet's USDC and
//            SOL move no more than the preview allowed; signs with the agent key;
//            submits; records the outcome in agent_custody_events
//
// The simulation bound is what makes signing a venue-built transaction safe:
// whatever the instructions are, the agent wallet cannot lose more USDC than
// the stake the owner confirmed, nor more SOL than network fees.

import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { sql } from '../db.js';
import { logAudit } from '../audit.js';
import { ensureAgentWallet, recoverSolanaAgentKeypair, getSolanaAddressBalances } from '../agent-wallet.js';
import { solanaConnection } from '../agent-pumpfun.js';
import {
	getPredictionLimits, checkPredictionStake, getPredictionStakeUsd, tradeGuardResponse,
	reserveSpendUsd, releaseSpendReservation, updateCustodyEvent, recordCustodyEvent,
	SpendLimitError, getSpendLimits,
} from '../agent-trade-guards.js';
import { getVenue, DEFAULT_VENUE, VenueError } from './index.js';
import { asksFor, bidsFor, estimateBuy, estimateSell } from './book.js';
import { createPreview, loadPreview, consumePreview, releasePreview, PreviewError } from './previews.js';

export const MIN_STAKE_USD = 1;
export const MAX_STAKE_USD = 100_000;
// SOL the wallet may spend on a prediction transaction: base fee, priority fee
// and at most one token-account rent. Anything past this is refused.
const MAX_LAMPORTS_OUT = 5_000_000;
const MIN_SOL_FOR_FEES = 0.002;
const USDC_DECIMALS = 6;
// A buy can cost at most its stake; the venue's own fee rides inside it. Allow
// one cent of rounding and nothing else.
const USDC_ROUNDING_ATOMIC = 10_000n;

export class PredictionError extends Error {
	constructor(code, message, status = 400, detail = null) {
		super(message);
		this.name = 'PredictionError';
		this.code = code;
		this.status = status;
		this.detail = detail;
	}
}

/** Map any engine failure to { status, code, message, detail } for a boundary. */
export function describeError(err) {
	if (err instanceof PredictionError || err instanceof PreviewError || err instanceof VenueError) {
		return { status: err.status, code: err.code, message: err.message, detail: err.detail || null };
	}
	if (err instanceof SpendLimitError) {
		return { status: err.status || 403, code: err.code, message: err.message, detail: err.detail || null };
	}
	return null;
}

// ── Agent + wallet ───────────────────────────────────────────────────────────

/** Load an agent the user owns. Throws PredictionError 404/403. */
export async function loadOwnedAgent(agentId, userId) {
	const [row] = await sql`
		SELECT id, user_id, name, meta FROM agent_identities
		WHERE id = ${agentId} AND deleted_at IS NULL
	`;
	if (!row) throw new PredictionError('not_found', 'No agent with that id.', 404);
	if (row.user_id !== userId) throw new PredictionError('forbidden', "That agent isn't on your account.", 403);
	return row;
}

async function walletFor(agent, userId, reason) {
	const { address } = await ensureAgentWallet(agent.id, userId, { reason });
	return address;
}

function usdcAtaFor(owner, venue) {
	return getAssociatedTokenAddressSync(new PublicKey(venue.settlement.mint), new PublicKey(owner), true);
}

// ── Validation ───────────────────────────────────────────────────────────────

function parseSide(v) {
	const s = String(v || '').toLowerCase();
	if (s !== 'yes' && s !== 'no') throw new PredictionError('invalid_side', 'side must be "yes" or "no".');
	return s;
}

function parseStake(v) {
	const n = Number(v);
	if (!Number.isFinite(n) || n < MIN_STAKE_USD || n > MAX_STAKE_USD) {
		throw new PredictionError('invalid_stake', `stake_usd must be between $${MIN_STAKE_USD} and $${MAX_STAKE_USD.toLocaleString('en-US')}.`);
	}
	return Math.round(n * 100) / 100;
}

function parsePrice(v, name) {
	const n = Number(v);
	if (!Number.isFinite(n) || n <= 0 || n >= 1) throw new PredictionError(`invalid_${name}`, `${name} must be a probability strictly between 0 and 1 (0.62 means 62 cents a contract).`);
	return Math.round(n * 100) / 100;
}

function sideOutcome(market, side) {
	return market.outcomes.find((o) => o.side === side) || null;
}

// ── Guards ───────────────────────────────────────────────────────────────────

async function marketExposureUsd(venue, owner, agentId, marketId) {
	let positions;
	try {
		positions = await venue.listPositions(owner);
	} catch {
		// Venue positions unreadable: fall back to every stake this platform
		// placed in the market over the last 30 days, which can only overcount.
		return getPredictionStakeUsd(agentId, { marketId, windowHours: 24 * 30 });
	}
	const filled = positions
		.filter((p) => p.market_id === marketId && p.status === 'open')
		.reduce((sum, p) => sum + (p.cost_usd || 0), 0);
	// A stake submitted in the last 30 minutes may not have filled into a
	// position yet; count it so two quick orders cannot pass the cap together.
	// A fast fill is briefly counted twice, which errs toward refusing.
	const inflight = await getPredictionStakeUsd(agentId, { marketId, windowHours: 0.5 });
	return filled + inflight;
}

/** Run the stake guards. Returns { ok, checks[] } or throws PredictionError with the guard message. */
async function stakeGuards({ agent, venue, owner, marketId, stakeUsd, throwOnBlock }) {
	const limits = getPredictionLimits(agent.meta);
	const spend = getSpendLimits(agent.meta);
	const [exposure, daily] = await Promise.all([
		marketExposureUsd(venue, owner, agent.id, marketId),
		getPredictionStakeUsd(agent.id, { windowHours: 24 }),
	]);
	const blocked = checkPredictionStake({ limits, stakeUsd, marketExposureUsd: exposure, dailyStakedUsd: daily });
	const checks = [
		{ id: 'enabled', ok: limits.enabled, label: limits.enabled ? 'Prediction orders are on for this agent' : 'Prediction orders are off for this agent' },
		{ id: 'market_cap', ok: exposure + stakeUsd <= limits.max_stake_per_market_usd + 1e-9, label: `At risk in this market after the order: $${(exposure + stakeUsd).toFixed(2)} of $${limits.max_stake_per_market_usd.toFixed(2)}` },
		{ id: 'daily_cap', ok: daily + stakeUsd <= limits.max_daily_stake_usd + 1e-9, label: `Staked in the last 24h after the order: $${(daily + stakeUsd).toFixed(2)} of $${limits.max_daily_stake_usd.toFixed(2)}` },
		{ id: 'wallet_frozen', ok: !spend.frozen, label: spend.frozen ? 'The wallet is frozen' : 'The wallet is not frozen' },
	];
	if (spend.per_tx_usd != null) {
		checks.push({ id: 'per_tx', ok: stakeUsd <= spend.per_tx_usd + 1e-9, label: `Wallet per-transaction limit: $${spend.per_tx_usd.toFixed(2)}` });
	}
	if (blocked && throwOnBlock) {
		const r = tradeGuardResponse(blocked);
		throw new PredictionError(r.code, r.message, r.status, r.detail);
	}
	return { limits, exposure_usd: exposure, staked_today_usd: daily, blocked: blocked ? tradeGuardResponse(blocked) : null, checks };
}

// ── Simulation bound ─────────────────────────────────────────────────────────

function decodeTokenAmount(account) {
	if (!account) return 0n;
	const data = Array.isArray(account.data) ? Buffer.from(account.data[0], 'base64') : null;
	if (!data || data.length < 72) return 0n;
	return data.readBigUInt64LE(64);
}

/**
 * Simulate the venue transaction against current chain state and verify the
 * owner's USDC and SOL move within bounds. Throws PredictionError otherwise.
 */
export async function simulateWithinBounds({ conn, vtx, owner, usdcAta, maxUsdcOutAtomic }) {
	const ownerKey = owner.toBase58();
	const ataKey = usdcAta.toBase58();
	const [preLamports, preUsdc] = await Promise.all([
		conn.getBalance(owner, 'confirmed'),
		conn.getTokenAccountBalance(usdcAta, 'confirmed').then((b) => BigInt(b?.value?.amount || '0')).catch(() => 0n),
	]);
	let sim;
	try {
		sim = await conn.simulateTransaction(vtx, {
			sigVerify: false,
			replaceRecentBlockhash: true,
			commitment: 'confirmed',
			accounts: { encoding: 'base64', addresses: [ownerKey, ataKey] },
		});
	} catch (err) {
		throw new PredictionError('simulation_unavailable', 'Could not simulate the order before signing, so nothing was sent. Try again.', 503, { message: err?.message?.slice(0, 200) || null });
	}
	const v = sim?.value;
	if (v?.err) {
		throw new PredictionError('simulation_failed', 'The order failed simulation, so it was not sent and no funds moved.', 422, { err: v.err, logs: (v.logs || []).slice(-8) });
	}
	const postLamports = v?.accounts?.[0]?.lamports ?? preLamports;
	const postUsdc = v?.accounts?.[1] ? decodeTokenAmount(v.accounts[1]) : preUsdc;
	const usdcOut = preUsdc - postUsdc;
	const lamportsOut = preLamports - postLamports;
	if (usdcOut > maxUsdcOutAtomic + USDC_ROUNDING_ATOMIC) {
		throw new PredictionError('simulation_out_of_bounds', 'The venue transaction would move more USDC than you confirmed, so it was not signed.', 422, {
			usdc_out: Number(usdcOut) / 10 ** USDC_DECIMALS,
			allowed_usdc_out: Number(maxUsdcOutAtomic) / 10 ** USDC_DECIMALS,
		});
	}
	if (lamportsOut > MAX_LAMPORTS_OUT) {
		throw new PredictionError('simulation_out_of_bounds', 'The venue transaction would spend more SOL than network fees, so it was not signed.', 422, {
			sol_out: lamportsOut / 1e9,
			allowed_sol_out: MAX_LAMPORTS_OUT / 1e9,
		});
	}
	return { usdc_out: Number(usdcOut) / 10 ** USDC_DECIMALS, sol_out: lamportsOut / 1e9, units: v?.unitsConsumed ?? null };
}

async function signAndSubmit({ agent, userId, venue, built, maxUsdcOutAtomic, owner, reason, custodyId }) {
	if (!built?.transaction) {
		throw new PredictionError('no_transaction', 'The venue returned no transaction to sign.', 502);
	}
	const vtx = VersionedTransaction.deserialize(Buffer.from(built.transaction, 'base64'));
	const ownerKey = new PublicKey(owner);
	const signerKeys = vtx.message.staticAccountKeys.slice(0, vtx.message.header.numRequiredSignatures).map((k) => k.toBase58());
	if (!signerKeys.includes(owner)) {
		throw new PredictionError('unexpected_transaction', 'The venue transaction does not name the agent wallet as a signer, so it was not signed.', 502);
	}
	const conn = solanaConnection('mainnet');
	const sim = await simulateWithinBounds({ conn, vtx, owner: ownerKey, usdcAta: usdcAtaFor(owner, venue), maxUsdcOutAtomic });

	const keypair = await recoverSolanaAgentKeypair(agent.meta.encrypted_solana_secret, {
		agentId: agent.id,
		userId,
		reason,
		meta: { venue: venue.id, custody_event_id: custodyId },
	});
	vtx.sign([keypair]);
	const signedTransaction = Buffer.from(vtx.serialize()).toString('base64');
	const { signature } = await venue.submit({ signedTransaction, context: built.context });
	return { signature, simulation: sim };
}

// ── Open ─────────────────────────────────────────────────────────────────────

async function priceOpen({ venue, owner, market, side, stakeUsd, maxPrice }) {
	const book = await venue.getOrderbook(market.id);
	const est = estimateBuy(asksFor(book, side), stakeUsd, maxPrice);
	let venueQuote = null;
	let venueQuoteError = null;
	try {
		const built = await venue.buildOpenOrder({ owner, marketId: market.id, side, usd: stakeUsd, maxPrice, quoteOnly: true });
		venueQuote = built.quote;
	} catch (err) {
		if (!(err instanceof VenueError)) throw err;
		venueQuoteError = { code: err.code, message: err.message };
	}
	return { book, est, venueQuote, venueQuoteError };
}

/** Preview an open. Never moves funds. */
export async function previewOpen({ agentId, userId, venueId = DEFAULT_VENUE, marketId, side: rawSide, stakeUsd: rawStake, maxPrice: rawMax }) {
	const venue = getVenue(venueId);
	const agent = await loadOwnedAgent(agentId, userId);
	const side = parseSide(rawSide);
	const stakeUsd = parseStake(rawStake);
	const market = await venue.getMarket(String(marketId || ''));
	if (!market.tradable) throw new PredictionError('market_closed', `This market is ${market.status || 'not open'}; it takes no new orders.`, 409);
	const outcome = sideOutcome(market, side);
	const ask = outcome?.buy_price ?? null;
	if (ask == null) throw new PredictionError('no_liquidity', 'Nobody is selling this side right now, so there is no price to buy at.', 409);
	// Default limit: two cents over the best ask, capped at 99 cents.
	const maxPrice = rawMax != null ? parsePrice(rawMax, 'max_price') : Math.min(0.99, Math.round((ask + 0.02) * 100) / 100);
	if (maxPrice < ask - 1e-9) {
		throw new PredictionError('max_price_below_market', `Your max price of ${(maxPrice * 100).toFixed(0)}¢ is under the best ask of ${(ask * 100).toFixed(1)}¢, so the order would not fill. Raise max_price or wait for the price to come down.`, 409, { best_ask: ask });
	}
	const owner = await walletFor(agent, userId, 'prediction_preview');
	const [{ est, venueQuote, venueQuoteError }, balances, status, guards] = await Promise.all([
		priceOpen({ venue, owner, market, side, stakeUsd, maxPrice }),
		getSolanaAddressBalances(owner, 'mainnet'),
		venue.tradingStatus().catch(() => ({ trading_active: null })),
		stakeGuards({ agent, venue, owner, marketId: market.id, stakeUsd, throwOnBlock: false }),
	]);

	const contracts = venueQuote?.contracts || est.contracts;
	const avgPrice = venueQuote?.avg_price || est.avg_price;
	const walletOk = balances.usdc != null && balances.usdc + 1e-9 >= stakeUsd;
	const solOk = balances.sol != null && balances.sol >= MIN_SOL_FOR_FEES;
	const checks = [
		...guards.checks,
		{ id: 'wallet_usdc', ok: walletOk, label: balances.usdc == null ? 'Could not read the wallet USDC balance' : `Wallet holds $${balances.usdc.toFixed(2)} USDC for a $${stakeUsd.toFixed(2)} stake` },
		{ id: 'wallet_sol', ok: solOk, label: balances.sol == null ? 'Could not read the wallet SOL balance' : `Wallet holds ${balances.sol.toFixed(4)} SOL for network fees` },
		{ id: 'fill', ok: est.filled_fully, label: est.filled_fully ? 'The book holds enough at or under your max price to fill the whole stake' : `Only $${est.spent_usd.toFixed(2)} of the stake fills at or under your max price` },
		{ id: 'venue_trading', ok: status.trading_active !== false, label: status.trading_active === false ? 'The venue has paused trading' : 'The venue is taking orders' },
	];
	if (venueQuoteError) checks.push({ id: 'venue_quote', ok: false, label: venueQuoteError.message, code: venueQuoteError.code });

	const quote = {
		market: { id: market.id, event_id: market.event_id, title: market.title, provider: market.provider, close_time: market.close_time },
		side,
		side_label: outcome.label,
		stake_usd: stakeUsd,
		max_price: maxPrice,
		best_ask: ask,
		expected_contracts: contracts,
		expected_avg_price: avgPrice,
		max_payout_usd: contracts,
		max_profit_usd: contracts != null ? Math.round((contracts - stakeUsd) * 100) / 100 : null,
		slippage_bps: venueQuote?.slippage_bps ?? est.slippage_bps,
		fees_usd: venueQuote?.fees_usd ?? null,
		quote_source: venueQuote ? 'venue' : 'order_book',
		book_fill: est,
		wallet: { address: owner, usdc: balances.usdc, sol: balances.sol },
		limits: { max_stake_per_market_usd: guards.limits.max_stake_per_market_usd, max_daily_stake_usd: guards.limits.max_daily_stake_usd, exposure_usd: guards.exposure_usd, staked_today_usd: guards.staked_today_usd },
		checks,
		blocked_by: checks.filter((c) => !c.ok).map((c) => c.id),
		executable: checks.every((c) => c.ok),
	};
	const { preview_id, expires_at } = await createPreview({
		agentId: agent.id,
		userId,
		venue: venue.id,
		kind: 'open',
		params: { market_id: market.id, side, stake_usd: stakeUsd, max_price: maxPrice },
		quote,
	});
	return { preview_id, expires_at, venue: venue.id, chain: 'solana', ...quote, confirm_with: { confirm_trade: true, preview_id } };
}

function requireConfirm(confirm, kind) {
	if (confirm !== true) {
		throw new PredictionError('confirmation_required', `This ${kind} moves real funds. Show the preview to the owner and pass confirm_trade: true only after a clear yes.`, 400);
	}
}

/** Execute a previewed open. Moves the stake. */
export async function executeOpen({ agentId, userId, previewId, confirm, req = null, source = 'owner' }) {
	requireConfirm(confirm, 'order');
	const preview = await loadPreview(previewId, { agentId, kind: 'open' });
	const venue = getVenue(preview.venue);
	const agent = await loadOwnedAgent(agentId, userId);
	const { market_id: marketId, side, stake_usd: stakeUsd, max_price: maxPrice } = preview.params;
	const owner = await walletFor(agent, userId, 'prediction_open');
	await stakeGuards({ agent, venue, owner, marketId, stakeUsd, throwOnBlock: true });
	await consumePreview(preview.id, 'open');

	let reservation;
	try {
		reservation = await reserveSpendUsd({
			agentId: agent.id,
			userId,
			meta: agent.meta,
			category: 'prediction',
			usdValue: stakeUsd,
			destination: `prediction-venue:${venue.id}`,
			asset: 'USDC',
			rowMeta: { prediction_action: 'open', market_id: marketId, side, max_price: maxPrice, venue: venue.id, preview_id: preview.id, source },
		});
	} catch (err) {
		await releasePreview(preview.id).catch(() => {});
		throw err;
	}
	const custodyId = reservation.reservationId;

	let built;
	try {
		built = await venue.buildOpenOrder({ owner, marketId, side, usd: stakeUsd, maxPrice });
	} catch (err) {
		await releaseSpendReservation(custodyId, 'prediction_build_failed').catch(() => {});
		await releasePreview(preview.id).catch(() => {});
		throw err;
	}

	let landed;
	try {
		landed = await signAndSubmit({
			agent, userId, venue, built, owner, custodyId,
			maxUsdcOutAtomic: BigInt(Math.round(stakeUsd * 10 ** USDC_DECIMALS)),
			reason: 'prediction_open',
		});
	} catch (err) {
		await releaseSpendReservation(custodyId, err?.code || 'prediction_submit_failed').catch(() => {});
		logAudit({ userId, action: 'custody.prediction_open_failed', resourceId: agent.id, meta: { market_id: marketId, side, stake_usd: stakeUsd, code: err?.code || null, source }, req });
		throw err;
	}

	await updateCustodyEvent(custodyId, {
		status: 'confirmed',
		signature: landed.signature,
		meta: { order_id: built.order_id, position_id: built.position_id, quote: built.quote, simulation: landed.simulation },
	}).catch(() => {});
	logAudit({ userId, action: 'custody.prediction_open', resourceId: agent.id, meta: { market_id: marketId, side, stake_usd: stakeUsd, signature: landed.signature, source }, req });

	return {
		ok: true,
		action: 'open',
		signature: landed.signature,
		explorer: `https://solscan.io/tx/${landed.signature}`,
		order_id: built.order_id,
		position_id: built.position_id,
		market_id: marketId,
		side,
		stake_usd: stakeUsd,
		max_price: maxPrice,
		expected_contracts: built.quote?.contracts ?? null,
		note: 'The order is on chain. The venue fills it against the book within moments; the position appears under positions once filled.',
	};
}

// ── Close ────────────────────────────────────────────────────────────────────

async function findPosition(venue, owner, positionId) {
	const positions = await venue.listPositions(owner);
	const pos = positions.find((p) => p.id === positionId);
	if (!pos) throw new PredictionError('position_not_found', 'This agent holds no position with that id.', 404);
	return pos;
}

export async function previewClose({ agentId, userId, positionId, contracts: rawContracts, minPrice: rawMin }) {
	const venue = getVenue(DEFAULT_VENUE);
	const agent = await loadOwnedAgent(agentId, userId);
	const owner = await walletFor(agent, userId, 'prediction_preview');
	const pos = await findPosition(venue, owner, String(positionId || ''));
	if (pos.status !== 'open') throw new PredictionError('position_settled', 'This market has resolved. Redeem the position instead of closing it.', 409);
	const contracts = rawContracts == null ? pos.contracts : Math.min(pos.contracts, Number(rawContracts));
	if (!Number.isFinite(contracts) || contracts <= 0) throw new PredictionError('invalid_contracts', `contracts must be between 0 and ${pos.contracts}.`);
	const book = await venue.getOrderbook(pos.market_id);
	const bids = bidsFor(book, pos.side);
	const bestBid = pos.exit_price ?? bids[0]?.[0] ?? null;
	if (bestBid == null) throw new PredictionError('no_liquidity', 'Nobody is bidding on this side right now, so there is no price to sell at.', 409);
	const minPrice = rawMin != null ? parsePrice(rawMin, 'min_price') : Math.max(0.01, Math.floor((bestBid - 0.02) * 100) / 100);
	const est = estimateSell(bids, contracts, minPrice);
	const quote = {
		position: { id: pos.id, market_id: pos.market_id, market_title: pos.market_title, event_title: pos.event_title, side: pos.side, side_label: pos.side_label, contracts_held: pos.contracts, cost_usd: pos.cost_usd },
		contracts,
		min_price: minPrice,
		best_bid: bestBid,
		expected_proceeds_usd: est.proceeds_usd,
		expected_avg_price: est.avg_price,
		expected_realized_pnl_usd: pos.cost_usd != null && pos.contracts > 0 ? Math.round((est.proceeds_usd - (pos.cost_usd * contracts) / pos.contracts) * 100) / 100 : null,
		slippage_bps: est.slippage_bps,
		book_fill: est,
		checks: [
			{ id: 'fill', ok: est.filled_fully, label: est.filled_fully ? 'The book holds enough bids at or above your min price' : `Only ${est.contracts_sold} of ${contracts} contracts sell at or above your min price` },
		],
	};
	quote.executable = quote.checks.every((c) => c.ok);
	quote.blocked_by = quote.checks.filter((c) => !c.ok).map((c) => c.id);
	const { preview_id, expires_at } = await createPreview({ agentId: agent.id, userId, venue: venue.id, kind: 'close', params: { position_id: pos.id, market_id: pos.market_id, side: pos.side, contracts, min_price: minPrice }, quote });
	return { preview_id, expires_at, venue: venue.id, chain: 'solana', ...quote, confirm_with: { confirm_trade: true, preview_id } };
}

export async function executeClose({ agentId, userId, previewId, confirm, req = null, source = 'owner' }) {
	requireConfirm(confirm, 'close');
	const preview = await loadPreview(previewId, { agentId, kind: 'close' });
	const venue = getVenue(preview.venue);
	const agent = await loadOwnedAgent(agentId, userId);
	const owner = await walletFor(agent, userId, 'prediction_close');
	const { position_id: positionId, market_id: marketId, side, contracts, min_price: minPrice } = preview.params;
	await consumePreview(preview.id, 'close');
	const custodyId = await recordCustodyEvent({
		agentId: agent.id, userId, eventType: 'spend', category: 'prediction', asset: 'USDC', status: 'pending',
		reason: 'prediction_close', destination: `prediction-venue:${venue.id}`,
		meta: { prediction_action: 'close', position_id: positionId, market_id: marketId, side, contracts, min_price: minPrice, preview_id: preview.id, source },
	});
	try {
		const built = await venue.buildCloseOrder({ owner, positionId, marketId, side, contracts, minPrice });
		const landed = await signAndSubmit({ agent, userId, venue, built, owner, custodyId, maxUsdcOutAtomic: 0n, reason: 'prediction_close' });
		await updateCustodyEvent(custodyId, { status: 'confirmed', signature: landed.signature, meta: { order_id: built.order_id, simulation: landed.simulation } }).catch(() => {});
		logAudit({ userId, action: 'custody.prediction_close', resourceId: agent.id, meta: { position_id: positionId, contracts, signature: landed.signature, source }, req });
		return { ok: true, action: 'close', signature: landed.signature, explorer: `https://solscan.io/tx/${landed.signature}`, order_id: built.order_id, position_id: positionId, contracts, min_price: minPrice, note: 'The sell order is on chain; proceeds reach the wallet as it fills.' };
	} catch (err) {
		await updateCustodyEvent(custodyId, { status: 'failed', meta: { error: err?.code || 'close_failed' } }).catch(() => {});
		await releasePreview(preview.id).catch(() => {});
		throw err;
	}
}

// ── Redeem ───────────────────────────────────────────────────────────────────

export async function previewRedeem({ agentId, userId, positionId }) {
	const venue = getVenue(DEFAULT_VENUE);
	const agent = await loadOwnedAgent(agentId, userId);
	const owner = await walletFor(agent, userId, 'prediction_preview');
	const pos = await findPosition(venue, owner, String(positionId || ''));
	const checks = [
		{ id: 'resolved', ok: pos.status !== 'open', label: pos.status === 'open' ? 'The market has not resolved yet' : 'The market has resolved' },
		{ id: 'winning', ok: pos.won !== false, label: pos.won === false ? 'This side lost; there is nothing to redeem' : 'This side is owed a payout' },
		{ id: 'claimable', ok: pos.claimable, label: pos.claimed ? 'Already redeemed' : pos.claimable ? 'The payout is claimable now' : 'The payout is not claimable yet' },
	];
	const quote = {
		position: { id: pos.id, market_id: pos.market_id, market_title: pos.market_title, event_title: pos.event_title, side: pos.side, side_label: pos.side_label, contracts_held: pos.contracts, cost_usd: pos.cost_usd, result: pos.result },
		expected_payout_usd: pos.payout_usd,
		checks,
		executable: checks.every((c) => c.ok),
		blocked_by: checks.filter((c) => !c.ok).map((c) => c.id),
	};
	const { preview_id, expires_at } = await createPreview({ agentId: agent.id, userId, venue: venue.id, kind: 'redeem', params: { position_id: pos.id, market_id: pos.market_id }, quote });
	return { preview_id, expires_at, venue: venue.id, chain: 'solana', ...quote, confirm_with: { confirm_trade: true, preview_id } };
}

export async function executeRedeem({ agentId, userId, previewId, confirm, req = null, source = 'owner' }) {
	requireConfirm(confirm, 'redemption');
	const preview = await loadPreview(previewId, { agentId, kind: 'redeem' });
	const venue = getVenue(preview.venue);
	const agent = await loadOwnedAgent(agentId, userId);
	const owner = await walletFor(agent, userId, 'prediction_redeem');
	const { position_id: positionId, market_id: marketId } = preview.params;
	await consumePreview(preview.id, 'redeem');
	const custodyId = await recordCustodyEvent({
		agentId: agent.id, userId, eventType: 'spend', category: 'prediction', asset: 'USDC', status: 'pending',
		reason: 'prediction_redeem', destination: `prediction-venue:${venue.id}`,
		meta: { prediction_action: 'redeem', position_id: positionId, market_id: marketId, preview_id: preview.id, source },
	});
	try {
		const built = await venue.buildRedeem({ owner, positionId });
		const landed = await signAndSubmit({ agent, userId, venue, built, owner, custodyId, maxUsdcOutAtomic: 0n, reason: 'prediction_redeem' });
		await updateCustodyEvent(custodyId, { status: 'confirmed', signature: landed.signature, meta: { payout_usd: built.payout_usd, simulation: landed.simulation } }).catch(() => {});
		logAudit({ userId, action: 'custody.prediction_redeem', resourceId: agent.id, meta: { position_id: positionId, payout_usd: built.payout_usd, signature: landed.signature, source }, req });
		return { ok: true, action: 'redeem', signature: landed.signature, explorer: `https://solscan.io/tx/${landed.signature}`, position_id: positionId, payout_usd: built.payout_usd };
	} catch (err) {
		await updateCustodyEvent(custodyId, { status: 'failed', meta: { error: err?.code || 'redeem_failed' } }).catch(() => {});
		await releasePreview(preview.id).catch(() => {});
		throw err;
	}
}

// ── Positions ────────────────────────────────────────────────────────────────

/** The agent's positions and recent fills with a PnL summary. Owner-only. */
export async function agentPositions({ agentId, userId }) {
	const venue = getVenue(DEFAULT_VENUE);
	const agent = await loadOwnedAgent(agentId, userId);
	const owner = await walletFor(agent, userId, 'prediction_positions');
	const [positions, fills, balances] = await Promise.all([
		venue.listPositions(owner),
		venue.listFills(owner, { limit: 50 }).catch(() => []),
		getSolanaAddressBalances(owner, 'mainnet'),
	]);
	const open = positions.filter((p) => p.status === 'open');
	const settled = positions.filter((p) => p.status !== 'open');
	const sum = (arr, k) => Math.round(arr.reduce((s, p) => s + (Number(p[k]) || 0), 0) * 100) / 100;
	return {
		venue: venue.id,
		chain: 'solana',
		agent: { id: agent.id, name: agent.name },
		wallet: { address: owner, usdc: balances.usdc, sol: balances.sol },
		limits: getPredictionLimits(agent.meta),
		summary: {
			open_count: open.length,
			settled_count: settled.length,
			open_cost_usd: sum(open, 'cost_usd'),
			open_value_usd: sum(open, 'value_usd'),
			unrealized_pnl_usd: sum(open, 'pnl_usd'),
			realized_pnl_usd: sum(positions, 'realized_pnl_usd'),
			claimable_usd: sum(positions.filter((p) => p.claimable), 'payout_usd'),
		},
		open,
		settled,
		fills,
	};
}

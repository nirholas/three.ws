// Perps service: the one path every perps action takes, from the v1 routes, the
// MCP tools and the /agents/:id/perps page alike.
//
// Two modes, chosen per agent by its owner (api/_lib/perps/limits.js):
//
//   paper  the default. Orders are priced by the venue's own quote against the
//          live order book and marks, then filled on the platform's paper ledger
//          (./paper.js). Nothing is built, signed or sent.
//   live   only after the owner turns it on for that agent. Instructions come
//          from the venue module, are simulated against current chain state with
//          the agent's USDC and SOL outflow bounded, signed by the agent's
//          custodial wallet, sent, and confirmed.
//
// Every action that changes anything runs in two calls. The preview prices it,
// runs every guard and stores exactly what it showed (api/_lib/action-previews.js);
// the execute must present that preview's id, an explicit confirm_trade: true
// and an Idempotency-Key. Before an order executes it is re-quoted, and it is
// refused if the entry or liquidation price moved past the owner's tolerance.
// Executes are idempotent per agent and key (perps_executions): a replay returns
// the first result instead of trading twice.
//
// Guards, in the order they apply: the perps mode (live must be enabled), the
// perps kill switch (`halted`), the agent-wide trade kill switch, the wallet
// freeze, the per-agent leverage cap, the per-position margin cap, free
// collateral, slippage, and on deposits the wallet-wide spend policy (per
// transaction and daily USD caps, natural-language rules, anomaly guard). Only
// risk-increasing orders are blocked by the kill switches and caps, so an owner
// can always reduce or close.

import { PublicKey, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } from '@solana/web3.js';
import { getAssociatedTokenAddressSync } from '@solana/spl-token';
import { sql } from '../db.js';
import { logAudit } from '../audit.js';
import { ensureAgentWallet, recoverSolanaAgentKeypair, getSolanaAddressBalances } from '../agent-wallet.js';
import { solanaConnection } from '../agent-pumpfun.js';
import { confirmOrThrow } from '../solana/confirm.js';
import { USDC_MINT_BY_NETWORK } from '../vault-jupiter.js';
import { currentSignatureFor, agreementRequirement } from '../real-funds-agreement.js';
import {
	getSpendLimits, getTradeLimits, reserveSpendUsd, releaseSpendReservation,
	recordCustodyEvent, updateCustodyEvent, SpendLimitError,
} from '../agent-trade-guards.js';
import {
	createActionPreview, loadActionPreview, consumeActionPreview, releaseActionPreview, ActionPreviewError,
} from '../action-previews.js';
import { getVenue, DEFAULT_VENUE, listVenues, ORDER_TYPES, SIDES } from './index.js';
import { PerpsError, perpsError } from './errors.js';
import { getPerpsLimits, setPerpsLimits, checkPerpsOrder, quoteMoved } from './limits.js';
import {
	mutatePaper, loadPaperState, buildPaperAccount, applyFill, settleFunding, limitCrossed, triggerHit,
	listPaperFills, PAPER_MAX_COLLATERAL_USD,
} from './paper.js';
import { evaluateAlerts } from './alerts.js';

const PREFIX = 'perp';
const ORDER_PREVIEW_TTL_MS = 2 * 60_000;
const FUNDS_PREVIEW_TTL_MS = 5 * 60_000;
const USDC_DECIMALS = 6;
// SOL a perps transaction may spend: base fee, priority fee and at most one
// account rent. Anything past this fails the simulation bound.
const MAX_LAMPORTS_OUT = 5_000_000;
const MIN_SOL_FOR_FEES = 0.003;
const USDC_ROUNDING_ATOMIC = 10_000n;
const PRIORITY_MICROLAMPORTS = 50_000;
const MAX_COMPUTE_UNITS = 1_400_000;
// Settle paper funding into collateral at most this often unless a fill lands.
const FUNDING_SETTLE_MS = 15 * 60_000;
const MIN_USD = 1;
const MAX_FUNDS_USD = 1_000_000;

const HINT = 'Call the matching perps preview again for a fresh preview_id.';
const round = (n, dp = 6) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10 ** dp) / 10 ** dp);

/** Map any perps-stack failure to { status, code, message, detail } for a boundary. */
export function describeError(err) {
	if (err instanceof PerpsError || err instanceof ActionPreviewError || err instanceof SpendLimitError) {
		return { status: err.status || 400, code: err.code, message: err.message, detail: err.detail || null };
	}
	if (err && err.code === 'unknown_venue' && err.status) {
		return { status: err.status, code: err.code, message: err.message, detail: err.detail || null };
	}
	return null;
}

// ── agent, wallet, mode ──────────────────────────────────────────────────────

/** Load an agent the user owns. Throws 404 / 403. */
export async function loadOwnedAgent(agentId, userId) {
	const [row] = await sql`
		SELECT id, user_id, name, meta FROM agent_identities
		WHERE id = ${agentId} AND deleted_at IS NULL
	`;
	if (!row) throw perpsError(404, 'not_found', 'No agent with that id.');
	if (row.user_id !== userId) throw perpsError(403, 'forbidden', "That agent isn't on your account.");
	return row;
}

async function walletFor(agent, userId, reason) {
	const { address } = await ensureAgentWallet(agent.id, userId, { reason });
	return address;
}

/**
 * The mode an action runs in. An explicit 'paper' is always allowed; 'live'
 * only once the owner has enabled it. Omitted means the agent's default.
 */
export function resolveMode(limits, requested) {
	const want = requested == null || requested === '' ? null : String(requested).toLowerCase();
	if (want && want !== 'paper' && want !== 'live') {
		throw perpsError(400, 'invalid_mode', 'mode must be "paper" or "live".');
	}
	if (want === 'live' && !limits.live_enabled) {
		throw perpsError(403, 'live_disabled', 'Live perps trading is off for this agent. The owner turns it on under the perps limits; until then use paper mode, which fills at live prices without moving funds.');
	}
	return want || (limits.live_enabled ? 'live' : 'paper');
}

async function requireLiveAgreement(userId) {
	let signed;
	try {
		signed = await currentSignatureFor(userId);
	} catch {
		throw perpsError(503, 'agreement_check_unavailable', 'Could not verify your signed real-funds agreements, so nothing was sent. Try again in a moment.');
	}
	if (!signed) {
		throw perpsError(403, 'risk_ack_required', 'Sign the real-funds agreements (Terms of Service, Risk Disclosure, and Agent Wallet Agreement) before trading live perps. Nothing was sent.', agreementRequirement());
	}
}

function requireConfirm(confirm, what) {
	if (confirm !== true) {
		throw perpsError(400, 'confirmation_required', `This ${what} needs explicit confirmation. Show the preview to the owner and pass confirm_trade: true only after a clear yes.`);
	}
}

function parseUsd(v, name, { min = MIN_USD, max = MAX_FUNDS_USD } = {}) {
	const n = Number(v);
	if (!Number.isFinite(n) || n < min || n > max) {
		throw perpsError(400, `invalid_${name}`, `${name} must be between $${min} and $${max.toLocaleString('en-US')}.`);
	}
	return Math.floor(n * 100) / 100;
}

function parsePositive(v, name) {
	if (v == null || v === '') return null;
	const n = Number(v);
	if (!Number.isFinite(n) || n <= 0) throw perpsError(400, `invalid_${name}`, `${name} must be a positive number.`);
	return n;
}

function idempotencyKeyOf(key) {
	const k = typeof key === 'string' ? key.trim() : '';
	if (!k || k.length > 200) {
		throw perpsError(400, 'idempotency_key_required', 'Every perps execute needs an Idempotency-Key (1 to 200 characters), so a retried request never trades twice.');
	}
	return k;
}

// ── market reads ─────────────────────────────────────────────────────────────

/** Every market on the venue, most traded first. */
export async function markets({ venueId = DEFAULT_VENUE, kind = null } = {}) {
	const venue = getVenue(venueId);
	const list = await venue.listMarkets({ kind });
	return { venue: venue.id, venues: listVenues(), collateral: venue.collateral, markets: list.map(({ params, ...m }) => m) };
}

/** Book, recent trades and funding history for one market. */
export async function marketData({ venueId = DEFAULT_VENUE, symbol, depth = 20, trades = 30, funding = 48 }) {
	const venue = getVenue(venueId);
	if (!symbol) throw perpsError(400, 'symbol_required', 'Pass a market symbol such as SOL or BTC. perps_markets lists them.');
	const data = await venue.getMarketData(symbol, { depth, trades, funding });
	return { venue: venue.id, ...data };
}

async function marketMap(venue) {
	const list = await venue.listMarkets();
	return new Map(list.map((m) => [m.symbol, m]));
}

// ── paper sync: funding, resting limits, triggers, liquidation ───────────────

/**
 * Bring an agent's paper ledger up to the live market: settle funding, fill any
 * resting limit the book has crossed, fire take-profits and stop-losses the
 * mark has reached, and liquidate an account under maintenance margin.
 * Returns the venue-shaped paper account at current marks.
 */
export async function syncPaper(agentId, userId, venue) {
	const mkts = await marketMap(venue);
	const books = new Map();
	const bookFor = async (symbol) => {
		if (!books.has(symbol)) books.set(symbol, venue.getMarketData(symbol, { depth: 5, trades: 0, funding: 0 }).then((d) => d.book));
		return books.get(symbol);
	};
	const result = await mutatePaper(agentId, userId, venue.id, async (prev) => {
		const now = Date.now();
		const open = prev.orders.filter((o) => o.status === 'open');
		const oldestFunding = Math.min(...[...prev.positions.values()].map((p) => p.funding_at), now);
		if (!open.length && now - oldestFunding < FUNDING_SETTLE_MS && !accountLiquidatable(prev, mkts, now)) {
			return { state: prev, result: buildPaperAccount(prev, mkts, now) };
		}
		let state = settleFunding(prev, mkts, now);
		const fills = [];
		const orderUpdates = [];

		for (const o of open.filter((x) => x.type === 'limit')) {
			const m = mkts.get(o.symbol);
			const book = await bookFor(o.symbol).catch(() => null);
			if (!m || !book || !limitCrossed(o, book)) continue;
			const pos = state.positions.get(o.symbol);
			let size = o.size;
			if (o.reduce_only) {
				const held = pos ? Math.abs(pos.signed_size) : 0;
				const closes = pos && Math.sign(pos.signed_size) !== (o.side === 'long' ? 1 : -1);
				if (!closes || held <= 0) {
					orderUpdates.push({ id: o.id, status: 'cancelled' });
					continue;
				}
				size = Math.min(size, held);
			}
			const out = applyFill(state, { symbol: o.symbol, delta: o.side === 'long' ? size : -size, price: o.price, feeUsd: size * o.price * (m.maker_fee_rate || 0), reason: 'limit', orderId: o.id });
			state = out.state;
			fills.push(out.fill);
			orderUpdates.push({ id: o.id, status: 'filled', fill_price: o.price });
		}

		for (const o of open.filter((x) => x.type === 'take_profit' || x.type === 'stop_loss')) {
			const m = mkts.get(o.symbol);
			const pos = state.positions.get(o.symbol);
			if (!pos || Math.abs(pos.signed_size) < 1e-12) {
				orderUpdates.push({ id: o.id, status: 'cancelled' });
				continue;
			}
			if (!m || !triggerHit(o, m.mark_price)) continue;
			const size = Math.abs(pos.signed_size) * ((o.size_percent ?? 100) / 100);
			// The trigger fires a closing order: fill at the mark, but never worse
			// than the execution price the trigger was placed with.
			const isLong = pos.signed_size > 0;
			const price = isLong ? Math.max(m.mark_price, o.price) : Math.min(m.mark_price, o.price);
			const out = applyFill(state, { symbol: o.symbol, delta: isLong ? -size : size, price, feeUsd: size * price * (m.taker_fee_rate || 0), reason: o.type, orderId: o.id });
			state = out.state;
			fills.push(out.fill);
			orderUpdates.push({ id: o.id, status: 'filled', fill_price: price });
		}

		if (accountLiquidatable(state, mkts, now)) {
			for (const [symbol, p] of state.positions) {
				if (Math.abs(p.signed_size) < 1e-12) continue;
				const m = mkts.get(symbol);
				const price = m?.mark_price ?? p.entry_price;
				const size = Math.abs(p.signed_size);
				const out = applyFill(state, { symbol, delta: -p.signed_size, price, feeUsd: size * price * (m?.taker_fee_rate || 0), reason: 'liquidation' });
				state = out.state;
				fills.push(out.fill);
			}
			for (const o of open) if (!orderUpdates.some((u) => u.id === o.id)) orderUpdates.push({ id: o.id, status: 'cancelled' });
		}

		const updatedIds = new Set(orderUpdates.map((u) => u.id));
		state = { ...state, orders: state.orders.filter((o) => !updatedIds.has(o.id)) };
		return { state, fills, orderUpdates, result: buildPaperAccount(state, mkts, now) };
	});
	return result;
}

function accountLiquidatable(state, mkts, now) {
	if (![...state.positions.values()].some((p) => Math.abs(p.signed_size) > 1e-12)) return false;
	const acct = buildPaperAccount(state, mkts, now);
	return acct.equity_usd < acct.maintenance_margin_usd;
}

// ── account ──────────────────────────────────────────────────────────────────

async function accountFor({ agent, userId, venue, mode, reason = 'perps_read' }) {
	if (mode === 'paper') return syncPaper(agent.id, userId, venue);
	const owner = await walletFor(agent, userId, reason);
	return venue.getAccount(owner);
}

function summarize(account) {
	return {
		equity_usd: account.equity_usd,
		collateral_usd: account.collateral_usd,
		withdrawable_usd: account.withdrawable_usd,
		unrealized_pnl_usd: account.unrealized_pnl_usd,
		notional_usd: account.notional_usd,
		account_leverage: account.account_leverage,
		positions: account.positions.length,
		open_orders: account.orders.length + account.conditionals.length,
		risk_state: account.risk_state,
		closest_liquidation_pct: account.positions.reduce((min, p) => (p.liquidation_distance_pct != null && (min == null || p.liquidation_distance_pct < min) ? p.liquidation_distance_pct : min), null),
	};
}

/** The agent's perps account in one mode: collateral, positions, orders, limits. */
export async function account({ agentId, userId, venueId = DEFAULT_VENUE, mode: requested = null }) {
	const venue = getVenue(venueId);
	const agent = await loadOwnedAgent(agentId, userId);
	const limits = getPerpsLimits(agent.meta);
	const mode = resolveMode(limits, requested);
	const owner = await walletFor(agent, userId, 'perps_read');
	const [acct, balances] = await Promise.all([
		accountFor({ agent, userId, venue, mode }),
		mode === 'live' ? getSolanaAddressBalances(owner, 'mainnet') : Promise.resolve(null),
	]);
	return {
		agent: { id: agent.id, name: agent.name },
		venue: venue.id,
		venue_label: venue.label,
		chain: 'solana',
		mode,
		wallet: { address: owner, usdc: balances?.usdc ?? null, sol: balances?.sol ?? null },
		limits,
		guards: guardState(agent.meta),
		summary: summarize(acct),
		account: acct,
		alerts: evaluateAlerts(acct, limits),
	};
}

function guardState(meta) {
	return { trade_kill_switch: getTradeLimits(meta).kill_switch === true, wallet_frozen: getSpendLimits(meta).frozen === true };
}

/** Positions, resting orders and recent history (paper fills, or live executions). */
export async function positions({ agentId, userId, venueId = DEFAULT_VENUE, mode: requested = null, limit = 50 }) {
	const venue = getVenue(venueId);
	const agent = await loadOwnedAgent(agentId, userId);
	const limits = getPerpsLimits(agent.meta);
	const mode = resolveMode(limits, requested);
	const acct = await accountFor({ agent, userId, venue, mode });
	const history = mode === 'paper'
		? await listPaperFills(agent.id, venue.id, { limit })
		: await listExecutions(agent.id, { mode: 'live', limit });
	return {
		venue: venue.id,
		mode,
		summary: summarize(acct),
		positions: acct.positions,
		orders: acct.orders,
		conditionals: acct.conditionals,
		history,
		paper: acct.paper || null,
	};
}

/** Executions this platform ran for an agent, newest first. */
export async function listExecutions(agentId, { mode = null, limit = 50 } = {}) {
	const rows = await sql`
		SELECT id, venue, mode, action, status, signatures, result, error, source, created_at, finished_at
		FROM perps_executions
		WHERE agent_id = ${agentId} AND (${mode}::text IS NULL OR mode = ${mode})
		ORDER BY id DESC LIMIT ${Math.min(200, Math.max(1, limit))}
	`;
	return rows.map((r) => ({
		id: String(r.id),
		venue: r.venue,
		mode: r.mode,
		action: r.action,
		status: r.status,
		signatures: r.signatures || [],
		summary: r.result?.summary || null,
		error: r.error ? { code: r.error.code, message: r.error.message } : null,
		source: r.source,
		created_at: new Date(r.created_at).toISOString(),
		finished_at: r.finished_at ? new Date(r.finished_at).toISOString() : null,
	}));
}

/** The live tracker frame: per-position PnL, funding, liquidation distance, plus alerts. */
export async function trackerFrame({ agentId, userId, venueId = DEFAULT_VENUE, mode: requested = null }) {
	const venue = getVenue(venueId);
	const agent = await loadOwnedAgent(agentId, userId);
	const limits = getPerpsLimits(agent.meta);
	const mode = resolveMode(limits, requested);
	const acct = await accountFor({ agent, userId, venue, mode });
	return {
		at: new Date().toISOString(),
		venue: venue.id,
		mode,
		halted: limits.halted,
		summary: summarize(acct),
		positions: acct.positions.map((p) => ({
			symbol: p.symbol,
			side: p.side,
			size: p.size,
			entry_price: p.entry_price,
			mark_price: p.mark_price,
			notional_usd: p.notional_usd,
			unrealized_pnl_usd: p.unrealized_pnl_usd,
			funding_paid_usd: p.funding_accrued_usd,
			liquidation_price: p.liquidation_price,
			liquidation_distance_pct: p.liquidation_distance_pct,
			take_profit_price: p.take_profit_price,
			stop_loss_price: p.stop_loss_price,
		})),
		orders: acct.orders.length + acct.conditionals.length,
		alerts: evaluateAlerts(acct, limits),
	};
}

// ── limits ───────────────────────────────────────────────────────────────────

export async function getLimits({ agentId, userId }) {
	const agent = await loadOwnedAgent(agentId, userId);
	return { limits: getPerpsLimits(agent.meta), guards: guardState(agent.meta) };
}

/** Owner-only: patch the perps limits. Turning live on requires the signed agreements. */
export async function updateLimits({ agentId, userId, patch, req = null }) {
	const agent = await loadOwnedAgent(agentId, userId);
	const prev = getPerpsLimits(agent.meta);
	if (patch?.live_enabled === true && !prev.live_enabled) await requireLiveAgreement(userId);
	const reason = patch?.halted === false && prev.halted ? 'perps_resumed' : 'perps_limits_updated';
	const limits = await setPerpsLimits(agentId, userId, patch, { req, reason });
	return { limits, guards: guardState(agent.meta) };
}

// ── live transaction path ────────────────────────────────────────────────────

function usdcAta(owner) {
	return getAssociatedTokenAddressSync(new PublicKey(USDC_MINT_BY_NETWORK.mainnet), new PublicKey(owner), true);
}

function decodeTokenAmount(account) {
	if (!account) return 0n;
	const data = Array.isArray(account.data) ? Buffer.from(account.data[0], 'base64') : null;
	if (!data || data.length < 72) return 0n;
	return data.readBigUInt64LE(64);
}

async function compile(conn, owner, instructions, units) {
	const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
	const message = new TransactionMessage({
		payerKey: new PublicKey(owner),
		recentBlockhash: blockhash,
		instructions: [
			ComputeBudgetProgram.setComputeUnitLimit({ units }),
			ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_MICROLAMPORTS }),
			...instructions,
		],
	}).compileToV0Message();
	return { vtx: new VersionedTransaction(message), blockhash, lastValidBlockHeight };
}

/**
 * Simulate against current chain state and verify the agent's USDC and SOL
 * move within bounds. Returns the compute units the transaction used.
 */
async function simulateWithinBounds({ conn, vtx, owner, maxUsdcOutAtomic }) {
	const ownerKey = new PublicKey(owner);
	const ata = usdcAta(owner);
	const [preLamports, preUsdc] = await Promise.all([
		conn.getBalance(ownerKey, 'confirmed'),
		conn.getTokenAccountBalance(ata, 'confirmed').then((b) => BigInt(b?.value?.amount || '0')).catch(() => 0n),
	]);
	let sim;
	try {
		sim = await conn.simulateTransaction(vtx, {
			sigVerify: false,
			replaceRecentBlockhash: true,
			commitment: 'confirmed',
			accounts: { encoding: 'base64', addresses: [ownerKey.toBase58(), ata.toBase58()] },
		});
	} catch (err) {
		throw perpsError(503, 'simulation_unavailable', 'Could not simulate the transaction before signing, so nothing was sent. Try again.', { message: err?.message?.slice(0, 200) || null });
	}
	const v = sim?.value;
	if (v?.err) {
		throw perpsError(422, 'simulation_failed', 'The venue transaction failed simulation, so it was not sent and no funds moved.', { err: v.err, logs: (v.logs || []).slice(-8) });
	}
	const postLamports = v?.accounts?.[0]?.lamports ?? preLamports;
	const postUsdc = v?.accounts?.[1] ? decodeTokenAmount(v.accounts[1]) : preUsdc;
	const usdcOut = preUsdc - postUsdc;
	const lamportsOut = preLamports - postLamports;
	if (usdcOut > maxUsdcOutAtomic + USDC_ROUNDING_ATOMIC) {
		throw perpsError(422, 'simulation_out_of_bounds', 'The venue transaction would move more USDC than you confirmed, so it was not signed.', {
			usdc_out: Number(usdcOut) / 10 ** USDC_DECIMALS,
			allowed_usdc_out: Number(maxUsdcOutAtomic) / 10 ** USDC_DECIMALS,
		});
	}
	if (lamportsOut > MAX_LAMPORTS_OUT) {
		throw perpsError(422, 'simulation_out_of_bounds', 'The venue transaction would spend more SOL than network fees and one account rent, so it was not signed.', {
			sol_out: lamportsOut / 1e9,
			allowed_sol_out: MAX_LAMPORTS_OUT / 1e9,
		});
	}
	return { usdc_out: Number(usdcOut) / 10 ** USDC_DECIMALS, sol_out: lamportsOut / 1e9, units: v?.unitsConsumed ?? null };
}

async function agentKeypair(agentId, userId, reason, meta) {
	const [row] = await sql`SELECT meta FROM agent_identities WHERE id = ${agentId} AND deleted_at IS NULL`;
	const secret = row?.meta?.encrypted_solana_secret;
	if (!secret) {
		throw perpsError(409, 'wallet_unsignable', 'This agent wallet has no platform-held key (it is self-custodied or not yet provisioned), so the platform cannot sign perps transactions for it.');
	}
	return recoverSolanaAgentKeypair(secret, { agentId, userId, reason, meta });
}

/**
 * Simulate, sign and land one transaction of venue instructions. `sent` on the
 * returned object (and on a thrown error) says whether it reached the network.
 */
async function landInstructions({ agentId, userId, owner, instructions, maxUsdcOutAtomic, reason, meta, submitVia = null }) {
	const conn = solanaConnection('mainnet');
	const draft = await compile(conn, owner, instructions, MAX_COMPUTE_UNITS);
	const sim = await simulateWithinBounds({ conn, vtx: draft.vtx, owner, maxUsdcOutAtomic });
	const units = Math.min(MAX_COMPUTE_UNITS, Math.max(50_000, Math.ceil((sim.units || 400_000) * 1.25)));
	const final = await compile(conn, owner, instructions, units);
	const keypair = await agentKeypair(agentId, userId, reason, meta);
	final.vtx.sign([keypair]);
	let signature;
	try {
		if (submitVia) {
			signature = (await submitVia(Buffer.from(final.vtx.serialize()).toString('base64'))).signature;
		} else {
			signature = await conn.sendRawTransaction(final.vtx.serialize(), { skipPreflight: false, maxRetries: 3 });
		}
	} catch (err) {
		if (err instanceof PerpsError) throw err;
		throw perpsError(502, 'send_failed', 'The network refused the transaction, so nothing moved. Try again.', { message: String(err?.message || err).slice(0, 240) });
	}
	try {
		await confirmOrThrow(conn, { signature, blockhash: final.blockhash, lastValidBlockHeight: final.lastValidBlockHeight });
	} catch (err) {
		throw Object.assign(
			perpsError(502, err?.code === 'tx_reverted' ? 'transaction_reverted' : 'confirmation_timeout',
				err?.code === 'tx_reverted'
					? 'The transaction landed but the venue program rejected it, so nothing changed beyond the network fee.'
					: 'The transaction was sent but not confirmed in time. Check the explorer link before retrying.',
				{ signature, explorer: explorer(signature) }),
			{ sent: true, signature },
		);
	}
	return { signature, explorer: explorer(signature), simulation: sim };
}

const explorer = (sig) => `https://solscan.io/tx/${sig}`;

// ── idempotent execution ledger ──────────────────────────────────────────────

/**
 * Run `fn` once per (agent, Idempotency-Key). A replay of a finished execution
 * returns its stored result; an execution still running is a 409; a key reused
 * for a different preview is a 422. An execution that failed before anything
 * reached the network frees its key, so the caller can retry with a new preview.
 */
async function onceByKey({ agent, userId, venue, mode, action, previewId, key, source }, fn) {
	const [existing] = await sql`
		SELECT id, preview_id, status, result, error FROM perps_executions
		WHERE agent_id = ${agent.id} AND idempotency_key = ${key}
	`;
	if (existing) return replay(existing, previewId);

	const [row] = await sql`
		INSERT INTO perps_executions (agent_id, user_id, venue, mode, action, idempotency_key, preview_id, source)
		VALUES (${agent.id}, ${userId}, ${venue.id}, ${mode}, ${action}, ${key}, ${previewId}, ${source})
		ON CONFLICT (agent_id, idempotency_key) DO NOTHING
		RETURNING id
	`;
	if (!row) {
		const [raced] = await sql`SELECT id, preview_id, status, result, error FROM perps_executions WHERE agent_id = ${agent.id} AND idempotency_key = ${key}`;
		return replay(raced, previewId);
	}

	try {
		const result = await fn();
		await sql`
			UPDATE perps_executions SET status = 'ok', result = ${JSON.stringify(result)}::jsonb,
				signatures = ${result.signatures || []}, finished_at = now()
			WHERE id = ${row.id}
		`;
		return result;
	} catch (err) {
		const d = describeError(err) || { status: 500, code: 'perps_failed', message: 'The perps action failed.', detail: null };
		if (err?.sent || err?.partial) {
			await sql`
				UPDATE perps_executions SET status = 'failed', error = ${JSON.stringify(d)}::jsonb,
					signatures = ${err.signatures || (err.signature ? [err.signature] : [])}, finished_at = now()
				WHERE id = ${row.id}
			`;
		} else {
			await sql`DELETE FROM perps_executions WHERE id = ${row.id}`;
		}
		throw err;
	}
}

function replay(row, previewId) {
	if (!row) throw perpsError(409, 'execution_in_progress', 'An execution with this Idempotency-Key is already running. Wait for it, then read the account.');
	if (row.preview_id !== previewId) {
		throw perpsError(422, 'idempotency_key_reused', 'This Idempotency-Key was already used for a different preview. Use a new key for a new action.');
	}
	if (row.status === 'pending') {
		throw perpsError(409, 'execution_in_progress', 'An execution with this Idempotency-Key is already running. Wait for it, then read the account.');
	}
	if (row.status === 'failed') {
		const e = row.error || {};
		throw perpsError(e.status || 502, e.code || 'perps_failed', e.message || 'This execution failed.', { ...(e.detail || {}), replayed: true });
	}
	return { ...row.result, replayed: true };
}

async function begin({ agentId, userId, previewId, action, confirm, idempotencyKey, what }) {
	requireConfirm(confirm, what);
	const key = idempotencyKeyOf(idempotencyKey);
	const agent = await loadOwnedAgent(agentId, userId);
	return { agent, key, previewId: String(previewId || ''), action };
}

/** Load the preview, resolve its venue and mode, and refuse if live was turned off since. */
async function previewContext({ agent, userId, previewId, action }) {
	const preview = await loadActionPreview(previewId, { userId, agentId: agent.id, action, hint: HINT });
	const venue = getVenue(preview.params.venue);
	const limits = getPerpsLimits(agent.meta);
	const mode = preview.params.mode;
	if (mode === 'live') {
		if (!limits.live_enabled) throw perpsError(403, 'live_disabled', 'Live perps trading was turned off for this agent after the preview, so nothing was sent.');
		await requireLiveAgreement(userId);
	}
	return { preview, venue, limits, mode };
}

// ── collateral: deposit ──────────────────────────────────────────────────────

export async function previewDeposit({ agentId, userId, venueId = DEFAULT_VENUE, mode: requested = null, amountUsd }) {
	const venue = getVenue(venueId);
	const agent = await loadOwnedAgent(agentId, userId);
	const limits = getPerpsLimits(agent.meta);
	const mode = resolveMode(limits, requested);
	const amount = parseUsd(amountUsd, 'amount_usd');
	const owner = await walletFor(agent, userId, 'perps_preview');
	const acct = await accountFor({ agent, userId, venue, mode });
	const spend = getSpendLimits(agent.meta);
	const checks = [];
	let quote;

	if (mode === 'paper') {
		const after = acct.collateral_usd + amount;
		checks.push({ id: 'paper_cap', ok: after <= PAPER_MAX_COLLATERAL_USD, label: `Paper collateral after the deposit: $${after.toFixed(2)} of $${PAPER_MAX_COLLATERAL_USD.toLocaleString('en-US')} allowed` });
		quote = {
			from: 'Paper balance (simulated, no funds move)',
			to: 'Paper perps collateral',
			amount_usd: amount,
			asset: venue.collateral.asset,
			chain: 'solana',
			collateral_before_usd: acct.collateral_usd,
			collateral_after_usd: round(after, 6),
		};
	} else {
		const balances = await getSolanaAddressBalances(owner, 'mainnet');
		checks.push(
			{ id: 'wallet_usdc', ok: balances.usdc != null && balances.usdc + 1e-9 >= amount, label: balances.usdc == null ? 'Could not read the wallet USDC balance' : `Wallet holds $${balances.usdc.toFixed(2)} USDC for a $${amount.toFixed(2)} deposit` },
			{ id: 'wallet_sol', ok: balances.sol != null && balances.sol >= MIN_SOL_FOR_FEES, label: balances.sol == null ? 'Could not read the wallet SOL balance' : `Wallet holds ${balances.sol.toFixed(4)} SOL for network fees${acct.registered ? '' : ' and the one-time trader account rent'}` },
			{ id: 'wallet_frozen', ok: !spend.frozen, label: spend.frozen ? 'The wallet is frozen' : 'The wallet is not frozen' },
		);
		if (spend.per_tx_usd != null) checks.push({ id: 'per_tx', ok: amount <= spend.per_tx_usd + 1e-9, label: `Wallet per-transaction limit: $${spend.per_tx_usd.toFixed(2)}` });
		quote = {
			from: owner,
			to: acct.trader_account,
			to_label: `${venue.label} trader account`,
			amount_usd: amount,
			asset: venue.collateral.asset,
			chain: 'solana',
			registers_account: !acct.registered,
			collateral_before_usd: acct.collateral_usd,
			collateral_after_usd: round(acct.collateral_usd + amount, 6),
			wallet: { address: owner, usdc: balances.usdc, sol: balances.sol },
		};
	}
	return storePreview({ agent, userId, venue, mode, kind: 'deposit', action: 'perps.deposit', ttlMs: FUNDS_PREVIEW_TTL_MS, params: { amount_usd: amount }, quote, checks });
}

export async function executeDeposit({ agentId, userId, previewId, confirm, idempotencyKey, req = null, source = 'owner' }) {
	const { agent, key } = await begin({ agentId, userId, previewId, confirm, idempotencyKey, what: 'deposit' });
	const { preview, venue, mode } = await previewContext({ agent, userId, previewId, action: 'perps.deposit' });
	const amount = preview.params.amount_usd;
	return onceByKey({ agent, userId, venue, mode, action: 'deposit', previewId: preview.id, key, source }, async () => {
		await consumeActionPreview(preview.id, { hint: HINT });
		try {
			if (mode === 'paper') {
				const after = await mutatePaper(agent.id, userId, venue.id, (s) => {
					if (s.collateral_usd + amount > PAPER_MAX_COLLATERAL_USD + 1e-6) {
						throw perpsError(409, 'paper_cap', `Paper collateral is capped at $${PAPER_MAX_COLLATERAL_USD.toLocaleString('en-US')}.`);
					}
					const state = { ...s, collateral_usd: s.collateral_usd + amount, deposited_usd: s.deposited_usd + amount };
					return { state, result: state.collateral_usd };
				});
				logAudit({ userId, action: 'perps.paper_deposit', resourceId: agent.id, meta: { amount_usd: amount, source }, req });
				return { ok: true, mode, action: 'deposit', amount_usd: amount, collateral_usd: round(after, 6), signatures: [], summary: `Paper deposit of $${amount.toFixed(2)}` };
			}
			return await liveDeposit({ agent, userId, venue, amount, preview, req, source });
		} catch (err) {
			if (!err?.sent) await releaseActionPreview(preview.id).catch(() => {});
			throw err;
		}
	});
}

async function liveDeposit({ agent, userId, venue, amount, preview, req, source }) {
	const owner = await walletFor(agent, userId, 'perps_deposit');
	const reservation = await reserveSpendUsd({
		agentId: agent.id,
		userId,
		meta: agent.meta,
		category: 'perps',
		usdValue: amount,
		destination: `perps-venue:${venue.id}`,
		asset: venue.collateral.asset,
		rowMeta: { perps_action: 'deposit', venue: venue.id, preview_id: preview.id, source },
	});
	const custodyId = reservation.reservationId;
	const signatures = [];
	try {
		const acct = await venue.getAccount(owner);
		if (!acct.registered) {
			const prep = await venue.prepareAccount(owner);
			if (prep.instructions.length) {
				const landed = await landInstructions({
					agentId: agent.id, userId, owner, instructions: prep.instructions, maxUsdcOutAtomic: 0n,
					reason: 'perps_register', meta: { venue: venue.id, custody_event_id: custodyId },
					submitVia: prep.cosigned_by_venue ? (tx) => venue.submitPrepare({ authority: owner, transactionBase64: tx }) : null,
				});
				signatures.push(landed.signature);
			}
		}
		const ixs = await venue.buildDeposit(owner, amount);
		const landed = await landInstructions({
			agentId: agent.id, userId, owner, instructions: ixs,
			maxUsdcOutAtomic: BigInt(Math.round(amount * 10 ** USDC_DECIMALS)),
			reason: 'perps_deposit', meta: { venue: venue.id, custody_event_id: custodyId },
		});
		signatures.push(landed.signature);
		await updateCustodyEvent(custodyId, { status: 'confirmed', signature: landed.signature, meta: { simulation: landed.simulation, signatures } }).catch(() => {});
		logAudit({ userId, action: 'custody.perps_deposit', resourceId: agent.id, meta: { amount_usd: amount, venue: venue.id, signatures, source }, req });
		return { ok: true, mode: 'live', action: 'deposit', amount_usd: amount, signature: landed.signature, explorer: landed.explorer, signatures, summary: `Deposited $${amount.toFixed(2)} ${venue.collateral.asset}` };
	} catch (err) {
		if (err?.sent) {
			await updateCustodyEvent(custodyId, { status: 'failed', signature: err.signature }).catch(() => {});
		} else {
			await releaseSpendReservation(custodyId, err?.code || 'perps_deposit_failed').catch(() => {});
		}
		logAudit({ userId, action: 'custody.perps_deposit_failed', resourceId: agent.id, meta: { amount_usd: amount, code: err?.code || null, signatures, source }, req });
		if (signatures.length) Object.assign(err, { partial: true, signatures: [...signatures, ...(err.signature ? [err.signature] : [])] });
		throw err;
	}
}

// ── collateral: withdraw ─────────────────────────────────────────────────────

export async function previewWithdraw({ agentId, userId, venueId = DEFAULT_VENUE, mode: requested = null, amountUsd }) {
	const venue = getVenue(venueId);
	const agent = await loadOwnedAgent(agentId, userId);
	const limits = getPerpsLimits(agent.meta);
	const mode = resolveMode(limits, requested);
	const owner = await walletFor(agent, userId, 'perps_preview');
	const acct = await accountFor({ agent, userId, venue, mode });
	const all = amountUsd === 'max' || amountUsd === 'all';
	const amount = all ? Math.floor((acct.withdrawable_usd || 0) * 100) / 100 : parseUsd(amountUsd, 'amount_usd');
	const checks = [
		{ id: 'withdrawable', ok: amount > 0 && amount <= (acct.withdrawable_usd || 0) + 1e-6, label: `Withdrawable now: $${Number(acct.withdrawable_usd || 0).toFixed(2)} (collateral not backing open positions)` },
	];
	if (mode === 'live') checks.push({ id: 'registered', ok: acct.registered, label: acct.registered ? 'Trader account exists' : 'No trader account yet: there is nothing to withdraw' });
	const quote = {
		from: mode === 'paper' ? 'Paper perps collateral' : acct.trader_account,
		from_label: mode === 'paper' ? null : `${venue.label} trader account`,
		to: mode === 'paper' ? 'Paper balance (simulated, no funds move)' : owner,
		amount_usd: amount,
		asset: venue.collateral.asset,
		chain: 'solana',
		collateral_before_usd: acct.collateral_usd,
		collateral_after_usd: round(acct.collateral_usd - amount, 6),
		withdrawable_usd: acct.withdrawable_usd,
	};
	return storePreview({ agent, userId, venue, mode, kind: 'withdraw', action: 'perps.withdraw', ttlMs: FUNDS_PREVIEW_TTL_MS, params: { amount_usd: amount }, quote, checks });
}

export async function executeWithdraw({ agentId, userId, previewId, confirm, idempotencyKey, req = null, source = 'owner' }) {
	const { agent, key } = await begin({ agentId, userId, previewId, confirm, idempotencyKey, what: 'withdrawal' });
	const { preview, venue, mode } = await previewContext({ agent, userId, previewId, action: 'perps.withdraw' });
	const amount = preview.params.amount_usd;
	return onceByKey({ agent, userId, venue, mode, action: 'withdraw', previewId: preview.id, key, source }, async () => {
		const acct = await accountFor({ agent, userId, venue, mode });
		if (amount > (acct.withdrawable_usd || 0) + 1e-6) {
			throw perpsError(409, 'insufficient_withdrawable', `Only $${Number(acct.withdrawable_usd || 0).toFixed(2)} is withdrawable now; the rest backs open positions.`, { withdrawable_usd: acct.withdrawable_usd });
		}
		await consumeActionPreview(preview.id, { hint: HINT });
		try {
			if (mode === 'paper') {
				const after = await mutatePaper(agent.id, userId, venue.id, (s) => {
					const state = { ...s, collateral_usd: s.collateral_usd - amount, withdrawn_usd: s.withdrawn_usd + amount };
					return { state, result: state.collateral_usd };
				});
				logAudit({ userId, action: 'perps.paper_withdraw', resourceId: agent.id, meta: { amount_usd: amount, source }, req });
				return { ok: true, mode, action: 'withdraw', amount_usd: amount, collateral_usd: round(after, 6), signatures: [], summary: `Paper withdrawal of $${amount.toFixed(2)}` };
			}
			const owner = await walletFor(agent, userId, 'perps_withdraw');
			const custodyId = await recordCustodyEvent({
				agentId: agent.id, userId, eventType: 'perps_withdraw', category: 'perps', asset: venue.collateral.asset,
				usd: amount, status: 'pending', reason: 'perps_withdraw', destination: owner, meta: { venue: venue.id, preview_id: preview.id, source },
			});
			try {
				const ixs = await venue.buildWithdraw(owner, amount);
				const landed = await landInstructions({ agentId: agent.id, userId, owner, instructions: ixs, maxUsdcOutAtomic: 0n, reason: 'perps_withdraw', meta: { venue: venue.id, custody_event_id: custodyId } });
				await updateCustodyEvent(custodyId, { status: 'confirmed', signature: landed.signature }).catch(() => {});
				logAudit({ userId, action: 'custody.perps_withdraw', resourceId: agent.id, meta: { amount_usd: amount, venue: venue.id, signature: landed.signature, source }, req });
				return { ok: true, mode, action: 'withdraw', amount_usd: amount, signature: landed.signature, explorer: landed.explorer, signatures: [landed.signature], summary: `Withdrew $${amount.toFixed(2)} ${venue.collateral.asset} to the agent wallet` };
			} catch (err) {
				await updateCustodyEvent(custodyId, { status: 'failed', signature: err?.signature ?? null }).catch(() => {});
				throw err;
			}
		} catch (err) {
			if (!err?.sent) await releaseActionPreview(preview.id).catch(() => {});
			throw err;
		}
	});
}

// ── orders ───────────────────────────────────────────────────────────────────

function parseOrderInput(input) {
	const side = String(input.side || '').toLowerCase();
	if (!SIDES.includes(side)) throw perpsError(400, 'invalid_side', 'side must be "long" or "short".');
	const type = String(input.type || 'market').toLowerCase();
	if (!ORDER_TYPES.includes(type)) throw perpsError(400, 'invalid_type', `type must be one of ${ORDER_TYPES.join(', ')}.`);
	if (!input.symbol) throw perpsError(400, 'symbol_required', 'Pass a market symbol such as SOL or BTC. perps_markets lists them.');
	return {
		symbol: String(input.symbol),
		side,
		type,
		size: parsePositive(input.size, 'size'),
		marginUsd: parsePositive(input.marginUsd, 'margin_usd'),
		leverage: parsePositive(input.leverage, 'leverage'),
		price: parsePositive(input.price, 'price'),
		triggerPrice: parsePositive(input.triggerPrice, 'trigger_price'),
		sizePercent: input.sizePercent == null ? 100 : Math.max(1, Math.min(100, Math.round(Number(input.sizePercent) || 100))),
		reduceOnly: input.reduceOnly === true,
		slippageBps: input.slippageBps == null ? null : Math.round(Number(input.slippageBps)),
	};
}

const BLOCK_CODES = {
	mode: ['live_disabled', 403],
	halted: ['perps_halted', 403],
	trade_kill_switch: ['trade_kill_switch', 403],
	wallet_frozen: ['wallet_frozen', 403],
	leverage: ['leverage_cap_exceeded', 403],
	position_margin: ['position_margin_exceeded', 403],
	free_collateral: ['insufficient_collateral', 409],
	slippage: ['slippage_too_high', 400],
	no_trader_account: ['no_trader_account', 409],
	wallet_sol: ['insufficient_sol', 409],
};

function throwBlocked(check, detail = {}) {
	const [code, status] = BLOCK_CODES[check.id] || ['perps_guard', 403];
	throw perpsError(status, code, `${check.label}. Nothing was sent.`, { check: check.id, ...detail });
}

/** Resolve the order's size from `size`, or from margin and leverage at the reference price. */
async function resolveSize(venue, o, limits) {
	if (o.size) return o.size;
	if (o.marginUsd) {
		const lev = Math.min(o.leverage || 1, limits.max_leverage);
		const market = await venue.getMarket(o.symbol);
		const ref = o.type === 'limit' && o.price ? o.price : market.mark_price;
		if (!(ref > 0)) throw perpsError(409, 'no_price', `${market.symbol} has no mark price right now; pass size instead.`);
		return (o.marginUsd * lev) / ref;
	}
	throw perpsError(400, 'size_required', 'Pass size in base units (0.5 means half a SOL on the SOL market), or margin_usd with leverage.');
}

async function quoteFor({ venue, o, acct, limits }) {
	if (o.type === 'take_profit' || o.type === 'stop_loss') return quoteTrigger({ venue, o, acct });
	const slippageBps = o.slippageBps ?? limits.max_slippage_bps;
	return venue.quoteOrder({
		symbol: o.symbol, side: o.side, size: o.size, type: o.type, price: o.price,
		reduceOnly: o.reduceOnly, slippageBps, account: acct,
	});
}

/** Quote a take-profit or stop-loss on the open position (never risk-increasing). */
async function quoteTrigger({ venue, o, acct }) {
	const market = await venue.getMarket(o.symbol);
	const pos = acct.positions.find((p) => p.symbol === market.symbol);
	if (!pos) throw perpsError(409, 'no_position', `There is no open ${market.symbol} position to attach a ${o.type.replace('_', '-')} to.`);
	if (!o.triggerPrice) throw perpsError(400, 'trigger_price_required', `A ${o.type.replace('_', '-')} needs trigger_price.`);
	const isLong = pos.side === 'long';
	const mark = market.mark_price;
	const above = o.triggerPrice > mark;
	const wantAbove = (o.type === 'take_profit') === isLong;
	if (above !== wantAbove) {
		throw perpsError(400, 'trigger_wrong_side', `A ${o.type.replace('_', '-')} on a ${pos.side} must trigger ${wantAbove ? 'above' : 'below'} the mark ($${mark}).`, { mark_price: mark, side: pos.side });
	}
	const size = pos.size * (o.sizePercent / 100);
	const pnl = (isLong ? 1 : -1) * size * (o.triggerPrice - pos.entry_price);
	return {
		symbol: market.symbol,
		side: isLong ? 'short' : 'long',
		type: o.type,
		reduce_only: true,
		size: round(size, 10),
		size_percent: o.sizePercent,
		trigger_price: o.triggerPrice,
		mark_price: mark,
		entry_price: pos.entry_price,
		position: { side: pos.side, size: pos.size, entry_price: pos.entry_price, liquidation_price: pos.liquidation_price },
		direction: wantAbove ? 'greater_than' : 'less_than',
		expected_pnl_at_trigger_usd: round(pnl, 4),
		fee_usd: round(size * o.triggerPrice * (market.taker_fee_rate || 0), 6),
		market_max_leverage: market.max_leverage,
		risk_increasing: false,
		liquidation_price: pos.liquidation_price,
	};
}

export async function previewOrder({ agentId, userId, venueId = DEFAULT_VENUE, mode: requested = null, ...input }) {
	const venue = getVenue(venueId);
	const agent = await loadOwnedAgent(agentId, userId);
	const limits = getPerpsLimits(agent.meta);
	const mode = resolveMode(limits, requested);
	const o = parseOrderInput(input);
	if (o.type === 'market' || o.type === 'limit') o.size = await resolveSize(venue, o, limits);
	if (o.type === 'limit' && !o.price) throw perpsError(400, 'price_required', 'A limit order needs price.');
	const acct = await accountFor({ agent, userId, venue, mode, reason: 'perps_preview' });
	const quote = await quoteFor({ venue, o, acct, limits });
	const g = guardState(agent.meta);
	const guard = checkPerpsOrder({ limits, quote, tradeKill: g.trade_kill_switch, walletFrozen: g.wallet_frozen, mode });
	const checks = [...guard.checks];
	let wallet = null;
	if (mode === 'live') {
		const owner = await walletFor(agent, userId, 'perps_preview');
		const balances = await getSolanaAddressBalances(owner, 'mainnet');
		wallet = { address: owner, usdc: balances.usdc, sol: balances.sol };
		checks.push(
			{ id: 'no_trader_account', ok: acct.registered, label: acct.registered ? 'Trader account exists' : 'No trader account yet: deposit collateral first, which opens it' },
			{ id: 'wallet_sol', ok: balances.sol != null && balances.sol >= MIN_SOL_FOR_FEES, label: balances.sol == null ? 'Could not read the wallet SOL balance' : `Wallet holds ${balances.sol.toFixed(4)} SOL for network fees` },
		);
	}
	const params = {
		symbol: quote.symbol, side: o.side, type: o.type, size: quote.size, price: o.price, trigger_price: o.triggerPrice,
		size_percent: o.sizePercent, reduce_only: o.type === 'take_profit' || o.type === 'stop_loss' ? true : o.reduceOnly,
		slippage_bps: o.type === 'market' ? (o.slippageBps ?? limits.max_slippage_bps) : null,
	};
	return storePreview({
		agent, userId, venue, mode, kind: 'order', action: 'perps.order', ttlMs: ORDER_PREVIEW_TTL_MS, params,
		quote: { ...quote, leverage_cap: guard.leverage_cap, max_margin_per_position_usd: limits.max_margin_per_position_usd, max_quote_move_bps: limits.max_quote_move_bps, wallet },
		checks,
	});
}

export async function executeOrder({ agentId, userId, previewId, confirm, idempotencyKey, req = null, source = 'owner' }) {
	const { agent, key } = await begin({ agentId, userId, previewId, confirm, idempotencyKey, what: 'order' });
	const { preview, venue, limits, mode } = await previewContext({ agent, userId, previewId, action: 'perps.order' });
	const p = preview.params;
	return onceByKey({ agent, userId, venue, mode, action: 'order', previewId: preview.id, key, source }, async () => {
		const acct = await accountFor({ agent, userId, venue, mode, reason: 'perps_order' });
		const o = {
			symbol: p.symbol, side: p.side, type: p.type, size: p.size, price: p.price, triggerPrice: p.trigger_price,
			sizePercent: p.size_percent, reduceOnly: p.reduce_only, slippageBps: p.slippage_bps,
		};
		const fresh = await quoteFor({ venue, o, acct, limits });
		const moved = o.type === 'take_profit' || o.type === 'stop_loss'
			? (Math.abs((fresh.position?.size || 0) - (preview.quote.position?.size || 0)) > 1e-12
				? { reason: 'quote_moved', detail: { field: 'position_size', preview: preview.quote.position?.size, now: fresh.position?.size } }
				: null)
			: quoteMoved(preview.quote, fresh, limits.max_quote_move_bps);
		if (moved) {
			throw perpsError(409, 'quote_moved', `The market moved past your ${limits.max_quote_move_bps} bps tolerance since the preview (${moved.detail.field}), so nothing was sent. Preview again to see the new numbers.`, moved.detail);
		}
		const g = guardState(agent.meta);
		const guard = checkPerpsOrder({ limits, quote: fresh, tradeKill: g.trade_kill_switch, walletFrozen: g.wallet_frozen, mode });
		if (guard.blocked) throwBlocked(guard.blocked, { leverage_cap: guard.leverage_cap });
		if (mode === 'live' && !acct.registered) throwBlocked({ id: 'no_trader_account', label: 'No trader account yet: deposit collateral first' });

		await consumeActionPreview(preview.id, { hint: HINT });
		try {
			const result = mode === 'paper'
				? await paperOrder({ agent, userId, venue, o, quote: fresh, previewId: preview.id })
				: await liveOrder({ agent, userId, venue, o, quote: fresh, previewId: preview.id, source });
			logAudit({ userId, action: mode === 'paper' ? 'perps.paper_order' : 'custody.perps_order', resourceId: agent.id, meta: { ...p, mode, signatures: result.signatures, source }, req });
			return result;
		} catch (err) {
			if (!err?.sent) await releaseActionPreview(preview.id).catch(() => {});
			logAudit({ userId, action: 'perps.order_failed', resourceId: agent.id, meta: { ...p, mode, code: err?.code || null, source }, req });
			throw err;
		}
	});
}

function orderSummary(o, quote) {
	if (o.type === 'take_profit' || o.type === 'stop_loss') {
		return `${o.type === 'take_profit' ? 'Take-profit' : 'Stop-loss'} on ${quote.symbol} at $${quote.trigger_price} (${o.sizePercent}% of the position)`;
	}
	const verb = o.reduceOnly ? 'Reduce' : o.side === 'long' ? 'Long' : 'Short';
	return `${verb} ${quote.size} ${quote.symbol} ${o.type === 'limit' ? `limit at $${quote.limit_price}` : `at about $${quote.entry_price}`}`;
}

async function paperOrder({ agent, userId, venue, o, quote, previewId }) {
	const now = Date.now();
	const mkts = await marketMap(venue);
	return mutatePaper(agent.id, userId, venue.id, (prev) => {
		let state = settleFunding(prev, mkts, now);
		const fills = [];
		const newOrders = [];
		const orderUpdates = [];
		let fill = null;
		let resting = false;
		if (o.type === 'take_profit' || o.type === 'stop_loss') {
			for (const existing of prev.orders) {
				if (existing.symbol === quote.symbol && existing.type === o.type && existing.status === 'open') orderUpdates.push({ id: existing.id, status: 'cancelled' });
			}
			const isLong = quote.position.side === 'long';
			const slip = o.type === 'stop_loss' ? 0.03 : 0;
			const execution = isLong ? quote.trigger_price * (1 - slip) : quote.trigger_price * (1 + slip);
			newOrders.push({ symbol: quote.symbol, type: o.type, side: quote.side, price: round(execution, 8), trigger_price: quote.trigger_price, direction: quote.direction, size_percent: o.sizePercent, reduce_only: true, preview_id: previewId });
			resting = true;
		} else {
			if (o.type === 'market' || quote.crosses_book) {
				const delta = o.side === 'long' ? quote.size : -quote.size;
				const out = applyFill(state, { symbol: quote.symbol, delta, price: quote.entry_price, feeUsd: quote.fee_usd, reason: 'order', previewId });
				state = out.state;
				fill = out.fill;
				fills.push(fill);
			} else {
				newOrders.push({ symbol: quote.symbol, type: 'limit', side: o.side, size: quote.size, price: quote.limit_price, reduce_only: o.reduceOnly, preview_id: previewId });
				resting = true;
			}
		}
		const acct = buildPaperAccount(state, mkts, now);
		const position = acct.positions.find((x) => x.symbol === quote.symbol) || null;
		return {
			state,
			fills,
			newOrders,
			orderUpdates,
			result: {
				ok: true,
				mode: 'paper',
				action: 'order',
				status: resting ? 'resting' : 'filled',
				symbol: quote.symbol,
				side: o.side,
				type: o.type,
				size: quote.size,
				fill,
				position,
				account: summarize(acct),
				signatures: [],
				summary: orderSummary(o, quote),
			},
		};
	});
}

async function liveOrder({ agent, userId, venue, o, quote, previewId, source }) {
	const owner = await walletFor(agent, userId, 'perps_order');
	let instructions;
	let trigger = null;
	if (o.type === 'take_profit' || o.type === 'stop_loss') {
		trigger = await venue.buildConditional(owner, { symbol: quote.symbol, kind: o.type, triggerPrice: quote.trigger_price, position: quote.position, sizePercent: o.sizePercent });
		instructions = trigger.instructions;
	} else {
		instructions = await venue.buildOrder(owner, quote);
	}
	const custodyId = await recordCustodyEvent({
		agentId: agent.id, userId, eventType: 'perps_order', category: 'perps', asset: venue.collateral.asset,
		usd: quote.notional_usd ?? null, status: 'pending', reason: `perps_${o.type}`, destination: `perps-venue:${venue.id}`,
		meta: { venue: venue.id, symbol: quote.symbol, side: o.side, type: o.type, size: quote.size, preview_id: previewId, source },
	});
	try {
		const landed = await landInstructions({ agentId: agent.id, userId, owner, instructions, maxUsdcOutAtomic: 0n, reason: 'perps_order', meta: { venue: venue.id, custody_event_id: custodyId } });
		await updateCustodyEvent(custodyId, { status: 'confirmed', signature: landed.signature, meta: { simulation: landed.simulation } }).catch(() => {});
		const acct = await venue.getAccount(owner).catch(() => null);
		return {
			ok: true,
			mode: 'live',
			action: 'order',
			status: o.type === 'market' ? 'submitted' : 'resting',
			symbol: quote.symbol,
			side: o.side,
			type: o.type,
			size: quote.size,
			trigger: trigger ? { trigger_price: trigger.trigger_price, execution_price: trigger.execution_price } : null,
			signature: landed.signature,
			explorer: landed.explorer,
			signatures: [landed.signature],
			position: acct?.positions.find((x) => x.symbol === quote.symbol) || null,
			account: acct ? summarize(acct) : null,
			summary: orderSummary(o, quote),
		};
	} catch (err) {
		await updateCustodyEvent(custodyId, { status: 'failed', signature: err?.signature ?? null }).catch(() => {});
		throw err;
	}
}

// ── cancel ───────────────────────────────────────────────────────────────────

function findCancellable(acct, orderId, kind) {
	const id = String(orderId || '');
	if (!id) throw perpsError(400, 'order_id_required', 'Pass order_id. perps_positions lists open orders and triggers with their ids.');
	const orders = (!kind || kind === 'limit') ? acct.orders.filter((x) => x.id === id).map((x) => ({ ...x, kind: 'limit' })) : [];
	const triggers = (!kind || kind === 'take_profit' || kind === 'stop_loss')
		? acct.conditionals.filter((x) => x.id === id && (!kind || x.kind === kind) && x.cancellable !== false)
		: [];
	const found = [...orders, ...triggers];
	if (!found.length) throw perpsError(404, 'order_not_found', 'No open order or trigger with that id on this agent.');
	if (found.length > 1) throw perpsError(400, 'order_ambiguous', 'That id matches more than one open order; pass kind (limit, take_profit or stop_loss) too.');
	return found[0];
}

export async function previewCancel({ agentId, userId, venueId = DEFAULT_VENUE, mode: requested = null, orderId, kind = null }) {
	const venue = getVenue(venueId);
	const agent = await loadOwnedAgent(agentId, userId);
	const limits = getPerpsLimits(agent.meta);
	const mode = resolveMode(limits, requested);
	const acct = await accountFor({ agent, userId, venue, mode });
	const target = findCancellable(acct, orderId, kind);
	return storePreview({
		agent, userId, venue, mode, kind: 'cancel', action: 'perps.cancel', ttlMs: FUNDS_PREVIEW_TTL_MS,
		params: { order_id: target.id, kind: target.kind, symbol: target.symbol },
		quote: { order: target },
		checks: [{ id: 'open', ok: true, label: 'The order is still open' }],
	});
}

export async function executeCancel({ agentId, userId, previewId, confirm, idempotencyKey, req = null, source = 'owner' }) {
	const { agent, key } = await begin({ agentId, userId, previewId, confirm, idempotencyKey, what: 'cancel' });
	const { preview, venue, mode } = await previewContext({ agent, userId, previewId, action: 'perps.cancel' });
	const p = preview.params;
	return onceByKey({ agent, userId, venue, mode, action: 'cancel', previewId: preview.id, key, source }, async () => {
		const acct = await accountFor({ agent, userId, venue, mode });
		const target = findCancellable(acct, p.order_id, p.kind);
		await consumeActionPreview(preview.id, { hint: HINT });
		try {
			let signatures = [];
			if (mode === 'paper') {
				await mutatePaper(agent.id, userId, venue.id, (s) => ({
					state: { ...s, orders: s.orders.filter((x) => String(x.id) !== target.id) },
					orderUpdates: [{ id: Number(target.id), status: 'cancelled' }],
					result: true,
				}));
			} else {
				const owner = await walletFor(agent, userId, 'perps_cancel');
				const ixs = await cancelInstructions(venue, owner, target);
				const landed = await landInstructions({ agentId: agent.id, userId, owner, instructions: ixs, maxUsdcOutAtomic: 0n, reason: 'perps_cancel', meta: { venue: venue.id } });
				signatures = [landed.signature];
			}
			logAudit({ userId, action: mode === 'paper' ? 'perps.paper_cancel' : 'custody.perps_cancel', resourceId: agent.id, meta: { ...p, signatures, source }, req });
			return { ok: true, mode, action: 'cancel', order: target, signatures, signature: signatures[0] || null, explorer: signatures[0] ? explorer(signatures[0]) : null, summary: `Cancelled ${target.kind.replace('_', '-')} ${target.id} on ${target.symbol}` };
		} catch (err) {
			if (!err?.sent) await releaseActionPreview(preview.id).catch(() => {});
			throw err;
		}
	});
}

async function cancelInstructions(venue, owner, target) {
	if (target.kind === 'limit') return venue.buildCancel(owner, { symbol: target.symbol, orderId: target.id, priceTicks: target.price_ticks });
	// A trigger that closes a long sells; its direction follows from kind and side.
	const closesLong = target.side === 'sell' || target.side === 'short';
	const greater = (target.kind === 'take_profit') === closesLong;
	return venue.buildCancelConditional(owner, { symbol: target.symbol, conditionalId: target.id, direction: target.direction || (greater ? 'greater_than' : 'less_than') });
}

// ── kill switch: flatten everything ──────────────────────────────────────────

export async function previewFlatten({ agentId, userId, venueId = DEFAULT_VENUE, mode: requested = null }) {
	const venue = getVenue(venueId);
	const agent = await loadOwnedAgent(agentId, userId);
	const limits = getPerpsLimits(agent.meta);
	const mode = resolveMode(limits, requested);
	const acct = await accountFor({ agent, userId, venue, mode });
	const slippageBps = Math.max(limits.max_slippage_bps, 300);
	const closes = [];
	for (const pos of acct.positions) {
		try {
			const q = await venue.quoteOrder({ symbol: pos.symbol, side: pos.side === 'long' ? 'short' : 'long', size: pos.size, type: 'market', reduceOnly: true, slippageBps, account: acct });
			closes.push({ symbol: pos.symbol, side: pos.side, size: pos.size, expected_exit_price: q.entry_price, expected_pnl_usd: round((pos.side === 'long' ? 1 : -1) * pos.size * (q.entry_price - pos.entry_price) - q.fee_usd, 4), fee_usd: q.fee_usd });
		} catch (err) {
			closes.push({ symbol: pos.symbol, side: pos.side, size: pos.size, error: describeError(err)?.message || 'Could not quote this close right now.' });
		}
	}
	const quote = {
		halts_trading: true,
		positions_to_close: closes,
		orders_to_cancel: acct.orders.length,
		triggers_to_cancel: acct.conditionals.filter((c) => c.cancellable !== false).length,
		slippage_bps: slippageBps,
		expected_total_pnl_usd: round(closes.reduce((s, c) => s + (c.expected_pnl_usd || 0), 0), 4),
	};
	return storePreview({
		agent, userId, venue, mode, kind: 'flatten', action: 'perps.flatten', ttlMs: ORDER_PREVIEW_TTL_MS,
		params: { slippage_bps: slippageBps },
		quote,
		checks: [{ id: 'kill_switch', ok: true, label: 'Turns the perps kill switch on: only reduce-only orders run until you resume' }],
	});
}

export async function executeFlatten({ agentId, userId, previewId, confirm, idempotencyKey, req = null, source = 'owner' }) {
	const { agent, key } = await begin({ agentId, userId, previewId, confirm, idempotencyKey, what: 'flatten' });
	const preview = await loadActionPreview(previewId, { userId, agentId: agent.id, action: 'perps.flatten', hint: HINT });
	const venue = getVenue(preview.params.venue);
	const mode = preview.params.mode;
	if (mode === 'live') await requireLiveAgreement(userId);
	return onceByKey({ agent, userId, venue, mode, action: 'flatten', previewId: preview.id, key, source }, async () => {
		await consumeActionPreview(preview.id, { hint: HINT });
		// The halt lands first and stays on whatever happens next.
		await setPerpsLimits(agent.id, userId, { halted: true }, { req, reason: 'perps_kill_switch' });
		const slippageBps = preview.params.slippage_bps;
		const result = mode === 'paper'
			? await paperFlatten({ agent, userId, venue, slippageBps })
			: await liveFlatten({ agent, userId, venue, slippageBps });
		logAudit({ userId, action: mode === 'paper' ? 'perps.paper_flatten' : 'custody.perps_flatten', resourceId: agent.id, meta: { steps: result.steps.map((s) => ({ step: s.step, ok: s.ok })), source }, req });
		return result;
	});
}

async function paperFlatten({ agent, userId, venue, slippageBps }) {
	const acct = await syncPaper(agent.id, userId, venue);
	const quotes = new Map();
	for (const pos of acct.positions) {
		quotes.set(pos.symbol, await venue.quoteOrder({ symbol: pos.symbol, side: pos.side === 'long' ? 'short' : 'long', size: pos.size, type: 'market', reduceOnly: true, slippageBps, account: acct }));
	}
	const mkts = await marketMap(venue);
	return mutatePaper(agent.id, userId, venue.id, (prev) => {
		const now = Date.now();
		let state = settleFunding(prev, mkts, now);
		const fills = [];
		const steps = [];
		const orderUpdates = prev.orders.filter((x) => x.status === 'open').map((x) => ({ id: x.id, status: 'cancelled' }));
		steps.push({ step: 'cancel_orders', ok: true, count: orderUpdates.length });
		for (const [symbol, p] of prev.positions) {
			if (Math.abs(p.signed_size) < 1e-12) continue;
			const q = quotes.get(symbol);
			const m = mkts.get(symbol);
			const price = q?.entry_price ?? m?.mark_price ?? p.entry_price;
			const size = Math.abs(p.signed_size);
			const out = applyFill(state, { symbol, delta: -p.signed_size, price, feeUsd: q?.fee_usd ?? size * price * (m?.taker_fee_rate || 0), reason: 'flatten' });
			state = out.state;
			fills.push(out.fill);
			steps.push({ step: `close_${symbol}`, ok: true, symbol, fill: out.fill });
		}
		state = { ...state, orders: [] };
		const after = buildPaperAccount(state, mkts, now);
		return { state, fills, orderUpdates, result: { ok: true, mode: 'paper', action: 'flatten', halted: true, steps, account: summarize(after), signatures: [], summary: `Flattened ${fills.length} paper position(s) and halted perps trading` } };
	});
}

async function liveFlatten({ agent, userId, venue, slippageBps }) {
	const owner = await walletFor(agent, userId, 'perps_flatten');
	const steps = [];
	const signatures = [];
	let acct = await venue.getAccount(owner);
	const cancellable = [
		...acct.orders.map((x) => ({ ...x, kind: 'limit' })),
		...acct.conditionals.filter((c) => c.cancellable !== false),
	];
	// Cancels go in small batches so each transaction stays well under size limits.
	for (let i = 0; i < cancellable.length; i += 4) {
		const batch = cancellable.slice(i, i + 4);
		try {
			const ixs = (await Promise.all(batch.map((t) => cancelInstructions(venue, owner, t)))).flat();
			const landed = await landInstructions({ agentId: agent.id, userId, owner, instructions: ixs, maxUsdcOutAtomic: 0n, reason: 'perps_flatten', meta: { venue: venue.id } });
			signatures.push(landed.signature);
			steps.push({ step: 'cancel_orders', ok: true, count: batch.length, signature: landed.signature, explorer: landed.explorer });
		} catch (err) {
			if (err?.signature) signatures.push(err.signature);
			steps.push({ step: 'cancel_orders', ok: false, count: batch.length, error: describeError(err)?.message || String(err?.message || err) });
		}
	}
	if (cancellable.length) acct = await venue.getAccount(owner);
	for (const pos of acct.positions) {
		try {
			const q = await venue.quoteOrder({ symbol: pos.symbol, side: pos.side === 'long' ? 'short' : 'long', size: pos.size, type: 'market', reduceOnly: true, slippageBps, account: acct });
			const ixs = await venue.buildOrder(owner, q);
			const landed = await landInstructions({ agentId: agent.id, userId, owner, instructions: ixs, maxUsdcOutAtomic: 0n, reason: 'perps_flatten', meta: { venue: venue.id, symbol: pos.symbol } });
			signatures.push(landed.signature);
			steps.push({ step: `close_${pos.symbol}`, ok: true, symbol: pos.symbol, size: pos.size, signature: landed.signature, explorer: landed.explorer });
		} catch (err) {
			if (err?.signature) signatures.push(err.signature);
			steps.push({ step: `close_${pos.symbol}`, ok: false, symbol: pos.symbol, error: describeError(err)?.message || String(err?.message || err) });
		}
	}
	await recordCustodyEvent({ agentId: agent.id, userId, eventType: 'perps_flatten', category: 'perps', status: steps.every((s) => s.ok) ? 'confirmed' : 'failed', reason: 'perps_kill_switch', meta: { venue: venue.id, steps, signatures } }).catch(() => {});
	const after = await venue.getAccount(owner).catch(() => null);
	const failed = steps.filter((s) => !s.ok);
	return {
		ok: failed.length === 0,
		mode: 'live',
		action: 'flatten',
		halted: true,
		steps,
		signatures,
		account: after ? summarize(after) : null,
		summary: failed.length ? `Halted perps trading; ${failed.length} step(s) failed and need a retry` : `Flattened ${acct.positions.length} position(s) and halted perps trading`,
	};
}

// ── preview storage ──────────────────────────────────────────────────────────

async function storePreview({ agent, userId, venue, mode, kind, action, ttlMs, params, quote, checks }) {
	const blocked = checks.filter((c) => !c.ok).map((c) => c.id);
	const fullParams = { ...params, venue: venue.id, mode };
	const { preview_id, expires_at } = await createActionPreview({ userId, agentId: agent.id, action, prefix: PREFIX, params: fullParams, quote, ttlMs });
	return {
		preview_id,
		expires_at,
		kind,
		mode,
		venue: venue.id,
		chain: 'solana',
		agent: { id: agent.id, name: agent.name },
		...quote,
		checks,
		blocked_by: blocked,
		executable: blocked.length === 0,
		confirm_with: { confirm_trade: true, preview_id },
	};
}

export { loadPaperState };

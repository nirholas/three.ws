// Lending service: the one path every lending action takes, from the v1 routes,
// the MCP tools and the agent wallet page alike.
//
// Reads (markets, positions) touch only chain state. Deposit and withdraw run in
// two stages on one call:
//
//   confirm omitted/false  PREVIEW. Builds the venue instructions, simulates them
//                          against current mainnet state, runs every guard and
//                          returns what would happen. Nothing is signed or sent.
//   confirm: true          EXECUTE. Re-runs the preview, refuses unless every check
//                          and the bounded simulation passed, reserves the spend
//                          against the wallet policy (deposits), signs with the
//                          agent wallet, sends and waits for confirmation.
//
// Guards, in order: the agent belongs to the caller, the wallet is not frozen, the
// agent wallet holds a platform key, the amount fits the wallet and the venue
// capacity, the wallet-wide spend policy (per-transaction and daily USD caps,
// rules, anomaly guard) on deposits, and a simulation bounded to the confirmed
// token amount plus network fees. A withdraw always comes home to the agent's own
// wallet, so only the position and health factor bound it.

import { PublicKey, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } from '@solana/web3.js';
import { sql } from '../db.js';
import { logAudit } from '../audit.js';
import { ensureAgentWallet, recoverSolanaAgentKeypair } from '../agent-wallet.js';
import { confirmOrThrow } from '../solana/confirm.js';
import { getSpendLimits, reserveSpendUsd, releaseSpendReservation, updateCustodyEvent, SpendLimitError } from '../agent-trade-guards.js';
import { LendingError } from './errors.js';
import { getVenue, listVenues, DEFAULT_VENUE } from './index.js';
import { lendingConnection, ataFor, decodeTokenAmount, liquidBalanceRaw, WSOL_MINT } from './rpc.js';
import {
	parseAmount, formatRaw, rawToUi, usd, projectInterest, checkWithdraw, planEarn, withdrawKeepsHealth, U64_MAX, HEALTH_FLOOR,
} from './math.js';

const SPEND_CATEGORY = 'lending';
const PRIORITY_MICROLAMPORTS = 50_000;
const MAX_COMPUTE_UNITS = 1_400_000;
// SOL a lending transaction may spend beyond the confirmed amount: network and
// priority fees plus the one-time rent for the obligation and token accounts.
const MAX_LAMPORTS_OVERHEAD = 12_000_000;
const MIN_SOL_FOR_FEES = 0.004;
const ROUNDING_RAW = 2n;

export const EARN_MODES = ['deposit_idle', 'withdraw_below'];

const explorer = (sig) => `https://solscan.io/tx/${sig}`;

/** Map any lending-stack failure to { status, code, message, detail } for a boundary. */
export function describeError(err) {
	if (err instanceof LendingError || err instanceof SpendLimitError) {
		return { status: err.status || 400, code: err.code, message: err.message, detail: err.detail || null };
	}
	return null;
}

// agent and wallet

/** Load an agent the user owns. Throws 404 / 403. */
export async function loadOwnedAgent(agentId, userId) {
	const [row] = await sql`SELECT id, user_id, name, meta FROM agent_identities WHERE id = ${agentId} AND deleted_at IS NULL`;
	if (!row) throw new LendingError('not_found', 'No agent with that id.', 404);
	if (row.user_id !== userId) throw new LendingError('forbidden', "That agent isn't on your account.", 403);
	return row;
}

async function walletFor(agent, userId, reason) {
	const { address } = await ensureAgentWallet(agent.id, userId, { reason });
	return address;
}

/** Resolve a symbol ("USDC") or mint to the venue's canonical market row. */
export async function resolveToken(venue, token) {
	const key = String(token ?? '').trim();
	if (!key) throw new LendingError('invalid_token', 'token is required: a symbol such as "USDC" or a mint address.', 400, { parameter: 'token' });
	if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(key)) return venue.getReserve(key);
	const { markets: rows } = await venue.listMarkets();
	const row = rows.find((m) => String(m.symbol).toUpperCase() === key.toUpperCase());
	if (!row) {
		throw new LendingError('unsupported_token', `No lending market for "${key}". List markets to see what can be supplied.`, 404, { token: key, available: rows.map((m) => m.symbol) });
	}
	return row;
}

// reads

export function markets({ venueId } = {}) {
	return getVenue(venueId).listMarkets();
}

export { listVenues };

function supplied(position, mint) {
	const d = position?.deposits?.find((p) => p.mint === mint);
	return d ? BigInt(d.amount_raw) : 0n;
}

/**
 * The agent's lending position, with APY and projected yearly interest per
 * deposit, and the live earn plan if a rule is set. A wallet that never lent
 * returns an empty position, not an error.
 */
export async function positions({ agentId, userId, venueId }) {
	const venue = getVenue(venueId);
	const agent = await loadOwnedAgent(agentId, userId);
	const wallet = await walletFor(agent, userId, 'lending_read');
	const [position, market] = await Promise.all([venue.getPosition(wallet), venue.listMarkets()]);
	const byMint = new Map(market.markets.map((m) => [m.mint, m]));
	const deposits = (position?.deposits || []).map((d) => {
		const m = byMint.get(d.mint);
		const proj = m && d.amount > 0 ? projectInterest(d.amount, m.supply_apy) : null;
		return { ...d, supply_apy: m?.supply_apy ?? null, projected_yearly: proj ? proj.per_year : null, projected_yearly_usd: proj && m?.price_usd != null ? usd(proj.per_year * m.price_usd) : null };
	});
	const rule = getEarnRule(agent.meta);
	const earn_plan = rule?.enabled ? await earnPlan({ wallet, rule, position, market }) : null;
	return {
		venue: venue.id, venue_name: venue.name, market: venue.market, wallet,
		has_position: Boolean(position), obligation: position?.obligation || null,
		deposits, borrows: position?.borrows || [], stats: position?.stats || null,
		health_floor: HEALTH_FLOOR, earn_rule: rule, earn_plan,
	};
}

// earn rule

export function getEarnRule(meta) {
	const r = meta?.lending_earn_rule;
	return r && typeof r === 'object' ? r : null;
}

function uiToRaw(value, decimals, name) {
	if (value == null || value === '' || Number(value) === 0) return 0n;
	return parseAmount(value, decimals, { name });
}

async function storeRule(agentId, stored) {
	await sql`UPDATE agent_identities SET meta = jsonb_set(coalesce(meta, '{}'::jsonb), '{lending_earn_rule}', ${JSON.stringify(stored)}::jsonb) WHERE id = ${agentId}`;
}

/** Validate and store the agent's earn rule. Owner-only. */
export async function setEarnRule({ agentId, userId, rule, req = null }) {
	const agent = await loadOwnedAgent(agentId, userId);
	if (rule == null || typeof rule !== 'object') throw new LendingError('invalid_rule', 'Send an earn rule object.', 400);
	if (rule.enabled === false && !rule.token) {
		const stored = { ...(getEarnRule(agent.meta) || {}), enabled: false, updated_at: new Date().toISOString() };
		await storeRule(agent.id, stored);
		logAudit({ userId, action: 'lending.earn_rule_disabled', resourceId: agent.id, meta: {}, req });
		return stored;
	}
	const venue = getVenue(rule.venue);
	if (!EARN_MODES.includes(rule.mode)) throw new LendingError('invalid_mode', `mode must be one of ${EARN_MODES.join(', ')}.`, 400, { parameter: 'mode' });
	const row = await resolveToken(venue, rule.token);
	const reserve = rule.mode === 'deposit_idle' ? String(rule.reserve ?? '0') : '0';
	const floor = rule.mode === 'withdraw_below' ? String(rule.floor ?? '0') : '0';
	const minMove = String(rule.min_move ?? '0');
	uiToRaw(reserve, row.decimals, 'reserve');
	uiToRaw(minMove, row.decimals, 'min_move');
	if (rule.mode === 'withdraw_below' && uiToRaw(floor, row.decimals, 'floor') <= 0n) {
		throw new LendingError('invalid_rule', 'withdraw_below needs a floor greater than zero: the wallet balance to keep topped up.', 400, { parameter: 'floor' });
	}
	const stored = {
		enabled: rule.enabled !== false, venue: venue.id, token: row.symbol, mint: row.mint, mode: rule.mode,
		reserve, floor, min_move: minMove, updated_at: new Date().toISOString(),
	};
	await storeRule(agent.id, stored);
	logAudit({ userId, action: 'lending.earn_rule_set', resourceId: agent.id, meta: { token: row.symbol, mode: rule.mode, reserve, floor }, req });
	return stored;
}

async function earnPlan({ wallet, rule, position, market }) {
	const row = market.markets.find((m) => m.mint === rule.mint);
	if (!row) return { action: 'none', reason: 'the token no longer has an active lending market' };
	const balanceRaw = await liquidBalanceRaw(wallet, row.mint);
	const have = supplied(position, row.mint);
	const plan = planEarn({
		mode: rule.mode, balanceRaw, suppliedRaw: have,
		reserveRaw: uiToRaw(rule.reserve, row.decimals, 'reserve'), floorRaw: uiToRaw(rule.floor, row.decimals, 'floor'),
		minMoveRaw: uiToRaw(rule.min_move, row.decimals, 'min_move'),
		feeHeadroomRaw: row.mint === WSOL_MINT ? BigInt(MAX_LAMPORTS_OVERHEAD) : 0n,
	});
	if (plan.action === 'withdraw' && position?.stats && position.borrows.length) {
		const h = withdrawKeepsHealth({
			liquidationLimitUsd: position.stats.liquidation_limit_usd, debtAdjustedUsd: position.stats.borrowed_usd,
			liquidationThreshold: row.risk?.liquidation_threshold ?? 0,
			withdrawUsd: rawToUi(plan.all ? have : plan.amountRaw, row.decimals) * (row.price_usd || 0),
		});
		if (!h.ok) return { action: 'none', token: row.symbol, reason: `withdrawing would drop the health factor to ${h.healthAfter.toFixed(2)}, under the ${HEALTH_FLOOR} floor` };
	}
	return {
		action: plan.action, token: row.symbol, all: Boolean(plan.all), reason: plan.reason,
		amount: plan.action === 'none' ? '0' : formatRaw(plan.all ? have : plan.amountRaw, row.decimals),
	};
}

// transaction build, simulate, land

export async function lookupTables(conn, addresses) {
	const out = [];
	for (const a of addresses || []) {
		const { value } = await conn.getAddressLookupTable(new PublicKey(a));
		if (value) out.push(value);
	}
	return out;
}

export async function compile(conn, owner, instructions, tables, units) {
	const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
	const message = new TransactionMessage({
		payerKey: new PublicKey(owner),
		recentBlockhash: blockhash,
		instructions: [
			ComputeBudgetProgram.setComputeUnitLimit({ units }),
			ComputeBudgetProgram.setComputeUnitPrice({ microLamports: PRIORITY_MICROLAMPORTS }),
			...instructions.filter((ix) => !ix.programId.equals(ComputeBudgetProgram.programId)),
		],
	}).compileToV0Message(tables);
	return { vtx: new VersionedTransaction(message), blockhash, lastValidBlockHeight };
}

/**
 * Simulate against current chain state and measure what the wallet's token and
 * SOL balances do. A failed simulation is reported, not thrown: the preview
 * shows it and execute refuses on it.
 */
export async function simulateBounded({ conn, vtx, owner, mint }) {
	const ownerKey = new PublicKey(owner);
	const ata = ataFor(owner, mint);
	const [preLamports, preToken] = await Promise.all([conn.getBalance(ownerKey, 'confirmed'), liquidBalanceRaw(owner, mint, conn)]);
	let sim;
	try {
		sim = await conn.simulateTransaction(vtx, {
			sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed',
			accounts: { encoding: 'base64', addresses: [ownerKey.toBase58(), ata.toBase58()] },
		});
	} catch (err) {
		throw new LendingError('simulation_unavailable', 'Could not simulate the transaction against Solana, so nothing was sent. Try again.', 503, { message: String(err?.message || err).slice(0, 200) });
	}
	const v = sim?.value;
	if (v?.err) return { ok: false, error: v.err, logs: (v.logs || []).slice(-8), units: v.unitsConsumed ?? null, token_out_raw: 0n, lamports_out: 0 };
	const postLamports = v?.accounts?.[0]?.lamports ?? preLamports;
	const native = mint === WSOL_MINT;
	const postToken = native ? BigInt(postLamports) : v?.accounts?.[1] ? decodeTokenAmount(v.accounts[1]) : preToken;
	const preBase = native ? BigInt(preLamports) : preToken;
	return { ok: true, error: null, logs: (v.logs || []).slice(-8), units: v?.unitsConsumed ?? null, token_out_raw: preBase - postToken, lamports_out: preLamports - postLamports };
}

async function agentKeypair(agentId, userId, reason, meta) {
	const [row] = await sql`SELECT meta FROM agent_identities WHERE id = ${agentId} AND deleted_at IS NULL`;
	const secret = row?.meta?.encrypted_solana_secret;
	if (!secret) {
		throw new LendingError('wallet_unsignable', 'This agent wallet has no platform-held key (it is self-custodied or not yet provisioned), so the platform cannot sign lending transactions for it.', 409);
	}
	return recoverSolanaAgentKeypair(secret, { agentId, userId, reason, meta });
}

const num = (n) => (n == null || !Number.isFinite(Number(n)) ? null : Number(n));

/**
 * Preview, or with confirm: true execute, a deposit or withdraw.
 * @param {'deposit'|'withdraw'} kind
 */
async function act(kind, { agentId, userId, venueId, token, amount, all = false, confirm = false, req = null, source = 'owner' }) {
	const venue = getVenue(venueId);
	const agent = await loadOwnedAgent(agentId, userId);
	const spend = getSpendLimits(agent.meta);
	const wallet = await walletFor(agent, userId, `lending_${kind}_preview`);
	const row = await resolveToken(venue, token);
	const conn = lendingConnection();
	const checks = [];
	const check = (id, ok, label) => checks.push({ id, ok, label });

	let amountRaw;
	let isAll = false;
	let position = null;
	if (kind === 'withdraw') {
		position = await venue.getPosition(wallet);
		const have = supplied(position, row.mint);
		if (all === true) {
			if (have <= 0n) throw new LendingError('no_position', `This agent has no ${row.symbol} supplied, so there is nothing to withdraw.`, 422, { supplied: '0' });
			amountRaw = U64_MAX;
			isAll = true;
		} else {
			const w = checkWithdraw({ requestedRaw: parseAmount(amount, row.decimals), suppliedRaw: have, decimals: row.decimals, symbol: row.symbol });
			amountRaw = w.amountRaw;
			isAll = w.all;
		}
		check('position', true, `Position holds ${formatRaw(have, row.decimals)} ${row.symbol}`);
	} else {
		amountRaw = parseAmount(amount, row.decimals);
		if (row.deposit_capacity_remaining != null && rawToUi(amountRaw, row.decimals) > row.deposit_capacity_remaining) {
			throw new LendingError('deposit_capacity', `The ${row.symbol} market can take at most ${row.deposit_capacity_remaining} more right now.`, 422, { remaining: row.deposit_capacity_remaining });
		}
	}

	const effectiveRaw = isAll ? supplied(position, row.mint) : amountRaw;
	const amountUi = rawToUi(effectiveRaw, row.decimals);
	const amountUsd = row.price_usd != null ? usd(amountUi * row.price_usd) : null;

	const [liquid, lamports] = await Promise.all([liquidBalanceRaw(wallet, row.mint, conn), conn.getBalance(new PublicKey(wallet), 'confirmed')]);
	check('wallet_frozen', !spend.frozen, spend.frozen ? 'The wallet is frozen' : 'The wallet is not frozen');
	check('wallet_sol', lamports / 1e9 >= MIN_SOL_FOR_FEES, `Wallet holds ${(lamports / 1e9).toFixed(4)} SOL for network fees`);
	if (kind === 'deposit') {
		check('wallet_balance', liquid >= amountRaw, `Wallet holds ${formatRaw(liquid, row.decimals)} ${row.symbol} for a ${formatRaw(amountRaw, row.decimals)} deposit`);
		if (amountUsd == null) check('price', false, `No oracle price for ${row.symbol}, so the spend cannot be valued against your limits`);
		else if (spend.per_tx_usd != null) check('per_tx', amountUsd <= spend.per_tx_usd + 1e-9, `Wallet per-transaction limit: $${spend.per_tx_usd.toFixed(2)}`);
	} else if (position?.borrows?.length && position.stats) {
		const h = withdrawKeepsHealth({ liquidationLimitUsd: position.stats.liquidation_limit_usd, debtAdjustedUsd: position.stats.borrowed_usd, liquidationThreshold: row.risk?.liquidation_threshold ?? 0, withdrawUsd: amountUsd ?? 0 });
		check('health', h.ok, `Health factor after: ${h.healthAfter == null ? 'n/a' : h.healthAfter.toFixed(2)} (floor ${HEALTH_FLOOR})`);
	}

	const built = kind === 'deposit' ? await venue.buildDeposit({ owner: wallet, reserve: row.reserve, amountRaw }) : await venue.buildWithdraw({ owner: wallet, reserve: row.reserve, amountRaw });
	const tables = await lookupTables(conn, built.lookup_table_addresses);
	const draft = await compile(conn, wallet, built.instructions, tables, MAX_COMPUTE_UNITS);
	const sim = await simulateBounded({ conn, vtx: draft.vtx, owner: wallet, mint: row.mint });

	let bounded = sim.ok;
	if (sim.ok && kind === 'deposit') {
		const native = row.mint === WSOL_MINT;
		bounded = native
			? sim.lamports_out <= MAX_LAMPORTS_OVERHEAD + Number(amountRaw)
			: sim.token_out_raw <= amountRaw + ROUNDING_RAW && sim.lamports_out <= MAX_LAMPORTS_OVERHEAD;
	} else if (sim.ok) {
		bounded = sim.lamports_out <= MAX_LAMPORTS_OVERHEAD && sim.token_out_raw <= ROUNDING_RAW;
	}
	check('simulation', sim.ok && bounded, !sim.ok ? 'Simulation failed against current Solana state' : bounded ? `Simulation passed using ${sim.units ?? '?'} compute units` : 'Simulation moved more than the confirmed amount');

	const proj = kind === 'deposit' && row.supply_apy != null ? projectInterest(amountUi, row.supply_apy) : null;
	const preview = {
		ok: true, executed: false, kind, venue: venue.id, venue_name: venue.name, chain: 'solana', network: 'mainnet',
		market: venue.market, program: venue.program,
		token: row.symbol, mint: row.mint, reserve: row.reserve, decimals: row.decimals,
		amount: formatRaw(effectiveRaw, row.decimals), amount_raw: effectiveRaw.toString(), all: isAll, amount_usd: amountUsd,
		from: kind === 'deposit' ? wallet : `${venue.name} obligation ${built.obligation}`,
		to: kind === 'deposit' ? `${venue.name} obligation ${built.obligation}` : wallet,
		wallet, obligation: built.obligation, opens_position: built.first_deposit === true,
		supply_apy: num(row.supply_apy), projected_yearly: proj ? proj.per_year : null,
		expected_collateral: kind === 'deposit' ? { token: row.symbol, amount: formatRaw(amountRaw, row.decimals), note: 'Credited to the obligation at the reserve exchange rate, and it keeps earning supply interest.' } : null,
		simulation: { ok: sim.ok, bounded, compute_units: sim.units, error: sim.error, logs: sim.logs, instructions: built.labels },
		checks, confirm_required: true,
	};
	if (confirm !== true) return preview;

	const failing = checks.find((c) => !c.ok);
	if (failing) throw new LendingError('check_failed', `Not sent: ${failing.label}.`, 422, { check: failing.id, checks, simulation: preview.simulation });
	return execute({ kind, agent, userId, venue, row, wallet, conn, built, tables, preview, amountUsd, req, source });
}

async function execute({ kind, agent, userId, venue, row, wallet, conn, built, tables, preview, amountUsd, req, source }) {
	let reservationId = null;
	if (kind === 'deposit') {
		const reservation = await reserveSpendUsd({
			agentId: agent.id, userId, meta: agent.meta, category: SPEND_CATEGORY, usdValue: amountUsd,
			destination: `lending-venue:${venue.id}`, asset: row.symbol, ownerInitiated: source === 'owner',
			rowMeta: { lending_action: 'deposit', venue: venue.id, reserve: row.reserve, source },
		});
		reservationId = reservation.reservationId;
	}
	let sent = false;
	let signature = null;
	try {
		const units = Math.min(MAX_COMPUTE_UNITS, Math.max(50_000, Math.ceil((preview.simulation.compute_units || 400_000) * 1.25)));
		const final = await compile(conn, wallet, built.instructions, tables, units);
		const keypair = await agentKeypair(agent.id, userId, `lending_${kind}`, { venue: venue.id, custody_event_id: reservationId });
		final.vtx.sign([keypair]);
		try {
			signature = await conn.sendRawTransaction(final.vtx.serialize(), { skipPreflight: false, maxRetries: 3 });
			sent = true;
		} catch (err) {
			throw new LendingError('send_failed', 'The network refused the transaction, so nothing moved. Try again.', 502, { message: String(err?.message || err).slice(0, 240) });
		}
		try {
			await confirmOrThrow(conn, { signature, blockhash: final.blockhash, lastValidBlockHeight: final.lastValidBlockHeight });
		} catch (err) {
			const reverted = err?.code === 'tx_reverted';
			throw new LendingError(
				reverted ? 'transaction_reverted' : 'confirmation_timeout',
				reverted ? 'The transaction landed but the lending program rejected it, so nothing changed beyond the network fee.' : 'The transaction was sent but not confirmed in time. Check the explorer link before retrying.',
				502, { signature, explorer: explorer(signature) },
			);
		}
		venue.invalidateMarket();
		if (reservationId) await updateCustodyEvent(reservationId, { status: 'confirmed', signature, meta: { simulation: preview.simulation } }).catch(() => {});
		logAudit({ userId, action: `custody.lending_${kind}`, resourceId: agent.id, meta: { token: row.symbol, amount: preview.amount, amount_usd: amountUsd, venue: venue.id, signature, source }, req });
		return { ...preview, executed: true, signature, explorer: explorer(signature), summary: `${kind === 'deposit' ? 'Supplied' : 'Withdrew'} ${preview.amount} ${row.symbol}` };
	} catch (err) {
		if (reservationId) {
			if (sent) await updateCustodyEvent(reservationId, { status: 'failed', signature }).catch(() => {});
			else await releaseSpendReservation(reservationId, err?.code || 'lending_failed').catch(() => {});
		}
		logAudit({ userId, action: `custody.lending_${kind}_failed`, resourceId: agent.id, meta: { token: row.symbol, code: err?.code || null, signature, source }, req });
		throw err;
	}
}

export const deposit = (args) => act('deposit', args);
export const withdraw = (args) => act('withdraw', args);

export { DEFAULT_VENUE };

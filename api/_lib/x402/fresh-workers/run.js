// api/_lib/x402/fresh-workers/run.js
//
// One tick of the fresh-wallet workers lane. Every minute:
//
//   1. Reclaim: any wallet a previous tick left mid-flight (funded but unpaid,
//      paid but unswept, sweep failed) is emptied and closed, or declared
//      stranded and alerted after too many attempts.
//   2. Plan: which jobs this tick buys (a Forge generation every N ticks, the
//      rest datasets, in rotation), trimmed to the daily USDC cap.
//   3. Afford: the SOL funder must cover every wallet's SOL plus its ATA rent
//      without dipping under the facilitator's sponsor floor, and the treasury
//      must hold the USDC. Otherwise the tick skips with a named reason.
//   4. Mint + fund: brand-new keypairs, encrypted at rest, funded in ONE
//      transaction (SOL from the funder, ATA created by the funder, USDC from
//      the treasury).
//   5. Pay: each wallet self-pays its job over the shared payX402 client (one
//      signature, its own fee), the response lands in the library or the data
//      desk, and the call is recorded to x402_autonomous_log.
//   6. Sweep: each wallet sends leftover USDC to the treasury, closes its token
//      account (rent back to the funder) and sends every remaining lamport but
//      the base fee to the funder. It ends at zero and is never used again.
//
// The tick is stateful by design: every stage writes the wallet's state first,
// so a timeout, a crash or a lost RPC mid-flight leaves nothing stranded; the
// next tick's reclaim pass finishes the job. Real on-chain payments only.

import { randomUUID } from 'node:crypto';
import { Keypair, PublicKey } from '@solana/web3.js';

import { sql as defaultSql } from '../../db.js';
import { env } from '../../env.js';
import { logger } from '../../usage.js';
import { sendOpsAlert } from '../../alerts.js';
import { solanaConnection } from '../../solana/connection.js';
import { mintDecimals } from '../../solana/read-guards.js';
import { payX402, bootstrapSolanaContext, decodeSeedSecret, USDC_MINT } from '../pay.js';
import { ringAllowedAddresses } from '../ring-allowlist.js';
import { SPONSOR_SOL_FLOOR_LAMPORTS } from '../self-facilitator.js';
import { resolveQueuedJobs } from '../pipelines/forge-content.js';
import { ensureVolumeSchema, upsertVolumeMetric } from '../pipelines/volume-shared.js';
import {
	ATA_RENT_LAMPORTS,
	freshWorkersConfig,
	planTickJobs,
	fitJobsToBudget,
	fundingRequirement,
	funderHeadroom,
	walletSolLamports,
	classifyReclaim,
} from './plan.js';
import { DATA_JOB_SLUGS, resolveJob, storeJobResult } from './jobs.js';
import {
	ensureFreshSchema, mintWallet, recoverKeypair,
	markFunded, markFundFailed, markPaid, markPayFailed, markClosed, markSweepFailed, markStranded,
	claimReclaimable, dailySpentAtomic,
} from './wallets.js';
import {
	rentExemptLamports, fundWallets, sweepWallet, readSolLamports, readUsdc, confirmSignature, usdcAtaOf,
} from './chain.js';

const log = logger('x402-fresh-workers');

export const PIPELINE = 'fresh-workers';
const ASSET = USDC_MINT || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const TICK_SEQ_KEY = 'x402:fresh:tick:seq';
const DATA_CURSOR_KEY = 'x402:fresh:data:cursor';
// The pay stage keeps this much of the tick for the sweeps that follow it.
const SWEEP_RESERVE_MS = 12_000;
// How long a sweep waits for the wallet's own payment to confirm before it
// reads balances. A settle the facilitator broadcast lands in a few seconds.
const PAY_CONFIRM_MS = 15_000;

let _memTickSeq = 0;
let _memCursor = 0;

function loadFunder(secret, label) {
	const bytes = decodeSeedSecret(secret);
	if (!bytes) throw new Error(`${label}_undecodable`);
	return Keypair.fromSecretKey(bytes);
}

async function nextTickSeq(redis) {
	if (redis) {
		try { return Number(await redis.incr(TICK_SEQ_KEY)); } catch { /* fall through */ }
	}
	return (_memTickSeq += 1);
}

async function reserveCursor(redis, count) {
	if (count <= 0) return _memCursor;
	if (redis) {
		try { return Number(await redis.incrby(DATA_CURSOR_KEY, count)) - count; } catch { /* fall through */ }
	}
	const start = _memCursor;
	_memCursor += count;
	return start;
}

const skip = (reason, extra = {}) => ({ ok: true, skipped: true, reason, ...extra });

async function recordCall(sql, { runId, wallet, job, endpointUrl, result, durationMs, sink }) {
	try {
		await sql`
			INSERT INTO x402_autonomous_log
				(run_id, endpoint_type, service_name, endpoint_url,
				 network, amount_atomic, asset, tx_signature,
				 response_data, value_extracted, duration_ms, success, error_msg, pipeline)
			VALUES
				(${runId}, ${'self'}, ${`Fresh: ${job.title}`}, ${endpointUrl},
				 ${'solana:mainnet'}, ${result.paid ? result.amountAtomic : 0}, ${ASSET}, ${result.txSig || null},
				 ${JSON.stringify({ status: result.status, paid: result.paid === true, skipped: result.skipped === true })},
				 ${JSON.stringify({ payer: wallet.pubkey, wallet_id: wallet.id, job_kind: job.kind, slug: job.slug, fresh_wallet: true, ...(sink || {}) })},
				 ${durationMs || 0}, ${result.success === true}, ${result.errorMsg || null}, ${PIPELINE})`;
	} catch (err) {
		log.warn('fresh_call_log_insert_failed', { message: err?.message });
	}
	try {
		await upsertVolumeMetric(sql, { key: job.slug, name: job.title, path: job.endpointPath }, {
			amountAtomic: result.paid ? result.amountAtomic : 0, txSig: result.txSig, success: result.success === true,
			status: result.status, errorMsg: result.errorMsg, runId,
		});
	} catch (err) {
		log.warn('fresh_volume_metric_failed', { message: err?.message });
	}
}

async function recordLedger(sql, { kind, from, to, amountAtomic, txSig, runId }) {
	try {
		await sql`INSERT INTO x402_ring_ledger (kind, from_wallet, to_wallet, mint, amount_atomic, tx_sig, run_id)
			VALUES (${kind}, ${from}, ${to}, ${ASSET}, ${Number(amountAtomic || 0)}, ${txSig || null}, ${runId})`;
	} catch (err) {
		log.warn('fresh_ledger_write_failed', { kind, message: err?.message });
	}
}

/**
 * Empty and close one wallet, booking the outcome. Shared by the sweep stage
 * and the reclaim pass. Returns the state it left the row in.
 */
async function settleWallet({ sql, conn, wallet, keypair, funders, mint, decimals, runId, confirmMs }) {
	const res = await sweepWallet({
		conn, wallet: keypair, solFunder: funders.solFunder.publicKey, treasury: funders.treasury.publicKey,
		mint, decimals, confirmMs,
	});
	if (!res.ok) {
		await markSweepFailed(sql, wallet.id, res.err);
		return { state: 'sweep_failed', error: res.err };
	}
	await markClosed(sql, wallet.id, {
		sweepSig: res.signature, solLamports: res.solLamports, usdcAtomic: Number(res.usdcAtomic || 0n), rentLamports: res.rentLamports,
	});
	if (res.usdcAtomic && res.usdcAtomic > 0n) {
		await recordLedger(sql, { kind: 'sweep', from: wallet.pubkey, to: funders.treasury.publicKey.toBase58(), amountAtomic: Number(res.usdcAtomic), txSig: res.signature, runId });
	}
	return { state: 'closed', signature: res.signature, solLamports: res.solLamports, rentLamports: res.rentLamports };
}

async function reclaimPass({ sql, conn, cfg, funders, mint, decimals, runId, timeLeft }) {
	const out = { claimed: 0, closed: 0, failed: 0, stranded: 0, waiting: 0 };
	let rows = [];
	try {
		rows = await claimReclaimable({ sql, reclaimAfterS: cfg.reclaimAfterS, limit: cfg.reclaimBatch });
	} catch (err) {
		log.warn('fresh_reclaim_claim_failed', { message: err?.message });
		return out;
	}
	out.claimed = rows.length;
	for (const row of rows) {
		if (timeLeft() < SWEEP_RESERVE_MS) { out.waiting += 1; continue; }
		// The claim query already applied the age window, so only the attempt
		// ceiling is left to judge here.
		const verdict = classifyReclaim({
			state: row.state, updatedAtMs: 0, attempts: Number(row.attempts || 0), nowMs: Date.now(),
			reclaimAfterS: 0, maxSweepAttempts: cfg.maxSweepAttempts,
		});
		if (verdict === 'stranded') {
			await markStranded(sql, row.id, `sweep_attempts_exhausted:${row.attempts}`);
			out.stranded += 1;
			await sendOpsAlert(
				'x402 fresh worker wallet stranded',
				`Wallet ${row.pubkey} (job ${row.job_kind}/${row.job_slug}) could not be swept after ${row.attempts} attempts. Its SOL and any USDC are still on chain under a key in x402_fresh_wallets; run the reclaim manually once the cause is fixed.`,
				{ signature: `fresh-workers:stranded:${row.pubkey}` },
			).catch(() => {});
			continue;
		}
		let keypair;
		try { keypair = await recoverKeypair(row.encrypted_secret); }
		catch (err) { await markSweepFailed(sql, row.id, `key_recover_failed:${err?.message}`); out.failed += 1; continue; }
		if (row.state === 'paid' && row.pay_sig) {
			await confirmSignature(conn, row.pay_sig, Math.min(PAY_CONFIRM_MS, Math.max(2_000, timeLeft() - SWEEP_RESERVE_MS)));
		}
		const done = await settleWallet({
			sql, conn, wallet: { id: row.id, pubkey: row.pubkey }, keypair, funders, mint, decimals, runId,
			confirmMs: Math.min(30_000, Math.max(5_000, timeLeft() - 2_000)),
		});
		if (done.state === 'closed') out.closed += 1; else out.failed += 1;
	}
	return out;
}

/**
 * Run one tick. Standalone callers (scripts/x402-fresh-workers-run.mjs) pass
 * the same shape the cron does: { sql?, redis?, origin?, runId? }.
 */
export async function run(ctx = {}) {
	const started = Date.now();
	const sql = ctx.sql || defaultSql;
	const redis = ctx.redis || null;
	const origin = (ctx.origin || env.APP_ORIGIN || 'https://three.ws').replace(/\/+$/, '');
	const runId = ctx.runId || randomUUID();
	const cfg = freshWorkersConfig();
	const deadline = started + cfg.tickBudgetMs;
	const timeLeft = () => deadline - Date.now();

	if (!cfg.enabled) return skip('X402_FRESH_WORKERS_ENABLED=false');
	if (!USDC_MINT) return skip('usdc_mint_unset');
	if (!process.env.WALLET_ENCRYPTION_KEY) return skip('wallet_encryption_key_unset');
	const treasurySecret = process.env.X402_TREASURY_SECRET_BASE58;
	const solFunderSecret = process.env.X402_FEE_PAYER_SECRET_BASE58 || treasurySecret;
	if (!treasurySecret) return skip('treasury_secret_unset');

	let funders;
	try {
		funders = { treasury: loadFunder(treasurySecret, 'treasury_secret'), solFunder: loadFunder(solFunderSecret, 'sol_funder_secret') };
	} catch (err) {
		return { ok: false, skipped: true, reason: err.message };
	}
	if (env.X402_PAY_TO_SOLANA && funders.treasury.publicKey.toBase58() !== env.X402_PAY_TO_SOLANA) {
		return { ok: false, skipped: true, reason: 'treasury_pubkey_mismatch' };
	}

	await ensureFreshSchema(sql);
	await ensureVolumeSchema(sql);

	let allowed;
	try { allowed = await ringAllowedAddresses({ sql }); } catch { allowed = new Set(); }
	const treasuryB58 = funders.treasury.publicKey.toBase58();
	const solFunderB58 = funders.solFunder.publicKey.toBase58();
	if (!allowed.has(treasuryB58) || !allowed.has(solFunderB58)) {
		return { ok: false, skipped: true, reason: 'funder_not_allowlisted' };
	}

	// One Solana context for the whole tick: the blockhash the payments sign
	// against (refreshed inside payX402 as it ages) and the USDC decimals.
	let solana;
	try {
		solana = await bootstrapSolanaContext({ buyer: funders.solFunder });
	} catch (err) {
		return skip('rpc_unavailable', { error: err?.message });
	}
	const conn = ctx.conn || solana.conn || solanaConnection({ url: env.SOLANA_RPC_URL, commitment: 'confirmed' });
	const mint = new PublicKey(USDC_MINT);
	const decimals = solana.mintInfo?.decimals ?? await mintDecimals(conn, mint);
	const mintInfo = { decimals };

	// ── 1. Reclaim whatever an earlier tick left behind ───────────────────────
	const reclaim = await reclaimPass({ sql, conn, cfg, funders, mint, decimals, runId, timeLeft });
	// Finished Forge jobs from earlier ticks (async generations) converge here
	// too, so the library keeps filling even on a tick that buys nothing.
	const resolvedProps = await resolveQueuedJobs(origin).catch(() => 0);

	// ── 2. Plan this tick's jobs inside the daily cap ─────────────────────────
	const tickSeq = await nextTickSeq(redis);
	if (cfg.perTick === 0) return { ok: true, skipped: true, reason: 'per_tick_zero', reclaim, tick_seq: tickSeq };
	const dataCount = Math.max(0, cfg.perTick - (tickSeq % cfg.forgeEveryNTicks === 0 ? 1 : 0));
	const cursor = await reserveCursor(redis, dataCount);
	const planned = planTickJobs({ tickSeq, perTick: cfg.perTick, forgeEveryNTicks: cfg.forgeEveryNTicks, dataSlugs: DATA_JOB_SLUGS, cursor });
	const jobs = planned.map((p) => resolveJob(p, tickSeq));
	const dailySpent = await dailySpentAtomic(sql);
	const fit = fitJobsToBudget({ jobs, priceOf: (j) => j.priceAtomic, dailySpentAtomic: dailySpent, dailyCapAtomic: cfg.dailyCapAtomic });
	if (fit.kept.length === 0) {
		log.info('fresh_daily_cap_reached', { spent: dailySpent, cap: cfg.dailyCapAtomic });
		return { ok: true, skipped: true, reason: 'daily_cap_reached', daily_spent_usdc: (dailySpent / 1e6).toFixed(4), reclaim, tick_seq: tickSeq };
	}

	// ── 3. Can the funders afford it without touching the sponsor floor? ──────
	const rentExempt = await rentExemptLamports(conn);
	const solPerWallet = walletSolLamports({ rentExemptLamports: rentExempt, maxPayFeeLamports: cfg.maxPayFeeLamports });
	const need = fundingRequirement({ jobs: fit.kept, priceOf: (j) => j.priceAtomic, solPerWalletLamports: solPerWallet, ataRentLamports: ATA_RENT_LAMPORTS });
	const [funderSol, treasuryUsdc] = await Promise.all([
		readSolLamports(conn, funders.solFunder.publicKey),
		readUsdc(conn, usdcAtaOf(funders.treasury.publicKey, mint)),
	]);
	if (funderSol === null || treasuryUsdc === null) return skip('funder_balance_unreadable', { reclaim, tick_seq: tickSeq });
	const headroom = funderHeadroom({ balanceLamports: funderSol, floorLamports: SPONSOR_SOL_FLOOR_LAMPORTS, needLamports: need.solLamports });
	if (!headroom.ok) {
		log.warn('fresh_funder_headroom', { balance: funderSol, floor: SPONSOR_SOL_FLOOR_LAMPORTS, need: need.solLamports, shortfall: headroom.shortfall });
		await sendOpsAlert(
			'x402 fresh workers paused: SOL funder headroom',
			`The fee wallet holds ${(funderSol / 1e9).toFixed(4)} SOL; funding ${need.wallets} fresh wallet(s) needs ${(need.solLamports / 1e9).toFixed(4)} SOL above the ${(SPONSOR_SOL_FLOOR_LAMPORTS / 1e9).toFixed(3)} SOL sponsor floor. Fund the economy master; the lane resumes on its own.`,
			{ signature: 'fresh-workers:funder_headroom' },
		).catch(() => {});
		return skip('funder_headroom', { shortfall_lamports: headroom.shortfall, reclaim, tick_seq: tickSeq });
	}
	if (treasuryUsdc.atomic < BigInt(need.usdcAtomic)) {
		return skip('treasury_usdc_short', { have: String(treasuryUsdc.atomic), need: need.usdcAtomic, reclaim, tick_seq: tickSeq });
	}

	// ── 4. Mint + fund ─────────────────────────────────────────────────────────
	const wallets = [];
	for (const job of fit.kept) {
		try {
			wallets.push(await mintWallet({ sql, job, mint, runId }));
		} catch (err) {
			log.warn('fresh_mint_failed', { message: err?.message });
		}
	}
	if (wallets.length === 0) return { ok: false, skipped: true, reason: 'mint_failed', reclaim, tick_seq: tickSeq };

	const fund = await fundWallets({
		conn, solFunder: funders.solFunder, treasury: funders.treasury, mint, decimals,
		targets: wallets.map((w) => ({ pubkey: w.keypair.publicKey, ata: new PublicKey(w.ata), solLamports: solPerWallet, usdcAtomic: BigInt(w.job.priceAtomic) })),
		confirmMs: Math.min(30_000, Math.max(8_000, timeLeft() - 25_000)),
	});
	if (!fund.ok) {
		// A funding tx that did not confirm in time may still land. The rows stay
		// reclaimable: after the window the reclaim pass reads their balances and
		// sweeps whatever arrived, so a late landing never strands funds.
		await markFundFailed(sql, wallets.map((w) => w.id), `fund_failed:${fund.err}`);
		log.warn('fresh_fund_failed', { wallets: wallets.length, err: fund.err, signature: fund.signature });
		return { ok: false, reason: 'fund_failed', error: fund.err, signature: fund.signature, reclaim, tick_seq: tickSeq };
	}
	await markFunded(sql, wallets.map((w) => w.id), {
		fundSig: fund.signature, solLamports: solPerWallet,
		usdcAtomicById: new Map(wallets.map((w) => [w.id, w.job.priceAtomic])),
	});
	for (const w of wallets) {
		await recordLedger(sql, { kind: 'fund', from: treasuryB58, to: w.pubkey, amountAtomic: w.job.priceAtomic, txSig: fund.signature, runId });
	}

	// ── 5. Pay: every fresh wallet buys its job, in parallel ───────────────────
	const onAccept = (accept) => (allowed.has(accept.payTo) ? null : { abort: true, reason: 'payto_outside_ring' });
	const payBudgetMs = Math.max(5_000, timeLeft() - SWEEP_RESERVE_MS);
	const payOne = async (w) => {
		const url = `${origin}${w.job.path}`;
		const t0 = Date.now();
		let result;
		try {
			result = await Promise.race([
				payX402({ url, method: w.job.method, body: w.job.body, buyer: w.keypair, conn, blockhash: solana.blockhash, mintInfo, remainingCap: w.job.priceAtomic, selfPay: true, onAccept }),
				new Promise((resolve) => setTimeout(() => resolve({ success: false, paid: false, skipped: false, amountAtomic: 0, txSig: null, status: 0, responseBody: null, errorMsg: 'tick_deadline' }), payBudgetMs)),
			]);
		} catch (err) {
			result = { success: false, paid: false, skipped: false, amountAtomic: 0, txSig: null, status: 0, responseBody: null, errorMsg: err?.message || 'pay_failed' };
		}
		let sink = null;
		if (result.success) {
			sink = await storeJobResult({ sql, job: w.job, wallet: w, result, runId });
			await markPaid(sql, w.id, { paySig: result.txSig, amountAtomic: result.paid ? result.amountAtomic : 0 });
		} else {
			await markPayFailed(sql, w.id, result.errorMsg || `http_${result.status}`);
		}
		await recordCall(sql, { runId, wallet: w, job: w.job, endpointUrl: url, result, durationMs: Date.now() - t0, sink });
		return { wallet: w, result, sink };
	};
	const paid = await Promise.all(wallets.map(payOne));

	// ── 6. Sweep: empty and close every wallet this tick funded ────────────────
	const sweeps = await Promise.all(paid.map(async ({ wallet, result }) => {
		if (timeLeft() < 3_000) return { wallet, state: 'deferred' };
		if (result.txSig) await confirmSignature(conn, result.txSig, Math.min(PAY_CONFIRM_MS, Math.max(2_000, timeLeft() - 4_000)));
		const done = await settleWallet({
			sql, conn, wallet, keypair: wallet.keypair, funders, mint, decimals, runId,
			confirmMs: Math.min(30_000, Math.max(4_000, timeLeft())),
		});
		return { wallet, ...done };
	}));

	const summary = {
		ok: true,
		run_id: runId,
		tick_seq: tickSeq,
		duration_ms: Date.now() - started,
		reclaim,
		resolved_props: resolvedProps,
		wallets: wallets.length,
		paid: paid.filter((p) => p.result.paid).length,
		failed: paid.filter((p) => !p.result.success).length,
		spent_usdc: (paid.reduce((s, p) => s + (p.result.paid ? p.result.amountAtomic : 0), 0) / 1e6).toFixed(4),
		closed: sweeps.filter((s) => s.state === 'closed').length,
		sweep_failed: sweeps.filter((s) => s.state === 'sweep_failed').length,
		deferred: sweeps.filter((s) => s.state === 'deferred').length,
		dropped_for_cap: fit.dropped.length,
		fund_signature: fund.signature,
		jobs: paid.map(({ wallet, result, sink }, i) => ({
			payer: wallet.pubkey,
			kind: wallet.job.kind,
			slug: wallet.job.slug,
			paid: result.paid === true,
			amount_usdc: result.paid ? (result.amountAtomic / 1e6).toFixed(4) : '0',
			tx: result.txSig || null,
			error: result.errorMsg || null,
			stored: sink?.stored ?? null,
			state: sweeps[i]?.state || null,
			sweep_tx: sweeps[i]?.signature || null,
		})),
	};
	log.info('fresh_tick_complete', { run_id: runId, tick_seq: tickSeq, wallets: summary.wallets, paid: summary.paid, closed: summary.closed, spent_usdc: summary.spent_usdc, duration_ms: summary.duration_ms });
	return summary;
}

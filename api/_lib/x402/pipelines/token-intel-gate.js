// api/_lib/x402/pipelines/token-intel-gate.js
//
// Token Intel Pre-Snipe Gate — autonomous pipeline (self/023).
//
// Before the sniper commits SOL to a new mint, this loop pays the platform's own
// $0.01 USDC Token Oracle (/api/x402/token-intel) for live due-diligence on the
// freshest pump.fun mints the sniper is about to consider, and turns the verdict
// into a rugpull-risk gate. On each run it:
//
//   1. Selects a batch of recent mints from pump_coin_intel that lack a FRESH
//      risk verdict (selectGateTargets), ordered most-active-first (the ones
//      most likely to already have a tradeable DexScreener pair).
//   2. Pays GET /api/x402/token-intel?mint=<mint> for each via the shared payX402
//      client — real on-chain USDC from the seed wallet, never mocked. Mints with
//      no live market yet make the endpoint throw 503 BEFORE settlement, so the
//      wallet is never charged for missing data (recorded as a free/failed probe).
//   3. Extracts the 0..100 rugpull sub-score (token-intel risk.score) + level,
//      and upserts the verdict into token_intel_risk keyed by (mint, network).
//      `rejected` is set when the level is high/critical.
//   4. Records a row in x402_autonomous_log for every call (success or failure)
//      with the verdict in value_extracted.
//
// Wiring: declared as a run()-style entry in autonomous-registry.js. The per-tick
// loop (api/cron/x402-autonomous-loop.js) hands run() a shared payment context
// (buyer, conn, blockhash, mintInfo, remainingCap, runId, origin); called
// standalone (manual test) it bootstraps its own via bootstrapSolanaContext().
//
// Downstream consumer: workers/agent-sniper/oracle-gate.js reads token_intel_risk
// on the pre-snipe path (new_mint, first_claim, intel_confirmed, prelaunch-radar).
// A fresh `rejected = true` row vetoes the snipe — high-risk mints are auto-
// rejected before any SOL moves. Fail-open: a missing/stale verdict never blocks
// a snipe, so this layer can only ever make the sniper safer.

import { randomUUID } from 'node:crypto';

import { sql } from '../../db.js';
import { env } from '../../env.js';
import { logger } from '../../usage.js';
import { payX402, bootstrapSolanaContext, USDC_MINT } from '../pay.js';

const log = logger('x402-token-intel-gate');

// Mints risk-checked per run. Each is one $0.01 USDC payment, so a full batch is
// ≤ $0.0BATCH — bounded again by the remainingCap the loop passes in and by the
// loop's daily cap. Default 3 keeps a steady ~$0.x/day at the registry cooldown.
const BATCH_SIZE = Number(process.env.X402_TOKEN_INTEL_GATE_BATCH || 3);
// A verdict is "fresh" for this many minutes — within the window we don't re-pay
// for the same mint. New mints move fast, so a short window keeps risk current.
const FRESH_MINUTES = Number(process.env.X402_TOKEN_INTEL_GATE_FRESH_MIN || 30);
// Only gate mints first seen within this window — older mints are no longer
// snipe candidates, so paying to risk-check them is wasted spend.
const CANDIDATE_HOURS = Number(process.env.X402_TOKEN_INTEL_GATE_CANDIDATE_HOURS || 24);

const NETWORK = (process.env.SNIPER_NETWORK || 'mainnet').trim();
const ASSET = USDC_MINT || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const ENDPOINT_PATH = '/api/x402/token-intel';

let _schemaReady = false;
async function ensureSchema() {
	if (_schemaReady) return;
	// Verdict sink (idempotent — mirrors the migration so the pipeline is safe to
	// run before the migration is applied).
	await sql`
		CREATE TABLE IF NOT EXISTS token_intel_risk (
			mint            text NOT NULL,
			network         text NOT NULL DEFAULT 'mainnet',
			rugpull_score   int  NOT NULL DEFAULT 0,
			risk_level      text NOT NULL DEFAULT 'unknown',
			rejected        boolean NOT NULL DEFAULT false,
			signal          text,
			confidence      numeric(4,3),
			symbol          text,
			price_usd       numeric(20,10),
			change_24h      numeric,
			market_cap_usd  numeric,
			liquidity_usd   numeric,
			volume_24h_usd  numeric,
			factors         jsonb NOT NULL DEFAULT '[]'::jsonb,
			tx_signature    text,
			run_id          uuid,
			checked_at      timestamptz NOT NULL DEFAULT now(),
			PRIMARY KEY (mint, network)
		)
	`;
	await sql`CREATE INDEX IF NOT EXISTS token_intel_risk_checked ON token_intel_risk (network, checked_at DESC)`;
	// The autonomous log predates the value_extracted column on some envs.
	await sql`ALTER TABLE x402_autonomous_log ADD COLUMN IF NOT EXISTS value_extracted jsonb`;
	_schemaReady = true;
}

/**
 * Pick the next batch of snipe-candidate mints needing a fresh risk verdict.
 * Recent mints first by activity (most-traded → most likely already listed on a
 * DEX, so token-intel returns real data instead of a 503). Returns [] if the
 * pump_coin_intel brain table isn't present yet (degrade, never throw).
 */
export async function selectGateTargets(limit = BATCH_SIZE) {
	try {
		const rows = await sql`
			SELECT pci.mint, pci.symbol
			FROM pump_coin_intel pci
			LEFT JOIN token_intel_risk tir
				ON tir.mint = pci.mint AND tir.network = pci.network
			WHERE pci.network = ${NETWORK}
				AND pci.first_seen_at > now() - make_interval(hours => ${CANDIDATE_HOURS})
				AND (tir.checked_at IS NULL
					OR tir.checked_at < now() - make_interval(mins => ${FRESH_MINUTES}))
			ORDER BY pci.buy_volume_lamports DESC NULLS LAST, pci.first_seen_at DESC
			LIMIT ${limit}
		`;
		return rows.map((r) => ({ mint: r.mint, symbol: r.symbol || null }));
	} catch (err) {
		if (!err?.message?.includes('does not exist')) {
			log.warn('token_intel_gate_select_failed', { message: err?.message });
		}
		return [];
	}
}

// Map a token-intel response into the verdict row. The rugpull sub-score IS the
// endpoint's due-diligence risk.score (0 safe … 100 critical); high/critical
// levels flip `rejected`. Returns null for a malformed/empty response.
export function deriveVerdict(body) {
	if (!body || typeof body !== 'object' || !body.risk) return null;
	const level = String(body.risk.level || 'unknown').toLowerCase();
	const score = Number(body.risk.score);
	return {
		rugpull_score: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0,
		risk_level: ['low', 'medium', 'high', 'critical'].includes(level) ? level : 'unknown',
		rejected: level === 'high' || level === 'critical',
		signal: body.signal || null,
		confidence: Number.isFinite(Number(body.confidence)) ? Number(body.confidence) : null,
		symbol: body.symbol || null,
		price_usd: Number.isFinite(Number(body.price_usd)) ? Number(body.price_usd) : null,
		change_24h: Number.isFinite(Number(body.change_24h)) ? Number(body.change_24h) : null,
		market_cap_usd: Number.isFinite(Number(body.market_cap_usd)) ? Number(body.market_cap_usd) : null,
		liquidity_usd: Number.isFinite(Number(body.liquidity_usd)) ? Number(body.liquidity_usd) : null,
		volume_24h_usd: Number.isFinite(Number(body.volume_24h_usd)) ? Number(body.volume_24h_usd) : null,
		factors: Array.isArray(body.risk.factors) ? body.risk.factors : [],
	};
}

async function upsertVerdict(runId, mint, v, txSig) {
	await sql`
		INSERT INTO token_intel_risk
			(mint, network, rugpull_score, risk_level, rejected, signal, confidence,
			 symbol, price_usd, change_24h, market_cap_usd, liquidity_usd, volume_24h_usd,
			 factors, tx_signature, run_id, checked_at)
		VALUES
			(${mint}, ${NETWORK}, ${v.rugpull_score}, ${v.risk_level}, ${v.rejected},
			 ${v.signal}, ${v.confidence}, ${v.symbol}, ${v.price_usd}, ${v.change_24h},
			 ${v.market_cap_usd}, ${v.liquidity_usd}, ${v.volume_24h_usd},
			 ${JSON.stringify(v.factors)}, ${txSig || null}, ${runId}, now())
		ON CONFLICT (mint, network) DO UPDATE SET
			rugpull_score  = EXCLUDED.rugpull_score,
			risk_level     = EXCLUDED.risk_level,
			rejected       = EXCLUDED.rejected,
			signal         = EXCLUDED.signal,
			confidence     = EXCLUDED.confidence,
			symbol         = EXCLUDED.symbol,
			price_usd      = EXCLUDED.price_usd,
			change_24h     = EXCLUDED.change_24h,
			market_cap_usd = EXCLUDED.market_cap_usd,
			liquidity_usd  = EXCLUDED.liquidity_usd,
			volume_24h_usd = EXCLUDED.volume_24h_usd,
			factors        = EXCLUDED.factors,
			tx_signature   = EXCLUDED.tx_signature,
			run_id         = EXCLUDED.run_id,
			checked_at     = now()
	`;
}

// One row per gated mint into x402_autonomous_log (the loop also records one
// aggregate summary row for the run() entry; these are the granular per-mint ones).
async function recordCall(runId, { mint, endpointUrl, amountAtomic, txSig, responseData, durationMs, success, errorMsg, valueExtracted }) {
	try {
		await sql`
			INSERT INTO x402_autonomous_log
				(run_id, endpoint_type, service_name, endpoint_url,
				 network, amount_atomic, asset, tx_signature,
				 response_data, value_extracted, duration_ms, success, error_msg, pipeline)
			VALUES
				(${runId}, ${'self'}, ${`Pre-Snipe Gate: ${mint.slice(0, 8)}…`}, ${endpointUrl},
				 ${'solana:mainnet'}, ${amountAtomic || 0}, ${ASSET}, ${txSig || null},
				 ${responseData ? JSON.stringify(responseData) : null},
				 ${valueExtracted ? JSON.stringify(valueExtracted) : null},
				 ${durationMs || 0}, ${success}, ${errorMsg || null}, ${'sniper'})
		`;
	} catch (err) {
		log.warn('token_intel_gate_log_insert_failed', { mint, message: err?.message });
	}
}

/**
 * Run the pre-snipe gate sweep. Conforms to the run()-style registry contract:
 * the loop hands over { origin, buyer, conn, blockhash, mintInfo, remainingCap,
 * runId }; standalone (manual test) it bootstraps its own Solana context.
 *
 * Returns the aggregate outcome the loop records as one summary row:
 *   { success, amountAtomic, txSig, errorMsg, responseData, signalData, skipped, note }
 */
export async function run(ctx = {}) {
	const runId = ctx.runId || randomUUID();
	const origin = ctx.origin || env.APP_ORIGIN || 'https://three.ws';
	let remainingCap = ctx.remainingCap ?? Number.POSITIVE_INFINITY;
	// The payer's float as the loop read it, so an empty wallet is reported as
	// insufficient_payer_usdc rather than as a cap that needs raising.
	let payerUsdc = ctx.payerUsdcAtomic == null ? null : Number(ctx.payerUsdcAtomic);

	// ── Schema first: without the verdict sink there's nothing to extract, so don't pay.
	try {
		await ensureSchema();
	} catch (err) {
		log.warn('token_intel_gate_schema_failed', { message: err?.message });
		return { success: false, skipped: true, amountAtomic: 0, errorMsg: `schema_failed: ${err?.message}` };
	}

	// ── Find work before touching the wallet — no candidates → no spend.
	const targets = await selectGateTargets(BATCH_SIZE);
	if (targets.length === 0) {
		return { success: true, skipped: true, amountAtomic: 0, note: 'no_snipe_candidates' };
	}

	// ── Solana payment context: reuse the loop's, else bootstrap (graceful on an
	//    unconfigured wallet — bootstrap throws, we exit logged without paying).
	let { buyer, conn, blockhash, mintInfo } = ctx;
	if (!buyer || !conn || !blockhash || !mintInfo) {
		try {
			({ buyer, conn, blockhash, mintInfo } = await bootstrapSolanaContext({ buyer }));
		} catch (err) {
			log.info('token_intel_gate_skipped', { reason: err.message });
			return { success: false, skipped: true, amountAtomic: 0, errorMsg: err.message, note: 'wallet_or_rpc_unconfigured' };
		}
	}

	let spentAtomic = 0;
	let paid = 0;
	let gated = 0;       // verdicts stored
	let rejected = 0;    // high/critical → auto-reject
	let noData = 0;      // 503 before settlement (no live market yet)
	let callErrors = 0;
	let lastTxSig = null;

	for (let i = 0; i < targets.length; i++) {
		const { mint } = targets[i];
		if (remainingCap <= 0) {
			log.info('token_intel_gate_cap_reached', { spent_atomic: spentAtomic, remaining_targets: targets.length - i });
			break;
		}

		const endpointUrl = `${origin}${ENDPOINT_PATH}?mint=${encodeURIComponent(mint)}`;
		const t0 = Date.now();
		let result;
		try {
			result = await payX402({
				url: endpointUrl,
				method: 'GET',
				buyer, conn, blockhash, mintInfo,
				remainingCap,
				payerUsdcAtomic: payerUsdc,
				userAgent: 'threews-x402-presnipe-gate/1.0',
			});
		} catch (err) {
			// Network failure / abort — log the call, never crash the sweep.
			callErrors += 1;
			await recordCall(runId, {
				mint, endpointUrl, amountAtomic: 0, txSig: null, responseData: null,
				durationMs: Date.now() - t0, success: false, errorMsg: err?.message || 'fetch_failed', valueExtracted: null,
			});
			continue;
		}

		if (result.paid) {
			spentAtomic += result.amountAtomic;
			remainingCap -= result.amountAtomic;
			if (payerUsdc !== null) payerUsdc -= result.amountAtomic;
			paid += 1;
			if (result.txSig) lastTxSig = result.txSig;
		}

		// Derive + persist the verdict only when the call delivered a usable body.
		let verdict = null;
		let valueExtracted = null;
		if (result.success) {
			verdict = deriveVerdict(result.responseBody);
			if (verdict) {
				try {
					await upsertVerdict(runId, mint, verdict, result.txSig);
					gated += 1;
					if (verdict.rejected) rejected += 1;
					valueExtracted = {
						mint,
						rugpull_score: verdict.rugpull_score,
						risk_level: verdict.risk_level,
						rejected: verdict.rejected,
						signal: verdict.signal,
						liquidity_usd: verdict.liquidity_usd,
					};
				} catch (err) {
					// Payment already settled — record the call as a success but surface
					// the persistence error for observability.
					log.warn('token_intel_gate_persist_failed', { mint, message: err?.message });
				}
			}
		} else {
			// token-intel throws 503 (data_unavailable) for mints with no live market
			// yet — an expected, un-charged outcome for brand-new pre-bonding mints.
			if (result.status === 503) noData += 1;
			else callErrors += 1;
		}

		await recordCall(runId, {
			mint,
			endpointUrl,
			amountAtomic: result.amountAtomic,
			txSig: result.txSig,
			// Keep the row compact — the verdict lives in value_extracted + token_intel_risk.
			responseData: { status: result.status, code: result.responseBody?.code || null, rpc_error: result.responseBody?.error || null },
			durationMs: Date.now() - t0,
			success: result.success,
			errorMsg: result.errorMsg,
			valueExtracted,
		});
	}

	log.info('token_intel_gate_complete', {
		run_id: runId,
		targets: targets.length,
		paid,
		gated,
		rejected,
		no_data: noData,
		spent_usdc: (spentAtomic / 1e6).toFixed(4),
	});

	return {
		// success when the gate did its job: at least one verdict stored, or every
		// candidate honestly had no live market yet (no charge, nothing to gate).
		success: gated > 0 || (paid === 0 && noData === targets.length),
		amountAtomic: spentAtomic,
		txSig: lastTxSig,
		errorMsg: gated === 0 && callErrors > 0 ? `token_intel_gate_calls_failed:${callErrors}` : null,
		skipped: paid === 0 && gated === 0 && noData === 0,
		responseData: { targets: targets.length, paid, gated, rejected, no_data: noData },
		signalData: { gated, rejected, no_data: noData },
		note: `presnipe_gate targets=${targets.length} paid=${paid} gated=${gated} rejected=${rejected} nodata=${noData}`,
	};
}

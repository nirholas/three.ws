// api/_lib/x402/pipelines/reputation-refresh.js
//
// Agent Reputation Score Refresh — autonomous pipeline (self/005).
//
// On each run it refreshes the on-chain attestation reputation of the stalest
// registered Solana agents. For every agent it makes a REAL paid x402 call to
// the /api/mcp tool `solana_agent_reputation` ($0.001 USDC/call) using the seed
// wallet — never mocked. The pipeline:
//
//   1. Selects the stalest agents that have an on-chain Metaplex Core asset
//      (agent_identities.meta.sol_mint_address). Stalest-first ordering rotates
//      coverage across runs, exactly like the recompute-reputation cron.
//   2. Probes + pays each call via the shared payX402 client (real on-chain USDC).
//   3. Extracts the reputation summary and writes it to agent_solana_reputation,
//      flagging agents whose verified score drops below the trust threshold.
//   4. Records a row in x402_autonomous_log for every call (success or failure),
//      with the extracted score summary in value_extracted.
//
// Wiring: declared as a run()-style entry in autonomous-registry.js. The per-tick
// loop (api/cron/x402-autonomous-loop.js) hands run() a shared payment context
// (buyer, conn, blockhash, mintInfo, remainingCap); called standalone (manual
// test) it bootstraps its own via bootstrapSolanaContext().
//
// DATA OUT (value extraction):
//   Table  : agent_solana_reputation
//   Columns: score (headline trust number — the verified feedback average when
//            any verified feedback exists, else the raw average), feedback_total,
//            feedback_verified, feedback_disputed, validation_passed,
//            validation_failed, flagged, raw, refreshed_at.
//
// DOWNSTREAM CONSUMERS (read via the exported helpers below):
//   • Agent-profile trust badge  → getStoredSolanaReputation(agentId)
//   • Reputation leaderboard     → listSolanaReputationLeaderboard(limit)
//   • Moderation / flagged feed  → listFlaggedSolanaAgents(limit)
//
// This is the on-chain ATTESTATION reputation (signed feedback + validation
// memos), deliberately separate from the financial reputation in
// agent_reputation_scores (api/cron/recompute-reputation.js). The two never
// share a table.

import { randomUUID } from 'node:crypto';

import { sql } from '../../db.js';
import { env } from '../../env.js';
import { logger } from '../../usage.js';
import { payX402, bootstrapSolanaContext, USDC_MINT } from '../pay.js';

const log = logger('x402-reputation-refresh');

const TOOL = 'solana_agent_reputation';
const ASSET = USDC_MINT || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
// Advertised price of the tool: $0.001 USDC (6 decimals). Used only to pre-check
// the daily cap; the authoritative amount comes from the 402 challenge.
const PRICE_ATOMIC = 1000;

// On-chain feedback scores use a 1–5 star scale. Flag an agent whose verified
// average drops below the threshold once it has a meaningful sample. Tunable.
const FLAG_THRESHOLD = Number(process.env.SOLANA_REPUTATION_FLAG_THRESHOLD || 3.0);
const FLAG_MIN_SAMPLE = Number(process.env.SOLANA_REPUTATION_FLAG_MIN_SAMPLE || 3);
// Agents refreshed per run — bounds per-tick spend and RPC/DB load. Stalest
// agents sort first, so coverage rotates across runs.
const REFRESH_BATCH = Math.max(1, Number(process.env.SOLANA_REPUTATION_REFRESH_BATCH || 25));

async function ensureSchema() {
	await sql`
		create table if not exists agent_solana_reputation (
			agent_id          uuid primary key,
			agent_asset       text not null,
			network           text not null default 'mainnet',
			score             numeric(6,3) not null default 0,
			feedback_total    int not null default 0,
			feedback_verified int not null default 0,
			feedback_disputed int not null default 0,
			validation_passed int not null default 0,
			validation_failed int not null default 0,
			flagged           boolean not null default false,
			raw               jsonb,
			refreshed_at      timestamptz not null default now()
		)
	`;
	// Reputation leaderboard: rank by stored score cheaply.
	await sql`create index if not exists agent_solana_reputation_score_idx on agent_solana_reputation (score desc)`;
	// Moderation feed: list flagged agents without a full scan.
	await sql`create index if not exists agent_solana_reputation_flagged_idx on agent_solana_reputation (flagged) where flagged = true`;
	// Stalest-first selection for this loop.
	await sql`create index if not exists agent_solana_reputation_refreshed_idx on agent_solana_reputation (refreshed_at asc)`;
	// The autonomous log predates the value_extracted column some pipelines use;
	// add it idempotently so this pipeline records its parsed summary into it.
	await sql`ALTER TABLE x402_autonomous_log ADD COLUMN IF NOT EXISTS value_extracted jsonb`;
}

async function listAgentsToRefresh(limit) {
	// Never-refreshed agents first, then stalest. Only agents with a registered
	// on-chain asset are eligible (those are the ones with attestations to read).
	return sql`
		select a.id,
		       a.name,
		       a.meta->>'sol_mint_address' as asset,
		       coalesce(a.meta->>'network', 'mainnet') as network
		from agent_identities a
		left join agent_solana_reputation r on r.agent_id = a.id
		where a.deleted_at is null
		  and a.meta->>'sol_mint_address' is not null
		order by (r.agent_id is null) desc, r.refreshed_at asc nulls first
		limit ${limit}
	`;
}

function jsonRpcReputation(asset, network, id) {
	return {
		jsonrpc: '2.0',
		id,
		method: 'tools/call',
		params: { name: TOOL, arguments: { asset, network } },
	};
}

// Pull the solana_agent_reputation structuredContent out of a JSON-RPC body.
export function extractReputation(responseBody) {
	const msg = Array.isArray(responseBody) ? responseBody[0] : responseBody;
	const sc = msg?.result?.structuredContent;
	if (!sc || sc.error) return null;
	return sc; // { agent, network, feedback:{...}, validation:{...} }
}

// Derive the headline trust score and the flag verdict from a reputation
// payload. Exported for unit coverage.
export function evaluateReputation(rep) {
	const fb = rep.feedback || {};
	const val = rep.validation || {};
	const verified = Number(fb.verified || 0);
	const total = Number(fb.total || 0);
	const disputed = Number(fb.disputed || 0);
	const passed = Number(val.passed || 0);
	const failed = Number(val.failed || 0);

	// Prefer the verified-only average (feedback whose task the owner acknowledged
	// on-chain) when any exists; otherwise the raw average.
	const score = Number(verified > 0 ? (fb.score_avg_verified || 0) : (fb.score_avg || 0));
	const sample = verified > 0 ? verified : total;

	const reasons = [];
	if (sample >= FLAG_MIN_SAMPLE && score < FLAG_THRESHOLD) reasons.push(`score ${score.toFixed(2)} < ${FLAG_THRESHOLD}`);
	if (total > 0 && disputed / total > 0.5) reasons.push('majority of feedback disputed');
	if (passed + failed > 0 && failed > passed) reasons.push('validation failing');

	return { score, flagged: reasons.length > 0, reasons, total, verified, disputed, passed, failed };
}

async function upsertReputation(agent, rep, evald) {
	await sql`
		insert into agent_solana_reputation
			(agent_id, agent_asset, network, score, feedback_total, feedback_verified,
			 feedback_disputed, validation_passed, validation_failed, flagged, raw, refreshed_at)
		values
			(${agent.id}, ${agent.asset}, ${agent.network}, ${evald.score},
			 ${evald.total}, ${evald.verified}, ${evald.disputed},
			 ${evald.passed}, ${evald.failed}, ${evald.flagged},
			 ${JSON.stringify(rep)}, now())
		on conflict (agent_id) do update set
			agent_asset       = excluded.agent_asset,
			network           = excluded.network,
			score             = excluded.score,
			feedback_total    = excluded.feedback_total,
			feedback_verified = excluded.feedback_verified,
			feedback_disputed = excluded.feedback_disputed,
			validation_passed = excluded.validation_passed,
			validation_failed = excluded.validation_failed,
			flagged           = excluded.flagged,
			raw               = excluded.raw,
			refreshed_at      = now()
	`;
}

// Per-call row into x402_autonomous_log, including value_extracted. The loop
// also records one aggregate summary row for the run() entry; these are the
// granular per-agent rows this pipeline owns.
async function recordCall(runId, { agent, endpointUrl, amountAtomic, txSig, responseData, durationMs, success, errorMsg, valueExtracted }) {
	try {
		await sql`
			INSERT INTO x402_autonomous_log
				(run_id, endpoint_type, service_name, endpoint_url,
				 network, amount_atomic, asset, tx_signature,
				 response_data, value_extracted, duration_ms, success, error_msg, pipeline)
			VALUES
				(${runId}, ${'self'}, ${`Reputation Refresh: ${agent.name || agent.asset}`}, ${endpointUrl},
				 ${'solana:mainnet'}, ${amountAtomic || 0}, ${ASSET}, ${txSig || null},
				 ${responseData ? JSON.stringify(responseData) : null},
				 ${valueExtracted ? JSON.stringify(valueExtracted) : null},
				 ${durationMs || 0}, ${success}, ${errorMsg || null}, ${'self'})
		`;
	} catch (err) {
		log.warn('reputation_refresh_log_insert_failed', { asset: agent.asset, message: err?.message });
	}
}

/**
 * Run the reputation refresh. Conforms to the run()-style registry contract: the
 * loop hands over { origin, buyer, conn, blockhash, mintInfo, remainingCap,
 * runId }; called standalone (manual test) it bootstraps its own Solana context.
 *
 * Returns the aggregate outcome the loop records as one summary row:
 *   { success, amountAtomic, txSig, errorMsg, responseData, signalData, skipped, note }
 */
export async function run(ctx = {}) {
	const runId = ctx.runId || randomUUID();
	const origin = ctx.origin || env.APP_ORIGIN || 'https://three.ws';
	const endpointUrl = `${origin}/api/mcp`;
	let remainingCap = ctx.remainingCap ?? Number.POSITIVE_INFINITY;

	// ── Schema first: without the sink there is no value to extract, so don't pay.
	try {
		await ensureSchema();
	} catch (err) {
		log.warn('reputation_refresh_schema_failed', { message: err?.message });
		return { success: false, skipped: true, amountAtomic: 0, errorMsg: `schema_failed: ${err?.message}` };
	}

	// ── Eligible agents. A DB failure here is logged and the run exits cleanly.
	let agents;
	try {
		agents = await listAgentsToRefresh(REFRESH_BATCH);
	} catch (err) {
		log.error('reputation_refresh_list_failed', { message: err?.message });
		return { success: false, skipped: true, amountAtomic: 0, errorMsg: `db_list_failed: ${err?.message}` };
	}
	if (!agents.length) {
		log.info('reputation_refresh_no_agents');
		return { success: true, skipped: true, amountAtomic: 0, note: 'no_registered_agents' };
	}

	// ── Solana payment context: reuse the loop's, else bootstrap (graceful on an
	//    unconfigured wallet — bootstrap throws, we exit logged without paying).
	let { buyer, conn, blockhash, mintInfo } = ctx;
	if (!buyer || !conn || !blockhash || !mintInfo) {
		try {
			({ buyer, conn, blockhash, mintInfo } = await bootstrapSolanaContext({ buyer }));
		} catch (err) {
			log.info('reputation_refresh_skipped', { reason: err.message });
			return { success: false, skipped: true, amountAtomic: 0, errorMsg: err.message, note: 'wallet_or_rpc_unconfigured' };
		}
	}

	let spentAtomic = 0;
	let paid = 0;
	let stored = 0;
	let flaggedCount = 0;
	let callErrors = 0;
	let lastTxSig = null;

	for (let i = 0; i < agents.length; i++) {
		// The tick is out of time. The rest of the batch waits for the next run.
		if (ctx.shouldStop?.()) {
			log.info('reputation_refresh_tick_budget_spent', { done: i });
			break;
		}
		const agent = agents[i];

		// Stop before charging again if the next call would exceed the daily cap.
		if (Number.isFinite(remainingCap) && remainingCap < PRICE_ATOMIC) {
			log.info('reputation_refresh_cap_reached', { spent_atomic: spentAtomic });
			break;
		}

		const t0 = Date.now();
		let result;
		try {
			result = await payX402({
				url: endpointUrl,
				method: 'POST',
				body: jsonRpcReputation(agent.asset, agent.network, i + 1),
				buyer, conn, blockhash, mintInfo,
				remainingCap,
				// Distinct nonce per call so these identical-amount ($0.001) payments
				// against the one shared blockhash each produce a unique signature.
				nonce: i + 1,
			});
		} catch (err) {
			// Network failure / abort — log the call, never crash the sweep.
			callErrors += 1;
			await recordCall(runId, {
				agent, endpointUrl, amountAtomic: 0, txSig: null, responseData: null,
				durationMs: Date.now() - t0, success: false, errorMsg: err?.message || 'fetch_failed', valueExtracted: null,
			});
			continue;
		}

		if (result.paid) {
			spentAtomic += result.amountAtomic;
			remainingCap -= result.amountAtomic;
			paid += 1;
			if (result.txSig) lastTxSig = result.txSig;
		}

		let valueExtracted = null;
		let success = result.success;
		let errorMsg = result.errorMsg;

		if (result.success) {
			const rep = extractReputation(result.responseBody);
			if (!rep) {
				success = false;
				errorMsg = 'unparseable_response';
				callErrors += 1;
			} else {
				const evald = evaluateReputation(rep);
				valueExtracted = {
					agent_id: agent.id, asset: agent.asset, network: agent.network,
					score: evald.score, flagged: evald.flagged, reasons: evald.reasons,
					feedback_total: evald.total, feedback_verified: evald.verified,
					feedback_disputed: evald.disputed,
					validation_passed: evald.passed, validation_failed: evald.failed,
				};
				try {
					await upsertReputation(agent, rep, evald);
					stored += 1;
					if (evald.flagged) flaggedCount += 1;
				} catch (dbErr) {
					// Payment already settled; persisting the value failed. Mark the row
					// a failure so the agent is retried next tick.
					success = false;
					errorMsg = `store_failed: ${dbErr?.message || 'unknown'}`;
					callErrors += 1;
				}
			}
		} else {
			callErrors += 1;
		}

		await recordCall(runId, {
			agent,
			endpointUrl,
			amountAtomic: result.amountAtomic,
			txSig: result.txSig,
			// Keep the granular row lean — value_extracted holds the useful shape.
			responseData: { status: result.status, rpc_error: result.responseBody?.error || null },
			durationMs: Date.now() - t0,
			success,
			errorMsg,
			valueExtracted,
		});
	}

	log.info('reputation_refresh_complete', {
		run_id: runId, scanned: agents.length, paid, stored,
		flagged: flaggedCount, errors: callErrors, spent_usdc: (spentAtomic / 1e6).toFixed(4),
	});

	// Aggregate outcome for the loop's single summary row. success=true when at
	// least one agent's score was stored; per-agent detail lives in the rows above.
	return {
		success: stored > 0,
		amountAtomic: spentAtomic,
		txSig: lastTxSig,
		errorMsg: stored === 0 && callErrors > 0 ? `reputation_refresh_calls_failed:${callErrors}` : null,
		skipped: paid === 0 && stored === 0,
		responseData: { scanned: agents.length, paid, stored, flagged: flaggedCount, errors: callErrors },
		signalData: { scanned: agents.length, stored, flagged: flaggedCount },
		note: `reputation_refresh stored=${stored} flagged=${flaggedCount} paid=${paid}`,
	};
}

// ── Downstream consumers ────────────────────────────────────────────────────
// The data this pipeline extracts is read back through these helpers.

/** Trust badge on an agent profile: the stored on-chain reputation, or null. */
export async function getStoredSolanaReputation(agentId) {
	if (!agentId) return null;
	try {
		const [row] = await sql`
			select agent_id, agent_asset, network, score, feedback_total, feedback_verified,
			       feedback_disputed, validation_passed, validation_failed, flagged, refreshed_at
			from agent_solana_reputation where agent_id = ${agentId} limit 1
		`;
		return row || null;
	} catch {
		return null;
	}
}

/** Reputation leaderboard: top agents by stored on-chain score. */
export async function listSolanaReputationLeaderboard(limit = 50) {
	const n = Math.min(Math.max(1, Number(limit) || 50), 200);
	try {
		return await sql`
			select r.agent_id, r.agent_asset, r.network, r.score, r.feedback_total,
			       r.feedback_verified, r.flagged, r.refreshed_at, a.name
			from agent_solana_reputation r
			join agent_identities a on a.id = r.agent_id and a.deleted_at is null
			where r.feedback_total > 0
			order by r.score desc, r.feedback_verified desc
			limit ${n}
		`;
	} catch {
		return [];
	}
}

/** Moderation feed: agents currently flagged below the trust threshold. */
export async function listFlaggedSolanaAgents(limit = 100) {
	const n = Math.min(Math.max(1, Number(limit) || 100), 500);
	try {
		return await sql`
			select r.agent_id, r.agent_asset, r.network, r.score, r.feedback_total,
			       r.feedback_disputed, r.refreshed_at, a.name
			from agent_solana_reputation r
			join agent_identities a on a.id = r.agent_id and a.deleted_at is null
			where r.flagged = true
			order by r.score asc
			limit ${n}
		`;
	} catch {
		return [];
	}
}

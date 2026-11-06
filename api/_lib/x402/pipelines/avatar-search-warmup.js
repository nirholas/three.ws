// api/_lib/x402/pipelines/avatar-search-warmup.js
//
// Avatar Search Index Warmup — autonomous pipeline (self/003).
//
// On each run it pays for ~20 common gallery searches against the three.ws MCP
// server (/api/mcp → search_public_avatars). Each call is a real on-chain USDC
// payment from the seed wallet at the advertised $0.001/call. The pipeline:
//
//   1. Probes + pays each search via the shared payX402 client (real x402,
//      never mocked). A per-call nonce keeps the 20 identical-amount payments
//      distinct on-chain (otherwise equal transfers collide on one signature).
//   2. Validates the full search path returned ranked results WITH resolved
//      thumbnails — the warmup's real job is to prove the pipeline (DB query →
//      rig classifier → signed-thumbnail resolution) is live end-to-end.
//   3. Records a row in x402_autonomous_log for every call (success or failure),
//      with the parsed result summary in value_extracted.
//   4. Upserts each query's ranked, thumbnail-resolved slice into
//      avatar_search_warm_cache for the gallery's popular-search chips.
//
// Wiring: declared as a run()-style entry in autonomous-registry.js. The per-tick
// loop (api/cron/x402-autonomous-loop.js) hands run() a shared payment context
// (buyer, conn, blockhash, mintInfo, remainingCap); called standalone (manual
// test) it bootstraps its own context via bootstrapSolanaContext().
//
// Downstream consumer: GET /api/avatars/popular-searches reads
// avatar_search_warm_cache (via getPopularSearches) to render "popular search"
// suggestion chips — with a sample thumbnail per query — on the public gallery,
// and lets the gallery paint instant cached results for a common query before
// the live DB round-trip returns.

import { randomUUID } from 'node:crypto';

import { sql } from '../../db.js';
import { env } from '../../env.js';
import { logger } from '../../usage.js';
import { payX402, bootstrapSolanaContext, USDC_MINT } from '../pay.js';
import { ensureWarmCacheSchema, upsertWarmedSearch } from '../../avatar-search-warm.js';

const log = logger('x402-avatar-search-warmup');

// Common entry-point queries an agent or a first-time gallery visitor would type.
// Broad coverage of the public corpus exercises the whole ranking path and tells
// the gallery which queries surface the most inventory.
export const WARMUP_QUERIES = Object.freeze([
	'human', 'robot', 'anime', 'warrior', 'woman', 'man', 'dragon', 'cat',
	'knight', 'ninja', 'alien', 'zombie', 'fantasy', 'sci-fi', 'cyberpunk',
	'animal', 'monster', 'hero', 'mascot', 'character',
]);

const ASSET = USDC_MINT || 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// Anonymous x402 callers are capped at 10 results by the tool (bulk-enumeration
// guard in api/_mcp/tools/avatars.js); request exactly that.
function jsonRpcSearch(query, id) {
	return {
		jsonrpc: '2.0',
		id,
		method: 'tools/call',
		params: { name: 'search_public_avatars', arguments: { q: query, limit: 10 } },
	};
}

// Pull the ranked, render-ready slice out of an MCP tools/call response.
// Returns { topResults, thumbnails, resultCount, hasResult }. hasResult is false
// when the call errored or carried no structured avatars.
export function extractWarmValue(responseBody) {
	const sc = responseBody?.result?.structuredContent;
	const avatars = Array.isArray(sc?.avatars) ? sc.avatars : null;
	if (!avatars) return { topResults: [], thumbnails: [], resultCount: 0, hasResult: false };
	const topResults = avatars.slice(0, 8).map((a) => ({
		id: a?.id || null,
		name: a?.name || null,
		slug: a?.slug || null,
		thumbnail_url: a?.thumbnail_url || null,
	}));
	const thumbnails = topResults.map((r) => r.thumbnail_url).filter(Boolean);
	return { topResults, thumbnails, resultCount: avatars.length, hasResult: true };
}

async function ensureSchema() {
	await ensureWarmCacheSchema();
	// The autonomous log predates the run()-style pipelines; ensure the
	// value_extracted column the warmup records its parsed summary into exists
	// (idempotent; the bazaar pipeline adds the same column).
	await sql`ALTER TABLE x402_autonomous_log ADD COLUMN IF NOT EXISTS value_extracted jsonb`;
}

// Per-call row into x402_autonomous_log. The loop also records one aggregate
// summary row for the run() entry; these are the granular per-query rows.
async function recordCall(runId, { query, endpointUrl, amountAtomic, txSig, responseData, durationMs, success, errorMsg, valueExtracted }) {
	try {
		await sql`
			INSERT INTO x402_autonomous_log
				(run_id, endpoint_type, service_name, endpoint_url,
				 network, amount_atomic, asset, tx_signature,
				 response_data, value_extracted, duration_ms, success, error_msg, pipeline)
			VALUES
				(${runId}, ${'self'}, ${`Avatar Search Warmup: ${query}`}, ${endpointUrl},
				 ${'solana:mainnet'}, ${amountAtomic || 0}, ${ASSET}, ${txSig || null},
				 ${responseData ? JSON.stringify(responseData) : null},
				 ${valueExtracted ? JSON.stringify(valueExtracted) : null},
				 ${durationMs || 0}, ${success}, ${errorMsg || null}, ${'discovery'})
		`;
	} catch (err) {
		log.warn('avatar_warmup_log_insert_failed', { query, message: err?.message });
	}
}

/**
 * Run the warmup. Conforms to the run()-style registry contract: the loop hands
 * over { origin, buyer, conn, blockhash, mintInfo, remainingCap, runId }; when
 * any Solana context is absent (standalone / manual test) it bootstraps its own
 * via bootstrapSolanaContext().
 *
 * Returns the aggregate outcome the loop records as one summary row:
 *   { success, amountAtomic, txSig, errorMsg, responseData, skipped, note }
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
		log.warn('avatar_warmup_schema_failed', { message: err?.message });
		return { success: false, skipped: true, amountAtomic: 0, errorMsg: `schema_failed: ${err?.message}` };
	}

	// ── Solana payment context: reuse the loop's, else bootstrap (graceful on an
	//    unconfigured wallet — bootstrap throws, we exit logged without paying).
	let { buyer, conn, blockhash, mintInfo } = ctx;
	if (!buyer || !conn || !blockhash || !mintInfo) {
		try {
			({ buyer, conn, blockhash, mintInfo } = await bootstrapSolanaContext({ buyer }));
		} catch (err) {
			log.info('avatar_warmup_skipped', { reason: err.message });
			return { success: false, skipped: true, amountAtomic: 0, errorMsg: err.message, note: 'wallet_or_rpc_unconfigured' };
		}
	}

	let spentAtomic = 0;
	let paid = 0;
	let warmed = 0;
	let withThumbnails = 0;
	let callErrors = 0;
	let lastTxSig = null;

	for (let i = 0; i < WARMUP_QUERIES.length; i++) {
		// The tick is out of time. The rest of the batch waits for the next run.
		if (ctx.shouldStop?.()) {
			log.info('avatar_warmup_tick_budget_spent', { done: i });
			break;
		}
		const query = WARMUP_QUERIES[i];
		if (remainingCap <= 0) {
			log.info('avatar_warmup_cap_reached', { query, spent_atomic: spentAtomic });
			break;
		}

		const t0 = Date.now();
		let result;
		try {
			result = await payX402({
				url: endpointUrl,
				method: 'POST',
				body: jsonRpcSearch(query, i + 1),
				buyer, conn, blockhash, mintInfo,
				remainingCap,
				// Distinct priority fee per call so the 20 equal-amount payments
				// don't collide on one transaction signature.
				nonce: i + 1,
			});
		} catch (err) {
			// Network failure / abort — log the call, never crash the sweep.
			callErrors += 1;
			await recordCall(runId, {
				query, endpointUrl, amountAtomic: 0, txSig: null, responseData: null,
				durationMs: Date.now() - t0, success: false, errorMsg: err?.message || 'fetch_failed', valueExtracted: null,
			});
			continue;
		}

		const value = extractWarmValue(result.responseBody);

		// Store the warmed slice only when the call delivered structured avatars
		// (paid or free success). Failed / 402-rejected calls still get a log row.
		if (result.success && value.hasResult) {
			const stored = await upsertWarmedSearch({
				query,
				resultCount: value.resultCount,
				topResults: value.topResults,
				thumbnails: value.thumbnails,
				runId,
			});
			if (stored) warmed += 1;
			if (value.thumbnails.length > 0) withThumbnails += 1;
		} else {
			callErrors += 1;
		}

		if (result.paid) {
			spentAtomic += result.amountAtomic;
			remainingCap -= result.amountAtomic;
			paid += 1;
			if (result.txSig) lastTxSig = result.txSig;
		}

		await recordCall(runId, {
			query,
			endpointUrl,
			amountAtomic: result.amountAtomic,
			txSig: result.txSig,
			// Keep the audit row lean: the warm-cache row holds the avatar slice;
			// here we keep just the call status and any rpc-level error.
			responseData: { status: result.status, count: value.resultCount, has_thumbnails: value.thumbnails.length > 0, rpc_error: result.responseBody?.error || null },
			durationMs: Date.now() - t0,
			success: result.success && value.hasResult,
			errorMsg: result.errorMsg || (result.success && !value.hasResult ? 'no_structured_avatars' : null),
			valueExtracted: value.hasResult
				? { result_count: value.resultCount, thumbnails: value.thumbnails.length, sample: value.topResults.slice(0, 3) }
				: null,
		});
	}

	log.info('avatar_warmup_complete', {
		run_id: runId,
		queries: WARMUP_QUERIES.length,
		paid,
		warmed,
		with_thumbnails: withThumbnails,
		errors: callErrors,
		spent_usdc: (spentAtomic / 1e6).toFixed(4),
	});

	// Aggregate outcome for the loop's single summary row. success=true when at
	// least one query warmed the cache; per-call detail lives in the rows above.
	return {
		runId,
		success: warmed > 0,
		amountAtomic: spentAtomic,
		txSig: lastTxSig,
		errorMsg: warmed === 0 ? `avatar_warmup_no_results:errors=${callErrors}` : null,
		skipped: paid === 0 && warmed === 0,
		responseData: {
			queries: WARMUP_QUERIES.length,
			paid,
			warmed,
			with_thumbnails: withThumbnails,
			errors: callErrors,
		},
		note: `avatar_warmup paid=${paid} warmed=${warmed} thumbs=${withThumbnails}`,
	};
}

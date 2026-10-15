// Outbound receipts: what a three.ws-hosted agent spent at OTHER, external
// x402 merchants through a Payment Session (api/pay/session.js), enriched
// with the chain's own record of the settlement.
//
// payment_session_executions already stores what the settlement response
// CLAIMED (payer_address, payee_address, amount_usdc). This module resolves
// each settled, Solana-network execution's tx_hash against the chain itself
// (api/_lib/x402/solana-settlement.js) the first time anyone views it, then
// caches the resolved fields on the row so later views are free. Resolution
// is Solana-only for now (the home chain, see CLAUDE.md chain priority); a
// Base-network execution is listed using its reported fields, unresolved.

import { sql } from '../db.js';
import { atomicsToUsd, normalizeHost } from '../pay/policy.js';
import { resolveSettlement, SettlementResolveError } from './solana-settlement.js';

const RESOLVE_CONCURRENCY = 4;

async function mapLimit(items, limit, fn) {
	const out = new Array(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const i = next++;
			out[i] = await fn(items[i]);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
	return out;
}

/**
 * Resolve one row's settlement from chain and persist the result (success or
 * terminal error) so it is never re-fetched. Mutates nothing in the DB for a
 * row that is not eligible (non-Solana network, no tx_hash): those are left
 * for a future pass once/if they gain one.
 */
async function resolveAndCacheRow(row) {
	if (row.network !== 'solana' || !row.tx_hash) return row;
	try {
		const settlement = await resolveSettlement(row.tx_hash);
		const [updated] = await sql`
			UPDATE payment_session_executions
			SET resolved_payer = ${settlement.payer},
			    resolved_payee = ${settlement.payee},
			    resolved_mint = ${settlement.mint},
			    resolved_amount_atomics = ${settlement.amountAtomics},
			    resolved_decimals = ${settlement.decimals},
			    resolved_fee_lamports = ${settlement.feeLamports},
			    resolved_slot = ${settlement.slot},
			    resolved_block_time = ${settlement.blockTime},
			    resolved_at = now(),
			    resolve_error = null,
			    updated_at = now()
			WHERE id = ${row.id}
			RETURNING *
		`;
		return updated ?? row;
	} catch (err) {
		const code = err instanceof SettlementResolveError ? err.code : 'resolve_failed';
		const [updated] = await sql`
			UPDATE payment_session_executions
			SET resolved_at = now(),
			    resolve_error = ${code},
			    updated_at = now()
			WHERE id = ${row.id}
			RETURNING *
		`;
		return updated ?? row;
	}
}

function formatReceipt(row) {
	const resolved = row.resolved_at && !row.resolve_error
		? {
			payer: row.resolved_payer,
			payee: row.resolved_payee,
			mint: row.resolved_mint,
			amountAtomics: row.resolved_amount_atomics != null ? String(row.resolved_amount_atomics) : null,
			decimals: row.resolved_decimals,
			feeLamports: row.resolved_fee_lamports != null ? Number(row.resolved_fee_lamports) : null,
			slot: row.resolved_slot != null ? Number(row.resolved_slot) : null,
			blockTime: row.resolved_block_time != null ? Number(row.resolved_block_time) : null,
		}
		: null;

	return {
		id: row.id,
		sessionId: row.session_id,
		endpointUrl: row.endpoint_url,
		endpointHost: row.endpoint_host,
		method: row.method,
		network: row.network,
		reportedAmountUsd: atomicsToUsd(row.amount_usdc),
		txHash: row.tx_hash,
		reportedPayer: row.payer_address,
		reportedPayee: row.payee_address,
		status: row.status,
		createdAt: row.created_at,
		resolved,
		resolveError: row.resolved_at && row.resolve_error ? row.resolve_error : null,
		resolvePending: row.network === 'solana' && Boolean(row.tx_hash) && !row.resolved_at,
	};
}

/**
 * List settled outbound spends for a user, newest first, lazily resolving
 * any Solana rows that have never been resolved before formatting them.
 *
 * @param {string} userId
 * @param {{ limit?: number, cursor?: string|null, network?: string|null, host?: string|null }} [opts]
 */
export async function listOutboundReceipts(userId, { limit = 20, cursor = null, network = null, host = null } = {}) {
	const lim = Math.min(Math.max(Math.floor(Number(limit)) || 20, 1), 100);
	const net = network === 'solana' || network === 'base' ? network : null;
	const hostFilter = host ? normalizeHost(host) : null;

	const rows = await sql`
		SELECT *
		FROM payment_session_executions
		WHERE user_id = ${userId}
		  AND status = 'settled'
		  AND (${net}::text IS NULL OR network = ${net})
		  AND (${hostFilter}::text IS NULL OR endpoint_host = ${hostFilter})
		  AND (${cursor}::timestamptz IS NULL OR created_at < ${cursor}::timestamptz)
		ORDER BY created_at DESC
		LIMIT ${lim + 1}
	`;

	const hasMore = rows.length > lim;
	const page = rows.slice(0, lim);

	const resolvedPage = await mapLimit(page, RESOLVE_CONCURRENCY, (row) =>
		row.resolved_at ? row : resolveAndCacheRow(row),
	);

	const receipts = resolvedPage.map(formatReceipt);
	return {
		receipts,
		nextCursor: hasMore ? page[page.length - 1].created_at : null,
	};
}

/**
 * Aggregate KPIs across every settled outbound spend for a user: reported
 * total spend, how many are chain-verified vs still pending resolution, and
 * how many distinct merchants were paid.
 */
export async function summarizeOutboundReceipts(userId) {
	const [stats] = await sql`
		SELECT
			count(*) AS total,
			coalesce(sum(amount_usdc), 0) AS total_amount_atomics,
			count(*) FILTER (WHERE resolved_at IS NOT NULL AND resolve_error IS NULL) AS verified,
			count(*) FILTER (WHERE network = 'solana' AND (resolved_at IS NULL OR resolve_error IS NOT NULL)) AS unverified,
			count(DISTINCT endpoint_host) AS unique_merchants
		FROM payment_session_executions
		WHERE user_id = ${userId}
		  AND status = 'settled'
	`;

	return {
		total: Number(stats?.total ?? 0),
		totalSpendUsd: atomicsToUsd(stats?.total_amount_atomics ?? 0),
		verified: Number(stats?.verified ?? 0),
		unverified: Number(stats?.unverified ?? 0),
		uniqueMerchants: Number(stats?.unique_merchants ?? 0),
	};
}

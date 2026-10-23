// The revenue ledger: one row per income event across every way an agent earns,
// each linked to its transaction. The source tables stay the system of record;
// this module copies their rows in idempotently (unique on source + source_ref),
// values them in USD once, and serves the queries, totals and exports the
// /earnings pages use. Pure rules live in revenue-ledger-core.js.

import { sql } from './db.js';
import {
	SOURCES, SOURCE_KEYS, mapCreatorClaim, mapRevenueEvent, mapHire, mapRoyalty, mapInvoice, mapTradePnl,
	valueEntry, summarize, project, toCsv, inTotals, formatAtomics,
} from './revenue-ledger-core.js';
import { cachedSolUsd } from './trader-stats.js';
import { usdPrice } from './agent-commerce/assets.js';
import { TOKEN_MINT, TOKEN_DECIMALS } from './token/config.js';

const CHUNK = 200;

async function loadPrices() {
	const [sol, three] = await Promise.all([cachedSolUsd().catch(() => null), usdPrice('THREE').catch(() => null)]);
	return { SOL: sol > 0 ? sol : null, THREE: three > 0 ? three : null };
}

/** Read every source row in scope, mapped to ledger entries (unvalued where a price is needed). */
async function collect({ userId = null, agentId = null, since = null }) {
	const u = userId;
	const a = agentId;
	const s = since;
	const [claims, events, hires, royalties, invoices, trades] = await Promise.all([
		sql`
			select c.id, c.agent_id, ai.user_id, c.mint, c.claimed_lamports, c.buyback_sol, c.buyback_sig, c.claim_sig, c.network, c.created_at
			from launcher_claims c join agent_identities ai on ai.id = c.agent_id
			where c.claim_sig is not null and c.claimed_lamports > 0
			  and (${u}::uuid is null or ai.user_id = ${u}) and (${a}::uuid is null or c.agent_id = ${a})
			  and (${s}::timestamptz is null or c.created_at >= ${s})`,
		sql`
			select r.id, r.agent_id, coalesce(r.owner_user_id, ai.user_id) as owner_user_id, r.intent_id, r.skill,
			       r.gross_amount, r.fee_amount, r.net_amount, r.currency_mint, r.chain, r.payer_address, r.settled_to_wallet, r.created_at
			from agent_revenue_events r join agent_identities ai on ai.id = r.agent_id
			where r.net_amount > 0
			  and (${u}::uuid is null or coalesce(r.owner_user_id, ai.user_id) = ${u}) and (${a}::uuid is null or r.agent_id = ${a})
			  and (${s}::timestamptz is null or r.created_at >= ${s})`,
		sql`
			select id, provider_agent_id, provider_user_id, service_slug, skill_name, amount_atomics, usd, currency, status,
			       payment_signature, invocation_signature, payer_address, created_at, completed_at
			from agent_hires
			where status = 'completed' and provider_agent_id is not null and provider_user_id is not null
			  and (${u}::uuid is null or provider_user_id = ${u}) and (${a}::uuid is null or provider_agent_id = ${a})
			  and (${s}::timestamptz is null or coalesce(completed_at, created_at) >= ${s})`,
		a
			? Promise.resolve([])
			: sql`
			select id, skill_id, agent_id, author_user_id, price_usd, status, settled_at, tx_hash, network, payer, source, platform_fee_usd, created_at
			from royalty_ledger
			where status = 'settled' and author_user_id is not null
			  and (${u}::uuid is null or author_user_id = ${u})
			  and (${s}::timestamptz is null or coalesce(settled_at, created_at) >= ${s})`,
		sql`
			select i.id, i.number, i.user_id, i.agent_id, i.asset, i.decimals, i.paid_atomics, i.paid_usd, i.paid_at, i.updated_at,
			       i.paid_by, i.payer_address, i.paid_late, i.network, i.status,
			       (select p.signature from agent_commerce_invoice_payments p where p.invoice_id = i.id and p.counted order by p.created_at limit 1) as payment_signature
			from agent_commerce_invoices i
			where i.status = 'paid'
			  and (${u}::uuid is null or i.user_id = ${u}) and (${a}::uuid is null or i.agent_id = ${a})
			  and (${s}::timestamptz is null or coalesce(i.paid_at, i.updated_at) >= ${s})`,
		sql`
			select id, agent_id, user_id, network, mint, symbol, status, exit_reason, sell_sig, realized_pnl_lamports, realized_pnl_pct, exec_route, opened_at, closed_at
			from agent_sniper_positions
			where status = 'closed' and realized_pnl_lamports is not null
			  and (${u}::uuid is null or user_id = ${u}) and (${a}::uuid is null or agent_id = ${a})
			  and (${s}::timestamptz is null or closed_at >= ${s})`,
	]);
	const three = { threeMint: TOKEN_MINT, threeDecimals: TOKEN_DECIMALS };
	return [
		...claims.map(mapCreatorClaim),
		...events.map((r) => mapRevenueEvent(r, three)),
		...hires.map(mapHire),
		...royalties.map(mapRoyalty),
		...invoices.map(mapInvoice),
		...trades.map(mapTradePnl),
	].filter(Boolean);
}

/**
 * Copy new income rows into the ledger and value any still-unvalued ones.
 * Idempotent: a row already present keeps its recorded USD, and only a missing
 * valuation or signature is filled in. Returns counts for the cron log.
 * @param {{ userId?: string|null, agentId?: string|null, since?: string|null }} scope
 */
export async function syncLedger(scope = {}) {
	const prices = await loadPrices();
	const entries = (await collect(scope)).map((e) => valueEntry(e, prices));
	let written = 0;
	for (let i = 0; i < entries.length; i += CHUNK) {
		const chunk = entries.slice(i, i + CHUNK);
		const rows = await sql`
			insert into revenue_ledger_entries
				(user_id, agent_id, source, kind, source_ref, occurred_at, asset, amount_atomics, decimals, usd, usd_basis, usd_price,
				 tx_signature, chain, network, counterparty, label, counted, exclusion_reason, meta)
			select t.user_id, t.agent_id, t.source, t.kind, t.source_ref, t.occurred_at, t.asset, t.amount_atomics, t.decimals, t.usd, t.usd_basis, t.usd_price,
			       t.tx_signature, t.chain, t.network, t.counterparty, t.label, t.counted, t.exclusion_reason, t.meta
			from jsonb_to_recordset(${JSON.stringify(chunk)}::jsonb) as t(
				user_id uuid, agent_id uuid, source text, kind text, source_ref text, occurred_at timestamptz, asset text,
				amount_atomics numeric, decimals int, usd numeric, usd_basis text, usd_price numeric, tx_signature text,
				chain text, network text, counterparty text, label text, counted boolean, exclusion_reason text, meta jsonb)
			on conflict (source, source_ref) do update set
				usd = coalesce(revenue_ledger_entries.usd, excluded.usd),
				usd_basis = case when revenue_ledger_entries.usd is null and excluded.usd is not null then excluded.usd_basis else revenue_ledger_entries.usd_basis end,
				usd_price = coalesce(revenue_ledger_entries.usd_price, excluded.usd_price),
				tx_signature = coalesce(revenue_ledger_entries.tx_signature, excluded.tx_signature),
				counted = excluded.counted,
				exclusion_reason = excluded.exclusion_reason,
				synced_at = now()
			returning (xmax = 0) as inserted`;
		written += rows.filter((r) => r.inserted).length;
	}
	return { scanned: entries.length, inserted: written, prices };
}

const ENTRY_COLS = sql`id, user_id, agent_id, source, kind, source_ref, occurred_at, asset, amount_atomics, decimals, usd, usd_basis, usd_price,
	tx_signature, chain, network, counterparty, label, counted, exclusion_reason, chain_status, chain_checked_at, chain_detail`;

/** Ledger rows for an owner (all agents) or one agent, newest first. */
export async function listEntries({ userId, agentId = null, source = null, from = null, to = null, limit = 500, before = null }) {
	const rows = await sql`
		select ${ENTRY_COLS} from revenue_ledger_entries
		where user_id = ${userId}
		  and (${agentId}::uuid is null or agent_id = ${agentId})
		  and (${source}::text is null or source = ${source})
		  and (${from}::timestamptz is null or occurred_at >= ${from})
		  and (${to}::timestamptz is null or occurred_at < ${to})
		  and (${before}::timestamptz is null or occurred_at < ${before})
		order by occurred_at desc, id
		limit ${Math.min(Math.max(Number(limit) || 500, 1), 50000)}`;
	return rows.map(shape);
}

function shape(r) {
	return {
		...r,
		amount_atomics: String(r.amount_atomics),
		amount: formatAtomics(String(r.amount_atomics), r.decimals),
		usd: r.usd == null ? null : Number(r.usd),
		usd_price: r.usd_price == null ? null : Number(r.usd_price),
		occurred_at: new Date(r.occurred_at).toISOString(),
		explorer_url: r.tx_signature && r.chain === 'solana' ? `https://solscan.io/tx/${r.tx_signature}${r.network === 'devnet' ? '?cluster=devnet' : ''}` : null,
	};
}

/** Summary, projection and the creator-fee memo for a scope. */
export async function ledgerView({ userId, agentId = null, period = 'month', from = null, to = null, windowDays = 30 }) {
	const entries = await listEntries({ userId, agentId, limit: 50000 });
	const summary = summarize(entries, { period, from, to });
	const projection = project(entries, { windowDays });
	const unclaimed = await unclaimedCreatorFees({ userId, agentId }).catch(() => null);
	const last = await sql`select max(synced_at) as at from revenue_ledger_entries where user_id = ${userId} and (${agentId}::uuid is null or agent_id = ${agentId})`;
	const chain = { verified: 0, unchecked: 0, issues: 0 };
	for (const e of entries) {
		if (!inTotals(e) || !e.tx_signature) continue;
		if (e.chain_status === 'verified') chain.verified++;
		else if (e.chain_status === 'mismatch' || e.chain_status === 'not_found') chain.issues++;
		else chain.unchecked++;
	}
	return {
		summary, projection, unclaimed_creator_fees: unclaimed, chain_verification: chain,
		entries_total: entries.length, synced_at: last[0]?.at ? new Date(last[0].at).toISOString() : null,
		sources: SOURCES.map(({ key, label, kind, how }) => ({ key, label, kind, how })),
		not_included: ['EVM and Base sales (shown in the entry list as excluded, never in totals)', 'Devnet activity (test traffic)', 'Unclaimed creator fees (a memo below, counted once claimed)'],
	};
}

/** Creator fees earned but not yet claimed, from the earnings snapshot (a memo, not income yet). */
async function unclaimedCreatorFees({ userId, agentId }) {
	const [row] = await sql`
		select coalesce(sum(e.unclaimed_lamports), 0)::numeric as lamports, max(e.refreshed_at) as refreshed_at
		from agent_coin_earnings e join agent_identities ai on ai.id = e.agent_id
		where ai.user_id = ${userId} and e.network = 'mainnet' and e.source = 'pumpfun_creator_fees'
		  and (${agentId}::uuid is null or e.agent_id = ${agentId})`;
	const lamports = BigInt(String(row?.lamports ?? 0).split('.')[0]);
	if (lamports <= 0n) return { sol: '0', usd: 0, refreshed_at: row?.refreshed_at ? new Date(row.refreshed_at).toISOString() : null };
	const price = await cachedSolUsd().catch(() => null);
	const sol = formatAtomics(lamports, 9);
	return { sol, usd: price ? Math.round(Number(sol) * price * 100) / 100 : null, refreshed_at: row?.refreshed_at ? new Date(row.refreshed_at).toISOString() : null };
}

export async function exportCsv(args) {
	return toCsv(await listEntries({ ...args, limit: 50000 }));
}

// ── public toggle ───────────────────────────────────────────────────────────

export async function getSettings(agentId) {
	const [r] = await sql`select agent_id, user_id, public_earnings, public_since from revenue_ledger_settings where agent_id = ${agentId}`;
	return r ? { public_earnings: r.public_earnings, public_since: r.public_since } : { public_earnings: false, public_since: null };
}

export async function setPublic({ agentId, userId, isPublic }) {
	const [r] = await sql`
		insert into revenue_ledger_settings (agent_id, user_id, public_earnings, public_since, updated_at)
		values (${agentId}, ${userId}, ${isPublic}, ${isPublic ? new Date().toISOString() : null}, now())
		on conflict (agent_id) do update set
			public_earnings = excluded.public_earnings,
			public_since = case when excluded.public_earnings and not revenue_ledger_settings.public_earnings then now()
			                    when excluded.public_earnings then revenue_ledger_settings.public_since else null end,
			updated_at = now()
		returning public_earnings, public_since`;
	return r;
}

/**
 * The public earnings page for an agent whose owner switched it on. Everything
 * shown is a ledger row with its transaction; counterparty addresses are
 * withheld and amounts are the same numbers the owner sees.
 */
export async function publicView({ agentId, period = 'month' }) {
	const [agent] = await sql`select id, user_id, name from agent_identities where id = ${agentId} and deleted_at is null`;
	if (!agent) return null;
	const settings = await getSettings(agentId);
	if (!settings.public_earnings) return null;
	const view = await ledgerView({ userId: agent.user_id, agentId, period });
	const entries = (await listEntries({ userId: agent.user_id, agentId, limit: 200 })).map((e) => ({
		occurred_at: e.occurred_at, source: e.source, label: e.label, asset: e.asset, amount: e.amount, usd: e.usd, usd_basis: e.usd_basis,
		tx_signature: e.tx_signature, explorer_url: e.explorer_url, chain: e.chain, network: e.network, counted: e.counted,
		exclusion_reason: e.exclusion_reason, chain_status: e.chain_status,
	}));
	return { agent: { id: agent.id, name: agent.name }, public_since: settings.public_since, ...view, entries };
}

export { SOURCE_KEYS };

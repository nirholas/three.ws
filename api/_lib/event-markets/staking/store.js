// SQL for staked Event Markets: pools, the verified stake ledger, the kill
// switch and age/region attestations. Tables: migrations/20261013000000_event_market_staking.sql.

import { sql } from '../../db.js';

const big = (v) => BigInt(v ?? 0);

export function poolFromRow(r) {
	if (!r) return null;
	return {
		marketId: r.market_id, cluster: r.cluster, programId: r.program_id, poolIdHex: r.pool_id_hex,
		poolAddress: r.pool_address, mint: r.mint, tokenKey: r.token_key, decimals: r.decimals,
		outcomeIds: r.outcome_ids, minStake: big(r.min_stake), maxStake: big(r.max_stake), maxPool: big(r.max_pool),
		feeBps: r.fee_bps, buybackShareBps: r.buyback_share_bps, lockAt: r.lock_at, voidAfter: r.void_after,
		status: r.status, createSignature: r.create_signature, resolveSignature: r.resolve_signature,
	};
}

export async function getPoolByMarket(marketId) {
	const [row] = await sql`select * from event_market_stake_pools where market_id = ${marketId}`;
	return poolFromRow(row);
}

export async function getPoolByAddress(address) {
	const [row] = await sql`select * from event_market_stake_pools where pool_address = ${address}`;
	return poolFromRow(row);
}

export async function listPools() {
	return (await sql`select * from event_market_stake_pools order by created_at desc`).map(poolFromRow);
}

export async function insertPool(p) {
	await sql`
		insert into event_market_stake_pools
			(market_id, cluster, program_id, pool_id_hex, pool_address, mint, token_key, decimals, outcome_ids,
			 min_stake, max_stake, max_pool, fee_bps, buyback_share_bps, lock_at, void_after, create_signature)
		values (${p.marketId}, ${p.cluster}, ${p.programId}, ${p.poolIdHex}, ${p.poolAddress}, ${p.mint}, ${p.tokenKey}, ${p.decimals},
			${p.outcomeIds}::uuid[], ${p.minStake.toString()}, ${p.maxStake.toString()}, ${p.maxPool.toString()},
			${p.feeBps}, ${p.buybackShareBps}, ${p.lockAt}, ${p.voidAfter}, ${p.createSignature})`;
}

export async function markPoolStatus(marketId, status, signature = null) {
	await sql`update event_market_stake_pools set status = ${status}, resolve_signature = coalesce(${signature}, resolve_signature) where market_id = ${marketId}`;
}

/** Idempotent on signature: re-recording a confirmed transaction is a no-op. */
export async function recordLedger({ marketId, accountId, wallet, kind, outcomeIndex, amount, signature, slot }) {
	const [row] = await sql`
		insert into event_market_stakes (market_id, account_id, wallet, kind, outcome_index, amount, signature, slot)
		values (${marketId}, ${accountId}, ${wallet}, ${kind}, ${outcomeIndex}, ${amount.toString()}, ${signature}, ${slot})
		on conflict (signature) do nothing
		returning id`;
	return Boolean(row);
}

/** Sum of an account's recorded stake on one market, and over the last 24h across all markets. */
export async function accountExposure(accountId, marketId) {
	const [row] = await sql`
		select coalesce(sum(amount) filter (where market_id = ${marketId}), 0)::text as on_market,
		       coalesce(sum(amount) filter (where created_at > now() - interval '24 hours'), 0)::text as day
		  from event_market_stakes where account_id = ${accountId} and kind = 'stake'`;
	return { onMarket: big(row.on_market), day: big(row.day) };
}

export async function ledgerTotals(marketId) {
	const [row] = await sql`
		select coalesce(sum(amount) filter (where kind = 'stake'), 0)::text as staked,
		       coalesce(sum(amount) filter (where kind in ('claim', 'refund')), 0)::text as paid_out,
		       count(*) filter (where kind = 'stake')::int as stakes
		  from event_market_stakes where market_id = ${marketId}`;
	return { staked: big(row.staked), paidOut: big(row.paid_out), stakes: row.stakes };
}

export async function getSettings() {
	const [row] = await sql`select stakes_enabled, updated_at from event_market_stake_settings where id = 1`;
	return { stakesEnabled: row ? row.stakes_enabled : true, updatedAt: row?.updated_at ?? null };
}

export async function setStakesEnabled(enabled, adminId) {
	await sql`
		insert into event_market_stake_settings (id, stakes_enabled, updated_by, updated_at) values (1, ${enabled}, ${adminId}, now())
		on conflict (id) do update set stakes_enabled = excluded.stakes_enabled, updated_by = excluded.updated_by, updated_at = now()`;
}

export async function getAttestation(accountId) {
	const [row] = await sql`select min_age, country, terms_version, attested_at from event_market_stake_attestations where account_id = ${accountId}`;
	return row || null;
}

export async function saveAttestation(accountId, { minAge, country, termsVersion }) {
	await sql`
		insert into event_market_stake_attestations (account_id, min_age, country, terms_version)
		values (${accountId}, ${minAge}, ${country}, ${termsVersion})
		on conflict (account_id) do update set min_age = excluded.min_age, country = excluded.country,
			terms_version = excluded.terms_version, attested_at = now()`;
}

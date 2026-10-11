// Real platform totals for GET /api/stats. Every figure is one SQL aggregate
// over the table that holds the fact; each carries its source and the time it
// was read. A figure whose query fails is reported as unavailable, never zero.

import { sql } from './db.js';

const LAMPORTS_PER_SOL = 1_000_000_000;

const METRICS = [
	{
		key: 'agents',
		unit: 'agents',
		source: 'agent_identities (not deleted)',
		read: async () => (await sql`select count(*)::int as n from agent_identities where deleted_at is null`)[0].n,
	},
	{
		key: 'launches',
		unit: 'coins',
		source: 'pump_agent_mints + native_launches (mainnet)',
		read: async () =>
			(
				await sql`select (
					(select count(*) from pump_agent_mints where network = 'mainnet') +
					(select count(*) from native_launches where network = 'mainnet')
				)::int as n`
			)[0].n,
	},
	{
		key: 'volume_sol',
		unit: 'SOL',
		source: 'pump_agent_trades (mainnet, absolute lamports)',
		read: async () => {
			const [row] = await sql`select coalesce(sum(abs(sol_amount)), 0)::text as lamports from pump_agent_trades where network = 'mainnet'`;
			return Math.round((Number(row.lamports) / LAMPORTS_PER_SOL) * 1000) / 1000;
		},
	},
	{
		key: 'earnings_paid',
		unit: 'payouts completed',
		source: 'payouts (status = completed), base units per currency mint',
		read: async () => {
			const rows = await sql`
				select currency_mint, count(*)::int as payouts, coalesce(sum(amount), 0)::text as base_units
				from payouts where status = 'completed' group by currency_mint order by sum(amount) desc
			`;
			return {
				payouts: rows.reduce((n, r) => n + r.payouts, 0),
				by_currency: rows.map((r) => ({ currency_mint: r.currency_mint, payouts: r.payouts, base_units: r.base_units })),
			};
		},
	},
	{
		key: 'active_strategies',
		unit: 'equipped strategies',
		source: 'agent_strategy_equips (active = true)',
		read: async () => (await sql`select count(*)::int as n from agent_strategy_equips where active = true`)[0].n,
	},
];

/** @returns {Promise<Record<string, { value: unknown, unit: string, source: string, as_of: string } | { available: false, source: string, as_of: string }>>} */
export async function gatherPlatformStats() {
	const entries = await Promise.all(
		METRICS.map(async (m) => {
			const asOf = new Date().toISOString();
			try {
				return [m.key, { value: await m.read(), unit: m.unit, source: m.source, as_of: asOf }];
			} catch (err) {
				console.warn(`[stats] ${m.key} unavailable:`, err?.message || err);
				return [m.key, { available: false, source: m.source, as_of: asOf }];
			}
		}),
	);
	return Object.fromEntries(entries);
}

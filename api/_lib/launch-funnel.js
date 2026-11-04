// Agent launch funnel: one append-only row per step an agent takes from "plan
// drafted" to "coin launched", and the read side that turns those rows into the
// step counts the experiment doc quotes.
//
//   plan_drafted           the platform drafted a coin plan for a new agent
//   plan_viewed            the owner saw the plan card
//   plan_edited            the owner saved a change to the plan
//   wallet_funded          the owner opened the launch screen with a funded wallet
//   launch_confirm_opened  the owner reached the confirmation screen
//   launch_submitted       a launch transaction was built for signing
//   launch_succeeded       the mint confirmed on chain
//
// Counts are DISTINCT AGENTS per step, so a visitor who reloads ten times is one
// plan_viewed. Writes never throw: a funnel row must not be able to fail a
// launch, a plan save, or an agent creation.

import { sql } from './db.js';

export const FUNNEL_STEPS = Object.freeze([
	'plan_drafted',
	'plan_viewed',
	'plan_edited',
	'wallet_funded',
	'launch_confirm_opened',
	'launch_submitted',
	'launch_succeeded',
]);

/** Steps the browser may report. The rest are written only by server code. */
export const CLIENT_FUNNEL_STEPS = Object.freeze(['plan_viewed', 'wallet_funded', 'launch_confirm_opened']);

const NETWORKS = ['mainnet', 'devnet'];

/**
 * Record one funnel step. Resolves to true when a row was written.
 * @param {{ agentId: string, userId?: string|null, step: string, network?: string }} o
 */
export async function recordFunnelStep({ agentId, userId = null, step, network = 'mainnet' }) {
	if (!agentId || !FUNNEL_STEPS.includes(step)) return false;
	const net = NETWORKS.includes(network) ? network : 'mainnet';
	try {
		await sql`
			insert into agent_launch_funnel_events (agent_id, user_id, step, network)
			values (${agentId}, ${userId}, ${step}, ${net})
		`;
		return true;
	} catch (err) {
		console.warn('[launch-funnel] record failed:', err?.message);
		return false;
	}
}

/**
 * Step counts for agents created in [from, to). Cohort-based: every count is
 * over the agents created in the window, so each step is a fraction of the one
 * before it and the numbers compare run to run.
 *
 * @param {{ from: string, to: string, network?: string }} o ISO timestamps
 */
export async function gatherLaunchFunnel({ from, to, network = 'mainnet' }) {
	const net = NETWORKS.includes(network) ? network : 'mainnet';
	const [base] = await sql`
		select count(*)::int as agents_created,
		       count(*) filter (where coalesce(meta->>'solana_address','') <> '')::int as with_solana_wallet
		from agent_identities
		where created_at >= ${from} and created_at < ${to}
	`;
	const [drafts] = await sql`
		select count(distinct p.agent_id)::int as plans_saved
		from agent_token_plans p
		join agent_identities a on a.id = p.agent_id
		where a.created_at >= ${from} and a.created_at < ${to}
		  and p.network = ${net} and p.auto_drafted = false
	`;
	const [launched] = await sql`
		select count(distinct m.agent_id)::int as agents_launched
		from pump_agent_mints m
		join agent_identities a on a.id = m.agent_id
		where a.created_at >= ${from} and a.created_at < ${to} and m.network = ${net}
	`;
	const stepRows = await sql`
		select e.step, count(distinct e.agent_id)::int as agents
		from agent_launch_funnel_events e
		join agent_identities a on a.id = e.agent_id
		where a.created_at >= ${from} and a.created_at < ${to} and e.network = ${net}
		group by e.step
	`;
	const byStep = Object.fromEntries(stepRows.map((r) => [r.step, r.agents]));
	return {
		window: { from, to },
		network: net,
		agents_created: base?.agents_created ?? 0,
		with_solana_wallet: base?.with_solana_wallet ?? 0,
		plans_saved_by_owner: drafts?.plans_saved ?? 0,
		agents_launched: launched?.agents_launched ?? 0,
		steps: FUNNEL_STEPS.map((step) => ({ step, agents: byStep[step] ?? 0 })),
	};
}

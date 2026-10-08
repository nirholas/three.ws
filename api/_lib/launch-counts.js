// @ts-check
// Mainnet coin launches per user: the single count behind the `launches` metric
// of GET /api/leaderboard/unified and the daily top-10 badge sweep in
// api/cron/leaderboard-rollup.js, so the board and the badge rank the same way.
//
// A launch is a mainnet mint recorded in the platform's own launch records:
// pump_agent_mints (every pump.fun launch, including the ones signed by an
// agent's custodial wallet) or fixed_supply_launches (fixed-supply venue
// launches). Each mint counts once. Both used to read
// agent_identities.meta.token.mint instead, which agent-wallet launches leave
// empty, so the board undercounted every builder who launched from an agent.
//
// A pump.fun launch counts when its agent is public and not deleted, as before.
// A fixed-supply launch counts when it has no agent or its agent is public.

import { sql } from './db.js';

/**
 * @param {{ limit?: number | null }} [opts] `limit` keeps the top N, highest first.
 * @returns {Promise<Array<{ user_id: string, value: string }>>}
 */
export function launchCountsByUser({ limit = null } = {}) {
	const top = limit == null ? sql`` : sql`limit ${limit}`;
	return sql`
		with launches as (
			select pam.user_id, pam.mint
			from pump_agent_mints pam
			join agent_identities ai on ai.id = pam.agent_id
			where pam.network = 'mainnet'
			  and ai.is_public = true
			  and ai.deleted_at is null
			union
			select fsl.user_id, fsl.mint
			from fixed_supply_launches fsl
			left join agent_identities ai on ai.id = fsl.agent_id
			where fsl.network = 'mainnet'
			  and (fsl.agent_id is null or (ai.is_public = true and ai.deleted_at is null))
		)
		select user_id, count(distinct mint)::bigint as value
		from launches
		where user_id is not null
		group by user_id
		order by value desc, user_id
		${top}
	`;
}

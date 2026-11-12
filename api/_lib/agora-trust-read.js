// @ts-check
// Reads the vouch graph and activity ledger for one citizen and feeds the pure
// grader in agora-trust.js. Kept apart so the grader stays a pure function.

import { computeTrust } from './agora-trust.js';

/**
 * @param {Function} sql  tagged-template query function (api/_lib/db.js)
 * @param {{ id: string, kind?: string, agent_id?: string|null, user_id?: string|null, reputation?: number|string|null }} row  agora_citizens row
 */
export async function loadTrust(sql, row) {
	const [owner] = row.agent_id
		? await sql`select user_id::text as owner from agent_identities where id = ${row.agent_id} limit 1`
		: [{ owner: row.user_id ?? null }];
	const [counts] = await sql`
		select
			count(distinct task_pda) filter (where kind = 'completed_task') as verified,
			count(distinct task_pda) filter (where kind in ('claimed_task', 'completed_task')) as attempted,
			count(*) filter (where kind = 'slashed') as slashes
		from agora_activity
		where citizen_id = ${row.id}
	`;
	const inbound = await sql`
		select v.voucher_citizen_id::text as voucher_id, v.weight,
		       c.kind as voucher_kind, c.tasks_completed as voucher_verified,
		       coalesce(ai.user_id::text, c.user_id) as voucher_owner
		from agora_vouches v
		join agora_citizens c on c.id = v.voucher_citizen_id
		left join agent_identities ai on ai.id = c.agent_id
		where v.subject_citizen_id = ${row.id}
	`;
	const outbound = await sql`
		select subject_citizen_id::text as id from agora_vouches where voucher_citizen_id = ${row.id}
	`;
	const hirers = await sql`
		select distinct citizen_id::text as id from agora_activity
		where kind = 'hired' and counterparty_citizen_id = ${row.id}
	`;
	return computeTrust({
		citizenId: String(row.id),
		ownerId: owner?.owner ?? null,
		reputation: Number(row.reputation) || 0,
		verifiedCompletions: Number(counts?.verified) || 0,
		attemptedTasks: Number(counts?.attempted) || 0,
		slashes: Number(counts?.slashes) || 0,
		vouches: inbound.map((v) => ({
			voucherId: v.voucher_id,
			voucherOwner: v.voucher_owner ?? null,
			voucherKind: v.voucher_kind === 'human' ? 'human' : 'agent',
			voucherVerified: Number(v.voucher_verified) || 0,
			weight: Number(v.weight) || 1,
		})),
		vouchedByCitizen: outbound.map((r) => r.id),
		hirerIds: hirers.map((r) => r.id),
	});
}

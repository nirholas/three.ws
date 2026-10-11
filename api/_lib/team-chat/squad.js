// Resolve who the owner is talking to.
//
// A squad is either a specialist team (the `teams` runtime, when installed and
// the id is a team the owner holds) or a solo squad: one agent the owner owns,
// filling every role itself. The coordinator works the same way over both; only
// the specialist adapters (specialists.js) differ, and a solo squad needs no
// team tables at all, so this surface stands on its own.
//
// The policy agent is the one whose wallet and spend policy every trade runs
// through: the team's policy agent, else its Trader, else the solo agent.

import { sql } from '../db.js';
import { publicUrlOrNull, thumbnailUrl } from '../r2.js';

export const CHAT_ROLES = Object.freeze(['researcher', 'entry', 'trader', 'launcher']);

// When a team has no member in a role, the step is routed to the next best
// member. The Trader and the Launcher never stand in for each other: those are
// the two roles with authority to spend or launch.
const ROLE_FALLBACK = Object.freeze({
	researcher: ['researcher', 'trader', 'custom'],
	entry: ['entry', 'custom', 'trader'],
	trader: ['trader'],
	launcher: ['launcher'],
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v) {
	return typeof v === 'string' && UUID_RE.test(v);
}

let teamsInstalled = null;
async function teamsTableExists() {
	if (teamsInstalled === true) return true;
	const [row] = await sql`select to_regclass('public.teams') is not null as ok, to_regclass('public.team_members') is not null as members`;
	teamsInstalled = Boolean(row?.ok && row?.members);
	return teamsInstalled;
}

function shapeMember(row) {
	return {
		member_id: row.member_id || null,
		role: row.role,
		agent_id: row.agent_id,
		name: row.name || 'Agent',
		avatar_id: row.avatar_id || null,
		wallet: row.meta?.solana_address || null,
		model_url: row.storage_key ? publicUrlOrNull(row.storage_key) : null,
		thumbnail_url: row.thumbnail_key ? thumbnailUrl(row.thumbnail_key) : null,
		permissions: row.permissions || null,
		status: row.status || 'active',
	};
}

/** Pick the member that serves `role`, following the fallback order. */
export function memberForRole(squad, role) {
	if (role === 'coordinator') return squad.members.find((m) => m.agent_id === squad.policy_agent_id) || squad.members[0] || null;
	for (const r of ROLE_FALLBACK[role] || [role]) {
		const m = squad.members.find((x) => x.role === r);
		if (m) return m;
	}
	return null;
}

async function loadTeamSquad(id, userId) {
	const [team] = await sql`
		select id, owner_user_id, name, network, status, policy_agent_id, policy
		from teams where id = ${id} and archived_at is null limit 1
	`;
	if (!team || team.owner_user_id !== userId) return null;
	const rows = await sql`
		select m.id as member_id, m.role, m.agent_id, m.permissions, m.status,
		       a.name, a.avatar_id, a.meta, av.storage_key, av.thumbnail_key
		from team_members m
		join agent_identities a on a.id = m.agent_id and a.deleted_at is null
		left join avatars av on av.id = a.avatar_id and av.deleted_at is null
		where m.team_id = ${id} and m.status = 'active'
		order by m.created_at
	`;
	const members = rows.map(shapeMember);
	const trader = members.find((m) => m.role === 'trader');
	const policy = team.policy || {};
	return {
		kind: 'team',
		id: team.id,
		name: team.name,
		network: team.network === 'devnet' ? 'devnet' : 'mainnet',
		status: team.status,
		policy_agent_id: team.policy_agent_id || trader?.agent_id || null,
		policy: {
			per_trade_sol: Number.isFinite(Number(policy.per_trade_sol)) ? Number(policy.per_trade_sol) : null,
			daily_budget_sol: Number.isFinite(Number(policy.daily_budget_sol)) ? Number(policy.daily_budget_sol) : null,
			allow_caution: policy.allow_caution === true,
		},
		members,
		team,
	};
}

async function loadAgentSquad(id, userId) {
	const [agent] = await sql`
		select a.id, a.user_id, a.name, a.avatar_id, a.meta, av.storage_key, av.thumbnail_key
		from agent_identities a
		left join avatars av on av.id = a.avatar_id and av.deleted_at is null
		where a.id = ${id} and a.deleted_at is null limit 1
	`;
	if (!agent || agent.user_id !== userId) return null;
	const members = CHAT_ROLES.map((role) => shapeMember({ role, agent_id: agent.id, name: agent.name, avatar_id: agent.avatar_id, meta: agent.meta, storage_key: agent.storage_key, thumbnail_key: agent.thumbnail_key }));
	return {
		kind: 'agent',
		id: agent.id,
		name: agent.name || 'Agent',
		network: 'mainnet',
		status: 'active',
		policy_agent_id: agent.id,
		policy: { per_trade_sol: null, daily_budget_sol: null, allow_caution: null },
		members,
		team: null,
	};
}

/**
 * Resolve a squad id for its owner. A team id wins when the team runtime is
 * installed; otherwise (or for an agent id) the solo squad. Null when the id
 * names nothing this user owns: callers answer 404 so ids never leak.
 */
export async function resolveSquad(id, userId) {
	if (!isUuid(id) || !userId) return null;
	if (await teamsTableExists()) {
		const team = await loadTeamSquad(id, userId);
		if (team) return team;
	}
	return loadAgentSquad(id, userId);
}

/** The squads this user can open a coordinator chat with: their teams, then their agents. */
export async function listSquadsForUser(userId) {
	const out = [];
	if (await teamsTableExists()) {
		const teams = await sql`
			select t.id, t.name, t.network, t.status,
			       (select count(*)::int from team_members m where m.team_id = t.id and m.status = 'active') as members
			from teams t
			where t.owner_user_id = ${userId} and t.archived_at is null
			order by t.updated_at desc limit 24
		`;
		for (const t of teams) out.push({ kind: 'team', id: t.id, name: t.name, network: t.network, status: t.status, members: t.members });
	}
	const agents = await sql`
		select id, name, avatar_id, meta->>'solana_address' as wallet, updated_at
		from agent_identities
		where user_id = ${userId} and deleted_at is null
		  and coalesce(meta->>'team_id', '') = ''
		order by updated_at desc limit 24
	`;
	for (const a of agents) out.push({ kind: 'agent', id: a.id, name: a.name || 'Agent', avatar_id: a.avatar_id, wallet: a.wallet || null, members: 1 });
	return out;
}

/** The client-facing view: who is in the squad, never wallet secrets or meta. */
export function publicSquad(squad) {
	return {
		kind: squad.kind,
		id: squad.id,
		name: squad.name,
		network: squad.network,
		status: squad.status,
		policy_agent_id: squad.policy_agent_id,
		policy: squad.policy,
		members: squad.members.map((m) => ({ role: m.role, agent_id: m.agent_id, name: m.name, avatar_id: m.avatar_id, wallet: m.wallet, model_url: m.model_url, thumbnail_url: m.thumbnail_url })),
		page_url: squad.kind === 'team' ? `/teams/${squad.id}` : `/agents/${squad.id}`,
		chat_url: `/teams/${squad.id}/chat`,
	};
}

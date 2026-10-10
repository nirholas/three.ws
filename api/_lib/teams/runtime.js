// Specialist team runtime: provisioning a squad of four role agents under one
// spend policy, and running each role against its real executor.
//
//   Researcher  researchMint() (trade firewall + coin intelligence + smart money)
//   Entry       the sniper's intel_confirmed scorer (scoreIntel) over finished launches
//   Trader      the agent trade engine (previewAgentTrade / executeAgentTrade), so
//               every team trade passes the same spend guards, firewall, daily
//               budget and custody ledger as a manual trade
//   Launcher    native lane readiness plus a launch plan the owner signs on
//               /three-launchpad; the runtime never signs a launch
//
// Every action checks the acting member's permissions (roles.js) and writes a
// finding to the shared board (findings.js) carrying its inputs, the research it
// cited, the rule that matched and, for an executed trade, the custody receipt.

import { sql } from '../db.js';
import { validateSolanaAddress, getTradeLimits, setTradeLimits } from '../agent-trade-guards.js';
import { publicUrlOrNull, thumbnailUrl } from '../r2.js';
import { laneInfo, configKeyFor } from '../native-launch/config.js';
import { getSmartMoneyForMint } from '../smart-money.js';
import { getConnection } from '../pump.js';
import {
	ROLES, FIXED_ROLES, ROLE_INFO, PERMISSIONS, TeamError,
	defaultPermissions, effectivePermissions, roleCeiling, normalizeGrant, assertCan, canSign,
} from './roles.js';
import {
	POLICY_DEFAULTS, normalizeTeamPolicy, expiryFor, traderClearance,
	insertFinding, findLiveResearch, listFindings,
} from './findings.js';
import { researchMint, loadIntelRow } from './research.js';

const LAMPORTS_PER_SOL = 1_000_000_000;
const MAX_TEAMS_PER_USER = 12;
const MAX_CUSTOM_MEMBERS = 4;
const ENTRY_SCAN_WINDOW_MINUTES = 120;
const ENTRY_SCAN_LIMIT = 20;
const ENTRY_MAX_SETUPS = 5;

export const ACTIONS = Object.freeze({
	research: 'research.run',
	scan: 'signals.scan',
	trade: 'trade.quote',
	launch: 'launch.prepare',
});

const TRADE_MODES = ['quote', 'simulate', 'live'];

const cleanText = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const solToLamports = (sol) => BigInt(Math.round(Number(sol) * LAMPORTS_PER_SOL));

function requireMint(raw) {
	const check = validateSolanaAddress(typeof raw === 'string' ? raw.trim() : raw);
	if (!check.valid) throw new TeamError(400, 'invalid_mint', `mint is not a valid Solana address (${check.reason})`);
	return check.base58;
}

// ── pure specs ───────────────────────────────────────────────────────────────

/**
 * The agent a fixed role is born as. Each role gets a distinct description and
 * persona so the identity-integrity screen sees four different agents, and the
 * Trader carries the team's caps as its trade_limits so the existing guards
 * enforce them on every trade.
 */
export function roleAgentSpec(role, team) {
	const info = ROLE_INFO[role];
	if (!info || role === 'custom') throw new TeamError(400, 'bad_role', `no agent spec for role ${role}`);
	const base = cleanText(team.name, 60 - info.title.length - 1) || 'Team';
	const policy = team.policy || POLICY_DEFAULTS;
	const meta = { team_id: team.id, team_role: role, created_via: 'team' };
	if (role === 'trader') {
		meta.trade_limits = {
			per_trade_sol: policy.per_trade_sol,
			daily_budget_sol: policy.daily_budget_sol,
			max_price_impact_pct: 15,
			max_slippage_bps: 1000,
			max_concurrent: null,
			kill_switch: false,
			updated_at: new Date().toISOString(),
		};
	}
	return {
		name: `${base} ${info.title}`,
		description: info.blurb,
		personaToneTags: { researcher: ['analytical', 'skeptical'], entry: ['patient', 'watchful'], trader: ['disciplined', 'decisive'], launcher: ['creative', 'methodical'] }[role],
		personaPrompt: `You are the ${info.title} on the three.ws specialist team "${base}". ${info.blurb}`,
		meta,
	};
}

/** Budget a member's row records: only the Trader spends. */
export function memberBudgetLamports(role, policy) {
	return role === 'trader' ? solToLamports(policy.daily_budget_sol).toString() : null;
}

// ── loading ─────────────────────────────────────────────────────────────────

const TEAM_COLUMNS = sql`
	id, owner_user_id, name, description, network, status, policy_agent_id, policy,
	is_public, last_error, created_at, updated_at, archived_at
`;

export async function getTeamRow(teamId) {
	const rows = await sql`select ${TEAM_COLUMNS} from teams where id = ${teamId} limit 1`;
	return rows[0] || null;
}

/**
 * Load a team for a viewer. Owners see everything; anyone else sees only a
 * public, non-archived team. A team the viewer may not see is a 404 (never a
 * 403), so private team ids do not leak.
 */
export async function loadTeamFor(teamId, userId, { write = false } = {}) {
	const team = await getTeamRow(teamId);
	const isOwner = Boolean(team && userId && team.owner_user_id === userId);
	if (!team || (!isOwner && (write || !team.is_public || team.status === 'archived'))) {
		throw new TeamError(404, 'not_found', 'team not found');
	}
	return { team: { ...team, policy: normalizeTeamPolicy({}, team.policy || {}) }, isOwner };
}

export async function listMembers(teamId) {
	return sql`
		select m.id, m.team_id, m.agent_id, m.role, m.permissions, m.budget_lamports, m.status, m.created_at,
		       a.name as agent_name, a.description as agent_description, a.avatar_id, a.meta as agent_meta,
		       av.storage_key, av.thumbnail_key
		from team_members m
		join agent_identities a on a.id = m.agent_id and a.deleted_at is null
		left join avatars av on av.id = a.avatar_id and av.deleted_at is null
		where m.team_id = ${teamId} and m.status = 'active'
		order by array_position(${ROLES}::text[], m.role), m.created_at
	`;
}

function memberView(m, { isOwner }) {
	const meta = m.agent_meta || {};
	const perms = effectivePermissions(m.role, m.permissions);
	return {
		id: m.id,
		role: m.role,
		title: ROLE_INFO[m.role]?.title || m.role,
		blurb: ROLE_INFO[m.role]?.blurb || '',
		permissions: perms,
		ceiling: roleCeiling(m.role),
		can_sign: canSign({ role: m.role, permissions: m.permissions, status: m.status }),
		budget_sol: m.budget_lamports == null ? null : Number(m.budget_lamports) / LAMPORTS_PER_SOL,
		agent: {
			id: m.agent_id,
			name: m.agent_name,
			description: m.agent_description,
			page_url: `/agents/${m.agent_id}`,
			avatar_id: m.avatar_id || null,
			model_url: m.storage_key ? publicUrlOrNull(m.storage_key) : null,
			thumbnail_url: m.thumbnail_key ? thumbnailUrl(m.thumbnail_key) : null,
			wallet: meta.solana_address || null,
			...(isOwner && m.role === 'trader' ? { trade_limits: getTradeLimits(meta) } : {}),
		},
		created_at: m.created_at,
	};
}

async function walletBalanceSol(address, network) {
	if (!address) return null;
	try {
		const { PublicKey } = await import('@solana/web3.js');
		const lamports = await getConnection({ network }).getBalance(new PublicKey(address), 'confirmed');
		return lamports / LAMPORTS_PER_SOL;
	} catch {
		return null;
	}
}

export async function getTeamView(team, { isOwner }) {
	const [members, [stats]] = await Promise.all([
		listMembers(team.id),
		sql`
			select count(*)::int as total,
			       count(*) filter (where created_at > now() - interval '24 hours')::int as last_24h,
			       max(created_at) as last_at
			from team_findings where team_id = ${team.id}
		`,
	]);
	const views = members.map((m) => memberView(m, { isOwner }));
	const trader = views.find((m) => m.role === 'trader');
	const missing = FIXED_ROLES.filter((r) => !views.some((m) => m.role === r));
	return {
		id: team.id,
		name: team.name,
		description: team.description,
		network: team.network,
		status: team.status,
		is_public: team.is_public,
		is_owner: isOwner,
		policy: isOwner ? team.policy : { finding_ttl_seconds: team.policy.finding_ttl_seconds },
		policy_agent_id: team.policy_agent_id,
		last_error: isOwner ? team.last_error : null,
		missing_roles: missing,
		members: views,
		permission_catalog: PERMISSIONS,
		trader_balance_sol: isOwner && trader ? await walletBalanceSol(trader.agent.wallet, team.network) : null,
		findings: { total: stats?.total ?? 0, last_24h: stats?.last_24h ?? 0, last_at: stats?.last_at ?? null },
		page_url: `/teams/${team.id}`,
		created_at: team.created_at,
		updated_at: team.updated_at,
	};
}

export async function listTeamsForUser(userId) {
	const rows = await sql`
		select t.id, t.name, t.description, t.network, t.status, t.is_public, t.created_at, t.updated_at,
		       (select count(*)::int from team_members m where m.team_id = t.id and m.status = 'active') as member_count,
		       (select max(f.created_at) from team_findings f where f.team_id = t.id) as last_finding_at,
		       coalesce((
		         select json_agg(json_build_object('role', m.role, 'agent_id', m.agent_id, 'name', a.name,
		                  'thumbnail_key', av.thumbnail_key) order by array_position(${ROLES}::text[], m.role))
		         from team_members m
		         join agent_identities a on a.id = m.agent_id and a.deleted_at is null
		         left join avatars av on av.id = a.avatar_id and av.deleted_at is null
		         where m.team_id = t.id and m.status = 'active'
		       ), '[]'::json) as roster
		from teams t
		where t.owner_user_id = ${userId} and t.archived_at is null
		order by t.created_at desc
		limit ${MAX_TEAMS_PER_USER * 2}
	`;
	return rows.map((t) => ({
		...t,
		roster: (t.roster || []).map((r) => ({
			role: r.role,
			agent_id: r.agent_id,
			name: r.name,
			thumbnail_url: r.thumbnail_key ? thumbnailUrl(r.thumbnail_key) : null,
		})),
		page_url: `/teams/${t.id}`,
	}));
}

// ── provisioning ─────────────────────────────────────────────────────────────

async function provisionRole(team, userId, role) {
	const spec = roleAgentSpec(role, team);
	const { cloneAvatarFor } = await import('../circulation.js');
	const { createAgentIdentity } = await import('../agent-create.js');
	const avatarId = await cloneAvatarFor(userId, spec.name).catch(() => null);
	const created = await createAgentIdentity({
		userId,
		name: spec.name,
		description: spec.description,
		personaToneTags: spec.personaToneTags,
		avatarId,
		meta: spec.meta,
		personaPrompt: spec.personaPrompt,
	});
	if (created.blocked) {
		throw new TeamError(409, 'identity_blocked', `The ${ROLE_INFO[role].title} identity was refused: ${created.blocked.message}`);
	}
	const agent = created.agent;
	const [member] = await sql`
		insert into team_members (team_id, agent_id, role, permissions, budget_lamports)
		values (${team.id}, ${agent.id}, ${role}, ${defaultPermissions(role)}::text[], ${memberBudgetLamports(role, team.policy)})
		returning id
	`;
	if (role === 'trader') {
		await sql`update teams set policy_agent_id = ${agent.id}, updated_at = now() where id = ${team.id}`;
	}
	return { role, agent_id: agent.id, member_id: member.id };
}

/**
 * Provision every fixed role the team does not have yet. Idempotent: a failed
 * creation can be repaired by calling this again, and only the missing roles
 * are created. The team is active only once all four exist.
 */
export async function provisionMissingRoles(team, userId) {
	const existing = await sql`
		select role from team_members where team_id = ${team.id} and status = 'active'
	`;
	const have = new Set(existing.map((r) => r.role));
	const created = [];
	try {
		for (const role of FIXED_ROLES) {
			if (have.has(role)) continue;
			created.push(await provisionRole(team, userId, role));
		}
	} catch (err) {
		const message = err instanceof TeamError ? err.message : 'An agent could not be created. Repair the team to retry the missing roles.';
		if (!(err instanceof TeamError)) console.error('[teams] provisioning failed', team.id, err?.message);
		await sql`
			update teams set status = 'failed', last_error = ${message}, updated_at = now() where id = ${team.id}
		`;
		throw new TeamError(err?.status || 502, err?.code || 'provisioning_failed', message, { team_id: team.id, created });
	}
	await sql`
		update teams set status = 'active', last_error = null, updated_at = now()
		where id = ${team.id} and status in ('provisioning', 'failed')
	`;
	return created;
}

export async function createTeam({ userId, name, description = null, network = 'mainnet', policy = {}, isPublic = false }) {
	const cleanName = cleanText(name, 60);
	if (!cleanName) throw new TeamError(400, 'bad_name', 'Give the team a name.');
	const net = network === 'devnet' ? 'devnet' : 'mainnet';
	const normalized = normalizeTeamPolicy(policy);
	const [{ n }] = await sql`
		select count(*)::int as n from teams where owner_user_id = ${userId} and archived_at is null
	`;
	if (n >= MAX_TEAMS_PER_USER) {
		throw new TeamError(409, 'team_limit', `You already run ${n} teams. Archive one before creating another.`);
	}
	const [team] = await sql`
		insert into teams (owner_user_id, name, description, network, policy, is_public)
		values (${userId}, ${cleanName}, ${cleanText(description, 500) || null}, ${net},
		        ${JSON.stringify(normalized)}::jsonb, ${isPublic === true})
		returning ${TEAM_COLUMNS}
	`;
	await provisionMissingRoles({ ...team, policy: normalized }, userId);
	return getTeamRow(team.id);
}

/** Owner edits: name, description, visibility, pause/resume, and the policy. */
export async function updateTeam(team, userId, patch, { req = null } = {}) {
	if (team.status === 'archived') throw new TeamError(409, 'archived', 'This team is archived.');
	const p = patch && typeof patch === 'object' ? patch : {};
	const name = p.name !== undefined ? cleanText(p.name, 60) : team.name;
	if (!name) throw new TeamError(400, 'bad_name', 'Give the team a name.');
	const description = p.description !== undefined ? cleanText(p.description, 500) || null : team.description;
	const isPublic = p.is_public !== undefined ? p.is_public === true : team.is_public;

	let status = team.status;
	if (p.status !== undefined) {
		if (!['active', 'paused'].includes(p.status)) throw new TeamError(400, 'bad_status', 'status must be active or paused');
		if (p.status === 'active' && ['provisioning', 'failed'].includes(team.status)) {
			throw new TeamError(409, 'not_ready', 'Repair the team before resuming it.');
		}
		status = ['provisioning', 'failed'].includes(team.status) ? team.status : p.status;
	}

	const policy = p.policy !== undefined ? normalizeTeamPolicy(p.policy, team.policy) : team.policy;
	const capsChanged = policy.per_trade_sol !== team.policy.per_trade_sol || policy.daily_budget_sol !== team.policy.daily_budget_sol;
	if (capsChanged && team.policy_agent_id) {
		// The caps are enforced by the Trader agent's own trade limits, so they
		// change there first (audited by setTradeLimits) and the team mirrors it.
		await setTradeLimits(team.policy_agent_id, userId, {
			per_trade_sol: policy.per_trade_sol,
			daily_budget_sol: policy.daily_budget_sol,
		}, { req });
		await sql`
			update team_members set budget_lamports = ${memberBudgetLamports('trader', policy)}
			where team_id = ${team.id} and agent_id = ${team.policy_agent_id} and status = 'active'
		`;
	}

	await sql`
		update teams set name = ${name}, description = ${description}, is_public = ${isPublic},
		       status = ${status}, policy = ${JSON.stringify(policy)}::jsonb, updated_at = now()
		where id = ${team.id}
	`;
	return getTeamRow(team.id);
}

/** Archive keeps every agent (they are ordinary agents the owner still owns). */
export async function archiveTeam(team) {
	await sql`
		update teams set status = 'archived', archived_at = now(), is_public = false, updated_at = now()
		where id = ${team.id}
	`;
}

// ── custom members ───────────────────────────────────────────────────────────

/** Add one of the owner's existing agents as a custom specialist. */
export async function addCustomMember(team, userId, { agentId, permissions }) {
	const grant = normalizeGrant('custom', permissions ?? ['findings.read', 'findings.write', 'research.run']);
	const [agent] = await sql`
		select id from agent_identities where id = ${agentId} and user_id = ${userId} and deleted_at is null limit 1
	`;
	if (!agent) throw new TeamError(404, 'agent_not_found', 'That agent is not one of yours.');
	const [{ n }] = await sql`
		select count(*)::int as n from team_members where team_id = ${team.id} and role = 'custom' and status = 'active'
	`;
	if (n >= MAX_CUSTOM_MEMBERS) throw new TeamError(409, 'member_limit', `A team holds at most ${MAX_CUSTOM_MEMBERS} custom specialists.`);
	const [row] = await sql`
		insert into team_members (team_id, agent_id, role, permissions)
		values (${team.id}, ${agentId}, 'custom', ${grant}::text[])
		on conflict (team_id, agent_id) do update
		  set status = 'active', role = 'custom', permissions = excluded.permissions
		  where team_members.role = 'custom'
		returning id
	`;
	if (!row) throw new TeamError(409, 'already_member', 'That agent already holds a fixed role on this team.');
	return row.id;
}

/** Narrow (or restore) a member's grant. Never above its role's ceiling. */
export async function setMemberPermissions(team, memberId, permissions) {
	const [member] = await sql`
		select id, role from team_members where id = ${memberId} and team_id = ${team.id} and status = 'active' limit 1
	`;
	if (!member) throw new TeamError(404, 'member_not_found', 'member not found');
	const grant = normalizeGrant(member.role, permissions);
	await sql`update team_members set permissions = ${grant}::text[] where id = ${memberId}`;
	return grant;
}

export async function removeCustomMember(team, memberId) {
	const [row] = await sql`
		update team_members set status = 'removed'
		where id = ${memberId} and team_id = ${team.id} and role = 'custom' and status = 'active'
		returning id
	`;
	if (!row) throw new TeamError(404, 'member_not_found', 'Only an active custom specialist can be removed. The four core roles stay with the team.');
}

// ── running roles ────────────────────────────────────────────────────────────

/**
 * Resolve which member acts: an explicit member_id, or the fixed role that owns
 * the action by default. The permission check happens in the runner either way.
 */
export async function resolveActor(team, { memberId = null, role = null, action }) {
	const members = await listMembers(team.id);
	const defaultRole = { research: 'researcher', scan: 'entry', trade: 'trader', launch: 'launcher' }[action];
	const pick = memberId
		? members.find((m) => m.id === memberId)
		: members.find((m) => m.role === (role || defaultRole));
	if (!pick) throw new TeamError(404, 'member_not_found', memberId ? 'member not found' : `This team has no ${role || defaultRole}. Repair the team.`);
	return { member: pick, members };
}

function assertRunnable(team) {
	if (team.status === 'paused') throw new TeamError(409, 'paused', 'This team is paused. Resume it to run specialists.');
	if (team.status !== 'active') throw new TeamError(409, 'not_ready', 'This team is not fully assembled. Repair it first.');
}

/** Research a mint once and write the verdict to the board. */
async function writeResearch(team, member, mint) {
	const report = await researchMint({ mint, network: team.network });
	return insertFinding({
		teamId: team.id,
		member,
		kind: 'research',
		subject: mint,
		verdict: report.verdict,
		score: report.score,
		summary: report.summary,
		evidence: report.evidence,
		expiresAt: expiryFor(team.policy),
	});
}

export async function runResearch(team, member, { mint: rawMint, refresh = false }) {
	assertCan(member, 'research.run');
	const mint = requireMint(rawMint);
	if (!refresh) {
		const live = await findLiveResearch(team.id, mint);
		if (live) return { reused: true, finding: live };
	}
	return { reused: false, finding: await writeResearch(team, member, mint) };
}

// Same record the backtester feeds scoreIntel, plus the live market cap the
// band gate needs and the smart-money read the worker attaches before scoring.
function entryRecord(toIntelRecord, row, smartMoney) {
	return {
		...toIntelRecord(row),
		mint: row.mint,
		market_cap_usd: row.last_market_cap_usd != null ? Number(row.last_market_cap_usd) : null,
		smart_money: smartMoney || null,
	};
}

async function loadScorer() {
	const [{ scoreIntel }, { getLearnedWeights }, { toIntelRecord }] = await Promise.all([
		import('../../../workers/agent-sniper/scorer.js'),
		import('../../../workers/agent-sniper/intel/store.js'),
		import('../strategy-backtest.js'),
	]);
	return { scoreIntel, getLearnedWeights, toIntelRecord };
}

function entryFinding(team, member, row, scored, strategy) {
	const setup = scored.pass;
	const quality = row.quality_score != null ? Number(row.quality_score) : null;
	return {
		teamId: team.id,
		member,
		kind: 'entry_signal',
		subject: row.mint,
		verdict: setup ? 'setup' : 'no_setup',
		score: quality,
		summary: setup
			? `Cleared the entry gates${quality != null ? ` at quality ${Math.round(quality)}/100` : ''}, strategy score ${Number(scored.score).toFixed(2)}.`
			: `Did not clear the entry gates (${scored.reasons[0] || 'no reason recorded'}).`,
		evidence: {
			network: team.network,
			identity: { name: row.name || null, symbol: row.symbol || null },
			strategy_score: scored.score,
			reasons: scored.reasons.slice(0, 10),
			gates: strategy,
			market_cap_usd: row.last_market_cap_usd != null ? Number(row.last_market_cap_usd) : null,
			observed_until: row.observation_ended_at || null,
			scorer: 'sniper.intel_confirmed',
		},
		expiresAt: expiryFor(team.policy),
	};
}

/**
 * Entry: score one mint, or every launch whose observation window finished in
 * the last two hours, against the team's entry gates with the sniper's own
 * intel_confirmed scorer. A scan posts the top setups; a single-mint check
 * always posts its verdict. Mints with a live entry signal are skipped (reuse).
 */
export async function runEntry(team, member, { mint: rawMint = null }) {
	assertCan(member, 'signals.scan');
	const { scoreIntel, getLearnedWeights, toIntelRecord } = await loadScorer();
	const strategy = { ...team.policy.entry, avoid_dev_dump: true };
	const weights = await getLearnedWeights(team.network).catch(() => null);

	if (rawMint) {
		const mint = requireMint(rawMint);
		const row = await loadIntelRow(mint, team.network);
		if (!row) {
			throw new TeamError(404, 'no_intel', 'There is no intelligence record for this mint yet. The intel watcher records launches as it observes them.');
		}
		const sm = await getSmartMoneyForMint(mint, team.network).catch(() => null);
		const scored = scoreIntel(entryRecord(toIntelRecord, row, sm), strategy, weights);
		return { scanned: 1, findings: [await insertFinding(entryFinding(team, member, row, scored, strategy))] };
	}

	const rows = await sql`
		select i.* from pump_coin_intel i
		where i.network = ${team.network}
		  and i.observation_ended_at is not null
		  and i.observation_ended_at > now() - make_interval(mins => ${ENTRY_SCAN_WINDOW_MINUTES})
		  and not exists (
		    select 1 from team_findings f
		    where f.team_id = ${team.id} and f.kind = 'entry_signal' and f.subject = i.mint
		      and (f.expires_at is null or f.expires_at > now())
		  )
		order by i.observation_ended_at desc
		limit ${ENTRY_SCAN_LIMIT}
	`;
	const scoredRows = await Promise.all(rows.map(async (row) => {
		const sm = await getSmartMoneyForMint(row.mint, team.network).catch(() => null);
		return { row, scored: scoreIntel(entryRecord(toIntelRecord, row, sm), strategy, weights) };
	}));
	const setups = scoredRows.filter((r) => r.scored.pass).sort((a, b) => b.scored.score - a.scored.score).slice(0, ENTRY_MAX_SETUPS);
	const findings = [];
	for (const { row, scored } of setups) findings.push(await insertFinding(entryFinding(team, member, row, scored, strategy)));
	return { scanned: rows.length, setups: setups.length, findings };
}

function boundaryToTeamError(e) {
	if (e?.isBoundary) return new TeamError(e.status || 400, e.code || 'bad_request', e.message, e.detail || null);
	return e;
}

/**
 * Trader: cite a live research finding on the mint (or run research once and
 * write it back), apply traderClearance, then quote, simulate or execute through
 * the agent trade engine. Every outcome, including a refusal, is a finding that
 * cites the research it relied on.
 */
export async function runTrade(team, member, { mint: rawMint, side = 'buy', amount, mode = 'quote', slippageBps, confirm = false }, { req = null, userId }) {
	assertCan(member, 'trade.quote');
	if (!TRADE_MODES.includes(mode)) throw new TeamError(400, 'bad_mode', `mode must be one of ${TRADE_MODES.join(', ')}`);
	if (mode === 'live') {
		assertCan(member, 'trade.execute');
		if (confirm !== true) throw new TeamError(400, 'confirm_required', 'A live trade needs confirm: true after you reviewed the amount, token and network.');
	}
	const mint = requireMint(rawMint);
	if (side !== 'buy' && side !== 'sell') throw new TeamError(400, 'invalid_side', 'side must be buy or sell');

	let research = await findLiveResearch(team.id, mint);
	let researchSource = research ? 'reused' : null;
	if (!research && side === 'buy') {
		assertCan(member, 'research.run');
		research = await writeResearch(team, member, mint);
		researchSource = 'ran';
	}
	const cites = research ? [research.id] : [];
	const request = { side, mint, amount: amount ?? null, mode, slippage_bps: slippageBps ?? null, network: team.network };
	const clearance = traderClearance(research, team.policy, side);
	const base = {
		teamId: team.id,
		member,
		kind: 'trade',
		subject: mint,
		cites,
		expiresAt: null,
	};
	const ruleEvidence = { rule: clearance.rule, rule_reason: clearance.reason, research_source: researchSource, research_verdict: research?.verdict ?? null, request };

	if (!clearance.allowed) {
		const finding = await insertFinding({
			...base,
			verdict: 'refused',
			summary: `Refused: ${clearance.reason}`,
			evidence: ruleEvidence,
		});
		return { finding, research, outcome: { ok: false, code: clearance.rule, message: clearance.reason } };
	}

	const [agent] = await sql`
		select id, user_id, meta from agent_identities where id = ${member.agent_id} and deleted_at is null limit 1
	`;
	if (!agent || agent.user_id !== userId) throw new TeamError(404, 'agent_not_found', 'The Trader agent is missing. Repair the team.');
	const meta = { ...(agent.meta || {}) };
	const trade = await import('../../agents/agent-trade.js');

	let input;
	try {
		input = trade.parseTradeInput({ side, mint, amount, slippageBps, network: team.network, simulate: mode === 'simulate' }, getTradeLimits(meta));
	} catch (e) {
		throw boundaryToTeamError(e);
	}

	if (mode === 'quote') {
		let quote;
		try {
			quote = await trade.previewAgentTrade({ id: agent.id, userId, meta, input });
		} catch (e) {
			throw boundaryToTeamError(e);
		}
		const finding = await insertFinding({
			...base,
			verdict: quote.allowed ? 'quoted' : 'refused',
			summary: quote.allowed
				? `Quoted a ${side} within the spend policy. Research rule: ${clearance.rule}.`
				: `The spend guard would block this ${side}: ${quote.blocked_reason?.message || 'blocked'}`,
			evidence: { ...ruleEvidence, quote, guard: quote.allowed ? 'pass' : quote.blocked_reason },
		});
		return { finding, research, outcome: { ok: quote.allowed, quote } };
	}

	const result = await trade.executeAgentTrade({
		id: agent.id,
		userId,
		meta,
		input,
		req,
		source: 'discretionary',
	});
	const executed = result.ok && mode === 'live';
	const finding = await insertFinding({
		...base,
		verdict: !result.ok ? 'failed' : mode === 'simulate' ? 'simulated' : 'executed',
		summary: !result.ok
			? `The trade engine stopped this ${side}: ${result.message}`
			: mode === 'simulate'
				? `Simulated a ${side} through the full trade pipeline. Research rule: ${clearance.rule}.`
				: `Executed a ${side} inside the spend policy. Research rule: ${clearance.rule}.`,
		evidence: { ...ruleEvidence, result: result.ok ? result.data : { code: result.code, message: result.message, detail: result.detail ?? null } },
		receiptId: executed ? String(result.data.custody_event_id || '') || null : null,
	});
	return { finding, research, outcome: result.ok ? { ok: true, data: result.data } : { ok: false, code: result.code, message: result.message, status: result.status } };
}

const SYMBOL_RE = /^[A-Z0-9]{1,10}$/;

/** The launch URL a plan hands the owner: the native lane page, prefilled. */
export function launchPlanUrl({ avatarId, name, symbol, description, network }) {
	const q = new URLSearchParams();
	if (avatarId) q.set('avatar', avatarId);
	q.set('name', name);
	q.set('symbol', symbol);
	if (description) q.set('description', description);
	if (network === 'devnet') q.set('network', 'devnet');
	return `/three-launchpad?${q.toString()}#tl-launch`;
}

/**
 * Launcher: check the native lane is live on the team's network, validate the
 * coin plan, and post a launch_prep finding whose evidence carries the launch
 * URL. Signing happens only on /three-launchpad, in the owner's wallet, from a
 * same-site session; this function never builds or signs a transaction.
 */
export async function runLaunchPrep(team, member, { name: rawName, symbol: rawSymbol, description: rawDescription }) {
	assertCan(member, 'launch.prepare');
	const name = cleanText(rawName, 32);
	const symbol = cleanText(rawSymbol, 10).toUpperCase();
	const description = cleanText(rawDescription, 500);
	if (!name) throw new TeamError(400, 'bad_name', 'Give the coin a name (up to 32 characters).');
	if (!SYMBOL_RE.test(symbol)) throw new TeamError(400, 'bad_symbol', 'The ticker must be 1 to 10 letters or digits.');

	const lane = laneInfo(team.network);
	const blockers = [];
	if (!configKeyFor(team.network)) blockers.push(`The launchpad is not open on ${team.network} yet.`);
	if (!lane.quote_mint) blockers.push(`No quote mint is configured on ${team.network}.`);
	if (!member.avatar_id) blockers.push('The Launcher has no 3D body to use as the coin image.');

	const ready = blockers.length === 0;
	const finding = await insertFinding({
		teamId: team.id,
		member,
		kind: 'launch_prep',
		subjectKind: 'topic',
		subject: `launch:${symbol}`,
		verdict: ready ? 'ready' : 'blocked',
		summary: ready
			? `Launch plan for ${symbol} is ready. You review and sign it on the launchpad.`
			: `Launch plan for ${symbol} is blocked: ${blockers[0]}`,
		evidence: {
			plan: { name, symbol, description: description || null },
			lane: {
				label: lane.label,
				network: lane.network,
				quote: lane.quote,
				trade_fee_bps: lane.trade_fee_bps,
				creator_fee_percent: lane.fee_split.creator_percent,
				total_supply: lane.total_supply,
			},
			blockers,
			signer: 'owner',
			launch_url: ready ? launchPlanUrl({ avatarId: member.avatar_id, name, symbol, description, network: team.network }) : null,
		},
		expiresAt: expiryFor(team.policy),
	});
	return { finding, ready, blockers };
}

/** Dispatch one action for one member. Returns the runner's result. */
export async function runAction(team, { action, memberId = null, role = null, input = {} }, ctx) {
	if (!Object.hasOwn(ACTIONS, action)) throw new TeamError(400, 'bad_action', `action must be one of ${Object.keys(ACTIONS).join(', ')}`);
	assertRunnable(team);
	const { member } = await resolveActor(team, { memberId, role, action });
	if (action === 'research') return runResearch(team, member, input);
	if (action === 'scan') return runEntry(team, member, input);
	if (action === 'trade') return runTrade(team, member, input, ctx);
	return runLaunchPrep(team, member, input);
}

export { listFindings };

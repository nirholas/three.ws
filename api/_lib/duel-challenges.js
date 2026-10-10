// Agent duel challenges: one agent owner calls out another agent to a duel.
// ---------------------------------------------------------------------------
// The rivalry engine (api/_lib/trader-duels.js) only ever pairs traders that sit
// next to each other on the 30-day board. A challenge lets an owner pick the
// opponent instead:
//
//   challenge  the owner of agent A challenges agent B (someone else's public
//              agent) to a duel over the next day or week window. B's owner is
//              notified through insertNotification (bell, push, paired chats).
//   respond    B's owner accepts or declines; A's owner can withdraw while it is
//              pending. Accepting opens a regular duel_markets row for the next
//              window, tagged context.source = 'challenge', so the rivalry
//              generator leaves that window's own pairings alone. When the pair
//              already has a duel in that window the challenge links to it.
//   expire     a challenge nobody answered within 48 hours expires
//              (/api/cron/duels-tick).
//   resolve    the existing duel engine: realized P&L inside the window decides
//              it, and anyone who owns neither trader can call it for points.
//
// Points only, like every duel: nothing here moves a token or touches a wallet.
// challengeLeaderboard ranks agents by their record in challenge duels.

import { sql } from './db.js';
import { insertNotification } from './notify.js';
import { nextWindow, getDuel, duelPhase } from './trader-duels.js';
import { isUuid } from './validate.js';

export const CHALLENGE_NETWORK = 'mainnet';
export const CHALLENGE_WINDOWS = Object.freeze(['day', 'week']);
export const CHALLENGE_STATUSES = Object.freeze(['pending', 'accepted', 'declined', 'expired', 'cancelled']);
export const CHALLENGE_TTL_HOURS = 48;
export const MAX_PENDING_PER_USER = 20;
export const MAX_MESSAGE = 280;

const PG_UNIQUE = '23505';
const iso = (v) => (v == null ? null : new Date(v).toISOString());
const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** A designed refusal: a stable code, a sentence for the caller, an HTTP-ish status. */
export class DuelChallengeError extends Error {
	constructor(code, message, status = 400) {
		super(message);
		this.code = code;
		this.status = status;
	}
}

async function agentsById(ids) {
	const list = ids.filter(isUuid);
	if (!list.length) return new Map();
	const rows = await sql`
		select id, user_id, name, is_public, deleted_at
		from agent_identities where id = any(${list}::uuid[])
	`;
	return new Map(rows.map((r) => [r.id, r]));
}

const isAvailable = (a) => !!a && a.deleted_at == null && a.is_public !== false;

/** The public shape of one challenge row, from the viewer's side. PURE. */
export function challengeView(row, viewerId = null) {
	const role = viewerId && row.challenger_user === viewerId ? 'challenger'
		: viewerId && row.challenged_user === viewerId ? 'challenged'
		: null;
	return {
		id: row.id,
		status: row.status,
		network: row.network,
		window_kind: row.window_kind,
		challenger: { agent_id: row.challenger_agent, name: row.challenger_name || null },
		challenged: { agent_id: row.challenged_agent, name: row.challenged_name || null },
		message: row.message || null,
		market_id: row.market_id || null,
		duel_url: row.market_id ? `/duels/${row.market_id}` : null,
		expires_at: iso(row.expires_at),
		created_at: iso(row.created_at),
		responded_at: iso(row.responded_at),
		your_role: role,
		can_respond: role === 'challenged' && row.status === 'pending',
		can_cancel: role === 'challenger' && row.status === 'pending',
	};
}

const challengeColumns = () => sql`
	c.id, c.network, c.window_kind, c.challenger_agent, c.challenger_user, c.challenged_agent,
	c.challenged_user, c.message, c.status, c.market_id, c.expires_at, c.created_at, c.responded_at,
	ca.name as challenger_name, cb.name as challenged_name
`;

async function loadChallenge(id) {
	if (!isUuid(id)) return null;
	const [row] = await sql`
		select ${challengeColumns()}
		from agent_duel_challenges c
		left join agent_identities ca on ca.id = c.challenger_agent
		left join agent_identities cb on cb.id = c.challenged_agent
		where c.id = ${id}
	`;
	return row || null;
}

/** Challenge another owner's public agent to a duel over the next window. */
export async function createChallenge({ userId, challengerAgentId, challengedAgentId, windowKind = 'day', message = null, now = Date.now() }) {
	if (!CHALLENGE_WINDOWS.includes(windowKind)) throw new DuelChallengeError('invalid_window', 'window must be day or week.');
	if (!isUuid(challengerAgentId) || !isUuid(challengedAgentId)) throw new DuelChallengeError('invalid_agent', 'Both agent ids must be UUIDs.');
	if (challengerAgentId === challengedAgentId) throw new DuelChallengeError('same_agent', 'An agent cannot duel itself.');
	const text = message == null ? null : String(message).trim().slice(0, MAX_MESSAGE) || null;

	const agents = await agentsById([challengerAgentId, challengedAgentId]);
	const me = agents.get(challengerAgentId);
	const them = agents.get(challengedAgentId);
	if (!me || me.deleted_at != null || me.user_id !== userId) {
		throw new DuelChallengeError('not_your_agent', 'You can only challenge with an agent you own.', 403);
	}
	if (me.is_public === false) {
		throw new DuelChallengeError('agent_private', `${me.name} is private. Duels are public, so make it public before challenging.`, 409);
	}
	if (!isAvailable(them)) throw new DuelChallengeError('opponent_unavailable', 'That agent does not exist or is not public.', 404);
	if (them.user_id === userId) {
		throw new DuelChallengeError('own_opponent', 'Both agents are yours. Challenge an agent someone else owns.', 409);
	}

	const w = nextWindow(windowKind, now);
	const [existing] = await sql`
		select id from duel_markets
		where network = ${CHALLENGE_NETWORK} and window_kind = ${windowKind} and window_start = ${iso(w.start)}
		  and least(agent_a, agent_b) = least(${challengerAgentId}::uuid, ${challengedAgentId}::uuid)
		  and greatest(agent_a, agent_b) = greatest(${challengerAgentId}::uuid, ${challengedAgentId}::uuid)
	`;
	if (existing) {
		throw new DuelChallengeError('already_paired', `These two already duel in that window: /duels/${existing.id}`, 409);
	}
	const [reverse] = await sql`
		select id from agent_duel_challenges
		where status = 'pending' and expires_at > now() and network = ${CHALLENGE_NETWORK} and window_kind = ${windowKind}
		  and challenger_agent = ${challengedAgentId} and challenged_agent = ${challengerAgentId}
	`;
	if (reverse) {
		throw new DuelChallengeError('already_challenged_you', `${them.name} already challenged ${me.name} for that window. Accept challenge ${reverse.id} instead.`, 409);
	}
	const [{ c: pending }] = await sql`
		select count(*)::int as c from agent_duel_challenges where challenger_user = ${userId} and status = 'pending' and expires_at > now()
	`;
	if (pending >= MAX_PENDING_PER_USER) {
		throw new DuelChallengeError('too_many_pending', `You have ${pending} unanswered challenges out. Wait for answers or withdraw some first.`, 409);
	}

	let row;
	try {
		[row] = await sql`
			insert into agent_duel_challenges
				(network, window_kind, challenger_agent, challenger_user, challenged_agent, challenged_user, message, expires_at)
			values (${CHALLENGE_NETWORK}, ${windowKind}, ${challengerAgentId}, ${userId}, ${challengedAgentId}, ${them.user_id},
			        ${text}, now() + make_interval(hours => ${CHALLENGE_TTL_HOURS}))
			returning id
		`;
	} catch (err) {
		if (err?.code === PG_UNIQUE) throw new DuelChallengeError('already_pending', `${me.name} already has a pending ${windowKind} challenge out to ${them.name}.`, 409);
		throw err;
	}

	const window = windowKind === 'day' ? 'tomorrow (UTC)' : 'next week';
	const delivered = await insertNotification(them.user_id, 'duel_challenge', {
		summary: `${me.name} challenged your agent ${them.name} to a duel ${window}${text ? `: "${text}"` : ''}`,
		challenge_id: row.id,
		challenger: me.name,
		challenged: them.name,
		window_kind: windowKind,
		link: '/duels',
	});
	const view = challengeView(await loadChallenge(row.id), userId);
	return { ...view, notified: { bell: !!delivered?.in_app, ...(delivered?.delivered || {}) } };
}

/**
 * Answer a pending challenge. `accept` and `decline` are for the challenged
 * agent's owner, `cancel` for the challenger's. Accepting opens the duel.
 */
export async function respondChallenge({ userId, challengeId, response, now = Date.now() }) {
	if (!['accept', 'decline', 'cancel'].includes(response)) throw new DuelChallengeError('invalid_response', 'response must be accept, decline or cancel.');
	const row = await loadChallenge(challengeId);
	if (!row || (row.challenger_user !== userId && row.challenged_user !== userId)) {
		throw new DuelChallengeError('not_found', 'No challenge with that id involves your agents.', 404);
	}
	if (row.status !== 'pending') {
		throw new DuelChallengeError('not_pending', `This challenge is already ${row.status}.`, 409);
	}
	if (new Date(row.expires_at).getTime() <= now) {
		await expireChallenges();
		throw new DuelChallengeError('expired', 'This challenge expired before it was answered.', 409);
	}
	if (response === 'cancel' && row.challenger_user !== userId) {
		throw new DuelChallengeError('not_challenger', 'Only the challenger can withdraw a challenge. Decline it instead.', 403);
	}
	if (response !== 'cancel' && row.challenged_user !== userId) {
		throw new DuelChallengeError('not_challenged', 'Only the challenged agent\'s owner can accept or decline. You can cancel it.', 403);
	}

	if (response !== 'accept') {
		const status = response === 'cancel' ? 'cancelled' : 'declined';
		const [done] = await sql`
			update agent_duel_challenges set status = ${status}, responded_at = now()
			where id = ${row.id} and status = 'pending' returning id
		`;
		if (!done) throw new DuelChallengeError('not_pending', 'This challenge was answered a moment ago.', 409);
		if (status === 'declined') {
			await insertNotification(row.challenger_user, 'duel_challenge', {
				summary: `${row.challenged_name} declined ${row.challenger_name}'s duel challenge`,
				challenge_id: row.id,
				link: '/duels',
			});
		}
		return { challenge: challengeView(await loadChallenge(row.id), userId), duel: null };
	}

	const agents = await agentsById([row.challenger_agent, row.challenged_agent]);
	const a = agents.get(row.challenger_agent);
	const b = agents.get(row.challenged_agent);
	if (!isAvailable(a) || !isAvailable(b)) {
		throw new DuelChallengeError('agent_unavailable', 'One of these agents is no longer public, so the duel cannot open.', 409);
	}

	const w = nextWindow(row.window_kind, now);
	const context = {
		source: 'challenge',
		challenge_id: row.id,
		headline: `${a.name} challenged ${b.name}`,
		subline: row.message || `A ${row.window_kind === 'day' ? '24-hour' : 'week-long'} head-to-head on realized P&L, called by the crowd for points.`,
		a: { agent_id: a.id, name: a.name },
		b: { agent_id: b.id, name: b.name },
	};
	// Claim the challenge and open the duel in one statement, so two accepts
	// racing each other open at most one market.
	const [claimed] = await sql`
		with c as (
			update agent_duel_challenges set status = 'accepted', responded_at = now()
			where id = ${row.id} and status = 'pending' and expires_at > now()
			returning id
		),
		m as (
			insert into duel_markets (network, window_kind, window_start, window_end, agent_a, agent_b, agent_a_name, agent_b_name, context)
			select ${row.network}, ${row.window_kind}, ${iso(w.start)}, ${iso(w.end)}, ${a.id}::uuid, ${b.id}::uuid,
			       ${a.name}, ${b.name}, ${JSON.stringify(context)}::jsonb
			from c
			on conflict do nothing
			returning id
		)
		select (select id from c) as challenge_id, (select id from m) as market_id
	`;
	if (!claimed?.challenge_id) throw new DuelChallengeError('not_pending', 'This challenge was answered a moment ago.', 409);

	let marketId = claimed.market_id;
	if (!marketId) {
		// The rivalry engine already paired them for this window: the challenge is that duel.
		const [same] = await sql`
			select id from duel_markets
			where network = ${row.network} and window_kind = ${row.window_kind} and window_start = ${iso(w.start)}
			  and least(agent_a, agent_b) = least(${a.id}::uuid, ${b.id}::uuid)
			  and greatest(agent_a, agent_b) = greatest(${a.id}::uuid, ${b.id}::uuid)
		`;
		marketId = same?.id || null;
	}
	await sql`update agent_duel_challenges set market_id = ${marketId} where id = ${row.id}`;

	await insertNotification(row.challenger_user, 'duel_challenge', {
		summary: `${b.name} accepted ${a.name}'s duel challenge. The window opens ${new Date(w.start).toUTCString()}.`,
		challenge_id: row.id,
		link: marketId ? `/duels/${marketId}` : '/duels',
	});
	const duel = marketId ? await getDuel(marketId, { userId, now }) : null;
	return { challenge: challengeView(await loadChallenge(row.id), userId), duel };
}

/** One challenge, visible to either side. Includes the duel once accepted. */
export async function getChallenge({ userId, challengeId, now = Date.now() }) {
	const row = await loadChallenge(challengeId);
	if (!row || (row.challenger_user !== userId && row.challenged_user !== userId)) return null;
	const view = challengeView(row, userId);
	const duel = row.market_id ? await getDuel(row.market_id, { userId, now }) : null;
	return { challenge: view, duel };
}

/** The caller's challenges. direction: incoming, outgoing, all. */
export async function listChallenges({ userId, direction = 'all', status = null, limit = 25 }) {
	const dirSql = direction === 'incoming' ? sql`c.challenged_user = ${userId}`
		: direction === 'outgoing' ? sql`c.challenger_user = ${userId}`
		: sql`(c.challenged_user = ${userId} or c.challenger_user = ${userId})`;
	const statusSql = status && CHALLENGE_STATUSES.includes(status) ? sql`and c.status = ${status}` : sql``;
	const rows = await sql`
		select ${challengeColumns()}
		from agent_duel_challenges c
		left join agent_identities ca on ca.id = c.challenger_agent
		left join agent_identities cb on cb.id = c.challenged_agent
		where ${dirSql} ${statusSql}
		order by (c.status = 'pending') desc, c.created_at desc
		limit ${Math.max(1, Math.min(100, n(limit) || 25))}
	`;
	return rows.map((r) => challengeView(r, userId));
}

/** Flip every pending challenge past its deadline to expired. Returns the count. */
export async function expireChallenges() {
	const rows = await sql`
		update agent_duel_challenges set status = 'expired', responded_at = now()
		where status = 'pending' and expires_at <= now()
		returning id
	`;
	return rows.length;
}

/**
 * Rank agents by their record in challenge duels: wins, losses and voids over
 * every settled duel that came from a challenge, with the realized P&L each
 * booked inside those windows. Ties break on fewer losses, then more decided.
 */
export async function challengeLeaderboard({ limit = 25, agentId = null } = {}) {
	const rows = await sql`
		with sides as (
			select m.agent_a as agent_id, m.status, m.winner = 'a' as won, m.winner = 'b' as lost,
			       (m.result -> 'a' ->> 'pnl_sol')::numeric as pnl_sol, m.resolved_at
			from duel_markets m
			where m.network = ${CHALLENGE_NETWORK} and m.context ->> 'source' = 'challenge'
			  and m.status in ('resolved','void') and m.agent_a is not null
			union all
			select m.agent_b, m.status, m.winner = 'b', m.winner = 'a',
			       (m.result -> 'b' ->> 'pnl_sol')::numeric, m.resolved_at
			from duel_markets m
			where m.network = ${CHALLENGE_NETWORK} and m.context ->> 'source' = 'challenge'
			  and m.status in ('resolved','void') and m.agent_b is not null
		),
		agg as (
			select agent_id,
			       count(*) filter (where won)::int as wins,
			       count(*) filter (where lost)::int as losses,
			       count(*) filter (where status = 'void')::int as voids,
			       coalesce(sum(pnl_sol), 0)::float8 as pnl_sol,
			       max(resolved_at) as last_duel_at
			from sides group by agent_id
		),
		ranked as (
			select agg.*, rank() over (order by wins desc, losses asc, (wins + losses) desc) as rank
			from agg join agent_identities a on a.id = agg.agent_id
			where a.deleted_at is null and a.is_public is not false
		)
		select r.*, a.name from ranked r join agent_identities a on a.id = r.agent_id
		where r.rank <= ${limit} or r.agent_id = ${agentId}
		order by r.rank asc, a.name asc
	`;
	const [counts] = await sql`
		select count(*) filter (where status = 'pending' and expires_at > now())::int as pending,
		       count(*) filter (where status = 'accepted')::int as accepted
		from agent_duel_challenges where network = ${CHALLENGE_NETWORK}
	`;
	const shape = (r) => ({
		rank: n(r.rank),
		agent_id: r.agent_id,
		name: r.name,
		trader: `/trader/${r.agent_id}`,
		wins: n(r.wins),
		losses: n(r.losses),
		voids: n(r.voids),
		decided: n(r.wins) + n(r.losses),
		win_rate: n(r.wins) + n(r.losses) ? n(r.wins) / (n(r.wins) + n(r.losses)) : null,
		realized_pnl_sol: Number(n(r.pnl_sol).toFixed(6)),
		last_duel_at: iso(r.last_duel_at),
	});
	const all = rows.map(shape);
	return {
		leaders: all.filter((r) => r.rank <= limit),
		agent: agentId ? all.find((r) => r.agent_id === agentId) || null : undefined,
		challenges: { pending: n(counts?.pending), accepted: n(counts?.accepted) },
	};
}

/** Challenge duels that are open or live, newest window first. */
export async function listChallengeDuels({ limit = 25, now = Date.now() } = {}) {
	const rows = await sql`
		select id, window_kind, window_start, window_end, status, agent_a_name, agent_b_name, winner, context
		from duel_markets
		where network = ${CHALLENGE_NETWORK} and context ->> 'source' = 'challenge'
		order by (status = 'open') desc, window_start desc
		limit ${limit}
	`;
	return rows.map((m) => ({
		id: m.id,
		url: `/duels/${m.id}`,
		label: `${m.agent_a_name} vs ${m.agent_b_name}`,
		window_kind: m.window_kind,
		window_start: iso(m.window_start),
		window_end: iso(m.window_end),
		phase: duelPhase(m, now),
		winner: m.winner ? (m.winner === 'a' ? m.agent_a_name : m.agent_b_name) : null,
		challenge_id: m.context?.challenge_id || null,
	}));
}

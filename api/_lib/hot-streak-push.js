/**
 * Hot-streak push: tell a trader's followers when they go on a streak.
 *
 * "Streak" is exactly the Arena badge's definition (api/_lib/win-streak.js over
 * every closed agent_sniper_positions row, newest first, public agents only), so
 * a push can never announce a streak the leaderboard does not show. A streak is
 * announced when the close that just landed makes it hit a milestone
 * (isStreakMilestone: 3, 5, 7, 10, then every 5), and only while that close is
 * recent, so enabling the cron never replays old runs.
 *
 * Recipients are explicit followers (trader_follows) plus anyone copying the
 * trader with money (copy_subscriptions, agent_mirror_follows), deduped, minus
 * the agent's owner. Idempotency lives in trader_streak_events: one row per
 * (agent, network, triggering position), claimed with a lease before anything is
 * sent, so overlapping or repeated ticks never double-notify.
 *
 * The pure functions at the top carry the rules and are unit-tested; the runner
 * below wires them to the database and to insertNotification.
 */

import { currentWinStreak, isStreakMilestone } from './win-streak.js';

/** A close older than this is never announced (cron cadence is ~5 minutes). */
export const LOOKBACK_MS = 45 * 60 * 1000;
/** Closed rows fetched per candidate agent. A streak that fills the window cannot be verified, so it is skipped. */
export const STREAK_FETCH_LIMIT = 60;
/** Hard ceiling on recipients for one event. */
export const MAX_RECIPIENTS = 2000;
/** Notifications delivered concurrently. */
export const BATCH_SIZE = 25;
/** How long a tick owns an event before another tick may retry it. */
export const LEASE_SECONDS = 600;
/** Candidate agents examined per tick. */
export const MAX_CANDIDATES = 200;

/**
 * Decide whether an agent's newest-first closed rows warrant an announcement.
 * @param {Array<{id: string, realized_pnl_lamports: any, closed_at: string|Date}>} closedNewestFirst
 * @param {{ now?: number, lookbackMs?: number, fetchLimit?: number }} [opts]
 * @returns {{ streak: number, positionId: string, closedAt: Date } | null}
 */
export function streakEventFor(closedNewestFirst, { now = Date.now(), lookbackMs = LOOKBACK_MS, fetchLimit = STREAK_FETCH_LIMIT } = {}) {
	const rows = closedNewestFirst || [];
	const latest = rows[0];
	if (!latest?.id || !latest.closed_at) return null;
	const closedAt = new Date(latest.closed_at);
	if (!Number.isFinite(closedAt.getTime())) return null;
	const age = now - closedAt.getTime();
	if (age < 0 || age > lookbackMs) return null;
	const streak = currentWinStreak(rows);
	if (!isStreakMilestone(streak)) return null;
	// The run fills the whole fetch window: its true length is unknown, so a
	// milestone derived from it could be wrong. Stay quiet rather than guess.
	if (streak >= fetchLimit && rows.length >= fetchLimit) return null;
	return { streak, positionId: latest.id, closedAt };
}

/**
 * Merge recipient id lists into one deduped, capped list.
 * @param {Array<Array<string>>} lists
 * @param {{ excludeUserId?: string|null, cap?: number }} [opts]
 * @returns {string[]}
 */
export function mergeRecipients(lists, { excludeUserId = null, cap = MAX_RECIPIENTS } = {}) {
	const seen = new Set();
	const out = [];
	for (const list of lists || []) {
		for (const id of list || []) {
			if (!id) continue;
			const key = String(id);
			if (excludeUserId && key === String(excludeUserId)) continue;
			if (seen.has(key)) continue;
			seen.add(key);
			out.push(key);
			if (out.length >= cap) return out;
		}
	}
	return out;
}

/** Split a list into consecutive chunks of at most `size`. */
export function chunk(list, size = BATCH_SIZE) {
	const n = Math.max(1, Math.floor(size));
	const out = [];
	for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
	return out;
}

/** The trader profile URL for a notification, same-origin path. */
export function traderUrl(agentId, network = 'mainnet') {
	const base = `/trader/${encodeURIComponent(agentId)}`;
	return network === 'devnet' ? `${base}?network=devnet` : base;
}

/** The notification payload. `link` is what the push and the bell follow; `url` mirrors it. */
export function streakPayload({ agentId, agentName, streak, network = 'mainnet' }) {
	const url = traderUrl(agentId, network);
	return {
		agent_id: agentId,
		agent_name: agentName || null,
		streak,
		network,
		url,
		link: url,
	};
}

function isMissingTable(err) {
	return err?.code === '42P01';
}

/**
 * One tick of the hot-streak push.
 *
 * @param {object} deps
 * @param {Function} deps.sql      tagged-template database client
 * @param {Function} deps.notify   insertNotification(userId, type, payload)
 * @param {string}  [deps.network]
 * @param {number}  [deps.now]
 * @returns {Promise<{ candidates: number, events: number, notified: number, skipped_missing_tables?: boolean }>}
 */
export async function runHotStreakPush({ sql, notify, network = 'mainnet', now = Date.now() }) {
	const since = new Date(now - LOOKBACK_MS);
	const result = { candidates: 0, events: 0, notified: 0 };

	const candidates = await sql`
			select distinct p.agent_id
			from agent_sniper_positions p
			join agent_identities a on a.id = p.agent_id
			where p.network = ${network} and p.status = 'closed'
			  and p.closed_at >= ${since.toISOString()}
			  and a.is_public is not false and a.deleted_at is null
			limit ${MAX_CANDIDATES}
		`;
	const ids = candidates.map((r) => r.agent_id);
	result.candidates = ids.length;
	if (!ids.length) return result;

	// Same ledger and ordering the leaderboard badge reads, deeper window.
	const rows = await sql`
		select agent_id, id, realized_pnl_lamports, closed_at
		from (
			select p.agent_id, p.id, p.realized_pnl_lamports, p.closed_at,
			       row_number() over (partition by p.agent_id order by p.closed_at desc, p.id desc) as rn
			from agent_sniper_positions p
			where p.network = ${network} and p.status = 'closed' and p.agent_id = any(${ids})
		) t
		where rn <= ${STREAK_FETCH_LIMIT}
		order by agent_id, rn
	`;
	const byAgent = new Map();
	for (const r of rows) {
		if (!byAgent.has(r.agent_id)) byAgent.set(r.agent_id, []);
		byAgent.get(r.agent_id).push(r);
	}

	for (const [agentId, list] of byAgent) {
		const event = streakEventFor(list, { now });
		if (!event) continue;

		let claimed;
		try {
			[claimed] = await sql`
				insert into trader_streak_events (agent_id, network, streak_len, trigger_position_id, closed_at)
				values (${agentId}, ${network}, ${event.streak}, ${event.positionId}, ${event.closedAt.toISOString()})
				on conflict (agent_id, network, trigger_position_id) do update
				   set claimed_at = now()
				 where trader_streak_events.notified_at is null
				   and trader_streak_events.claimed_at < now() - make_interval(secs => ${LEASE_SECONDS})
				returning id
			`;
		} catch (err) {
			if (isMissingTable(err)) return { ...result, skipped_missing_tables: true };
			throw err;
		}
		if (!claimed) continue;
		result.events += 1;

		let recipients;
		try {
			recipients = await recipientsFor(sql, agentId, network);
		} catch (err) {
			if (isMissingTable(err)) return { ...result, skipped_missing_tables: true };
			throw err;
		}
		const payload = streakPayload({
			agentId,
			agentName: recipients.agentName,
			streak: event.streak,
			network,
		});
		for (const batch of chunk(recipients.userIds, BATCH_SIZE)) {
			await Promise.all(batch.map((userId) => notify(userId, 'trader_hot_streak', payload)));
		}
		result.notified += recipients.userIds.length;

		await sql`
			update trader_streak_events
			   set notified_at = now(), recipients = ${recipients.userIds.length}
			 where id = ${claimed.id}
		`;
	}
	return result;
}

async function recipientsFor(sql, agentId, network) {
	const [[agent], followers, copiers, mirrors] = await Promise.all([
		sql`select user_id, name from agent_identities where id = ${agentId} limit 1`,
		sql`
			select f.user_id from trader_follows f
			join users u on u.id = f.user_id and u.deleted_at is null
			where f.agent_id = ${agentId}
			order by f.created_at
			limit ${MAX_RECIPIENTS}
		`,
		sql`
			select s.copier_user_id as user_id from copy_subscriptions s
			join users u on u.id = s.copier_user_id and u.deleted_at is null
			where s.leader_agent_id = ${agentId} and s.network = ${network} and s.status = 'active'
			limit ${MAX_RECIPIENTS}
		`,
		sql`
			select m.owner_user_id as user_id from agent_mirror_follows m
			join users u on u.id = m.owner_user_id and u.deleted_at is null
			where m.leader_agent_id = ${agentId} and m.network = ${network} and m.enabled
			limit ${MAX_RECIPIENTS}
		`,
	]);
	const userIds = mergeRecipients(
		[followers, copiers, mirrors].map((l) => l.map((r) => r.user_id)),
		{ excludeUserId: agent?.user_id ?? null },
	);
	return { userIds, agentName: agent?.name || null };
}

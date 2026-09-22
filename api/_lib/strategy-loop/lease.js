// Strategy loop leases: which worker owns which agent's loop right now.
//
// A worker claims due agents with claimDue(), extends every lease it holds on
// a heartbeat, and releases an agent when its tick is done. A lease that is not
// extended lapses after `leaseMs`, and the next claimDue() from any worker
// takes it over and resumes the agent's open tick from its checkpoint.
//
// An agent whose lifecycle status is 'stopped' is never claimed for a new
// tick; it is claimed only to close a tick it left open, which the tick runner
// cancels before taking another step.
//
// Claims are race-free without a transaction: the INSERT .. ON CONFLICT DO
// UPDATE .. WHERE lease_until < now() re-evaluates the WHERE against the row a
// competing worker just wrote, so exactly one worker gets each agent back.

import { sql } from '../db.js';

/**
 * Claim up to `limit` agents whose loop is due (or has a tick left open by a
 * worker whose lease lapsed).
 * @returns {Promise<Array<{ agent_id: string, reclaimed: boolean, previous_worker: string|null }>>}
 */
export async function claimDue({ workerId, limit, leaseMs }) {
	const leaseSecs = Math.max(10, Math.round(leaseMs / 1000));
	const rows = await sql`
		WITH due AS (
			SELECT l.agent_id
			  FROM agent_loops l
			  JOIN agent_identities a ON a.id = l.agent_id AND a.deleted_at IS NULL
			  LEFT JOIN agent_leases k ON k.agent_id = l.agent_id
			 WHERE (k.agent_id IS NULL OR k.lease_until < now())
			   AND (
					(l.enabled = true AND a.status = 'running' AND l.next_tick_at IS NOT NULL AND l.next_tick_at <= now()
					  AND (l.paused_until IS NULL OR l.paused_until <= now()))
					OR EXISTS (SELECT 1 FROM agent_loop_ticks t WHERE t.agent_id = l.agent_id AND t.status = 'running')
			   )
			 ORDER BY l.next_tick_at ASC NULLS FIRST
			 LIMIT ${limit}
		), prev AS (
			SELECT k.agent_id, k.worker_id FROM agent_leases k JOIN due USING (agent_id)
		)
		INSERT INTO agent_leases AS k (agent_id, worker_id, leased_at, heartbeat_at, lease_until, tick_id)
		SELECT agent_id, ${workerId}, now(), now(), now() + make_interval(secs => ${leaseSecs}), NULL FROM due
		ON CONFLICT (agent_id) DO UPDATE SET
			worker_id = EXCLUDED.worker_id,
			leased_at = now(),
			heartbeat_at = now(),
			lease_until = EXCLUDED.lease_until,
			tick_id = k.tick_id,
			claims = k.claims + 1,
			reclaims = k.reclaims + CASE WHEN k.worker_id <> EXCLUDED.worker_id THEN 1 ELSE 0 END
		WHERE k.lease_until < now()
		RETURNING k.agent_id, (SELECT p.worker_id FROM prev p WHERE p.agent_id = k.agent_id) AS previous_worker
	`;
	return rows.map((r) => ({
		agent_id: r.agent_id,
		previous_worker: r.previous_worker || null,
		reclaimed: Boolean(r.previous_worker && r.previous_worker !== workerId),
	}));
}

/**
 * Extend every lease this worker holds. Returns the agent ids it still owns;
 * an id missing from the result was taken over and must not be stepped again.
 */
export async function heartbeat({ workerId, agentIds, leaseMs }) {
	if (!agentIds.length) return new Set();
	const leaseSecs = Math.max(10, Math.round(leaseMs / 1000));
	const rows = await sql`
		UPDATE agent_leases
		   SET heartbeat_at = now(), lease_until = now() + make_interval(secs => ${leaseSecs})
		 WHERE worker_id = ${workerId} AND agent_id = ANY(${agentIds}::uuid[])
		RETURNING agent_id
	`;
	return new Set(rows.map((r) => r.agent_id));
}

/** Record which tick a lease is working on (visible in GET /loop). */
export async function attachTick({ workerId, agentId, tickId }) {
	await sql`UPDATE agent_leases SET tick_id = ${tickId} WHERE agent_id = ${agentId} AND worker_id = ${workerId}`;
}

/** Whether this worker still owns the agent. Checked before every step. */
export async function stillOwned({ workerId, agentId }) {
	const [row] = await sql`
		SELECT 1 FROM agent_leases WHERE agent_id = ${agentId} AND worker_id = ${workerId} AND lease_until > now()
	`;
	return Boolean(row);
}

/** Give an agent back so any worker may claim its next tick. */
export async function release({ workerId, agentId }) {
	await sql`
		UPDATE agent_leases SET lease_until = now(), tick_id = NULL
		 WHERE agent_id = ${agentId} AND worker_id = ${workerId}
	`;
}

/** Release everything a worker holds (graceful shutdown). */
export async function releaseAll({ workerId }) {
	await sql`UPDATE agent_leases SET lease_until = now() WHERE worker_id = ${workerId} AND lease_until > now()`;
}

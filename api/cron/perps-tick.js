// GET /api/cron/perps-tick: keeps every agent's perps desk current while
// nobody is watching it.
//
//   paper  for each agent with a paper position or resting paper order, settle
//          funding, fill resting limits the live book crossed, fire take-profits
//          and stop-losses the live mark reached, and liquidate an account under
//          maintenance margin (api/_lib/perps/service.js syncPaper).
//   live   for each agent whose owner turned live perps on, read the venue
//          account. Read-only: this cron never builds or signs a transaction.
//
// Both then evaluate the owner's alert thresholds and deliver each crossing
// once an hour (api/_lib/perps/alerts.js), so a stop that fired or a position
// drifting toward liquidation reaches the owner's bell, push and paired chats.

import { json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { sql } from '../_lib/db.js';
import { getVenue } from '../_lib/perps/index.js';
import { getPerpsLimits } from '../_lib/perps/limits.js';
import { agentsWithPaperExposure } from '../_lib/perps/paper.js';
import { syncPaper } from '../_lib/perps/service.js';
import { evaluateAlerts, deliverAlerts } from '../_lib/perps/alerts.js';

const CONCURRENCY = 4;
const MAX_AGENTS = 200;

async function liveAgents() {
	return sql`
		SELECT id AS agent_id, user_id, meta->>'solana_address' AS address
		FROM agent_identities
		WHERE deleted_at IS NULL
		  AND (meta->'perps_limits'->>'live_enabled') = 'true'
		  AND meta->>'solana_address' IS NOT NULL
		LIMIT ${MAX_AGENTS}
	`;
}

async function agentRows(ids) {
	if (!ids.length) return new Map();
	const rows = await sql`SELECT id, user_id, name, meta FROM agent_identities WHERE id = ANY(${ids}) AND deleted_at IS NULL`;
	return new Map(rows.map((r) => [r.id, r]));
}

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET', 'POST'])) return;
	if (!requireCron(req, res)) return;

	const [paper, live] = await Promise.all([agentsWithPaperExposure(), liveAgents()]);
	const jobs = [
		...paper.slice(0, MAX_AGENTS).map((r) => ({ mode: 'paper', agentId: r.agent_id, userId: r.user_id, venueId: r.venue })),
		...live.map((r) => ({ mode: 'live', agentId: r.agent_id, userId: r.user_id, address: r.address })),
	];
	const agents = await agentRows([...new Set(jobs.map((j) => j.agentId))]);

	const stats = { paper: 0, live: 0, alerts: 0, failed: 0 };
	const queue = [...jobs];
	async function worker() {
		while (queue.length) {
			const job = queue.shift();
			const agent = agents.get(job.agentId);
			if (!agent) continue;
			try {
				const venue = getVenue(job.venueId);
				const account = job.mode === 'paper'
					? await syncPaper(agent.id, job.userId, venue)
					: await venue.getAccount(job.address);
				if (job.mode === 'live' && !account.registered) continue;
				stats[job.mode] += 1;
				const alerts = evaluateAlerts(account, getPerpsLimits(agent.meta));
				if (!alerts.length) continue;
				const sent = await deliverAlerts({ agent, userId: job.userId, mode: job.mode, alerts });
				stats.alerts += sent.length;
			} catch (e) {
				stats.failed += 1;
				console.warn('[cron/perps-tick]', job.mode, job.agentId, e?.code || '', e?.message);
			}
		}
	}
	await Promise.all(Array.from({ length: CONCURRENCY }, worker));
	return json(res, 200, { ok: true, agents: jobs.length, ...stats });
});

// GET /api/cron/agent-portfolio-snapshots: hourly net-worth valuations for
// recently active agents, the background half of the balance history that
// get_balance_history and /api/v1/agents/:id/portfolio/history read
// (api/_lib/portfolio-history.js).
//
// Agents that traded, moved funds or had their portfolio read in the last week
// are valued least-recently-snapshotted first, a capped batch per run, so the
// sweep rotates through all of them without one run holding the RPC for long.
// Read-only against chain state: it values wallets and never signs anything.

import { json, method, wrapCron } from '../_lib/http.js';
import { requireCron } from '../_lib/cron-auth.js';
import { agentsDueForSnapshot, portfolioWithSnapshot } from '../_lib/portfolio-history.js';

const BATCH = 40;
const CONCURRENCY = 4;

export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET', 'POST'])) return;
	if (!requireCron(req, res)) return;

	const due = await agentsDueForSnapshot({ limit: BATCH });
	let recorded = 0;
	let failed = 0;
	const queue = [...due];
	async function worker() {
		while (queue.length) {
			const { agent_id: agentId, network } = queue.shift();
			try {
				const p = await portfolioWithSnapshot({ agentId, network, source: 'cron' });
				if (p) recorded += 1;
			} catch (e) {
				failed += 1;
				console.warn('[cron/agent-portfolio-snapshots] valuation failed', agentId, e?.message);
			}
		}
	}
	await Promise.all(Array.from({ length: CONCURRENCY }, worker));
	return json(res, 200, { ok: true, due: due.length, recorded, failed });
});

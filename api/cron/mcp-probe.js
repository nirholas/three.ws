// @ts-check
// GET /api/cron/mcp-probe: the five-minute synthetic probe of the Grok-facing
// MCP connectors.
//
// Reads the deployed MCP directory (public/.well-known/mcp.json) at run time,
// takes its Grok-facing servers (api/_lib/mcp-probe.js grokFacingTargets) on
// this deployment's origin, and drives each one the way a cloud connector
// does: initialize, notifications/initialized, tools/list, one read-only tool
// call, then the ?auth=oauth discovery path (401 with resource metadata is the
// healthy answer). One row per server lands in mcp_probe_results; rows older
// than 90 days are deleted in the same run.
//
// Ops is paged when a server fails twice in a row (the healthz sensor's `down`)
// and again when it recovers; one failed run alone is a blip and pages nobody.
//
// A concrete file here outranks the [name].js dispatcher, which keeps the
// import graph to the probe, the store and the alert channel.

import { json, method, wrapCron } from '../_lib/http.js';
import { env } from '../_lib/env.js';
import { requireCron } from '../_lib/cron-auth.js';
import { sendOpsAlert } from '../_lib/alerts.js';
import { grokFacingTargets, handshakeMs, loadManifest, probeAll } from '../_lib/mcp-probe.js';
import { latestProbeRows, pruneProbeResults, recordProbeResults } from '../_lib/mcp-probe-store.js';

/**
 * What this run changed for one server, given its rows before the run.
 * @param {Array<{ ok: boolean }>} before newest first
 * @param {{ ok: boolean }} result
 * @returns {'down'|'recovered'|null}
 */
export function transition(before, result) {
	const [prev, prevPrev] = before;
	if (!result.ok) return prev && !prev.ok ? 'down' : null;
	return prev && !prev.ok && prevPrev && !prevPrev.ok ? 'recovered' : null;
}

/**
 * One probe run: probe, store, prune, page. Exported so the operator CLI and
 * the tests drive exactly what the scheduler drives.
 * @param {{ base?: string, stepTimeoutMs?: number, alert?: typeof sendOpsAlert }} [opts]
 */
export async function runMcpProbe({ base = env.APP_ORIGIN, stepTimeoutMs, alert = sendOpsAlert } = {}) {
	const targets = grokFacingTargets(await loadManifest(), { base });
	const before = await latestProbeRows(targets.map((t) => t.server), 2);
	const results = await probeAll(targets, stepTimeoutMs ? { stepTimeoutMs } : undefined);
	await recordProbeResults(results);
	const pruned = await pruneProbeResults();

	for (const r of results) {
		const change = transition(before.get(r.server) || [], r);
		if (change === 'down') {
			await alert(`DOWN: MCP connector ${new URL(r.server).pathname}`, `${r.server}\ntwo consecutive probe failures; ${r.failedStep} failed: ${r.error}`, {
				signature: `mcp-probe:down:${r.server}`,
			});
		} else if (change === 'recovered') {
			await alert(`RECOVERED: MCP connector ${new URL(r.server).pathname}`, `${r.server}\nhandshake ${handshakeMs(r.latencyMs)}ms`, {
				signature: `mcp-probe:recovered:${r.server}:${r.checkedAt}`,
			});
		}
	}

	return {
		ok: results.every((r) => r.ok),
		pruned,
		results: results.map((r) => ({
			server: r.server,
			ok: r.ok,
			failedStep: r.failedStep,
			error: r.error,
			handshakeMs: handshakeMs(r.latencyMs),
			latencyMs: r.latencyMs,
			warnings: r.detail?.warnings || [],
		})),
	};
}

// Worst case is every step timing out on one server: six 10s steps, well
// inside wrapCron's default 120s budget (servers are probed in parallel).
export default wrapCron(async (req, res) => {
	if (!method(req, res, ['GET', 'POST'])) return;
	if (!requireCron(req, res)) return;
	return json(res, 200, await runMcpProbe());
});

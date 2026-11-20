// @ts-check
// Health of the Grok-facing MCP connectors, from the five-minute synthetic
// probe (api/cron/mcp-probe.js -> mcp_probe_results). A connector that fails
// its handshake is invisible to every reachability probe: the endpoint still
// answers HTTP, so only a real initialize -> tools/list -> tools/call run
// says whether Grok can actually use it.
//
// Per server, over its two newest probes:
//   ok        both passed
//   degraded  the newest failed once (one blip; the next run decides)
//   down      two consecutive failures, or no probe in STALE_AFTER_MS
// The subsystem takes the worst server. No probe row ever is `unknown`
// (warming up: the scheduler job has not run yet), never a fault.
//
// readMcpProbeSignals() does the IO; mcpProbeVerdict() is pure given its
// output, the same split as api/_lib/x-mention-health.js.

import { env } from './env.js';
import { grokFacingTargets, loadManifest } from './mcp-probe.js';
import { latestProbeRows } from './mcp-probe-store.js';

export const STALE_AFTER_MS = 15 * 60 * 1000;
const QUERY_TIMEOUT_MS = 4_000;

const RANK = { ok: 0, unknown: 1, degraded: 2, down: 3 };

function withTimeout(promise, ms) {
	return Promise.race([
		promise,
		new Promise((_, reject) => setTimeout(() => reject(new Error('mcp probe health query timed out')), ms)),
	]);
}

/**
 * The servers the cron probes: the Grok-facing entries of the deployed MCP
 * directory, on this deployment's origin. Same derivation as the cron, so the
 * sensor never judges a server the cron does not probe.
 */
export async function probedServers({ base = env.APP_ORIGIN } = {}) {
	return grokFacingTargets(await loadManifest(), { base }).map((t) => t.server);
}

/**
 * @param {Array<{ checkedAt: string, ok: boolean, failedStep?: string|null, error?: string|null }>} rows newest first
 * @param {number} nowMs
 * @returns {{ status: 'ok'|'degraded'|'down'|'unknown', detail: string }}
 */
export function serverVerdict(rows, nowMs) {
	const [latest, previous] = rows;
	if (!latest) return { status: 'unknown', detail: 'not probed yet' };
	const ageMs = nowMs - new Date(latest.checkedAt).getTime();
	if (ageMs > STALE_AFTER_MS) {
		return { status: 'down', detail: `no probe for ${Math.round(ageMs / 60_000)}m (limit ${STALE_AFTER_MS / 60_000}m): the cron is not running` };
	}
	const why = (r) => `${r.failedStep || 'probe'} failed${r.error ? `: ${r.error}` : ''}`;
	if (latest.ok) return { status: 'ok', detail: previous && !previous.ok ? 'passed, recovered from one failure' : 'last two probes passed' };
	if (previous && !previous.ok) return { status: 'down', detail: `two consecutive failures, ${why(latest)}` };
	return { status: 'degraded', detail: `latest probe ${why(latest)}` };
}

/**
 * Roll every server into one verdict: the worst server wins, its reason leads.
 * @param {Map<string, Array<{ checkedAt: string, ok: boolean, failedStep?: string|null, error?: string|null }>>} byServer
 * @param {number} [nowMs]
 */
export function mcpProbeVerdict(byServer, nowMs = Date.now()) {
	const servers = [...byServer.entries()].map(([server, rows]) => ({ server, ...serverVerdict(rows, nowMs) }));
	if (!servers.length) return { status: 'unknown', detail: 'no Grok-facing servers in /.well-known/mcp.json', servers };
	if (servers.every((s) => s.status === 'unknown')) return { status: 'unknown', detail: 'no probe has run yet', servers };
	const worst = servers.reduce((a, b) => (RANK[b.status] > RANK[a.status] ? b : a));
	if (worst.status === 'ok') return { status: 'ok', detail: `${servers.length} connector${servers.length === 1 ? '' : 's'} passing`, servers };
	const path = (u) => {
		try {
			return new URL(u).pathname;
		} catch {
			return u;
		}
	};
	return { status: /** @type {'degraded'|'down'|'unknown'} */ (worst.status), detail: `${path(worst.server)}: ${worst.detail}`, servers };
}

/** @param {{ base?: string }} [opts] */
export async function readMcpProbeSignals(opts = {}) {
	const servers = await probedServers(opts);
	return withTimeout(latestProbeRows(servers, 2), QUERY_TIMEOUT_MS);
}

/**
 * Subsystem-health record for api/healthz.js's `subsystems` block. Never
 * throws: an unreadable ledger reports `unknown`, like every other sensor.
 * @returns {Promise<{ name: string, label: string, status: string, detail: string, metrics?: object }>}
 */
export async function gatherMcpProbeHealth(opts = {}) {
	const base = { name: 'mcp_probe', label: 'Grok MCP connectors (synthetic probe)' };
	let byServer;
	try {
		byServer = await readMcpProbeSignals(opts);
	} catch (err) {
		const msg = String(err?.message || err);
		const detail = /mcp_probe_results/.test(msg) && /does not exist/.test(msg) ? 'mcp_probe_results table missing: run npm run db:migrate' : msg;
		return { ...base, status: 'unknown', detail };
	}
	const verdict = mcpProbeVerdict(byServer);
	return {
		...base,
		status: verdict.status,
		detail: verdict.detail,
		metrics: { servers: verdict.servers.map(({ server, status }) => ({ server, status, lastCheckedAt: byServer.get(server)?.[0]?.checkedAt ?? null })) },
	};
}

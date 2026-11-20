// @ts-check
// mcp_probe_results: the ledger behind the five-minute connector probe.
//
// One row per probed server per run (migration 20261120205747). Written by
// api/cron/mcp-probe.js; read by the mcp_probe healthz sensor
// (api/_lib/mcp-probe-health.js) and the public uptime feed
// (api/status/mcp.js). Every read here returns aggregates or the newest rows
// per server; error text stays server-side except where a caller chooses to
// publish it.

import { sql } from './db.js';

export const RETENTION_DAYS = 90;

/**
 * @param {Array<{ server: string, ok: boolean, failedStep: string|null, error: string|null,
 *   latencyMs: Record<string, number>, checkedAt: string, detail?: object }>} results
 */
export async function recordProbeResults(results) {
	for (const r of results) {
		await sql`
			insert into mcp_probe_results (checked_at, server, ok, failed_step, latency_ms, error, detail)
			values (
				${r.checkedAt}, ${r.server}, ${r.ok}, ${r.failedStep},
				${JSON.stringify(r.latencyMs || {})}::jsonb, ${r.error},
				${JSON.stringify(r.detail || {})}::jsonb
			)
		`;
	}
}

/** Delete rows past the retention window. Returns the number removed. */
export async function pruneProbeResults(days = RETENTION_DAYS) {
	const rows = await sql`
		with gone as (
			delete from mcp_probe_results
			where checked_at < now() - make_interval(days => ${days})
			returning 1
		)
		select count(*)::int as n from gone
	`;
	return Number(rows[0]?.n || 0);
}

/**
 * The newest `perServer` rows for each named server, newest first.
 * @param {string[]} servers
 * @param {number} [perServer]
 * @returns {Promise<Map<string, Array<{ checkedAt: string, ok: boolean, failedStep: string|null, error: string|null }>>>}
 */
export async function latestProbeRows(servers, perServer = 2) {
	/** @type {Map<string, Array<{ checkedAt: string, ok: boolean, failedStep: string|null, error: string|null }>>} */
	const out = new Map(servers.map((s) => [s, []]));
	if (!servers.length) return out;
	const rows = await sql`
		select server, checked_at, ok, failed_step, error
		from (
			select server, checked_at, ok, failed_step, error,
			       row_number() over (partition by server order by checked_at desc) as rn
			from mcp_probe_results
			where server = any(${servers})
		) ranked
		where rn <= ${perServer}
		order by server, checked_at desc
	`;
	for (const r of rows) {
		out.get(r.server)?.push({
			checkedAt: new Date(r.checked_at).toISOString(),
			ok: Boolean(r.ok),
			failedStep: r.failed_step ?? null,
			error: r.error ?? null,
		});
	}
	return out;
}

/**
 * Per server, success rate and latency percentiles over the last 24 hours,
 * 7 days and 30 days, plus the newest probe. Latency percentiles are over
 * passing probes only: a timed-out step has no meaningful latency.
 * @returns {Promise<Array<{
 *   server: string,
 *   last: { checkedAt: string, ok: boolean, failedStep: string|null },
 *   windows: Record<'24h'|'7d'|'30d', { probes: number, passed: number, successRate: number|null,
 *     handshakeP50Ms: number|null, handshakeP95Ms: number|null, toolCallP50Ms: number|null, toolCallP95Ms: number|null }>,
 * }>>}
 */
export async function probeUptime() {
	// The handshake is the three steps a connector waits on before it can call
	// a tool; the sum is null when the probe stopped before tools/list.
	const rows = await sql`
		with windows(label, span) as (
			values ('24h', interval '24 hours'), ('7d', interval '7 days'), ('30d', interval '30 days')
		)
		select r.server, w.label,
		       count(*)::int as probes,
		       count(*) filter (where r.ok)::int as passed,
		       percentile_cont(0.5) within group (order by ((r.latency_ms->>'initialize')::numeric + (r.latency_ms->>'notifications/initialized')::numeric + (r.latency_ms->>'tools/list')::numeric)) filter (where r.ok) as hs_p50,
		       percentile_cont(0.95) within group (order by ((r.latency_ms->>'initialize')::numeric + (r.latency_ms->>'notifications/initialized')::numeric + (r.latency_ms->>'tools/list')::numeric)) filter (where r.ok) as hs_p95,
		       percentile_cont(0.5) within group (order by (r.latency_ms->>'tools/call')::numeric) filter (where r.ok) as tc_p50,
		       percentile_cont(0.95) within group (order by (r.latency_ms->>'tools/call')::numeric) filter (where r.ok) as tc_p95
		from mcp_probe_results r
		join windows w on r.checked_at > now() - w.span
		group by r.server, w.label
	`;
	const last = await sql`
		select distinct on (server) server, checked_at, ok, failed_step
		from mcp_probe_results
		where checked_at > now() - interval '30 days'
		order by server, checked_at desc
	`;

	const round = (v) => (v == null ? null : Math.round(Number(v)));
	const empty = () => ({ probes: 0, passed: 0, successRate: null, handshakeP50Ms: null, handshakeP95Ms: null, toolCallP50Ms: null, toolCallP95Ms: null });
	/** @type {Map<string, any>} */
	const byServer = new Map();
	for (const l of last) {
		byServer.set(l.server, {
			server: l.server,
			last: { checkedAt: new Date(l.checked_at).toISOString(), ok: Boolean(l.ok), failedStep: l.failed_step ?? null },
			windows: { '24h': empty(), '7d': empty(), '30d': empty() },
		});
	}
	for (const r of rows) {
		const entry = byServer.get(r.server);
		if (!entry) continue;
		const probes = Number(r.probes);
		const passed = Number(r.passed);
		entry.windows[r.label] = {
			probes,
			passed,
			successRate: probes ? passed / probes : null,
			handshakeP50Ms: round(r.hs_p50),
			handshakeP95Ms: round(r.hs_p95),
			toolCallP50Ms: round(r.tc_p50),
			toolCallP95Ms: round(r.tc_p95),
		};
	}
	return [...byServer.values()].sort((a, b) => a.server.localeCompare(b.server));
}

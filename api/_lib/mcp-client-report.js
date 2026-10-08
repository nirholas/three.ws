// The MCP clients report: which AI clients open sessions on the hosted MCP
// servers, how many tools they call, and which tools. Reads the daily aggregate
// that api/_lib/mcp-client-analytics.js writes. Served by GET
// /api/ops/mcp-clients and drawn by the /mcp-clients board.

import { sql } from './db.js';

export const REPORT_DEFAULT_DAYS = 30;
const REPORT_MIN_DAYS = 1;
const REPORT_MAX_DAYS = 365;
const TOP_TOOLS = 5;
const TOP_NAMES = 5;
const ROW_CAP = 50_000;

export function clampReportDays(value) {
	// Number(null) and Number('') are both 0, which would clamp an absent
	// parameter to a one-day window instead of the default.
	if (value == null || value === '') return REPORT_DEFAULT_DAYS;
	const n = Math.floor(Number(value));
	if (!Number.isFinite(n)) return REPORT_DEFAULT_DAYS;
	return Math.min(REPORT_MAX_DAYS, Math.max(REPORT_MIN_DAYS, n));
}

function bump(map, key, by) {
	map.set(key, (map.get(key) || 0) + by);
}

function topOf(map, n, keyName, valueName) {
	return [...map.entries()]
		.sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
		.slice(0, n)
		.map(([k, v]) => ({ [keyName]: k, [valueName]: v }));
}

function isoDay(d) {
	return d.toISOString().slice(0, 10);
}

/** Every calendar day of the window, oldest first, ending at `today` (UTC). */
export function windowDays(days, today = new Date()) {
	const end = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
	return Array.from({ length: days }, (_, i) => isoDay(new Date(end - (days - 1 - i) * 86_400_000)));
}

/**
 * Fold daily aggregate rows into the report. Pure, so the board's numbers are
 * testable without a database.
 * @param {Array<{day: string, surface: string, client: string, client_name: string, client_version: string, auth_kind: string, sessions: number, calls: number, tools: Record<string, number>}>} rows
 */
export function summarizeMcpClients(rows, { days = REPORT_DEFAULT_DAYS, today = new Date() } = {}) {
	const byClient = new Map();
	const surfaces = new Map();
	const allTools = new Map();
	const dayList = windowDays(days, today);
	const daily = new Map(dayList.map((d) => [d, new Map()]));
	let sessions = 0;
	let calls = 0;

	for (const r of rows) {
		const s = Number(r.sessions) || 0;
		const c = Number(r.calls) || 0;
		sessions += s;
		calls += c;
		let entry = byClient.get(r.client);
		if (!entry) {
			entry = { sessions: 0, calls: 0, names: new Map(), versions: new Map(), auth: new Map(), surfaces: new Map(), tools: new Map() };
			byClient.set(r.client, entry);
		}
		entry.sessions += s;
		entry.calls += c;
		bump(entry.names, r.client_name, s + c);
		if (r.client_version) bump(entry.versions, r.client_version, s);
		bump(entry.auth, r.auth_kind, s + c);
		bump(entry.surfaces, r.surface, s + c);

		const sf = surfaces.get(r.surface) || { sessions: 0, calls: 0 };
		sf.sessions += s;
		sf.calls += c;
		surfaces.set(r.surface, sf);

		for (const [tool, n] of Object.entries(r.tools || {})) {
			const v = Number(n) || 0;
			bump(entry.tools, tool, v);
			bump(allTools, tool, v);
		}

		const day = daily.get(String(r.day).slice(0, 10));
		if (day) {
			const d = day.get(r.client) || { sessions: 0, calls: 0 };
			d.sessions += s;
			d.calls += c;
			day.set(r.client, d);
		}
	}

	const clients = [...byClient.entries()]
		.map(([client, e]) => ({
			client,
			sessions: e.sessions,
			calls: e.calls,
			calls_per_session: e.sessions > 0 ? Math.round((e.calls / e.sessions) * 10) / 10 : null,
			names: topOf(e.names, TOP_NAMES, 'name', 'events'),
			versions: topOf(e.versions, TOP_NAMES, 'version', 'sessions'),
			auth: Object.fromEntries(e.auth),
			surfaces: Object.fromEntries(e.surfaces),
			top_tools: topOf(e.tools, TOP_TOOLS, 'tool', 'calls'),
		}))
		.sort((a, b) => b.sessions - a.sessions || b.calls - a.calls || a.client.localeCompare(b.client));

	return {
		window_days: days,
		since: dayList[0],
		totals: {
			sessions,
			calls,
			clients: clients.filter((c) => c.client !== 'unknown').length,
			unattributed_calls: byClient.get('unknown')?.calls || 0,
		},
		clients,
		surfaces: [...surfaces.entries()]
			.map(([surface, v]) => ({ surface, ...v }))
			.sort((a, b) => b.sessions + b.calls - (a.sessions + a.calls)),
		tools: topOf(allTools, 10, 'tool', 'calls'),
		daily: dayList.map((day) => ({ day, clients: Object.fromEntries(daily.get(day)) })),
	};
}

/** Read the window and build the report. A failed read names itself in `degraded`. */
export async function gatherMcpClients({ days = REPORT_DEFAULT_DAYS } = {}) {
	const windowLen = clampReportDays(days);
	const generated_at = new Date().toISOString();
	try {
		const rows = await sql`
			select day::text as day, surface, client, client_name, client_version, auth_kind, sessions, calls, tools
			from mcp_client_daily
			where day >= current_date - ${windowLen - 1}::int
			order by day
			limit ${ROW_CAP}
		`;
		return { ok: true, generated_at, degraded: [], ...summarizeMcpClients(rows, { days: windowLen }) };
	} catch (err) {
		return {
			ok: false,
			generated_at,
			degraded: [{ panel: 'mcp_client_daily', error: String(err?.message || err).slice(0, 200) }],
			...summarizeMcpClients([], { days: windowLen }),
		};
	}
}

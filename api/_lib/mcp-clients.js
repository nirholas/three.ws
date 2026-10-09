// @ts-check
// Which AI clients use the hosted three.ws MCP servers.
//
// Every MCP `initialize` carries clientInfo.name and clientInfo.version. This
// module records it per session and counts tool calls against that session, so
// "how much of our traffic is Grok Bot versus Claude, ChatGPT or Cursor" has a
// measured answer instead of a guess.
//
// Recording
//   trackMcp() runs after the HTTP response is written. It turns the request
//   into small events, buffers them in process and writes them in one batched
//   round trip a moment later, so no MCP request ever waits on analytics. A
//   failed write is logged and dropped at this boundary: analytics must never
//   cost a caller a response.
//
//   initialize  -> one mcp_client_sessions row (raw, expires after 30 days) and
//                  one more `sessions` on the day's aggregate row.
//   tools/call  -> `calls` on that session, on the day's aggregate row and on
//                  the per-tool aggregate. The call joins its client through
//                  the Mcp-Session-Id the server issued on initialize. A client
//                  that never echoes the id is counted under `unknown`, which
//                  the report states as its own coverage figure.
//
// What is never stored: request bodies, tool arguments, IPs, tokens, user ids.
// Only a normalized client name, its version, the auth kind and tool names.
//
// Reading
//   gatherMcpClients() backs GET /api/ops/mcp-clients and the /mcp-clients page.
//
// Retention
//   Aggregates are kept. Raw session rows are deleted after RAW_RETENTION_DAYS
//   by purgeExpiredMcpSessions(), called from api/cron/db-retention.js.

import { randomUUID } from 'node:crypto';
import { sql } from './db.js';
import { logger } from './usage.js';

const log = logger('mcp-clients');

export const RAW_RETENTION_DAYS = 30;
export const REPORT_MIN_DAYS = 1;
export const REPORT_MAX_DAYS = 365;
export const REPORT_DEFAULT_DAYS = 30;

export const UNKNOWN_CLIENT = 'unknown';
export const OTHER_CLIENT = 'other';
const OTHER_TOOL = 'other';
const REJECTED_TOOL = 'unknown_tool';

const NAME_MAX = 64;
const VERSION_MAX = 32;
const TOOL_RE = /^[A-Za-z0-9_.:-]{1,64}$/;
const SESSION_RE = /^(?:mcs|grk)_[0-9a-f-]{36}$/;

// A caller picks its own clientInfo, so an unbounded set of names is one
// initialize loop away from an unbounded table. Each process admits this many
// distinct names (and tools) per day and folds the rest into `other`.
const MAX_DISTINCT_CLIENTS_PER_DAY = 300;
const MAX_DISTINCT_TOOLS_PER_DAY = 200;

const FLUSH_DELAY_MS = 250;
const FLUSH_AT_EVENTS = 100;
const BUFFER_LIMIT = 5000;
const SESSION_CACHE_LIMIT = 5000;

/** A client name as it is grouped: trimmed, lowercased, safe charset, length-capped. */
export function normalizeClientName(raw) {
	if (typeof raw !== 'string') return UNKNOWN_CLIENT;
	const cleaned = raw
		.normalize('NFKC')
		.toLowerCase()
		.replace(/[^a-z0-9 ._:/@+-]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, NAME_MAX)
		.trim();
	return cleaned || UNKNOWN_CLIENT;
}

/** A client version, capped and stripped of anything that is not a version character. */
export function normalizeClientVersion(raw) {
	if (typeof raw !== 'string' && typeof raw !== 'number') return '';
	return String(raw)
		.replace(/[^A-Za-z0-9 ._+:/-]/g, '')
		.trim()
		.slice(0, VERSION_MAX);
}

/** The Mcp-Session-Id a client echoed, if it is one this server issued. */
export function sessionIdOf(req) {
	const sid = req?.headers?.['mcp-session-id'];
	return typeof sid === 'string' && SESSION_RE.test(sid) ? sid : null;
}

/**
 * How the request authenticated: anonymous, install (a free studio install
 * token), key (an API key), oauth (an OAuth access token) or x402 (a paid call).
 */
export function authKindOf(auth, installToken) {
	const source = auth?.source;
	if (source === 'apikey') return 'key';
	if (source === 'oauth') return 'oauth';
	if (source === 'x402') return 'x402';
	if (installToken) return 'install';
	if (auth?.userId) return 'oauth';
	return 'anonymous';
}

const utcDay = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

/** True when the (possibly batched) body opens a session. */
export function initializes(body) {
	return (Array.isArray(body) ? body : [body]).some((m) => m && m.method === 'initialize');
}

/**
 * Issue the Mcp-Session-Id for an initialize response and expose it to browser
 * clients. Returns the id, or null when the body is not an initialize.
 */
export function issueSession(res, body, prefix = 'mcs') {
	if (!initializes(body)) return null;
	const id = `${prefix}_${randomUUID()}`;
	res.setHeader('mcp-session-id', id);
	const exposed = typeof res.getHeader === 'function' ? res.getHeader('access-control-expose-headers') : undefined;
	res.setHeader('access-control-expose-headers', exposed ? `${exposed}, mcp-session-id` : 'mcp-session-id');
	return id;
}

// ---- in-process state ------------------------------------------------------

/** @type {any[]} */
let buffer = [];
let timer = null;
/** @type {Map<string, { name: string, version: string }>} */
const sessionCache = new Map();
/** @type {Map<string, Set<string>>} */
const distinct = new Map();

function remember(sid, client) {
	if (sessionCache.size >= SESSION_CACHE_LIMIT) {
		sessionCache.delete(sessionCache.keys().next().value);
	}
	sessionCache.set(sid, client);
}

function admit(kind, day, value, max, fallback) {
	const key = `${kind}:${day}`;
	let seen = distinct.get(key);
	if (!seen) {
		for (const k of distinct.keys()) if (k.startsWith(`${kind}:`)) distinct.delete(k);
		seen = new Set();
		distinct.set(key, seen);
	}
	if (seen.has(value)) return value;
	if (seen.size >= max) return fallback;
	seen.add(value);
	return value;
}

function toolLabel(msg, response, day) {
	const name = msg?.params?.name;
	if (typeof name !== 'string' || !TOOL_RE.test(name)) return REJECTED_TOOL;
	const code = response?.error?.code;
	if (code === -32601 || code === -32602) return REJECTED_TOOL;
	return admit('tool', day, name, MAX_DISTINCT_TOOLS_PER_DAY, OTHER_TOOL);
}

/**
 * Queue the analytics events for one finished MCP request. Never throws and
 * never awaits: call it after the response is written.
 *
 * @param {object} p
 * @param {string} p.surface            'mcp', 'mcp-studio', 'mcp-3d', ...
 * @param {any} p.req
 * @param {any} p.body                  the parsed JSON-RPC body
 * @param {any[]} [p.responses]         the JSON-RPC responses sent back
 * @param {any} [p.auth]                the resolved principal
 * @param {string|null} [p.issuedSessionId] the id issued on this initialize
 * @param {string|null} [p.installToken]
 */
export function trackMcp({ surface, req, body, responses = [], auth, issuedSessionId = null, installToken = null }) {
	try {
		const batch = Array.isArray(body) ? body : [body];
		const day = utcDay();
		const kind = authKindOf(auth, installToken);
		const sid = sessionIdOf(req);
		const events = [];

		const init = batch.find((m) => m && m.method === 'initialize');
		if (init && issuedSessionId) {
			const info = init.params?.clientInfo;
			const name = admit('client', day, normalizeClientName(info?.name), MAX_DISTINCT_CLIENTS_PER_DAY, OTHER_CLIENT);
			const version = normalizeClientVersion(info?.version);
			remember(issuedSessionId, { name, version });
			events.push({ t: 'init', sid: issuedSessionId, day, surface, name, version, kind });
		}

		for (const msg of batch) {
			if (!msg || msg.method !== 'tools/call') continue;
			const response = responses.find((r) => r && r.id === msg.id);
			events.push({ t: 'call', sid, day, surface, kind, tool: toolLabel(msg, response, day) });
		}

		if (!events.length) return;
		buffer.push(...events);
		if (buffer.length > BUFFER_LIMIT) buffer = buffer.slice(-BUFFER_LIMIT);
		if (buffer.length >= FLUSH_AT_EVENTS) void flushMcpTracking();
		else if (!timer) {
			timer = setTimeout(() => void flushMcpTracking(), FLUSH_DELAY_MS);
			timer.unref?.();
		}
	} catch (err) {
		log.warn('track_failed', { message: String(err?.message || err).slice(0, 160) });
	}
}

/** Write the buffered events now. Errors are logged and swallowed. */
export async function flushMcpTracking() {
	if (timer) {
		clearTimeout(timer);
		timer = null;
	}
	const events = buffer;
	buffer = [];
	if (!events.length) return;
	try {
		await writeEvents(events);
	} catch (err) {
		log.warn('flush_failed', { events: events.length, message: String(err?.message || err).slice(0, 160) });
	}
}

async function resolveClients(sids) {
	const missing = [...new Set(sids)].filter((s) => s && !sessionCache.has(s));
	if (!missing.length) return;
	const rows = await sql`
		select session_id, client_name, client_version
		from mcp_client_sessions
		where session_id = any(${missing}::text[])
	`;
	for (const r of rows) remember(r.session_id, { name: r.client_name, version: r.client_version });
}

function tally(rows, keyOf) {
	const out = new Map();
	for (const row of rows) {
		const key = keyOf(row);
		const hit = out.get(key);
		if (hit) hit.n += 1;
		else out.set(key, { row, n: 1 });
	}
	return [...out.values()];
}

async function writeEvents(events) {
	const inits = events.filter((e) => e.t === 'init');
	const calls = events.filter((e) => e.t === 'call');

	if (inits.length) {
		await sql`
			with src as (
				select * from unnest(
					${inits.map((e) => e.sid)}::text[],
					${inits.map((e) => e.day)}::date[],
					${inits.map((e) => e.surface)}::text[],
					${inits.map((e) => e.name)}::text[],
					${inits.map((e) => e.version)}::text[],
					${inits.map((e) => e.kind)}::text[]
				) as u(sid, day, surface, name, version, kind)
			),
			ins as (
				insert into mcp_client_sessions (session_id, surface, client_name, client_version, auth_kind)
				select sid, surface, name, version, kind from src
				on conflict (session_id) do nothing
				returning session_id
			)
			insert into mcp_client_daily (day, surface, client_name, client_version, auth_kind, sessions)
			select s.day, s.surface, s.name, s.version, s.kind, count(*)::int
			from src s join ins on ins.session_id = s.sid
			group by 1, 2, 3, 4, 5
			on conflict (day, surface, client_name, client_version, auth_kind)
			do update set sessions = mcp_client_daily.sessions + excluded.sessions
		`;
	}

	if (!calls.length) return;
	await resolveClients(calls.map((c) => c.sid));
	const resolved = calls.map((c) => {
		const client = (c.sid && sessionCache.get(c.sid)) || { name: UNKNOWN_CLIENT, version: '' };
		return { ...c, name: client.name, version: client.version };
	});

	const perDaily = tally(resolved, (c) => [c.day, c.surface, c.name, c.version, c.kind].join('\u0000'));
	await sql`
		insert into mcp_client_daily (day, surface, client_name, client_version, auth_kind, calls)
		select * from unnest(
			${perDaily.map((d) => d.row.day)}::date[],
			${perDaily.map((d) => d.row.surface)}::text[],
			${perDaily.map((d) => d.row.name)}::text[],
			${perDaily.map((d) => d.row.version)}::text[],
			${perDaily.map((d) => d.row.kind)}::text[],
			${perDaily.map((d) => d.n)}::int[]
		)
		on conflict (day, surface, client_name, client_version, auth_kind)
		do update set calls = mcp_client_daily.calls + excluded.calls
	`;

	const perTool = tally(resolved, (c) => [c.day, c.surface, c.name, c.kind, c.tool].join('\u0000'));
	await sql`
		insert into mcp_client_tool_daily (day, surface, client_name, auth_kind, tool, calls)
		select * from unnest(
			${perTool.map((d) => d.row.day)}::date[],
			${perTool.map((d) => d.row.surface)}::text[],
			${perTool.map((d) => d.row.name)}::text[],
			${perTool.map((d) => d.row.kind)}::text[],
			${perTool.map((d) => d.row.tool)}::text[],
			${perTool.map((d) => d.n)}::int[]
		)
		on conflict (day, surface, client_name, auth_kind, tool)
		do update set calls = mcp_client_tool_daily.calls + excluded.calls
	`;

	const perSession = tally(resolved.filter((c) => c.sid), (c) => c.sid);
	if (perSession.length) {
		await sql`
			update mcp_client_sessions s
			set calls = s.calls + u.n, last_seen_at = now()
			from unnest(${perSession.map((d) => d.row.sid)}::text[], ${perSession.map((d) => d.n)}::int[]) as u(sid, n)
			where s.session_id = u.sid
		`;
	}
}

/** Delete raw session rows past the retention window. Aggregates are untouched. */
export async function purgeExpiredMcpSessions() {
	const rows = await sql`
		delete from mcp_client_sessions
		where last_seen_at < now() - make_interval(days => ${RAW_RETENTION_DAYS}::int)
		returning 1
	`;
	return { deleted: rows.length };
}

// ---- report ----------------------------------------------------------------

/** Clamp a caller-supplied window to a whole number of days in range. */
export function clampReportDays(value) {
	if (value == null || value === '') return REPORT_DEFAULT_DAYS;
	const n = Math.floor(Number(value));
	if (!Number.isFinite(n)) return REPORT_DEFAULT_DAYS;
	return Math.min(REPORT_MAX_DAYS, Math.max(REPORT_MIN_DAYS, n));
}

const share = (n, d) => (d > 0 ? Math.round((n / d) * 10000) / 10000 : null);
const top = (map, n, key) =>
	[...map.entries()]
		.sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
		.slice(0, n)
		.map(([k, v]) => ({ [key]: k, calls: v }));

/**
 * Per-client sessions, calls and top tools over a rolling window.
 * Read-only: SELECTs and nothing else.
 */
export async function gatherMcpClients({ days = REPORT_DEFAULT_DAYS } = {}) {
	const windowDays = clampReportDays(days);
	const since = new Date(Date.now() - (windowDays - 1) * 86_400_000).toISOString().slice(0, 10);

	const [daily, tools] = await Promise.all([
		sql`
			select day::text as day, surface, client_name, client_version, auth_kind,
			       sessions::int as sessions, calls::int as calls
			from mcp_client_daily where day >= ${since}::date
		`,
		sql`
			select client_name, tool, sum(calls)::int as calls
			from mcp_client_tool_daily where day >= ${since}::date
			group by 1, 2
		`,
	]);

	const clients = new Map();
	const ensure = (name) => {
		let c = clients.get(name);
		if (!c) {
			c = { client: name, sessions: 0, calls: 0, versions: new Map(), surfaces: new Map(), auth: new Map(), tools: new Map() };
			clients.set(name, c);
		}
		return c;
	};
	const dayTotals = new Map();
	for (const r of daily) {
		const c = ensure(r.client_name);
		c.sessions += r.sessions;
		c.calls += r.calls;
		const bump = (m, k) => {
			const hit = m.get(k) || { sessions: 0, calls: 0 };
			hit.sessions += r.sessions;
			hit.calls += r.calls;
			m.set(k, hit);
		};
		bump(c.versions, r.client_version || '(none)');
		bump(c.surfaces, r.surface);
		bump(c.auth, r.auth_kind);
		const d = dayTotals.get(r.day) || { day: r.day, sessions: 0, calls: 0, by_client: {} };
		d.sessions += r.sessions;
		d.calls += r.calls;
		d.by_client[r.client_name] = (d.by_client[r.client_name] || 0) + r.calls;
		dayTotals.set(r.day, d);
	}
	for (const t of tools) ensure(t.client_name).tools.set(t.tool, t.calls);

	const totalCalls = [...clients.values()].reduce((s, c) => s + c.calls, 0);
	const totalSessions = [...clients.values()].reduce((s, c) => s + c.sessions, 0);
	const listOf = (m, key) =>
		[...m.entries()]
			.sort((a, b) => b[1].calls - a[1].calls || b[1].sessions - a[1].sessions)
			.slice(0, 8)
			.map(([k, v]) => ({ [key]: k, sessions: v.sessions, calls: v.calls }));

	const ranked = [...clients.values()]
		.sort((a, b) => b.calls - a.calls || b.sessions - a.sessions || a.client.localeCompare(b.client))
		.slice(0, 50)
		.map((c) => ({
			client: c.client,
			sessions: c.sessions,
			calls: c.calls,
			share_of_calls: share(c.calls, totalCalls),
			versions: listOf(c.versions, 'version'),
			surfaces: listOf(c.surfaces, 'surface'),
			auth_kinds: listOf(c.auth, 'auth_kind'),
			top_tools: top(c.tools, 5, 'tool'),
		}));

	const series = [];
	const end = new Date(`${utcDay()}T00:00:00Z`);
	for (let i = windowDays - 1; i >= 0; i--) {
		const day = new Date(end.getTime() - i * 86_400_000).toISOString().slice(0, 10);
		series.push(dayTotals.get(day) || { day, sessions: 0, calls: 0, by_client: {} });
	}

	const unknown = clients.get(UNKNOWN_CLIENT);
	return {
		ok: true,
		generated_at: new Date().toISOString(),
		window_days: windowDays,
		raw_retention_days: RAW_RETENTION_DAYS,
		totals: {
			clients: clients.size,
			sessions: totalSessions,
			calls: totalCalls,
			unattributed_calls: unknown?.calls ?? 0,
			unattributed_share: share(unknown?.calls ?? 0, totalCalls),
		},
		clients: ranked,
		daily: series,
	};
}

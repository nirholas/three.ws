// Which AI clients use the hosted MCP servers, and for what.
//
// Every MCP `initialize` carries clientInfo { name, version }. On initialize a
// server issues an Mcp-Session-Id and records one session row (who, which
// surface, how it authenticated); a conforming client echoes the id on every
// later request, so each tools/call is counted against the client that opened
// the session. Only names, versions, counts and tool names are kept, never a
// request body or a tool argument. Schema: migration
// 20261008200000_mcp_client_analytics.sql. Read by GET /api/ops/mcp-clients.
//
// Writes never touch the request path: events queue in memory and flush in one
// batch shortly after the response is sent, and a failed flush is logged and
// dropped at that boundary. Telemetry that cannot be written is not worth a
// slower or failed tool call.

import { randomUUID } from 'node:crypto';
import { sql } from './db.js';

export const SESSION_HEADER = 'mcp-session-id';

// The ids this platform issues: `mcs_` on every server, `grk_` on the Grok
// surface, whose per-caller rate caps also key on it (api/_mcp-studio/handler.js).
const SESSION_RE = /^(mcs|grk)_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOOL_RE = /^[A-Za-z0-9_.:/-]{1,64}$/;
const NAME_MAX = 64;
const VERSION_MAX = 32;
const FLUSH_DELAY_MS = 250;
const QUEUE_MAX = 5000;

export const AUTH_KINDS = ['anonymous', 'install', 'key', 'oauth', 'x402'];

// Known clients by the clientInfo.name they send, first match wins. A name that
// matches none is its own family, so a new client shows up under the name it
// chose rather than disappearing into a bucket.
const FAMILIES = [
	[/probe/, 'probe'],
	[/claude[-_ ]?code/, 'claude-code'],
	[/claude|anthropic/, 'claude'],
	[/openai|chatgpt/, 'chatgpt'],
	[/grok|xai/, 'grok'],
	[/cursor/, 'cursor'],
	[/visual studio code|vs ?code|copilot/, 'vscode'],
	[/windsurf|codeium/, 'windsurf'],
	[/gemini/, 'gemini'],
	[/inspector/, 'mcp-inspector'],
	[/cline/, 'cline'],
	[/zed/, 'zed'],
	[/goose/, 'goose'],
];

/** clientInfo.name as stored: control characters stripped, trimmed, lowercased, capped. */
export function normalizeClientName(raw) {
	if (typeof raw !== 'string') return 'unknown';
	// eslint-disable-next-line no-control-regex
	const s = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().toLowerCase().slice(0, NAME_MAX).trim();
	return s || 'unknown';
}

export function normalizeClientVersion(raw) {
	if (typeof raw !== 'string') return '';
	// eslint-disable-next-line no-control-regex
	return raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, VERSION_MAX).trim();
}

/** The client family a normalized name belongs to (claude, chatgpt, grok, probe, ...). */
export function clientFamily(name) {
	for (const [re, family] of FAMILIES) if (re.test(name)) return family;
	return name;
}

/** How a caller authenticated, from the principal the MCP auth layer resolved. */
export function authKindOf(auth) {
	switch (auth?.source) {
		case 'oauth':
			return 'oauth';
		case 'apikey':
			return 'key';
		case 'x402':
			return 'x402';
		default:
			return 'anonymous';
	}
}

/**
 * The credential a request presents, for servers that resolve auth per tool
 * rather than per request. Labels what was presented, not whether it verified.
 */
export function authKindFromHeaders(req) {
	const h = req?.headers || {};
	const authz = typeof h.authorization === 'string' ? h.authorization : '';
	if (/^bearer\s+sk_(live|test)_/i.test(authz)) return 'key';
	if (/^bearer\s+\S/i.test(authz)) return 'oauth';
	if (h['x-payment'] || h['payment-signature']) return 'x402';
	return 'anonymous';
}

/** True for a session id this platform issued. */
export function isIssuedSessionId(id) {
	return typeof id === 'string' && SESSION_RE.test(id);
}

function messagesOf(body) {
	return (Array.isArray(body) ? body : [body]).filter((m) => m && typeof m === 'object');
}

function surfaceFrom(req) {
	try {
		const path = new URL(req?.url || '/', 'http://localhost').pathname;
		const m = path.match(/^\/api\/([a-z0-9-]+)/);
		return m ? m[1] : 'unknown';
	} catch {
		return 'unknown';
	}
}

function exposeSessionHeader(res) {
	const exposed = res.getHeader?.('access-control-expose-headers');
	if (typeof exposed === 'string' && exposed.toLowerCase().includes(SESSION_HEADER)) return;
	// A browser MCP client cannot echo a header it is not allowed to read.
	res.setHeader('access-control-expose-headers', exposed ? `${exposed}, ${SESSION_HEADER}` : SESSION_HEADER);
}

const queue = { inits: [], calls: [] };
let timer = null;
let flushing = null;

function scheduleFlush() {
	// Tests drive flushMcpClientEvents() themselves, so a stray timer never
	// writes into a neighbouring test's mocked database.
	if (timer || process.env.VITEST) return;
	timer = setTimeout(() => {
		timer = null;
		flushMcpClientEvents().catch(() => {});
	}, FLUSH_DELAY_MS);
	timer.unref?.();
}

function enqueue(list, event) {
	if (queue.inits.length + queue.calls.length >= QUEUE_MAX) return;
	list.push(event);
	scheduleFlush();
}

/**
 * Record one MCP POST. Call it once the request is authorized and before the
 * response headers are written: an `initialize` gets a fresh Mcp-Session-Id
 * header and a session event, and every tools/call is counted against the
 * session id the client echoed (or against "unknown" when it sent none).
 *
 * @param {object} o
 * @param {unknown} o.body     the parsed JSON-RPC body (single or batch)
 * @param {object}  o.req
 * @param {object}  o.res
 * @param {string} [o.surface] defaults to the /api/<surface> path segment
 * @param {string} [o.authKind] one of AUTH_KINDS; defaults to authKindOf(o.auth)
 * @param {object} [o.auth]   the resolved MCP principal
 * @param {string} [o.sessionPrefix] 'mcs' (default) or 'grk'
 * @returns {string|null} the session id issued on this response, if any
 */
export function trackMcpRequest({ body, req, res, surface, authKind, auth, sessionPrefix = 'mcs' }) {
	try {
		const msgs = messagesOf(body);
		const kind = AUTH_KINDS.includes(authKind) ? authKind : authKindOf(auth);
		const where = surface || surfaceFrom(req);
		let issued = null;
		for (const m of msgs) {
			if (m.method === 'initialize') {
				if (!issued) {
					issued = `${sessionPrefix === 'grk' ? 'grk' : 'mcs'}_${randomUUID()}`;
					res.setHeader(SESSION_HEADER, issued);
					exposeSessionHeader(res);
				}
				const info = m.params?.clientInfo || {};
				const name = normalizeClientName(info.name);
				enqueue(queue.inits, {
					sessionId: issued,
					surface: where,
					client: clientFamily(name),
					name,
					version: normalizeClientVersion(info.version),
					authKind: kind,
				});
			} else if (m.method === 'tools/call') {
				const tool = m.params?.name;
				// A batch may open a session and call a tool in the same request.
				const sent = req?.headers?.[SESSION_HEADER];
				enqueue(queue.calls, {
					sessionId: issued || (isIssuedSessionId(sent) ? sent : null),
					surface: where,
					tool: typeof tool === 'string' && TOOL_RE.test(tool) ? tool : '(invalid)',
					authKind: kind,
				});
			}
		}
		return issued;
	} catch (err) {
		console.warn('[mcp-clients] track failed', err?.message);
		return null;
	}
}

async function writeInits(inits) {
	if (!inits.length) return;
	await sql`
		with s as (
			insert into mcp_client_sessions (session_id, surface, client, client_name, client_version, auth_kind)
			select * from unnest(
				${inits.map((e) => e.sessionId)}::text[],
				${inits.map((e) => e.surface)}::text[],
				${inits.map((e) => e.client)}::text[],
				${inits.map((e) => e.name)}::text[],
				${inits.map((e) => e.version)}::text[],
				${inits.map((e) => e.authKind)}::text[]
			)
			on conflict (session_id) do nothing
			returning surface, client, client_name, client_version, auth_kind
		)
		insert into mcp_client_daily (day, surface, client, client_name, client_version, auth_kind, sessions)
		select current_date, surface, client, client_name, client_version, auth_kind, count(*)::int
		from s
		group by surface, client, client_name, client_version, auth_kind
		on conflict (day, surface, client_name, client_version, auth_kind)
		do update set sessions = mcp_client_daily.sessions + excluded.sessions, updated_at = now()
	`;
}

// One statement per (session, tool) group: bump the session's own counters and
// fold the calls into that client's daily row. A call with no known session
// (the client never initialized here, or did not echo the id) lands on the
// "unknown" client for its surface and auth kind, so totals stay complete.
async function writeCallGroup({ sessionId, surface, tool, authKind, n }) {
	await sql`
		with sess as (
			update mcp_client_sessions
			set calls = calls + ${n}::int,
				tool_calls = mcp_tool_count_add(tool_calls, ${tool}::text, ${n}::int),
				last_seen_at = now()
			where session_id = ${sessionId}::text
			returning surface, client, client_name, client_version, auth_kind
		), who as (
			select surface, client, client_name, client_version, auth_kind from sess
			union all
			select ${surface}::text, 'unknown', 'unknown', '', ${authKind}::text
			where not exists (select 1 from sess)
		)
		insert into mcp_client_daily (day, surface, client, client_name, client_version, auth_kind, calls, tools)
		select current_date, surface, client, client_name, client_version, auth_kind, ${n}::int,
			mcp_tool_count_add('{}'::jsonb, ${tool}::text, ${n}::int)
		from who
		on conflict (day, surface, client_name, client_version, auth_kind)
		do update set calls = mcp_client_daily.calls + excluded.calls,
			tools = mcp_tool_count_add(mcp_client_daily.tools, ${tool}::text, ${n}::int),
			updated_at = now()
	`;
}

function groupCalls(calls) {
	const groups = new Map();
	for (const c of calls) {
		const key = `${c.sessionId}|${c.surface}|${c.tool}|${c.authKind}`;
		const g = groups.get(key);
		if (g) g.n += 1;
		else groups.set(key, { ...c, n: 1 });
	}
	return [...groups.values()];
}

/**
 * Write every queued event. Sessions go first so calls in the same batch find
 * the session they belong to. Errors are logged and swallowed: this is the
 * boundary where telemetry gives up rather than hurting a request.
 * @returns {Promise<{ sessions: number, callGroups: number, failed: number }>}
 */
export async function flushMcpClientEvents() {
	if (flushing) {
		await flushing;
		return flushMcpClientEvents();
	}
	const inits = queue.inits.splice(0);
	const calls = queue.calls.splice(0);
	if (!inits.length && !calls.length) return { sessions: 0, callGroups: 0, failed: 0 };
	flushing = (async () => {
		let failed = 0;
		try {
			await writeInits(inits);
		} catch (err) {
			failed += 1;
			console.warn('[mcp-clients] session write failed', err?.message);
		}
		const groups = groupCalls(calls);
		const results = await Promise.allSettled(groups.map(writeCallGroup));
		const rejected = results.filter((r) => r.status === 'rejected');
		if (rejected.length) {
			failed += rejected.length;
			console.warn(`[mcp-clients] ${rejected.length}/${groups.length} call writes failed`, rejected[0].reason?.message);
		}
		return { sessions: inits.length, callGroups: groups.length, failed };
	})();
	try {
		return await flushing;
	} finally {
		flushing = null;
	}
}

// Traffic records for the Microsoft surfaces that otherwise leave no trace: the
// Teams message extension (api/microsoft-teams/messages.js) and the Power
// Platform connector (integrations/microsoft/power-platform-connector/, which
// calls four ordinary three.ws endpoints). One row per activity or call lands in
// microsoft_surface_events; the internal dashboard (/admin/microsoft) and the
// alert cron (api/cron/microsoft-alerts.js) read it.
//
// Recording is fire-and-forget: a failed insert is logged once and never
// delays or breaks the request it describes. No message text, search text or
// prompt is stored, only the operation, status, latency and who called.

import { sql } from './db.js';
import { authenticateBearer, extractBearer } from './auth.js';
import { clientIp } from './rate-limit.js';

/** Header the connector's setheader policy adds to every call (apiProperties.template.json). */
export const CONNECTOR_HEADER = 'x-threews-client';
export const CONNECTOR_HEADER_VALUE = 'power-platform-connector';

// Power Automate and Logic Apps send this user agent on outbound calls. A call
// matched only by it is labelled source 'user_agent' so it stays distinguishable
// from a call the connector itself identified.
const LOGIC_APPS_UA = /\bazure-logic-apps\//i;

/** The connector's five actions, by method and path (apiDefinition.swagger.json). */
export const CONNECTOR_OPERATIONS = Object.freeze([
	{ method: 'POST', path: '/api/3d/studio', operation: 'GenerateModel' },
	{ method: 'GET', path: '/api/3d/studio', operation: 'GetGenerationJob' },
	{ method: 'GET', path: '/api/agents', operation: 'ListMyAgents' },
	{ method: 'GET', path: '/api/agents/public', operation: 'SearchAgents' },
	{ method: 'POST', path: '/api/agents/talk', operation: 'SendAgentMessage' },
]);

function pathOf(url) {
	const raw = String(url || '');
	const q = raw.indexOf('?');
	const path = q === -1 ? raw : raw.slice(0, q);
	return path.length > 1 ? path.replace(/\/+$/, '') : path;
}

/** The connector operation a request maps to, or null when it is not one of the five. */
export function connectorOperation(method, url) {
	const path = pathOf(url);
	const m = String(method || '').toUpperCase();
	return CONNECTOR_OPERATIONS.find((o) => o.method === m && o.path === path)?.operation || null;
}

function header(req, name) {
	const v = req?.headers?.[name];
	return Array.isArray(v) ? v[0] : v;
}

function connectorClientId() {
	const id = (process.env.PP_OAUTH_CLIENT_ID || '').trim();
	return id || null;
}

/**
 * How a request identifies as connector traffic, before auth is resolved:
 * 'header' (the connector's own policy header) or 'user_agent' (Logic Apps
 * runtime). null when neither applies; the OAuth client check runs after.
 */
export function connectorSourceOf(req) {
	if (String(header(req, CONNECTOR_HEADER) || '').trim().toLowerCase() === CONNECTOR_HEADER_VALUE) return 'header';
	if (LOGIC_APPS_UA.test(String(header(req, 'user-agent') || ''))) return 'user_agent';
	return null;
}

/** The tenant, conversation and operation of a Bot Framework activity. */
export function teamsActivityFields(activity) {
	const a = activity && typeof activity === 'object' ? activity : {};
	const operation = a.type === 'invoke' && typeof a.name === 'string' && a.name ? a.name : String(a.type || 'unknown');
	const tenantId = a.channelData?.tenant?.id || a.conversation?.tenantId || null;
	const conversationId = a.conversation?.id || null;
	return {
		operation: operation.slice(0, 80),
		tenantId: tenantId ? String(tenantId).slice(0, 80) : null,
		conversationId: conversationId ? String(conversationId).slice(0, 200) : null,
	};
}

let warned = false;
async function insertEvent(e) {
	try {
		await sql`
			insert into microsoft_surface_events
				(surface, operation, status, latency_ms, tenant_id, conversation_id, user_id, client_id, source, error)
			values (${e.surface}, ${e.operation}, ${e.status}, ${e.latencyMs ?? null}, ${e.tenantId ?? null},
			        ${e.conversationId ?? null}, ${e.userId ?? null}, ${e.clientId ?? null}, ${e.source ?? null},
			        ${e.error ? String(e.error).slice(0, 300) : null})
		`;
	} catch (err) {
		if (!warned) {
			warned = true;
			console.warn(`[microsoft-surface-events] insert failed: ${err?.message || err}`);
		}
	}
}

/**
 * Record one Teams bot activity. Never throws. An activity whose token did not
 * verify keeps only its operation: its tenant and conversation are unproven.
 */
export function recordTeamsActivity(activity, { status, latencyMs, error = null, verified = true }) {
	const f = teamsActivityFields(activity);
	const who = verified ? { tenantId: f.tenantId, conversationId: f.conversationId } : {};
	return insertEvent({ surface: 'teams_bot', operation: f.operation, ...who, status, latencyMs, error });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function connectorPrincipal(req) {
	const token = extractBearer(req);
	if (!token) return null;
	try {
		return await authenticateBearer(token, { ip: clientIp(req) });
	} catch {
		return null;
	}
}

/**
 * Attach to a connector endpoint at the top of its handler. When the request
 * is connector traffic (policy header, Logic Apps user agent, or an OAuth token
 * issued to the connector's client), one row is written once the response
 * finishes, with the final status, even when wrap() wrote a 5xx.
 */
export function trackConnectorCall(req, res) {
	const operation = connectorOperation(req?.method, req?.url);
	if (!operation || typeof res?.once !== 'function') return;
	const pre = connectorSourceOf(req);
	const ppClient = connectorClientId();
	const bearer = extractBearer(req);
	// Without a policy header or user agent, only a JWT (not an sk_ key) can
	// carry the connector's OAuth client id, and only if that client is known.
	if (!pre && !(ppClient && bearer && !bearer.startsWith('sk_'))) return;
	const started = Date.now();
	res.once('finish', () => {
		const status = res.statusCode || 0;
		const latencyMs = Date.now() - started;
		connectorPrincipal(req)
			.then((principal) => {
				const clientId = principal?.clientId || null;
				const source = pre || (ppClient && clientId === ppClient ? 'oauth_client' : null);
				if (!source) return;
				const userId = principal?.userId && UUID.test(principal.userId) ? principal.userId : null;
				return insertEvent({ surface: 'power_platform', operation, status, latencyMs, userId, clientId, source });
			})
			.catch(() => {});
	});
}

// Route table for /api/revenue/*, in the v1 API contract (api/_lib/agents-v1/http.js).
// Mounted by api/revenue/[...route].js. Guide: docs/revenue-ledger.md.
//
// Public:
//   GET  /public/:agentId          the agent's earnings, only when its owner switched the page on
//
// Owner (session, API key or OAuth token):
//   GET  /ledger                   totals by source and period, projection, unclaimed memo, chain checks
//   GET  /entries                  ledger rows, each with its transaction
//   GET  /export                   the same rows as CSV (default) or JSON
//   GET  /reconcile                the latest reconcile run
//   POST /sync                     bring the ledger up to date now
//   GET/PUT /agents/:id/settings   the public-earnings toggle
//   GET/POST /rules, PATCH/DELETE /rules/:id, GET /rules/:id/preview, POST /rules/:id/pause
//   POST /rules/:id/test-run       plan + paper-trade a run; nothing real moves
//   GET  /runs                     per-run receipts with every leg
//
// Owner, browser session only (an agent's key can never turn a rule on):
//   POST /rules/:id/confirm        the explicit yes to the exact terms (hash)

import { apiError, requireUuid, strParam, intParam } from './agents-v1/http.js';
import { limits } from './rate-limit.js';
import { sql } from './db.js';
import {
	listEntries, ledgerView, exportCsv, syncLedger, getSettings, setPublic, publicView, SOURCE_KEYS,
} from './revenue-ledger.js';
import { latestReconcile } from './revenue-reconcile.js';
import {
	listRules, createRule, updateRule, deleteRule, confirmRule, pauseRule, rulePreview, getRule, runRule, listRuns, ruleView,
} from './revenue-reinvest.js';
import { CSV_COLUMNS, RULE_PERIODS, LEG_LABELS, SOURCES } from './revenue-ledger-core.js';

const PERIODS = ['day', 'week', 'month'];

function sessionOnly(principal) {
	if (principal?.source !== 'session') {
		throw apiError(403, 'session_required', 'Only the owner, signed in on three.ws, can do this. API keys and agent tokens cannot.');
	}
}

async function ownedAgentId(value, userId) {
	const id = strParam(value, { name: 'agent_id', max: 40 });
	if (!id) return null;
	requireUuid(id, 'agent');
	const [a] = await sql`select id from agent_identities where id = ${id} and user_id = ${userId} and deleted_at is null`;
	if (!a) throw apiError(404, 'not_found', 'No agent with that id.');
	return id;
}

function dateParam(v, name) {
	if (v === undefined || v === null || v === '') return null;
	const d = new Date(v);
	if (Number.isNaN(d.getTime())) throw apiError(400, 'invalid_parameter', `${name} must be a date.`, { parameter: name });
	return d.toISOString();
}

function scope(q, userId) {
	const period = PERIODS.includes(q.period) ? q.period : 'month';
	return {
		period, from: dateParam(q.from, 'from'), to: dateParam(q.to, 'to'),
		source: q.source && SOURCE_KEYS.includes(q.source) ? q.source : null,
		windowDays: intParam(q.window_days, { name: 'window_days', min: 7, max: 365, fallback: 30 }),
	};
}

async function ledgerRoute({ principal, query }) {
	const agentId = await ownedAgentId(query.agent_id, principal.userId);
	const s = scope(query);
	const view = await ledgerView({ userId: principal.userId, agentId, period: s.period, from: s.from, to: s.to, windowDays: s.windowDays });
	const reconcile = await latestReconcile();
	return { ...view, reconcile, agent_id: agentId };
}

async function entriesRoute({ principal, query }) {
	const agentId = await ownedAgentId(query.agent_id, principal.userId);
	const s = scope(query);
	const limit = intParam(query.limit, { name: 'limit', min: 1, max: 1000, fallback: 200 });
	const rows = await listEntries({ userId: principal.userId, agentId, source: s.source, from: s.from, to: s.to, limit, before: dateParam(query.before, 'before') });
	return { entries: rows, next_before: rows.length === limit ? rows[rows.length - 1].occurred_at : null };
}

async function exportRoute({ principal, query, res }) {
	const agentId = await ownedAgentId(query.agent_id, principal.userId);
	const s = scope(query);
	const args = { userId: principal.userId, agentId, source: s.source, from: s.from, to: s.to };
	const stamp = new Date().toISOString().slice(0, 10);
	if (query.format === 'json') {
		const entries = await listEntries({ ...args, limit: 50000 });
		return { columns: CSV_COLUMNS, entries };
	}
	const csv = await exportCsv(args);
	res.statusCode = 200;
	res.setHeader('content-type', 'text/csv; charset=utf-8');
	res.setHeader('content-disposition', `attachment; filename="three-ws-revenue-${stamp}.csv"`);
	res.setHeader('cache-control', 'no-store');
	res.end(csv);
	return null;
}

async function reconcileRoute() {
	return { latest: await latestReconcile() };
}

async function syncRoute({ principal, body }) {
	const agentId = await ownedAgentId(body.agent_id, principal.userId);
	return syncLedger({ userId: principal.userId, agentId });
}

async function getSettingsRoute({ principal, params }) {
	const agentId = await ownedAgentId(params.id, principal.userId);
	return getSettings(agentId);
}

async function putSettingsRoute({ principal, params, body }) {
	const agentId = await ownedAgentId(params.id, principal.userId);
	if (typeof body.public_earnings !== 'boolean') throw apiError(400, 'invalid_parameter', 'public_earnings must be true or false.', { parameter: 'public_earnings' });
	return setPublic({ agentId, userId: principal.userId, isPublic: body.public_earnings });
}

async function publicRoute({ params, query, ip }) {
	const rl = await limits.commercePublic(ip);
	if (!rl.success) throw apiError(429, 'rate_limited', 'Too many requests. Slow down and retry.');
	requireUuid(params.agentId, 'agent');
	const view = await publicView({ agentId: params.agentId, period: PERIODS.includes(query.period) ? query.period : 'month' });
	if (!view) throw apiError(404, 'not_public', 'This agent has not made its earnings public.');
	return view;
}

async function listRulesRoute({ principal, query }) {
	const agentId = await ownedAgentId(query.agent_id, principal.userId);
	return { rules: await listRules({ userId: principal.userId, agentId }), leg_kinds: LEG_LABELS, periods: RULE_PERIODS };
}

async function createRuleRoute({ principal, body }) {
	const agentId = await ownedAgentId(body.agent_id, principal.userId);
	if (!agentId) throw apiError(400, 'missing_parameter', 'agent_id is required.', { parameter: 'agent_id' });
	return { rule: await createRule({ userId: principal.userId, agentId, body }) };
}

async function patchRuleRoute({ principal, params, body }) {
	return { rule: await updateRule({ ruleId: requireUuid(params.id, 'rule'), userId: principal.userId, body }) };
}

async function deleteRuleRoute({ principal, params }) {
	await deleteRule({ ruleId: requireUuid(params.id, 'rule'), userId: principal.userId });
	return { deleted: true };
}

async function previewRoute({ principal, params }) {
	return rulePreview({ ruleId: requireUuid(params.id, 'rule'), userId: principal.userId });
}

async function confirmRoute({ principal, params, body }) {
	sessionOnly(principal);
	return { rule: await confirmRule({ ruleId: requireUuid(params.id, 'rule'), userId: principal.userId, hash: body.hash }) };
}

async function pauseRoute({ principal, params }) {
	return { rule: await pauseRule({ ruleId: requireUuid(params.id, 'rule'), userId: principal.userId }) };
}

async function testRunRoute({ principal, params }) {
	const rule = await getRule(requireUuid(params.id, 'rule'), principal.userId);
	const out = await runRule({ rule, preview: true });
	return { rule: ruleView(rule), ...out, note: 'Preview only: transfers are planned, buys are paper trades, and nothing was sent.' };
}

async function runsRoute({ principal, query }) {
	const agentId = await ownedAgentId(query.agent_id, principal.userId);
	const ruleId = query.rule_id ? requireUuid(query.rule_id, 'rule') : null;
	return { runs: await listRuns({ userId: principal.userId, agentId, ruleId, limit: intParam(query.limit, { name: 'limit', min: 1, max: 100, fallback: 30 }) }) };
}

async function sourcesRoute() {
	return { sources: SOURCES.map(({ key, label, kind, how }) => ({ key, label, kind, how })) };
}

export const revenueRoutes = [
	{ method: 'GET', path: '/public/:agentId', name: 'revenue.public', auth: 'public', handler: publicRoute },
	{ method: 'GET', path: '/sources', name: 'revenue.sources', auth: 'public', handler: sourcesRoute },
	{ method: 'GET', path: '/ledger', name: 'revenue.ledger', auth: 'required', scope: 'wallet:read', handler: ledgerRoute },
	{ method: 'GET', path: '/entries', name: 'revenue.entries', auth: 'required', scope: 'wallet:read', handler: entriesRoute },
	{ method: 'GET', path: '/export', name: 'revenue.export', auth: 'required', scope: 'wallet:read', handler: exportRoute },
	{ method: 'GET', path: '/reconcile', name: 'revenue.reconcile', auth: 'required', scope: 'wallet:read', handler: reconcileRoute },
	{ method: 'POST', path: '/sync', name: 'revenue.sync', auth: 'required', scope: 'wallet:read', handler: syncRoute },
	{ method: 'GET', path: '/agents/:id/settings', name: 'revenue.settings.get', auth: 'required', scope: 'wallet:read', handler: getSettingsRoute },
	{ method: 'PUT', path: '/agents/:id/settings', name: 'revenue.settings.put', auth: 'required', scope: 'agents:write', handler: putSettingsRoute },
	{ method: 'GET', path: '/rules', name: 'revenue.rules.list', auth: 'required', scope: 'wallet:read', handler: listRulesRoute },
	{ method: 'POST', path: '/rules', name: 'revenue.rules.create', auth: 'required', scope: 'agents:write', handler: createRuleRoute },
	{ method: 'PATCH', path: '/rules/:id', name: 'revenue.rules.update', auth: 'required', scope: 'agents:write', handler: patchRuleRoute },
	{ method: 'DELETE', path: '/rules/:id', name: 'revenue.rules.delete', auth: 'required', scope: 'agents:write', handler: deleteRuleRoute },
	{ method: 'GET', path: '/rules/:id/preview', name: 'revenue.rules.preview', auth: 'required', scope: 'wallet:read', handler: previewRoute },
	{ method: 'POST', path: '/rules/:id/confirm', name: 'revenue.rules.confirm', auth: 'required', handler: confirmRoute },
	{ method: 'POST', path: '/rules/:id/pause', name: 'revenue.rules.pause', auth: 'required', scope: 'agents:write', handler: pauseRoute },
	{ method: 'POST', path: '/rules/:id/test-run', name: 'revenue.rules.test', auth: 'required', scope: 'agents:write', handler: testRunRoute },
	{ method: 'GET', path: '/runs', name: 'revenue.runs', auth: 'required', scope: 'wallet:read', handler: runsRoute },
];

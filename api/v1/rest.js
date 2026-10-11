// The v1 agents REST API: one router for agents, runs, automations, skills,
// strategies, webhooks and the caller's account.
//
// Every row is a defineRouter route (api/_lib/agents-v1/http.js), so all of
// them share one bearer key (`Authorization: Bearer sk_live_…`, an OAuth token,
// or a signed-in session), per-route scopes, the `{ data, meta }` envelope, the
// error table, rate limits, metering and Idempotency-Key replay on writes.
// vercel.json rewrites /api/v1/{agents,runs,automations,webhooks,skills,
// strategies,me} here; UUID agent ids only, so the CAIP-10 resolver at
// api/v1/agents/[...caip].js and /api/v1/agents/{signup,claim} keep their paths.
//
//   Agents        GET/POST /agents · GET/PATCH/DELETE /agents/:id
//                 POST /agents/:id/{start,stop} · GET /agents/:id/export · POST /agents/import
//   Chat          POST/GET /agents/:id/messages
//   Runs          POST/GET /agents/:id/runs · GET/PATCH /runs/:id · POST /runs/:id/cancel
//                 GET /runs/:id/steps · GET /runs/:id/events (SSE)
//   Automations   POST/GET /automations · GET /agents/:id/automations
//                 GET/PATCH/DELETE /automations/:id · POST /automations/:id/trigger
//   Skills        GET /skills · /skills/community[/:slug] · /agents/:id/skills/custom/*
//   Strategies    GET /strategies · GET /strategies/:id
//   Webhooks      GET /webhooks/events · GET/POST /webhooks · GET/PATCH/DELETE /webhooks/:id
//                 POST /webhooks/:id/{rotate-secret,test} · GET /webhooks/:id/deliveries
//                 GET /webhooks/deliveries/:id · POST /webhooks/deliveries/:id/replay
//   Account       GET /me
//
// The models list stays at GET /api/v1/models (api/v1/models.js). Wallet and
// swap routes move funds and are not mounted here. The vercel.json rewrite
// sends only the agent sub-resources listed above to this file, so
// /agents/:id/{loop,predictions,perps,cards,mail} keep their own handlers.
// Reference: docs/api-reference.md "Agents API (v1)".

import { hasScope } from '../_lib/auth.js';
import { apiError, created, defineRouter, intParam, numParam, page, requireUuid, strParam } from '../_lib/agents-v1/http.js';
import { createAgent, deleteAgent, listAgents, loadOwnedAgent, serializeAgent, updateAgent } from '../_lib/agents-v1/agents.js';
import { getMessages, resolveModel, sendMessage } from '../_lib/agents-v1/messages.js';
import { cancelRun, createRun, getOwnedRun, listAgentRuns, listRunSteps, serializeRun, updateRun } from '../_lib/agents-v1/runs.js';
import { streamRunEvents } from '../_lib/agents-v1/run-stream.js';
import {
	createAutomation,
	deleteAutomation,
	getAutomation,
	listAgentAutomations,
	listUserAutomations,
	triggerAutomation,
	updateAutomation,
	validateCron,
} from '../_lib/agents-v1/automations.js';
import { exportAgent, importAgent } from '../_lib/agents-v1/agent-export.js';
import {
	createWebhook,
	deleteWebhook,
	eventCatalog,
	getDelivery,
	getWebhook,
	listDeliveries,
	listWebhooks,
	replayWebhookDelivery,
	rotateWebhookSecret,
	testWebhook,
	updateWebhook,
} from '../_lib/agents-v1/webhooks.js';
import { getStrategy, listStrategies } from '../_lib/agents-v1/strategies.js';
import { freeTierStatus } from '../_lib/agents-v1/billing.js';
import { ROUTES as SKILL_ROUTES } from '../_lib/agents-v1/routes/skills.js';
import { lifecycleRoutes } from '../_lib/strategy-loop/routes.js';

const SPEND_ACTIONS = new Set(['swap', 'transfer']);

// ── helpers ──────────────────────────────────────────────────────────────────

function ownedAgent(params, principal) {
	return loadOwnedAgent(requireUuid(params.id, 'agent'), principal.userId);
}

/** A key or OAuth caller needs wallet:write to touch an automation that spends. */
function requireSpendScope(principal, actionType) {
	if (!SPEND_ACTIONS.has(actionType)) return;
	if (principal.source === 'session' || hasScope(principal.scope, 'wallet:write')) return;
	throw apiError(403, 'insufficient_scope', `A ${actionType} automation moves funds, so this key needs the "wallet:write" scope (granted by "spend").`, {
		required: 'wallet:write',
	});
}

function canSpend(principal) {
	return principal.source === 'session' || hasScope(principal.scope, 'wallet:write');
}

function limitParam(query, fallback = 25) {
	return intParam(query.limit, { name: 'limit', min: 1, max: 100, fallback });
}

/** Page an in-memory list newest first by id cursor (automation lists merge three sources). */
function pageList(items, query) {
	const limit = limitParam(query);
	let start = 0;
	if (query.cursor) {
		const i = items.findIndex((x) => x.id === query.cursor);
		if (i < 0) throw apiError(400, 'invalid_cursor', 'cursor must be a value returned in meta.nextCursor.', { parameter: 'cursor' });
		start = i + 1;
	}
	const slice = items.slice(start, start + limit);
	const hasMore = start + limit < items.length;
	return page(slice, { hasMore, nextCursor: hasMore ? slice.at(-1).id : null });
}

function toolsParam(v) {
	if (v == null) return null;
	if (!Array.isArray(v) || v.length > 50 || v.some((t) => typeof t !== 'string' || !t || t.length > 64)) {
		throw apiError(400, 'invalid_parameter', 'toolsAllowed must be an array of tool names.', { parameter: 'toolsAllowed' });
	}
	return [...new Set(v)];
}

function isoParam(v, name) {
	if (v == null || v === '') return null;
	const d = new Date(v);
	if (typeof v !== 'string' || Number.isNaN(d.getTime())) {
		throw apiError(400, 'invalid_parameter', `${name} must be an ISO 8601 time.`, { parameter: name });
	}
	return d.toISOString();
}

// ── handlers ─────────────────────────────────────────────────────────────────

async function createRunRoute({ params, principal, body }) {
	const agent = await ownedAgent(params, principal);
	const goal = strParam(body.goal, { name: 'goal', max: 8000, required: true });
	const maxSteps = intParam(body.maxSteps, { name: 'maxSteps', min: 1, max: 60, fallback: 12 });
	const budgetCreditsUsd = numParam(body.budgetCreditsUsd, { name: 'budgetCreditsUsd', max: 1000, fallback: 0 });
	const budgetUsd = numParam(body.budgetUsd, { name: 'budgetUsd', max: 100000, fallback: 0 });
	if (budgetUsd > 0 && !canSpend(principal)) {
		throw apiError(403, 'insufficient_scope', 'A run with an on-chain budget (budgetUsd) needs the "wallet:write" scope.', { required: 'wallet:write' });
	}
	const model = strParam(body.model, { name: 'model', max: 120 });
	// Runs resolve leniently at step time; a bad id is refused here instead.
	if (model) resolveModel(agent, model);
	const temperature = numParam(body.temperature, { name: 'temperature', min: 0, max: 2 });
	const toolsAllowed = toolsParam(body.toolsAllowed);

	// A repeating run is a schedule automation whose action starts the run, so
	// it shows up in the automation list, honors start/stop, and can be edited
	// or deleted like any other.
	if (body.schedule != null) {
		const cron = validateCron(body.schedule);
		const automation = await createAutomation({
			agent,
			userId: principal.userId,
			body: {
				title: `Run on ${cron}: ${goal.slice(0, 60)}`,
				trigger: { type: 'schedule', cron },
				action: { type: 'agent_prompt', prompt: goal, maxSteps, budgetCreditsUsd },
			},
			source: 'run_schedule',
		});
		return created({ scheduled: true, schedule: cron, automation });
	}

	const scheduledFor = isoParam(body.scheduledFor, 'scheduledFor');
	const run = await createRun({
		agentId: agent.id,
		userId: principal.userId,
		goal,
		model,
		temperature,
		toolsAllowed,
		maxSteps,
		budgetCreditsUsd,
		budgetUsd,
		scheduledFor,
		source: 'api',
	});
	return created(serializeRun(run));
}

async function createAutomationRoute({ principal, body }) {
	const agentId = strParam(body.agentId, { name: 'agentId', max: 64, required: true });
	const agent = await loadOwnedAgent(requireUuid(agentId, 'agent'), principal.userId);
	requireSpendScope(principal, body.action?.type);
	return created(await createAutomation({ agent, userId: principal.userId, body, source: 'api' }));
}

async function updateAutomationRoute({ params, principal, body }) {
	const id = requireUuid(params.id, 'automation');
	const current = await getAutomation(principal.userId, id);
	requireSpendScope(principal, current.action?.type);
	requireSpendScope(principal, body.action?.type);
	return updateAutomation({ userId: principal.userId, id, body });
}

async function triggerAutomationRoute({ params, principal, body }) {
	const id = requireUuid(params.id, 'automation');
	const current = await getAutomation(principal.userId, id);
	requireSpendScope(principal, current.action?.type);
	return triggerAutomation({ userId: principal.userId, id, confirm: body.confirm === true });
}

async function meRoute({ principal }) {
	return {
		userId: principal.userId,
		auth: {
			source: principal.source,
			scopes: principal.source === 'session' ? ['all'] : String(principal.scope || '').split(/\s+/).filter(Boolean),
			apiKeyId: principal.apiKeyId || null,
			clientId: principal.clientId || null,
		},
		freeTier: await freeTierStatus(principal.userId),
	};
}

// ── route table ──────────────────────────────────────────────────────────────

const R = (method, path, name, scope, handler, extra = {}) => ({ method, path, name, auth: 'required', scope, handler, ...extra });

const agentRoutes = [
	R('GET', '/agents', 'agents.list', 'agents:read', async ({ principal, query }) => {
		const out = await listAgents(principal.userId, {
			limit: limitParam(query),
			cursor: query.cursor ? requireUuid(query.cursor, 'cursor') : null,
		});
		return page(out.items, out);
	}),
	R('POST', '/agents', 'agents.create', 'agents:write', async ({ principal, body }) => created(await createAgent(principal.userId, body))),
	R('POST', '/agents/import', 'agents.import', 'agents:write', async ({ principal, body }) =>
		created(await importAgent(principal.userId, body, { canSpend: canSpend(principal) })),
	),
	R('GET', '/agents/:id', 'agents.get', 'agents:read', async ({ params, principal }) => serializeAgent(await ownedAgent(params, principal))),
	R('PATCH', '/agents/:id', 'agents.update', 'agents:write', async ({ params, principal, body }) =>
		updateAgent(await ownedAgent(params, principal), body),
	),
	R('DELETE', '/agents/:id', 'agents.delete', 'agents:write', async ({ params, principal }) => deleteAgent(await ownedAgent(params, principal))),
	R('GET', '/agents/:id/export', 'agents.export', 'agents:read', async ({ params, principal, res }) => {
		const agent = await ownedAgent(params, principal);
		const document = await exportAgent(agent);
		res.setHeader('content-disposition', `inline; filename="agent-${agent.id}.json"`);
		return document;
	}),
	...lifecycleRoutes,
];

const messageRoutes = [
	R('POST', '/agents/:id/messages', 'agents.messages.send', 'agents:write', async ({ params, principal, body }) =>
		sendMessage(await ownedAgent(params, principal), principal.userId, body),
	),
	R('GET', '/agents/:id/messages', 'agents.messages.list', 'agents:read', async ({ params, principal, query }) =>
		getMessages(await ownedAgent(params, principal), principal.userId, query),
	),
];

const runRoutes = [
	R('POST', '/agents/:id/runs', 'runs.create', 'agents:write', createRunRoute),
	R('GET', '/agents/:id/runs', 'runs.list', 'agents:read', async ({ params, principal, query }) => {
		const agent = await ownedAgent(params, principal);
		const out = await listAgentRuns(agent.id, {
			limit: limitParam(query),
			cursor: query.cursor ? requireUuid(query.cursor, 'cursor') : null,
			status: strParam(query.status, { name: 'status', max: 20 }),
		});
		return page(out.items, out);
	}),
	R('GET', '/runs/:id', 'runs.get', 'agents:read', async ({ params, principal }) =>
		serializeRun(await getOwnedRun(requireUuid(params.id, 'run'), principal.userId)),
	),
	R('PATCH', '/runs/:id', 'runs.update', 'agents:write', async ({ params, principal, body }) => {
		const action = strParam(body.action, { name: 'action', max: 10 });
		const budgetUsd = numParam(body.budgetUsd, { name: 'budgetUsd', max: 100000 });
		if (budgetUsd != null && !canSpend(principal)) {
			throw apiError(403, 'insufficient_scope', 'Raising an on-chain budget (budgetUsd) needs the "wallet:write" scope.', { required: 'wallet:write' });
		}
		const run = await updateRun(requireUuid(params.id, 'run'), principal.userId, {
			action,
			budgetCreditsUsd: numParam(body.budgetCreditsUsd, { name: 'budgetCreditsUsd', max: 1000 }),
			budgetUsd,
			maxSteps: intParam(body.maxSteps, { name: 'maxSteps', min: 1, max: 60, fallback: null }),
		});
		return serializeRun(run);
	}),
	R('POST', '/runs/:id/cancel', 'runs.cancel', 'agents:write', async ({ params, principal }) =>
		serializeRun(await cancelRun(requireUuid(params.id, 'run'), principal.userId)),
	),
	R('GET', '/runs/:id/steps', 'runs.steps', 'agents:read', async ({ params, principal, query }) => {
		const limit = intParam(query.limit, { name: 'limit', min: 1, max: 500, fallback: 200 });
		const after = intParam(query.cursor ?? query.after, { name: 'cursor', min: 0, max: Number.MAX_SAFE_INTEGER, fallback: 0 });
		const steps = await listRunSteps(requireUuid(params.id, 'run'), principal.userId, { after, limit: limit + 1 });
		const hasMore = steps.length > limit;
		const items = steps.slice(0, limit);
		return page(items, { hasMore, nextCursor: hasMore ? String(items.at(-1).seq) : null });
	}),
	R('GET', '/runs/:id/events', 'runs.events', 'agents:read', (ctx) => {
		requireUuid(ctx.params.id, 'run');
		return streamRunEvents(ctx);
	}),
];

const automationRoutes = [
	R('POST', '/automations', 'automations.create', 'agents:write', createAutomationRoute),
	R('GET', '/automations', 'automations.list', 'agents:read', async ({ principal, query }) =>
		pageList(await listUserAutomations(principal.userId), query),
	),
	R('GET', '/agents/:id/automations', 'agents.automations.list', 'agents:read', async ({ params, principal, query }) => {
		const agent = await ownedAgent(params, principal);
		return pageList(await listAgentAutomations(agent.id), query);
	}),
	R('GET', '/automations/:id', 'automations.get', 'agents:read', async ({ params, principal }) =>
		getAutomation(principal.userId, requireUuid(params.id, 'automation')),
	),
	R('PATCH', '/automations/:id', 'automations.update', 'agents:write', updateAutomationRoute),
	R('DELETE', '/automations/:id', 'automations.delete', 'agents:write', async ({ params, principal }) =>
		deleteAutomation(principal.userId, requireUuid(params.id, 'automation')),
	),
	R('POST', '/automations/:id/trigger', 'automations.trigger', 'agents:write', triggerAutomationRoute),
];

const strategyRoutes = [
	{ method: 'GET', path: '/strategies', name: 'strategies.list', auth: 'public', handler: () => listStrategies() },
	{
		method: 'GET', path: '/strategies/:id', name: 'strategies.get', auth: 'public',
		handler: ({ params }) => {
			const s = getStrategy(params.id);
			if (!s) throw apiError(404, 'not_found', 'No strategy with that id. GET /api/v1/strategies lists them.');
			return s;
		},
	},
];

const webhookRoutes = [
	{ method: 'GET', path: '/webhooks/events', name: 'webhooks.events', auth: 'public', handler: () => eventCatalog() },
	R('GET', '/webhooks', 'webhooks.list', 'agents:read', ({ principal, query }) => listWebhooks(principal.userId, query)),
	R('POST', '/webhooks', 'webhooks.create', 'agents:write', async ({ principal, body }) => created(await createWebhook(principal.userId, body))),
	R('GET', '/webhooks/deliveries/:id', 'webhooks.deliveries.get', 'agents:read', ({ params, principal }) => getDelivery(principal.userId, params.id)),
	R('POST', '/webhooks/deliveries/:id/replay', 'webhooks.deliveries.replay', 'agents:write', async ({ params, principal }) =>
		created(await replayWebhookDelivery(principal.userId, params.id)),
	),
	R('GET', '/webhooks/:id', 'webhooks.get', 'agents:read', ({ params, principal }) => getWebhook(principal.userId, params.id)),
	R('PATCH', '/webhooks/:id', 'webhooks.update', 'agents:write', ({ params, principal, body }) => updateWebhook(principal.userId, params.id, body)),
	R('DELETE', '/webhooks/:id', 'webhooks.delete', 'agents:write', ({ params, principal }) => deleteWebhook(principal.userId, params.id)),
	R('POST', '/webhooks/:id/rotate-secret', 'webhooks.rotate', 'agents:write', ({ params, principal }) => rotateWebhookSecret(principal.userId, params.id)),
	R('POST', '/webhooks/:id/test', 'webhooks.test', 'agents:write', async ({ params, principal }) => created(await testWebhook(principal.userId, params.id))),
	R('GET', '/webhooks/:id/deliveries', 'webhooks.deliveries.list', 'agents:read', ({ params, principal, query }) =>
		listDeliveries(principal.userId, params.id, query),
	),
];

export const ROUTES = [
	...agentRoutes,
	...messageRoutes,
	...runRoutes,
	...automationRoutes,
	...SKILL_ROUTES,
	...strategyRoutes,
	...webhookRoutes,
	R('GET', '/me', 'me.get', null, meRoute),
];

export default defineRouter({ base: '/api/v1', routes: ROUTES });

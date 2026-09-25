// /api/v1/agents/:id/loop routes and the agent start/stop lifecycle the loop
// honors. Declared as defineRouter rows (api/_lib/agents-v1/http.js), so they
// share the v1 envelope, auth, scopes, CSRF, rate limits and Idempotency-Key
// replay. Guide: docs/agent-runtime.md "The strategy loop".
//
//   GET    /agents/:id/loop                 status: state, settings, lease, today, timeline
//   PATCH  /agents/:id/loop                 turn on/off, goal, interval, tools, caps, financial tier
//   POST   /agents/:id/loop/run             schedule the next tick now
//   GET    /agents/:id/loop/ticks           tick history, newest first (cursor = nextCursor)
//   GET    /agents/:id/loop/ticks/:tickId   one tick with every step
//   POST   /agents/:id/start                lifecycle: running (the loop ticks again)
//   POST   /agents/:id/stop                 lifecycle: stopped (an open tick cancels before its next step)

import { sql } from '../db.js';
import { apiError, intParam, page, requireUuid } from '../agents-v1/http.js';
import { loadOwnedAgent, setAgentStatus } from '../agents-v1/agents.js';
import { LoopSettingsError, parseLoopPatch, saveLoopSettings } from './settings.js';
import { loopStatus, listTicks, getTick } from './status.js';

async function owned(params, principal) {
	return loadOwnedAgent(requireUuid(params.id, 'agent'), principal.userId);
}

function parsePatch(body) {
	try {
		return parseLoopPatch(body);
	} catch (err) {
		if (err instanceof LoopSettingsError) throw apiError(err.status, err.code, err.message, err.details);
		throw err;
	}
}

async function requireAgreement(userId) {
	const { currentSignatureFor, agreementRequirement } = await import('../real-funds-agreement.js');
	if (await currentSignatureFor(userId)) return;
	throw apiError(
		403,
		'risk_ack_required',
		'Sign the real-funds agreements before letting the loop trade from the agent wallet.',
		agreementRequirement(),
	);
}

async function patchLoop({ params, principal, body }) {
	const agent = await owned(params, principal);
	const patch = parsePatch(body);
	if (!Object.keys(patch).length) {
		throw apiError(400, 'empty_patch', 'Send at least one of enabled, goal, intervalSeconds, tools, maxSteps, caps or financialEnabled.');
	}
	if (patch.financialEnabled === true) await requireAgreement(principal.userId);
	await saveLoopSettings(agent, patch);
	return loopStatus(agent);
}

async function runNow({ params, principal }) {
	const agent = await owned(params, principal);
	if (agent.status && agent.status !== 'running') {
		throw apiError(409, 'agent_stopped', 'This agent is stopped. Start it first with POST /api/v1/agents/:id/start.');
	}
	const [row] = await sql`SELECT enabled, paused_reason, paused_until FROM agent_loops WHERE agent_id = ${agent.id}`;
	if (!row?.enabled) {
		throw apiError(409, 'loop_off', 'The strategy loop is off for this agent. Turn it on with PATCH /api/v1/agents/:id/loop.');
	}
	if (row.paused_reason && (!row.paused_until || new Date(row.paused_until) > new Date())) {
		throw apiError(409, 'loop_paused', `The loop is paused (${row.paused_reason.replace(/_/g, ' ')}). Clear the cause first.`, {
			reason: row.paused_reason,
			until: row.paused_until,
		});
	}
	await sql`UPDATE agent_loops SET next_tick_at = now(), updated_at = now() WHERE agent_id = ${agent.id}`;
	return loopStatus(agent);
}

async function setStatus({ params, principal }, status) {
	const agent = await owned(params, principal);
	const out = await setAgentStatus(agent, status);
	return { ...out, loop: await loopStatus({ ...agent, status }) };
}

async function ticksPage({ params, principal, query }) {
	const agent = await owned(params, principal);
	const limit = intParam(query.limit, { name: 'limit', min: 1, max: 100, fallback: 25 });
	let before = null;
	if (query.cursor) {
		const d = new Date(query.cursor);
		if (Number.isNaN(d.getTime())) {
			throw apiError(400, 'invalid_parameter', 'cursor must be the nextCursor of a previous page.', { parameter: 'cursor' });
		}
		before = d.toISOString();
	}
	const out = await listTicks(agent.id, { limit, before });
	return page(out.items, { hasMore: out.hasMore, nextCursor: out.nextCursor });
}

async function oneTick({ params, principal }) {
	const agent = await owned(params, principal);
	const tick = await getTick(agent.id, requireUuid(params.tickId, 'tick'));
	if (!tick) throw apiError(404, 'not_found', 'No tick with that id on this agent.');
	return tick;
}

export const loopRoutes = [
	{
		method: 'GET', path: '/agents/:id/loop', name: 'agents.loop.get', auth: 'required', scope: 'agents:read',
		handler: async ({ params, principal }) => loopStatus(await owned(params, principal)),
	},
	{ method: 'PATCH', path: '/agents/:id/loop', name: 'agents.loop.update', auth: 'required', scope: 'agents:write', handler: patchLoop },
	{ method: 'POST', path: '/agents/:id/loop/run', name: 'agents.loop.run', auth: 'required', scope: 'agents:write', handler: runNow },
	{ method: 'GET', path: '/agents/:id/loop/ticks', name: 'agents.loop.ticks', auth: 'required', scope: 'agents:read', handler: ticksPage },
	{ method: 'GET', path: '/agents/:id/loop/ticks/:tickId', name: 'agents.loop.tick', auth: 'required', scope: 'agents:read', handler: oneTick },
];

export const lifecycleRoutes = [
	{
		method: 'POST', path: '/agents/:id/start', name: 'agents.start', auth: 'required', scope: 'agents:write',
		handler: (ctx) => setStatus(ctx, 'running'),
	},
	{
		method: 'POST', path: '/agents/:id/stop', name: 'agents.stop', auth: 'required', scope: 'agents:write',
		handler: (ctx) => setStatus(ctx, 'stopped'),
	},
];

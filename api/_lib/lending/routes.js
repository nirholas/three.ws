// Route table for agent lending, in the v1 API contract (api/_lib/agents-v1/http.js:
// one envelope, per-route auth and scopes, CSRF on cookie writes). Mounted at
// /api/v1/agents/:id/lending/* by api/v1/agents/[id]/lending/[...path].js.
//
// Market reads are public. Everything touching the agent is owner-only. Deposit
// and withdraw are one route each: without `confirm: true` they return a
// simulated preview and move nothing; with it they sign and send. Guide:
// docs/agent-lending.md.

import { apiError, requireUuid } from '../agents-v1/http.js';
import * as lending from './service.js';

async function run(fn) {
	try {
		return await fn();
	} catch (err) {
		const d = lending.describeError(err);
		if (d) throw apiError(d.status, d.code, d.message, d.detail);
		throw err;
	}
}

const agentOf = (params) => requireUuid(params.id, 'agent');
const sourceOf = (principal) => (principal.source === 'session' ? 'owner' : `api:${principal.source}`);
const venueOf = (v) => (v ? String(v) : undefined);

export const agentRoutes = [
	{
		method: 'GET', path: '/agents/:id/lending/markets', name: 'lending.markets', auth: 'public',
		handler: ({ query }) => run(() => lending.markets({ venueId: venueOf(query.venue) })),
	},
	{
		method: 'GET', path: '/agents/:id/lending/positions', name: 'lending.positions', auth: 'required', scope: 'wallet:read',
		handler: ({ params, principal, query }) => run(() => lending.positions({ agentId: agentOf(params), userId: principal.userId, venueId: venueOf(query.venue) })),
	},
	{
		method: 'POST', path: '/agents/:id/lending/deposit', name: 'lending.deposit', auth: 'required', scope: 'wallet:write',
		handler: ({ params, principal, body, req }) => run(() => lending.deposit({
			agentId: agentOf(params), userId: principal.userId, venueId: venueOf(body.venue), token: body.token, amount: body.amount,
			confirm: body.confirm === true, req, source: sourceOf(principal),
		})),
	},
	{
		method: 'POST', path: '/agents/:id/lending/withdraw', name: 'lending.withdraw', auth: 'required', scope: 'wallet:write',
		handler: ({ params, principal, body, req }) => run(() => lending.withdraw({
			agentId: agentOf(params), userId: principal.userId, venueId: venueOf(body.venue), token: body.token, amount: body.amount,
			all: body.all === true, confirm: body.confirm === true, req, source: sourceOf(principal),
		})),
	},
	{
		method: 'PUT', path: '/agents/:id/lending/earn-rule', name: 'lending.earn_rule', auth: 'required', scope: 'wallet:write',
		handler: ({ params, principal, body, req }) => {
			if (principal.source !== 'session') {
				throw apiError(403, 'owner_session_required', 'An earn rule lets the agent move idle funds into lending, so the owner must set it while signed in.');
			}
			return run(() => lending.setEarnRule({ agentId: agentOf(params), userId: principal.userId, rule: body, req }));
		},
	},
];

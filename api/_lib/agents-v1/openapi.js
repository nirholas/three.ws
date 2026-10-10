// OpenAPI paths for the v1 agents REST API (api/v1/rest.js).
//
// The operation list is read from the live route table, so a route added to
// rest.js shows up in /openapi.json with its method, path, auth and scope
// without anyone remembering to document it. This file adds what the table
// cannot know: a summary, the query parameters and the request body fields.
// A route with no entry in DOCS still appears, with a summary built from its
// name. Reference prose: docs/api-reference.md "Agents API (v1)".

import { ROUTES } from '../../v1/rest.js';

const TAG = {
	agents: 'Agents API',
	runs: 'Agents API',
	automations: 'Agents API',
	skills: 'Agents API',
	strategies: 'Agents API',
	webhooks: 'Agents API: webhooks',
	me: 'Agents API',
};

const cursor = { name: 'cursor', in: 'query', schema: { type: 'string' }, description: 'meta.nextCursor from the previous page.' };
const limit = (max = 100, dflt = 25) => ({
	name: 'limit',
	in: 'query',
	schema: { type: 'integer', minimum: 1, maximum: max, default: dflt },
	description: 'Page size.',
});
const str = (description, extra = {}) => ({ type: 'string', description, ...extra });

const AGENT_FIELDS = {
	name: str('Display name, up to 80 characters.'),
	persona: str('Short public description.'),
	systemPrompt: str('Instructions the agent follows on every turn.'),
	model: str('Model id from GET /api/v1/models.'),
	temperature: { type: 'number', minimum: 0, maximum: 2 },
	skills: { type: 'array', items: { type: 'string' }, description: 'Built-in skill ids from GET /api/v1/skills.' },
	strategy: str('Strategy preset id from GET /api/v1/strategies.'),
	inferenceBudget: {
		type: 'object',
		description: 'Credit ceilings in USD. Pass null to remove.',
		properties: { daily: { type: 'number' }, monthly: { type: 'number' } },
	},
};

const AUTOMATION_FIELDS = {
	title: str('Up to 80 characters; defaults to a description of the trigger and action.'),
	trigger: { type: 'object', description: 'One of: schedule (cron), price_threshold, balance_below, whale_buy and others listed in the guide.' },
	action: { type: 'object', description: 'One of: agent_prompt, notify, swap, transfer. swap and transfer spend funds: they need confirm: true and a key holding wallet:write.' },
	triggerOnce: { type: 'boolean' },
	limits: { type: 'object', description: 'Spend ceilings for swap and transfer actions.' },
	confirm: { type: 'boolean', description: 'Required for swap and transfer actions.' },
};

const WEBHOOK_FIELDS = {
	url: str('HTTPS endpoint that receives events.', { format: 'uri' }),
	events: { type: 'array', items: { type: 'string' }, description: 'Event types from GET /api/v1/webhooks/events. Empty means all.' },
	agentId: str('Limit the endpoint to one agent. Account events are then unavailable.', { format: 'uuid' }),
	description: str('Free text shown in the dashboard.'),
};

const body = (properties, required = []) => ({ properties, required });

// summary, query parameters and request body per route name.
const DOCS = {
	'agents.list': { summary: 'List agents', query: [cursor, limit()] },
	'agents.create': { summary: 'Create an agent', body: body(AGENT_FIELDS, ['name']) },
	'agents.import': { summary: 'Create an agent from an export document', body: body({ document: { type: 'object' }, name: str('Overrides the exported name.'), confirm: { type: 'boolean', description: 'Also create exported swap and transfer automations (needs wallet:write).' } }) },
	'agents.get': { summary: 'Get an agent' },
	'agents.update': { summary: 'Update an agent (partial)', body: body(AGENT_FIELDS) },
	'agents.delete': { summary: 'Delete an agent and its automations' },
	'agents.export': { summary: 'Export an agent as portable JSON (no wallet, keys, memory or history)' },
	'agents.start': { summary: 'Start an agent' },
	'agents.stop': { summary: 'Stop an agent' },
	'agents.messages.send': {
		summary: 'Send a message and wait for the reply',
		body: body({ message: str('The user message.'), model: str('Overrides the agent model for this call.'), temperature: { type: 'number' }, channel: str('Where the message came from.'), paid_fallback: { type: 'boolean' } }, ['message']),
	},
	'agents.messages.list': { summary: 'List message history, newest first', query: [limit(), { name: 'before', in: 'query', schema: { type: 'string' }, description: 'meta.nextCursor from the previous page.' }] },
	'runs.create': {
		summary: 'Start a run, or schedule a repeating one',
		body: body({
			goal: str('What the run should accomplish.'),
			maxSteps: { type: 'integer', minimum: 1, maximum: 60, default: 12 },
			budgetCreditsUsd: { type: 'number' },
			budgetUsd: { type: 'number', description: 'On-chain budget. Needs wallet:write.' },
			model: str('Model id.'),
			temperature: { type: 'number' },
			toolsAllowed: { type: 'array', items: { type: 'string' } },
			scheduledFor: str('ISO 8601 start time.', { format: 'date-time' }),
			schedule: str('Cron expression. Creates an automation that starts a run on that schedule.'),
		}, ['goal']),
	},
	'runs.list': { summary: 'List an agent\'s runs', query: [cursor, limit(), { name: 'status', in: 'query', schema: { type: 'string' } }] },
	'runs.get': { summary: 'Get a run' },
	'runs.update': { summary: 'Pause, resume or raise limits of a run', body: body({ action: str('pause or resume.', { enum: ['pause', 'resume'] }), budgetCreditsUsd: { type: 'number' }, budgetUsd: { type: 'number' }, maxSteps: { type: 'integer' } }) },
	'runs.cancel': { summary: 'Cancel a run' },
	'runs.steps': { summary: 'List a run\'s steps', query: [cursor, { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 500, default: 200 } }] },
	'runs.events': {
		summary: 'Stream a run as server-sent events',
		query: [
			{ name: 'after', in: 'query', schema: { type: 'integer' }, description: 'Resume after this step seq. The Last-Event-ID header does the same.' },
			{ name: 'drive', in: 'query', schema: { type: 'boolean', default: true }, description: 'Let the open stream step the run.' },
			{ name: 'maxSeconds', in: 'query', schema: { type: 'integer', minimum: 5, maximum: 300 } },
		],
		sse: true,
	},
	'automations.create': { summary: 'Create an automation', body: body({ agentId: str('Owning agent.', { format: 'uuid' }), ...AUTOMATION_FIELDS }, ['agentId', 'trigger', 'action']) },
	'automations.list': { summary: 'List automations across your agents', query: [cursor, limit()] },
	'agents.automations.list': { summary: 'List one agent\'s automations', query: [cursor, limit()] },
	'automations.get': { summary: 'Get an automation' },
	'automations.update': { summary: 'Update an automation (partial)', body: body({ ...AUTOMATION_FIELDS, enabled: { type: 'boolean' } }) },
	'automations.delete': { summary: 'Delete an automation' },
	'automations.trigger': { summary: 'Run an automation now', body: body({ confirm: { type: 'boolean', description: 'Required when the action spends.' } }) },
	'strategies.list': { summary: 'List strategy presets' },
	'strategies.get': { summary: 'Get a strategy preset' },
	'webhooks.events': { summary: 'List event types, the retry schedule and the signature format' },
	'webhooks.list': { summary: 'List webhooks', query: [cursor, limit()] },
	'webhooks.create': { summary: 'Create a webhook; the response carries its signing secret once', body: body(WEBHOOK_FIELDS, ['url']) },
	'webhooks.get': { summary: 'Get a webhook with seven-day delivery stats' },
	'webhooks.update': { summary: 'Update a webhook', body: body({ ...WEBHOOK_FIELDS, active: { type: 'boolean' } }) },
	'webhooks.delete': { summary: 'Delete a webhook and its delivery log' },
	'webhooks.rotate': { summary: 'Rotate the signing secret' },
	'webhooks.test': { summary: 'Send a test event now and return the delivery' },
	'webhooks.deliveries.list': {
		summary: 'List a webhook\'s delivery log',
		query: [cursor, limit(), { name: 'status', in: 'query', schema: { type: 'string', enum: ['pending', 'delivering', 'succeeded', 'failed'] } }, { name: 'eventType', in: 'query', schema: { type: 'string' } }],
	},
	'webhooks.deliveries.get': { summary: 'Get a delivery with its payload and every attempt' },
	'webhooks.deliveries.replay': { summary: 'Re-send a delivery as a new row with the same event id and payload' },
	'v1.skills.list': { summary: 'List built-in skills' },
	'v1.skills.community.list': { summary: 'List community skills', query: [cursor, limit()] },
	'v1.skills.community.get': { summary: 'Get a community skill' },
	'v1.agents.skills.custom.list': { summary: 'List an agent\'s custom skills' },
	'v1.agents.skills.custom.create': { summary: 'Create a custom skill', body: body({ name: str('Skill name.'), description: str('What the skill does.'), content: str('Markdown instructions.'), tags: { type: 'array', items: { type: 'string' } }, version: str('Semver.'), enabled: { type: 'boolean' } }, ['name', 'content']) },
	'v1.agents.skills.custom.import': { summary: 'Install a community skill on an agent', body: body({ slug: str('Community skill slug from GET /api/v1/skills/community.') }, ['slug']) },
	'v1.agents.skills.custom.get': { summary: 'Get a custom skill' },
	'v1.agents.skills.custom.update': { summary: 'Update a custom skill (partial)', body: body({ name: str('Skill name.'), description: str('What the skill does.'), content: str('Markdown instructions.'), tags: { type: 'array', items: { type: 'string' } }, version: str('Semver.'), enabled: { type: 'boolean' } }) },
	'v1.agents.skills.custom.delete': { summary: 'Delete a custom skill' },
	'me.get': { summary: 'Describe the caller: account, scopes and free-tier status' },
};

function titleFromName(name) {
	return name.replace(/^v1\./, '').replace(/\./g, ' ');
}

function operation(route) {
	const doc = DOCS[route.name] || {};
	const pathParams = [...route.path.matchAll(/:(\w+)/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } }));
	const writes = ['POST', 'PATCH', 'PUT'].includes(route.method);
	const op = {
		operationId: route.name.replace(/[^a-zA-Z0-9]+(.)/g, (_, c) => c.toUpperCase()),
		summary: doc.summary || titleFromName(route.name),
		tags: [TAG[route.path.split('/')[1]] || 'Agents API'],
		security: route.auth === 'public' ? [] : [{ bearerAuth: [] }, { apiKeyAuth: [] }],
		parameters: [...pathParams, ...(doc.query || [])],
		responses: {
			200: { description: doc.sse ? 'text/event-stream of step, status, done and reconnect events.' : 'The { data, meta: { requestId, timestamp } } envelope.' },
			...(route.method === 'POST' && !doc.sse ? { 201: { description: 'Created. Same envelope.' } } : {}),
			400: { description: 'invalid_parameter, bad_json or a route-specific validation code.' },
			...(route.auth !== 'public' ? { 401: { description: 'unauthorized' }, 403: { description: 'insufficient_scope' } } : {}),
			404: { description: 'not_found' },
			429: { description: 'rate_limited, with Retry-After.' },
		},
	};
	if (route.scope) op['x-required-scope'] = route.scope;
	if (writes) {
		op.parameters.push({ name: 'Idempotency-Key', in: 'header', schema: { type: 'string', maxLength: 200 }, description: 'A retry with the same key and body replays the stored response for 24 hours.' });
		if (doc.body) {
			op.requestBody = {
				required: doc.body.required.length > 0,
				content: { 'application/json': { schema: { type: 'object', required: doc.body.required, properties: doc.body.properties } } },
			};
		}
	}
	return op;
}

/** OpenAPI `paths` for every route mounted by api/v1/rest.js. */
export function agentsV1Paths() {
	const paths = {};
	for (const route of ROUTES) {
		const key = `/api/v1${route.path.replace(/:(\w+)/g, '{$1}')}`;
		(paths[key] ||= {})[route.method.toLowerCase()] = operation(route);
	}
	return paths;
}

export const AGENTS_V1_TAGS = [
	{ name: 'Agents API', description: 'Agents, chat, runs, automations, skills and strategies over plain HTTP with one bearer key. Guide: docs/api-reference.md "Agents API (v1)".' },
	{ name: 'Agents API: webhooks', description: 'Signed event delivery with retries, a delivery log and replay. Guide: docs/developer-platform.md.' },
];

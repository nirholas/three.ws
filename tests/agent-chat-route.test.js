// LLM_ROUTE_AGENT_CHAT in api/chat.js (docs/evals/grok-4-7-on-three-ws.md):
// agent chat has its own provider ladder, so the per-task Grok route for it is
// applied there. Off or invalid leaves the ladder as it was; on, signed-in
// turns that named no provider or model request the routed Grok model; a
// missing key or an xAI error falls through to the rest of the ladder.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: {
		chatIp: vi.fn(async () => ({ success: true, reset: Date.now() + 60_000 })),
		chatUser: vi.fn(async () => ({ success: true, reset: Date.now() + 60_000 })),
		chatHostKeyGlobal: vi.fn(async () => ({ success: true, reset: Date.now() + 60_000 })),
		tradePerUser: vi.fn(async () => ({ success: true })),
	},
	clientIp: () => '127.0.0.1',
}));
vi.mock('../api/_lib/provider-health.js', () => ({
	providersInCooldown: vi.fn(async () => new Map()),
	markProviderCooldown: vi.fn(async () => {}),
	AUTH_COOLDOWN_SECONDS: 900,
	isBillingQuotaError: () => false,
}));
vi.mock('../api/_lib/auth.js', () => ({
	getSessionUser: vi.fn(async () => null),
	authenticateBearer: vi.fn(async () => null),
	extractBearer: () => null,
}));
vi.mock('../api/_lib/db.js', () => ({ sql: vi.fn(async () => []) }));

const { agentChatRouteFor, withRouteEffort, pickProvider, buildFallbackChain } = await import('../api/chat.js');
const { GROK_MODELS, GROK_DEFAULT_MODEL, GROK_BUDGET_MODEL } = await import('../api/_lib/chat-models.js');

const TOUCHED = ['LLM_ROUTE_AGENT_CHAT', 'GROK_API_KEY', 'GROQ_API_KEY', 'OPENROUTER_API_KEY', 'NVIDIA_API_KEY', 'VERTEX_CLAUDE_PRIMARY', 'VERTEX_CLAUDE_ENABLED', 'GOOGLE_CLOUD_PROJECT', 'CHAT_MODEL'];
let saved;
beforeEach(() => {
	saved = Object.fromEntries(TOUCHED.map((k) => [k, process.env[k]]));
	for (const k of TOUCHED) delete process.env[k];
});
afterEach(() => {
	for (const k of TOUCHED) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
	vi.restoreAllMocks();
});

const signedIn = { anonymous: false, requestedProvider: undefined, requestedModel: undefined };
const budgetEffort = GROK_MODELS.find((m) => m.id === GROK_BUDGET_MODEL).reasoningEfforts[0];

describe('agentChatRouteFor', () => {
	it('is off when unset, empty, off or default', () => {
		for (const v of [undefined, '', 'off', 'default']) {
			expect(agentChatRouteFor(signedIn, v === undefined ? {} : { LLM_ROUTE_AGENT_CHAT: v })).toBeNull();
		}
	});

	it('routes a signed-in turn to the named Grok model, with its effort', () => {
		expect(agentChatRouteFor(signedIn, { LLM_ROUTE_AGENT_CHAT: GROK_DEFAULT_MODEL })).toEqual({ provider: 'grok', model: GROK_DEFAULT_MODEL, effort: null });
		expect(agentChatRouteFor(signedIn, { LLM_ROUTE_AGENT_CHAT: `${GROK_BUDGET_MODEL}:${budgetEffort}` })).toEqual({ provider: 'grok', model: GROK_BUDGET_MODEL, effort: budgetEffort });
	});

	it('ignores an invalid value with a warning and keeps the ladder', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		expect(agentChatRouteFor(signedIn, { LLM_ROUTE_AGENT_CHAT: 'not-a-grok-model' })).toBeNull();
		expect(agentChatRouteFor(signedIn, { LLM_ROUTE_AGENT_CHAT: `${GROK_DEFAULT_MODEL}:sideways` })).toBeNull();
		expect(warn).toHaveBeenCalled();
	});

	it('never routes anonymous traffic: Grok is sign-in-only', () => {
		expect(agentChatRouteFor({ ...signedIn, anonymous: true }, { LLM_ROUTE_AGENT_CHAT: GROK_DEFAULT_MODEL })).toBeNull();
	});

	it('leaves a caller-picked provider or model alone', () => {
		const env = { LLM_ROUTE_AGENT_CHAT: GROK_DEFAULT_MODEL };
		expect(agentChatRouteFor({ ...signedIn, requestedProvider: 'groq' }, env)).toBeNull();
		expect(agentChatRouteFor({ ...signedIn, requestedModel: 'some-model' }, env)).toBeNull();
	});
});

describe('routed agent chat on the provider ladder', () => {
	it('picks the routed Grok model when the server has a Grok key', () => {
		process.env.GROK_API_KEY = 'xai-test-key';
		process.env.GROQ_API_KEY = 'groq-test-key';
		const route = pickProvider('grok', GROK_DEFAULT_MODEL, {}, new Map());
		expect(route.name).toBe('grok');
		expect(route.model).toBe(GROK_DEFAULT_MODEL);
	});

	it('falls through to the ladder without a Grok key', () => {
		process.env.GROQ_API_KEY = 'groq-test-key';
		const route = pickProvider('grok', GROK_DEFAULT_MODEL, {}, new Map());
		expect(route.name).toBe('groq');
	});

	it('keeps the free ladder behind the routed Grok rung, so an xAI error fails over', () => {
		process.env.GROK_API_KEY = 'xai-test-key';
		process.env.GROQ_API_KEY = 'groq-test-key';
		const route = pickProvider('grok', GROK_DEFAULT_MODEL, {}, new Map());
		const chain = buildFallbackChain(route, {}, new Map(), null);
		expect(chain[0].name).toBe('grok');
		expect(chain.slice(1).some((r) => r.name === 'groq')).toBe(true);
	});

	it('adds the routed effort to the Grok body only', () => {
		process.env.GROK_API_KEY = 'xai-test-key';
		process.env.GROQ_API_KEY = 'groq-test-key';
		const chatRoute = { provider: 'grok', model: GROK_BUDGET_MODEL, effort: budgetEffort };
		const grok = withRouteEffort(pickProvider('grok', GROK_BUDGET_MODEL, {}, new Map()), chatRoute);
		const payload = grok.buildPayload({ systemPrompt: 's', history: [{ role: 'user', content: 'hi' }], maxTokens: 64 });
		expect(payload.reasoning_effort).toBe(budgetEffort);
		expect(payload.model).toBe(GROK_BUDGET_MODEL);
		const groq = pickProvider('groq', null, {}, new Map());
		expect(withRouteEffort(groq, chatRoute)).toBe(groq);
		expect(withRouteEffort(grok, null)).toBe(grok);
	});
});

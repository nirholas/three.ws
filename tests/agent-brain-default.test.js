// Order 044, task 1: profile chat (api/chat.js) and the web copilot
// (api/agents/copilot.js) resolve an agent's chosen brain through the same
// function other surfaces use (api/_lib/agent-model.js), never silently on
// the platform default.

import { describe, it, expect, vi } from 'vitest';

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

const { agentBrainDefaultFor } = await import('../api/chat.js');
const { copilotModel } = await import('../api/agents/copilot.js');

const GROK_MODEL = 'grok-4.7';

describe('agentBrainDefaultFor (api/chat.js)', () => {
	it('defaults to the agent brain when the caller named neither provider nor model', () => {
		const choice = agentBrainDefaultFor({
			anonymous: false,
			requestedProvider: undefined,
			requestedModel: undefined,
			agentMeta: { runtime: { model: GROK_MODEL } },
		});
		expect(choice).toEqual({ provider: 'grok', model: GROK_MODEL });
	});

	it('is null for an anonymous caller: grok is sign-in-only', () => {
		const choice = agentBrainDefaultFor({
			anonymous: true,
			requestedProvider: undefined,
			requestedModel: undefined,
			agentMeta: { runtime: { model: GROK_MODEL } },
		});
		expect(choice).toBeNull();
	});

	it('is null when the caller already named a provider or model: their choice wins', () => {
		expect(agentBrainDefaultFor({
			anonymous: false, requestedProvider: 'anthropic', requestedModel: undefined,
			agentMeta: { runtime: { model: GROK_MODEL } },
		})).toBeNull();
		expect(agentBrainDefaultFor({
			anonymous: false, requestedProvider: undefined, requestedModel: 'grok-4.6',
			agentMeta: { runtime: { model: GROK_MODEL } },
		})).toBeNull();
	});

	it('is null with no agent meta', () => {
		expect(agentBrainDefaultFor({ anonymous: false, requestedProvider: undefined, requestedModel: undefined, agentMeta: null })).toBeNull();
	});

	it('is null when the agent has no catalog-known default', () => {
		expect(agentBrainDefaultFor({
			anonymous: false, requestedProvider: undefined, requestedModel: undefined,
			agentMeta: { runtime: { model: 'some-retired-id-nobody-knows' } },
		})).toBeNull();
	});
});

describe('copilotModel (api/agents/copilot.js)', () => {
	it('honors an explicit grok override', () => {
		const choice = copilotModel(GROK_MODEL, {});
		expect(choice.model).toBe(GROK_MODEL);
		expect(choice.source).toBe('message');
	});

	it('falls through to the agent default when no override is given', () => {
		const choice = copilotModel(undefined, { runtime: { model: GROK_MODEL } });
		expect(choice.model).toBe(GROK_MODEL);
		expect(choice.source).toBe('agent');
	});

	it('falls through to the platform chain when the agent default has no tool calling', () => {
		const choice = copilotModel(undefined, { runtime: { model: 'deepseek-r1' } });
		expect(choice.model).toBeNull();
		expect(choice.source).toBe('platform');
	});
});

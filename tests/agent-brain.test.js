// One brain for every agent-turn surface: an agent set to Grok keeps Grok across
// the profile copilot, the chat gateway and scheduled runs, led by the owner's
// saved xAI key, then the server key, then the default chain, and the answer
// names the rung that served it.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sqlMock = vi.fn(async () => []);
vi.mock('../api/_lib/db.js', () => ({ sql: (...a) => sqlMock(...a) }));
const loadKeysMock = vi.fn(async () => ({}));
vi.mock('../api/_lib/provider-keys.js', () => ({ loadUserProviderKeys: (...a) => loadKeysMock(...a) }));

const runCopilotTurnMock = vi.fn(async () => ({ reply: 'hi', proposals: [], toolCalls: [], citations: [], served: null }));
vi.mock('../api/_lib/copilot-engine.js', async (orig) => ({ ...(await orig()), runCopilotTurn: (...a) => runCopilotTurnMock(...a) }));
vi.mock('../api/_lib/agent-thread.js', () => ({
	appendThreadMessage: vi.fn(async () => {}),
	threadHistoryForModel: vi.fn(async () => []),
}));
vi.mock('../api/_lib/gateway/agents.js', () => ({
	resolveChatAgent: vi.fn(async () => AGENT),
	listAccountAgents: vi.fn(async () => []),
}));
vi.mock('../api/_lib/gateway/store.js', () => ({ createPreview: vi.fn(), setPreviewMessageRef: vi.fn(), PREVIEW_TTL_MINUTES: 10 }));
vi.mock('../api/_lib/gateway/voice.js', () => ({ maybeSpeakReply: vi.fn(async () => {}) }));

const { resolveAgentBrain, brainChain, brainBadge, isGrokModel } = await import('../api/_lib/agent-brain.js');
const { runCopilotTurn: realRunCopilotTurn } = await vi.importActual('../api/_lib/copilot-engine.js');
const { converse } = await import('../api/_lib/gateway/conversation.js');
const { chainFor } = await import('../api/_lib/agents-v1/runs.js');

const AGENT = { id: 'a1', user_id: 'u1', name: 'Gina', persona_prompt: 'p', meta: { runtime: { model: 'grok-4.3' } } };
const KEYS = ['GROK_API_KEY', 'XAI_API_KEY', 'OPENROUTER_API_KEY', 'GROQ_API_KEY', 'GOOGLE_CLOUD_PROJECT', 'CEREBRAS_API_KEY'];
const saved = {};

beforeEach(() => {
	for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
	process.env.GROQ_API_KEY = 'groq-test';
	sqlMock.mockReset().mockResolvedValue([{ provider_keys: { grok: 'enc' } }]);
	loadKeysMock.mockReset().mockResolvedValue({});
	runCopilotTurnMock.mockClear();
});
afterEach(() => {
	for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

const lanes = (chain) => chain.map((r) => `${r.name}:${r.keySource}`);

describe('resolveAgentBrain', () => {
	it('puts the owner key first, then the server key, then the default chain, for a Grok agent', async () => {
		process.env.GROK_API_KEY = 'xai-server';
		loadKeysMock.mockResolvedValue({ grok: 'xai-owner' });
		const brain = await resolveAgentBrain({ agent: AGENT, purpose: 'run', lenient: true });
		expect(brain.model).toBe('grok-4.3');
		expect(brain.source).toBe('agent');
		expect(lanes(brain.chain).slice(0, 3)).toEqual(['grok:owner', 'grok:server', 'groq:platform']);
		expect(brain.chain[0].key).toBe('xai-owner');
		expect(brain.chain[1].key).toBe('xai-server');
	});

	it('falls to the server key when the owner saved none', async () => {
		process.env.GROK_API_KEY = 'xai-server';
		const brain = await resolveAgentBrain({ agent: AGENT, purpose: 'run', lenient: true });
		expect(lanes(brain.chain).slice(0, 2)).toEqual(['grok:server', 'groq:platform']);
	});

	it('answers on the default chain when no xAI key exists anywhere', async () => {
		const brain = await resolveAgentBrain({ agent: AGENT, purpose: 'run', lenient: true });
		expect(brain.model).toBe('grok-4.3');
		expect(lanes(brain.chain)).toEqual(['groq:platform']);
	});

	it('never uses the owner key for a signed-out caller', async () => {
		loadKeysMock.mockResolvedValue({ grok: 'xai-owner' });
		const brain = await resolveAgentBrain({ agent: AGENT, signedIn: false });
		expect(brain.chain.some((r) => r.keySource === 'owner')).toBe(false);
	});

	it('leaves a non-Grok agent on its own chain without reading the key', async () => {
		const brain = await resolveAgentBrain({ agent: { ...AGENT, meta: {} } });
		expect(brain.model).toBeNull();
		expect(sqlMock).not.toHaveBeenCalled();
	});
});

describe('brainBadge', () => {
	it('reports the chosen brain serving, with the key that paid', () => {
		const chain = brainChain('grok-4.3', { ownerKey: 'xai-owner' }).chain;
		expect(brainBadge({ model: 'grok-4.3' }, chain[0])).toMatchObject({ served: 'grok-4.3', lane: 'grok', keySource: 'owner', failover: false });
	});
	it('flags a failover rung', () => {
		const rung = { name: 'groq', model: 'qwen/qwen3.8-27b', keySource: 'platform' };
		expect(brainBadge({ model: 'grok-4.3' }, rung)).toMatchObject({ served: 'qwen/qwen3.8-27b', lane: 'groq', failover: true });
	});
	it('isGrokModel only matches xAI catalog ids', () => {
		expect(isGrokModel('grok-4.3')).toBe(true);
		expect(isGrokModel('claude-haiku-4-5-20251001')).toBe(false);
		expect(isGrokModel(null)).toBe(false);
	});
});

describe('profile copilot engine: fails over and reports the serving rung', () => {
	it('skips a dead Grok rung and names the fallback that answered', async () => {
		const sse = (text) => new Response(
			`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`,
			{ status: 200, headers: { 'content-type': 'text/event-stream' } },
		);
		const urls = [];
		const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
			urls.push(String(url));
			return String(url).includes('api.x.ai') ? new Response('{"error":"down"}', { status: 503 }) : sse('hello');
		});
		process.env.GROK_API_KEY = 'xai-server';
		loadKeysMock.mockResolvedValue({ grok: 'xai-owner' });
		const brain = await resolveAgentBrain({ agent: AGENT, purpose: 'run', lenient: true });
		const rounds = [];
		const turn = await realRunCopilotTurn({
			agent: AGENT, history: [{ role: 'user', content: 'hi' }], network: 'mainnet',
			chain: brain.chain, onRound: (s) => rounds.push(s),
		});
		fetchMock.mockRestore();
		expect(urls.filter((u) => u.includes('api.x.ai')).length).toBe(2); // owner then server
		expect(turn.reply).toBe('hello');
		expect(turn.served).toMatchObject({ provider: 'groq', keySource: 'platform' });
		expect(rounds).toHaveLength(1);
		expect(brainBadge(brain, turn.served).failover).toBe(true);
	});

	it('reports the Grok owner rung when xAI answers', async () => {
		const body = `data: ${JSON.stringify({ choices: [{ delta: { content: 'grok here' } }] })}\n\ndata: [DONE]\n\n`;
		const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(body, { status: 200 }));
		loadKeysMock.mockResolvedValue({ grok: 'xai-owner' });
		const brain = await resolveAgentBrain({ agent: AGENT, purpose: 'run', lenient: true });
		const turn = await realRunCopilotTurn({ agent: AGENT, history: [{ role: 'user', content: 'hi' }], network: 'mainnet', chain: brain.chain });
		const auth = fetchMock.mock.calls[0][1].headers.authorization;
		fetchMock.mockRestore();
		expect(auth).toBe('Bearer xai-owner');
		expect(brainBadge(brain, turn.served)).toMatchObject({ served: 'grok-4.3', lane: 'grok', keySource: 'owner', failover: false });
	});
});

describe('chat gateway', () => {
	it('runs the turn on the agent brain chain', async () => {
		process.env.GROK_API_KEY = 'xai-server';
		const gw = { platform: 'telegram', canEdit: true, sendText: vi.fn(async () => 'm1'), editMessage: vi.fn(), typing: vi.fn() };
		await converse({ gw, event: { chatId: 'c1', platform: 'telegram' }, link: { id: 'l1', user_id: 'u1' }, text: 'hello' });
		const call = runCopilotTurnMock.mock.calls[0][0];
		expect(lanes(call.chain).slice(0, 2)).toEqual(['grok:server', 'groq:platform']);
	});
});

describe('scheduled runs', () => {
	it('uses the agent brain when the run names no model, and keeps the owner key rung on a free-only run', async () => {
		process.env.GROK_API_KEY = 'xai-server';
		loadKeysMock.mockResolvedValue({ grok: 'xai-owner' });
		sqlMock.mockImplementation(async (strings) => (String(strings[0]).includes('FROM users')
			? [{ provider_keys: { grok: 'enc' } }]
			: [{ id: 'a1', user_id: 'u1', meta: AGENT.meta }]));
		const chain = await chainFor({ agent_id: 'a1', user_id: 'u1', model: null, budget_credits_usd: 0 });
		expect(lanes(chain)[0]).toBe('grok:owner');
		expect(chain.some((r) => r.keySource === 'server')).toBe(false); // server Grok is paid, a free-only run drops it
		const funded = await chainFor({ agent_id: 'a1', user_id: 'u1', model: null, budget_credits_usd: 5 });
		expect(lanes(funded).slice(0, 3)).toEqual(['grok:owner', 'grok:server', 'groq:platform']);
	});
});

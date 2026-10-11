// Coverage for order 044: an agent's chosen Grok brain is honored on every
// agent-turn surface, with the owner's saved xAI key leading the server key
// and the server key leading the default chain.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('../api/_lib/db.js', () => ({
	sql: sqlMock,
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
	isStoragePressured: () => false,
}));

// The real decryptProviderKey needs JWT_SECRET to derive its AES key; this
// boundary only cares that a stored ciphertext round-trips to a plaintext
// key, not which cipher ran. `enc(...)` mirrors the encrypt-side convention
// already used by tests/api-user-wallet-x402-guards.test.js.
const decryptProviderKeyMock = vi.fn(async (v) => {
	if (typeof v !== 'string' || !v.startsWith('enc(')) throw new Error('bad ciphertext');
	return v.slice(4, -1);
});
vi.mock('../api/_lib/provider-keys.js', () => ({
	decryptProviderKey: (...a) => decryptProviderKeyMock(...a),
}));

const { loadOwnerGrokKey, GROK_PROVIDER } = await import('../api/_lib/agent-grok-key.js');
const { modelRungs, providerChainFor } = await import('../api/_lib/llm-tool-chain.js');
const { modelChain } = await import('../api/_lib/agent-model.js');
const { chainForAgent } = await import('../api/_lib/gateway/conversation.js');
const { resolveTickChain } = await import('../api/_lib/strategy-loop/tick.js');

const GROK_MODEL = 'grok-4.7';
const USER_ID = 'ca7f8e0a-29d0-4e2e-8a2a-2a5a5a5a5a5a';

describe('loadOwnerGrokKey', () => {
	beforeEach(() => { sqlMock.mockReset(); decryptProviderKeyMock.mockClear(); });

	it('is null with no userId (never queries the db)', async () => {
		expect(await loadOwnerGrokKey(null)).toBeNull();
		expect(await loadOwnerGrokKey(undefined)).toBeNull();
		expect(sqlMock).not.toHaveBeenCalled();
	});

	it('is null when the user saved no grok key', async () => {
		sqlMock.mockResolvedValueOnce([{ provider_keys: { anthropic: 'enc(sk-ant-x)' } }]);
		expect(await loadOwnerGrokKey(USER_ID)).toBeNull();
	});

	it('is null when the user row does not exist', async () => {
		sqlMock.mockResolvedValueOnce([]);
		expect(await loadOwnerGrokKey(USER_ID)).toBeNull();
	});

	it('decrypts a stored grok key', async () => {
		sqlMock.mockResolvedValueOnce([{ provider_keys: { [GROK_PROVIDER]: 'enc(xai-owner-key)' } }]);
		expect(await loadOwnerGrokKey(USER_ID)).toBe('xai-owner-key');
	});

	it('is null, not thrown, on a corrupt stored blob', async () => {
		sqlMock.mockResolvedValueOnce([{ provider_keys: { [GROK_PROVIDER]: 'not-valid-ciphertext' } }]);
		await expect(loadOwnerGrokKey(USER_ID)).resolves.toBeNull();
	});
});

describe('modelRungs / providerChainFor: grok owner-key rung', () => {
	const prevGrokKey = process.env.GROK_API_KEY;
	const prevOpenrouterKey = process.env.OPENROUTER_API_KEY;

	afterEach(() => {
		process.env.GROK_API_KEY = prevGrokKey;
		process.env.OPENROUTER_API_KEY = prevOpenrouterKey;
	});

	it('leads with the owner key ahead of the server key', () => {
		process.env.GROK_API_KEY = 'xai-server-key';
		const rungs = modelRungs(GROK_MODEL, { grokKey: 'xai-owner-key' });
		expect(rungs).toHaveLength(2);
		expect(rungs[0]).toMatchObject({ name: 'grok', key: 'xai-owner-key', keySource: 'owner', model: GROK_MODEL });
		expect(rungs[1]).toMatchObject({ name: 'grok', key: 'xai-server-key', keySource: 'platform', model: GROK_MODEL });
	});

	it('serves only the server-key rung without an owner key', () => {
		process.env.GROK_API_KEY = 'xai-server-key';
		const rungs = modelRungs(GROK_MODEL, {});
		expect(rungs).toHaveLength(1);
		expect(rungs[0]).toMatchObject({ name: 'grok', key: 'xai-server-key', keySource: 'platform' });
	});

	it('serves only the owner-key rung when no server key is configured, so the agent still answers', () => {
		delete process.env.GROK_API_KEY;
		const rungs = modelRungs(GROK_MODEL, { grokKey: 'xai-owner-key' });
		expect(rungs).toHaveLength(1);
		expect(rungs[0]).toMatchObject({ name: 'grok', key: 'xai-owner-key', keySource: 'owner' });
	});

	it('has no rungs at all with neither key: the platform default chain is the only path left', () => {
		delete process.env.GROK_API_KEY;
		expect(modelRungs(GROK_MODEL, {})).toEqual([]);
	});

	it('providerChainFor puts the grok rungs ahead of the free default chain', () => {
		process.env.GROK_API_KEY = 'xai-server-key';
		delete process.env.OPENROUTER_API_KEY;
		const chain = providerChainFor(GROK_MODEL, { grokKey: 'xai-owner-key' });
		expect(chain[0]).toMatchObject({ name: 'grok', keySource: 'owner' });
		expect(chain[1]).toMatchObject({ name: 'grok', keySource: 'platform' });
	});

	it('providerChainFor falls back to the default chain alone when grok has no reachable rung', () => {
		delete process.env.GROK_API_KEY;
		process.env.OPENROUTER_API_KEY = 'or-key';
		const chain = providerChainFor(GROK_MODEL, {});
		expect(chain.every((r) => r.name !== 'grok')).toBe(true);
		expect(chain.some((r) => r.name === 'openrouter')).toBe(true);
	});
});

describe('modelChain: threading grokKey through to providerChainFor', () => {
	const prevGrokKey = process.env.GROK_API_KEY;
	afterEach(() => { process.env.GROK_API_KEY = prevGrokKey; });

	it('the owner rung leads a grok model chain', () => {
		process.env.GROK_API_KEY = 'xai-server-key';
		const { chain, tools } = modelChain(GROK_MODEL, { grokKey: 'xai-owner-key' });
		expect(tools).toBe(true);
		expect(chain[0]).toMatchObject({ name: 'grok', keySource: 'owner' });
	});

	it('a null model returns the platform chain untouched by grokKey', () => {
		const { chain } = modelChain(null, { grokKey: 'xai-owner-key' });
		expect(chain.every((r) => r.keySource !== 'owner')).toBe(true);
	});
});

describe('chainForAgent (api/_lib/gateway/conversation.js)', () => {
	beforeEach(() => { sqlMock.mockReset(); });
	const prevGrokKey = process.env.GROK_API_KEY;
	afterEach(() => { process.env.GROK_API_KEY = prevGrokKey; });

	it('returns undefined when the agent has no default model (platform chain applies downstream)', async () => {
		const chain = await chainForAgent({ meta: {}, user_id: USER_ID });
		expect(chain).toBeUndefined();
	});

	it('returns undefined when the agent default has no tool calling', async () => {
		const chain = await chainForAgent({ meta: { runtime: { model: 'deepseek-r1' } }, user_id: USER_ID });
		expect(chain).toBeUndefined();
	});

	it('leads with the owner grok key when the agent defaults to grok', async () => {
		process.env.GROK_API_KEY = 'xai-server-key';
		sqlMock.mockResolvedValueOnce([{ provider_keys: { [GROK_PROVIDER]: 'enc(xai-owner-key)' } }]);
		const chain = await chainForAgent({ meta: { runtime: { model: GROK_MODEL } }, user_id: USER_ID });
		expect(chain[0]).toMatchObject({ name: 'grok', keySource: 'owner', key: 'xai-owner-key' });
	});

	it('falls over to the server key when the agent has no saved key', async () => {
		process.env.GROK_API_KEY = 'xai-server-key';
		sqlMock.mockResolvedValueOnce([{ provider_keys: {} }]);
		const chain = await chainForAgent({ meta: { runtime: { model: GROK_MODEL } }, user_id: USER_ID });
		expect(chain[0]).toMatchObject({ name: 'grok', keySource: 'platform', key: 'xai-server-key' });
	});
});

describe('resolveTickChain (api/_lib/strategy-loop/tick.js)', () => {
	beforeEach(() => { sqlMock.mockReset(); });
	const prevGrokKey = process.env.GROK_API_KEY;
	afterEach(() => { process.env.GROK_API_KEY = prevGrokKey; });

	it('falls back to the full default chain with no usable model', async () => {
		const chain = await resolveTickChain({ meta: {}, user_id: USER_ID });
		expect(Array.isArray(chain)).toBe(true);
		expect(chain.every((r) => r.name !== 'grok')).toBe(true);
	});

	it('reads the legacy meta.brain.provider location, not just meta.runtime.model', async () => {
		process.env.GROK_API_KEY = 'xai-server-key';
		sqlMock.mockResolvedValueOnce([{ provider_keys: {} }]);
		const chain = await resolveTickChain({ meta: { brain: { provider: GROK_MODEL } }, user_id: USER_ID });
		expect(chain[0]).toMatchObject({ name: 'grok', keySource: 'platform' });
	});

	it('leads with the owner grok key for a tick agent that saved one', async () => {
		process.env.GROK_API_KEY = 'xai-server-key';
		sqlMock.mockResolvedValueOnce([{ provider_keys: { [GROK_PROVIDER]: 'enc(xai-owner-key)' } }]);
		const chain = await resolveTickChain({ meta: { runtime: { model: GROK_MODEL } }, user_id: USER_ID });
		expect(chain[0]).toMatchObject({ name: 'grok', keySource: 'owner', key: 'xai-owner-key' });
	});
});

describe('web copilot (api/agents/copilot.js): same owner-key-then-server-key composition', () => {
	beforeEach(() => { sqlMock.mockReset(); });
	const prevGrokKey = process.env.GROK_API_KEY;
	afterEach(() => { process.env.GROK_API_KEY = prevGrokKey; });

	it('mirrors copilot.js line-for-line: grokKey loaded only for a grok choice, then threaded into modelChain', async () => {
		process.env.GROK_API_KEY = 'xai-server-key';
		sqlMock.mockResolvedValueOnce([{ provider_keys: { [GROK_PROVIDER]: 'enc(xai-owner-key)' } }]);
		const { MODEL_CATALOG } = await import('../api/_lib/chat-models.js');
		const choice = { model: GROK_MODEL };
		const row = { user_id: USER_ID };
		const grokKey = choice.model && MODEL_CATALOG[choice.model]?.provider === 'grok' ? await loadOwnerGrokKey(row.user_id) : null;
		const { chain } = modelChain(choice.model, { grokKey });
		expect(chain[0]).toMatchObject({ name: 'grok', keySource: 'owner', key: 'xai-owner-key' });
	});

	it('never queries for a key when the choice is not grok', async () => {
		const choice = { model: 'claude-haiku-4-5-20251001' };
		const row = { user_id: USER_ID };
		const { MODEL_CATALOG } = await import('../api/_lib/chat-models.js');
		const grokKey = choice.model && MODEL_CATALOG[choice.model]?.provider === 'grok' ? await loadOwnerGrokKey(row.user_id) : null;
		expect(grokKey).toBeNull();
		expect(sqlMock).not.toHaveBeenCalled();
	});
});

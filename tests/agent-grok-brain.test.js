// Coverage for order 044: an agent's chosen Grok brain is honored on every
// agent-turn surface, with the owner's saved xAI key leading the server key
// and the server key leading the default chain.

import { describe, it, expect, vi, beforeEach } from 'vitest';

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

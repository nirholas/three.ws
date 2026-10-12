// resolveProviderKeyWithSource: the priority order behind the Tripo house-key
// lane (inline header/body key, then the signed-in user's stored key, then a
// provider's house env var, last). resolveProviderKey (every other caller:
// regen-provider.js, the MCP studio tools) must keep returning just the key,
// unaffected by whether a house lane exists for that provider.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../api/_lib/auth.js', () => ({ getSessionUser: vi.fn(async () => null) }));
vi.mock('../../api/_lib/db.js', () => ({ sql: vi.fn(async () => []) }));
vi.mock('../../api/_lib/provider-keys.js', () => ({
	loadUserProviderKeys: vi.fn(async () => ({})),
}));

import { getSessionUser } from '../../api/_lib/auth.js';
import { sql } from '../../api/_lib/db.js';
import { loadUserProviderKeys } from '../../api/_lib/provider-keys.js';
import { resolveProviderKey, resolveProviderKeyWithSource } from '../../api/_lib/forge-provider-key.js';

const priorKey = process.env.TRIPO_API_KEY;

function req(headers = {}) {
	return { headers };
}

beforeEach(() => {
	vi.mocked(getSessionUser).mockResolvedValue(null);
	vi.mocked(sql).mockResolvedValue([]);
	vi.mocked(loadUserProviderKeys).mockResolvedValue({});
	delete process.env.TRIPO_API_KEY;
});

afterEach(() => {
	if (priorKey === undefined) delete process.env.TRIPO_API_KEY;
	else process.env.TRIPO_API_KEY = priorKey;
});

describe('resolveProviderKeyWithSource', () => {
	it('an inline header key wins over everything, source:inline', async () => {
		process.env.TRIPO_API_KEY = 'house-key';
		const got = await resolveProviderKeyWithSource(req({ 'x-forge-provider-key': ' inline-key ' }), null, 'tripo');
		expect(got).toEqual({ key: 'inline-key', source: 'inline' });
	});

	it('an inline body key wins over the house key, source:inline', async () => {
		process.env.TRIPO_API_KEY = 'house-key';
		const got = await resolveProviderKeyWithSource(req(), { provider_key: 'body-key' }, 'tripo');
		expect(got).toEqual({ key: 'body-key', source: 'inline' });
	});

	it('the signed-in user key wins over the house key, source:user', async () => {
		process.env.TRIPO_API_KEY = 'house-key';
		vi.mocked(getSessionUser).mockResolvedValue({ id: 'u1' });
		vi.mocked(sql).mockResolvedValue([{ provider_keys: 'encrypted-blob' }]);
		vi.mocked(loadUserProviderKeys).mockResolvedValue({ tripo: 'user-key' });
		const got = await resolveProviderKeyWithSource(req(), null, 'tripo');
		expect(got).toEqual({ key: 'user-key', source: 'user' });
	});

	it('falls back to the house env var only when no inline/user key exists, source:house', async () => {
		process.env.TRIPO_API_KEY = 'house-key';
		const got = await resolveProviderKeyWithSource(req(), null, 'tripo');
		expect(got).toEqual({ key: 'house-key', source: 'house' });
	});

	it('returns null/null when nothing is available anywhere', async () => {
		delete process.env.TRIPO_API_KEY;
		const got = await resolveProviderKeyWithSource(req(), null, 'tripo');
		expect(got).toEqual({ key: null, source: null });
	});

	it('a provider with no house-key lane (meshy) never falls back to an env var', async () => {
		process.env.MESHY_API_KEY = 'should-never-be-read';
		const got = await resolveProviderKeyWithSource(req(), null, 'meshy');
		expect(got).toEqual({ key: null, source: null });
		delete process.env.MESHY_API_KEY;
	});
});

describe('resolveProviderKey (unchanged callers)', () => {
	it('never falls back to the house key: plain resolveProviderKey keeps returning null when unresolved', async () => {
		process.env.TRIPO_API_KEY = 'house-key';
		const key = await resolveProviderKey(req(), null, 'tripo');
		expect(key).toBeNull();
	});

	it('still returns an inline/user key exactly as before', async () => {
		const key = await resolveProviderKey(req({ 'x-forge-provider-key': 'abc' }), null, 'tripo');
		expect(key).toBe('abc');
	});
});

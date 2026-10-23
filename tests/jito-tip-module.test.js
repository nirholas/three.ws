import { describe, it, expect, beforeEach } from 'vitest';
import {
	JITO_TIP_ACCOUNTS,
	checkTipAccountDrift,
	fetchLiveTipAccounts,
	getTipAccounts,
	resetTipAccountCache,
	tipAccountAt,
	tipAccountsNow,
} from '../packages/avatar-agent-mcp/src/lib/jito-tip-accounts.js';

// A Response-shaped answer from a block engine that we control per test. The
// module's contract is the getTipAccounts JSON-RPC shape, so the fake speaks it.
function engine(result, { status = 200, error } = {}) {
	const calls = [];
	const fetchImpl = async (url, init) => {
		calls.push({ url, body: JSON.parse(init.body) });
		return { ok: status < 400, status, json: async () => ({ jsonrpc: '2.0', id: 1, ...(error ? { error } : { result }) }) };
	};
	fetchImpl.calls = calls;
	return fetchImpl;
}
const down = async () => {
	throw new Error('connect ECONNREFUSED');
};

// A live set shaped like the real one with one account rotated.
const ROTATED = 'EoH2dFw7a3wYUoxHVPkB1JvWBZgn4V4DUVuYvZVz5kQp';
const LIVE_ROTATED = [...JITO_TIP_ACCOUNTS.slice(1), ROTATED];

beforeEach(() => resetTipAccountCache());

describe('fetchLiveTipAccounts', () => {
	it('calls getTipAccounts on the configured engine', async () => {
		const f = engine(JITO_TIP_ACCOUNTS);
		const got = await fetchLiveTipAccounts({ baseUrl: 'https://ny.mainnet.block-engine.jito.wtf/', fetchImpl: f });
		expect(got).toEqual(JITO_TIP_ACCOUNTS);
		expect(f.calls[0].url).toBe('https://ny.mainnet.block-engine.jito.wtf/api/v1/getTipAccounts');
		expect(f.calls[0].body.method).toBe('getTipAccounts');
	});

	it('rejects payloads that are not a list of pubkeys', async () => {
		await expect(fetchLiveTipAccounts({ fetchImpl: engine(['not-a-key']) })).rejects.toThrow(/unexpected payload/);
		await expect(fetchLiveTipAccounts({ fetchImpl: engine([]) })).rejects.toThrow(/unexpected payload/);
	});

	it('rejects an engine error and a non-2xx answer', async () => {
		await expect(fetchLiveTipAccounts({ fetchImpl: engine(null, { error: { code: -1 } }) })).rejects.toThrow(/getTipAccounts failed/);
		await expect(fetchLiveTipAccounts({ fetchImpl: engine(null, { status: 503 }) })).rejects.toThrow(/HTTP 503/);
	});

	it('refuses a plaintext engine URL', async () => {
		await expect(fetchLiveTipAccounts({ baseUrl: 'http://example.com', fetchImpl: engine([]) })).rejects.toThrow(/must be https/);
	});
});

describe('getTipAccounts', () => {
	it('serves the live list and caches it', async () => {
		const f = engine(LIVE_ROTATED);
		const first = await getTipAccounts({ fetchImpl: f });
		const second = await getTipAccounts({ fetchImpl: f });
		expect(first).toEqual({ accounts: LIVE_ROTATED, source: 'live' });
		expect(second.accounts).toEqual(LIVE_ROTATED);
		expect(f.calls).toHaveLength(1);
	});

	it('falls back to the pinned list when the engine is unreachable', async () => {
		const got = await getTipAccounts({ fetchImpl: down });
		expect(got.source).toBe('fallback');
		expect(got.accounts).toEqual(JITO_TIP_ACCOUNTS);
		expect(got.error).toMatch(/ECONNREFUSED/);
	});

	it('keeps the last good live list when a forced refresh fails', async () => {
		await getTipAccounts({ fetchImpl: engine(LIVE_ROTATED) });
		const got = await getTipAccounts({ fetchImpl: down, refresh: true });
		expect(got.source).toBe('cache');
		expect(got.accounts).toEqual(LIVE_ROTATED);
	});

	it('does not hammer a down engine', async () => {
		let n = 0;
		const counting = async () => {
			n++;
			throw new Error('down');
		};
		await getTipAccounts({ fetchImpl: counting });
		await getTipAccounts({ fetchImpl: counting });
		expect(n).toBe(1);
	});
});

describe('tipAccountsNow', () => {
	it('returns the pinned list immediately on a cold cache, then the live list once refreshed', async () => {
		const f = engine(LIVE_ROTATED);
		expect(tipAccountsNow({ fetchImpl: f })).toEqual(JITO_TIP_ACCOUNTS);
		await new Promise((r) => setTimeout(r, 0));
		expect(tipAccountsNow({ fetchImpl: f })).toEqual(LIVE_ROTATED);
		expect(f.calls).toHaveLength(1);
	});

	it('survives an unreachable engine without throwing', async () => {
		expect(tipAccountsNow({ fetchImpl: down })).toEqual(JITO_TIP_ACCOUNTS);
		await new Promise((r) => setTimeout(r, 0));
		expect(tipAccountsNow({ fetchImpl: down })).toEqual(JITO_TIP_ACCOUNTS);
	});

	it('tipAccountAt wraps around the list', () => {
		const n = JITO_TIP_ACCOUNTS.length;
		expect(tipAccountAt(0, { fetchImpl: down })).toBe(JITO_TIP_ACCOUNTS[0]);
		expect(tipAccountAt(n + 2, { fetchImpl: down })).toBe(JITO_TIP_ACCOUNTS[2]);
	});
});

describe('checkTipAccountDrift', () => {
	it('is ok when the live set matches the pin, in any order', async () => {
		const got = await checkTipAccountDrift({ fetchImpl: engine([...JITO_TIP_ACCOUNTS].reverse()) });
		expect(got).toEqual({ status: 'ok', added: [], removed: [] });
	});

	it('reports drift with exactly what changed', async () => {
		const got = await checkTipAccountDrift({ fetchImpl: engine(LIVE_ROTATED) });
		expect(got.status).toBe('drift');
		expect(got.added).toEqual([ROTATED]);
		expect(got.removed).toEqual([JITO_TIP_ACCOUNTS[0]]);
	});

	it('reports unverified when the engine is unreachable', async () => {
		const got = await checkTipAccountDrift({ fetchImpl: down });
		expect(got.status).toBe('unverified');
		expect(got.error).toMatch(/ECONNREFUSED/);
	});
});

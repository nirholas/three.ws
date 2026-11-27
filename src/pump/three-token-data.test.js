// Unit tests for the $THREE shared data store. Network is stubbed at the
// dashboard-next/api.js boundary (the only thing the store talks to), so these
// exercise state transitions, not real I/O.

import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => {
	class ApiError extends Error {
		constructor(status, code, message) {
			super(message || code || `HTTP ${status}`);
			this.name = 'ApiError';
			this.status = status;
			this.code = code;
		}
	}
	return { mockGet: vi.fn(), mockPost: vi.fn(), mockGetMe: vi.fn(), ApiError };
});

vi.mock('../dashboard-next/api.js', () => ({
	get: h.mockGet,
	post: h.mockPost,
	getMe: h.mockGetMe,
	ApiError: h.ApiError,
}));

import { createThreeTokenData, THREE_MINT } from './three-token-data.js';

const WALLET = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'; // 44-char base58, synthetic

function statsOk() {
	return {
		token: { mint: THREE_MINT, symbol: '$THREE', price_usd: 2, supply: 1000, decimals: 6, source: 'birdeye' },
		protocol: { total_agents: 5 },
		buyback: { enabled: false, commit_pct: 50, three_bought: 0, runs: 0 },
	};
}

// Default happy-path router for GET. Individual tests override as needed.
function routeGet(path) {
	if (path === '/api/three-token/stats') return Promise.resolve(statsOk());
	if (path === '/api/three-token/activity') return Promise.resolve({ events: [{ id: 'e1', type: 'payment' }] });
	if (path === '/api/three-token/burns') return Promise.resolve({ policy: 'no_platform_burns', burns: [], total_burned: 0, burn_per_deploy: 0 });
	return Promise.reject(new Error(`unexpected GET ${path}`));
}

beforeEach(() => {
	h.mockGet.mockReset();
	h.mockPost.mockReset();
	h.mockGetMe.mockReset();
	h.mockGet.mockImplementation(routeGet);
	h.mockGetMe.mockResolvedValue(null);
});

describe('createThreeTokenData — protocol/activity/burns', () => {
	it('loads protocol, activity, and burns to ok', async () => {
		const store = createThreeTokenData({ autoStart: false });
		await store.refresh();
		const s = store.getState();
		expect(s.protocol.status).toBe('ok');
		expect(s.protocol.token.mint).toBe(THREE_MINT);
		expect(s.protocol.token.price_usd).toBe(2);
		expect(s.activity.status).toBe('ok');
		expect(s.activity.events).toHaveLength(1);
		expect(s.burns.status).toBe('ok');
		expect(s.burns.total_burned).toBe(0);
		expect(s.protocol.buyback.commit_pct).toBe(50);
		store.destroy();
	});

	it('marks a field error without poisoning the others', async () => {
		h.mockGet.mockImplementation((path) => {
			if (path === '/api/three-token/activity') return Promise.reject(new Error('boom'));
			return routeGet(path);
		});
		const store = createThreeTokenData({ autoStart: false });
		await store.refresh();
		const s = store.getState();
		expect(s.activity.status).toBe('error');
		expect(s.protocol.status).toBe('ok'); // unaffected
		store.destroy();
	});
});

describe('createThreeTokenData: no holder revenue share', () => {
	it('never requests the removed revenue-share endpoint and keeps no revenueShare slice', async () => {
		h.mockGetMe.mockResolvedValue({ user_id: 'u1' });
		const store = createThreeTokenData({ autoStart: false });
		await store.refresh();
		expect(h.mockGet).not.toHaveBeenCalledWith('/api/three-token/revenue-share');
		expect(store.getState().revenueShare).toBeUndefined();
		store.destroy();
	});
});

describe('createThreeTokenData — position', () => {
	it('computes a real position for a connected holder', async () => {
		h.mockGetMe.mockResolvedValue({ wallet_address: WALLET });
		h.mockPost.mockResolvedValue({ tokens: [{ mint: THREE_MINT, amount: 100, usd: 200 }] });
		const store = createThreeTokenData({ autoStart: false });
		await store.refreshPosition();
		const p = store.getState().position;
		expect(p.status).toBe('ok');
		expect(p.wallet).toBe(WALLET);
		expect(p.amount).toBe(100);
		expect(p.usd).toBe(200);
		expect(p.pctOfSupply).toBeCloseTo(0.1); // 100 / 1000 supply
		expect(h.mockPost).toHaveBeenCalledWith('/api/wallet/balances', { chain: 'solana', address: WALLET });
		store.destroy();
	});

	it('reports zero when the wallet holds no $THREE', async () => {
		h.mockGetMe.mockResolvedValue({ wallet_address: WALLET });
		h.mockPost.mockResolvedValue({ tokens: [{ mint: 'SomeOtherMint1111111111111111111111111111111', amount: 5, usd: 9 }] });
		const store = createThreeTokenData({ autoStart: false });
		await store.refreshPosition();
		const p = store.getState().position;
		expect(p.status).toBe('zero');
		expect(p.amount).toBe(0);
		store.destroy();
	});

	it('reports unauthenticated when there is no session', async () => {
		h.mockGetMe.mockResolvedValue(null);
		const store = createThreeTokenData({ autoStart: false });
		await store.refreshPosition();
		expect(store.getState().position.status).toBe('unauthenticated');
		expect(h.mockPost).not.toHaveBeenCalled();
		store.destroy();
	});

	it('reports no_wallet when signed in without a Solana address', async () => {
		h.mockGetMe.mockResolvedValue({ wallet_address: '0xabc0000000000000000000000000000000000000' }); // EVM, not base58 Solana
		const store = createThreeTokenData({ autoStart: false });
		await store.refreshPosition();
		expect(store.getState().position.status).toBe('no_wallet');
		store.destroy();
	});

	it('uses an explicit wallet override and refreshes on setWallet', async () => {
		h.mockPost.mockResolvedValue({ tokens: [{ mint: THREE_MINT, amount: 50, usd: 100 }] });
		const store = createThreeTokenData({ autoStart: false });
		store.setWallet(WALLET); // schedules a refreshPosition
		await new Promise((r) => setTimeout(r, 0));
		await store.refreshPosition();
		expect(store.getState().position.status).toBe('ok');
		expect(h.mockGetMe).not.toHaveBeenCalled(); // override skips session resolution
		store.destroy();
	});
});

describe('createThreeTokenData — store mechanics', () => {
	it('pushes the current snapshot to a new subscriber and on updates', async () => {
		const store = createThreeTokenData({ autoStart: false });
		const seen = [];
		const unsub = store.subscribe((s) => seen.push(s.protocol.status));
		expect(seen[0]).toBe('loading'); // immediate snapshot
		await store.refresh();
		expect(seen.at(-1)).toBe('ok');
		unsub();
		store.destroy();
	});

	it('stops emitting after destroy', async () => {
		const store = createThreeTokenData({ autoStart: false });
		let calls = 0;
		store.subscribe(() => { calls++; });
		const baseline = calls;
		store.destroy();
		await store.refresh(); // patches are no-ops after destroy
		expect(calls).toBe(baseline);
	});
});

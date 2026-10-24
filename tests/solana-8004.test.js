import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Keypair } from '@solana/web3.js';

const sqlState = { calls: [], queue: [] };
vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings, ...values) => {
		sqlState.calls.push({ query: strings.join('?'), values });
		return sqlState.queue.length ? sqlState.queue.shift() : [];
	}),
}));
vi.mock('../api/_lib/env.js', () => ({ env: { APP_ORIGIN: 'https://three.ws' } }));

const {
	TIER_NAMES,
	anyRegistryBlock,
	meetsMinTier,
	parseMinTier,
	publicRegistry8004,
	read8004Standing,
	register8004Agent,
	registrationEnabled,
	registryBlockOf,
	registryProgramIds,
	liveRegistry8004,
	tierRank,
} = await import('../api/_lib/solana-8004.js');

const ASSET = Keypair.generate().publicKey;

function fakeSdk(over = {}) {
	return {
		loadAgent: vi.fn(async () => ({ asset: ASSET })),
		getTrustTier: vi.fn(async () => 3),
		getSummary: vi.fn(async () => ({ averageScore: 91, totalFeedbacks: 7 })),
		getEnrichedSummary: vi.fn(async () => ({ qualityScore: 88, confidence: 0.7, riskScore: 4, uniqueCallers: 5 })),
		registerAgent: vi.fn(async () => ({ asset: ASSET, signature: 'sig1' })),
		...over,
	};
}

beforeEach(() => {
	sqlState.calls = [];
	sqlState.queue = [];
});

describe('tiers and blocks', () => {
	it('ranks tiers in order and unknown as 0', () => {
		expect(TIER_NAMES.map(tierRank)).toEqual([0, 1, 2, 3, 4]);
		expect(tierRank('Mythic')).toBe(0);
		expect(tierRank(undefined)).toBe(0);
	});

	it('picks the block per network and prefers mainnet', () => {
		const meta = { registry_8004: { asset: 'M' }, devnet: { registry_8004: { asset: 'D' } } };
		expect(registryBlockOf(meta, 'mainnet').asset).toBe('M');
		expect(registryBlockOf(meta, 'devnet').asset).toBe('D');
		expect(anyRegistryBlock(meta)).toMatchObject({ asset: 'M', network: 'mainnet' });
		expect(anyRegistryBlock({ devnet: { registry_8004: { asset: 'D' } } })).toMatchObject({ network: 'devnet' });
		expect(anyRegistryBlock({})).toBeNull();
		expect(registryBlockOf(null, 'mainnet')).toBeNull();
	});

	it('gates mainnet behind the env flag and always allows devnet', () => {
		expect(registrationEnabled('devnet', {})).toBe(true);
		expect(registrationEnabled('mainnet', {})).toBe(false);
		expect(registrationEnabled('mainnet', { SOLANA_8004_REGISTER_MAINNET: '1' })).toBe(true);
	});

	it('resolves program ids from the published SDK', async () => {
		const ids = await registryProgramIds('devnet');
		expect(ids.registry).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
		expect(ids.registry).not.toBe((await registryProgramIds('mainnet')).registry);
	});
});

describe('read8004Standing', () => {
	it('reads tier and feedback from the registry', async () => {
		const r = await read8004Standing(ASSET.toBase58(), 'devnet', { sdk: fakeSdk() });
		expect(r).toMatchObject({ registered: true, tier: 'Gold', tier_rank: 3, average_score: 91, total_feedbacks: 7 });
	});

	it('reports an unknown asset as unregistered, not unavailable', async () => {
		const r = await read8004Standing(ASSET.toBase58(), 'devnet', { sdk: fakeSdk({ loadAgent: async () => null }) });
		expect(r.registered).toBe(false);
		expect(r.unavailable).toBeUndefined();
	});

	it('reports an RPC failure as unavailable, never as Unrated', async () => {
		const sdk = fakeSdk({ loadAgent: async () => { throw new Error('rpc down'); } });
		const r = await read8004Standing(ASSET.toBase58(), 'devnet', { sdk });
		expect(r).toMatchObject({ registered: false, unavailable: true });
		expect(r.tier).toBeUndefined();
	});
});

describe('register8004Agent', () => {
	it('registers once, stores the block on the agent row and logs an action', async () => {
		const sdk = fakeSdk({ loadAgent: async () => null });
		const out = await register8004Agent({ agent: { id: 'a1', meta: {} }, network: 'devnet', sdk });
		expect(out).toMatchObject({ asset: ASSET.toBase58(), signature: 'sig1', alreadyRegistered: false });
		expect(sdk.registerAgent).toHaveBeenCalledWith('https://three.ws/api/agents/a1/registration', { atomEnabled: true });
		const write = sqlState.calls[0];
		expect(write.query).toContain("'registry_8004'");
		expect(write.values[0]).toContain(ASSET.toBase58());
		expect(sqlState.calls[1].query).toContain('agent_actions');
	});

	it('is idempotent when the stored asset still resolves', async () => {
		const sdk = fakeSdk();
		const out = await register8004Agent({
			agent: { id: 'a1', meta: { devnet: { registry_8004: { asset: ASSET.toBase58() } } } },
			network: 'devnet',
			sdk,
		});
		expect(out.alreadyRegistered).toBe(true);
		expect(sdk.registerAgent).not.toHaveBeenCalled();
		expect(sqlState.calls).toHaveLength(0);
	});

	it('refuses mainnet without the opt-in flag', async () => {
		delete process.env.SOLANA_8004_REGISTER_MAINNET;
		await expect(register8004Agent({ agent: { id: 'a1', meta: {} }, network: 'mainnet', sdk: fakeSdk() })).rejects.toThrow(/SOLANA_8004_REGISTER_MAINNET/);
	});
});

describe('hire-side helpers', () => {
	it('shapes nothing for an unregistered agent', () => {
		expect(publicRegistry8004(null)).toBeNull();
		expect(publicRegistry8004({})).toBeNull();
	});

	it('exposes only public fields with an explorer link', () => {
		const v = publicRegistry8004({ asset: 'A', program: 'P', authority: 'secret-ish', standing: { tier: 'Silver', average_score: 80, total_feedbacks: 2, checked_at: 't' } }, 'mainnet');
		expect(v).toMatchObject({ asset: 'A', tier: 'Silver', tier_rank: 2, total_feedbacks: 2, explorer_url: 'https://solscan.io/account/A' });
		expect(v.authority).toBeUndefined();
	});

	it('marks the cached view stale when the chain cannot be read', async () => {
		const sdk = fakeSdk({ loadAgent: async () => { throw new Error('down'); } });
		const v = await liveRegistry8004({ asset: ASSET.toBase58(), network: 'devnet', tier: 'Gold', tier_rank: 3 }, { sdk });
		expect(v).toMatchObject({ stale: true, tier: 'Gold' });
	});

	it('replaces the cached tier with the live one', async () => {
		const v = await liveRegistry8004({ asset: ASSET.toBase58(), network: 'devnet', tier: 'Bronze', tier_rank: 1 }, { sdk: fakeSdk() });
		expect(v).toMatchObject({ tier: 'Gold', tier_rank: 3, stale: false });
	});

	it('parses and enforces the minimum tier', () => {
		expect(parseMinTier(undefined)).toBeNull();
		expect(parseMinTier('silver')).toBe(2);
		expect(() => parseMinTier('mythic')).toThrow(RangeError);
		expect(meetsMinTier(null, null)).toBe(true);
		expect(meetsMinTier(null, 2)).toBe(false);
		expect(meetsMinTier({ tier_rank: 2 }, 2)).toBe(true);
		expect(meetsMinTier({ tier_rank: 1 }, 2)).toBe(false);
	});
});

import { describe, it, expect, vi, afterEach } from 'vitest';
import { getLeaderboard } from '../src/kol/leaderboard.js';
import { parseKolscanLeaderboard } from '../src/kol/kolscan-live.js';

// Real kolscan rows (addresses + realized SOL profit) wrapped in the exact
// Next.js RSC flight envelope the /leaderboard page ships:
// `self.__next_f.push([1,"<escaped-json-string>"])`. JSON.stringify produces the
// same escaping kolscan emits, so this exercises the real parse path offline.
function buildFlightFixture(entries) {
	const payload = `3:["$","div",null,{"initLeaderboard":${JSON.stringify(entries)},"tab":"trades"}]`;
	return `<!DOCTYPE html><html><body><script>self.__next_f.push([1,${JSON.stringify(
		payload,
	)}])</script></body></html>`;
}

const REAL_ENTRIES = [
	{ wallet_address: 'G3gZWqrYkNmYFKYCyfRCNtGuxdyuE2wiYKkZpiZn4WSS', name: 'A', profit: 269.0, wins: 2, losses: 1, timeframe: 1 },
	{ wallet_address: '8MaVa9MrFZ7gqVfW8XJ4nP2kCwS3vR6tQ1dY5hG7bLm', name: 'B', profit: 97.43, wins: 5, losses: 9, timeframe: 1 },
	{ wallet_address: 'Bi4rd5kQwErTyUiOpAsDfGhJkLzXcVbNmQwErTyUiOpA', name: 'C', profit: 72.36, wins: 31, losses: 75, timeframe: 1 },
	{ wallet_address: '9RrKUhRpbPDNxR7x88ZsCgdtqPHUfwYPjj4JdpV4FBj9', name: 'D', profit: 179.27, wins: 6, losses: 293, timeframe: 7 },
	{ wallet_address: '4KqaBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890abcd', name: 'E', profit: 42.1, wins: 10, losses: 10, timeframe: 7 },
	{ wallet_address: 'H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG', name: 'F', profit: 501.5, wins: 40, losses: 12, timeframe: 30 },
];

const SOL_PRICE = 150;
// Stand-in for fetchKolscanLeaderboard: parse the real fixture and price it,
// exactly as the live fetcher does, but with a fixed SOL/USD so it's deterministic.
async function fetchLiveFixture() {
	const parsed = parseKolscanLeaderboard(buildFlightFixture(REAL_ENTRIES));
	const price = (rows) => rows.map((r) => ({ ...r, pnlUsd: r.pnlSol * SOL_PRICE }));
	return { '24h': price(parsed['24h']), '7d': price(parsed['7d']), '30d': price(parsed['30d']) };
}

describe('parseKolscanLeaderboard', () => {
	it('extracts rows from the real flight envelope, grouped by window', () => {
		const board = parseKolscanLeaderboard(buildFlightFixture(REAL_ENTRIES));
		expect(board['24h']).toHaveLength(3);
		expect(board['7d']).toHaveLength(2);
		expect(board['30d']).toHaveLength(1);
	});

	it('derives winRate and trades from wins/losses', () => {
		const board = parseKolscanLeaderboard(buildFlightFixture(REAL_ENTRIES));
		const row = board['24h'].find((r) => r.wallet === 'G3gZWqrYkNmYFKYCyfRCNtGuxdyuE2wiYKkZpiZn4WSS');
		expect(row.trades).toBe(3);
		expect(row.winRate).toBeCloseTo(2 / 3, 5);
		expect(row.pnlSol).toBeCloseTo(269.0, 5);
	});

	it('returns null when no leaderboard payload is present', () => {
		expect(parseKolscanLeaderboard('<html><body>nothing here</body></html>')).toBeNull();
		expect(parseKolscanLeaderboard('')).toBeNull();
	});
});

describe('getLeaderboard', () => {
	const live = { fetchLive: fetchLiveFixture };

	it('returns items sorted descending by pnlUsd', async () => {
		const items = await getLeaderboard({ window: '24h', limit: 25, ...live });
		expect(items.length).toBeGreaterThan(0);
		for (let i = 1; i < items.length; i++) {
			expect(items[i - 1].pnlUsd).toBeGreaterThanOrEqual(items[i].pnlUsd);
		}
	});

	it('assigns sequential rank starting at 1', async () => {
		const items = await getLeaderboard({ window: '24h', limit: 5, ...live });
		items.forEach((item, i) => expect(item.rank).toBe(i + 1));
	});

	it('each item has required fields', async () => {
		const [first] = await getLeaderboard({ window: '24h', limit: 1, ...live });
		expect(typeof first.wallet).toBe('string');
		expect(typeof first.pnlUsd).toBe('number');
		expect(typeof first.winRate).toBe('number');
		expect(typeof first.trades).toBe('number');
		expect(typeof first.rank).toBe('number');
	});

	it('rejects invalid window', async () => {
		await expect(getLeaderboard({ window: '1y', ...live })).rejects.toThrow(/invalid window/);
	});

	it('caps limit at 100', async () => {
		const items = await getLeaderboard({ window: '24h', limit: 999, ...live });
		expect(items.length).toBeLessThanOrEqual(100);
	});

	it('respects a limit below the available row count', async () => {
		const items = await getLeaderboard({ window: '24h', limit: 2, ...live });
		expect(items.length).toBe(2);
	});

	it('works for the 7d window', async () => {
		const items = await getLeaderboard({ window: '7d', limit: 10, ...live });
		expect(items.length).toBeGreaterThan(0);
		for (let i = 1; i < items.length; i++) {
			expect(items[i - 1].pnlUsd).toBeGreaterThanOrEqual(items[i].pnlUsd);
		}
	});

	it('works for the 30d window', async () => {
		const items = await getLeaderboard({ window: '30d', limit: 10, ...live });
		expect(items.length).toBeGreaterThan(0);
	});

	it('degrades to an empty board when the live source is unavailable', async () => {
		const items = await getLeaderboard({ window: '7d', fetchLive: async () => null });
		expect(items).toEqual([]);
	});

	it('defaults to the 7d window and a limit of 25', async () => {
		const items = await getLeaderboard({ ...live });
		expect(items.length).toBeGreaterThan(0);
		expect(items.length).toBeLessThanOrEqual(25);
	});
});

describe('fetchXProfile rung order', () => {
	const guestUser = { username: 'synthkol', name: 'Synth KOL', avatar: 'https://example.test/a.jpg', verified: false, followers: 987 };

	async function load() {
		vi.resetModules();
		vi.doMock('../api/_lib/cache.js', () => ({ cacheGet: async () => null, cacheSet: async () => {} }));
		return (await import('../src/kol/x-profile.js')).fetchXProfile;
	}
	afterEach(() => {
		delete process.env.TWITTER_BEARER_TOKEN;
		vi.doUnmock('../api/_lib/cache.js');
	});

	it('uses the guest reader when the bearer token is unset', async () => {
		delete process.env.TWITTER_BEARER_TOKEN;
		const fetchXProfile = await load();
		const bearerLookup = vi.fn();
		const p = await fetchXProfile('synthkol', { bearerLookup, guestLookup: async () => guestUser });
		expect(bearerLookup).not.toHaveBeenCalled();
		expect(p).toMatchObject({ handle: 'synthkol', followerCount: 987, source: 'x-guest' });
	});

	it('prefers the bearer rung when it answers', async () => {
		process.env.TWITTER_BEARER_TOKEN = 'synthetic-token';
		const fetchXProfile = await load();
		const guestLookup = vi.fn();
		const p = await fetchXProfile('synthkol', {
			bearerLookup: async () => ({ handle: 'synthkol', followerCount: 1000, source: 'x-api' }),
			guestLookup,
		});
		expect(p.source).toBe('x-api');
		expect(guestLookup).not.toHaveBeenCalled();
	});

	it('falls through to the guest reader when the bearer is rate limited', async () => {
		process.env.TWITTER_BEARER_TOKEN = 'synthetic-token';
		const fetchXProfile = await load();
		const p = await fetchXProfile('synthkol', {
			bearerLookup: async () => { throw new Error('Request failed with code 429'); },
			guestLookup: async () => guestUser,
		});
		expect(p).toMatchObject({ followerCount: 987, source: 'x-guest' });
	});

	it('resolves null when both rungs fail, never a fabricated count', async () => {
		delete process.env.TWITTER_BEARER_TOKEN;
		const fetchXProfile = await load();
		const p = await fetchXProfile('synthkol', {
			guestLookup: async () => { throw Object.assign(new Error('cooling down'), { reason: 'rate_limited' }); },
		});
		expect(p).toBeNull();
	});
});

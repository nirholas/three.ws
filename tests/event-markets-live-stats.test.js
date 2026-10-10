/** Pulse and trending reads for Event Markets: shape, windows, empty platform. */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queries = [];
let results = [];
vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings, ...values) => { queries.push({ text: strings.join(' ? '), values }); return results.shift() ?? []; }),
}));

const { pulseEventMarkets, trendingEventMarkets } = await import('../api/_lib/event-markets/live-stats.js');

beforeEach(() => { queries.length = 0; results = []; });

describe('pulseEventMarkets', () => {
	it('reports live count, biggest mover and closing soon', async () => {
		results = [
			[{ n: 3 }],
			[{ slug: 'derby', title: 'Derby', outcome_label: 'Nova', share_from: '0.3', share_to: '0.41', delta_points: '11', window_seconds: 600, created_at: '2026-10-10T10:00:00Z' }],
			[{ slug: 'cup', title: 'Cup', locks_at: '2026-10-10T12:00:00Z', pick_count: 4 }],
		];
		const out = await pulseEventMarkets();
		expect(out.live_count).toBe(3);
		expect(out.biggest_mover).toMatchObject({ slug: 'derby', outcome: 'Nova', delta_points: 11, share_to: 0.41, market_url: 'https://three.ws/event-markets/derby' });
		expect(out.closing_soon).toEqual([expect.objectContaining({ slug: 'cup', pick_count: 4 })]);
		expect(queries.some((q) => /from event_market_moves/.test(q.text))).toBe(true);
	});
	it('returns honest zeros on a quiet platform', async () => {
		results = [[{ n: 0 }], [], []];
		expect(await pulseEventMarkets()).toEqual({ live_count: 0, biggest_mover: null, closing_soon: [] });
	});
});

describe('trendingEventMarkets', () => {
	it('ranks open markets by picks in the configured window, never naming pickers', async () => {
		results = [[{ slug: 'a', title: 'A', locks_at: 'x', picks_in_window: 9 }, { slug: 'b', title: 'B', locks_at: 'y', picks_in_window: 2 }]];
		const out = await trendingEventMarkets(5);
		expect(out.map((r) => [r.rank, r.slug, r.picks_in_window])).toEqual([[1, 'a', 9], [2, 'b', 2]]);
		expect(out[0].window_minutes).toBe(60);
		expect(queries[0].text).toMatch(/kind = 'pick'/);
		expect(queries[0].text).not.toMatch(/user_id|wallet/);
		expect(queries[0].values).toContain(60);
	});
	it('is empty when nothing was picked', async () => {
		expect(await trendingEventMarkets()).toEqual([]);
	});
});

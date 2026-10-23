import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('../api/_lib/db.js', async () => {
	const actual = await vi.importActual('../api/_lib/db.js');
	return { sqlValues: actual.sqlValues, sql: sqlMock, isDbUnavailableError: () => false, isDbCapacityError: () => false };
});
const scoreRowsBySpace = vi.fn();
vi.mock('../api/_lib/embeddings.js', () => ({
	embeddingsConfigured: () => true,
	defaultIngestEmbedderTag: () => 'nvidia/nv-embedqa-e5-v5@1024',
	embedPassages: vi.fn(),
	scoreRowsBySpace: (...a) => scoreRowsBySpace(...a),
}));

const { outcomeWeight, MIN_WEIGHT, MAX_WEIGHT } = await import('../api/_lib/memory-outcomes.js');
const { searchMemories } = await import('../api/_lib/memory-store.js');

const NOW = Date.UTC(2026, 9, 23);
const daysAgo = (d) => new Date(NOW - d * 86_400_000).toISOString();

describe('outcomeWeight', () => {
	it('is exactly neutral with no outcomes', () => {
		expect(outcomeWeight([], NOW)).toMatchObject({ weight: 1, samples: 0 });
	});

	it('rewards wins and demotes losses, but never reaches zero', () => {
		const win = outcomeWeight([{ pnl_usd: 120, win: true, closed_at: daysAgo(1) }], NOW);
		const loss = outcomeWeight([{ pnl_usd: -120, win: false, closed_at: daysAgo(1) }], NOW);
		expect(win.weight).toBeGreaterThan(1);
		expect(loss.weight).toBeLessThan(1);
		expect(loss.weight).toBeGreaterThan(0);
		const disaster = outcomeWeight(Array.from({ length: 50 }, () => ({ pnl_usd: -1e6, win: false, closed_at: daysAgo(0) })), NOW);
		expect(disaster.weight).toBeGreaterThanOrEqual(MIN_WEIGHT);
		const jackpot = outcomeWeight(Array.from({ length: 50 }, () => ({ pnl_usd: 1e6, win: true, closed_at: daysAgo(0) })), NOW);
		expect(jackpot.weight).toBeLessThanOrEqual(MAX_WEIGHT);
	});

	it('decays toward neutral as an outcome ages', () => {
		const fresh = outcomeWeight([{ pnl_usd: -100, win: false, closed_at: daysAgo(1) }], NOW).weight;
		const old = outcomeWeight([{ pnl_usd: -100, win: false, closed_at: daysAgo(400) }], NOW).weight;
		expect(old).toBeGreaterThan(fresh);
		expect(old).toBeLessThan(1);
	});

	it('uses win/loss alone when the outcome is unpriced', () => {
		const r = outcomeWeight([{ pnl_usd: null, win: false, closed_at: daysAgo(1) }], NOW);
		expect(r.weight).toBeLessThan(1);
		expect(r.losses).toBe(1);
		expect(r.net_pnl_usd).toBe(0);
	});
});

describe('searchMemories outcome weighting', () => {
	let queue;
	beforeEach(() => {
		queue = [];
		sqlMock.mockReset();
		sqlMock.mockImplementation(() => Promise.resolve(queue.length ? queue.shift() : []));
		scoreRowsBySpace.mockReset();
	});

	const base = { type: 'project', tags: [], context: {}, salience: 0.5, tier: 'recall', embedder: 'e', embedding: [1], created_at: new Date() };

	it('ranks a memory tied to a loss below an otherwise equal win, yet still returns it', async () => {
		queue.push([]); // ensureEmbeddings
		queue.push([{ id: 'loss', content: 'bought the breakout', ...base }, { id: 'win', content: 'bought the dip', ...base }]);
		queue.push([
			{ memory_id: 'loss', pnl_usd: -200, win: false, closed_at: new Date() },
			{ memory_id: 'win', pnl_usd: 200, win: true, closed_at: new Date() },
		]);
		scoreRowsBySpace.mockResolvedValue({
			scored: [
				{ ...base, id: 'loss', content: 'bought the breakout', score: 0.8 },
				{ ...base, id: 'win', content: 'bought the dip', score: 0.8 },
			],
			needsReembed: [],
		});
		const out = await searchMemories('agent1', 'what worked', { topK: 5, minScore: 0.25, bump: false });
		expect(out.results.map((r) => r.id)).toEqual(['win', 'loss']);
		const [win, loss] = out.results;
		expect(win.outcome.weight).toBeGreaterThan(1);
		expect(loss.outcome.weight).toBeLessThan(1);
		expect(loss.outcome).toMatchObject({ samples: 1, losses: 1, wins: 0 });
		expect(win.rankScore).toBeGreaterThan(loss.rankScore);
		expect(loss.rankScore).toBeGreaterThan(0);
		expect(win.score).toBe(0.8);
		expect(loss.score).toBe(0.8);
	});

	it('stays unweighted when the outcomes read fails', async () => {
		queue.push([]);
		queue.push([{ id: 'a', content: 'watchlist', ...base }]);
		let n = 0;
		sqlMock.mockImplementation(() => {
			n++;
			if (n === 3) return Promise.reject(new Error('relation "memory_outcomes" does not exist'));
			return Promise.resolve(queue.length ? queue.shift() : []);
		});
		scoreRowsBySpace.mockResolvedValue({ scored: [{ ...base, id: 'a', content: 'watchlist', score: 0.7 }], needsReembed: [] });
		const out = await searchMemories('agent1', 'watchlist', { bump: false });
		expect(out.results[0].outcome.weight).toBe(1);
	});
});

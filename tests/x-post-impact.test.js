import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

const { correlateXPost } = await import('../src/social/x-post-impact.js');

// ── helpers ────────────────────────────────────────────────────────────────

function quoteRes(tokensOut, realSolLamports) {
	return {
		ok: true,
		json: async () => ({
			quote: { tokens_out: tokensOut.toString() },
			bonding_curve: { real_sol_reserves: realSolLamports.toString() },
		}),
	};
}

function synRes(author, text, extra = {}) {
	return {
		ok: true,
		status: 200,
		text: async () =>
			JSON.stringify({
				text,
				created_at: '2026-10-01T12:00:00.000Z',
				favorite_count: 42,
				conversation_count: 7,
				user: { name: author, screen_name: author },
				mediaDetails: [],
				...extra,
			}),
	};
}

const down = { ok: false, status: 500, text: async () => '' };

// Route by URL so the post reader's three rungs and the two quote calls stay independent.
function route({ post, quotes }) {
	let q = 0;
	fetchMock.mockImplementation(async (url) => {
		const u = String(url);
		if (u.includes('/api/pump/quote')) return quotes[q++] ?? quotes[quotes.length - 1];
		return typeof post === 'function' ? post(u) : post;
	});
}

// ── tests ──────────────────────────────────────────────────────────────────

describe('correlateXPost', () => {
	beforeEach(() => fetchMock.mockReset());

	it('computes positive deltaPct when price increases and returns metrics', async () => {
		// before: 1/10000 SOL per token; after: 1/9000 → +11.1%
		route({
			post: synRes('alice', 'moon soon'),
			quotes: [quoteRes(10000, 50_000_000_000), quoteRes(9000, 55_000_000_000)],
		});

		const r = await correlateXPost({
			postUrl: 'https://x.com/alice/status/1894000000000000000',
			mint: 'ValidMintAddress',
		});

		expect(r.post?.author).toBe('alice');
		expect(r.post?.text).toBe('moon soon');
		expect(r.post?.metrics.likes).toBe(42);
		expect(r.post?.metrics.replies).toBe(7);
		expect(r.priceBefore).toBeCloseTo(1 / 10000, 8);
		expect(r.priceAfter).toBeCloseTo(1 / 9000, 8);
		const expectedDelta = ((1 / 9000 - 1 / 10000) / (1 / 10000)) * 100;
		expect(r.deltaPct).toBeCloseTo(expectedDelta, 4);
		expect(r.volBefore).toBeCloseTo(50, 3);
		expect(r.volAfter).toBeCloseTo(55, 3);
		expect(r.deltaVolPct).toBeCloseTo(10, 2);
	});

	it('computes negative deltaPct when price drops', async () => {
		route({
			post: synRes('bob', 'dump incoming'),
			quotes: [quoteRes(9000, 50_000_000_000), quoteRes(10000, 45_000_000_000)],
		});

		const r = await correlateXPost({ postUrl: 'https://x.com/bob/status/999', mint: 'ValidMintAddress' });

		expect(r.deltaPct).toBeLessThan(0);
		expect(r.deltaVolPct).toBeLessThan(0);
	});

	it('returns post=null when every post rung fails mid-body, still computes price delta', async () => {
		route({
			post: { ok: true, status: 200, text: async () => '{not json' },
			quotes: [quoteRes(10000, 50_000_000_000), quoteRes(10000, 50_000_000_000)],
		});

		const r = await correlateXPost({ postUrl: 'https://x.com/anon/status/1', mint: 'ValidMintAddress' });

		expect(r.post).toBeNull();
		expect(r.deltaPct).toBeCloseTo(0, 5);
		expect(r.priceBefore).not.toBeNull();
	});

	it('returns post=null when every post rung is non-ok, still computes prices', async () => {
		route({
			post: down,
			quotes: [quoteRes(10000, 50_000_000_000), quoteRes(8000, 60_000_000_000)],
		});

		const r = await correlateXPost({ postUrl: 'https://x.com/anon/status/2', mint: 'ValidMintAddress' });

		expect(r.post).toBeNull();
		expect(r.deltaPct).toBeGreaterThan(0);
	});

	it('throws with "unknown mint" when price fetch fails', async () => {
		route({ post: down, quotes: [{ ok: false, status: 400 }] });

		await expect(
			correlateXPost({ postUrl: 'https://x.com/a/status/1', mint: 'badmint' }),
		).rejects.toThrow(/unknown mint/);
	});

	it('derives ts from the post created_at and keeps the post id', async () => {
		const id = '1894000000000000000';
		route({
			post: synRes('carol', 'gm'),
			quotes: [quoteRes(10000, 50_000_000_000)],
		});

		const r = await correlateXPost({
			postUrl: `https://x.com/carol/status/${id}`,
			mint: 'ValidMintAddress',
		});

		expect(r.post?.id).toBe(id);
		expect(r.post.ts).toBe(Date.parse('2026-10-01T12:00:00.000Z'));
	});
});

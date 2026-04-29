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

function oembedRes(author, text) {
	return {
		ok: true,
		json: async () => ({ author_name: author, html: `<blockquote>${text}</blockquote>` }),
	};
}

// ── tests ──────────────────────────────────────────────────────────────────

describe('correlateXPost', () => {
	beforeEach(() => fetchMock.mockReset());

	it('computes positive deltaPct when price increases', async () => {
		// before: 1/10000 SOL per token; after: 1/9000 → +11.1%
		fetchMock
			.mockResolvedValueOnce(oembedRes('alice', 'moon soon'))
			.mockResolvedValueOnce(quoteRes(10000, 50_000_000_000))
			.mockResolvedValueOnce(quoteRes(9000, 55_000_000_000));

		const r = await correlateXPost({
			postUrl: 'https://x.com/alice/status/1894000000000000000',
			mint: 'ValidMintAddress',
		});

		expect(r.post?.author).toBe('alice');
		expect(r.post?.text).toBe('moon soon');
		expect(r.priceBefore).toBeCloseTo(1 / 10000, 8);
		expect(r.priceAfter).toBeCloseTo(1 / 9000, 8);
		const expectedDelta = ((1 / 9000 - 1 / 10000) / (1 / 10000)) * 100;
		expect(r.deltaPct).toBeCloseTo(expectedDelta, 4);
		expect(r.volBefore).toBeCloseTo(50, 3);
		expect(r.volAfter).toBeCloseTo(55, 3);
		expect(r.deltaVolPct).toBeCloseTo(10, 2);
	});

	it('computes negative deltaPct when price drops', async () => {
		// before: 1/9000; after: 1/10000 → negative delta
		fetchMock
			.mockResolvedValueOnce(oembedRes('bob', 'dump incoming'))
			.mockResolvedValueOnce(quoteRes(9000, 50_000_000_000))
			.mockResolvedValueOnce(quoteRes(10000, 45_000_000_000));

		const r = await correlateXPost({
			postUrl: 'https://x.com/bob/status/999',
			mint: 'ValidMintAddress',
		});

		expect(r.deltaPct).toBeLessThan(0);
		expect(r.deltaVolPct).toBeLessThan(0);
	});

	it('returns post=null when oEmbed throws, still computes price delta', async () => {
		fetchMock
			.mockRejectedValueOnce(new Error('network error'))
			.mockResolvedValueOnce(quoteRes(10000, 50_000_000_000))
			.mockResolvedValueOnce(quoteRes(10000, 50_000_000_000));

		const r = await correlateXPost({
			postUrl: 'https://x.com/anon/status/1',
			mint: 'ValidMintAddress',
		});

		expect(r.post).toBeNull();
		expect(r.deltaPct).toBeCloseTo(0, 5);
		expect(r.priceBefore).not.toBeNull();
	});

	it('returns post=null when oEmbed returns non-ok, still computes prices', async () => {
		fetchMock
			.mockResolvedValueOnce({ ok: false })
			.mockResolvedValueOnce(quoteRes(10000, 50_000_000_000))
			.mockResolvedValueOnce(quoteRes(8000, 60_000_000_000));

		const r = await correlateXPost({
			postUrl: 'https://x.com/anon/status/2',
			mint: 'ValidMintAddress',
		});

		expect(r.post).toBeNull();
		expect(r.deltaPct).toBeGreaterThan(0);
	});

	it('throws with "unknown mint" when price fetch fails', async () => {
		fetchMock
			.mockResolvedValueOnce({ ok: false })
			.mockResolvedValueOnce({ ok: false, status: 400 });

		await expect(
			correlateXPost({ postUrl: 'https://x.com/a/status/1', mint: 'badmint' }),
		).rejects.toThrow(/unknown mint/);
	});

	it('extracts post id and derives ts from tweet snowflake id', async () => {
		const id = '1894000000000000000';
		fetchMock
			.mockResolvedValueOnce(oembedRes('carol', 'gm'))
			.mockResolvedValueOnce(quoteRes(10000, 50_000_000_000))
			.mockResolvedValueOnce(quoteRes(10000, 50_000_000_000));

		const r = await correlateXPost({
			postUrl: `https://x.com/carol/status/${id}`,
			mint: 'ValidMintAddress',
		});

		expect(r.post?.id).toBe(id);
		expect(typeof r.post?.ts).toBe('number');
		expect(r.post.ts).toBeGreaterThan(0);
	});
});

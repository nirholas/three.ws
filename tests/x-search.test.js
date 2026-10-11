/**
 * X search failover: the app-only bearer rung (api/_lib/x-search.js, private
 * searchViaBearer) and the xAI x_search rung added as a second, independent
 * path to the same data (searchViaXai, reached through searchMintPostsDetailed
 * / searchMintPosts). Covers the pure parsing of both rungs' payloads, the
 * orchestrator's failover between them, the citation check that keeps a
 * fabricated post from being believed, and the daily cap that stops the xAI
 * rung once reached. Payloads are captured, real-shaped fixtures, not live
 * responses.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const cache = new Map();

vi.mock('../api/_lib/cache.js', () => ({
	cacheGet: vi.fn((key) => Promise.resolve(cache.has(key) ? cache.get(key) : null)),
	cacheSet: vi.fn((key, value) => { cache.set(key, value); return Promise.resolve(); }),
}));

const xs = await import('../api/_lib/x-search.js');

const MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';

beforeEach(() => {
	cache.clear();
	xs._resetXSearch();
	vi.clearAllMocks();
});

function responsesBody(jsonText, { citations = [] } = {}) {
	return {
		id: 'resp_1',
		status: 'completed',
		citations,
		output: [{ type: 'message', content: [{ type: 'output_text', text: jsonText, annotations: [] }] }],
	};
}

function postsJson(posts) {
	return JSON.stringify({ posts });
}

// --- responseText ------------------------------------------------------------

describe('responseText', () => {
	it('joins text parts across every output message', () => {
		const payload = {
			output: [
				{ type: 'message', content: [{ type: 'output_text', text: '{"posts":[' }] },
				{ type: 'message', content: [{ type: 'output_text', text: ']}' }] },
			],
		};
		expect(xs.responseText(payload)).toBe('{"posts":[]}');
	});

	it('returns empty string for a malformed body', () => {
		expect(xs.responseText({})).toBe('');
		expect(xs.responseText(null)).toBe('');
	});

	it('prefers the top-level output_text field when present', () => {
		expect(xs.responseText({ output_text: 'hi' })).toBe('hi');
	});
});

// --- citedPostIds -------------------------------------------------------------

describe('citedPostIds', () => {
	it('collects ids from the top-level citations list', () => {
		const ids = xs.citedPostIds({ citations: ['https://x.com/alice/status/55500'] });
		expect(ids.has('55500')).toBe(true);
	});

	it('collects ids from url_citation annotations on message output', () => {
		const body = {
			output: [{
				type: 'message',
				content: [{ type: 'output_text', text: '{}', annotations: [{ url: 'https://x.com/bob/status/42000' }] }],
			}],
		};
		expect(xs.citedPostIds(body).has('42000')).toBe(true);
	});

	it('scans non-message output items for an x.com status url', () => {
		const body = { output: [{ type: 'tool_call', url: 'https://twitter.com/carol/status/99000' }] };
		expect(xs.citedPostIds(body).has('99000')).toBe(true);
	});

	it('is empty when nothing cites a post', () => {
		expect(xs.citedPostIds({}).size).toBe(0);
	});
});

// --- parseXaiSearchResponse ---------------------------------------------------

describe('parseXaiSearchResponse', () => {
	it('keeps a post whose id is cited and whose text contains the mint', () => {
		const body = responsesBody(
			postsJson([{ id: '1999000111', username: '@alice', text: `the mint is ${MINT} &amp; it is live`, created_at: '2026-10-10T12:00:00.000Z', likes: 3, reposts: 1, replies: 0, quotes: 0 }]),
			{ citations: ['https://x.com/alice/status/1999000111'] },
		);
		const posts = xs.parseXaiSearchResponse(body, { mint: MINT });
		expect(posts).toHaveLength(1);
		expect(posts[0]).toMatchObject({
			id: '1999000111',
			url: 'https://x.com/alice/status/1999000111',
			author: { username: 'alice' },
			likes: 3,
			reposts: 1,
		});
		expect(posts[0].text).toContain(MINT);
	});

	it('drops a post the tool did not cite, even if the model included it', () => {
		const body = responsesBody(postsJson([{ id: '2', username: 'eve', text: `re ${MINT}`, created_at: null, likes: 0, reposts: 0, replies: 0, quotes: 0 }]), { citations: [] });
		expect(xs.parseXaiSearchResponse(body, { mint: MINT })).toEqual([]);
	});

	it('drops a cited post whose text does not actually quote the mint', () => {
		const body = responsesBody(postsJson([{ id: '3', username: 'frank', text: 'unrelated post', created_at: null, likes: 0, reposts: 0, replies: 0, quotes: 0 }]), { citations: ['https://x.com/frank/status/3'] });
		expect(xs.parseXaiSearchResponse(body, { mint: MINT })).toEqual([]);
	});

	it('strips a markdown code fence around the JSON', () => {
		const body = responsesBody('```json\n' + postsJson([]) + '\n```');
		expect(xs.parseXaiSearchResponse(body, { mint: MINT })).toEqual([]);
	});

	it('returns [] when the model answer is not JSON', () => {
		const body = responsesBody('sure, here are the posts: none found');
		expect(xs.parseXaiSearchResponse(body, { mint: MINT })).toEqual([]);
	});

	it('drops a post with a malformed id or handle', () => {
		const body = responsesBody(postsJson([{ id: 'not-numeric', username: 'ok', text: MINT, created_at: null, likes: 0, reposts: 0, replies: 0, quotes: 0 }]), { citations: ['https://x.com/ok/status/not-numeric'] });
		expect(xs.parseXaiSearchResponse(body, { mint: MINT })).toEqual([]);
	});
});

// --- buildXaiSearchRequest -----------------------------------------------------

describe('buildXaiSearchRequest', () => {
	it('builds a strict json_schema Responses request containing the mint', () => {
		const req = xs.buildXaiSearchRequest(MINT, { maxResults: 10, now: Date.parse('2026-10-11T00:00:00.000Z') });
		expect(req.tools).toEqual([{ type: 'x_search' }]);
		expect(req.text.format).toMatchObject({ type: 'json_schema', name: 'x_posts', strict: true });
		expect(req.input.some((m) => typeof m.content === 'string' && m.content.includes(MINT))).toBe(true);
	});

	it('clamps from_date to the 7 day search window', () => {
		const now = Date.parse('2026-10-11T00:00:00.000Z');
		const req = xs.buildXaiSearchRequest(MINT, { sinceIso: '2020-01-01T00:00:00.000Z', now });
		const floor = new Date(now - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
		expect(req.tools[0].from_date).toBe(floor);
	});
});

// --- searchMintPostsDetailed / searchMintPosts orchestrator (failover) --------

function fakeResponses(jsonText, { citations = [] } = {}) {
	return vi.fn(async () => new Response(JSON.stringify(responsesBody(jsonText, { citations })), {
		status: 200,
		headers: { 'content-type': 'application/json' },
	}));
}

describe('searchMintPostsDetailed / searchMintPosts failover', () => {
	it('never calls the xAI rung when the bearer rung answers, and reports rung "bearer"', async () => {
		const bearerFetch = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } }));
		const result = await xs.searchMintPostsDetailed(MINT, { env: { X_BEARER_TOKEN: 'bt' }, fetchImpl: bearerFetch });
		expect(result.posts).toEqual([]);
		expect(result.rung).toBe('bearer');
		expect(bearerFetch).toHaveBeenCalledTimes(1);
	});

	it('falls over to the xAI rung when the bearer rung is not configured, and reports rung "xai"', async () => {
		const xaiFetch = fakeResponses(
			postsJson([{ id: '70007', username: 'dave', text: `re: ${MINT}`, created_at: null, likes: 0, reposts: 0, replies: 0, quotes: 0 }]),
			{ citations: ['https://x.com/dave/status/70007'] },
		);
		const result = await xs.searchMintPostsDetailed(MINT, { env: { XAI_API_KEY: 'k' }, fetchImpl: xaiFetch });
		expect(result.rung).toBe('xai');
		expect(result.posts).toHaveLength(1);
		expect(result.posts[0].author.username).toBe('dave');
	});

	it('searchMintPosts returns just the posts array', async () => {
		const bearerFetch = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } }));
		const posts = await xs.searchMintPosts(MINT, { env: { X_BEARER_TOKEN: 'bt' }, fetchImpl: bearerFetch });
		expect(posts).toEqual([]);
	});

	it('throws the bearer error when neither rung is configured', async () => {
		await expect(xs.searchMintPostsDetailed(MINT, { env: {} }))
			.rejects.toMatchObject({ name: 'XSearchUnavailable', reason: 'not_configured' });
	});

	it('falls over when the bearer rung is rate limited and xAI is configured', async () => {
		let calls = 0;
		const fetchImpl = vi.fn(async (url) => {
			calls += 1;
			if (url.startsWith('https://api.twitter.com')) {
				return new Response('', { status: 429, headers: {} });
			}
			return new Response(JSON.stringify(responsesBody(postsJson([]))), { status: 200, headers: { 'content-type': 'application/json' } });
		});
		const result = await xs.searchMintPostsDetailed(MINT, { env: { X_BEARER_TOKEN: 'bt', XAI_API_KEY: 'k' }, fetchImpl });
		expect(result.posts).toEqual([]);
		expect(result.rung).toBe('xai');
		expect(calls).toBe(2); // bearer attempt, then the xAI rung
	});

	it('stops the xAI rung once the daily cap is reached', async () => {
		const fetchImpl = fakeResponses(postsJson([]));
		const env = { XAI_API_KEY: 'k', XAI_X_SEARCH_DAILY_CAP: '2' };
		await xs.searchMintPostsDetailed(MINT, { env, fetchImpl });
		await xs.searchMintPostsDetailed(MINT, { env, fetchImpl });
		const stats = await xs.xSearchStats();
		expect(stats.xai).toBe(2);

		await expect(xs.searchMintPostsDetailed(MINT, { env, fetchImpl }))
			.rejects.toMatchObject({ reason: 'xai_daily_cap' });
		expect(fetchImpl).toHaveBeenCalledTimes(2); // the capped call never reached the network
	});

	it('maps a 429 from xAI to rate_limited', async () => {
		const fetchImpl = vi.fn(async () => new Response('', { status: 429, headers: {} }));
		await expect(xs.searchMintPostsDetailed(MINT, { env: { XAI_API_KEY: 'k' }, fetchImpl }))
			.rejects.toMatchObject({ reason: 'rate_limited' });
	});
});

/**
 * X search failover: the app-only bearer rung (api/_lib/x-search.js,
 * searchMintPostsBearer) and the xAI x_search rung added as a second,
 * independent path to the same data (searchMintPostsViaXai). Covers the pure
 * parsing of both rungs' payloads, the orchestrator's failover between them,
 * and the daily cap that stops the xAI rung once reached. Payloads are
 * captured, real-shaped fixtures, not live responses.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const settings = new Map();

vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn((strings, ...values) => {
		const text = Array.isArray(strings) ? strings.join('?') : String(strings);
		if (text.includes('CREATE TABLE')) return Promise.resolve([]);
		if (text.includes('SELECT value FROM app_settings')) {
			const key = values[0];
			const row = settings.get(key);
			return Promise.resolve(row ? [{ value: row }] : []);
		}
		if (text.includes('INSERT INTO app_settings')) {
			const key = values[0];
			const day = values[1];
			const prev = settings.get(key);
			const count = prev && prev.day === day ? prev.count + 1 : 1;
			const value = { day, count };
			settings.set(key, value);
			return Promise.resolve([{ count }]);
		}
		return Promise.resolve([]);
	}),
}));

const xs = await import('../api/_lib/x-search.js');

const MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';

beforeEach(() => {
	settings.clear();
	xs._resetXSearch();
	vi.clearAllMocks();
});

// --- parseXaiSearchPayload / extractResponsesOutputText --------------------

describe('extractResponsesOutputText', () => {
	it('joins text parts across every output message', () => {
		const payload = {
			id: 'resp_1',
			output: [
				{ type: 'message', content: [{ type: 'output_text', text: '[{"id":"1"' }] },
				{ type: 'message', content: [{ type: 'output_text', text: ',"url":"https://x.com/alice/status/1"}]' }] },
			],
		};
		expect(xs.extractResponsesOutputText(payload)).toBe('[{"id":"1","url":"https://x.com/alice/status/1"}]');
	});

	it('returns empty string for a malformed body', () => {
		expect(xs.extractResponsesOutputText({})).toBe('');
		expect(xs.extractResponsesOutputText(null)).toBe('');
	});
});

describe('parseXaiSearchPayload', () => {
	function responsesBody(jsonText) {
		return { id: 'resp_1', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: jsonText }] }] };
	}

	it('normalizes a strict-JSON x_search answer into the shared post shape', () => {
		const body = responsesBody(JSON.stringify([
			{ id: '1999000111', url: `https://x.com/alice/status/1999000111`, text: `the mint is ${MINT} &amp; it is live`, created_at: '2026-10-10T12:00:00.000Z', author: { username: '@alice' } },
		]));
		const posts = xs.parseXaiSearchPayload(body);
		expect(posts).toEqual([{
			id: '1999000111',
			url: 'https://x.com/alice/status/1999000111',
			text: `the mint is ${MINT} & it is live`,
			created_at: '2026-10-10T12:00:00.000Z',
			author: { id: null, username: 'alice', name: null, followers: null, verified: false },
			likes: 0,
			reposts: 0,
			replies: 0,
			quotes: 0,
			impressions: null,
		}]);
	});

	it('strips a markdown code fence around the JSON', () => {
		const body = responsesBody('```json\n[]\n```');
		expect(xs.parseXaiSearchPayload(body)).toEqual([]);
	});

	it('derives the post id from the url when id is missing, and skips posts with neither', () => {
		const body = responsesBody(JSON.stringify([
			{ url: 'https://x.com/bob/status/42', text: 'no id field' },
			{ text: 'no id and no url at all' },
		]));
		const posts = xs.parseXaiSearchPayload(body);
		expect(posts).toHaveLength(1);
		expect(posts[0].id).toBe('42');
	});

	it('throws when the model answer is not a JSON array', () => {
		const body = responsesBody('sure, here are the posts: none found');
		expect(() => xs.parseXaiSearchPayload(body)).toThrow();
	});
});

// --- searchMintPostsViaXai ---------------------------------------------------

function fakeResponses(jsonText) {
	return vi.fn(async () => ({ id: 'resp_1', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: jsonText }] }] }));
}

describe('searchMintPostsViaXai', () => {
	it('throws not_configured without a key', async () => {
		await expect(xs.searchMintPostsViaXai(MINT, { env: {}, fetchImpl: fakeResponses('[]') }))
			.rejects.toMatchObject({ name: 'XSearchUnavailable', reason: 'not_configured' });
	});

	it('returns parsed posts on a real-shaped Responses API payload', async () => {
		const fetchImpl = fakeResponses(JSON.stringify([
			{ id: '555', url: 'https://x.com/carol/status/555', text: `holding ${MINT}`, created_at: '2026-10-11T00:00:00.000Z', author: { username: 'carol' } },
		]));
		const posts = await xs.searchMintPostsViaXai(MINT, { env: { GROK_API_KEY: 'xai-test-key' }, fetchImpl });
		expect(posts).toHaveLength(1);
		expect(posts[0]).toMatchObject({ id: '555', url: 'https://x.com/carol/status/555', author: { username: 'carol' } });
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const [url, init] = fetchImpl.mock.calls[0];
		expect(url).toBe('https://api.x.ai/v1/responses');
		expect(init.headers.authorization).toBe('Bearer xai-test-key');
		const body = JSON.parse(init.body);
		expect(body.tools).toEqual([{ type: 'x_search', to_date: expect.any(String) }]);
		expect(body.input[0].content).toContain(MINT);
	});

	it('maps a 429 to rate_limited', async () => {
		const fetchImpl = vi.fn(async () => { const e = new Error('rate limited'); e.status = 429; throw e; });
		await expect(xs.searchMintPostsViaXai(MINT, { env: { XAI_API_KEY: 'k' }, fetchImpl }))
			.rejects.toMatchObject({ reason: 'rate_limited' });
	});

	it('maps an unparseable answer to upstream_error without losing the usage count', async () => {
		const fetchImpl = fakeResponses('not json at all');
		await expect(xs.searchMintPostsViaXai(MINT, { env: { XAI_API_KEY: 'k' }, fetchImpl }))
			.rejects.toMatchObject({ reason: 'upstream_error' });
		expect(await xs.xaiSearchUsageToday()).toBe(1);
	});

	it('stops the rung once the daily cap is reached', async () => {
		const fetchImpl = fakeResponses('[]');
		const env = { XAI_API_KEY: 'k', XAI_X_SEARCH_DAILY_CAP: '2' };
		await xs.searchMintPostsViaXai(MINT, { env, fetchImpl });
		await xs.searchMintPostsViaXai(MINT, { env, fetchImpl });
		expect(await xs.xaiSearchUsageToday()).toBe(2);

		await expect(xs.searchMintPostsViaXai(MINT, { env, fetchImpl }))
			.rejects.toMatchObject({ reason: 'xai_daily_cap' });
		expect(fetchImpl).toHaveBeenCalledTimes(2); // the capped call never reached the network
	});
});

// --- searchMintPosts orchestrator (failover) --------------------------------

describe('searchMintPosts failover', () => {
	it('never calls the xAI rung when the bearer rung answers', async () => {
		const bearerFetch = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } }));
		const posts = await xs.searchMintPosts(MINT, { env: { X_BEARER_TOKEN: 'bt' }, fetchImpl: bearerFetch });
		expect(posts).toEqual([]);
		expect(bearerFetch).toHaveBeenCalledTimes(1);
	});

	it('falls over to the xAI rung when the bearer rung is not configured', async () => {
		const xaiFetch = fakeResponses(JSON.stringify([
			{ id: '7', url: 'https://x.com/dave/status/7', text: `re: ${MINT}`, author: { username: 'dave' } },
		]));
		// searchMintPosts shares one `fetchImpl` across both rungs; the bearer
		// rung never configured means it throws before using fetchImpl at all.
		const posts = await xs.searchMintPosts(MINT, { env: { XAI_API_KEY: 'k' }, fetchImpl: xaiFetch });
		expect(posts).toHaveLength(1);
		expect(posts[0].author.username).toBe('dave');
	});

	it('throws the bearer error when neither rung is configured', async () => {
		await expect(xs.searchMintPosts(MINT, { env: {} }))
			.rejects.toMatchObject({ name: 'XSearchUnavailable', reason: 'not_configured' });
	});

	it('falls over when the bearer rung is rate limited and xAI is configured', async () => {
		let calls = 0;
		const fetchImpl = vi.fn(async (url) => {
			calls += 1;
			if (url.startsWith('https://api.twitter.com')) {
				return new Response('', { status: 429, headers: {} });
			}
			return { id: 'resp_1', status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: '[]' }] }] };
		});
		const posts = await xs.searchMintPosts(MINT, { env: { X_BEARER_TOKEN: 'bt', XAI_API_KEY: 'k' }, fetchImpl });
		expect(posts).toEqual([]);
		expect(calls).toBe(2); // bearer attempt, then the xAI rung
	});
});

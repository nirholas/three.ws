/**
 * Sentiment Scout: sourced momentum candidates where every claim carries its
 * receipt. Covers the pure scoring, evidence and caution logic
 * (api/_lib/sentiment-scout.js), the X recent-search client
 * (api/_lib/x-search.js, driven through an injected fetch), and the LLM note
 * layer (api/_lib/scout-notes.js, driven through an injected completion) whose
 * whole job is refusing a note that adds a fact the evidence does not hold.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('../api/_lib/db.js', () => ({ sql: () => Promise.resolve([]) }));

const scout = await import('../api/_lib/sentiment-scout.js');
const xs = await import('../api/_lib/x-search.js');
const notes = await import('../api/_lib/scout-notes.js');

const MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const ORIGIN = 'https://three.ws';

function intelRow(over = {}) {
	return {
		mint: MINT,
		network: 'mainnet',
		symbol: 'THREE',
		name: 'three.ws',
		first_seen_at: '2026-09-29T06:00:00.000Z',
		observation_seconds: 90,
		buy_count: 40,
		sell_count: 10,
		buy_volume_lamports: String(30e9),
		unique_buyers: 35,
		signals: { buy_sell_ratio: 4 },
		concentration_top10: 0.6,
		fresh_wallet_ratio: 0.2,
		risk_flags: [],
		smart_money_count: 0,
		smart_money_notable: [],
		is_news_meme: false,
		twitter: null,
		telegram: null,
		website: null,
		...over,
	};
}

function windowOf(n = 200) {
	const rows = [];
	for (let i = 0; i < n; i++) {
		rows.push({ buy_volume_lamports: String(Math.round((i / n) * 5e9)), unique_buyers: i % 10, symbol: `C${i}`, concentration_top10: 0.9 });
	}
	rows.push(intelRow());
	return rows;
}

function post(over = {}) {
	return {
		id: '1',
		url: 'https://x.com/alice/status/1',
		text: 'the contract is live',
		created_at: '2026-09-29T06:05:00.000Z',
		author: { id: 'a1', username: 'alice', name: 'Alice', followers: 1200, verified: false },
		likes: 3, reposts: 1, replies: 0, quotes: 0, impressions: 400,
		...over,
	};
}

describe('x-search parsing', () => {
	it('decodes the entities X escapes', () => {
		expect(xs.decodeXText('CA&gt; 1 &amp; 2 &lt;3')).toBe('CA> 1 & 2 <3');
	});

	it('quotes the mint and excludes retweets so one shill cannot count many times', () => {
		expect(xs.mintQuery(MINT)).toBe(`"${MINT}" -is:retweet`);
	});

	it('normalizes a v2 payload into post receipts with permalinks', () => {
		const posts = xs.parseSearchPayload({
			data: [
				{ id: '10', author_id: 'u1', text: 'up only &gt; ok', created_at: '2026-09-29T06:10:00.000Z', public_metrics: { like_count: 4, retweet_count: 2 } },
				{ id: '11', author_id: 'u9', text: 'no user expansion', created_at: '2026-09-29T06:11:00.000Z' },
				{ id: null, text: 'dropped' },
			],
			includes: { users: [{ id: 'u1', username: 'bob', name: 'Bob', public_metrics: { followers_count: 5400 }, verified: true }] },
		});
		expect(posts).toHaveLength(2);
		expect(posts[0]).toMatchObject({ url: 'https://x.com/bob/status/10', text: 'up only > ok', likes: 4, reposts: 2 });
		expect(posts[0].author).toMatchObject({ username: 'bob', followers: 5400, verified: true });
		expect(posts[1].url).toBe('https://x.com/i/status/11');
		expect(posts[1].author.followers).toBeNull();
	});

	it('summarizes breadth, reach, and how much of the chatter is one voice', () => {
		const s = xs.summarizePosts([
			post(),
			post({ id: '2', author: { id: 'a1', username: 'alice', followers: 1200 } }),
			post({ id: '3', author: { id: 'b2', username: 'bob', followers: 9000 } }),
		]);
		expect(s).toMatchObject({ posts: 3, authors: 2, reach_followers: 10200 });
		expect(s.top_poster).toEqual({ username: 'alice', posts: 2 });
		expect(s.most_followed).toEqual({ username: 'bob', followers: 9000 });
		expect(s.top_poster_share).toBeCloseTo(2 / 3);
		expect(s.first_at).toBe('2026-09-29T06:05:00.000Z');
	});
});

describe('x-search client', () => {
	beforeEach(() => xs._resetXSearch());

	function res(status, body, headers = {}) {
		return {
			status,
			ok: status >= 200 && status < 300,
			headers: { get: (k) => headers[k.toLowerCase()] ?? null },
			json: async () => body,
		};
	}

	it('mints an app token from the key pair, then searches with it', async () => {
		const calls = [];
		const fetchImpl = vi.fn(async (url, init) => {
			calls.push({ url, init });
			if (url.includes('oauth2/token')) return res(200, { access_token: 'app-token' });
			return res(200, { data: [{ id: '5', author_id: 'u', text: 'hi' }], includes: { users: [{ id: 'u', username: 'u1' }] } }, { 'x-rate-limit-remaining': '400', 'x-rate-limit-reset': String(Math.floor(Date.now() / 1000) + 600) });
		});
		const posts = await xs.searchMintPosts(MINT, { env: { X_API_KEY: 'k', X_API_SECRET: 's' }, fetchImpl });
		expect(posts[0].url).toBe('https://x.com/u1/status/5');
		expect(calls[0].init.body).toBe('grant_type=client_credentials');
		expect(calls[1].url).toContain(encodeURIComponent(`"${MINT}"`));
		expect(calls[1].init.headers.authorization).toBe('Bearer app-token');
	});

	it('re-mints once on a 401 and stops searching when the budget reserve is reached', async () => {
		let tokens = 0;
		let searches = 0;
		const reset = String(Math.floor(Date.now() / 1000) + 600);
		const fetchImpl = vi.fn(async (url) => {
			if (url.includes('oauth2/token')) return res(200, { access_token: `t${++tokens}` });
			searches++;
			if (searches === 1) return res(401, {});
			return res(200, { data: [] }, { 'x-rate-limit-remaining': '10', 'x-rate-limit-reset': reset });
		});
		const env = { X_API_KEY: 'k', X_API_SECRET: 's' };
		await expect(xs.searchMintPosts(MINT, { env, fetchImpl })).resolves.toEqual([]);
		expect(tokens).toBe(2);
		await expect(xs.searchMintPosts(MINT, { env, fetchImpl })).rejects.toMatchObject({ reason: 'budget_reserve' });
	});

	it('refuses to run without credentials rather than guessing', async () => {
		expect(xs.xSearchConfigured({})).toBe(false);
		await expect(xs.searchMintPosts(MINT, { env: {}, fetchImpl: vi.fn() })).rejects.toMatchObject({ reason: 'not_configured' });
	});
});

describe('x-search xAI failover rung', () => {
	const fixture = JSON.parse(readFileSync(new URL('./fixtures/x-search-xai-response.json', import.meta.url), 'utf8'));
	const jsonRes = (status, body) => ({ status, ok: status >= 200 && status < 300, headers: { get: () => null }, json: async () => body });
	const unique = () => Date.parse('2026-10-09T00:00:00Z') + Math.floor(Math.random() * 3000) * 86_400_000;

	beforeEach(() => xs._resetXSearch());

	it('keeps only posts the tool cited that quote the mint, as untrusted data', () => {
		const posts = xs.parseXaiSearchResponse(fixture, { mint: MINT });
		expect(posts.map((p) => p.id)).toEqual(['1844000000000000001', '1844000000000000002']);
		expect(posts[0]).toMatchObject({ url: 'https://x.com/alice/status/1844000000000000001', likes: 12, reposts: 3, created_at: '2026-10-08T10:00:00.000Z' });
		expect(posts[1].author.username).toBe('bob');
		expect(posts[1].likes).toBe(0);
		expect(Object.keys(posts[0])).toEqual(Object.keys(xs.parseSearchPayload({ data: [{ id: '1', text: 'x' }] })[0]));
	});

	it('returns nothing for a body that is not the requested JSON', () => {
		expect(xs.parseXaiSearchResponse({ output_text: 'sorry, no JSON here' }, { mint: MINT })).toEqual([]);
		expect(xs.parseXaiSearchResponse({}, { mint: MINT })).toEqual([]);
	});

	it('builds an x_search request with a strict schema and a clamped date window', () => {
		const now = Date.parse('2026-10-09T00:00:00Z');
		const req = xs.buildXaiSearchRequest(MINT, { sinceIso: '2026-09-01T00:00:00Z', now });
		expect(req.tools).toEqual([{ type: 'x_search', from_date: '2026-10-02' }]);
		expect(req.text.format).toMatchObject({ type: 'json_schema', strict: true });
		expect(req.input[1].content).toContain(MINT);
	});

	it('serves from xAI when the bearer path is unavailable, and reports the rung', async () => {
		const calls = [];
		const fetchImpl = vi.fn(async (url, init) => {
			calls.push({ url, init });
			return jsonRes(200, fixture);
		});
		const out = await xs.searchMintPostsDetailed(MINT, { env: { XAI_API_KEY: 'xai-test' }, fetchImpl, now: unique() });
		expect(out.rung).toBe('xai');
		expect(out.posts).toHaveLength(2);
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toBe('https://api.x.ai/v1/responses');
		expect(calls[0].init.headers.authorization).toBe('Bearer xai-test');
	});

	it('falls over to xAI when the bearer is rate limited, and never calls xAI when the bearer answers', async () => {
		const now = unique();
		const bearerLimited = vi.fn(async (url) => (url.includes('api.x.ai') ? jsonRes(200, fixture) : jsonRes(429, {})));
		const env = { X_BEARER_TOKEN: 'b', XAI_API_KEY: 'xai-test' };
		expect((await xs.searchMintPostsDetailed(MINT, { env, fetchImpl: bearerLimited, now })).rung).toBe('xai');

		xs._resetXSearch();
		const bearerOk = vi.fn(async () => jsonRes(200, { data: [] }));
		expect((await xs.searchMintPostsDetailed(MINT, { env, fetchImpl: bearerOk, now })).rung).toBe('bearer');
		expect(bearerOk.mock.calls.every(([u]) => !u.includes('api.x.ai'))).toBe(true);
	});

	it('stops the rung once the daily cap is reached', async () => {
		const now = unique();
		const fetchImpl = vi.fn(async () => jsonRes(200, fixture));
		const env = { XAI_API_KEY: 'xai-test', XAI_X_SEARCH_DAILY_CAP: '2' };
		await xs.searchMintPostsDetailed(MINT, { env, fetchImpl, now });
		await xs.searchMintPostsDetailed(MINT, { env, fetchImpl, now });
		await expect(xs.searchMintPostsDetailed(MINT, { env, fetchImpl, now })).rejects.toMatchObject({ reason: 'xai_daily_cap' });
		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect((await xs.xSearchStats(now)).xai).toBe(2);
		await expect(xs.searchMintPostsDetailed(MINT, { env: { ...env, XAI_X_SEARCH_DAILY_CAP: '0' }, fetchImpl, now: unique() })).rejects.toMatchObject({ reason: 'xai_daily_cap' });
	});

	it('surfaces an xAI auth failure as unavailable', async () => {
		const fetchImpl = vi.fn(async () => jsonRes(401, {}));
		await expect(xs.searchMintPostsDetailed(MINT, { env: { XAI_API_KEY: 'bad' }, fetchImpl, now: unique() })).rejects.toMatchObject({ reason: 'auth_failed' });
	});
});

describe('social scoring', () => {
	it('treats one account posting on repeat as promotion, not attention', () => {
		const single = { posts: 6, authors: 1, top_poster_share: 1, reach_followers: 50000 };
		const broad = { posts: 6, authors: 6, top_poster_share: 1 / 6, reach_followers: 50000 };
		expect(scout.isSingleVoice(single)).toBe(true);
		expect(scout.isSingleVoice(broad)).toBe(false);
		expect(scout.xAttention(single)).toBeLessThan(scout.xAttention(broad) / 3);
		expect(scout.xAttention(null)).toBe(0);
	});

	it('raises the score for broad chatter and docks it for a single voice', () => {
		const stats = scout.windowStats(windowOf());
		const pre = scout.measure(intelRow(), stats);
		const base = { curve: null, calloutCount: 0, newsMatch: false, paidSignal: null, flags: [], copycats: 0 };
		const none = scout.momentumScore(pre, base).score;
		const broad = scout.momentumScore(pre, { ...base, xSummary: { posts: 8, authors: 6, top_poster_share: 0.2, reach_followers: 20000 } }).score;
		const shill = scout.momentumScore(pre, { ...base, xSummary: { posts: 8, authors: 1, top_poster_share: 1, reach_followers: 20000 } }).score;
		expect(broad).toBeGreaterThan(none);
		expect(shill).toBeLessThan(none);
	});
});

describe('evidence receipts', () => {
	const stats = scout.windowStats(windowOf());
	const r = intelRow();
	const pre = scout.measure(r, stats);
	const curve = { graduated: false, bondingProgressPct: 46, solInCurve: 15.3 };
	const xPosts = [post(), post({ id: '9', url: 'https://x.com/bob/status/9', text: 'look https://t.co/abc here', author: { id: 'b', username: 'bob', followers: 9000 } })];
	const ev = scout.buildEvidence(r, pre, stats, {
		curve, callouts: [], paidSignal: null, origin: ORIGIN,
		xSummary: xs.summarizePosts(xPosts), xPosts, checkedAt: '2026-09-29T06:30:00.000Z',
	});

	it('stamps every line with a source and the time the fact was true', () => {
		for (const e of ev) {
			expect(e.source).toMatch(/^https:\/\//);
			expect(Date.parse(e.at)).not.toBeNaN();
		}
		expect(ev.find((e) => e.type === 'volume_spike').at).toBe('2026-09-29T06:01:30.000Z');
		expect(ev.find((e) => e.type === 'graduation_approach').at).toBe('2026-09-29T06:30:00.000Z');
	});

	it('quotes the most-followed post, links it, and checks it against the chain', () => {
		const x = ev.find((e) => e.type === 'social_mention');
		expect(x.platform).toBe('x');
		expect(x.source).toBe('https://x.com/bob/status/9');
		expect(x.detail).toContain('2 X posts quoted this exact contract address, from 2 accounts');
		expect(x.detail).toContain('@bob (9.0k followers)');
		expect(x.detail).not.toContain('t.co');
		expect(x.checked_against).toBe('On-chain at 06:30 UTC: 30.0 SOL bought by 35 wallets in the first 90s; bonding curve at 46%');
	});

	it('leaves out a source it could not read instead of estimating one', () => {
		const bare = scout.buildEvidence(r, pre, stats, { curve: null, callouts: [], paidSignal: null, origin: ORIGIN });
		expect(bare.map((e) => e.type)).toEqual(['volume_spike', 'fresh_buyers']);
	});
});

describe('caution line', () => {
	it('names a curve back at the start after heavy early buying', () => {
		const c = scout.cautionFor(intelRow(), { curve: { graduated: false, bondingProgressPct: 0.4 }, earlyVolSol: 26.4 });
		expect(c).toBe('The bonding curve is back at 0% after 26.4 SOL of early buying: the early buyers have already sold.');
	});

	it('calls out chatter that is all one account', () => {
		const c = scout.cautionFor(intelRow(), { xSummary: { posts: 12, authors: 1, top_poster_share: 1, top_poster: { username: 'shill', posts: 12 } } });
		expect(c).toBe('All 12 X posts quoting this contract came from @shill: that is promotion, not independent interest.');
	});

	it('does not claim nothing outside the chart when X posts exist', () => {
		const c = scout.cautionFor(intelRow(), { xSummary: { posts: 4, authors: 4, top_poster_share: 0.25 } });
		expect(c).toMatch(/first 90s of trading/);
	});

	it('keeps the dev-dump warning above everything else', () => {
		const c = scout.cautionFor(intelRow({ risk_flags: ['dev_dumped'] }), { curve: { graduated: false, bondingProgressPct: 0 }, earlyVolSol: 50 });
		expect(c).toMatch(/creator already sold/);
	});
});

describe('track record', () => {
	it('grades the Scout against the base rate, band by band', () => {
		const t = scout.shapeTrackRecord(
			{ scouted: '50', labeled: '40', graduated: '3', pumped: '5', rugged: '9', good: '8', labeled_70_plus: '10', good_70_plus: '4', labeled_50_69: '20', good_50_69: '3', labeled_under_50: '10', good_under_50: '1' },
			{ labeled: '10000', good: '200' },
			14,
		);
		expect(t.good_rate).toBe(0.2);
		expect(t.base_rate).toBe(0.02);
		expect(t.lift).toBe(10);
		expect(t.bands[0]).toEqual({ band: '70_plus', labeled: 10, good: 4, good_rate: 0.4 });
	});

	it('reports no rate rather than zero when nothing is labeled yet', () => {
		const t = scout.shapeTrackRecord({ scouted: '5', labeled: '0', good: '0' }, { labeled: '0', good: '0' }, 14);
		expect(t.good_rate).toBeNull();
		expect(t.base_rate).toBeNull();
		expect(t.lift).toBeNull();
	});
});

describe('judge block', () => {
	it('hands the judge the same evidence lines a human sees, with the caution', () => {
		const block = scout.formatJudgeBlock({
			momentum_score: 61,
			evidence: [{ type: 'volume_spike', detail: '30.00 SOL bought in its first 90s' }, { type: 'social_mention', platform: 'x', detail: '3 X posts quoted this exact contract address' }],
			caution: 'Most early momentum fades.',
		});
		expect(block).toContain('momentum_score: 61/100');
		expect(block).toContain('- social_mention (x): 3 X posts quoted this exact contract address');
		expect(block).toContain('caution: Most early momentum fades.');
		expect(scout.formatJudgeBlock(null)).toBe('');
	});
});

describe('scout notes', () => {
	const candidate = {
		mint: MINT,
		ticker: '$THREE',
		momentum_score: 61,
		evidence: [
			{ type: 'volume_spike', detail: '30.00 SOL bought in its first 90s, top 2% of 1288 launches' },
			{ type: 'fresh_buyers', detail: '35 distinct buyers in its first 90s' },
		],
		caution: '4 other coins named $THREE launched in the same window; check you have the right mint.',
	};

	beforeEach(() => notes._resetScoutNotes());

	it('accepts a note built only from the evidence', () => {
		expect(notes.validateScoutNote('35 wallets bought 30.00 SOL of $THREE in its first 90s. Four copycats launched too, so check the mint on pump.fun.', candidate)).toEqual({ ok: true });
	});

	it('rejects invented numbers, in digits or in words', () => {
		expect(notes.validateScoutNote('35 wallets bought 30.00 SOL; expect a 10x from here on this one.', candidate).reason).toBe('ungrounded_number:10');
		expect(notes.validateScoutNote('35 wallets bought 30.00 SOL. Five copycats launched in the same window.', candidate).reason).toBe('ungrounded_number:5');
	});

	it('rejects links, promises, and other tickers', () => {
		expect(notes.validateScoutNote('35 wallets bought 30.00 SOL, see dexscreener.com for more detail.', candidate).reason).toBe('link');
		expect(notes.validateScoutNote('35 wallets bought 30.00 SOL, a guaranteed winner for anyone early.', candidate).reason).toBe('promise');
		expect(notes.validateScoutNote('35 wallets bought 30.00 SOL, more than $OTHER did in its first 90s.', candidate).reason).toBe('foreign_ticker');
	});

	it('builds one prompt for the batch and parses fenced JSON back', () => {
		const prompt = notes.buildScoutNotePrompt([candidate]);
		expect(prompt).toContain(`mint: ${MINT}`);
		expect(prompt).toContain('- volume_spike: 30.00 SOL bought');
		expect(notes.parseScoutNotes('```json\n{"notes":[{"mint":" m ","note":"a  b"}]}\n```')).toEqual([{ mint: 'm', note: 'a b' }]);
		expect(notes.parseScoutNotes('no json here')).toEqual([]);
	});

	it('keeps valid notes, drops invalid ones, and caches by evidence', async () => {
		const other = { ...candidate, mint: 'THREEsynthetic111111111111111111111111111111', ticker: '$SYNTH' };
		const complete = vi.fn(async () => ({
			text: JSON.stringify({ notes: [
				{ mint: MINT, note: '35 wallets bought 30.00 SOL in its first 90s. Four copycats share the name, so verify the mint.' },
				{ mint: other.mint, note: 'This one will moon, 1000 buyers are coming for sure.' },
			] }),
			model: 'test-model',
			provider: 'test',
		}));
		const out = await notes.writeScoutNotes([candidate, other], { complete });
		expect(out.get(MINT)).toMatchObject({ model: 'test-model' });
		expect(out.has(other.mint)).toBe(false);
		await notes.writeScoutNotes([candidate, other], { complete });
		expect(complete).toHaveBeenCalledTimes(1);
	});

	it('returns no notes, and throws nothing, when the chain is down', async () => {
		const out = await notes.writeScoutNotes([candidate], { complete: async () => { throw new Error('chain exhausted'); } });
		expect(out.size).toBe(0);
	});
});

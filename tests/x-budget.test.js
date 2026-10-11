// The X budget against the real app_settings table (PGlite), the real poll
// loop and the real ladder. Only the reply brain and the X adapter are
// counted; header cases use the header names X documents.

import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const dbState = { pg: null };

vi.mock('../api/_lib/db.js', () => {
	const sql = async (strings, ...values) => {
		const text = strings.reduce((acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ''), '');
		return (await dbState.pg.query(text, values)).rows;
	};
	return { sql, isDbUnavailableError: () => false, isDbCapacityError: () => false };
});
vi.mock('../api/auth/x/[action].js', () => ({ encryptToken: (s) => s, decryptToken: (s) => s }));

const budget = await import('../api/_lib/x-budget.js');
const poll = await import('../api/_lib/x-mention-poll.js');
const mentions = await import('../api/_lib/x-mentions.js');

const MIG = new URL('../api/_lib/migrations/', import.meta.url);
const MIGRATION = readFileSync(new URL('20261008170000_x_mention_events.sql', MIG), 'utf8');
const APP_SETTINGS = (() => {
	const src = readFileSync(new URL('20260922210000_free_tier_models.sql', MIG), 'utf8');
	const start = src.indexOf('CREATE TABLE IF NOT EXISTS app_settings');
	return src.slice(start, src.indexOf(');', start) + 2);
})();

const OWN_ID = '1700000000000000001';
const ACCOUNT = { kind: 'company', ref: 'trythreews', userId: OWN_ID, handle: 'trythreews' };
const NOW = Date.parse('2026-10-09T12:00:00Z');
const ENV = { X_MENTION_DAILY_POST_CAP: '100', X_MENTION_MONTHLY_POST_CAP: '1000', X_MENTION_MONTHLY_READ_CAP: '1000' };
let seq = 0;

function mention(over = {}) {
	seq += 1;
	const id = String(1800000000000002000n + BigInt(seq));
	const userId = String(1700000000000001000n + BigInt(seq));
	return {
		platform: 'x', id, text: '@trythreews hello there', createdAt: '2026-10-09T11:59:00Z',
		chatId: id, conversationId: id, userId, username: `fixture_${seq}`,
		author: { id: userId, username: `fixture_${seq}`, createdAt: '2025-01-01T00:00:00Z' },
		mentions: [{ username: 'trythreews', id: OWN_ID }], quoted: null, repliedTo: null, isRetweet: false, media: [],
		account: ACCOUNT, ...over,
	};
}

/** Use `posts` of the daily cap (100) so the ladder level is posts / 100. */
const useDaily = (posts) => dbState.pg.query(`insert into app_settings (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value`, [budget.dayKey(), JSON.stringify({ posts })]);

const compose = vi.fn(async () => ({ text: 'a fixed answer', source: 'model', reason: null }));
const sendText = vi.fn(async () => ({}));
const adapterFactory = vi.fn(() => ({ live: false, sendText }));
const handle = (m) => poll.handleMention({ mention: m, account: ACCOUNT, limits: poll.replyLimits({}), env: ENV, compose, adapterFactory, guard: async () => ({ allow: true }), paused: async () => false });

beforeEach(async () => {
	dbState.pg = new PGlite();
	await dbState.pg.exec(APP_SETTINGS);
	await dbState.pg.exec(MIGRATION);
	compose.mockClear(); sendText.mockClear(); adapterFactory.mockClear();
});

describe('caps from env', () => {
	it('uses conservative defaults and honors overrides', () => {
		expect(budget.budgetCaps({})).toEqual({ monthlyPosts: 1500, dailyPosts: 80, monthlyReads: 15000 });
		expect(budget.budgetCaps({ X_MENTION_MONTHLY_POST_CAP: '10', X_MENTION_DAILY_POST_CAP: '2', X_MENTION_MONTHLY_READ_CAP: '50' })).toEqual({ monthlyPosts: 10, dailyPosts: 2, monthlyReads: 50 });
		expect(budget.budgetCaps({ X_MENTION_DAILY_POST_CAP: 'nope' }).dailyPosts).toBe(80);
	});
});

describe('counters', () => {
	it('count posts and reads per UTC day and month and accumulate', async () => {
		await budget.recordPosts(1, NOW);
		await budget.recordPosts(2, NOW);
		await budget.recordReads(40, NOW);
		await budget.recordReads(5, NOW);
		const u = await budget.getBudgetUsage({ env: ENV, now: NOW });
		expect(u.day).toEqual({ posts: 3, reads: 45 });
		expect(u.month).toEqual({ posts: 3, reads: 45 });
		expect(u.remaining).toEqual({ dailyPosts: 97, monthlyPosts: 997, monthlyReads: 955 });
		const next = await budget.getBudgetUsage({ env: ENV, now: NOW + 86400_000 });
		expect(next.day).toEqual({ posts: 0, reads: 0 });
		expect(next.month.posts).toBe(3);
	});
});

describe('the degrade ladder', () => {
	const cases = [
		[0, [], 'chat', true],
		[69, [], 'chat', true],
		[70, ['chat'], 'chat', false],
		[70, ['chat'], 'avatar', true],
		[80, ['chat', 'avatar'], 'avatar', false],
		[80, ['chat', 'avatar'], 'image3d', true],
		[90, ['chat', 'avatar', 'image3d'], 'image3d', false],
		[90, ['chat', 'avatar', 'image3d'], 'make', true],
		[99, ['chat', 'avatar', 'image3d'], 'help', true],
	];
	it.each(cases)('at %i of 100 daily posts drops %j; %s allowed = %s', async (used, dropped, intent, allowed) => {
		await useDaily(used);
		const usage = await budget.getBudgetUsage({ env: ENV, now: Date.now() });
		expect(usage.dropped).toEqual(dropped);
		const gate = await budget.budgetGate({ intent, env: ENV });
		expect(gate.allow).toBe(allowed);
		if (!allowed) expect(gate.reason).toBe(`degraded:${intent}`);
	});

	it('at the cap even make and help stop, with the cap named', async () => {
		await useDaily(100);
		expect(await budget.budgetGate({ intent: 'make', env: ENV })).toEqual({ allow: false, reason: 'daily_post_cap' });
		expect(await budget.budgetGate({ intent: 'help', env: ENV })).toEqual({ allow: false, reason: 'daily_post_cap' });
	});

	it('names the monthly cap and counts reads toward the level', async () => {
		await dbState.pg.query(`insert into app_settings (key, value) values ($1, $2::jsonb)`, [budget.monthKey(), JSON.stringify({ posts: 1000 })]);
		expect((await budget.budgetGate({ intent: 'make', env: ENV })).reason).toBe('monthly_post_cap');
		await dbState.pg.query(`delete from app_settings`);
		await dbState.pg.query(`insert into app_settings (key, value) values ($1, $2::jsonb)`, [budget.monthKey(), JSON.stringify({ reads: 750 })]);
		expect((await budget.budgetGate({ intent: 'chat', env: ENV })).reason).toBe('degraded:chat');
		expect((await budget.budgetGate({ intent: 'avatar', env: ENV })).allow).toBe(true);
	});

	it('fails closed when the budget cannot be read', async () => {
		const gate = await budget.budgetGate({ intent: 'make', env: ENV, read: async () => { throw new Error('db down'); } });
		expect(gate).toEqual({ allow: false, reason: 'budget_unreadable' });
	});
});

describe('the ladder inside the poll loop', () => {
	it('records a budget decision, composes nothing and posts nothing for a dropped intent', async () => {
		await useDaily(75);
		const out = await handle(mention({ text: '@trythreews what do you think about rain?' }));
		expect(out).toMatchObject({ decision: 'budget', reason: 'degraded:chat' });
		expect(compose).not.toHaveBeenCalled();
		expect(adapterFactory).not.toHaveBeenCalled();
		const [row] = (await dbState.pg.query(`select decision, reason from x_mention_events where tweet_id = $1`, [out.tweetId])).rows;
		expect(row).toEqual({ decision: 'budget', reason: 'degraded:chat' });
		expect((await budget.getBudgetUsage({ env: ENV })).day.posts).toBe(75);
	});

	it('counts every reply it sends, dry run included', async () => {
		const out = await handle(mention({ text: '@trythreews help' }));
		expect(out.decision).toBe('reply');
		expect(sendText).toHaveBeenCalledTimes(1);
		expect((await budget.getBudgetUsage({ env: ENV })).day.posts).toBe(1);
	});

	it('keeps answering help right up to the cap, then stops', async () => {
		await useDaily(99);
		expect((await handle(mention({ text: '@trythreews help' }))).decision).toBe('reply');
		const out = await handle(mention({ text: '@trythreews help' }));
		expect(out).toMatchObject({ decision: 'budget', reason: 'daily_post_cap' });
		expect(sendText).toHaveBeenCalledTimes(1);
	});
});

describe('header driven backoff', () => {
	it('reads the endpoint window: zero remaining backs off until x-rate-limit-reset', () => {
		const reset = Math.floor(NOW / 1000) + 600;
		const b = budget.backoffFromHeaders({ headers: { 'x-rate-limit-limit': '15', 'x-rate-limit-remaining': '0', 'x-rate-limit-reset': String(reset) }, now: NOW });
		expect(b).toEqual({ until: new Date(reset * 1000).toISOString(), reason: 'endpoint_window' });
	});

	it('does nothing while requests remain', () => {
		expect(budget.backoffFromHeaders({ headers: { 'x-rate-limit-remaining': '3', 'x-rate-limit-reset': String(Math.floor(NOW / 1000) + 600) }, now: NOW })).toBeNull();
		expect(budget.backoffFromHeaders({ headers: {}, now: NOW })).toBeNull();
	});

	it('honors the app 24 hour window and takes the later of two windows', () => {
		const nearReset = Math.floor(NOW / 1000) + 300;
		const appReset = Math.floor(NOW / 1000) + 7200;
		const b = budget.backoffFromHeaders({ headers: { 'x-rate-limit-remaining': '0', 'x-rate-limit-reset': String(nearReset), 'x-app-limit-24hour-remaining': '0', 'x-app-limit-24hour-reset': String(appReset) }, now: NOW });
		expect(b).toEqual({ until: new Date(appReset * 1000).toISOString(), reason: 'app_24h_window' });
	});

	it('backs off 15 minutes on a 429 with no usable headers', () => {
		expect(budget.backoffFromHeaders({ headers: {}, status: 429, now: NOW })).toEqual({ until: new Date(NOW + 900_000).toISOString(), reason: 'http_429' });
	});

	it('a stored backoff blocks every intent and the reader until it passes, and only extends', async () => {
		const until = new Date(Date.now() + 600_000).toISOString();
		await budget.noteResponse({ headers: { 'x-rate-limit-remaining': '0', 'x-rate-limit-reset': String(Math.floor(Date.parse(until) / 1000)) } });
		expect(await budget.budgetGate({ intent: 'help', env: ENV })).toEqual({ allow: false, reason: 'rate_limit_backoff' });
		expect((await budget.readGate({ env: ENV })).reason).toBe('rate_limit_backoff');
		await budget.setBackoff({ until: new Date(Date.now() + 60_000).toISOString(), reason: 'shorter' });
		expect((await budget.getBudgetUsage({ env: ENV })).backoff.until).toBe(new Date(Math.floor(Date.parse(until) / 1000) * 1000).toISOString());
		expect((await budget.budgetGate({ intent: 'help', env: ENV, now: Date.parse(until) + 1000 })).allow).toBe(true);
	});

	it('the poller records reads, stops reading in a backoff and never calls X', async () => {
		const descriptor = { kind: 'company', ref: 'trythreews', fetch: { kind: 'company' } };
		const m = mention();
		const fetchMentions = vi.fn(async () => ({
			account: ACCOUNT, mentions: [m], newestId: m.id, pages: 1, truncated: false,
			rateLimit: { limit: 15, remaining: 0, resetAt: new Date(Date.now() + 600_000).toISOString() },
			headers: { 'x-rate-limit-remaining': '0', 'x-rate-limit-reset': String(Math.floor(Date.now() / 1000) + 600) },
		}));
		const store = await import('../api/_lib/x-mention-store.js');
		await store.advanceCursor({ kind: 'company', ref: 'trythreews' }, '1');
		const deps = { fetchMentions, compose, adapterFactory, guard: async () => ({ allow: true }), paused: async () => false, ensureKnownBots: async () => {}, request: async () => ({}) };
		const first = await poll.pollAccount({ descriptor, env: ENV, deps });
		expect(first.status).toBe('ok');
		const u = await budget.getBudgetUsage({ env: ENV });
		expect(u.month.reads).toBe(1);
		expect(u.backoff?.reason).toBe('endpoint_window');
		const second = await poll.pollAccount({ descriptor, env: ENV, deps });
		expect(second).toMatchObject({ status: 'budget', reason: 'rate_limit_backoff' });
		expect(fetchMentions).toHaveBeenCalledTimes(1);
	});

	it('a 429 from X sets a backoff from its headers', async () => {
		const reset = Math.floor(Date.now() / 1000) + 3000;
		const err = mentions.classifyMentionsError({ status: 429, headers: { 'x-rate-limit-reset': String(Math.floor(Date.now() / 1000) + 100), 'x-app-limit-24hour-remaining': '0', 'x-app-limit-24hour-reset': String(reset) }, body: {} });
		const descriptor = { kind: 'company', ref: 'trythreews', fetch: { kind: 'company' } };
		const store = await import('../api/_lib/x-mention-store.js');
		await store.advanceCursor({ kind: 'company', ref: 'trythreews' }, '1');
		const out = await poll.pollAccount({ descriptor, env: ENV, deps: { fetchMentions: async () => { throw err; } } });
		expect(out.status).toBe('rate_limited');
		const u = await budget.getBudgetUsage({ env: ENV });
		expect(u.backoff.until).toBe(new Date(reset * 1000).toISOString());
	});

	it('the reader stops at the monthly read cap and leaves the cursor alone', async () => {
		await dbState.pg.query(`insert into app_settings (key, value) values ($1, $2::jsonb)`, [budget.monthKey(), JSON.stringify({ reads: 1000 })]);
		const fetchMentions = vi.fn();
		const out = await poll.pollAccount({ descriptor: { kind: 'company', ref: 'trythreews', fetch: { kind: 'company' } }, env: ENV, deps: { fetchMentions } });
		expect(out).toMatchObject({ status: 'budget', reason: 'monthly_read_cap' });
		expect(fetchMentions).not.toHaveBeenCalled();
	});
});

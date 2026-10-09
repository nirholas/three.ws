// The mention polling loop against the REAL x_mention_events migration
// (PGlite), the real parser, the real X adapter (dry run), and the captured
// timeline fixture replayed through the transport. Only the LLM completion
// boundary is captured.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

const poll = await import('../api/_lib/x-mention-poll.js');
const store = await import('../api/_lib/x-mention-store.js');
const { XTierUnavailable, XRateLimited } = await import('../api/_lib/x-mentions.js');

const MIG = new URL('../api/_lib/migrations/', import.meta.url);
const MIGRATION = readFileSync(new URL('20261008170000_x_mention_events.sql', MIG), 'utf8');
const APP_SETTINGS = (() => {
	const src = readFileSync(new URL('20260922210000_free_tier_models.sql', MIG), 'utf8');
	const start = src.indexOf('CREATE TABLE IF NOT EXISTS app_settings');
	return src.slice(start, src.indexOf(');', start) + 2);
})();
const page = JSON.parse(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'x-mentions', 'timeline-page.fixture.json'), 'utf8'));
const COMPANY = { kind: 'company', ref: 'trythreews', userId: '1700000000000000001', handle: 'trythreews' };
const DESCRIPTOR = { kind: 'company', ref: 'trythreews', fetch: { kind: 'company' } };
const ACCT = { kind: 'company', ref: 'trythreews' };

const request = async () => ({ status: 200, headers: {}, body: page });
const compose = vi.fn(async () => ({ text: 'Hello from three.ws', source: 'model', reason: null }));
const deps = (extra = {}) => ({ request, resolvedAccount: COMPANY, compose, ...extra });

beforeEach(async () => {
	dbState.pg = new PGlite();
	await dbState.pg.exec(APP_SETTINGS);
	await dbState.pg.exec(MIGRATION);
	compose.mockClear();
});

describe('first poll', () => {
	it('only anchors the cursor and answers nothing', async () => {
		const out = await poll.pollAccount({ descriptor: DESCRIPTOR, env: {}, deps: deps() });
		expect(out.status).toBe('anchored');
		expect(await store.getCursor(ACCT)).toBe(page.meta.newest_id);
		expect(await store.recentDecisions(ACCT)).toHaveLength(0);
	});
});

describe('a poll with a cursor', () => {
	beforeEach(async () => {
		await store.advanceCursor(ACCT, '1800000000000000001');
	});

	it('records the right decision for every captured mention and posts nothing', async () => {
		const out = await poll.pollAccount({ descriptor: DESCRIPTOR, env: {}, deps: deps() });
		expect(out.status).toBe('ok');
		const rows = await store.recentDecisions(ACCT, { limit: 50 });
		expect(rows.length).toBe(out.handled);
		expect(rows.every((r) => r.dry_run === true && r.reply_tweet_id === null && r.decision)).toBe(true);
		const byIntent = Object.fromEntries(rows.map((r) => [r.tweet_id, `${r.intent}:${r.decision}:${r.reason}`]));
		console.info('captured tick decisions', JSON.stringify(byIntent, null, 1));
		const own = rows.find((r) => r.reason === 'own_post');
		expect(own?.decision).toBe('skip');
		const replies = rows.filter((r) => r.decision === 'reply');
		expect(replies.length).toBeGreaterThan(0);
		for (const r of replies) expect(r.reply_text).toBeTruthy();
		expect(await store.getCursor(ACCT)).toBe(out.cursor);
	});

	it('routes handlers from later orders to help with handler_not_built', async () => {
		await poll.pollAccount({ descriptor: DESCRIPTOR, env: {}, deps: deps() });
		const rows = await store.recentDecisions(ACCT, { limit: 50 });
		const unbuilt = rows.filter((r) => ['make', 'image3d', 'avatar', 'launch'].includes(r.intent) && r.decision === 'reply');
		for (const r of unbuilt) expect(r.reason).toBe('handler_not_built');
	});

	it('handles a mention once when the same page is read twice', async () => {
		await poll.pollAccount({ descriptor: DESCRIPTOR, env: {}, deps: deps() });
		const first = (await store.recentDecisions(ACCT, { limit: 50 })).length;
		await dbState.pg.query(`delete from app_settings where key like 'x_mentions_cursor:%'`);
		await store.advanceCursor(ACCT, '1800000000000000001');
		const out = await poll.pollAccount({ descriptor: DESCRIPTOR, env: {}, deps: deps() });
		expect(out.handled).toBe(0);
		expect((await store.recentDecisions(ACCT, { limit: 50 })).length).toBe(first);
	});

	it('rate limits an author past the hourly allowance', async () => {
		const author = '1700000000000000099';
		for (let i = 0; i < 3; i++) {
			await dbState.pg.query(
				`insert into x_mention_events (tweet_id, account_kind, account_ref, author_id, intent, decision) values ($1,'company','trythreews',$2,'chat','reply')`,
				[`17999999999999999${i}`, author],
			);
		}
		expect(await poll.overReplyLimit(author, ACCT, poll.replyLimits({}))).toBe('author_hourly_limit');
		expect(await poll.overReplyLimit(author, ACCT, poll.replyLimits({ X_MENTION_REPLIES_PER_AUTHOR_HOUR: '4' }))).toBeNull();
		expect(await poll.overReplyLimit(author, ACCT, poll.replyLimits({ X_MENTION_REPLIES_PER_AUTHOR_HOUR: '99', X_MENTION_REPLIES_PER_AUTHOR_DAY: '3' }))).toBe('author_daily_limit');
	});

	it('stays quiet when X refuses the read', async () => {
		const tier = async () => { throw new XTierUnavailable('no credits', { reason: 'credits' }); };
		expect((await poll.pollAccount({ descriptor: DESCRIPTOR, env: {}, deps: deps({ fetchMentions: tier }) })).status).toBe('unavailable');
		const rate = async () => { throw new XRateLimited('slow down', { resetAt: '2026-10-09T00:00:00Z' }); };
		expect((await poll.pollAccount({ descriptor: DESCRIPTOR, env: {}, deps: deps({ fetchMentions: rate }) })).status).toBe('rate_limited');
	});

	it('does not advance the cursor past a mention that failed to record', async () => {
		const flaky = { ...store, recordMention: vi.fn(async (a) => { if (a.mention.id === '1800000000000000104') throw new Error('db down'); return store.recordMention(a); }) };
		const out = await poll.pollAccount({ descriptor: DESCRIPTOR, env: {}, deps: deps({ store: flaky }) });
		expect(out.status).toBe('partial');
		expect(BigInt(await store.getCursor(ACCT))).toBeLessThan(1800000000000000104n);
	});
});

describe('the run lock', () => {
	it('refuses a second holder until released or expired', async () => {
		const a = await poll.acquireLock(60);
		expect(a).toBeTruthy();
		expect(await poll.acquireLock(60)).toBeNull();
		await poll.releaseLock(a);
		const b = await poll.acquireLock(60);
		expect(b).toBeTruthy();
		await dbState.pg.query(`update app_settings set value = jsonb_set(value, '{expires_at}', to_jsonb((now() - interval '1 minute')::text)) where key = $1`, [poll.LOCK_KEY]);
		expect(await poll.acquireLock(60)).toBeTruthy();
	});

	it('a tick that finds the lock held does nothing', async () => {
		await poll.acquireLock(60);
		expect(await poll.runMentionTick({ env: {}, deps: deps() })).toEqual({ ok: true, skipped: 'locked' });
	});

	it('a tick releases the lock and reports unconfigured accounts quietly', async () => {
		expect(await poll.runMentionTick({ env: {} })).toEqual({ ok: true, skipped: 'no_accounts_configured' });
		expect(await poll.acquireLock(60)).toBeTruthy();
	});
});

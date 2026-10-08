// x-mention-store.js against the REAL x_mention_events migration, in an
// in-process Postgres (PGlite), the same way the payment-intent suite tests
// its constraints. The schema comes from the migration file itself, so a
// column or CHECK the store relies on cannot drift from what production gets.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const dbState = { pg: null };

vi.mock('../api/_lib/db.js', () => {
	const sql = async (strings, ...values) => {
		const text = strings.reduce((acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ''), '');
		const out = await dbState.pg.query(text, values);
		return out.rows;
	};
	return { sql, isDbUnavailableError: () => false, isDbCapacityError: () => false };
});

const store = await import('../api/_lib/x-mention-store.js');
const { normalizeMentions } = await import('../api/_lib/x-mentions.js');
const { parseMentionIntent } = await import('../api/_lib/x-mention-intents.js');

const MIG = new URL('../api/_lib/migrations/', import.meta.url);
const MIGRATION = readFileSync(new URL('20261008170000_x_mention_events.sql', MIG), 'utf8');
// app_settings exactly as its migration creates it.
const APP_SETTINGS = (() => {
	const src = readFileSync(new URL('20260922210000_free_tier_models.sql', MIG), 'utf8');
	const start = src.indexOf('CREATE TABLE IF NOT EXISTS app_settings');
	return src.slice(start, src.indexOf(');', start) + 2);
})();

const COMPANY = { kind: 'company', ref: 'trythreews', userId: '1700000000000000001', handle: 'trythreews' };
const page = JSON.parse(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'x-mentions', 'timeline-page.fixture.json'), 'utf8'));
const MENTIONS = normalizeMentions(page, COMPANY);
const byId = (id) => MENTIONS.find((m) => m.id === id);
const record = (m, extra = {}) => store.recordMention({ mention: m, parsed: parseMentionIntent(m), ...extra });

beforeEach(async () => {
	dbState.pg = new PGlite();
	await dbState.pg.exec(APP_SETTINGS);
	await dbState.pg.exec(MIGRATION);
});

describe('migration', () => {
	it('is idempotent and creates the three time indexes', async () => {
		await dbState.pg.exec(MIGRATION);
		const { rows } = await dbState.pg.query(`select indexname from pg_indexes where tablename = 'x_mention_events' order by indexname`);
		expect(rows.map((r) => r.indexname)).toEqual([
			'x_mention_events_account_time_idx',
			'x_mention_events_author_time_idx',
			'x_mention_events_decision_time_idx',
			'x_mention_events_pkey',
		]);
	});

	it('rejects an unknown intent, decision or account kind', async () => {
		const ins = (kind, intent, decision) => dbState.pg.query(
			`insert into x_mention_events (tweet_id, account_kind, account_ref, author_id, intent, decision) values ('1', $1, 'r', 'a', $2, $3)`,
			[kind, intent, decision],
		);
		await expect(ins('company', 'transfer', null)).rejects.toThrow(/intent_check/);
		await expect(ins('company', 'make', 'sent_funds')).rejects.toThrow(/decision_check/);
		await expect(ins('person', 'make', null)).rejects.toThrow(/account_kind_check/);
	});
});

describe('recordMention', () => {
	it('stores what the bot saw and the parsed intent, dry run by default', async () => {
		const m = byId('1800000000000000101');
		expect(await record(m)).toEqual({ inserted: true, tweetId: '1800000000000000101' });
		const row = await store.getMentionEvent('1800000000000000101');
		expect(row).toMatchObject({
			account_kind: 'company',
			account_ref: 'trythreews',
			author_id: '1700000000000000020',
			author_username: 'fixture_dee',
			conversation_id: '1800000000000000101',
			mention_text: '@trythreews turn my cat into 3d https://t.co/fixtureImg1',
			intent: 'image3d',
			decision: null,
			reason: 'command:image3d',
			dry_run: true,
			reply_tweet_id: null,
		});
		expect(row.args.mediaUrl).toBe('https://pbs.twimg.com/media/FixtureCatPhoto.jpg');
		expect(new Date(row.mention_created_at).toISOString()).toBe('2026-10-08T02:50:00.000Z');
	});

	it('dedupes: a second record of the same tweet is a no-op', async () => {
		const m = byId('1800000000000000104');
		expect((await record(m)).inserted).toBe(true);
		expect((await record(m, { dryRun: false })).inserted).toBe(false);
		const { rows } = await dbState.pg.query('select count(*)::int as n, bool_and(dry_run) as dry from x_mention_events');
		expect(rows[0]).toEqual({ n: 1, dry: true });
	});

	it('the dedupe race: two concurrent inserts, exactly one wins', async () => {
		const m = byId('1800000000000000102');
		const results = await Promise.all([record(m), record(m), record(m)]);
		expect(results.filter((r) => r.inserted)).toHaveLength(1);
		const { rows } = await dbState.pg.query(`select count(*)::int as n from x_mention_events where tweet_id = '1800000000000000102'`);
		expect(rows[0].n).toBe(1);
	});

	it('can record an immediate decision, e.g. skipping our own post', async () => {
		const own = byId('1800000000000000107');
		await record(own, { decision: 'skip' });
		const row = await store.getMentionEvent(own.id);
		expect(row).toMatchObject({ intent: 'ignore', decision: 'skip', reason: 'own_post' });
		expect(row.decided_at).not.toBeNull();
	});

	it('refuses a mention without an id, author, account or parse', async () => {
		const m = byId('1800000000000000101');
		await expect(store.recordMention({ mention: { ...m, id: 'abc' }, parsed: { intent: 'make' } })).rejects.toMatchObject({ code: 'bad_mention' });
		await expect(store.recordMention({ mention: { ...m, userId: null, author: null }, parsed: { intent: 'make' } })).rejects.toMatchObject({ code: 'bad_mention' });
		await expect(store.recordMention({ mention: { ...m, account: { kind: 'x', ref: 'y' } }, parsed: { intent: 'make' } })).rejects.toMatchObject({ code: 'bad_account' });
		await expect(store.recordMention({ mention: m, parsed: null })).rejects.toMatchObject({ code: 'bad_intent' });
		await expect(record(m, { decision: 'sent' })).rejects.toMatchObject({ code: 'bad_decision' });
	});

	it('caps a very long post', async () => {
		const m = { ...byId('1800000000000000104'), id: '1800000000000000999', text: 'x'.repeat(30_000) };
		await record(m);
		const row = await store.getMentionEvent('1800000000000000999');
		expect(row.mention_text).toHaveLength(store.MENTION_TEXT_MAX);
	});
});

describe('updateDecision', () => {
	it('writes the decision and the would-be reply, keeping untouched fields', async () => {
		const m = byId('1800000000000000104');
		await record(m);
		const row = await store.updateDecision(m.id, {
			decision: 'reply',
			reason: 'made',
			replyText: 'Here is your lighthouse.',
			replyMediaUrl: 'https://three.ws/api/render/glb?glbUrl=fixture',
			replyLink: 'https://three.ws/forge',
			creationId: 'creation-fixture-1',
		});
		expect(row).toMatchObject({ decision: 'reply', reason: 'made', reply_text: 'Here is your lighthouse.', creation_id: 'creation-fixture-1', intent: 'make', dry_run: true, reply_tweet_id: null });
		expect(row.decided_at).not.toBeNull();
		const again = await store.updateDecision(m.id, { error: 'render slow' });
		expect(again).toMatchObject({ decision: 'reply', reply_text: 'Here is your lighthouse.', error: 'render slow' });
	});

	it('sets a reply tweet id once and never replaces it', async () => {
		const m = byId('1800000000000000101');
		await record(m);
		const first = await store.updateDecision(m.id, { decision: 'reply', replyTweetId: '1800000000000001001', dryRun: false });
		expect(first).toMatchObject({ reply_tweet_id: '1800000000000001001', dry_run: false });
		expect(first.replied_at).not.toBeNull();
		const second = await store.updateDecision(m.id, { replyTweetId: '1800000000000001002' });
		expect(second.reply_tweet_id).toBe('1800000000000001001');
		expect(new Date(second.replied_at).getTime()).toBe(new Date(first.replied_at).getTime());
	});

	it('returns null for an unknown mention and refuses an unknown decision', async () => {
		expect(await store.updateDecision('1800000000000009999', { decision: 'skip' })).toBeNull();
		await expect(store.updateDecision('1800000000000000101', { decision: 'launched' })).rejects.toMatchObject({ code: 'bad_decision' });
	});
});

describe('counts and recent decisions', () => {
	beforeEach(async () => {
		for (const m of MENTIONS) await record(m);
		// Two more from the same author (fixture_dee), one replied, one rate limited.
		const dee = byId('1800000000000000101');
		await record({ ...dee, id: '1800000000000000110' });
		await record({ ...dee, id: '1800000000000000111' });
		await store.updateDecision('1800000000000000101', { decision: 'reply' });
		await store.updateDecision('1800000000000000110', { decision: 'reply' });
		await store.updateDecision('1800000000000000111', { decision: 'rate_limited' });
		await store.updateDecision('1800000000000000107', { decision: 'skip' });
	});

	it('counts one author in a window, by decision and by account', async () => {
		expect(await store.countByAuthor('1700000000000000020')).toBe(3);
		expect(await store.countByAuthor('1700000000000000020', { decisions: ['reply'] })).toBe(2);
		expect(await store.countByAuthor('1700000000000000020', { decisions: ['reply', 'rate_limited'] })).toBe(3);
		expect(await store.countByAuthor('1700000000000000020', { account: { kind: 'agent', ref: 'agent-x' } })).toBe(0);
		expect(await store.countByAuthor('1700000000000000020', { account: { kind: 'company', ref: 'trythreews' } })).toBe(3);
		expect(await store.countByAuthor('1700000000000000099')).toBe(0);
	});

	it('the window excludes older rows', async () => {
		await dbState.pg.query(`update x_mention_events set created_at = now() - interval '2 hours' where tweet_id = '1800000000000000110'`);
		expect(await store.countByAuthor('1700000000000000020', { windowSeconds: 3600 })).toBe(2);
		expect(await store.countByAuthor('1700000000000000020', { windowSeconds: 3 * 3600 })).toBe(3);
	});

	it('lists recent decisions per account, newest first, filtered', async () => {
		const all = await store.recentDecisions({ kind: 'company', ref: 'trythreews' });
		expect(all).toHaveLength(MENTIONS.length + 2);
		const replies = await store.recentDecisions({ kind: 'company', ref: 'trythreews' }, { decision: 'reply', dryRun: true });
		expect(replies.map((r) => r.tweet_id).sort()).toEqual(['1800000000000000101', '1800000000000000110']);
		expect(await store.recentDecisions({ kind: 'agent', ref: 'agent-x' })).toEqual([]);
		expect(await store.recentDecisions({ kind: 'company', ref: 'trythreews' }, { limit: 2 })).toHaveLength(2);
	});
});

describe('cursor', () => {
	const acct = { kind: 'company', ref: 'trythreews' };

	it('uses the documented app_settings key', () => {
		expect(store.cursorKey(acct)).toBe('x_mentions_cursor:company:trythreews');
		expect(store.cursorKey({ kind: 'agent', ref: 'agent-1' })).toBe('x_mentions_cursor:agent:agent-1');
		expect(() => store.cursorKey({ kind: 'company', ref: '' })).toThrow(/account/);
	});

	it('starts empty, advances, and never moves back', async () => {
		expect(await store.getCursor(acct)).toBeNull();
		expect(await store.advanceCursor(acct, '1800000000000000104')).toBe(true);
		expect(await store.getCursor(acct)).toBe('1800000000000000104');
		expect(await store.advanceCursor(acct, '1800000000000000102')).toBe(false);
		expect(await store.getCursor(acct)).toBe('1800000000000000104');
		expect(await store.advanceCursor(acct, '1800000000000000107')).toBe(true);
		expect(await store.getCursor(acct)).toBe('1800000000000000107');
	});

	it('compares ids beyond 2^53 exactly', async () => {
		await store.advanceCursor(acct, '9007199254740993');
		expect(await store.advanceCursor(acct, '9007199254740992')).toBe(false);
		expect(await store.advanceCursor(acct, '9007199254740994')).toBe(true);
	});

	it('keeps accounts apart and refuses a non-id cursor', async () => {
		await store.advanceCursor(acct, '1800000000000000107');
		expect(await store.getCursor({ kind: 'agent', ref: 'agent-1' })).toBeNull();
		await expect(store.advanceCursor(acct, '1; drop table app_settings')).rejects.toMatchObject({ code: 'bad_cursor' });
	});
});

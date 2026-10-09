// The mention safety rules against the REAL x_mention_events migration
// (PGlite), the real poll loop and the real guard. Mention shapes follow the
// captured timeline fixture; only the reply brain and the X adapter are
// counted, never mocked away from the assertions.

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

const poll = await import('../api/_lib/x-mention-poll.js');
const store = await import('../api/_lib/x-mention-store.js');
const guard = await import('../api/_lib/x-mention-guard.js');
const bots = await import('../api/_lib/x-mention-known-bots.js');

const MIG = new URL('../api/_lib/migrations/', import.meta.url);
const MIGRATION = readFileSync(new URL('20261008170000_x_mention_events.sql', MIG), 'utf8');
const APP_SETTINGS = (() => {
	const src = readFileSync(new URL('20260922210000_free_tier_models.sql', MIG), 'utf8');
	const start = src.indexOf('CREATE TABLE IF NOT EXISTS app_settings');
	return src.slice(start, src.indexOf(');', start) + 2);
})();

const OWN_ID = '1700000000000000001';
const ACCOUNT = { kind: 'company', ref: 'trythreews', userId: OWN_ID, handle: 'trythreews' };
const ACCT = { kind: 'company', ref: 'trythreews' };
const NOW = Date.parse('2026-10-09T12:00:00Z');
let seq = 0;

/** A mention shaped like normalizeMentions output (fixture-derived). */
function mention(over = {}) {
	seq += 1;
	const id = String(1800000000000001000n + BigInt(seq));
	return {
		platform: 'x', id, text: '@trythreews make a bronze lighthouse', createdAt: '2026-10-09T11:59:00Z',
		chatId: id, conversationId: id, userId: '1700000000000000050', username: 'fixture_dan',
		author: { id: '1700000000000000050', username: 'fixture_dan', createdAt: '2025-01-01T00:00:00Z' },
		mentions: [{ username: 'trythreews', id: OWN_ID }], quoted: null, repliedTo: null, isRetweet: false, media: [],
		account: ACCOUNT, ...over,
	};
}

function seedReply(conversationId, { ageSeconds = 0 } = {}) {
	seq += 1;
	return dbState.pg.query(
		`insert into x_mention_events (tweet_id, account_kind, account_ref, author_id, conversation_id, intent, decision, created_at)
		 values ($1,'company','trythreews','1700000000000000077',$2,'chat','reply', now() - make_interval(secs => $3))`,
		[String(1799000000000000000n + BigInt(seq)), conversationId, ageSeconds],
	);
}

const run = (m, over = {}) => guard.guardMention({ mention: m, account: ACCOUNT, env: {}, now: NOW, ...over });

beforeEach(async () => {
	dbState.pg = new PGlite();
	await dbState.pg.exec(APP_SETTINGS);
	await dbState.pg.exec(MIGRATION);
});

describe('guard rules', () => {
	it('allows an ordinary mention', async () => {
		expect(await run(mention())).toEqual({ allow: true });
	});

	it('skips our own account by id and by handle', async () => {
		expect((await run(mention({ userId: OWN_ID, author: { id: OWN_ID, username: 'trythreews' } }))).reason).toBe('own_account');
		expect((await run(mention({ username: 'TryThreeWS' }))).reason).toBe('own_account');
		expect((await run(mention({ userId: '1700000000000000999' }), { env: { X_MENTION_OWN_USER_IDS: '1700000000000000999' } })).reason).toBe('own_account');
	});

	it('skips a blocklisted author', async () => {
		await dbState.pg.query(`insert into app_settings (key, value) values ($1, $2::jsonb)`, [guard.BLOCKLIST_KEY, JSON.stringify({ ids: ['1700000000000000050'] })]);
		const out = await run(mention());
		expect(out).toEqual({ allow: false, decision: 'skip', reason: 'author_blocked' });
		expect((await run(mention({ userId: '1700000000000000051', author: { id: '1700000000000000051', username: 'x', createdAt: null } }))).allow).toBe(true);
	});

	it('skips a known bot by cached id and by username', async () => {
		await dbState.pg.query(`insert into app_settings (key, value) values ($1, $2::jsonb)`, [bots.KNOWN_BOTS_KEY, JSON.stringify({ ids: { '1700000000000000060': 'grok' }, usernames: ['grok', 'bot'] })]);
		expect((await run(mention({ userId: '1700000000000000060', author: { id: '1700000000000000060', username: 'renamed', createdAt: null } }))).reason).toBe('known_bot');
		expect((await run(mention({ username: 'Bot', author: { id: '1700000000000000061', username: 'Bot', createdAt: null } }))).reason).toBe('known_bot');
	});

	it('skips a known bot that only quotes our post, with its own reason', async () => {
		const quoteOnly = mention({
			username: 'grok', userId: '1700000000000000060', author: { id: '1700000000000000060', username: 'grok', createdAt: null },
			mentions: [], quoted: { id: '1800000000000000001', available: true, author: { id: OWN_ID, username: 'trythreews' } },
		});
		expect((await run(quoteOnly)).reason).toBe('bot_quote_of_own_post');
	});

	it('skips an author younger than 24 hours and allows one that is older or unknown', async () => {
		const young = mention({ author: { id: '1700000000000000050', username: 'fixture_dan', createdAt: '2026-10-09T01:00:00Z' } });
		expect((await run(young)).reason).toBe('new_account');
		const old = mention({ author: { id: '1700000000000000050', username: 'fixture_dan', createdAt: '2026-10-08T11:00:00Z' } });
		expect((await run(old)).allow).toBe(true);
		const unknown = mention({ author: { id: '1700000000000000050', username: 'fixture_dan', createdAt: null } });
		expect((await run(unknown)).allow).toBe(true);
	});

	it('allows only one reply per conversation per hour', async () => {
		const m = mention();
		await seedReply(m.conversationId, { ageSeconds: 600 });
		expect((await run(m)).reason).toBe('conversation_hourly');
		const m2 = mention();
		await seedReply(m2.conversationId, { ageSeconds: 7200 });
		expect((await run(m2)).allow).toBe(true);
	});

	it('never replies in a conversation where we already replied twice', async () => {
		const m = mention();
		await seedReply(m.conversationId, { ageSeconds: 7200 });
		await seedReply(m.conversationId, { ageSeconds: 9000 });
		expect((await run(m)).reason).toBe('conversation_depth');
	});
});

describe('the kill switch', () => {
	const compose = vi.fn(async () => ({ text: 'hi', source: 'model', reason: null }));
	const adapterFactory = vi.fn();
	beforeEach(() => { compose.mockClear(); adapterFactory.mockClear(); });

	const handle = (m, env) => poll.handleMention({ mention: m, account: ACCOUNT, limits: poll.replyLimits({}), env, compose, adapterFactory });

	it('env X_MENTION_BOT_PAUSED=1 records paused and calls no handler', async () => {
		const m = mention();
		const out = await handle(m, { X_MENTION_BOT_PAUSED: '1' });
		expect(out).toMatchObject({ decision: 'paused', reason: 'kill_switch' });
		expect(compose).not.toHaveBeenCalled();
		expect(adapterFactory).not.toHaveBeenCalled();
		const row = await store.getMentionEvent(m.id);
		expect(row.decision).toBe('paused');
		expect(row.reply_text).toBeNull();
	});

	it('the app_settings row pauses without a redeploy', async () => {
		await dbState.pg.query(`insert into app_settings (key, value) values ($1, '{"paused": true}'::jsonb)`, [guard.PAUSE_KEY]);
		const out = await handle(mention(), {});
		expect(out.decision).toBe('paused');
		expect(compose).not.toHaveBeenCalled();
		expect(adapterFactory).not.toHaveBeenCalled();
	});

	it('a settings read failure fails closed', async () => {
		expect(await guard.isPaused({}, async () => { throw new Error('db down'); })).toBe(true);
		expect(await guard.isPaused({}, async () => null)).toBe(false);
	});

	it('a guarded skip reaches neither the reply brain nor the adapter', async () => {
		const m = mention({ text: '@trythreews how are you today', username: 'grok', userId: '1700000000000000060', author: { id: '1700000000000000060', username: 'grok', createdAt: null } });
		const out = await handle(m, {});
		expect(out).toMatchObject({ decision: 'skip', reason: 'known_bot' });
		expect(compose).not.toHaveBeenCalled();
		expect(adapterFactory).not.toHaveBeenCalled();
		expect((await store.getMentionEvent(m.id)).reason).toBe('known_bot');
	});
});

describe('the known-bot list', () => {
	const lookup = (users, status = 200) => vi.fn(async () => ({ status, headers: {}, body: { data: users } }));

	it('resolves ids from usernames, caches them and records the unresolved', async () => {
		const request = lookup([{ id: '1700000000000000060', username: 'grok', created_at: '2024-01-01T00:00:00Z' }]);
		const out = await bots.ensureKnownBots({ env: {}, request, now: NOW });
		expect(out).toMatchObject({ refreshed: true, resolved: 1, unresolved: ['bot'] });
		expect(request.mock.calls[0][0]).toBe('users/by');
		expect(request.mock.calls[0][1].usernames).toBe('grok,bot');
		const matcher = await bots.loadKnownBots({ env: {} });
		expect(matcher.isKnownBot({ id: '1700000000000000060', username: 'whatever' })).toBe(true);
		expect(matcher.isKnownBot({ id: '1', username: 'bot' })).toBe(true);
		expect(matcher.isKnownBot({ id: '1', username: 'alice' })).toBe(false);
	});

	it('refreshes at most daily', async () => {
		const request = lookup([{ id: '1700000000000000060', username: 'grok' }]);
		await bots.ensureKnownBots({ env: {}, request, now: NOW });
		const again = await bots.ensureKnownBots({ env: {}, request, now: NOW + 3600_000 });
		expect(again.refreshed).toBe(false);
		expect(request).toHaveBeenCalledTimes(1);
		await bots.ensureKnownBots({ env: {}, request, now: NOW + 25 * 3600_000 });
		expect(request).toHaveBeenCalledTimes(2);
	});

	it('keeps the username list working when X refuses the lookup', async () => {
		const request = vi.fn(async () => ({ status: 403, headers: {}, body: { title: 'Forbidden' } }));
		const out = await bots.ensureKnownBots({ env: {}, request, now: NOW });
		expect(out.refreshed).toBe(false);
		expect(out.unresolved).toEqual(['grok', 'bot']);
		const matcher = await bots.loadKnownBots({ env: {} });
		expect(matcher.isKnownBot({ id: '5', username: 'grok' })).toBe(true);
	});

	it('takes extra usernames from X_MENTION_KNOWN_BOTS', () => {
		expect(bots.knownBotUsernames({ X_MENTION_KNOWN_BOTS: '@SomeBot, other' })).toEqual(['grok', 'bot', 'somebot', 'other']);
	});
});

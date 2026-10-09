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
const make = await import('../api/_lib/x-mention-make.js');
const avatar = await import('../api/_lib/x-mention-avatar.js');
const image3d = await import('../api/_lib/x-mention-image3d.js');
const { createDeliver } = await import('../api/_lib/x-mention-deliver.js');
const { createXAdapter } = await import('../api/_lib/gateway/adapters/x.js');

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
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2048, 7)]);
const I3D_BASE = 'https://three.test';
const I3D_CREATION = '7a2e4b63-1d3f-4c8f-8b69-2a1b0b5c8d21';
const I3D_DONE = { status: 'done', glb_url: 'https://cdn.three.test/forge/sneaker.glb', creation_id: I3D_CREATION };
/** The real image3d handler with only its network edges (CDN, vision, image store, 3D lane) replaced. */
const image3dEdges = (extra = {}) => ({
	base: I3D_BASE,
	probeMedia: async () => true,
	fetchImpl: async () => new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } }),
	describe: async () => ({ json: { safe: true, usable: true, subject: 'red sneaker' } }),
	persist: async () => 'https://cdn.three.test/forge/refs/x.png',
	startForge: async () => I3D_DONE,
	...extra,
});
const deps = (extra = {}) => ({ request, resolvedAccount: COMPANY, compose, image3d: (e) => image3d.handleImage3d(e, image3dEdges()), ...extra });

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

	it('routes the make and launch intents (later orders) to help with handler_not_built', async () => {
		await poll.pollAccount({ descriptor: DESCRIPTOR, env: {}, deps: deps() });
		const rows = await store.recentDecisions(ACCT, { limit: 50 });
		const unbuilt = rows.filter((r) => ['make', 'launch'].includes(r.intent) && r.decision === 'reply');
		for (const r of unbuilt) expect(r.reason).toBe('handler_not_built');
	});

	it('answers an image3d mention with the image3d handler, not help', async () => {
		const id = '1900000000000000100';
		const mention = {
			id, userId: '42', username: 'alice', text: '@trythreews 3D this', createdAt: new Date().toISOString(), conversationId: id, account: ACCT,
			mentions: [{ username: 'trythreews', id: COMPANY.userId }], urls: [],
			media: [{ key: '3_1', type: 'photo', url: 'https://pbs.twimg.com/media/GxQ1aBcWsAAbCdE.jpg', width: 1200, height: 900 }],
			inReplyToUserId: null, repliedTo: null, quoted: null, isRetweet: false, fromSelf: false,
		};
		const budget = { readGate: async () => ({ allow: true }), budgetGate: async () => ({ allow: true }), recordPosts: vi.fn(async () => {}) };
		const out = await poll.handleMention({
			mention, account: COMPANY, limits: poll.replyLimits({}), env: {}, budget, paused: async () => false,
			guard: async () => ({ allow: true }), image3d: (e) => image3d.handleImage3d(e, image3dEdges()),
		});
		expect(out).toMatchObject({ intent: 'image3d', decision: 'reply', reason: 'image3d_done', dry_run: true });
		expect(out.text).toContain(`/m/${I3D_CREATION}`);
		expect(budget.recordPosts).toHaveBeenCalledWith(1);
		expect(await store.getMentionEvent(id)).toMatchObject({ intent: 'image3d', decision: 'reply', reason: 'image3d_done', dry_run: true, reply_tweet_id: null });
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

describe('late-reply follow-ups', () => {
	const BASE = 'https://three.test';
	const DONE = { status: 'done', glb_url: 'https://cdn.three.test/m.glb', creation_id: '11111111-1111-4111-8111-111111111111', preview_image_url: 'https://cdn.three.test/m.png' };
	const ids = { make: '1900000000000000001', avatar: '1900000000000000002', image3d: '1900000000000000003' };
	const open = { paused: async () => false, budget: { readGate: async () => ({ allow: true }), recordPosts: vi.fn(async () => {}) } };

	async function pending(intent, id, dryRun) {
		await store.recordMention({
			mention: { id, userId: '42', username: 'alice', text: `@trythreews ${intent}`, conversationId: id, account: ACCT },
			parsed: { intent, args: { [intent]: { job_id: `job-${intent}`, stage: 'mesh', prompt: 'a dragon', started_at: new Date().toISOString() } } },
			dryRun,
			decision: 'pending',
		});
	}
	const finishers = (post) => ({
		finishPendingMakes: (o, d) => make.finishPendingMakes(o, { ...d, base: BASE, pollOnce: async () => DONE }),
		finishPendingAvatars: (o, d) => avatar.finishPendingAvatars(o, { ...d, base: BASE, pollOnce: async () => DONE, startRig: async () => { throw Object.assign(new Error('no rig'), { code: 'rig_down' }); } }),
		finishPendingImage3d: (o, d) => image3d.finishPendingImage3d(o, { ...d, base: BASE, pollOnce: async () => DONE, probeMedia: async () => true }),
		getAccessToken: post ? () => async () => 'tok' : undefined,
		adapterFactory: post ? (o) => createXAdapter({ ...o, post, fetchMedia: async () => ({ buffer: Buffer.from('x'), mimeType: 'image/png' }), uploadMedia: async () => 'media-1', env: { X_MENTION_BOT_LIVE: '1' } }) : undefined,
	});

	beforeEach(async () => {
		open.budget.recordPosts.mockClear();
	});

	it('a dry row is settled and recorded through the adapter, never posted', async () => {
		await pending('make', ids.make, true);
		const post = vi.fn();
		const out = await poll.runFollowUps({ env: { X_MENTION_BOT_LIVE: '1' }, deps: { ...open, ...finishers(post) } });
		expect(out.makeFollowUp).toMatchObject({ checked: 1, replied: 1 });
		expect(post).not.toHaveBeenCalled();
		expect(await store.getMentionEvent(ids.make)).toMatchObject({ decision: 'reply', dry_run: true, reply_tweet_id: null });
	});

	it('a live row is posted through the adapter and no longer held as paused', async () => {
		await pending('make', ids.make, false);
		await pending('avatar', ids.avatar, false);
		const post = vi.fn(async () => ({ id: '2900000000000000001' }));
		const out = await poll.runFollowUps({ env: { X_MENTION_BOT_LIVE: '1' }, deps: { ...open, ...finishers(post) } });
		expect(out.makeFollowUp).toMatchObject({ replied: 1 });
		expect(out.avatarFollowUp).toMatchObject({ replied: 1 });
		expect(post).toHaveBeenCalledTimes(2);
		expect(post.mock.calls[0][0]).toMatchObject({ accessToken: 'tok', replyTo: expect.any(String), mediaIds: ['media-1'] });
		const row = await store.getMentionEvent(ids.make);
		expect(row).toMatchObject({ decision: 'reply', dry_run: false, reply_tweet_id: '2900000000000000001' });
		expect(open.budget.recordPosts).toHaveBeenCalledTimes(2);
	});

	it('a live row without a token resolver stays in dry run instead of posting', async () => {
		await pending('make', ids.make, false);
		const deliver = createDeliver({ env: { X_MENTION_BOT_LIVE: '1' } });
		await dbState.pg.query(`update x_mention_events set decision = 'reply' where tweet_id = $1`, [ids.make]);
		expect(await deliver({ text: 'done', inReplyToTweetId: ids.make })).toBeNull();
		expect(await store.getMentionEvent(ids.make)).toMatchObject({ dry_run: true, reply_text: 'done', reply_tweet_id: null });
	});

	it('a pending image3d row is settled late and delivered through the same adapter', async () => {
		await pending('image3d', ids.image3d, false);
		const post = vi.fn(async () => ({ id: '2900000000000000009' }));
		const out = await poll.runFollowUps({ env: { X_MENTION_BOT_LIVE: '1' }, deps: { ...open, ...finishers(post) } });
		expect(out.image3dFollowUp).toMatchObject({ checked: 1, replied: 1 });
		expect(post).toHaveBeenCalledTimes(1);
		expect(await store.getMentionEvent(ids.image3d)).toMatchObject({ intent: 'image3d', decision: 'reply', reason: 'image3d_done_late', dry_run: false, reply_tweet_id: '2900000000000000009' });
		expect(open.budget.recordPosts).toHaveBeenCalledTimes(1);
	});

	it('a dry image3d row is recorded and never posted', async () => {
		await pending('image3d', ids.image3d, true);
		const post = vi.fn();
		const out = await poll.runFollowUps({ env: { X_MENTION_BOT_LIVE: '1' }, deps: { ...open, ...finishers(post) } });
		expect(out.image3dFollowUp).toMatchObject({ replied: 1 });
		expect(post).not.toHaveBeenCalled();
		expect(await store.getMentionEvent(ids.image3d)).toMatchObject({ decision: 'reply', dry_run: true, reply_tweet_id: null });
	});

	it('a failing image3d finisher does not stop makes or avatars', async () => {
		const ok = vi.fn(async () => ({ checked: 0 }));
		const out = await poll.runFollowUps({ env: {}, deps: { ...open, finishPendingMakes: ok, finishPendingAvatars: ok, finishPendingImage3d: async () => { throw new Error('i3d boom'); } } });
		expect(out.image3dFollowUp).toEqual({ error: 'i3d boom' });
		expect(ok).toHaveBeenCalledTimes(2);
	});

	it('one failing finisher does not stop the other', async () => {
		const avatarOnly = vi.fn(async () => ({ checked: 0 }));
		const out = await poll.runFollowUps({ env: {}, deps: { ...open, finishPendingMakes: async () => { throw new Error('boom'); }, finishPendingAvatars: avatarOnly } });
		expect(out.makeFollowUp).toEqual({ error: 'boom' });
		expect(out.avatarFollowUp).toEqual({ checked: 0 });
	});

	it('the kill switch and the budget gate skip both finishers', async () => {
		const spy = vi.fn(async () => ({}));
		const killed = await poll.runFollowUps({ env: {}, deps: { ...open, paused: async () => true, finishPendingMakes: spy, finishPendingAvatars: spy, finishPendingImage3d: spy } });
		expect(killed).toEqual({ followUps: { skipped: 'kill_switch' } });
		const broke = await poll.runFollowUps({ env: {}, deps: { ...open, budget: { readGate: async () => ({ allow: false, reason: 'daily_cap' }) }, finishPendingMakes: spy, finishPendingAvatars: spy, finishPendingImage3d: spy } });
		expect(broke).toMatchObject({ followUps: { skipped: 'budget', reason: 'daily_cap' } });
		expect(spy).not.toHaveBeenCalled();
	});

	it('a tick runs all three finishers', async () => {
		const m = vi.fn(async () => ({ checked: 0 }));
		const a = vi.fn(async () => ({ checked: 0 }));
		const i = vi.fn(async () => ({ checked: 0 }));
		const report = await poll.runMentionTick({ env: {}, deps: { acquireLock: async () => 'h', releaseLock: async () => {}, listAccounts: async () => [DESCRIPTOR], request, resolvedAccount: COMPANY, ...open, finishPendingMakes: m, finishPendingAvatars: a, finishPendingImage3d: i } });
		expect(m).toHaveBeenCalledTimes(1);
		expect(a).toHaveBeenCalledTimes(1);
		expect(i).toHaveBeenCalledTimes(1);
		expect(report).toMatchObject({ makeFollowUp: { checked: 0 }, avatarFollowUp: { checked: 0 }, image3dFollowUp: { checked: 0 } });
	});
});

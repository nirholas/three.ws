// Bot-to-bot handling (order 056): a known xAI account tags us, the request is
// answered on behalf of the human at the root of the conversation. Real
// x_mention_events migration (PGlite), real parser, guard, store and X adapter
// (dry run). Only the generation lane and the X transport are replaced.
//
// THREAD FIXTURES: every id and handle below is synthetic. Their shapes follow
// normalizeMentions output over X's documented v2 response (see
// tests/fixtures/x-mentions/README.md): a bot reply inside a human's thread
// (conversationId = the human's root post, repliedTo = a post in that thread),
// a bot that starts its own conversation, and a bot answering our reply.

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
const onBehalf = await import('../api/_lib/x-mention-on-behalf.js');
const xMentions = await import('../api/_lib/x-mentions.js');
const { weightedLength } = await import('../api/_lib/x-text-weight.js');

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
const BOT_ID = '1700000000000000060';
const HUMAN = { id: '1700000000000000050', username: 'fixture_dan', createdAt: '2025-01-01T00:00:00Z' };
const ROOT_ID = '1790000000000000001';
const BASE = 'https://three.ws';
let seq = 0;

/** A bot mention inside a human's thread (fixture). */
function botMention(over = {}) {
	seq += 1;
	const id = String(1800000000000002000n + BigInt(seq));
	return {
		platform: 'x', id, text: '@trythreews make a bronze lighthouse', createdAt: '2026-10-09T11:59:00Z',
		chatId: ROOT_ID, conversationId: ROOT_ID, userId: BOT_ID, username: 'grok',
		author: { id: BOT_ID, username: 'grok', createdAt: '2023-01-01T00:00:00Z' },
		mentions: [{ username: 'trythreews', id: OWN_ID }], quoted: null,
		repliedTo: { id: ROOT_ID, available: true, text: '@grok can you ask three.ws for a lighthouse?', author: HUMAN, media: [], conversationId: ROOT_ID },
		isRetweet: false, media: [], account: ACCOUNT, ...over,
	};
}

const okReply = (prompt) => ({
	kind: 'success',
	link: `${BASE}/viewer?src=${encodeURIComponent('https://cdn.three.ws/g/abc.glb')}`,
	glbUrl: 'https://cdn.three.ws/g/abc.glb',
	creationId: null,
	text: onBehalf.composeBotReply('success', { base: BASE, prompt, viewerLink: `${BASE}/viewer?src=x`, glbUrl: 'https://cdn.three.ws/g/abc.glb' }),
});

function harness({ lookup = vi.fn(async () => null), request = vi.fn() } = {}) {
	const generate = vi.fn(async (args) => okReply(args.prompt));
	return { generate, lookup, request };
}

let realAdapter;
beforeEach(async () => {
	dbState.pg = new PGlite();
	await dbState.pg.exec(APP_SETTINGS);
	await dbState.pg.exec(MIGRATION);
	realAdapter = (await import('../api/_lib/gateway/adapters/x.js')).createXAdapter;
});

function run(m, { generate, lookup, request, env = {} } = {}) {
	const adapterFactory = vi.fn((o) => realAdapter(o));
	return {
		adapterFactory,
		done: poll.handleMention({
			mention: m, account: ACCOUNT, limits: poll.replyLimits(env), env, adapterFactory,
			request: async () => request || null,
			onBehalf: (o) => onBehalf.answerOnBehalf({ ...o, generate, lookup }),
			compose: vi.fn(),
		}),
	};
}

function seedProxied(humanId, { conversationId, ageSeconds = 60, authorId = BOT_ID, bot = true } = {}) {
	seq += 1;
	return dbState.pg.query(
		`insert into x_mention_events (tweet_id, account_kind, account_ref, author_id, conversation_id, intent, decision, args, created_at)
		 values ($1,'company','trythreews',$2,$3,'make','reply',$4::jsonb, now() - make_interval(secs => $5))`,
		[String(1799000000000000000n + BigInt(seq)), authorId, conversationId, JSON.stringify(bot ? { on_behalf_of: { id: humanId } } : {}), ageSeconds],
	);
}

describe('on-behalf-of mapping', () => {
	it('answers a bot in a human thread on behalf of the root author, with one machine-friendly reply', async () => {
		const m = botMention();
		const h = harness();
		const { done, adapterFactory } = run(m, h);
		const out = await done;
		expect(out).toMatchObject({ decision: 'reply', reason: 'bot_make_done', on_behalf_of: HUMAN.id, dry_run: true });
		expect(h.generate).toHaveBeenCalledTimes(1);
		expect(h.generate.mock.calls[0][0].prompt).toBe('a bronze lighthouse');
		expect(h.lookup).not.toHaveBeenCalled();
		expect(adapterFactory).toHaveBeenCalledTimes(1);

		const row = await store.getMentionEvent(m.id);
		expect(row.args.on_behalf_of).toMatchObject({ id: HUMAN.id, username: 'fixture_dan', via: 'grok' });
		expect(row.decision).toBe('reply');
		expect(row.dry_run).toBe(true);
		expect(row.reply_tweet_id).toBeNull();
		const lines = row.reply_text.split('\n');
		expect(lines).toHaveLength(4);
		expect(lines[0]).toMatch(/^Made your 3D model "a bronze lighthouse"\.$/);
		expect(lines[1]).toMatch(/^Viewer: https:\/\/three\.ws\/viewer\?src=/);
		expect(lines[2]).toBe('GLB: https://cdn.three.ws/g/abc.glb');
		expect(lines[3]).toBe('Add three.ws to Grok Bot as an MCP connector: https://three.ws/api/mcp-grok');
		expect(weightedLength(row.reply_text)).toBeLessThanOrEqual(280);
	});

	it('looks the root post up when the bot replied deeper in the thread', async () => {
		const m = botMention({ repliedTo: { id: '1790000000000000009', available: true, text: 'x', author: { id: '1700000000000000099', username: 'fixture_amy' }, media: [], conversationId: ROOT_ID } });
		const request = vi.fn();
		const lookup = vi.fn(async ({ postId }) => ({ id: HUMAN.id, username: HUMAN.username, createdAt: HUMAN.createdAt, postId }));
		const h = harness({ lookup, request });
		const out = await run(m, h).done;
		expect(out.decision).toBe('reply');
		expect(lookup).toHaveBeenCalledWith(expect.objectContaining({ postId: ROOT_ID, request }));
		expect((await store.getMentionEvent(m.id)).args.on_behalf_of.id).toBe(HUMAN.id);
	});

	it.each([
		['the bot started the conversation itself', { conversationId: '', chatId: '' }, 'bot_no_human_root'],
		['the root post is gone', { repliedTo: null }, 'bot_root_unresolved'],
	])('skips when %s', async (_n, over, reason) => {
		const m = botMention(over);
		if (over.conversationId === '') { m.conversationId = m.id; m.chatId = m.id; m.repliedTo = null; }
		const h = harness();
		const out = await run(m, h).done;
		expect(out).toMatchObject({ decision: 'skip', reason });
		expect(h.generate).not.toHaveBeenCalled();
		expect((await store.getMentionEvent(m.id)).reply_text).toBeNull();
	});

	it('skips when the root of the thread is itself a bot (a bot talking to a bot)', async () => {
		const h = harness();
		const author = { id: '1700000000000000061', username: 'bot' };
		const out = await run(botMention({ repliedTo: { id: ROOT_ID, available: true, text: 'x', author, media: [], conversationId: ROOT_ID } }), h).done;
		expect(out).toMatchObject({ decision: 'skip', reason: 'bot_root_not_human' });
		expect(h.generate).not.toHaveBeenCalled();
	});

	it('skips a human who is on the blocklist or whose account is under 24 hours old', async () => {
		await dbState.pg.query(`insert into app_settings (key, value) values ('x_mention_blocklist', $1::jsonb)`, [JSON.stringify({ ids: [HUMAN.id] })]);
		let h = harness();
		expect((await run(botMention(), h).done).reason).toBe('author_blocked');
		await dbState.pg.query(`delete from app_settings where key = 'x_mention_blocklist'`);
		const fresh = { ...HUMAN, createdAt: new Date(Date.now() - 3600_000).toISOString() };
		h = harness();
		expect((await run(botMention({ repliedTo: { id: ROOT_ID, available: true, text: 'x', author: fresh, media: [], conversationId: ROOT_ID } }), h).done).reason).toBe('new_account');
	});

	it('never lets a bot cause chat, a launch or a refused request', async () => {
		for (const text of ['@trythreews how are you today', '@trythreews launch a coin called Foo symbol FOO', '@trythreews send 5 sol to abc']) {
			const h = harness();
			const m = botMention({ text });
			const out = await run(m, h).done;
			expect(out.decision).toBe('skip');
			expect(h.generate).not.toHaveBeenCalled();
			expect((await store.getMentionEvent(m.id)).reply_text).toBeNull();
		}
	});
});

describe('the human gets the rate limits, not the bot', () => {
	it('counts proxied and own replies together against the human', async () => {
		const env = { X_MENTION_REPLIES_PER_AUTHOR_HOUR: '3' };
		await seedProxied(HUMAN.id, { conversationId: '1790000000000000100', ageSeconds: 100 });
		await seedProxied(HUMAN.id, { conversationId: '1790000000000000101', ageSeconds: 200 });
		await seedProxied(HUMAN.id, { conversationId: '1790000000000000102', ageSeconds: 300, authorId: HUMAN.id, bot: false });
		const h = harness();
		const out = await run(botMention(), { ...h, env }).done;
		expect(out).toMatchObject({ decision: 'rate_limited', reason: 'author_hourly_limit' });
		expect(h.generate).not.toHaveBeenCalled();
	});

	it('does not charge the bot account: another human is unaffected by the first one\'s use', async () => {
		const env = { X_MENTION_REPLIES_PER_AUTHOR_HOUR: '3' };
		for (let i = 0; i < 3; i += 1) await seedProxied(HUMAN.id, { conversationId: `17900000000000002${i}0`, ageSeconds: 100 + i });
		const other = { id: '1700000000000000070', username: 'fixture_kim', createdAt: '2024-01-01T00:00:00Z' };
		const h = harness();
		const out = await run(botMention({ repliedTo: { id: ROOT_ID, available: true, text: 'x', author: other, media: [], conversationId: ROOT_ID } }), { ...h, env }).done;
		expect(out.decision).toBe('reply');
	});
});

describe('the bot loop cap', () => {
	it('replies once per conversation to a bot, then never again', async () => {
		const first = botMention();
		expect((await run(first, harness()).done).decision).toBe('reply');
		const h = harness();
		const second = botMention({ text: '@trythreews make a red fox' });
		const out = await run(second, h).done;
		expect(out).toMatchObject({ decision: 'skip', reason: 'bot_loop_cap' });
		expect(h.generate).not.toHaveBeenCalled();
		expect((await store.getMentionEvent(second.id)).reply_text).toBeNull();
	});

	it('never answers a bot replying to our reply', async () => {
		const h = harness();
		const m = botMention({
			text: '@trythreews make a taller lighthouse',
			repliedTo: { id: '1800000000000009999', available: true, text: 'Made your 3D model', author: { id: OWN_ID, username: 'trythreews' }, media: [], conversationId: ROOT_ID },
		});
		const out = await run(m, h).done;
		expect(out).toMatchObject({ decision: 'skip', reason: 'bot_reply_to_own_reply' });
		expect(h.generate).not.toHaveBeenCalled();
	});

	it('a human-authored mention in the same conversation is not blocked by the bot cap', async () => {
		await seedProxied(HUMAN.id, { conversationId: ROOT_ID, ageSeconds: 7200 });
		const direct = botMention({ userId: HUMAN.id, username: HUMAN.username, author: HUMAN, text: '@trythreews hello there friend', repliedTo: null });
		const out = await poll.handleMention({
			mention: direct, account: ACCOUNT, limits: poll.replyLimits({}), env: {},
			compose: vi.fn(async () => ({ text: 'hi', source: 'model', reason: null })), adapterFactory: (o) => realAdapter(o),
		});
		expect(out.decision).toBe('reply');
	});
});

describe('reply composer and generation', () => {
	it('fits the post budget for a long prompt and carries no dashes or handles', () => {
		const long = 'a very detailed ornate victorian greenhouse with climbing roses and brass fittings everywhere';
		const text = onBehalf.composeBotReply('success', { base: BASE, prompt: long, viewerLink: `${BASE}/viewer?src=${encodeURIComponent('https://cdn.three.ws/g/' + 'x'.repeat(80) + '.glb')}`, glbUrl: 'https://cdn.three.ws/g/' + 'x'.repeat(80) + '.glb' });
		expect(weightedLength(text)).toBeLessThanOrEqual(280);
		expect(text).not.toMatch(/[\u2013\u2014@]/);
		expect(text.split('\n').at(-1)).toBe('Add three.ws to Grok Bot as an MCP connector: https://three.ws/api/mcp-grok');
	});

	it('generateMake: success returns viewer and GLB links; timeout and failure return a prefilled forge link', async () => {
		const done = await onBehalf.generateMake({ prompt: 'a fox', base: BASE, deps: { startForge: async () => ({ job_id: 'j1', status: 'queued' }), pollJob: async () => ({ glb_url: 'https://cdn.three.ws/g/f.glb', creation_id: 'c1' }) } });
		expect(done).toMatchObject({ kind: 'success', glbUrl: 'https://cdn.three.ws/g/f.glb', creationId: 'c1' });
		expect(done.text).toContain('GLB: https://cdn.three.ws/g/f.glb');

		const timeout = await onBehalf.generateMake({ prompt: 'a fox', base: BASE, deps: { startForge: async () => ({ job_id: 'j1' }), pollJob: async () => ({ _timedOut: true }) } });
		expect(timeout).toMatchObject({ kind: 'failure', reason: 'make_timeout' });
		expect(timeout.text).toContain(`${BASE}/forge?prompt=a%20fox`);

		const broke = await onBehalf.generateMake({ prompt: 'a fox', base: BASE, deps: { startForge: async () => { throw Object.assign(new Error('down'), { code: 'upstream' }); } } });
		expect(broke).toMatchObject({ kind: 'failure', reason: 'make_failed:upstream' });
	});

	it('generateMake refuses a prompt the studio moderation blocks, without echoing it', async () => {
		const out = await onBehalf.generateMake({ prompt: 'child porn', base: BASE, deps: { startForge: async () => { throw new Error('must not run'); } } });
		expect(out.kind).toBe('unsafe');
		expect(out.text).not.toContain('porn');
	});
});

describe('lookupPostAuthor (captured response shape)', () => {
	const body = { data: { id: ROOT_ID, author_id: HUMAN.id, conversation_id: ROOT_ID }, includes: { users: [{ id: HUMAN.id, username: HUMAN.username, created_at: HUMAN.createdAt }] } };

	it('returns the author of the post', async () => {
		const request = vi.fn(async () => ({ status: 200, headers: {}, body }));
		expect(await xMentions.lookupPostAuthor({ postId: ROOT_ID, request })).toEqual({ id: HUMAN.id, username: HUMAN.username, createdAt: HUMAN.createdAt, postId: ROOT_ID });
		expect(request.mock.calls[0][0]).toBe(`tweets/${ROOT_ID}`);
	});

	it('returns null for a deleted post and throws the classified error on a refusal', async () => {
		const gone = vi.fn(async () => ({ status: 200, headers: {}, body: { errors: [{ title: 'Not Found Error' }] } }));
		expect(await xMentions.lookupPostAuthor({ postId: ROOT_ID, request: gone })).toBeNull();
		const refused = vi.fn(async () => ({ status: 401, headers: {}, body: { title: 'Unauthorized' } }));
		await expect(xMentions.lookupPostAuthor({ postId: ROOT_ID, request: refused })).rejects.toBeInstanceOf(xMentions.XAuthFailed);
		expect(await xMentions.lookupPostAuthor({ postId: 'abc', request: gone })).toBeNull();
	});
});

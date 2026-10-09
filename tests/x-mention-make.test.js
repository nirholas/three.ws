// The X mention bot's `make` flow against real Postgres semantics (PGlite)
// and the real migrations for x_mention_events and the x_author_id column.
// Only the 3D generator's network edge is replaced, by functions returning the
// shapes /api/gpt-forge answers with (queued, done, failed, timed out).
// Moderation, the reply copy, the store and the attribution run for real.

import { readFileSync } from 'node:fs';
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

const make = await import('../api/_lib/x-mention-make.js');
const store = await import('../api/_lib/x-mention-store.js');
const { weightedLength } = await import('../api/_lib/x-text-weight.js');

const MIG = new URL('../api/_lib/migrations/', import.meta.url);
const read = (f) => readFileSync(new URL(f, MIG), 'utf8');

// users and forge_creations reduced to the columns the make flow touches;
// x_author_id comes from the real migration file.
const BASE_SCHEMA = `
	create table users (
		id uuid primary key default gen_random_uuid(), email text not null unique, display_name text, username text,
		plan text not null default 'free', email_verified boolean not null default false,
		service_account boolean not null default false, created_at timestamptz default now(), updated_at timestamptz default now()
	);
	create unique index users_username_unique on users(lower(username)) where username is not null;
	create table forge_creations (
		id uuid primary key, user_id uuid, visibility text, updated_at timestamptz default now()
	);
`;

const BASE = 'https://three.test';
const CREATION = '6f1d3a52-0c2e-4b7e-9a58-1f0a9a4b7c10';
const GLB = 'https://cdn.three.test/forge/dragon.glb';
let seq = 0;

async function mentionRow({ prompt = 'a 3D dragon', dryRun = true } = {}) {
	seq += 1;
	const tweetId = String(1900000000000000000n + BigInt(seq));
	const mention = {
		id: tweetId, userId: '1800000000000000042', username: 'asker', text: `@trythreews make ${prompt}`,
		conversationId: tweetId, account: { kind: 'company', ref: 'trythreews', userId: '1700000000000000001', handle: 'trythreews' },
	};
	await store.recordMention({ mention, parsed: { intent: 'make', args: { prompt }, reason: 'command:make' }, dryRun });
	return { tweetId, authorId: mention.userId, prompt, dryRun };
}

const noDirector = { directPrompt: async () => null, base: BASE };
const doneJob = { status: 'done', glb_url: GLB, creation_id: CREATION };

async function seedCreation() {
	await dbState.pg.query('insert into forge_creations (id) values ($1)', [CREATION]);
}

beforeEach(async () => {
	dbState.pg = new PGlite();
	await dbState.pg.exec(BASE_SCHEMA);
	await dbState.pg.exec(read('20261008170000_x_mention_events.sql'));
	await dbState.pg.exec(read('20261009201500_forge_creations_x_author.sql'));
	await seedCreation();
});

describe('reply copy', () => {
	it('names the prompt back shortened and drops cashtags, hashtags and quotes', () => {
		expect(make.shortenPrompt('a "dragon" #nft $FAKE guarding gold coins in a very deep dark cave system')).toBe('a dragon guarding gold coins in a very...');
	});

	it('keeps every end state inside one post and free of dash glyphs', () => {
		const long = 'x'.repeat(400);
		for (const kind of ['success', 'failure']) {
			const text = make.composeMakeReply(kind, { prompt: long, link: `${BASE}/forge?prompt=${long}` });
			expect(weightedLength(text)).toBeLessThanOrEqual(280);
			expect(text).not.toMatch(/[\u2013\u2014]/);
		}
		expect(make.composeMakeReply('unsafe')).not.toMatch(/[\u2013\u2014]/);
	});
});

describe('success path', () => {
	it('replies with the rendered PNG and the creation link, and attributes the creation', async () => {
		const ev = await mentionRow();
		const deliver = vi.fn();
		const res = await make.handleMake(ev, { ...noDirector, deliver, startForge: async () => doneJob });
		expect(res.outcome).toBe('reply');
		expect(res.link).toBe(`${BASE}/m/${CREATION}`);
		expect(res.mediaUrl).toBe(`${BASE}/api/render/glb?glbUrl=${encodeURIComponent(GLB)}&width=1024&height=1024`);
		expect(res.text).toBe(`Here is your 3D model "a 3D dragon". Spin it around: ${BASE}/m/${CREATION}`);
		expect(deliver).not.toHaveBeenCalled();

		const row = await store.getMentionEvent(ev.tweetId);
		expect(row).toMatchObject({ decision: 'reply', reason: 'make_done', dry_run: true, reply_link: res.link, creation_id: CREATION });

		const [creation] = (await dbState.pg.query('select * from forge_creations where id = $1', [CREATION])).rows;
		const [bot] = (await dbState.pg.query('select * from users where email = $1', [make.BOT_EMAIL])).rows;
		expect(creation).toMatchObject({ x_author_id: ev.authorId, user_id: bot.id, visibility: 'unlisted' });
		expect(bot.service_account).toBe(true);
	});

	it('uses the reference image as media when the model is too large to render', async () => {
		const ev = await mentionRow();
		const big = { ...doneJob, size_bytes: 12 * 1024 * 1024, preview_image_url: 'https://cdn.three.test/forge/dragon.png' };
		const res = await make.handleMake(ev, { ...noDirector, startForge: async () => big });
		expect(res.mediaUrl).toBe('https://cdn.three.test/forge/dragon.png');
	});

	it('hands a live row to the adapter and records the reply id once', async () => {
		const ev = await mentionRow({ dryRun: false });
		const deliver = vi.fn(async () => '2000000000000000001');
		await make.handleMake(ev, { ...noDirector, deliver, startForge: async () => doneJob });
		expect(deliver).toHaveBeenCalledTimes(1);
		expect(deliver.mock.calls[0][0]).toMatchObject({ inReplyToTweetId: ev.tweetId, mediaUrl: expect.stringContaining('/api/render/glb') });
		expect((await store.getMentionEvent(ev.tweetId)).reply_tweet_id).toBe('2000000000000000001');
	});

	it('holds a live row as paused when no adapter is wired instead of guessing', async () => {
		const ev = await mentionRow({ dryRun: false });
		await make.handleMake(ev, { ...noDirector, startForge: async () => doneJob });
		expect(await store.getMentionEvent(ev.tweetId)).toMatchObject({ decision: 'paused', reason: 'no_delivery_adapter', reply_tweet_id: null });
	});

	it('waits on a queued job and replies when polling finishes inside the budget', async () => {
		const ev = await mentionRow();
		const pollJob = vi.fn(async () => doneJob);
		const res = await make.handleMake(ev, { ...noDirector, pollJob, startForge: async () => ({ status: 'queued', job_id: 'job-1', creation_id: CREATION }) });
		expect(res.outcome).toBe('reply');
		expect(pollJob).toHaveBeenCalledWith(BASE, 'job-1', expect.objectContaining({ timeoutMs: make.makeBudgetMs() }));
	});
});

describe('timeout then follow-up', () => {
	const queued = { status: 'queued', job_id: 'job-slow', creation_id: CREATION };

	async function pendingRow(extra = {}) {
		const ev = await mentionRow();
		const res = await make.handleMake(ev, { ...noDirector, startForge: async () => queued, pollJob: async () => ({ status: 'queued', _timedOut: true }), ...extra });
		return { ev, res };
	}

	it('records pending with the job id and sends nothing', async () => {
		const { ev, res } = await pendingRow();
		expect(res).toMatchObject({ outcome: 'pending', decision: 'pending', text: null });
		const row = await store.getMentionEvent(ev.tweetId);
		expect(row.decision).toBe('pending');
		expect(row.args.make).toMatchObject({ job_id: 'job-slow', prompt: 'a 3D dragon' });
		expect(row.reply_text).toBeNull();
	});

	it('leaves a still-running job for the next tick', async () => {
		await pendingRow();
		const summary = await make.finishPendingMakes({}, { base: BASE, pollOnce: async () => ({ status: 'queued' }) });
		expect(summary).toEqual({ checked: 1, replied: 0, failed: 0, waiting: 1 });
	});

	it('replies exactly once when the job finishes, even across overlapping ticks', async () => {
		const { ev } = await pendingRow();
		const deps = { base: BASE, pollOnce: async () => doneJob };
		const [a, b] = await Promise.all([make.finishPendingMakes({}, deps), make.finishPendingMakes({}, deps)]);
		expect(a.replied + b.replied).toBe(1);
		const row = await store.getMentionEvent(ev.tweetId);
		expect(row).toMatchObject({ decision: 'reply', reason: 'make_done_late', reply_link: `${BASE}/m/${CREATION}` });
		expect(row.reply_media_url).toContain('/api/render/glb');
		expect(await make.finishPendingMakes({}, deps)).toMatchObject({ checked: 0 });
	});

	it('sends the designed failure reply when the late job failed', async () => {
		const { ev } = await pendingRow();
		await make.finishPendingMakes({}, { base: BASE, pollOnce: async () => ({ status: 'failed' }) });
		const row = await store.getMentionEvent(ev.tweetId);
		expect(row).toMatchObject({ decision: 'reply', reason: 'make_failed:generation_failed' });
		expect(row.reply_link).toBe(`${BASE}/forge?prompt=${encodeURIComponent('a 3D dragon')}`);
	});

	it('gives up with the failure reply once a job is overdue', async () => {
		const { ev } = await pendingRow();
		const later = Date.now() + make.makeGiveUpMs() + 60_000;
		const summary = await make.finishPendingMakes({}, { base: BASE, now: () => later, pollOnce: async () => ({ status: 'queued' }) });
		expect(summary.failed).toBe(1);
		expect((await store.getMentionEvent(ev.tweetId)).reason).toBe('make_failed:overdue');
	});
});

describe('failure and refusal paths', () => {
	it('replies with a prefilled /forge link when the generation fails', async () => {
		const ev = await mentionRow({ prompt: 'a dragon & a knight' });
		const failure = Object.assign(new Error('lane down'), { code: 'generation_failed' });
		const res = await make.handleMake(ev, {
			...noDirector,
			startForge: async () => ({ status: 'queued', job_id: 'job-x', creation_id: CREATION }),
			pollJob: async () => { throw failure; },
		});
		expect(res.outcome).toBe('reply');
		expect(res.link).toBe(`${BASE}/forge?prompt=${encodeURIComponent('a dragon & a knight')}`);
		expect(res.text).toContain(res.link);
		expect(res.mediaUrl).toBeNull();
		expect(await store.getMentionEvent(ev.tweetId)).toMatchObject({ decision: 'reply', reason: 'make_failed:generation_failed', error: 'lane down' });
	});

	it('replies with the failure link when the generator refuses the submit', async () => {
		const ev = await mentionRow();
		const busy = Object.assign(new Error('busy'), { code: 'busy' });
		const res = await make.handleMake(ev, { ...noDirector, startForge: async () => { throw busy; } });
		expect(res.reason).toBe('make_failed:busy');
		expect(res.link).toContain('/forge?prompt=');
	});

	it('refuses an unsafe prompt before any generation and does not echo it', async () => {
		const ev = await mentionRow({ prompt: 'a gory massacre scene' });
		const submit = vi.fn();
		const res = await make.handleMake(ev, { ...noDirector, startForge: submit });
		expect(submit).not.toHaveBeenCalled();
		expect(res).toMatchObject({ outcome: 'unsafe', decision: 'unsafe' });
		expect(res.text).not.toMatch(/gory|massacre/);
		expect(await store.getMentionEvent(ev.tweetId)).toMatchObject({ decision: 'unsafe', reason: 'safety_gore' });
	});
});

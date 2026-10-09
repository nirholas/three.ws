// The X gateway adapter against the REAL x_mention_events migration (PGlite)
// and, in live mode, the real x-post.js with only the HTTP boundary
// (fetchUpstream) captured. The mention is a record from the captured
// timeline fixture. Dry run must make zero HTTP calls.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';

const dbState = { pg: null };
const httpCalls = [];
let httpScript = [];

vi.mock('../api/_lib/db.js', () => {
	const sql = async (strings, ...values) => {
		const text = strings.reduce((acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ''), '');
		return (await dbState.pg.query(text, values)).rows;
	};
	return { sql, isDbUnavailableError: () => false, isDbCapacityError: () => false };
});

vi.mock('../api/_lib/upstream-fetch.js', () => ({
	fetchUpstream: async (url, init) => {
		const call = { url, method: init?.method || 'GET', headers: init?.headers, body: init?.body };
		httpCalls.push(call);
		const next = httpScript.shift();
		if (!next) throw new Error(`unscripted HTTP call to ${url}`);
		return new Response(JSON.stringify(next.json), { status: next.status || 200 });
	},
}));

vi.mock('../api/auth/x/[action].js', () => ({ encryptToken: (s) => s, decryptToken: (s) => s }));

const { createXAdapter, xBotLive, XAdapterError } = await import('../api/_lib/gateway/adapters/x.js');
const store = await import('../api/_lib/x-mention-store.js');
const { normalizeMentions } = await import('../api/_lib/x-mentions.js');
const { parseMentionIntent } = await import('../api/_lib/x-mention-intents.js');
const { weightedLength } = await import('../api/_lib/x-text-weight.js');

const MIG = new URL('../api/_lib/migrations/', import.meta.url);
const MIGRATION = readFileSync(new URL('20261008170000_x_mention_events.sql', MIG), 'utf8');
const APP_SETTINGS = (() => {
	const src = readFileSync(new URL('20260922210000_free_tier_models.sql', MIG), 'utf8');
	const start = src.indexOf('CREATE TABLE IF NOT EXISTS app_settings');
	return src.slice(start, src.indexOf(');', start) + 2);
})();
const COMPANY = { kind: 'company', ref: 'trythreews', userId: '1700000000000000001', handle: 'trythreews' };
const page = JSON.parse(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'x-mentions', 'timeline-page.fixture.json'), 'utf8'));
const MENTION = normalizeMentions(page, COMPANY)[0];
const parsed = parseMentionIntent(MENTION);

const LIVE_ENV = { X_MENTION_BOT_LIVE: '1' };
const liveAdapter = (extra = {}) => createXAdapter({
	mention: MENTION, parsed, env: LIVE_ENV, policyDryRun: false, getAccessToken: async () => 'tok_fixture', ...extra,
});
const dryAdapter = (extra = {}) => createXAdapter({ mention: MENTION, parsed, env: {}, getAccessToken: async () => 'tok_fixture', ...extra });

beforeEach(async () => {
	dbState.pg = new PGlite();
	await dbState.pg.exec(APP_SETTINGS);
	await dbState.pg.exec(MIGRATION);
	httpCalls.length = 0;
	httpScript = [];
});

describe('the live switch', () => {
	it('is on only for the exact string 1', () => {
		expect(xBotLive({ X_MENTION_BOT_LIVE: '1' })).toBe(true);
		for (const v of [undefined, '', '0', 'true', 'yes', ' 1']) expect(xBotLive({ X_MENTION_BOT_LIVE: v })).toBe(false);
	});
	it('stays dry when the policy is in dry run even with the flag on', () => {
		expect(createXAdapter({ mention: MENTION, env: LIVE_ENV, policyDryRun: true, getAccessToken: async () => 't' }).live).toBe(false);
	});
	it('stays dry without a token resolver', () => {
		expect(createXAdapter({ mention: MENTION, env: LIVE_ENV, policyDryRun: false }).live).toBe(false);
	});
});

describe('dry run', () => {
	it('makes zero HTTP calls and leaves a complete audit row', async () => {
		const tokenSpy = vi.fn(async () => 'tok');
		const a = dryAdapter({ getAccessToken: tokenSpy });
		const out = await a.sendText(MENTION.id, 'Here is your model: https://three.ws/c/abc');
		expect(out.dry_run).toBe(true);
		expect(out.ref.messageId).toMatch(/^dry_run:/);
		expect(httpCalls).toHaveLength(0);
		expect(tokenSpy).not.toHaveBeenCalled();
		const row = await store.getMentionEvent(MENTION.id);
		expect(row).toMatchObject({
			tweet_id: MENTION.id, author_id: String(MENTION.userId), intent: parsed.intent, decision: 'reply', dry_run: true,
			reply_text: 'Here is your model: https://three.ws/c/abc', reply_tweet_id: null,
		});
		expect(row.mention_text).toBeTruthy();
		expect(row.decided_at).toBeTruthy();
	});
	it('records media and a two-post chain without touching the network', async () => {
		const a = dryAdapter();
		await a.sendMedia(MENTION.id, { url: 'https://three.ws/api/render/x.png', caption: 'Your render' });
		const row = await store.getMentionEvent(MENTION.id);
		expect(row.reply_media_url).toBe('https://three.ws/api/render/x.png');
		expect(row.reply_text).toBe('Your render');
		expect(httpCalls).toHaveLength(0);
	});
	it('refuses a third post and a foreign target', async () => {
		const a = dryAdapter();
		await a.sendText(MENTION.id, 'one');
		await a.sendText(MENTION.id, 'two');
		await expect(a.sendText(MENTION.id, 'three')).rejects.toMatchObject({ code: 'reply_cap' });
		await expect(dryAdapter().sendText('999', 'x')).rejects.toMatchObject({ code: 'wrong_target' });
		expect(httpCalls).toHaveLength(0);
	});
	it('renders choices as a three.ws link within the post limit', async () => {
		const out = await dryAdapter().sendChoice(MENTION.id, 'Approve this swap? '.repeat(30), [{ id: 'a', label: 'Approve' }, { id: 'c', label: 'Cancel' }]);
		const row = await store.getMentionEvent(MENTION.id);
		expect(row.reply_text).toContain('Approve / Cancel on three.ws: https://three.ws/dashboard');
		expect(weightedLength(row.reply_text)).toBeLessThanOrEqual(280);
		expect(out.dry_run).toBe(true);
	});
	it('typing is a no-op and editing is refused', async () => {
		const a = dryAdapter();
		await expect(a.typing(MENTION.id)).resolves.toBeUndefined();
		await expect(a.editMessage({}, 'x')).rejects.toBeInstanceOf(XAdapterError);
	});
});

describe('live mode request shape', () => {
	it('replies with in_reply_to_tweet_id and records the reply id', async () => {
		httpScript = [{ json: { data: { id: '5001' } } }];
		const out = await liveAdapter().sendText(MENTION.id, 'Done.');
		expect(out).toMatchObject({ dry_run: false, ref: { messageId: '5001' } });
		expect(httpCalls).toHaveLength(1);
		const [c] = httpCalls;
		expect(c.url).toBe('https://api.twitter.com/2/tweets');
		expect(c.method).toBe('POST');
		expect(c.headers.authorization).toBe('Bearer tok_fixture');
		expect(JSON.parse(c.body)).toEqual({ text: 'Done.', reply: { in_reply_to_tweet_id: MENTION.id } });
		const row = await store.getMentionEvent(MENTION.id);
		expect(row).toMatchObject({ reply_tweet_id: '5001', dry_run: false, decision: 'reply' });
	});
	it('chains a long reply: part two replies to part one', async () => {
		httpScript = [{ json: { data: { id: '6001' } } }, { json: { data: { id: '6002' } } }];
		await liveAdapter().sendText(MENTION.id, `${'a'.repeat(200)}\n\n${'b'.repeat(200)}`);
		expect(httpCalls.map((c) => JSON.parse(c.body).reply.in_reply_to_tweet_id)).toEqual([MENTION.id, '6001']);
		for (const c of httpCalls) expect(weightedLength(JSON.parse(c.body).text)).toBeLessThanOrEqual(280);
	});
	it('uploads media through the v2 endpoint then replies with the media id', async () => {
		httpScript = [
			{ json: { data: { id: 'm1' } } },
			{ json: {} },
			{ json: { data: {} } },
			{ json: { data: { id: '7001' } } },
		];
		const fetchMedia = vi.fn(async () => ({ buffer: Buffer.from('png-bytes'), mimeType: 'image/png' }));
		await liveAdapter({ fetchMedia }).sendMedia(MENTION.id, { url: 'https://three.ws/api/render/x.png', caption: 'Your render' });
		expect(httpCalls.map((c) => c.url)).toEqual([
			'https://api.x.com/2/media/upload', 'https://api.x.com/2/media/upload', 'https://api.x.com/2/media/upload', 'https://api.twitter.com/2/tweets',
		]);
		expect(httpCalls[0].body.get('command')).toBe('INIT');
		expect(httpCalls[0].body.get('media_category')).toBe('tweet_image');
		expect(JSON.parse(httpCalls[3].body)).toEqual({ text: 'Your render', reply: { in_reply_to_tweet_id: MENTION.id }, media: { media_ids: ['m1'] } });
	});
	it('rejects unsupported media types before any upload', async () => {
		const fetchMedia = async () => ({ buffer: Buffer.from('x'), mimeType: 'application/zip' });
		await expect(liveAdapter({ fetchMedia }).sendMedia(MENTION.id, { url: 'https://three.ws/a.zip' })).rejects.toMatchObject({ code: 'bad_media' });
		expect(httpCalls).toHaveLength(0);
	});
	it('refuses to reply twice to one mention', async () => {
		httpScript = [{ json: { data: { id: '8001' } } }];
		await liveAdapter().sendText(MENTION.id, 'first');
		await expect(liveAdapter().sendText(MENTION.id, 'second')).rejects.toMatchObject({ code: 'already_replied' });
		expect(httpCalls).toHaveLength(1);
	});
});

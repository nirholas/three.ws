// The X adapter (api/_lib/gateway/adapters/x.js) against a real x_mention_events
// row (PGlite, schema from the migration file itself) and a stubbed fetch at
// the HTTP boundary, the same patterns tests/x-mention-store.test.js and
// tests/upstream-fetch.test.js already use.

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

const { _resetBreakers } = await import('../api/_lib/resilience.js');
const { createXAdapter, isXMentionBotLive, XAdapterError } = await import('../api/_lib/gateway/adapters/x.js');
const store = await import('../api/_lib/x-mention-store.js');
const { normalizeMentions } = await import('../api/_lib/x-mentions.js');
const { parseMentionIntent } = await import('../api/_lib/x-mention-intents.js');

const MIG = new URL('../api/_lib/migrations/', import.meta.url);
const MIGRATION = readFileSync(new URL('20261008170000_x_mention_events.sql', MIG), 'utf8');
const APP_SETTINGS = (() => {
	const src = readFileSync(new URL('20260922210000_free_tier_models.sql', MIG), 'utf8');
	const start = src.indexOf('CREATE TABLE IF NOT EXISTS app_settings');
	return src.slice(start, src.indexOf(');', start) + 2);
})();

const COMPANY = { kind: 'company', ref: 'trythreews', userId: '1700000000000000001', handle: 'trythreews' };
const page = JSON.parse(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'x-mentions', 'timeline-page.fixture.json'), 'utf8'));
const MENTIONS = normalizeMentions(page, COMPANY);
const byId = (id) => MENTIONS.find((m) => m.id === id);
const record = (m) => store.recordMention({ mention: m, parsed: parseMentionIntent(m) });

const json = (body, init = {}) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });

let origFetch;
beforeEach(async () => {
	dbState.pg = new PGlite();
	await dbState.pg.exec(APP_SETTINGS);
	await dbState.pg.exec(MIGRATION);
	origFetch = global.fetch;
	_resetBreakers();
});

describe('isXMentionBotLive', () => {
	it('is live only when the flag is exactly "1"', () => {
		expect(isXMentionBotLive({})).toBe(false);
		expect(isXMentionBotLive({ X_MENTION_BOT_LIVE: 'true' })).toBe(false);
		expect(isXMentionBotLive({ X_MENTION_BOT_LIVE: '1' })).toBe(true);
	});
});

describe('dry run (the default and the only mode this order ships)', () => {
	it('posts nothing: zero fetch calls for a text reply', async () => {
		const m = byId('1800000000000000101');
		await record(m);
		const fetchMock = vi.fn();
		global.fetch = fetchMock;
		const gw = createXAdapter({ mention: m, env: {} });
		expect(gw.dryRun).toBe(true);
		const result = await gw.sendText('Here is your cat in 3D.');
		expect(fetchMock).not.toHaveBeenCalled();
		expect(result.dryRun).toBe(true);
		expect(result.id).toMatch(/^dry_run:/);
		global.fetch = origFetch;
	});

	it('leaves a complete row in x_mention_events', async () => {
		const m = byId('1800000000000000101');
		await record(m);
		global.fetch = vi.fn();
		const gw = createXAdapter({ mention: m, env: {} });
		await gw.sendText('Here is your cat in 3D.');
		global.fetch = origFetch;

		const row = await store.getMentionEvent(m.id);
		expect(row).toMatchObject({
			decision: 'reply',
			reply_text: 'Here is your cat in 3D.',
			dry_run: true,
		});
		expect(row.reply_tweet_id).toMatch(/^dry_run:/);
		expect(row.decided_at).not.toBeNull();
		expect(row.replied_at).not.toBeNull();
	});

	it('also dry-runs when the owner policy forces it even if the env flag is live', async () => {
		const m = byId('1800000000000000104');
		await record(m);
		global.fetch = vi.fn();
		const gw = createXAdapter({ mention: m, live: false, env: { X_MENTION_BOT_LIVE: '1' } });
		await gw.sendText('hi');
		global.fetch = origFetch;
		expect(gw.dryRun).toBe(true);
		const row = await store.getMentionEvent(m.id);
		expect(row.dry_run).toBe(true);
	});

	it('sendMedia records the media url and posts nothing', async () => {
		const m = byId('1800000000000000104');
		await record(m);
		global.fetch = vi.fn();
		const gw = createXAdapter({ mention: m, env: {} });
		const result = await gw.sendMedia({ url: 'https://three.ws/render/abc.png', caption: 'your lighthouse' });
		global.fetch = origFetch;
		expect(result.dryRun).toBe(true);
		const row = await store.getMentionEvent(m.id);
		expect(row.reply_media_url).toBe('https://three.ws/render/abc.png');
		expect(row.reply_text).toBe('your lighthouse');
	});

	it('sendButtons renders choices as a list plus one three.ws link, no buttons', async () => {
		const m = byId('1800000000000000105');
		const notRetweet = { ...m, isRetweet: false };
		await record(notRetweet);
		global.fetch = vi.fn();
		const gw = createXAdapter({ mention: notRetweet, env: {} });
		await gw.sendButtons('Pick one', [{ id: 'a', label: 'Make it 3D' }, { id: 'b', label: 'Launch it' }]);
		global.fetch = origFetch;
		const row = await store.getMentionEvent(notRetweet.id);
		expect(row.reply_text).toContain('Pick one');
		expect(row.reply_text).toContain('- Make it 3D');
		expect(row.reply_text).toContain('- Launch it');
		expect(row.reply_text).toContain('Continue: https://three.ws');
	});

	it('typing is a no-op', async () => {
		const m = byId('1800000000000000106');
		global.fetch = vi.fn();
		const gw = createXAdapter({ mention: m, env: {} });
		await expect(gw.typing()).resolves.toBeUndefined();
		expect(global.fetch).not.toHaveBeenCalled();
		global.fetch = origFetch;
	});

	it('refuses to send for a mention that was never recorded', async () => {
		const m = byId('1800000000000000107');
		global.fetch = vi.fn();
		const gw = createXAdapter({ mention: m, env: {} });
		await expect(gw.sendText('hi')).rejects.toThrow(XAdapterError);
		global.fetch = origFetch;
	});
});

describe('live mode: real request shape at the HTTP boundary', () => {
	it('requires an accessToken to construct a live adapter', () => {
		const m = byId('1800000000000000101');
		expect(() => createXAdapter({ mention: m, live: true, env: {} })).toThrow(/accessToken/);
	});

	it('sendText posts one reply with in_reply_to_tweet_id set to the mention', async () => {
		const m = byId('1800000000000000101');
		await record(m);
		const fetchMock = vi.fn(async (url, init) => {
			expect(url).toBe('https://api.twitter.com/2/tweets');
			expect(init.method).toBe('POST');
			expect(init.headers.authorization).toBe('Bearer test-token');
			const body = JSON.parse(init.body);
			expect(body).toEqual({ text: 'Here is your cat in 3D.', reply: { in_reply_to_tweet_id: m.id } });
			return json({ data: { id: '9000000000000000001' } });
		});
		global.fetch = fetchMock;
		const gw = createXAdapter({ mention: m, accessToken: 'test-token', live: true, env: {} });
		const result = await gw.sendText('Here is your cat in 3D.');
		global.fetch = origFetch;

		expect(fetchMock).toHaveBeenCalledTimes(1);
		expect(result).toEqual({ id: '9000000000000000001', dryRun: false, parts: [{ id: '9000000000000000001', text: 'Here is your cat in 3D.' }] });
		const row = await store.getMentionEvent(m.id);
		expect(row).toMatchObject({ decision: 'reply', dry_run: false, reply_tweet_id: '9000000000000000001' });
	});

	it('a two-part reply threads the second part onto the first, not the mention', async () => {
		const m = byId('1800000000000000104');
		await record(m);
		const ids = ['9000000000000000010', '9000000000000000011'];
		const seen = [];
		global.fetch = vi.fn(async (url, init) => {
			const body = JSON.parse(init.body);
			seen.push(body.reply.in_reply_to_tweet_id);
			return json({ data: { id: ids[seen.length - 1] } });
		});
		const longText = `${'first part filler text that keeps going. '.repeat(10)} SPLIT_HERE ${'second part filler text that keeps going. '.repeat(10)}`;
		const gw = createXAdapter({ mention: m, accessToken: 'test-token', live: true, env: {} });
		const result = await gw.sendText(longText);
		global.fetch = origFetch;

		expect(seen).toEqual([m.id, ids[0]]);
		expect(result.parts).toHaveLength(2);
		expect(result.id).toBe(ids[0]);
	});

	it('sendMedia uploads via the v2 media endpoint then replies with the media attached', async () => {
		const m = byId('1800000000000000105');
		const notRetweet = { ...m, isRetweet: false };
		await record(notRetweet);
		const calls = [];
		global.fetch = vi.fn(async (url, init) => {
			calls.push(String(url));
			if (String(url).startsWith('https://api.x.com/2/media/upload')) {
				const command = init.body?.get ? init.body.get('command') : new URLSearchParams(String(url).split('?')[1]).get('command');
				if (command === 'INIT') return json({ data: { id: '800000001' } });
				if (command === 'APPEND') return new Response('', { status: 200 });
				if (command === 'FINALIZE') return json({ data: { id: '800000001' } });
			}
			return json({ data: { id: '9000000000000000099' } });
		});
		const gw = createXAdapter({ mention: notRetweet, accessToken: 'test-token', live: true, env: {} });
		const result = await gw.sendMedia({ url: 'https://three.ws/render/abc.png', buffer: Buffer.from([1, 2, 3]), mimeType: 'image/png', caption: 'your render' });
		global.fetch = origFetch;

		expect(calls).toEqual([
			'https://api.x.com/2/media/upload',
			'https://api.x.com/2/media/upload',
			'https://api.x.com/2/media/upload',
			'https://api.twitter.com/2/tweets',
		]);
		expect(result.dryRun).toBe(false);
		const row = await store.getMentionEvent(notRetweet.id);
		expect(row).toMatchObject({ reply_media_url: 'https://three.ws/render/abc.png', reply_text: 'your render', reply_tweet_id: '9000000000000000099' });
	});

	it('sendMedia refuses to upload live without bytes', async () => {
		const m = byId('1800000000000000106');
		await record(m);
		global.fetch = vi.fn();
		const gw = createXAdapter({ mention: m, accessToken: 'test-token', live: true, env: {} });
		await expect(gw.sendMedia({ url: 'https://three.ws/render/abc.png' })).rejects.toThrow(/buffer\+mimeType/);
		expect(global.fetch).not.toHaveBeenCalled();
		global.fetch = origFetch;
	});
});

// The X mention bot's `image3d` flow against real Postgres semantics (PGlite),
// the real migrations, the real parser and the real moderation/copy code.
// Replaced at the network edge only: the media CDN download (a Response with
// real PNG bytes), the vision verdict, the image store and the 3D generator,
// each returning the shape the real service answers with.

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

const img = await import('../api/_lib/x-mention-image3d.js');
const media = await import('../api/_lib/x-media-image.js');
const store = await import('../api/_lib/x-mention-store.js');
const { parseMentionIntent } = await import('../api/_lib/x-mention-intents.js');
const { weightedLength } = await import('../api/_lib/x-text-weight.js');

const MIG = new URL('../api/_lib/migrations/', import.meta.url);
const read = (f) => readFileSync(new URL(f, MIG), 'utf8');

const BASE_SCHEMA = `
	create table users (
		id uuid primary key default gen_random_uuid(), email text not null unique, display_name text, username text,
		plan text not null default 'free', email_verified boolean not null default false,
		service_account boolean not null default false, created_at timestamptz default now(), updated_at timestamptz default now()
	);
	create unique index users_username_unique on users(lower(username)) where username is not null;
	create table forge_creations (id uuid primary key, user_id uuid, visibility text, updated_at timestamptz default now());
`;

const BASE = 'https://three.test';
const CREATION = '7a2e4b63-1d3f-4c8f-8b69-2a1b0b5c8d21';
const GLB = 'https://cdn.three.test/forge/sneaker.glb';
const ASKER = '1800000000000000042';
const OTHER = '1800000000000000099';
const PHOTO = 'https://pbs.twimg.com/media/GxQ1aBcWsAAbCdE.jpg';
const ACCOUNT = { kind: 'company', ref: 'trythreews', userId: '1700000000000000001', handle: 'trythreews' };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2048, 7)]);
const doneJob = { status: 'done', glb_url: GLB, creation_id: CREATION };
let seq = 0;

const photo = (url = PHOTO) => ({ key: '3_1', type: 'photo', url, width: 1200, height: 900 });
const cdn = (body = PNG, headers = { 'content-type': 'image/png' }, status = 200) => vi.fn(async () => new Response(body, { status, headers }));
const okReview = vi.fn(async () => ({ json: { safe: true, usable: true, subject: 'red sneaker' } }));
const persist = vi.fn(async () => 'https://cdn.three.test/forge/refs/x.png');

async function row({ own = true, mediaUrl = PHOTO, via = 'mention', dryRun = true } = {}) {
	seq += 1;
	const id = String(1900000000000000000n + BigInt(seq));
	const mention = {
		id, userId: ASKER, username: 'asker', text: '@trythreews 3D this', createdAt: new Date().toISOString(),
		conversationId: id, account: ACCOUNT, mentions: [{ username: 'trythreews', id: ACCOUNT.userId }], urls: [],
		media: via === 'mention' ? [photo(mediaUrl)] : [], inReplyToUserId: via === 'reply' ? (own ? ASKER : OTHER) : null,
		repliedTo: via === 'reply' ? { id: '1899999999999999000', available: true, text: 'my new sneaker', author: { id: own ? ASKER : OTHER, username: own ? 'asker' : 'someone' }, media: [photo(mediaUrl)] } : null,
		quoted: null, isRetweet: false, fromSelf: false,
	};
	const parsed = parseMentionIntent(mention, ACCOUNT);
	await store.recordMention({ mention, parsed, dryRun });
	return { parsed, event: { tweetId: id, authorId: ASKER, args: parsed.args, dryRun } };
}

beforeEach(async () => {
	dbState.pg = new PGlite();
	await dbState.pg.exec(BASE_SCHEMA);
	await dbState.pg.exec(read('20261008170000_x_mention_events.sql'));
	await dbState.pg.exec(read('20261009201500_forge_creations_x_author.sql'));
	await dbState.pg.query('insert into forge_creations (id) values ($1)', [CREATION]);
	okReview.mockClear();
	persist.mockClear();
});

const deps = (extra = {}) => ({ base: BASE, fetchImpl: cdn(), describe: okReview, persist, startForge: async () => doneJob, ...extra });

describe('own image', () => {
	it.each(['mention', 'reply'])('turns the author\'s picture (%s) into a reply with the render and creation link', async (via) => {
		const { parsed, event } = await row({ via });
		expect(parsed.intent).toBe('image3d');
		const startForge = vi.fn(async () => doneJob);
		const res = await img.handleImage3d(event, deps({ startForge }));
		expect(res).toMatchObject({ outcome: 'reply', reason: 'image3d_done', link: `${BASE}/m/${CREATION}` });
		expect(res.text).toBe(`Here is your red sneaker in 3D. Spin it around: ${BASE}/m/${CREATION}`);
		expect(res.mediaUrl).toContain('/api/render/glb');
		expect(startForge).toHaveBeenCalledWith(BASE, expect.objectContaining({ imageUrls: ['https://cdn.three.test/forge/refs/x.png'], internal: true }));
		expect(await store.getMentionEvent(event.tweetId)).toMatchObject({ decision: 'reply', reason: 'image3d_done', dry_run: true, creation_id: CREATION });
		const [creation] = (await dbState.pg.query('select * from forge_creations where id = $1', [CREATION])).rows;
		expect(creation).toMatchObject({ x_author_id: ASKER, visibility: 'unlisted' });
	});

	it('fetches the large rendition of the CDN photo and sends nothing in a dry run', async () => {
		const { event } = await row();
		const fetchImpl = cdn();
		const deliver = vi.fn();
		await img.handleImage3d(event, deps({ fetchImpl, deliver }));
		expect(fetchImpl.mock.calls[0][0]).toBe(`${PHOTO}?name=large`);
		expect(fetchImpl.mock.calls[0][1].redirect).toBe('manual');
		expect(deliver).not.toHaveBeenCalled();
	});

	it('hands a live row to the adapter once', async () => {
		const { event } = await row({ dryRun: false });
		const deliver = vi.fn(async () => '2000000000000000007');
		await img.handleImage3d(event, deps({ deliver }));
		expect(deliver).toHaveBeenCalledTimes(1);
		expect((await store.getMentionEvent(event.tweetId)).reply_tweet_id).toBe('2000000000000000007');
	});
});

describe('someone else\'s image', () => {
	it('is skipped as not_own_image with no fetch, no review and no reply', async () => {
		const { parsed, event } = await row({ own: false, via: 'reply' });
		expect(parsed.intent).toBe('image3d');
		const fetchImpl = cdn();
		const res = await img.handleImage3d(event, deps({ fetchImpl }));
		expect(res).toMatchObject({ outcome: 'skip', decision: 'skip', reason: 'not_own_image' });
		expect(fetchImpl).not.toHaveBeenCalled();
		expect(okReview).not.toHaveBeenCalled();
		expect(await store.getMentionEvent(event.tweetId)).toMatchObject({ decision: 'skip', reason: 'not_own_image', reply_text: null });
	});

	it('treats a post whose author is unknown as not own', () => {
		expect(img.isOwnImage({ sourceAuthorId: null }, ASKER)).toBe(false);
		expect(img.isOwnImage({ sourceAuthorId: ASKER }, ASKER)).toBe(true);
	});
});

describe('media CDN fetch', () => {
	it('rejects a URL that is not on the X photo CDN without any request', async () => {
		for (const url of ['https://evil.example/media/a.jpg', 'http://pbs.twimg.com/media/a.jpg', 'https://pbs.twimg.com.evil.example/media/a.jpg', 'https://pbs.twimg.com/profile_images/a.jpg', 'https://user@pbs.twimg.com/media/a.jpg']) {
			const fetchImpl = cdn();
			await expect(media.fetchXImage(url, { fetchImpl })).rejects.toMatchObject({ code: 'not_cdn' });
			expect(fetchImpl).not.toHaveBeenCalled();
		}
		const { event } = await row({ mediaUrl: 'https://evil.example/media/a.jpg' });
		const res = await img.handleImage3d(event, deps());
		expect(res).toMatchObject({ outcome: 'skip', reason: 'image_rejected:not_cdn' });
	});

	it('rejects an oversized picture by header and by streamed length, and replies with the designed failure', async () => {
		await expect(media.fetchXImage(PHOTO, { fetchImpl: cdn(PNG, { 'content-type': 'image/png', 'content-length': '99999999' }) })).rejects.toMatchObject({ code: 'too_large' });
		await expect(media.fetchXImage(PHOTO, { fetchImpl: cdn(PNG, { 'content-type': 'image/png' }), maxBytes: 1000 })).rejects.toMatchObject({ code: 'too_large' });
		const { event } = await row();
		const big = cdn(Buffer.concat([PNG, Buffer.alloc(media.X_MEDIA_MAX_BYTES)]));
		const startForge = vi.fn();
		const res = await img.handleImage3d(event, deps({ fetchImpl: big, startForge }));
		expect(res).toMatchObject({ outcome: 'reply', reason: 'image_rejected:too_large', link: `${BASE}/forge` });
		expect(startForge).not.toHaveBeenCalled();
		expect(persist).not.toHaveBeenCalled();
	});

	it('refuses redirects, wrong MIME types and bytes that are not a picture', async () => {
		await expect(media.fetchXImage(PHOTO, { fetchImpl: cdn('', { location: 'https://evil.example/x' }, 302) })).rejects.toMatchObject({ code: 'fetch_failed' });
		await expect(media.fetchXImage(PHOTO, { fetchImpl: cdn(PNG, { 'content-type': 'text/html' }) })).rejects.toMatchObject({ code: 'bad_type' });
		await expect(media.fetchXImage(PHOTO, { fetchImpl: cdn(Buffer.from('<html>not an image</html>'), { 'content-type': 'image/png' }) })).rejects.toMatchObject({ code: 'bad_bytes' });
	});

	it('times out a stalled download', async () => {
		const stalled = vi.fn((url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'TimeoutError' })))));
		await expect(media.fetchXImage(PHOTO, { fetchImpl: stalled, timeoutMs: 20 })).rejects.toMatchObject({ code: 'timeout' });
	});
});

describe('moderation', () => {
	it('refuses an unsafe picture before storing or generating, with a fixed reply that echoes nothing', async () => {
		const { event } = await row();
		const startForge = vi.fn();
		const res = await img.handleImage3d(event, deps({ describe: async () => ({ json: { safe: false, usable: true, subject: 'secret thing' } }), startForge }));
		expect(res).toMatchObject({ outcome: 'unsafe', reason: 'image_unsafe' });
		expect(res.text).not.toContain('secret');
		expect(persist).not.toHaveBeenCalled();
		expect(startForge).not.toHaveBeenCalled();
		expect(await store.getMentionEvent(event.tweetId)).toMatchObject({ decision: 'unsafe', reason: 'image_unsafe' });
	});

	it('refuses a picture with no single subject', async () => {
		const { event } = await row();
		const res = await img.handleImage3d(event, deps({ describe: async () => ({ json: { safe: true, usable: false, subject: '' } }) }));
		expect(res).toMatchObject({ outcome: 'unsafe', reason: 'image_unusable' });
	});

	it('fails closed when no vision provider can review', async () => {
		const { event } = await row();
		const startForge = vi.fn();
		const res = await img.handleImage3d(event, deps({ describe: async () => { throw new Error('vision down'); }, startForge }));
		expect(res).toMatchObject({ outcome: 'reply', reason: 'review_unavailable' });
		expect(startForge).not.toHaveBeenCalled();
	});

	it('refuses an unsafe hint through the studio prompt safety check', async () => {
		const { event } = await row();
		const res = await img.handleImage3d({ ...event, args: { ...event.args, hint: 'make it nude' } }, deps());
		expect(res).toMatchObject({ outcome: 'unsafe', reason: 'safety_sexual' });
	});
});

describe('subject from the picture', () => {
	it('keeps plain words and drops anything that could carry a link, handle, number or unsafe term', () => {
		expect(img.cleanSubject('red sneaker')).toBe('red sneaker');
		expect(img.cleanSubject('List of active x402 projects')).toBe('');
		expect(img.cleanSubject('visit https://evil.example')).toBe('');
		expect(img.cleanSubject('@someone toy')).toBe('');
		expect(img.cleanSubject('naked doll')).toBe('');
		expect(img.cleanSubject(null)).toBe('');
	});

	it('never echoes text printed in the picture into the reply', async () => {
		const { event } = await row();
		const res = await img.handleImage3d(event, deps({ describe: async () => ({ json: { safe: true, usable: true, subject: 'visit evil.example now' } }) }));
		expect(res.text).toBe(`Here is your picture in 3D. Spin it around: ${BASE}/m/${CREATION}`);
	});
});

describe('reply copy', () => {
	it('stays within one post and free of dash glyphs in every state', () => {
		const link = `${BASE}/m/${CREATION}`;
		for (const kind of ['success', 'failure', 'unsafe', 'unusable']) {
			const text = img.composeImage3dReply(kind, { subject: 'y'.repeat(300), link });
			expect(weightedLength(text)).toBeLessThanOrEqual(280);
			expect(text).not.toMatch(/[\u2013\u2014]/);
		}
	});
});

describe('timeout then follow-up', () => {
	const queued = { status: 'queued', job_id: 'job-slow', creation_id: CREATION };

	async function pending() {
		const { event } = await row();
		await img.handleImage3d(event, deps({ startForge: async () => queued, pollJob: async () => ({ status: 'queued', _timedOut: true }) }));
		return event;
	}

	it('records pending with the job id', async () => {
		const event = await pending();
		const r = await store.getMentionEvent(event.tweetId);
		expect(r.decision).toBe('pending');
		expect(r.args.image3d).toMatchObject({ job_id: 'job-slow', subject: 'red sneaker' });
	});

	it('replies exactly once when the job finishes, across overlapping ticks', async () => {
		const event = await pending();
		const d = { base: BASE, pollOnce: async () => doneJob };
		const [a, b] = await Promise.all([img.finishPendingImage3d({}, d), img.finishPendingImage3d({}, d)]);
		expect(a.replied + b.replied).toBe(1);
		expect(await store.getMentionEvent(event.tweetId)).toMatchObject({ decision: 'reply', reason: 'image3d_done_late', reply_link: `${BASE}/m/${CREATION}` });
	});

	it('gives up with the failure reply when overdue', async () => {
		const event = await pending();
		const later = Date.now() + 10 * 3600_000;
		expect(await img.finishPendingImage3d({}, { base: BASE, now: () => later, pollOnce: async () => ({ status: 'queued' }) })).toMatchObject({ failed: 1 });
		expect((await store.getMentionEvent(event.tweetId)).reason).toBe('image3d_failed:overdue');
	});
});

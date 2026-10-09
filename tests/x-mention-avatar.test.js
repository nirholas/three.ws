// The X mention bot's `avatar` flow against real Postgres semantics (PGlite),
// the real migrations, the real parser, the real moderation and copy code.
// Replaced at the network edge only: the CDN download (a Response with real
// PNG bytes), the vision verdict, the image store, the 3D generator and the
// rigger, each returning the shape the real service answers with.

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

const av = await import('../api/_lib/x-mention-avatar.js');
const media = await import('../api/_lib/x-media-image.js');
const store = await import('../api/_lib/x-mention-store.js');
const { parseMentionIntent } = await import('../api/_lib/x-mention-intents.js');
const { weightedLength, X_POST_MAX_WEIGHT } = await import('../api/_lib/x-text-weight.js');

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
const MESH = 'https://cdn.three.test/forge/me.glb';
const RIGGED = 'https://cdn.three.test/forge/me-rigged.glb';
const ASKER = '1800000000000000042';
const OTHER = '1800000000000000099';
const OWN_PFP = 'https://pbs.twimg.com/profile_images/1800000000000000001/AbCdEfGh_normal.jpg';
const OTHER_PFP = 'https://pbs.twimg.com/profile_images/1800000000000000002/ZyXwVuTs_normal.jpg';
const DEFAULT_PFP = 'https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png';
const ACCOUNT = { kind: 'company', ref: 'trythreews', userId: '1700000000000000001', handle: 'trythreews' };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2048, 7)]);
const meshJob = { status: 'done', glb_url: MESH, creation_id: CREATION };
let seq = 0;

const cdn = (body = PNG, headers = { 'content-type': 'image/png' }, status = 200) => vi.fn(async () => new Response(body, { status, headers }));
const okReview = vi.fn(async () => ({ json: { safe: true, usable: true } }));
const persist = vi.fn(async () => 'https://cdn.three.test/forge/refs/pfp.png');
const startRig = vi.fn(async () => ({ job_id: 'rig-job-1' }));
const pollRigged = vi.fn(async () => ({ status: 'done', glb_url: RIGGED }));

async function row({ text = '@trythreews make me an avatar', pfp = OWN_PFP, dryRun = true, extra = {} } = {}) {
	seq += 1;
	const id = String(1900000000000000000n + BigInt(seq));
	const mention = {
		id, userId: ASKER, username: 'asker', text, createdAt: new Date().toISOString(),
		conversationId: id, account: ACCOUNT, mentions: [{ username: 'trythreews', id: ACCOUNT.userId }], urls: [],
		author: { id: ASKER, username: 'asker', profileImageUrl: pfp },
		media: [], inReplyToUserId: null, repliedTo: null, quoted: null, isRetweet: false, fromSelf: false, ...extra,
	};
	const parsed = parseMentionIntent(mention, ACCOUNT);
	await store.recordMention({ mention, parsed, dryRun });
	return { mention, parsed, event: { tweetId: id, authorId: ASKER, author: mention.author, dryRun } };
}

beforeEach(async () => {
	dbState.pg = new PGlite();
	await dbState.pg.exec(BASE_SCHEMA);
	await dbState.pg.exec(read('20261008170000_x_mention_events.sql'));
	await dbState.pg.exec(read('20261009201500_forge_creations_x_author.sql'));
	await dbState.pg.query('insert into forge_creations (id) values ($1)', [CREATION]);
	okReview.mockClear();
	persist.mockClear();
	startRig.mockClear();
	pollRigged.mockClear();
});

const deps = (extra = {}) => ({ base: BASE, fetchImpl: cdn(), describe: okReview, persist, startForge: async () => meshJob, startRig, pollJob: pollRigged, ...extra });

describe('own profile image', () => {
	it('upgrades _normal to _400x400, rigs, and replies with the render, creation link and pose link', async () => {
		const { parsed, event } = await row();
		expect(parsed.intent).toBe('avatar');
		const fetchImpl = cdn();
		const startForge = vi.fn(async () => meshJob);
		const res = await av.handleAvatar(event, deps({ fetchImpl, startForge }));
		expect(fetchImpl.mock.calls[0][0]).toBe('https://pbs.twimg.com/profile_images/1800000000000000001/AbCdEfGh_400x400.jpg');
		expect(fetchImpl.mock.calls[0][1].redirect).toBe('manual');
		expect(startForge).toHaveBeenCalledWith(BASE, expect.objectContaining({ imageUrls: ['https://cdn.three.test/forge/refs/pfp.png'], tier: 'high', internal: true }));
		expect(startRig).toHaveBeenCalledWith(BASE, MESH);
		expect(res).toMatchObject({ outcome: 'reply', reason: 'avatar_done', link: `${BASE}/pose?src=${encodeURIComponent(RIGGED)}` });
		expect(res.text).toContain(`${BASE}/m/${CREATION}`);
		expect(res.text).toContain(`${BASE}/pose?src=${encodeURIComponent(RIGGED)}`);
		expect(weightedLength(res.text)).toBeLessThanOrEqual(X_POST_MAX_WEIGHT);
		expect(res.mediaUrl).toContain(encodeURIComponent(RIGGED));
		expect(await store.getMentionEvent(event.tweetId)).toMatchObject({ decision: 'reply', reason: 'avatar_done', dry_run: true, creation_id: CREATION });
		const [creation] = (await dbState.pg.query('select * from forge_creations where id = $1', [CREATION])).rows;
		expect(creation).toMatchObject({ x_author_id: ASKER, visibility: 'unlisted' });
	});

	it('sends nothing in a dry run and hands a live row to the adapter once', async () => {
		const dry = await row();
		const deliver = vi.fn();
		await av.handleAvatar(dry.event, deps({ deliver }));
		expect(deliver).not.toHaveBeenCalled();
		const live = await row({ dryRun: false });
		const liveDeliver = vi.fn(async () => '2000000000000000007');
		await av.handleAvatar(live.event, deps({ deliver: liveDeliver }));
		expect(liveDeliver).toHaveBeenCalledTimes(1);
		expect((await store.getMentionEvent(live.event.tweetId)).reply_tweet_id).toBe('2000000000000000007');
	});

	it('hands back the unrigged mesh when the rig fails, as forge_avatar does', async () => {
		const { event } = await row();
		const res = await av.handleAvatar(event, deps({ pollJob: vi.fn(async () => { throw Object.assign(new Error('rig failed'), { code: 'generation_failed' }); }) }));
		expect(res.reason).toBe('avatar_done_unrigged:generation_failed');
		expect(res.text).toContain(`${BASE}/m/${CREATION}`);
	});
});

describe('never another account\'s image', () => {
	it.each([
		'@trythreews make me an avatar of @someone_else',
		'@trythreews make me an avatar using @someone_else profile picture',
		'@trythreews 3d my pfp but use @someone_else pic',
	])('text naming another account still uses only the author\'s picture: %s', async (text) => {
		const { parsed, event } = await row({ text, extra: { mentions: [{ username: 'trythreews', id: ACCOUNT.userId }, { username: 'someone_else', id: OTHER }] } });
		expect(parsed.intent).toBe('avatar');
		expect(JSON.stringify(parsed.args)).not.toContain('someone_else');
		const fetchImpl = cdn();
		await av.handleAvatar(event, deps({ fetchImpl }));
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(fetchImpl.mock.calls[0][0]).toContain('/1800000000000000001/');
		expect(fetchImpl.mock.calls[0][0]).not.toContain('1800000000000000002');
	});

	it('a reply to another account\'s post does not borrow that account\'s picture', async () => {
		const { event } = await row({
			extra: {
				inReplyToUserId: OTHER,
				repliedTo: { id: '1899999999999999000', available: true, text: 'hi', author: { id: OTHER, username: 'someone', profileImageUrl: OTHER_PFP }, media: [] },
			},
		});
		const fetchImpl = cdn();
		await av.handleAvatar(event, deps({ fetchImpl }));
		expect(fetchImpl.mock.calls[0][0]).toContain('/1800000000000000001/');
	});

	it('skips as not_own_image when the author object is not the asker, with no fetch', async () => {
		const { event } = await row();
		const fetchImpl = cdn();
		const res = await av.handleAvatar({ ...event, author: { id: OTHER, profileImageUrl: OTHER_PFP } }, deps({ fetchImpl }));
		expect(res).toMatchObject({ outcome: 'skip', reason: 'not_own_image' });
		expect(fetchImpl).not.toHaveBeenCalled();
		expect(await store.getMentionEvent(event.tweetId)).toMatchObject({ decision: 'skip', reason: 'not_own_image', reply_text: null });
		const missing = await av.handleAvatar({ ...event, author: null }, deps({ fetchImpl }));
		expect(missing.reason).toBe('not_own_image');
	});
});

describe('default profile image', () => {
	it('replies with the avatar studio link, records default_avatar, and generates nothing', async () => {
		const { event } = await row({ pfp: DEFAULT_PFP });
		const startForge = vi.fn();
		const fetchImpl = cdn();
		const res = await av.handleAvatar(event, deps({ startForge, fetchImpl }));
		expect(res).toMatchObject({ outcome: 'reply', reason: 'default_avatar', link: `${BASE}/create` });
		expect(res.text).toContain(`${BASE}/create`);
		expect(startForge).not.toHaveBeenCalled();
		expect(fetchImpl).not.toHaveBeenCalled();
		expect(await store.getMentionEvent(event.tweetId)).toMatchObject({ decision: 'reply', reason: 'default_avatar' });
	});
});

describe('moderation and CDN rules', () => {
	it('refuses an unsafe picture before it is stored or sent to the generator', async () => {
		const { event } = await row();
		const startForge = vi.fn();
		const res = await av.handleAvatar(event, deps({ startForge, describe: vi.fn(async () => ({ json: { safe: false, usable: true } })) }));
		expect(res).toMatchObject({ outcome: 'unsafe', reason: 'image_unsafe' });
		expect(persist).not.toHaveBeenCalled();
		expect(startForge).not.toHaveBeenCalled();
	});

	it('refuses a picture with no figure, and fails closed when no vision provider answers', async () => {
		const a = await row();
		expect((await av.handleAvatar(a.event, deps({ describe: vi.fn(async () => ({ json: { safe: true, usable: false } })) }))).reason).toBe('image_unusable');
		const b = await row();
		const startForge = vi.fn();
		const res = await av.handleAvatar(b.event, deps({ startForge, describe: vi.fn(async () => { throw new Error('no provider'); }) }));
		expect(res.reason).toBe('review_unavailable');
		expect(startForge).not.toHaveBeenCalled();
	});

	it('fetches profile pictures from the X photo CDN only', async () => {
		expect(media.xProfileImageUrl(OWN_PFP)).toBe('https://pbs.twimg.com/profile_images/1800000000000000001/AbCdEfGh_400x400.jpg');
		for (const url of ['https://evil.example/profile_images/a_normal.jpg', 'http://pbs.twimg.com/profile_images/a_normal.jpg', 'https://pbs.twimg.com.evil.example/profile_images/a_normal.jpg', 'https://pbs.twimg.com/media/a.jpg', 'https://u@pbs.twimg.com/profile_images/a_normal.jpg']) {
			expect(media.xProfileImageUrl(url)).toBeNull();
		}
		const { event } = await row();
		const fetchImpl = cdn();
		const res = await av.handleAvatar({ ...event, author: { id: ASKER, profileImageUrl: 'https://evil.example/profile_images/a_normal.jpg' } }, deps({ fetchImpl }));
		expect(res.reason).toBe('image_rejected:not_cdn');
		expect(fetchImpl).not.toHaveBeenCalled();
	});
});

describe('pending and follow-up', () => {
	it('keeps a mesh that is not done as pending, then rigs it and replies once', async () => {
		const { event } = await row();
		const slow = { job_id: 'mesh-job-1', creation_id: CREATION, status: 'queued' };
		const res = await av.handleAvatar(event, deps({ startForge: async () => slow, pollJob: vi.fn(async () => ({ _timedOut: true })) }));
		expect(res).toMatchObject({ outcome: 'pending', reason: 'avatar_pending' });
		const pending = await store.getMentionEvent(event.tweetId);
		expect(pending).toMatchObject({ decision: 'pending', reason: 'avatar_pending' });
		expect(pending.args.avatar).toMatchObject({ stage: 'mesh', job_id: 'mesh-job-1' });

		const waiting = await av.finishPendingAvatars({}, { base: BASE, pollOnce: async () => ({ status: 'running' }) });
		expect(waiting).toMatchObject({ checked: 1, waiting: 1 });

		const advanced = await av.finishPendingAvatars({}, { base: BASE, startRig, pollOnce: async () => ({ status: 'done', glb_url: MESH, creation_id: CREATION }) });
		expect(advanced.advanced).toBe(1);
		expect((await store.getMentionEvent(event.tweetId)).args.avatar).toMatchObject({ stage: 'rig', job_id: 'rig-job-1', mesh_glb_url: MESH });

		const deliver = vi.fn();
		const finished = await av.finishPendingAvatars({}, { base: BASE, deliver, pollOnce: async () => ({ status: 'done', glb_url: RIGGED }) });
		expect(finished.replied).toBe(1);
		const settled = await store.getMentionEvent(event.tweetId);
		expect(settled).toMatchObject({ decision: 'reply', reason: 'avatar_done_late' });
		expect(settled.reply_text).toContain('/pose?src=');
		expect(deliver).not.toHaveBeenCalled();
		expect((await av.finishPendingAvatars({}, { base: BASE, pollOnce: async () => ({ status: 'done', glb_url: RIGGED }) })).checked).toBe(0);
	});

	it('answers an overdue or failed job with the designed failure reply', async () => {
		const { event } = await row();
		const slow = { job_id: 'mesh-job-2', creation_id: CREATION, status: 'queued' };
		await av.handleAvatar(event, deps({ startForge: async () => slow, pollJob: vi.fn(async () => ({ _timedOut: true })) }));
		const out = await av.finishPendingAvatars({}, { base: BASE, pollOnce: async () => ({ status: 'failed' }) });
		expect(out.failed).toBe(1);
		const settled = await store.getMentionEvent(event.tweetId);
		expect(settled.reason).toBe('avatar_failed:generation_failed');
		expect(settled.reply_text).toContain(`${BASE}/create`);
	});
});

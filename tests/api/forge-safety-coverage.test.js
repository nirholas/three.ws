// Coverage of the Forge content-safety and takedown surface (order 169). The
// public-listing screen (api/_lib/content-safety*.js) is the one gate a model
// passes before three.ws puts its name behind it on a public page. These tests
// pin, on the real production schema (PGlite), that every other way a model can
// leave the owner's hands honours that gate, and that a takedown reaches every
// copy. Only the external signals (text classifier, vision), the alerter, the
// object store and the CDN are stubbed: the network boundary, nothing else.

import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import { createPgliteSql } from '../_helpers/pglite-sql.js';
import { createFullSchemaDb } from '../_helpers/pglite-full-schema.js';

const holder = vi.hoisted(() => ({ db: null }));

vi.mock('../../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, sql: (...args) => holder.db.sql(...args) };
});
const alerts = [];
vi.mock('../../api/_lib/alerts.js', () => ({ sendOpsAlert: async (...a) => { alerts.push(a); } }));
vi.mock('../../api/_lib/indexnow-queue.js', () => ({ announceIndexNow: () => {} }));
vi.mock('../../api/_lib/forge-owner-credentials.js', () => ({
	ownerCredentials: async () => ({ userId: '00000000-0000-4000-8000-0000000000aa', clientKey: null, manageToken: null }),
}));
// The object store is an in-memory bucket: the one thing stubbed at the storage
// boundary. `bucket.down` makes every call fail the way a rejected credential
// does, so the takedown's queue-for-purge path runs for real.
const bucket = vi.hoisted(() => ({ objects: new Map(), down: false }));
vi.mock('../../api/_lib/r2.js', async (importActual) => {
	const actual = await importActual();
	const refuse = () => {
		if (!bucket.down) return;
		const err = new Error('The AWS Access Key Id you provided does not exist in our records.');
		err.name = 'InvalidAccessKeyId';
		err.$metadata = { httpStatusCode: 403 };
		throw err;
	};
	return {
		...actual,
		objectStorageConfigured: () => true,
		listObjectsPage: async ({ prefix = '' }) => {
			refuse();
			return { objects: [...bucket.objects.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key })), nextToken: null };
		},
		deleteObject: async (key) => {
			refuse();
			bucket.objects.delete(key);
		},
	};
});

process.env.DATABASE_URL ||= 'postgres://pglite.test/db';
process.env.CRON_SECRET = 'coverage-secret';
process.env.SKETCHFAB_UPLOADS_PER_RUN = '5';
process.env.S3_PUBLIC_DOMAIN = 'https://bucket.coverage.test';
process.env.SKETCHFAB_API_TOKEN = 'sketchfab-coverage-token';

let pg;
let n = 0;
const CK = 'a'.repeat(64);

async function seed(over = {}) {
	const id = crypto.randomUUID();
	n += 1;
	const row = {
		prompt: `a tidy wooden stool number ${n}`, visibility: 'public', status: 'done', safety_status: null,
		internal: false, outcome: 'accepted', vote_count: 0, user_id: null, client_key: CK, parent: null, ...over,
	};
	await holder.db.sql`
		insert into forge_creations (id, client_key, user_id, prompt, preview_image_url, glb_url, status, outcome,
			visibility, safety_status, internal, vote_count, parent_creation_id)
		values (${id}, ${row.client_key}, ${row.user_id}, ${row.prompt}, 'https://x.test/p.png', 'https://x.test/m.glb',
			${row.status}, ${row.outcome}, ${row.visibility}, ${row.safety_status}, ${row.internal},
			${row.vote_count}, ${row.parent})
	`;
	return id;
}

function callHandler(handler, { method = 'GET', url = '/', headers = {} } = {}) {
	return new Promise((resolve) => {
		const sent = {};
		const res = {
			statusCode: 200,
			headersSent: false,
			setHeader(k, v) { sent[k.toLowerCase()] = v; },
			getHeader(k) { return sent[k.toLowerCase()]; },
			removeHeader(k) { delete sent[k.toLowerCase()]; },
			writeHead(code, h) { this.statusCode = code; Object.entries(h || {}).forEach(([k, v]) => this.setHeader(k, v)); return this; },
			write() { return true; },
			end(out) {
				this.headersSent = true;
				resolve({ status: this.statusCode, headers: sent, text: out ? String(out) : '' });
			},
		};
		handler(
			{ method, url, headers: { host: 'three.ws', authorization: 'Bearer coverage-secret', ...headers }, socket: { remoteAddress: '203.0.113.9' } },
			res,
		);
	});
}

beforeAll(async () => {
	({ pg } = await createFullSchemaDb());
	holder.db = createPgliteSql({ pg });
}, 300_000);

beforeEach(async () => {
	holder.db = createPgliteSql({ pg });
	alerts.length = 0;
	bucket.objects.clear();
	bucket.down = false;
	await holder.db.sql`delete from avatars`;
	await holder.db.sql`delete from sketchfab_uploads`;
	await holder.db.sql`delete from content_safety_reviews`;
	await holder.db.sql`delete from forge_removal_requests`;
	await holder.db.sql`delete from forge_creations`;
});

describe('the Sketchfab showcase honours visibility and the safety screen', () => {
	const select = async () => {
		const { default: handler } = await import('../../api/cron/sketchfab-showcase.js');
		const out = await callHandler(handler, { url: '/api/cron/sketchfab-showcase?dry_run=1' });
		expect(out.status).toBe(200);
		return JSON.parse(out.text).candidates.map((c) => c.id);
	};

	// The cron pushes a model to the official Sketchfab account, a third-party
	// copy under our brand. Its selection said "same bar as the forge gallery" but
	// never asked for visibility or the screen, so an accepted model that was
	// private, unlisted, held or blocked was eligible.
	it('never selects a private, unlisted, held or blocked model', async () => {
		const ok = await seed({ visibility: 'public', safety_status: 'clear' });
		const priv = await seed({ visibility: 'private', safety_status: 'clear' });
		const unlisted = await seed({ visibility: 'unlisted', safety_status: 'clear' });
		const held = await seed({ visibility: 'public', safety_status: 'held' });
		const blocked = await seed({ visibility: 'public', safety_status: 'blocked' });
		const ids = await select();
		expect(ids).toContain(ok);
		for (const id of [priv, unlisted, held, blocked]) expect(ids).not.toContain(id);
	});

	it('waits for a model whose public request is still pending the screen', async () => {
		const pending = await seed({ visibility: 'public', safety_status: 'pending' });
		const platformSeed = await seed({ visibility: null, safety_status: null, internal: true });
		const ids = await select();
		expect(ids).not.toContain(pending);
		expect(ids).toContain(platformSeed);
	});
});

describe('the social preview image honours visibility', () => {
	// /api/forge/:id/og answered for any id: a blocked or private model's preview
	// was one redirect away, and its prompt was drawn into the fallback card. The
	// share page already applies the visibility rule; the card did not.
	const og = async (id) => {
		const { default: handler } = await import('../../api/forge-og.js');
		return callHandler(handler, { url: `/api/forge-og?id=${id}` });
	};

	it('redirects to the preview of a public or unlisted model', async () => {
		for (const visibility of ['public', 'unlisted']) {
			const out = await og(await seed({ visibility, safety_status: 'clear' }));
			expect(out.status).toBe(302);
			expect(out.headers.location).toBe('https://x.test/p.png');
		}
	});

	it('answers the generic card, without the prompt or the preview, for a private or blocked model', async () => {
		const priv = await seed({ visibility: 'private', prompt: 'secret private thing' });
		const blocked = await seed({ visibility: 'private', safety_status: 'blocked', prompt: 'withheld flagged thing' });
		for (const [id, word] of [[priv, 'secret'], [blocked, 'withheld']]) {
			const out = await og(id);
			expect(out.status).toBe(404);
			expect(out.headers.location).toBeUndefined();
			expect(out.text).not.toContain(word);
		}
	});
});

// A creation as production writes it: the mesh, the preview, the web and LOD
// variants, a browser poster, the display thumbnail, a game-ready export of the
// mesh, and the /cdn/ derivatives of each image. Every object is in the bucket.
async function seedWithFiles(over = {}) {
	const { createHash } = await import('node:crypto');
	const { cdnUrl } = await import('../../api/_lib/r2.js');
	const id = crypto.randomUUID();
	const base = `forge/${CK.slice(0, 12)}/${id}`;
	const glbKey = `${base}.glb`;
	const previewKey = `${base}.png`;
	const meshUrl = cdnUrl(glbKey);
	const h = createHash('sha256').update(meshUrl).digest('hex').slice(0, 12);
	const keys = [
		glbKey, previewKey, `${base}.web.glb`, `${base}.lod.glb`, `${base}-poster.webp`,
		`forge/thumb/${id}.webp`, `forge/thumb/${id}.png`,
		`forge/gameready/${h}/quad-30000.glb`, `forge/gameready/${h}/quad-30000.fbx`,
		`variants/256/${previewKey}.abc123.webp`, `variants/512/forge/thumb/${id}.webp.def456.webp`,
	];
	for (const k of keys) bucket.objects.set(k, Buffer.from('x'));
	// Another model's files must survive a takedown of this one.
	bucket.objects.set('forge/gameready/ffffffffffff/quad-30000.glb', Buffer.from('other'));
	bucket.objects.set('forge/thumb/not-this-one.webp', Buffer.from('other'));
	await holder.db.sql`
		insert into forge_creations (id, client_key, prompt, glb_key, glb_url, preview_key, preview_image_url,
			web_glb_key, lod_glb_key, status, outcome, visibility, safety_status)
		values (${id}, ${CK}, ${over.prompt || 'a tidy wooden stool'}, ${glbKey}, ${meshUrl}, ${previewKey}, ${cdnUrl(previewKey)},
			${`${base}.web.glb`}, ${`${base}.lod.glb`}, 'done', 'accepted', 'public', 'clear')
	`;
	return { id, keys, glbKey };
}

describe('a takedown reaches every stored copy of the model', () => {
	// deleteCreation walked the creation's own prefix and the /cdn/ derivatives of
	// the images it found. The display thumbnail (forge/thumb/<id>.*) and the
	// game-ready exports (forge/gameready/<hash of the mesh URL>/) live under other
	// prefixes, so a removed model's rendered thumbnail and its engine exports kept
	// serving from the bucket.
	it('removes the thumbnail, the game-ready exports and their variants, and nothing of another model', async () => {
		const { id, keys } = await seedWithFiles();
		const { deleteCreation } = await import('../../api/_lib/forge-store.js');
		expect(await deleteCreation({ id, moderator: true })).toBe('deleted');
		for (const k of keys) expect(bucket.objects.has(k), `${k} should be gone`).toBe(false);
		expect(bucket.objects.has('forge/gameready/ffffffffffff/quad-30000.glb')).toBe(true);
		expect(bucket.objects.has('forge/thumb/not-this-one.webp')).toBe(true);
		const rows = await holder.db.sql`select id from forge_creations where id = ${id}`;
		expect(rows.length).toBe(0);
	});

	it('queues the derived copies for the purge cron when storage refuses the delete', async () => {
		const { id } = await seedWithFiles();
		bucket.down = true;
		const { deleteCreation } = await import('../../api/_lib/forge-store.js');
		expect(await deleteCreation({ id, moderator: true })).toBe('deleted');
		const queued = (await holder.db.sql`select target from forge_storage_purges where creation_id = ${id}`).map((r) => r.target);
		expect(queued.some((t) => t.startsWith('forge/gameready/'))).toBe(true);
		expect(queued).toContain(`forge/thumb/${id}.webp`);
	});
});

describe('a takedown also reaches what was made from the model', () => {
	// A model is copied out of the Forge in three ways: saved as an avatar (a new
	// bucket object under the saver's account), pushed to the official Sketchfab
	// account (a third-party copy), and remixed (a new creation that points back).
	// Deleting only the original left the avatar copy public and the Sketchfab
	// listing live.
	let userId;
	beforeEach(async () => {
		const rows = await holder.db.sql`select id from users limit 1`;
		userId = rows[0]?.id;
		if (!userId) {
			userId = crypto.randomUUID();
			await holder.db.sql`insert into users (id, email, display_name) values (${userId}, ${`takedown-${userId}@coverage.test`}, 'saver')`;
		}
	});

	const seedAvatar = async (meshUrl, over = {}) => {
		const id = crypto.randomUUID();
		const key = `u/${userId}/avatars/${id}.glb`;
		bucket.objects.set(key, Buffer.from('avatar'));
		await holder.db.sql`
			insert into avatars (id, owner_id, slug, name, storage_key, size_bytes, source, source_meta, visibility)
			values (${id}, ${userId}, ${`s-${id.slice(0, 8)}`}, 'Saved forge model', ${key}, 6, 'upload',
				${JSON.stringify({ source_glb_url: meshUrl, generator: 'chat-forge-avatar', ...over })}::jsonb, 'public')
		`;
		return { id, key };
	};

	it('lists the avatar copies, the Sketchfab listing and the remixes before anything is removed', async () => {
		const { id } = await seedWithFiles();
		const [row] = await holder.db.sql`select * from forge_creations where id = ${id}`;
		const avatar = await seedAvatar(row.glb_url);
		await seedAvatar('https://elsewhere.test/other.glb');
		const remix = await seed({ parent: id });
		await holder.db.sql`insert into sketchfab_uploads (creation_id, status, sketchfab_uid, sketchfab_url) values (${id}, 'live', 'uid123', 'https://sketchfab.com/models/uid123')`;
		const { findDerivedItems } = await import('../../api/_lib/forge-takedown.js');
		const items = await findDerivedItems(row);
		expect(items.avatars.map((a) => a.id)).toEqual([avatar.id]);
		expect(items.sketchfab.map((u) => u.sketchfab_uid)).toEqual(['uid123']);
		expect(items.remixes.map((r) => r.id)).toEqual([remix]);
	});

	it('removes the avatar copies and deletes the Sketchfab model, and a rerun is safe', async () => {
		const { id } = await seedWithFiles();
		const [row] = await holder.db.sql`select * from forge_creations where id = ${id}`;
		const avatar = await seedAvatar(row.glb_url);
		await holder.db.sql`insert into sketchfab_uploads (creation_id, status, sketchfab_uid) values (${id}, 'live', 'uid123')`;
		const calls = [];
		vi.stubGlobal('fetch', async (url, init) => {
			calls.push([String(url), init?.method, init?.headers?.authorization]);
			return new Response(null, { status: calls.length === 1 ? 204 : 404 });
		});
		try {
			const { findDerivedItems, removeDerivedItems } = await import('../../api/_lib/forge-takedown.js');
			const items = await findDerivedItems(row);
			const out = await removeDerivedItems(items);
			expect(out.failed).toEqual([]);
			expect(calls[0]).toEqual(['https://api.sketchfab.com/v3/models/uid123', 'DELETE', 'Token sketchfab-coverage-token']);
			const [a] = await holder.db.sql`select deleted_at from avatars where id = ${avatar.id}`;
			expect(a.deleted_at).not.toBeNull();
			expect(bucket.objects.has(avatar.key)).toBe(false);
			// The row is gone after deleteCreation, and a model Sketchfab already
			// dropped answers 404: neither is a failure on the second pass.
			const again = await removeDerivedItems(items);
			expect(again.failed).toEqual([]);
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it('reports what it could not remove instead of claiming a clean takedown', async () => {
		const { id } = await seedWithFiles();
		const [row] = await holder.db.sql`select * from forge_creations where id = ${id}`;
		const avatar = await seedAvatar(row.glb_url);
		await holder.db.sql`insert into sketchfab_uploads (creation_id, status, sketchfab_uid) values (${id}, 'live', 'uid123')`;
		vi.stubGlobal('fetch', async () => new Response('{}', { status: 500 }));
		bucket.down = true;
		try {
			const { findDerivedItems, removeDerivedItems } = await import('../../api/_lib/forge-takedown.js');
			const out = await removeDerivedItems(await findDerivedItems(row));
			expect(out.failed.map((f) => f.kind).sort()).toEqual(['avatar_object', 'sketchfab']);
			const [a] = await holder.db.sql`select deleted_at from avatars where id = ${avatar.id}`;
			expect(a.deleted_at).not.toBeNull();
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

describe('takedownCdnPaths names every cached surface of the model', () => {
	it('covers the page, the share page, the social card, the API reads, the feeds and every stored file with its variants', async () => {
		const { takedownCdnPaths } = await import('../../api/_lib/forge-takedown.js');
		const id = '11111111-2222-4333-8444-555555555555';
		const paths = takedownCdnPaths({ id, keys: [`forge/abc/${id}.glb`, `forge/abc/${id}.png`] });
		for (const p of [
			`/m/${id}`, `/m/${id}/*`, `/forge/share/${id}`, `/api/forge/${id}/og`, '/api/forge-creation',
			'/api/forge-gallery', '/api/creations', '/api/explore', '/api/render/glb',
			`/cdn/forge/abc/${id}.glb`, `/cdn/forge/abc/${id}.png`,
			`/cdn/_v/128/forge/abc/${id}.png`, `/cdn/_v/256/forge/abc/${id}.png`, `/cdn/_v/512/forge/abc/${id}.png`,
		]) expect(paths, p).toContain(p);
		expect(paths.some((p) => p.includes(`${id}.glb`) && p.includes('/_v/'))).toBe(false);
		expect(new Set(paths).size).toBe(paths.length);
	});
});

// ── The publish gate when the screening provider is down ────────────────────
const providerDown = {
	screenTextFn: async () => { throw new Error('NemoGuard 503 service unavailable'); },
	screenImageFn: async () => ({ checked: false, flagged: false, categories: [], error: 'vision_unconfigured' }),
};

describe('the publish gate with the screening provider down', () => {
	// Design: the screen fails CLOSED for public listing and open for everything
	// else. Generation, private use and link sharing never wait on it (owner
	// directive 2026-08-07: no refusal at generation); only "public" does, and an
	// outage reads as "being checked", never as clear and never as blocked.
	it('keeps the model unlisted and pending, records an undecided review, and never calls it clear', async () => {
		const { gatePublish } = await import('../../api/_lib/content-safety-store.js');
		const { screenCreation } = await import('../../api/_lib/content-safety.js');
		const id = await seed({ visibility: 'unlisted', safety_status: null, prompt: 'a tidy wooden stool' });
		const out = await gatePublish(id, { screen: (c) => screenCreation(c, providerDown) });
		expect(out).toEqual({ allow: false, outcome: 'pending' });
		const [row] = await holder.db.sql`select safety_status, visibility, publish_requested_at from forge_creations where id = ${id}`;
		expect(row.safety_status).toBe('pending');
		expect(row.visibility).toBe('unlisted');
		expect(row.publish_requested_at).not.toBeNull();
		const reviews = await holder.db.sql`select verdict from content_safety_reviews where subject_id = ${id}`;
		expect(reviews.map((r) => r.verdict)).toEqual(['undecided']);
	});

	it('still lets a model that was already cleared go public while the provider is down', async () => {
		const { gatePublish } = await import('../../api/_lib/content-safety-store.js');
		const id = await seed({ visibility: 'unlisted', safety_status: 'clear' });
		const screen = vi.fn();
		expect(await gatePublish(id, { screen })).toEqual({ allow: true });
		expect(screen).not.toHaveBeenCalled();
	});

	it('does not let one failed signal be outvoted by a clean one', async () => {
		const { screenCreation } = await import('../../api/_lib/content-safety.js');
		const out = await screenCreation(
			{ prompt: 'a tidy wooden stool', previewImageUrl: 'https://x.test/p.png' },
			{ screenTextFn: async () => ({ checked: true, flagged: false, categories: [] }), screenImageFn: providerDown.screenImageFn },
		);
		expect(out.verdict).toBe('undecided');
	});
});

describe('what the safety screen records and what the maker is told', () => {
	it('stores categories and model names for the operator, never the prompt or the image text', async () => {
		const { screenAndRecord } = await import('../../api/_lib/content-safety-store.js');
		const secret = 'ZEBRA-PROMPT-MARKER describe the flagged thing';
		const id = await seed({ prompt: secret, visibility: 'unlisted', safety_status: 'pending' });
		const [row] = await holder.db.sql`select id, prompt, preview_image_url, source_image_urls from forge_creations where id = ${id}`;
		const { screenCreation } = await import('../../api/_lib/content-safety.js');
		await screenAndRecord(row, {
			screen: (c) => screenCreation(c, {
				screenTextFn: async () => ({ checked: true, flagged: true, categories: ['violence'], model: 'nemoguard' }),
				screenImageFn: async () => ({ checked: true, flagged: false, categories: [], model: 'vision-x' }),
			}),
		});
		const reviews = await holder.db.sql`select * from content_safety_reviews where subject_id = ${id}`;
		expect(reviews).toHaveLength(1);
		expect(reviews[0].verdict).toBe('blocked');
		expect(reviews[0].categories).toEqual(['violence']);
		expect(JSON.stringify(reviews[0])).not.toContain('ZEBRA');
		expect(alerts.flat().join(' ')).not.toContain('ZEBRA');
	});
});

describe('the visibility endpoint answers a refusal plainly', () => {
	const patch = async (id, visibility) => {
		const { default: handler } = await import('../../api/forge-creation.js');
		const body = Buffer.from(JSON.stringify({ visibility }));
		return new Promise((resolve) => {
			const sent = {};
			const res = {
				statusCode: 200, headersSent: false,
				setHeader(k, v) { sent[k.toLowerCase()] = v; }, getHeader(k) { return sent[k.toLowerCase()]; }, removeHeader() {},
				writeHead(code) { this.statusCode = code; return this; }, write() { return true; },
				end(out) { this.headersSent = true; resolve({ status: this.statusCode, body: out ? JSON.parse(String(out)) : null }); },
			};
			handler({ method: 'PATCH', url: `/api/forge-creation?id=${id}`, headers: { host: 'three.ws', 'content-type': 'application/json' }, rawBody: body, socket: { remoteAddress: '203.0.113.9' } }, res);
		});
	};
	const UID = '00000000-0000-4000-8000-0000000000aa';
	beforeEach(async () => {
		await holder.db.sql`insert into users (id, email, display_name) values (${UID}, 'maker@coverage.test', 'maker') on conflict do nothing`;
	});

	it('answers 403 with a recovery path and no category for a blocked model', async () => {
		const id = await seed({ visibility: 'private', safety_status: 'blocked', user_id: UID, client_key: 'b'.repeat(64) });
		const out = await patch(id, 'public');
		expect(out.status).toBe(403);
		expect(out.body.error).toBe('blocked_by_safety_review');
		expect(out.body.message).toContain('/support');
		expect(out.body.message).not.toMatch(/violence|sexual|csam|minor|hate|abuse|illegal|you (made|tried|uploaded)/i);
	});

	it('answers 202 "being checked" when the screen could not answer', async () => {
		const id = await seed({ visibility: 'unlisted', safety_status: null, user_id: UID, client_key: 'b'.repeat(64) });
		const out = await patch(id, 'public');
		expect(out.status).toBe(202);
		expect(out.body.pending).toBe(true);
		expect(out.body.visibility).toBe('unlisted');
		expect(out.body.message).toMatch(/checked/);
	});
});

describe('the removal-request handler on the real schema', () => {
	const post = async (body, { ip = '198.51.100.7' } = {}) => {
		const { default: handler } = await import('../../api/forge-removal-request.js');
		return new Promise((resolve) => {
			const sent = {};
			const res = {
				statusCode: 200, headersSent: false,
				setHeader(k, v) { sent[k.toLowerCase()] = v; }, getHeader(k) { return sent[k.toLowerCase()]; }, removeHeader() {},
				writeHead(code, h) { this.statusCode = code; Object.entries(h || {}).forEach(([k, v]) => this.setHeader(k, v)); return this; }, write() { return true; },
				end(out) { this.headersSent = true; resolve({ status: this.statusCode, headers: sent, body: out ? JSON.parse(String(out)) : null }); },
			};
			handler({ method: 'POST', url: '/api/forge-removal-request', headers: { host: 'three.ws', 'content-type': 'application/json', 'x-forwarded-for': ip }, rawBody: Buffer.from(JSON.stringify(body)), socket: { remoteAddress: ip } }, res);
		});
	};

	it('files a request, hands back a receipt id, and stores no raw IP or address', async () => {
		const id = await seed();
		const out = await post({ creation_id: id, reason: 'copyright', details: 'This is my character, I hold the rights.', contact: 'owner@rights.test' }, { ip: '198.51.100.20' });
		expect(out.status).toBe(201);
		expect(out.body.id).toBeTruthy();
		expect(out.body.message).toMatch(/received/i);
		const rows = await holder.db.sql`select * from forge_removal_requests where id = ${out.body.id}`;
		expect(rows).toHaveLength(1);
		expect(rows[0].status).toBe('open');
		expect(rows[0].creation_id).toBe(id);
		expect(JSON.stringify(rows[0])).not.toContain('198.51.100.20');
	});

	it('answers 404 for an id that is not a model, and 400 naming the field for a bad request', async () => {
		expect((await post({ creation_id: crypto.randomUUID(), reason: 'my_content' })).status).toBe(404);
		const bad = await post({ creation_id: await seed(), reason: 'harmful' });
		expect(bad.status).toBe(400);
		expect(bad.body.field).toBe('details');
	});

	it('limits one caller to ten requests an hour with a Retry-After', async () => {
		const id = await seed();
		let last;
		for (let i = 0; i < 11; i++) last = await post({ creation_id: id, reason: 'my_content' }, { ip: '198.51.100.99' });
		expect(last.status).toBe(429);
		expect(last.headers['retry-after']).toBeTruthy();
	});
});

// ── Repeat abuse ────────────────────────────────────────────────────────────
describe('an owner whose models keep being blocked', () => {
	const OWNER = '00000000-0000-4000-8000-0000000000bb';
	const OTHER = '00000000-0000-4000-8000-0000000000cc';
	const blockedScreen = async () => ({ verdict: 'blocked', categories: ['violence'], csam: false, models: ['m'], signals: null });
	const clearScreen = async () => ({ verdict: 'clear', categories: [], csam: false, models: ['m'], signals: null });
	beforeEach(async () => {
		for (const [u, e] of [[OWNER, 'owner'], [OTHER, 'other']]) {
			await holder.db.sql`insert into users (id, email, display_name) values (${u}, ${`${e}@abuse.test`}, ${e}) on conflict do nothing`;
		}
	});
	const rowOf = async (id) => (await holder.db.sql`select id, prompt, preview_image_url, source_image_urls from forge_creations where id = ${id}`)[0];
	const block = async (userId, n) => {
		const { screenAndRecord } = await import('../../api/_lib/content-safety-store.js');
		for (let i = 0; i < n; i++) {
			const id = await seed({ visibility: 'unlisted', safety_status: 'pending', user_id: userId });
			await screenAndRecord(await rowOf(id), { screen: blockedScreen, requested: true });
		}
	};

	it('pages the operator at the third blocked model, and not before', async () => {
		await block(OWNER, 2);
		expect(alerts.filter(([t]) => /repeat/i.test(t))).toHaveLength(0);
		await block(OWNER, 1);
		const repeat = alerts.filter(([t]) => /repeat/i.test(t));
		expect(repeat).toHaveLength(1);
		expect(repeat[0][1]).toContain(OWNER);
	});

	it('holds a later model that screens clear for an operator instead of promoting it', async () => {
		await block(OWNER, 3);
		const { gatePublish, adminDecision } = await import('../../api/_lib/content-safety-store.js');
		const id = await seed({ visibility: 'unlisted', safety_status: null, user_id: OWNER });
		expect(await gatePublish(id, { screen: clearScreen })).toEqual({ allow: false, outcome: 'pending' });
		const [held] = await holder.db.sql`select safety_status, visibility from forge_creations where id = ${id}`;
		expect(held.safety_status).toBe('held');
		expect(held.visibility).toBe('unlisted');
		const reviewNote = await holder.db.sql`select note from content_safety_reviews where subject_id = ${id} order by created_at desc limit 1`;
		expect(reviewNote[0].note).toMatch(/repeat/i);
		// An operator can still approve it.
		await adminDecision({ id, action: 'approve', note: 'checked by hand', actor: 'cli:test' });
		const { gatePublish: again } = await import('../../api/_lib/content-safety-store.js');
		expect(await again(id)).toEqual({ allow: true });
	});

	it('leaves other accounts, and anonymous callers sharing the anon key, alone', async () => {
		await block(OWNER, 3);
		const { gatePublish, screenAndRecord } = await import('../../api/_lib/content-safety-store.js');
		const other = await seed({ visibility: 'unlisted', safety_status: null, user_id: OTHER, client_key: 'd'.repeat(64) });
		expect(await gatePublish(other, { screen: clearScreen })).toEqual({ allow: true });
		for (let i = 0; i < 3; i++) {
			const id = await seed({ visibility: 'unlisted', safety_status: 'pending', client_key: 'anon' });
			await screenAndRecord(await rowOf(id), { screen: blockedScreen, requested: true });
		}
		const stranger = await seed({ visibility: 'unlisted', safety_status: null, client_key: 'anon' });
		expect(await gatePublish(stranger, { screen: clearScreen })).toEqual({ allow: true });
	});

	it('keeps the sweep from promoting a repeat owner\'s requested model, and does not report it as an outage', async () => {
		await block(OWNER, 3);
		const { sweepContentSafety } = await import('../../api/_lib/content-safety-sweep.js');
		const id = await seed({ visibility: 'unlisted', safety_status: 'pending', user_id: OWNER });
		await holder.db.sql`update forge_creations set publish_requested_at = now() where id = ${id}`;
		const setVisibility = vi.fn(async () => ({ outcome: 'updated' }));
		const alert = vi.fn(async () => {});
		const stats = await sweepContentSafety({}, { screen: clearScreen, setVisibility, alert });
		expect(setVisibility).not.toHaveBeenCalled();
		expect(stats.held).toBe(1);
		expect(stats.undecided).toBe(0);
		expect(alert).not.toHaveBeenCalled();
		const [row] = await holder.db.sql`select safety_status, visibility from forge_creations where id = ${id}`;
		expect(row).toMatchObject({ safety_status: 'held', visibility: 'unlisted' });
	});

	it('forgets blocks older than the window', async () => {
		await block(OWNER, 3);
		await holder.db.sql`update forge_creations set safety_checked_at = now() - interval '40 days' where user_id = ${OWNER}`;
		const { gatePublish } = await import('../../api/_lib/content-safety-store.js');
		const id = await seed({ visibility: 'unlisted', safety_status: null, user_id: OWNER });
		expect(await gatePublish(id, { screen: clearScreen })).toEqual({ allow: true });
	});
});

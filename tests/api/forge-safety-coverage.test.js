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

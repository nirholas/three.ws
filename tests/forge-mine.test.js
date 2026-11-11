// GET /api/forge/mine: the signed-in user's own finished models, the list the
// PowerPoint add-in shows. The real handler runs behind a real HTTP server; the
// factory takes the authenticator and the store reader so the test can stand
// in for the session/bearer lookup and Postgres, while the auth, scope, paging
// and response-shaping code under test is the production path.

import { createServer } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createForgeMineHandler, toMineModel } from '../api/forge/mine.js';

const USER = '11111111-1111-4111-8111-111111111111';

const ROWS = [
	{
		id: 'aaaaaaaa-0000-4000-8000-000000000001',
		prompt: 'a low poly brass lantern',
		preview_image_url: 'https://three.ws/cdn/forge/a/thumb.webp',
		visibility: null,
		created_at: '2026-11-10T10:00:00.000Z',
	},
	{
		id: 'aaaaaaaa-0000-4000-8000-000000000002',
		prompt: 'auto-rig',
		preview_image_url: null,
		visibility: 'unlisted',
		created_at: '2026-11-09T10:00:00.000Z',
	},
	{
		id: 'aaaaaaaa-0000-4000-8000-000000000003',
		prompt: 'my secret prototype',
		preview_image_url: null,
		visibility: 'private',
		created_at: '2026-11-08T10:00:00.000Z',
	},
];

describe('toMineModel', () => {
	it('marks public and unlisted models exportable and private ones not', () => {
		expect(toMineModel(ROWS[0], 'https://three.ws')).toMatchObject({
			id: ROWS[0].id,
			title: 'A low poly brass lantern',
			visibility: 'public',
			exportable: true,
			modelUrl: `https://three.ws/m/${ROWS[0].id}`,
			previewImageUrl: ROWS[0].preview_image_url,
		});
		expect(toMineModel(ROWS[1], 'https://three.ws')).toMatchObject({ title: 'Rigged 3D character', visibility: 'unlisted', exportable: true });
		expect(toMineModel(ROWS[2], 'https://three.ws')).toMatchObject({ visibility: 'private', exportable: false });
	});
});

describe('GET /api/forge/mine', () => {
	let server;
	let base;
	const calls = [];

	beforeAll(async () => {
		const handler = createForgeMineHandler({
			authenticate: async (req) => {
				const auth = req.headers.authorization || '';
				if (auth === 'Bearer good') return { id: USER, source: 'bearer', scope: 'profile avatars:read' };
				if (auth === 'Bearer narrow') return { id: USER, source: 'bearer', scope: 'profile' };
				return null;
			},
			listOwn: async (args) => {
				calls.push(args);
				const start = args.before ? ROWS.findIndex((r) => r.created_at < args.before) : 0;
				return start < 0 ? [] : ROWS.slice(start, start + args.limit);
			},
		});
		server = createServer((req, res) => handler(req, res));
		await new Promise((r) => server.listen(0, '127.0.0.1', r));
		base = `http://127.0.0.1:${server.address().port}`;
	});

	afterAll(() => new Promise((r) => server.close(r)));

	it('asks a signed-out caller to sign in', async () => {
		const res = await fetch(`${base}/api/forge/mine`);
		expect(res.status).toBe(401);
		expect((await res.json()).error).toBe('unauthorized');
	});

	it('refuses a token without the avatars:read scope', async () => {
		const res = await fetch(`${base}/api/forge/mine`, { headers: { authorization: 'Bearer narrow' } });
		expect(res.status).toBe(403);
		expect((await res.json()).error).toBe('insufficient_scope');
	});

	it('lists the caller\'s models newest first, never cached, with a cursor for the next page', async () => {
		const res = await fetch(`${base}/api/forge/mine?limit=2`, { headers: { authorization: 'Bearer good' } });
		expect(res.status).toBe(200);
		expect(res.headers.get('cache-control')).toMatch(/private/);
		expect(res.headers.get('cache-control')).toMatch(/no-store/);
		const body = await res.json();
		expect(calls.at(-1)).toMatchObject({ userId: USER, limit: 2 });
		expect(body.models.map((m) => m.id)).toEqual([ROWS[0].id, ROWS[1].id]);
		expect(body.models[0].modelUrl).toBe(`${base}/m/${ROWS[0].id}`);
		expect(body.nextBefore).toBe(ROWS[1].created_at);

		const next = await fetch(`${base}/api/forge/mine?limit=2&before=${encodeURIComponent(body.nextBefore)}`, {
			headers: { authorization: 'Bearer good' },
		});
		const page2 = await next.json();
		expect(page2.models.map((m) => m.id)).toEqual([ROWS[2].id]);
		expect(page2.models[0].exportable).toBe(false);
		expect(page2.nextBefore).toBeNull();
	});

	it('clamps the page size and rejects a malformed cursor', async () => {
		await fetch(`${base}/api/forge/mine?limit=5000`, { headers: { authorization: 'Bearer good' } });
		expect(calls.at(-1).limit).toBe(48);
		const bad = await fetch(`${base}/api/forge/mine?before=yesterday`, { headers: { authorization: 'Bearer good' } });
		expect(bad.status).toBe(400);
		expect((await bad.json()).error).toBe('validation_error');
	});
});

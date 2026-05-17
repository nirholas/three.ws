// Tests for /api/assets — public asset library REST API. Reads on-disk
// manifests from /public/* via fs; no mocking needed for those (the real
// committed files are stable for the test).

import { describe, it, expect, beforeAll } from 'vitest';
import { Readable } from 'node:stream';

process.env.PUBLIC_APP_ORIGIN = 'https://three.ws';

const { default: handler } = await import('../../api/assets/index.js');

function makeReq(qs = '') {
	const req = Readable.from([]);
	req.method = 'GET';
	req.url = qs ? `/api/assets?${qs}` : '/api/assets';
	req.headers = { host: 'three.ws' };
	return req;
}

function makeRes() {
	return {
		statusCode: 200,
		headers: {},
		body: '',
		writableEnded: false,
		setHeader(k, v) {
			this.headers[k.toLowerCase()] = v;
		},
		end(chunk) {
			if (chunk !== undefined) this.body += chunk;
			this.writableEnded = true;
		},
	};
}

async function invoke(qs) {
	const req = makeReq(qs);
	const res = makeRes();
	await handler(req, res);
	return { res, status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}

describe('GET /api/assets', () => {
	let all;
	beforeAll(async () => {
		const result = await invoke('limit=500');
		all = result.body;
	});

	it('returns ok=true and a total + items list', () => {
		expect(all.ok).toBe(true);
		expect(typeof all.total).toBe('number');
		expect(Array.isArray(all.items)).toBe(true);
	});

	it('serves accessories, animations, and environments together by default', () => {
		const types = new Set(all.items.map((i) => i.type));
		expect(types.has('accessory')).toBe(true);
		expect(types.has('animation')).toBe(true);
		expect(types.has('environment')).toBe(true);
	});

	it('every item has an id, type, and name', () => {
		for (const i of all.items) {
			expect(i.id, JSON.stringify(i)).toBeTruthy();
			expect(i.type).toBeTruthy();
			expect(i.name).toBeTruthy();
		}
	});

	it('rejects non-GET methods', async () => {
		const req = makeReq();
		req.method = 'POST';
		const res = makeRes();
		await handler(req, res);
		expect(res.statusCode).toBe(405);
	});

	it('filters by type=accessory', async () => {
		const { body } = await invoke('type=accessory');
		expect(body.items.every((i) => i.type === 'accessory')).toBe(true);
	});

	it('filters by type=animation', async () => {
		const { body } = await invoke('type=animation');
		expect(body.items.every((i) => i.type === 'animation')).toBe(true);
		// Animation items expose loop + clip_url
		for (const i of body.items) {
			expect(typeof i.loop).toBe('boolean');
			expect(i.clip_url).toBeTruthy();
		}
	});

	it('filters animations by loop=true', async () => {
		const { body } = await invoke('type=animation&loop=true');
		expect(body.items.length).toBeGreaterThan(0);
		expect(body.items.every((i) => i.loop === true)).toBe(true);
	});

	it('filters animations by loop=false', async () => {
		const { body } = await invoke('type=animation&loop=false');
		expect(body.items.length).toBeGreaterThan(0);
		expect(body.items.every((i) => i.loop === false)).toBe(true);
	});

	it('filters accessories by kind=hat', async () => {
		const { body } = await invoke('type=accessory&kind=hat');
		expect(body.items.length).toBeGreaterThan(0);
		expect(body.items.every((i) => i.kind === 'hat')).toBe(true);
	});

	it('respects limit', async () => {
		const { body } = await invoke('limit=2');
		expect(body.items.length).toBeLessThanOrEqual(2);
		expect(body.total).toBeGreaterThan(body.items.length);
	});

	it('clamps limit to 500 max', async () => {
		const { body } = await invoke('limit=99999');
		expect(body.items.length).toBeLessThanOrEqual(500);
	});

	it('sets a long-lived cache-control header', async () => {
		const { res } = await invoke();
		const cc = res.headers['cache-control'];
		expect(cc).toContain('max-age=');
		expect(cc).toContain('stale-while-revalidate');
	});

	it('sets a permissive CORS header so external sites can fetch the catalog', async () => {
		const { res } = await invoke();
		expect(res.headers['access-control-allow-origin']).toBe('*');
	});

	it('environments include the named "Venice Sunset" and "Footprint Court"', () => {
		const envs = all.items.filter((i) => i.type === 'environment');
		const names = envs.map((e) => e.name);
		expect(names).toContain('Venice Sunset');
		expect(names).toContain('Footprint Court');
	});

	it('accessories include the seven committed accessory ids', () => {
		const accs = all.items.filter((i) => i.type === 'accessory');
		const ids = new Set(accs.map((a) => a.id));
		for (const id of [
			'hat-baseball',
			'hat-beanie',
			'hat-cowboy',
			'glasses-round',
			'glasses-shades',
			'earrings-hoops',
			'earrings-studs',
		]) {
			expect(ids.has(id), `missing accessory id ${id}`).toBe(true);
		}
	});
});

// POST /api/readme-3d: request validation, method gating and the SSRF guard,
// served through the real handler over a real HTTP socket. The conversion
// itself (bytes to a GitHub-renderable STL fence) is covered in
// packages/readme-3d/test/convert.test.js.

import { createServer } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import handler from '../api/readme-3d.js';

let server;
let base;

beforeAll(async () => {
	server = createServer((req, res) => handler(req, res));
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	base = `http://127.0.0.1:${server.address().port}/api/readme-3d`;
});

afterAll(() => new Promise((r) => server.close(r)));

const post = (body) =>
	fetch(base, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: typeof body === 'string' ? body : JSON.stringify(body),
	});

describe('POST /api/readme-3d', () => {
	it('rejects methods other than POST', async () => {
		const res = await fetch(base);
		expect(res.status).toBe(405);
	});

	it('requires a url', async () => {
		const res = await post({});
		expect(res.status).toBe(400);
		expect((await res.json()).error).toBe('validation_error');
	});

	it('rejects a non-numeric budget', async () => {
		const res = await post({ url: 'https://three.ws/avatars/fox.glb', budget: 'lots' });
		expect(res.status).toBe(400);
		expect((await res.json()).error).toBe('validation_error');
	});

	it('refuses cloud metadata and private addresses before fetching', async () => {
		const res = await post({ url: 'http://169.254.169.254/latest/meta-data/' });
		expect(res.status).toBe(400);
		const body = await res.json();
		expect(['private_address', 'scheme_not_allowed', 'blocked_host']).toContain(body.error);
	});
});

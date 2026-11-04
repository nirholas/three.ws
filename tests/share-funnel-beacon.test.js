// POST /api/share-funnel: only browser-visible events are accepted, nothing
// identifying is read, and the creation page head reports a view.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';

const { recordShareEvent } = vi.hoisted(() => ({ recordShareEvent: vi.fn(async () => true) }));
vi.mock('../api/_lib/share-funnel.js', async (orig) => ({
	...(await orig()),
	recordShareEvent,
}));
vi.mock('../api/_lib/rate-limit.js', async (orig) => ({
	...(await orig()),
	limits: { publicIp: async () => ({ success: true }) },
	clientIp: () => '203.0.113.9',
}));

const { default: handler } = await import('../api/share-funnel.js');
const { createCreationHeadRenderer } = await import('../server/creation-head.mjs');

async function post(body, { method = 'POST', contentType = 'application/json' } = {}) {
	const raw = typeof body === 'string' ? body : JSON.stringify(body);
	const req = Object.assign(Readable.from([Buffer.from(raw)]), {
		method,
		url: '/api/share-funnel',
		headers: { host: 'three.ws', 'content-type': contentType, 'content-length': String(raw.length) },
	});
	const out = { status: 200, body: '' };
	const headers = {};
	const res = {
		setHeader(k, v) { headers[k.toLowerCase()] = v; },
		getHeader(k) { return headers[k.toLowerCase()]; },
		end(b) { if (b) out.body += Buffer.from(b).toString('utf8'); },
		get statusCode() { return out.status; },
		set statusCode(v) { out.status = v; },
		get headersSent() { return false; },
		get writableEnded() { return false; },
	};
	await handler(req, res);
	return out;
}

beforeEach(() => recordShareEvent.mockClear());

describe('share funnel beacon', () => {
	it('counts an allowed browser event and answers 204', async () => {
		const r = await post({ surface: 'diorama_share', kind: 'action' });
		expect(r.status).toBe(204);
		expect(recordShareEvent).toHaveBeenCalledWith('diorama_share', 'action');
	});

	it('refuses server-side surfaces and kinds a browser cannot witness', async () => {
		for (const body of [
			{ surface: 'oembed_agent', kind: 'view' },
			{ surface: 'og_image', kind: 'view' },
			{ surface: 'ar', kind: 'view' },
			{ surface: 'ar', kind: 'bogus' },
			{},
		]) {
			expect((await post(body)).status).toBe(400);
		}
		expect(recordShareEvent).not.toHaveBeenCalled();
	});

	it('ignores identifiers smuggled into the body', async () => {
		await post({ surface: 'ar', kind: 'action', user_id: 'u1', creation_id: 'c1', ip: '1.2.3.4' });
		expect(recordShareEvent).toHaveBeenCalledTimes(1);
		expect(recordShareEvent.mock.calls[0]).toEqual(['ar', 'action']);
	});

	it('rejects a non-POST and a non-JSON body', async () => {
		expect((await post({ surface: 'ar', kind: 'action' }, { method: 'GET' })).status).toBe(405);
		expect((await post('surface=ar', { contentType: 'text/plain' })).status).toBe(415);
	});
});

describe('creation page head', () => {
	const creation = {
		id: '11111111-1111-4111-8111-111111111111',
		prompt: 'a brass lantern',
		glb_url: 'https://cdn.example.com/a.glb',
		preview_image_url: 'https://cdn.example.com/a.png',
	};
	const shell = '<!doctype html><html><head><title>x</title></head><body></body></html>';

	it('reports a view when a creation page is served, and not on a miss', async () => {
		const onView = vi.fn();
		const render = createCreationHeadRenderer({
			loadCreation: async (id) => (id === creation.id ? creation : null),
			onView,
		});
		await render(`/m/${creation.id}`, shell);
		expect(onView).toHaveBeenCalledTimes(1);
		await render('/m/22222222-2222-4222-8222-222222222222', shell);
		expect(onView).toHaveBeenCalledTimes(1);
	});

	it('still serves the page when the counter hook throws', async () => {
		const render = createCreationHeadRenderer({
			loadCreation: async () => creation,
			onView: () => { throw new Error('counter down'); },
		});
		expect(await render(`/m/${creation.id}`, shell)).toContain('<head>');
	});
});

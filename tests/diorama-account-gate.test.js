// Every POST /api/diorama action makes something (a world plan, an uploaded
// photo, a saved world, a merged GLB, server-side forges), so each needs an
// account. An anonymous caller gets 401 sign_in_required before any LLM call,
// upload or forge; an unknown action still answers its own 400. A headless
// build forwards the caller's credential to every /api/forge submit so each
// prop is gated and attributed to the same person.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

let signedIn = null;
vi.mock('../api/_lib/auth.js', async (orig) => ({
	...(await orig()),
	getRequestUser: async () => signedIn,
	getSessionUser: async () => signedIn,
}));
const llm = vi.fn(async () => ({ text: '' }));
vi.mock('../api/_lib/llm.js', () => ({ llmConfigured: () => true, llmComplete: (...a) => llm(...a) }));
vi.mock('../api/_lib/rate-limit.js', async (orig) => ({
	...(await orig()),
	limits: new Proxy({}, { get: () => async () => ({ success: true }) }),
	clientIp: () => '203.0.113.9',
}));
vi.mock('../api/_lib/diorama-store.js', () => ({
	saveDiorama: vi.fn(),
	getDiorama: vi.fn(),
	listDioramas: vi.fn(),
	bumpViews: vi.fn(),
	dioramaStoreEnabled: () => false,
}));

const { default: handler } = await import('../api/diorama.js');
const { forgeDioramaObjects } = await import('../api/_lib/diorama-build.js');

function call(body, headers = {}) {
	const req = new EventEmitter();
	req.method = 'POST';
	req.url = '/api/diorama';
	req.headers = { 'content-type': 'application/json', host: 'localhost', ...headers };
	req.body = body;
	req.socket = { remoteAddress: '203.0.113.9' };
	const h = {};
	let payload = '';
	return new Promise((resolve) => {
		const res = {
			statusCode: 200,
			headersSent: false,
			writableEnded: false,
			setHeader: (k, v) => { h[k.toLowerCase()] = v; },
			getHeader: (k) => h[k.toLowerCase()],
			writeHead(code) { this.statusCode = code; },
			write(c) { payload += c; },
			end(c) {
				if (c) payload += c;
				this.writableEnded = true;
				resolve({ status: this.statusCode, body: payload ? JSON.parse(payload) : null });
			},
		};
		Promise.resolve(handler(req, res)).catch((e) => resolve({ status: 500, body: { error: String(e) } }));
		setImmediate(() => req.emit('end'));
	});
}

describe('POST /api/diorama account gate', () => {
	beforeEach(() => { signedIn = null; llm.mockClear(); });

	for (const action of ['compose', 'compose-photo', 'save', 'export', 'build']) {
		it(`answers an anonymous ${action} with 401 sign_in_required`, async () => {
			const out = await call({ action, prompt: 'a tiny harbour town at dusk' });
			expect(out.status).toBe(401);
			expect(out.body).toMatchObject({ error: 'sign_in_required', sign_in_url: '/login' });
			expect(llm).not.toHaveBeenCalled();
		});
	}

	it('still answers an unknown action with its own 400', async () => {
		const out = await call({ action: 'bogus' });
		expect(out.status).toBe(400);
		expect(out.body.error).toBe('unknown_action');
	});

	it('lets a signed-in caller past the gate', async () => {
		signedIn = { id: 'user-dio' };
		const out = await call({ action: 'compose', prompt: 'x' });
		expect(out.status).not.toBe(401);
	});
});

describe('forgeDioramaObjects', () => {
	afterEach(() => vi.unstubAllGlobals());

	it("sends the caller's credential on every /api/forge submit", async () => {
		const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: 'done', glb_url: 'https://three.ws/cdn/p.glb' }), { status: 200 }));
		vi.stubGlobal('fetch', fetchMock);
		const plan = { objects: [{ id: 'a', label: 'boat', prompt: 'a small boat' }, { id: 'b', label: 'pier', prompt: 'a wooden pier' }] };
		const out = await forgeDioramaObjects(plan, { clientKey: 'k1', auth: { authorization: 'Bearer sk_test' } });
		expect(out.objects.every((o) => o.status === 'ready')).toBe(true);
		const forgeCalls = fetchMock.mock.calls.filter(([u]) => String(u).includes('/api/forge'));
		expect(forgeCalls.length).toBe(2);
		for (const [, init] of forgeCalls) expect(init.headers.authorization).toBe('Bearer sk_test');
	});
});

// POST /api/diorama action:compose returns a validated `game` block when the
// composer model implies a goal, omits it otherwise, and drops a hallucinated
// target instead of failing the world. The model is stubbed inside this test
// only; the route, validators and normalizers are the real ones.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';

const llm = { text: '' };
vi.mock('../api/_lib/llm.js', () => ({
	llmConfigured: () => true,
	llmComplete: async () => ({ text: llm.text }),
}));
vi.mock('../api/_lib/rate-limit.js', async (importOriginal) => {
	const actual = await importOriginal();
	return {
		...actual,
		limits: new Proxy({}, { get: () => async () => ({ success: true }) }),
		clientIp: () => '203.0.113.9',
	};
});
vi.mock('../api/_lib/diorama-store.js', () => ({
	saveDiorama: vi.fn(),
	getDiorama: vi.fn(),
	listDioramas: vi.fn(),
	bumpViews: vi.fn(),
	dioramaStoreEnabled: () => false,
}));
vi.mock('../api/_lib/auth.js', async (importOriginal) => ({ ...(await importOriginal()), getSessionUser: async () => null }));

const { default: handler } = await import('../api/diorama.js');

function call(body) {
	const req = new EventEmitter();
	req.method = 'POST';
	req.url = '/api/diorama';
	req.headers = { 'content-type': 'application/json', host: 'localhost' };
	req.body = body;
	req.socket = { remoteAddress: '203.0.113.9' };
	const headers = {};
	let payload = '';
	return new Promise((resolve) => {
		const res = {
			statusCode: 200,
			headersSent: false,
			writableEnded: false,
			setHeader: (k, v) => { headers[k.toLowerCase()] = v; },
			getHeader: (k) => headers[k.toLowerCase()],
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

const objects = [
	{ label: 'lantern', prompt: 'a brass lantern', position: [-3, 0, 0], scale: 1 },
	{ label: 'lantern', prompt: 'a brass lantern', position: [3, 0, 0], scale: 1 },
	{ label: 'lantern', prompt: 'a brass lantern', position: [0, 0, -3], scale: 1 },
	{ label: 'cabin', prompt: 'a small log cabin', position: [0, 0, 3], scale: 1.5 },
];
const plan = (game) => JSON.stringify({ title: 'Lantern Hill', mood: 'dusk', ground: 'meadow', island: 'round', objects, ...(game ? { game } : {}) });

beforeEach(() => { llm.text = ''; });

describe('diorama compose game block', () => {
	it('returns a game resolved to the final object ids', async () => {
		llm.text = plan({ goal: 'collect', targets: [0, 1, 2], count: 3, timeLimitSec: 90 });
		const { status, body } = await call({ action: 'compose', prompt: 'find the three lanterns before dusk' });
		expect(status).toBe(200);
		expect(body.diorama.game).toMatchObject({ goal: 'collect', targetIds: ['obj-0', 'obj-1', 'obj-2'], count: 3, timeLimitSec: 90 });
		expect(body.diorama.objects.map((o) => o.id)).toEqual(['obj-0', 'obj-1', 'obj-2', 'obj-3']);
		expect(body.diorama.objects.every((o) => o.status === 'pending' && o.glbUrl === null)).toBe(true);
	});

	it('omits the game when the sentence implies none', async () => {
		llm.text = plan(null);
		const { status, body } = await call({ action: 'compose', prompt: 'a quiet cabin on a hill' });
		expect(status).toBe(200);
		expect(body.diorama.game).toBeNull();
	});

	it('drops a hallucinated target instead of failing the request', async () => {
		llm.text = plan({ goal: 'collect', targets: [0, 17, 'lamp'], count: 3 });
		const { status, body } = await call({ action: 'compose', prompt: 'find the lanterns' });
		expect(status).toBe(200);
		expect(body.diorama.game.targetIds).toEqual(['obj-0']);
		expect(body.diorama.game.count).toBe(1);
	});

	it('drops the whole game when every target is invented', async () => {
		llm.text = plan({ goal: 'reach', targets: [42] });
		const { status, body } = await call({ action: 'compose', prompt: 'reach the castle' });
		expect(status).toBe(200);
		expect(body.diorama.game).toBeNull();
	});

	it('survives a game block with the wrong type', async () => {
		llm.text = plan('collect everything');
		const { status, body } = await call({ action: 'compose', prompt: 'collect everything' });
		expect(status).toBe(200);
		expect(body.diorama.game).toBeNull();
	});
});

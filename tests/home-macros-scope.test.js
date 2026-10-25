import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ access: null, macros: [] }));

vi.mock('../api/_lib/home/access.js', async (importOriginal) => ({
	...(await importOriginal()),
	resolveHomeAccess: vi.fn(async () => state.access),
}));
vi.mock('../api/_lib/home/runtime.js', async (importOriginal) => ({
	...(await importOriginal()),
	withHome: vi.fn(async (_homeId, _userId, fn) => fn({ macros: () => state.macros })),
}));
vi.mock('../api/_lib/rate-limit.js', () => ({
	limits: { homeRead: vi.fn(async () => ({ success: true })) },
}));

import macrosHandler from '../api/home/[id]/macros.js';

function run() {
	const res = {
		statusCode: 200,
		headers: {},
		body: '',
		writableEnded: false,
		headersSent: false,
		setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; },
		getHeader(k) { return this.headers[String(k).toLowerCase()]; },
		writeHead(code, h = {}) { this.statusCode = code; for (const [k, v] of Object.entries(h)) this.setHeader(k, v); },
		write(c) { this.body += c; return true; },
		end(c) { if (c) this.body += c; this.writableEnded = true; this.headersSent = true; },
		on() {},
	};
	const req = { method: 'GET', url: '/api/home/h1/macros', query: { id: 'h1' }, headers: {}, socket: { remoteAddress: '127.0.0.1' }, on() {} };
	return macrosHandler(req, res).then(() => ({ status: res.statusCode, body: res.body ? JSON.parse(res.body) : null }));
}

describe('GET /api/home/:id/macros respects a member scope', () => {
	beforeEach(() => {
		state.macros = [
			{ entityId: 'scene.kitchen_lights', name: 'Kitchen lights', kind: 'scene' },
			{ entityId: 'scene.disarm_alarm', name: 'Disarm alarm', kind: 'scene' },
		];
	});

	it('shows a scoped guest only the macros inside their scope', async () => {
		state.access = {
			ok: true, caller: { userId: 'u1' }, home: { id: 'h1' }, role: 'guest', scoped: true,
			scope: { mode: 'allow', entities: ['scene.kitchen_lights'], areas: [] },
		};
		const { status, body } = await run();
		expect(status).toBe(200);
		expect(body.macros.map((m) => m.entity_id)).toEqual(['scene.kitchen_lights']);
		expect(JSON.stringify(body)).not.toContain('scene.disarm_alarm');
	});

	it('shows an unscoped member every macro', async () => {
		state.access = { ok: true, caller: { userId: 'u1' }, home: { id: 'h1' }, role: 'owner', scoped: false, scope: { mode: 'all', entities: [], areas: [] } };
		const { body } = await run();
		expect(body.macros).toHaveLength(2);
	});
});

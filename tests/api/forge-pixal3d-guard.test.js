// "Match my photo" honesty guard: allowance, health gate, input-fault accounting,
// and the poll handler wiring that moves an overdue job to the standard lane with
// the user's original photo.
import { describe, it, expect, vi, beforeEach } from 'vitest';

Object.assign(process.env, {
	APP_ORIGIN: 'https://three.ws',
	JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long',
	MODEL_TRELLIS_URL: 'https://model-trellis.example.run.app',
	MODEL_PIXAL3D_URL: 'https://model-pixal3d.example.run.app',
	GCP_RECONSTRUCTION_KEY: 'test-gcp-key',
});

const submitModes = [];
let workerStatus = { status: 'running' };
vi.mock('../../api/_providers/gcp.js', () => ({
	createRegenProvider: () => ({
		submit: vi.fn(async ({ mode }) => {
			submitModes.push(mode);
			return { extJobId: `gcp-successor-${submitModes.length}` };
		}),
		status: vi.fn(async () => workerStatus),
	}),
}));

const sqlMock = vi.fn(async () => []);
vi.mock('../../api/_lib/db.js', async (importActual) => ({
	...(await importActual()),
	sql: (...a) => sqlMock(...a),
}));

const ORIGINAL_TASK = 'gcp-pixal-task';
const PHOTO = 'https://three.ws/cdn/forge/uploads/u1/photo.png';
const rows = new Map();
const createCreation = vi.fn(async (args) => {
	rows.set(args.replicateJobId, { tier: 'standard', path: 'image', prompt: 'image-to-3d', preview_image_url: PHOTO, backend: args.backend, created_at: new Date().toISOString() });
	return 'creation-2';
});
vi.mock('../../api/_lib/forge-store.js', () => ({
	hashClient: (v) => `client:${v || 'anon'}`,
	hashIp: (v) => `ip:${v}`,
	createCreation: (...a) => createCreation(...a),
	materializeCreation: vi.fn(async ({ glbUrl }) => ({ id: 'c', glbUrl })),
	markFailed: vi.fn(async () => {}),
	markSupersededBy: vi.fn(async () => true),
	findByJob: vi.fn(async ({ replicateJobId }) => rows.get(replicateJobId) ?? null),
}));
vi.mock('../../api/_lib/forge-lane-health.js', () => ({
	laneHealthSnapshot: vi.fn(async () => ({ byId: {} })),
	markLaneUnhealthy: vi.fn(async () => {}),
}));
const chain = new Map();
vi.mock('../../api/_lib/forge-failover.js', async (importActual) => {
	const actual = await importActual();
	return {
		...actual,
		resolveLiveJob: vi.fn(async (id) => chain.get(id) ?? null),
		bindJobSuccessor: vi.fn(async (id, rec) => (chain.set(id, { ...rec }), true)),
	};
});
vi.mock('../../api/_lib/rate-limit.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, limits: { ...actual.limits, mcp3dStatus: vi.fn(async () => ({ success: true, reset: Date.now() + 1000 })) }, clientIp: () => '203.0.113.9' };
});

const guard = await import('../../api/_lib/forge-pixal3d-guard.js');
const { default: handler } = await import('../../api/forge.js');
const { encodeJobToken } = await import('../../api/_lib/forge-job-token.js');

const JOB = encodeJobToken({ provider: 'gcp', taskId: ORIGINAL_TASK });
const req = () => ({ method: 'GET', url: `/api/forge?job=${encodeURIComponent(JOB)}`, headers: { 'x-forge-client': 'tester', 'x-client-region': 'US' }, on(e, cb) { if (e === 'end') cb(); } });
const res = () => ({ statusCode: 200, headers: {}, body: null, setHeader(n, v) { this.headers[n.toLowerCase()] = v; }, end(b) { this.body = b ? JSON.parse(b) : null; } });

beforeEach(() => {
	rows.clear();
	chain.clear();
	submitModes.length = 0;
	createCreation.mockClear();
	sqlMock.mockReset();
	guard.resetPixal3dStatsCache();
	workerStatus = { status: 'running' };
});

describe('allowance', () => {
	const now = Date.parse('2026-11-26T12:00:00Z');
	const ago = (s) => new Date(now - s * 1000).toISOString();
	it('flags only an overdue pixal3d job that is still pending', () => {
		expect(guard.allowanceExceeded({ backend: 'pixal3d', status: 'running', createdAt: ago(500), now })).toBe(true);
		expect(guard.allowanceExceeded({ backend: 'pixal3d', status: 'queued', createdAt: ago(500), now })).toBe(true);
		expect(guard.allowanceExceeded({ backend: 'pixal3d', status: 'running', createdAt: ago(100), now })).toBe(false);
		expect(guard.allowanceExceeded({ backend: 'pixal3d', status: 'done', createdAt: ago(900), now })).toBe(false);
		expect(guard.allowanceExceeded({ backend: 'trellis_selfhost', status: 'running', createdAt: ago(900), now })).toBe(false);
		expect(guard.allowanceExceeded({ backend: 'pixal3d', status: 'running', createdAt: null, now })).toBe(false);
	});
});

describe('health gate', () => {
	it('stays open on a thin sample and when the lane is healthy', () => {
		expect(guard.decideLaneGate({ done: 0, workerFailed: 4 }).gated).toBe(false);
		expect(guard.decideLaneGate({ done: 8, workerFailed: 2 }).gated).toBe(false);
	});
	it('closes when recent worker-attributable success is below the threshold', () => {
		const g = guard.decideLaneGate({ done: 2, workerFailed: 9 });
		expect(g.gated).toBe(true);
		expect(g.success_pct).toBe(18.2);
		expect(g.reason).toMatch(/standard engine/);
	});
	it('does not count unfetchable reference images against the lane', async () => {
		const mk = (status, error = '') => ({ status, error, seconds: status === 'done' ? 900 : 30 });
		sqlMock.mockResolvedValueOnce([
			mk('done'), mk('done'), mk('done'),
			...Array.from({ length: 8 }, () => mk('failed', 'image source tmpfiles.org is not a decodable image (UnidentifiedImageError)')),
			mk('failed', 'task orphaned: its runner instance stopped'),
		]);
		const h = await guard.pixal3dLaneHealth();
		expect(h.gated).toBe(false);
		expect(h.finished).toBe(4);
		expect(h.typical_seconds).toBe(900);
	});
	it('fails open when the database is unreachable', async () => {
		sqlMock.mockRejectedValueOnce(new Error('db down'));
		const h = await guard.pixal3dLaneHealth();
		expect(h.gated).toBe(false);
		expect(h.typical_seconds).toBeNull();
	});
});

describe('poll handler: overdue Match my photo job', () => {
	it('continues the same job on the standard lane with the original photo', async () => {
		rows.set(ORIGINAL_TASK, { tier: 'standard', path: 'image', prompt: 'image-to-3d', preview_image_url: PHOTO, backend: 'pixal3d', created_at: new Date(Date.now() - 600_000).toISOString() });
		const r = res();
		await handler(req(), r);
		expect(r.body.status).toBe('running');
		expect(r.body.failover_from).toBe('pixal3d');
		expect(r.body.backend).toBe('trellis_selfhost');
		expect(createCreation.mock.calls[0][0].previewImageUrl).toBe(PHOTO);
	});
	it('leaves a pixal3d job inside its allowance alone', async () => {
		rows.set(ORIGINAL_TASK, { tier: 'standard', path: 'image', prompt: 'image-to-3d', preview_image_url: PHOTO, backend: 'pixal3d', created_at: new Date(Date.now() - 60_000).toISOString() });
		const r = res();
		await handler(req(), r);
		expect(r.body.status).toBe('running');
		expect(r.body.failover_from).toBeUndefined();
		expect(submitModes).toEqual([]);
	});
});

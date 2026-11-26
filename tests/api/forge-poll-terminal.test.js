/**
 * Every job reaches done or failed, even when its worker never answers.
 *
 * The finalizer cron reaps any row still `generating` after the hard TTL
 * (api/cron/forge-finalize.js reapExpiredRows), but the browser's poll never
 * read that verdict. GET /api/forge?job= asks the upstream worker and relays
 * whatever it says, so a worker that keeps answering "queued" (never picked the
 * task up) or that stopped answering at all (every status call throws, which the
 * handler reports as "running") kept the page polling forever: the page resets
 * its run budget on every "queued" answer, so the wait had no end.
 *
 * The fix: after the upstream poll, a non-terminal answer is checked against the
 * creation row. A row the finalizer already failed is reported failed with its
 * stored reason, and a row past the hard TTL is failed by the poll itself. A
 * terminal upstream answer (done or failed) always wins, and a young job is
 * untouched.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

Object.assign(process.env, {
	APP_ORIGIN: 'https://three.ws',
	JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long',
	GCP_HUNYUAN3D_URL: 'https://hunyuan3d.example.run.app',
	GCP_RECONSTRUCTION_KEY: 'test-gcp-key',
});

// What the worker answers. Set per test.
let workerAnswer = { status: 'queued' };
let workerThrows = false;
vi.mock('../../api/_providers/gcp.js', () => ({
	createRegenProvider: () => ({
		submit: vi.fn(async () => ({ extJobId: 'never-used' })),
		status: vi.fn(async () => {
			if (workerThrows) throw new Error('connect ETIMEDOUT');
			return workerAnswer;
		}),
	}),
}));

const TASK = 'gcp-stuck-task';
let row = null;
const markFailed = vi.fn(async () => {});
vi.mock('../../api/_lib/forge-store.js', () => ({
	hashClient: (v) => `client:${v || 'anon'}`,
	hashIp: (v) => `ip:${v}`,
	ownerClientKey: (k) => (typeof k === 'string' && k ? k : null),
	createCreation: vi.fn(async () => 'creation-x'),
	materializeCreation: vi.fn(async ({ glbUrl }) => ({ id: 'creation-x', glbUrl })),
	markFailed: (...a) => markFailed(...a),
	markSupersededBy: vi.fn(async () => true),
	findByJob: vi.fn(async ({ replicateJobId }) => (replicateJobId === TASK ? row : null)),
}));

vi.mock('../../api/_lib/forge-lane-health.js', () => ({
	laneHealthSnapshot: vi.fn(async () => ({ byId: {} })),
	markLaneUnhealthy: vi.fn(async () => {}),
	laneCooldownKey: (id) => `forge-lane:${id}`,
}));

vi.mock('../../api/_lib/forge-failover.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, resolveLiveJob: vi.fn(async () => null), bindJobSuccessor: vi.fn(async () => true) };
});

vi.mock('../../api/_lib/rate-limit.js', async (importActual) => {
	const actual = await importActual();
	return {
		...actual,
		limits: { ...actual.limits, mcp3dStatus: vi.fn(async () => ({ success: true, reset: Date.now() + 1000 })) },
		clientIp: () => '203.0.113.9',
	};
});

// api/gpt-forge.js is a deliberate clone of api/forge.js serving the ChatGPT
// surfaces; it carried the same defect, so both are held to the same contract.
const HANDLERS = [
	['api/forge.js', (await import('../../api/forge.js')).default],
	['api/gpt-forge.js', (await import('../../api/gpt-forge.js')).default],
];
const { encodeJobToken } = await import('../../api/_lib/forge-job-token.js');
const { FORGE_JOB_HARD_TTL_MINUTES } = await import('../../api/_lib/forge-job-deadline.js');

const JOB = encodeJobToken({ provider: 'gcp', taskId: TASK });

async function poll(handler) {
	const res = {
		statusCode: 200,
		headers: {},
		body: null,
		setHeader(name, value) {
			this.headers[String(name).toLowerCase()] = value;
		},
		end(body) {
			this.body = body ? JSON.parse(body) : null;
		},
	};
	await handler(
		{
			method: 'GET',
			url: `/api/forge?job=${encodeURIComponent(JOB)}`,
			headers: { 'x-forge-client': 'tester' },
			on(event, cb) {
				if (event === 'end') cb();
			},
		},
		res,
	);
	return res;
}

function rowAged(minutes, extra = {}) {
	return {
		id: 'creation-stuck',
		status: 'generating',
		backend: 'hunyuan3d',
		tier: 'standard',
		path: 'image',
		prompt: 'a lantern',
		preview_image_url: 'https://cdn.example/ref.png',
		created_at: new Date(Date.now() - minutes * 60_000).toISOString(),
		superseded_by: null,
		...extra,
	};
}

beforeEach(() => {
	workerAnswer = { status: 'queued' };
	workerThrows = false;
	row = null;
	markFailed.mockClear();
});

describe.each(HANDLERS)('%s: poll of a job whose worker never answers', (_name, handler) => {
	it('reports the finalizer\'s verdict instead of "queued" forever', async () => {
		row = rowAged(FORGE_JOB_HARD_TTL_MINUTES + 2, {
			status: 'failed',
			error: 'generation timed out after 47 minutes',
		});
		const res = await poll(handler);
		expect(res.statusCode).toBe(200);
		expect(res.body.status).toBe('failed');
		expect(res.body.error).toMatch(/took too long/i);
		expect(res.body.job_id).toBe(JOB);
		// The finalizer already wrote the row; the poll does not write it again.
		expect(markFailed).not.toHaveBeenCalled();
	});

	it('fails a job past its allowance on its own when the finalizer has not run yet', async () => {
		row = rowAged(FORGE_JOB_HARD_TTL_MINUTES + 1);
		const res = await poll(handler);
		expect(res.body.status).toBe('failed');
		expect(res.body.error).toMatch(/took too long/i);
		expect(markFailed).toHaveBeenCalledWith(
			expect.objectContaining({ replicateJobId: TASK, error: expect.stringMatching(/timed out/) }),
		);
	});

	it('fails a past-allowance job whose worker stopped answering entirely', async () => {
		workerThrows = true;
		row = rowAged(FORGE_JOB_HARD_TTL_MINUTES + 5);
		const res = await poll(handler);
		expect(res.body.status).toBe('failed');
		expect(res.body.error).toBeTruthy();
	});

	it('leaves a young queued job alone', async () => {
		row = rowAged(4);
		const res = await poll(handler);
		expect(res.body.status).toBe('queued');
		expect(markFailed).not.toHaveBeenCalled();
	});

	it('does not fail a row that was superseded by a failover successor', async () => {
		row = rowAged(20, { status: 'failed', error: 'worker OOM', superseded_by: 'creation-next' });
		const res = await poll(handler);
		expect(res.body.status).toBe('queued');
	});

	// Last: api/gpt-forge.js caches a done frame per job handle, so a done answer
	// here would be replayed into any test that ran after it.
	it('lets a worker that finally finished win over a row the reaper already failed', async () => {
		workerAnswer = { status: 'done', resultGlbUrl: 'https://cdn.example/model.glb' };
		row = rowAged(FORGE_JOB_HARD_TTL_MINUTES + 2, { status: 'failed', error: 'generation timed out after 47 minutes' });
		const res = await poll(handler);
		expect(res.body.status).toBe('done');
		expect(res.body.glb_url).toBeTruthy();
	});
});

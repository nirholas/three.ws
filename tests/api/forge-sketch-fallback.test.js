/**
 * A sketch job whose worker fails continues on the standard image lane.
 *
 * The scribble worker (TripoSG) is the only lane built for a drawing, so poll
 * time failover used to skip sketch jobs: when the worker failed, the user got a
 * dead end with no engine to switch to. A drawing is still a picture, so the
 * standard image lanes can build it. These tests drive the real poll handler:
 *
 *   - a sketch job that fails for a worker fault is re-dispatched onto an image
 *     lane, bound to the original job id, reported as running, and the response
 *     says in words that the drawing is being treated as a picture;
 *   - the successor row is recorded as an image-path job, so its outcome is
 *     counted against the lane that served it and not against the sketch lane;
 *   - a failure that is the drawing's own fault (the worker could not read the
 *     image) is NOT re-dispatched, because every lane would fail on it too: it
 *     ends with a message that names the drawing;
 *   - the scribble lane is never asked twice, and a photo job is unchanged.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

Object.assign(process.env, {
	APP_ORIGIN: 'https://three.ws',
	JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long',
	GCP_TRIPOSG_URL: 'https://model-triposg.example.run.app',
	MODEL_TRELLIS_URL: 'https://model-trellis.example.run.app',
	GCP_HUNYUAN3D_URL: 'https://hunyuan3d.example.run.app',
	GCP_RECONSTRUCTION_KEY: 'test-gcp-key',
});

let submitSeq = 0;
let workerError = 'inference failed: CUDA error';
const submits = [];
vi.mock('../../api/_providers/gcp.js', () => ({
	createRegenProvider: () => ({
		submit: vi.fn(async (job) => {
			submits.push(job);
			return { extJobId: `gcp-successor-${++submitSeq}` };
		}),
		status: vi.fn(async () => ({ status: 'failed', error: workerError })),
	}),
}));
vi.mock('../../api/_providers/replicate.js', () => ({
	createRegenProvider: () => ({
		submit: vi.fn(async (job) => {
			submits.push(job);
			return { extJobId: `r8-pred-${++submitSeq}` };
		}),
		status: vi.fn(async () => ({ status: 'failed', error: 'prediction failed' })),
	}),
}));

const DRAWING = 'https://cdn.example/sketch.png';
const SKETCH_TASK = 'gcp-sketch-task';
const SKETCH_ROW = {
	tier: 'standard',
	path: 'sketch',
	prompt: 'a cartoon rocket with two tail fins',
	preview_image_url: DRAWING,
	views_requested: 1,
	views_used: 1,
	multiview: false,
	backend: 'triposg',
};
const rows = new Map();
const createCreation = vi.fn(async (args) => {
	rows.set(args.replicateJobId, {
		...SKETCH_ROW,
		backend: args.backend,
		path: args.path,
	});
	return `creation-${rows.size}`;
});
const markFailed = vi.fn(async () => {});
const markSupersededBy = vi.fn(async () => true);
vi.mock('../../api/_lib/forge-store.js', () => ({
	hashClient: (v) => `client:${v || 'anon'}`,
	hashIp: (v) => `ip:${v}`,
	createCreation: (...a) => createCreation(...a),
	materializeCreation: vi.fn(async ({ glbUrl }) => ({ id: 'creation-x', glbUrl })),
	markFailed: (...a) => markFailed(...a),
	markSupersededBy: (...a) => markSupersededBy(...a),
	findByJob: vi.fn(async ({ replicateJobId }) => rows.get(replicateJobId) ?? null),
}));

const markLaneUnhealthy = vi.fn(async () => {});
vi.mock('../../api/_lib/forge-lane-health.js', () => ({
	laneHealthSnapshot: vi.fn(async () => ({ byId: {} })),
	markLaneUnhealthy: (...a) => markLaneUnhealthy(...a),
}));

const chain = new Map();
vi.mock('../../api/_lib/forge-failover.js', async (importActual) => {
	const actual = await importActual();
	return {
		...actual,
		resolveLiveJob: vi.fn(async (jobId) => chain.get(jobId) ?? null),
		bindJobSuccessor: vi.fn(async (jobId, record) => {
			chain.set(jobId, { ...record });
			return true;
		}),
	};
});

vi.mock('../../api/_lib/rate-limit.js', async (importActual) => {
	const actual = await importActual();
	return {
		...actual,
		limits: { ...actual.limits, mcp3dStatus: vi.fn(async () => ({ success: true, reset: Date.now() + 1000 })) },
		clientIp: () => '203.0.113.9',
	};
});

const { default: forgeHandler } = await import('../../api/forge.js');
const { default: gptForgeHandler } = await import('../../api/gpt-forge.js');
const { encodeJobToken } = await import('../../api/_lib/forge-job-token.js');

function makeReq(jobId) {
	return {
		method: 'GET',
		url: `/api/forge?job=${encodeURIComponent(jobId)}`,
		headers: { 'x-forge-client': 'tester', 'x-client-region': 'US' },
		on(event, cb) {
			if (event === 'end') cb();
		},
	};
}

function makeRes() {
	return {
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
}

// Both Forge handlers carry their own copy of the poll-time failover wiring.
let handler = forgeHandler;
async function poll(jobId) {
	const res = makeRes();
	await handler(makeReq(jobId), res);
	return res;
}

const JOB = encodeJobToken({ provider: 'gcp', taskId: SKETCH_TASK });

beforeEach(() => {
	chain.clear();
	rows.clear();
	rows.set(SKETCH_TASK, { ...SKETCH_ROW });
	submitSeq = 0;
	workerError = 'inference failed: CUDA error';
	submits.length = 0;
	markLaneUnhealthy.mockClear();
	createCreation.mockClear();
	markFailed.mockClear();
	markSupersededBy.mockClear();
});

describe.each([
	['/api/forge', forgeHandler],
	['/api/gpt-forge', gptForgeHandler],
])('%s: a failed sketch job ends on the standard image lane', (_name, h) => {
	beforeEach(() => {
		handler = h;
	});

	it('re-dispatches onto an image lane and reports the job as still running', async () => {
		const res = await poll(JOB);

		expect(res.body.status).toBe('running');
		expect(res.body.job_id).toBe(JOB);
		expect(res.body.failover_from).toBe('triposg');
		expect(res.body.backend).toBeTruthy();
		expect(res.body.backend).not.toBe('triposg');
	});

	it('sends the drawing itself to the image lane, as its image input', async () => {
		await poll(JOB);

		expect(submits).toHaveLength(1);
		expect(submits[0].sourceUrl).toBe(DRAWING);
		expect(submits[0].params.images).toEqual([DRAWING]);
		// The scribble worker is not asked again, in either of its modes.
		expect(submits[0].mode).not.toBe('sketch');
		expect(submits[0].mode).not.toBe('triposg');
	});

	it('tells the user in words that the drawing is now being treated as a picture', async () => {
		const res = await poll(JOB);

		expect(typeof res.body.failover_note).toBe('string');
		expect(res.body.failover_note).toMatch(/sketch/i);
		expect(res.body.failover_note).toMatch(/drawing/i);
		expect(res.body.failover_note).toMatch(/picture|image/i);
		// Plain words only: no vendor, host or worker detail.
		expect(res.body.failover_note).not.toMatch(/triposg|cuda|worker|https?:/i);
	});

	it('records the successor as an image-path job so the lane that serves it is the one measured', async () => {
		await poll(JOB);

		expect(createCreation).toHaveBeenCalledTimes(1);
		expect(createCreation.mock.calls[0][0]).toMatchObject({
			path: 'image',
			previewImageUrl: DRAWING,
			prompt: SKETCH_ROW.prompt,
			viewsUsed: 1,
		});
		// Only api/forge.js links the failed attempt to its successor in the ledger.
		if (_name === '/api/forge') {
			expect(markSupersededBy).toHaveBeenCalledWith(
				expect.objectContaining({ replicateJobId: SKETCH_TASK }),
			);
		}
	});

	it('binds the successor to the original job id and never lists the scribble lane for a retry', async () => {
		await poll(JOB);
		expect(chain.get(JOB)).toMatchObject({ hop: 1, attempted: ['triposg'] });

		// Poll the successor to exhaustion: whatever the chain ends with, a
		// retry is never pointed at the sketch worker.
		let res;
		for (let i = 0; i < 6; i++) {
			res = await poll(JOB);
			if (res.body.status === 'failed') break;
		}
		expect(res.body.status).toBe('failed');
		expect(res.body.retry_backends ?? []).not.toContain('triposg');
	});

	it('adds no sketch note to the failover of a photo job', async () => {
		rows.set(SKETCH_TASK, { ...SKETCH_ROW, path: 'image', backend: 'trellis_selfhost' });
		const res = await poll(JOB);

		expect(res.body.status).toBe('running');
		expect(res.body.failover_note).toBeUndefined();
	});
});

describe.each([
	['/api/forge', forgeHandler],
	['/api/gpt-forge', gptForgeHandler],
])('%s: a drawing the worker could not read is the drawing\'s fault, not the lane\'s', (_name, h) => {
	beforeEach(() => {
		handler = h;
	});

	it('does not re-dispatch it, and the failure names the drawing in plain words', async () => {
		workerError = 'input image unusable: cannot identify image file';
		const res = await poll(JOB);

		expect(res.body.status).toBe('failed');
		expect(submits).toHaveLength(0);
		expect(res.body.error).toMatch(/drawing/i);
		expect(res.body.error).toMatch(/draw|upload|png|jpg/i);
		expect(res.body.error).not.toMatch(/cannot identify|unusable|pil/i);
	});

	it('does not cool the lane for it: the lane is healthy, the drawing was not', async () => {
		workerError = 'input image unusable: cannot identify image file';
		await poll(JOB);

		expect(markLaneUnhealthy).not.toHaveBeenCalled();
	});
});

/**
 * A duplicate submit returns the first job instead of starting a second one.
 *
 * The Forge page sends one Idempotency-Key per generation and keeps it in its
 * in-flight record (src/forge-inflight.js), so a second click, a held Enter key,
 * a second tab or a reload mid-submit all resend the SAME key with the SAME
 * body. This pins what POST /api/forge does with that, at the real handler:
 *
 *   - while the first submit is still running, the duplicate gets
 *     409 idempotency_in_progress with retry_after, and no second worker call;
 *   - once the first finishes, a duplicate gets the first job back, marked
 *     Idempotent-Replayed, and still no second worker call;
 *   - a different request under a reused key is refused, never run.
 *
 * The lane is TRELLIS.2 on the image path: a plain GCP lane with no failover or
 * health gate in front of it, so the only thing that can collapse two submits
 * into one is the idempotency wrapper under test.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';

vi.mock('../../api/_lib/auth.js', async (orig) => ({
	...(await orig()),
	getRequestUser: async () => ({ id: 'forge-dup-user' }),
}));

beforeAll(() => {
	Object.assign(process.env, {
		APP_ORIGIN: 'https://three.ws',
		MODEL_TRELLIS2_URL: 'https://trellis2.example.run.app',
		GCP_RECONSTRUCTION_KEY: 'test-gcp-key',
		JWT_SECRET: 'test-jwt-secret-at-least-32-characters-long',
	});
});

// The worker hand-off is held open until the test releases it, so the
// duplicate genuinely arrives while the first submit is still running.
let releaseSubmit = null;
let submitCount = 0;
let submitReached = null;
const gcpSubmit = vi.fn(async ({ params }) => {
	submitCount += 1;
	const n = submitCount;
	await new Promise((resolve) => {
		releaseSubmit = resolve;
		submitReached?.();
	});
	return { extJobId: `gcpjob-dup-${n}`, viewsUsed: params.images.length, multiview: false };
});
vi.mock('../../api/_providers/gcp.js', () => ({
	createRegenProvider: () => ({ submit: gcpSubmit }),
}));

vi.mock('../../api/_mcp3d/text-to-image.js', () => ({
	textToImage: vi.fn(async () => ({ imageUrl: 'https://cdn.example/ref.png', model: 'flux' })),
	synthesizeTurnaroundViews: vi.fn(async () => []),
}));

vi.mock('../../api/_lib/forge-store.js', () => ({
	hashClient: (v) => `client:${v || 'anon'}`,
	hashIp: (v) => `ip:${v}`,
	createCreation: vi.fn(async () => 'creation-dup-1'),
	materializeCreation: vi.fn(async () => null),
	markFailed: vi.fn(async () => {}),
	findByJob: vi.fn(async () => null),
	runWithCreationContext: (_facts, fn) => fn(),
}));

vi.mock('../../api/_lib/forge-lane-health.js', () => ({
	laneHealthSnapshot: vi.fn(async () => ({ statusMap: {}, byId: {} })),
	markLaneUnhealthy: vi.fn(async () => {}),
	laneCooldownKey: (id) => `forge-lane:${id}`,
}));

vi.mock('../../api/_lib/forge-image-validate.js', () => ({
	validateForgeImage: vi.fn(async () => ({ ok: true })),
}));

vi.mock('../../api/_lib/rate-limit.js', async (importActual) => {
	const actual = await importActual();
	return {
		...actual,
		limits: {
			...actual.limits,
			mcp3dGenerate: vi.fn(async () => ({ success: true, reset: Date.now() + 1000 })),
			mcp3dGenerateFree: vi.fn(async () => ({ success: true, reset: Date.now() + 1000 })),
		},
		clientIp: () => '203.0.113.9',
	};
});

const { default: handler } = await import('../../api/forge.js');

function makeReq(body, key) {
	return {
		method: 'POST',
		url: '/api/forge',
		headers: { 'content-type': 'application/json', 'x-forge-client': 'tester', 'idempotency-key': key },
		on(event, cb) {
			if (event === 'data') cb(Buffer.from(JSON.stringify(body)));
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
		getHeader(name) {
			return this.headers[String(name).toLowerCase()];
		},
		end(body) {
			this.body = body ? JSON.parse(body) : null;
		},
	};
}

async function post(body, key) {
	const res = makeRes();
	await handler(makeReq(body, key), res);
	return res;
}

// Wait until the next submit has reached the worker hand-off. The handler runs
// its gates first (auth, territory, limits, the view step), which takes from a
// few milliseconds to over a second when the suite runs beside others, so this
// waits for the hand-off itself rather than a fixed deadline; the suite's own
// test timeout bounds a submit that never arrives.
async function untilSubmitHeld() {
	if (releaseSubmit) return;
	await new Promise((resolve) => {
		submitReached = resolve;
	});
	submitReached = null;
}

const BODY = {
	image_urls: ['https://cdn.example/front.png'],
	path: 'image',
	tier: 'standard',
	backend: 'trellis2',
	seed: 424242,
	progress_id: 'progress-dup-1',
	skip_validation: true,
};

beforeEach(() => {
	gcpSubmit.mockClear();
	releaseSubmit = null;
	submitCount = 0;
});

describe('POST /api/forge duplicate submit', () => {
	it('a duplicate that arrives while the first is running is told to wait, and starts nothing', async () => {
		const key = randomUUID();
		const first = post(BODY, key);
		await untilSubmitHeld();

		const dup = await post(BODY, key);
		expect(dup.statusCode).toBe(409);
		expect(dup.body.error).toBe('idempotency_in_progress');
		expect(dup.body.retry_after).toBeGreaterThan(0);

		releaseSubmit();
		const res = await first;
		expect(res.statusCode).toBe(200);
		expect(res.body.job_id).toBeTruthy();
		expect(gcpSubmit).toHaveBeenCalledTimes(1);
	});

	it('a duplicate after the first finished gets the first job back', async () => {
		const key = randomUUID();
		const first = post(BODY, key);
		await untilSubmitHeld();
		releaseSubmit();
		const original = await first;
		expect(original.statusCode).toBe(200);

		// A second tab, a reload mid-submit, or a held Enter key: same key, same body.
		const again = await post(BODY, key);
		expect(again.statusCode).toBe(200);
		expect(again.body.job_id).toBe(original.body.job_id);
		expect(again.headers['idempotent-replayed']).toBe('true');
		expect(gcpSubmit).toHaveBeenCalledTimes(1);
	});

	it('a different request under a reused key is refused, never run', async () => {
		const key = randomUUID();
		const first = post(BODY, key);
		await untilSubmitHeld();
		releaseSubmit();
		await first;

		const other = await post({ ...BODY, image_urls: ['https://cdn.example/other.png'] }, key);
		expect(other.statusCode).toBe(422);
		expect(other.body.error).toBe('idempotency_key_reused');
		expect(gcpSubmit).toHaveBeenCalledTimes(1);
	});

	it('without a key two submits are two jobs (what the page used to send)', async () => {
		const one = (async () => {
			const res = makeRes();
			const req = makeReq(BODY, undefined);
			delete req.headers['idempotency-key'];
			await handler(req, res);
			return res;
		})();
		await untilSubmitHeld();
		const firstRelease = releaseSubmit;
		releaseSubmit = null;
		const two = (async () => {
			const res = makeRes();
			const req = makeReq(BODY, undefined);
			delete req.headers['idempotency-key'];
			await handler(req, res);
			return res;
		})();
		await untilSubmitHeld();
		firstRelease();
		releaseSubmit();
		const [a, b] = await Promise.all([one, two]);
		expect(a.statusCode).toBe(200);
		expect(b.statusCode).toBe(200);
		expect(gcpSubmit).toHaveBeenCalledTimes(2);
	});
});

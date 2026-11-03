// Forge-in-world network client (src/game/forge-prop.js): the /play bridge
// from "prompt or photo" to a durable GLB URL the multiplayer asset allow-list
// accepts. These tests pin the wire contract against /api/forge:
//
//   1. A text forge submits {prompt, tier:'draft', path:'image'} with the
//      x-forge-client identity header, polls the job, and resolves the glb_url.
//   2. A cache hit (submit answers status:'done' inline) never polls.
//   3. A failed job surfaces the server's error in a user-facing ForgeError.
//   4. A 429 submit reports the rate limit as retryable, not as a crash.
//   5. An image forge presigns via /api/forge-upload, PUTs the bytes, and
//      submits the granted public_url in image_urls.
//   6. An empty prompt with no image is refused before any network call.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { forgeWorldProp, forgePropName, ForgeError } from '../src/game/forge-prop.js';
import { propBudget, simplifyTarget, MB } from '../src/game/prop-budget.js';
import { makeGlb } from './helpers/make-glb.js';

const GLB_URL = 'https://pub-abc.r2.dev/forge/f1/model.glb';

function jsonResponse(status, body) {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: async () => body,
	};
}

// A fetch Response for a GLB download (what the size check reads).
function glbResponse(buffer = makeGlb({ triangles: 500 })) {
	return {
		ok: true,
		status: 200,
		headers: { get: (k) => (k.toLowerCase() === 'content-length' ? String(buffer.byteLength) : null) },
		arrayBuffer: async () => buffer,
	};
}

// The tier the budget tests run under (a desktop on the medium profile).
const BUDGET = propBudget({ profile: 'medium', coarse: false });

let fetchMock;

beforeEach(() => {
	vi.useFakeTimers();
	fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);
	// Node has no localStorage: the client id helper must fall back cleanly.
	vi.stubGlobal('localStorage', {
		_m: new Map(),
		getItem(k) { return this._m.get(k) ?? null; },
		setItem(k, v) { this._m.set(k, v); },
	});
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

// Drive a forgeWorldProp call and the fake timers together until it settles.
async function settle(promise) {
	let done = false;
	let result;
	let error;
	promise.then((r) => { done = true; result = r; }, (e) => { done = true; error = e; });
	for (let i = 0; i < 400 && !done; i++) {
		await vi.advanceTimersByTimeAsync(2500);
	}
	if (!done) throw new Error('forgeWorldProp never settled under fake timers');
	if (error) throw error;
	return result;
}

describe('forgeWorldProp (text prompt)', () => {
	it('submits the draft-tier request, polls, and resolves the finished GLB', async () => {
		fetchMock
			.mockResolvedValueOnce(jsonResponse(200, { status: 'queued', job_id: 'job123', eta_seconds: 5 }))
			.mockResolvedValueOnce(jsonResponse(200, { status: 'running', job_id: 'job123' }))
			.mockResolvedValueOnce(jsonResponse(200, { status: 'done', job_id: 'job123', glb_url: GLB_URL, durable: true, creation_id: 'c1' }))
			.mockResolvedValueOnce(glbResponse());

		const statuses = [];
		const out = await settle(forgeWorldProp({ prompt: 'a glowing campfire', budget: BUDGET, onStatus: (m) => statuses.push(m) }));

		expect(out.url).toBe(GLB_URL);
		expect(out.durable).toBe(true);
		expect(out.creationId).toBe('c1');
		expect(out.name).toBe('a glowing campfire');

		const [submitUrl, submitInit] = fetchMock.mock.calls[0];
		expect(submitUrl).toBe('/api/forge');
		expect(submitInit.method).toBe('POST');
		expect(submitInit.headers['x-forge-client']).toBeTruthy();
		expect(JSON.parse(submitInit.body)).toEqual({ tier: 'draft', path: 'image', prompt: 'a glowing campfire' });

		expect(fetchMock.mock.calls[1][0]).toBe('/api/forge?job=job123');
		expect(statuses.some((s) => s.includes('Forging'))).toBe(true);
	});

	it('resolves a cache hit inline without polling', async () => {
		fetchMock
			.mockResolvedValueOnce(jsonResponse(200, { status: 'done', glb_url: GLB_URL, durable: true, cached: true }))
			.mockResolvedValueOnce(glbResponse());
		const out = await settle(forgeWorldProp({ prompt: 'a wooden crate', budget: BUDGET }));
		expect(out.url).toBe(GLB_URL);
		// One submit and one size check: a cache hit never polls the job.
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('surfaces a failed job as a user-facing ForgeError', async () => {
		fetchMock
			.mockResolvedValueOnce(jsonResponse(200, { status: 'queued', job_id: 'job123' }))
			.mockResolvedValueOnce(jsonResponse(200, { status: 'failed', job_id: 'job123', error: 'nsfw prompt' }));
		await expect(settle(forgeWorldProp({ prompt: 'something the lane refuses' })))
			.rejects.toMatchObject({ name: 'ForgeError', message: expect.stringContaining('nsfw prompt') });
	});

	it('reports a 429 submit as rate limited', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(429, { error: 'rate_limited' }));
		await expect(settle(forgeWorldProp({ prompt: 'a tenth teapot this hour' })))
			.rejects.toMatchObject({ name: 'ForgeError', rateLimited: true });
	});

	it('refuses an empty request before any network call', async () => {
		await expect(forgeWorldProp({ prompt: '' })).rejects.toBeInstanceOf(ForgeError);
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe('forgeWorldProp (reference image)', () => {
	it('presigns, uploads, and submits the granted public URL in image_urls', async () => {
		const file = { name: 'chair.png', type: 'image/png', size: 1024 };
		fetchMock
			.mockResolvedValueOnce(jsonResponse(200, {
				upload_url: 'https://r2.example/put/abc',
				public_url: 'https://pub-abc.r2.dev/uploads/chair.png',
				method: 'PUT',
				headers: { 'content-type': 'image/png' },
			}))
			.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })
			.mockResolvedValueOnce(jsonResponse(200, { status: 'done', glb_url: GLB_URL, durable: true }))
			.mockResolvedValueOnce(glbResponse());

		const out = await settle(forgeWorldProp({ prompt: 'this chair', file, budget: BUDGET }));
		expect(out.url).toBe(GLB_URL);

		expect(fetchMock.mock.calls[0][0]).toBe('/api/forge-upload');
		expect(fetchMock.mock.calls[1][0]).toBe('https://r2.example/put/abc');
		expect(fetchMock.mock.calls[1][1].method).toBe('PUT');
		const submitBody = JSON.parse(fetchMock.mock.calls[2][1].body);
		expect(submitBody.image_urls).toEqual(['https://pub-abc.r2.dev/uploads/chair.png']);
		expect(submitBody.prompt).toBe('this chair');
	});

	it('rejects a non-image file before any network call', async () => {
		const file = { name: 'model.glb', type: 'model/gltf-binary', size: 1024 };
		await expect(settle(forgeWorldProp({ file }))).rejects.toMatchObject({
			name: 'ForgeError', message: expect.stringContaining('PNG, JPEG, or WebP'),
		});
		expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe('forgePropName', () => {
	it('prefers the prompt, falls back to the file name, and clamps length', () => {
		expect(forgePropName('a glowing campfire', null)).toBe('a glowing campfire');
		expect(forgePropName('', { name: 'red-chair.png' })).toBe('red-chair');
		expect(forgePropName('x'.repeat(60), null)).toHaveLength(24);
		expect(forgePropName('', null)).toBe('Forged item');
	});
});

// Size ceiling. A forged prop is delivered raw to every player in the world, so
// nothing over the ceiling may ever be returned for registration: it is
// simplified and re-checked, or rejected with a specific message.

const HEAVY = makeGlb({ triangles: BUDGET.maxTriangles + 40_000 });
const LIGHT = makeGlb({ triangles: 20_000 });
const SIMPLIFIED_URL = 'https://pub-abc.r2.dev/forge/world-props/abc123.glb';

function doneFrame() {
	return jsonResponse(200, { status: 'done', glb_url: GLB_URL, durable: true });
}

describe('forgeWorldProp size ceiling', () => {
	it('passes a model inside the ceiling through untouched, with no remesh call', async () => {
		fetchMock.mockResolvedValueOnce(doneFrame()).mockResolvedValueOnce(glbResponse(LIGHT));
		const out = await settle(forgeWorldProp({ prompt: 'a small crate', budget: BUDGET }));
		expect(out).toMatchObject({ url: GLB_URL, simplified: false, triangles: 20_000 });
		expect(fetchMock.mock.calls.some(([u]) => String(u).startsWith('/api/forge-remesh'))).toBe(false);
	});

	it('simplifies a model over the triangle ceiling and returns the re-checked result', async () => {
		fetchMock
			.mockResolvedValueOnce(doneFrame())
			.mockResolvedValueOnce(glbResponse(HEAVY))
			.mockResolvedValueOnce(jsonResponse(202, { job_id: 'remesh-job-0123456789ab', status: 'queued' }))
			.mockResolvedValueOnce(jsonResponse(200, { status: 'running' }))
			.mockResolvedValueOnce(jsonResponse(200, { status: 'done', result_url: SIMPLIFIED_URL, durable: true }))
			.mockResolvedValueOnce(glbResponse(LIGHT));
		const statuses = [];
		const out = await settle(forgeWorldProp({ prompt: 'a very detailed dragon', budget: BUDGET, onStatus: (m) => statuses.push(m) }));

		expect(out).toMatchObject({ url: SIMPLIFIED_URL, simplified: true, triangles: 20_000 });
		const [, submitInit] = fetchMock.mock.calls[2];
		expect(fetchMock.mock.calls[2][0]).toBe('/api/forge-remesh');
		expect(JSON.parse(submitInit.body)).toMatchObject({
			mesh_url: GLB_URL, remesh_mode: 'triangle', operation: 'simplify',
			target_faces: simplifyTarget(BUDGET), output_format: 'glb',
		});
		// The poll asks the server to mirror the result into storage the world accepts.
		expect(fetchMock.mock.calls[3][0]).toBe('/api/forge-remesh?job=remesh-job-0123456789ab&mirror=r2');
		expect(statuses.some((m) => /simplif/i.test(m))).toBe(true);
	});

	it('simplifies a model that is over the byte ceiling even when its triangle count is fine', async () => {
		const fat = makeGlb({ triangles: 1_000, extraBytes: BUDGET.maxBytes + 1 * MB });
		fetchMock
			.mockResolvedValueOnce(doneFrame())
			.mockResolvedValueOnce(glbResponse(fat))
			.mockResolvedValueOnce(jsonResponse(202, { job_id: 'remesh-job-0123456789ab', status: 'queued' }))
			.mockResolvedValueOnce(jsonResponse(200, { status: 'done', result_url: SIMPLIFIED_URL, durable: true }))
			.mockResolvedValueOnce(glbResponse(LIGHT));
		const out = await settle(forgeWorldProp({ prompt: 'a heavily textured vase', budget: BUDGET }));
		expect(out.simplified).toBe(true);
		expect(out.url).toBe(SIMPLIFIED_URL);
	});

	it('rejects, and never returns the raw model, when it is still over the ceiling after simplifying', async () => {
		fetchMock
			.mockResolvedValueOnce(doneFrame())
			.mockResolvedValueOnce(glbResponse(HEAVY))
			.mockResolvedValueOnce(jsonResponse(202, { job_id: 'remesh-job-0123456789ab', status: 'queued' }))
			.mockResolvedValueOnce(jsonResponse(200, { status: 'done', result_url: SIMPLIFIED_URL, durable: true }))
			.mockResolvedValueOnce(glbResponse(HEAVY));
		await expect(settle(forgeWorldProp({ prompt: 'an impossible mesh', budget: BUDGET })))
			.rejects.toMatchObject({ name: 'ForgeError', oversize: true, message: expect.stringContaining('too detailed') });
	});

	it('rejects with the oversize message when the simplifier is unavailable', async () => {
		fetchMock
			.mockResolvedValueOnce(doneFrame())
			.mockResolvedValueOnce(glbResponse(HEAVY))
			.mockResolvedValueOnce(jsonResponse(503, { error: 'unconfigured' }));
		await expect(settle(forgeWorldProp({ prompt: 'a heavy dragon', budget: BUDGET })))
			.rejects.toMatchObject({ name: 'ForgeError', oversize: true });
	});

	it('rejects a simplified result the world cannot load (not durable)', async () => {
		fetchMock
			.mockResolvedValueOnce(doneFrame())
			.mockResolvedValueOnce(glbResponse(HEAVY))
			.mockResolvedValueOnce(jsonResponse(202, { job_id: 'remesh-job-0123456789ab', status: 'queued' }))
			.mockResolvedValueOnce(jsonResponse(200, { status: 'done', result_url: 'https://worker.example/tmp.glb', durable: false }));
		await expect(settle(forgeWorldProp({ prompt: 'a heavy dragon', budget: BUDGET })))
			.rejects.toMatchObject({ name: 'ForgeError', oversize: true });
	});

	it('refuses to place a model it could not measure', async () => {
		fetchMock
			.mockResolvedValueOnce(doneFrame())
			.mockResolvedValueOnce({ ok: false, status: 404, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) });
		await expect(settle(forgeWorldProp({ prompt: 'a brass lamp', budget: BUDGET })))
			.rejects.toMatchObject({ name: 'ForgeError', message: expect.stringContaining('check') });
	});

	it('refuses a download larger than the measuring cap without reading it', async () => {
		const huge = { ok: true, status: 200, headers: { get: () => String(200 * MB) }, arrayBuffer: vi.fn() };
		fetchMock.mockResolvedValueOnce(doneFrame()).mockResolvedValueOnce(huge)
			.mockResolvedValueOnce(jsonResponse(503, { error: 'unconfigured' }));
		await expect(settle(forgeWorldProp({ prompt: 'a colossal statue', budget: BUDGET })))
			.rejects.toMatchObject({ name: 'ForgeError', oversize: true });
		expect(huge.arrayBuffer).not.toHaveBeenCalled();
	});
});

describe('forgeWorldProp in-world identity', () => {
	it('sends the world id so the server can apply the per-player and per-world limits', async () => {
		fetchMock.mockResolvedValueOnce(doneFrame()).mockResolvedValueOnce(glbResponse(LIGHT));
		await settle(forgeWorldProp({ prompt: 'a lantern', worldId: 'w:synthetic', budget: BUDGET }));
		expect(JSON.parse(fetchMock.mock.calls[0][1].body).world).toBe('w:synthetic');
	});

	it('surfaces the server wait time on a 429 cooldown', async () => {
		fetchMock.mockResolvedValueOnce({
			ok: false, status: 429,
			json: async () => ({ error: 'rate_limited', scope: 'player', retry_after: 17 }),
		});
		await expect(settle(forgeWorldProp({ prompt: 'a second lantern', worldId: 'w:synthetic', budget: BUDGET })))
			.rejects.toMatchObject({ rateLimited: true, retryAfter: 17, scope: 'player', message: expect.stringContaining('17') });
	});
});

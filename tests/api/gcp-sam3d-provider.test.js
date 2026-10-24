/**
 * The gcp provider's `sam3d` mode (api/_providers/gcp.js): the request shape
 * sent to workers/model-sam3d-objects and how a finished task maps to a scene
 * result. fetch is mocked at the network boundary only.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const realFetch = globalThis.fetch;
const WORKER = 'https://sam3d.example.run.app';

beforeEach(() => {
	process.env.GCP_RECONSTRUCTION_KEY = 'test-key';
	process.env.MODEL_SAM3D_URL = WORKER;
});
afterEach(() => {
	globalThis.fetch = realFetch;
	delete process.env.MODEL_SAM3D_URL;
});

const { createRegenProvider } = await import('../../api/_providers/gcp.js');

describe('gcp provider: sam3d', () => {
	it('is supported only when MODEL_SAM3D_URL is set', () => {
		expect(createRegenProvider().supportsMode('sam3d')).toBe(true);
		delete process.env.MODEL_SAM3D_URL;
		expect(createRegenProvider().supportsMode('sam3d')).toBe(false);
	});

	it('posts the photo and boxes to /infer', async () => {
		const fetchMock = vi.fn(async () => new Response(JSON.stringify({ task_id: 't-1', status: 'queued' }), { status: 202 }));
		globalThis.fetch = fetchMock;
		const job = await createRegenProvider().submit({
			mode: 'sam3d',
			sourceUrl: 'https://example.com/room.jpg',
			params: { boxes: [[0.1, 0.1, 0.5, 0.5]], maxObjects: 4, seed: 9 },
		});
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe(`${WORKER}/infer`);
		expect(JSON.parse(init.body)).toEqual({
			image_url: 'https://example.com/room.jpg',
			boxes: [[0.1, 0.1, 0.5, 0.5]],
			max_objects: 4,
			seed: 9,
		});
		expect(job.eta).toBe(150);
	});

	it('prefers mask URLs and never sends both', async () => {
		const fetchMock = vi.fn(async () => new Response(JSON.stringify({ task_id: 't-1' }), { status: 202 }));
		globalThis.fetch = fetchMock;
		await createRegenProvider().submit({
			mode: 'sam3d',
			sourceUrl: 'https://example.com/room.jpg',
			params: { maskUrls: ['https://example.com/m.png'], boxes: [[0.1, 0.1, 0.5, 0.5]] },
		});
		const body = JSON.parse(fetchMock.mock.calls[0][1].body);
		expect(body.mask_urls).toEqual(['https://example.com/m.png']);
		expect(body.boxes).toBeUndefined();
	});

	it('maps a done task to the scene GLB and its objects', async () => {
		globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ task_id: 't-2' }), { status: 202 }));
		const provider = createRegenProvider();
		const { extJobId } = await provider.submit({ mode: 'sam3d', sourceUrl: 'https://example.com/room.jpg', params: { boxes: [[0.1, 0.1, 0.5, 0.5]] } });
		globalThis.fetch = vi.fn(async () =>
			new Response(
				JSON.stringify({
					task_id: 't-2',
					status: 'done',
					result_gcs_url: 'https://storage.googleapis.com/b/scene.glb',
					objects: [{ id: 'object_01', centroid: [0, 0, -2] }],
					object_count: 1,
					skipped: [{ index: 1, reason: 'no mesh' }],
				}),
				{ status: 200 },
			),
		);
		const out = await provider.status(extJobId);
		expect(out).toMatchObject({
			status: 'done',
			resultGlbUrl: 'https://storage.googleapis.com/b/scene.glb',
			objects: [{ id: 'object_01', centroid: [0, 0, -2] }],
			objectCount: 1,
			skipped: [{ index: 1, reason: 'no mesh' }],
		});
	});
});

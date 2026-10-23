/**
 * The gcp provider's `triposplat` mode (api/_providers/gcp.js): request shape
 * sent to workers/model-triposplat and how a finished task maps to a splat
 * result. fetch is mocked at the network boundary only.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const realFetch = globalThis.fetch;
const WORKER = 'https://triposplat.example.run.app';

beforeEach(() => {
	process.env.GCP_RECONSTRUCTION_KEY = 'test-key';
	process.env.MODEL_TRIPOSPLAT_URL = WORKER;
});
afterEach(() => {
	globalThis.fetch = realFetch;
	delete process.env.MODEL_TRIPOSPLAT_URL;
});

const { createRegenProvider } = await import('../../api/_providers/gcp.js');

describe('gcp provider: triposplat', () => {
	it('is supported only when MODEL_TRIPOSPLAT_URL is set', () => {
		expect(createRegenProvider().supportsMode('triposplat')).toBe(true);
		delete process.env.MODEL_TRIPOSPLAT_URL;
		expect(createRegenProvider().supportsMode('triposplat')).toBe(false);
	});

	it('posts the image and density to /infer and reports one conditioning view', async () => {
		const fetchMock = vi.fn(async () => new Response(JSON.stringify({ task_id: 't-1', status: 'queued' }), { status: 202 }));
		globalThis.fetch = fetchMock;
		const job = await createRegenProvider().submit({
			mode: 'triposplat',
			sourceUrl: 'https://example.com/a.png',
			params: { num_gaussians: 65536 },
		});
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe(`${WORKER}/infer`);
		expect(JSON.parse(init.body)).toEqual({ images: ['https://example.com/a.png'], num_gaussians: 65536 });
		expect(job.viewsUsed).toBe(1);
		expect(job.eta).toBe(45);
	});

	it('maps a done task to the splat, ply and count', async () => {
		let extJobId;
		globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ task_id: 't-2' }), { status: 202 }));
		const provider = createRegenProvider();
		({ extJobId } = await provider.submit({ mode: 'triposplat', sourceUrl: 'https://example.com/a.png', params: {} }));
		globalThis.fetch = vi.fn(async () =>
			new Response(
				JSON.stringify({
					task_id: 't-2',
					status: 'done',
					splat_url: 'https://storage.googleapis.com/b/t.splat',
					ply_url: 'https://storage.googleapis.com/b/t.ply',
					num_gaussians: 65536,
				}),
				{ status: 200 },
			),
		);
		const out = await provider.status(extJobId);
		expect(out).toMatchObject({
			status: 'done',
			resultSplatUrl: 'https://storage.googleapis.com/b/t.splat',
			plyUrl: 'https://storage.googleapis.com/b/t.ply',
			numGaussians: 65536,
		});
		expect(out.resultGlbUrl).toBeUndefined();
	});
});

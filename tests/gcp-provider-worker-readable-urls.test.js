// A GPU worker fetches every input URL itself. An object written while R2
// rejected our credential lives only in the GCS fallback bucket, so its raw
// public-bucket URL (S3_PUBLIC_DOMAIN/<key>) 404s and only the first-party
// /cdn/<key> proxy, which reads through the fallback, serves it.
//
// 2026-11-18: model-rig was handed
//   https://pub-....r2.dev/u/<user>/draft-.../x.glb   (404)
// for an avatar that /cdn/u/<user>/draft-.../x.glb served 200, and TripoSG and
// TRELLIS were handed r2.dev reference images stored before the image-persist
// fix, so 70 of 77 generations in six hours failed. The provider is the one
// chokepoint every worker request passes through, so it rewrites our own
// bucket URLs to /cdn/ there.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const fetchUpstreamMock = vi.fn();
vi.mock('../api/_lib/upstream-fetch.js', () => ({
	fetchUpstream: (...args) => fetchUpstreamMock(...args),
}));

const ENV = {
	GCP_RECONSTRUCTION_KEY: 'test-bearer-key',
	GCP_RECONSTRUCTION_URL: 'https://recon.example.test',
	GCP_UNIRIG_URL: 'https://rig.example.test',
	GCP_TRIPOSG_URL: 'https://triposg.example.test',
	S3_PUBLIC_DOMAIN: 'https://pub-bucket.r2.dev',
	PUBLIC_APP_ORIGIN: 'https://three.ws',
};
const prior = {};
let createRegenProvider;

function sentBody() {
	expect(fetchUpstreamMock).toHaveBeenCalledTimes(1);
	return JSON.parse(fetchUpstreamMock.mock.calls[0][1].body);
}

beforeEach(async () => {
	for (const [k, v] of Object.entries(ENV)) {
		prior[k] = process.env[k];
		process.env[k] = v;
	}
	fetchUpstreamMock.mockReset();
	fetchUpstreamMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ task_id: 't1' }) });
	vi.resetModules();
	({ createRegenProvider } = await import('../api/_providers/gcp.js'));
});

afterEach(() => {
	for (const k of Object.keys(ENV)) {
		if (prior[k] === undefined) delete process.env[k];
		else process.env[k] = prior[k];
	}
});

describe('gcp provider hands workers URLs that survive an R2 outage', () => {
	it('rewrites a raw bucket mesh URL to the /cdn/ proxy for the rig worker', async () => {
		await createRegenProvider().submit({
			mode: 'rerig',
			sourceUrl: 'https://pub-bucket.r2.dev/u/0a5e/draft-jvaja0/mwmex75x.glb',
			params: {},
		});
		expect(sentBody().mesh_gcs_url).toBe('https://three.ws/cdn/u/0a5e/draft-jvaja0/mwmex75x.glb');
	});

	it('rewrites raw bucket reference images for an image lane', async () => {
		await createRegenProvider().submit({
			mode: 'triposg',
			sourceUrl: 'https://pub-bucket.r2.dev/forge/refs/d9b0.jpg',
			params: {},
		});
		expect(sentBody().images).toEqual(['https://three.ws/cdn/forge/refs/d9b0.jpg']);
	});

	it('rewrites every bucket URL in a multi-view request, keeping query strings out of the key', async () => {
		await createRegenProvider().submit({
			mode: 'reconstruct',
			sourceUrl: null,
			params: {
				images: [
					'https://pub-bucket.r2.dev/forge/refs/a.png?v=2',
					'https://three.ws/cdn/forge/refs/b.png',
				],
			},
		});
		expect(sentBody().images).toEqual([
			'https://three.ws/cdn/forge/refs/a.png',
			'https://three.ws/cdn/forge/refs/b.png',
		]);
	});

	it('leaves third-party URLs and inline data URIs untouched', async () => {
		await createRegenProvider().submit({
			mode: 'reconstruct',
			sourceUrl: null,
			params: {
				images: [
					'https://upload.wikimedia.org/cat.jpg',
					'data:image/png;base64,iVBORw0KGgo=',
					'https://pub-bucket.r2.dev.attacker.test/x.png',
				],
			},
		});
		expect(sentBody().images).toEqual([
			'https://upload.wikimedia.org/cat.jpg',
			'data:image/png;base64,iVBORw0KGgo=',
			'https://pub-bucket.r2.dev.attacker.test/x.png',
		]);
	});

	it('still submits when object storage is not configured on this deployment', async () => {
		delete process.env.S3_PUBLIC_DOMAIN;
		await createRegenProvider().submit({
			mode: 'triposg',
			sourceUrl: 'https://upload.wikimedia.org/cat.jpg',
			params: {},
		});
		expect(sentBody().images).toEqual(['https://upload.wikimedia.org/cat.jpg']);
	});
});

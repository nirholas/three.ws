// AR Studio "From a photo" client (src/ar/photo-scene.js): the network legs and
// the pure sizing, driven through an injected fetch so every failure the tray
// can show is pinned to the server answer that causes it.

import { describe, expect, it, vi } from 'vitest';

import {
	fitPhotoSize,
	PhotoSceneError,
	probePhotoScene,
	startPhotoScene,
	uploadPhoto,
	waitForPhotoScene,
} from '../src/ar/photo-scene.js';

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const blob = (size = 1000) => new Blob([new Uint8Array(size)], { type: 'image/jpeg' });

describe('fitPhotoSize', () => {
	it('caps the long edge and keeps aspect', () => {
		expect(fitPhotoSize(4032, 3024)).toEqual({ width: 2048, height: 1536 });
		expect(fitPhotoSize(3024, 4032)).toEqual({ width: 1536, height: 2048 });
	});
	it('never upscales and never returns zero', () => {
		expect(fitPhotoSize(640, 480)).toEqual({ width: 640, height: 480 });
		expect(fitPhotoSize(0, NaN)).toEqual({ width: 1, height: 1 });
	});
});

describe('probePhotoScene', () => {
	it('reports an available lane', async () => {
		const fetchImpl = vi.fn(async () => json(200, { available: true, reason: null, message: null, max_objects: 12, default_objects: 8 }));
		const out = await probePhotoScene({ fetchImpl });
		expect(out).toEqual({ available: true, reason: null, message: null, maxObjects: 12, defaultObjects: 8 });
		expect(fetchImpl.mock.calls[0][0]).toBe('/api/forge-scene-objects?status');
	});
	it('reports an off lane with the server reason', async () => {
		const out = await probePhotoScene({ fetchImpl: async () => json(200, { available: false, reason: 'backend_unconfigured', message: 'not switched on yet' }) });
		expect(out.available).toBe(false);
		expect(out.reason).toBe('backend_unconfigured');
	});
	it('never throws on a dead network', async () => {
		const out = await probePhotoScene({ fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
		expect(out).toMatchObject({ available: false, reason: 'network' });
	});
});

describe('uploadPhoto', () => {
	it('presigns, PUTs the bytes, and returns the public URL', async () => {
		const fetchImpl = vi.fn(async (url) =>
			url === '/api/forge-upload'
				? json(200, { upload_url: 'https://r2.example/put', public_url: 'https://cdn.three.ws/forge/uploads/a.jpg', method: 'PUT', headers: { 'content-type': 'image/jpeg' } })
				: new Response(null, { status: 200 }),
		);
		const b = blob();
		const url = await uploadPhoto(b, { clientId: 'cid-1', fetchImpl });
		expect(url).toBe('https://cdn.three.ws/forge/uploads/a.jpg');
		const presign = fetchImpl.mock.calls[0][1];
		expect(presign.headers['x-forge-client']).toBe('cid-1');
		expect(JSON.parse(presign.body)).toEqual({ content_type: 'image/jpeg', size_bytes: 1000 });
		expect(fetchImpl.mock.calls[1][1].body).toBe(b);
	});
	it.each([
		[json(503, { error: 'unconfigured' }), 'upload_unavailable'],
		[json(503, { error: 'storage_unavailable' }), 'upload_unavailable'],
		[json(429, {}), 'rate_limited'],
		[json(500, { message: 'boom' }), 'upload_failed'],
	])('maps a presign failure to a code', async (res, code) => {
		await expect(uploadPhoto(blob(), { clientId: 'c', fetchImpl: async () => res })).rejects.toMatchObject({ code });
	});
	it('refuses an oversized blob before any request', async () => {
		const fetchImpl = vi.fn();
		await expect(uploadPhoto(blob(9 * 1024 * 1024), { clientId: 'c', fetchImpl })).rejects.toMatchObject({ code: 'too_large' });
		expect(fetchImpl).not.toHaveBeenCalled();
	});
	it('reports a rejected PUT', async () => {
		const fetchImpl = async (url) => (url === '/api/forge-upload' ? json(200, { upload_url: 'https://r2/x', public_url: 'https://cdn/x.jpg' }) : new Response(null, { status: 403 }));
		await expect(uploadPhoto(blob(), { clientId: 'c', fetchImpl })).rejects.toMatchObject({ code: 'upload_failed' });
	});
});

describe('startPhotoScene', () => {
	it('queues the job with the photo and object cap', async () => {
		const fetchImpl = vi.fn(async () => json(202, { job_id: 'j'.repeat(24), eta_seconds: 150, source: 'detected', objects: [{ label: 'chair' }] }));
		const out = await startPhotoScene('https://cdn/x.jpg', { clientId: 'c', maxObjects: 6, fetchImpl });
		expect(out.objects[0].label).toBe('chair');
		expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ image_url: 'https://cdn/x.jpg', max_objects: 6 });
	});
	it.each([
		[503, 'unconfigured'],
		[451, 'unavailable_in_region'],
		[429, 'rate_limited'],
	])('maps HTTP %i to %s', async (status, code) => {
		await expect(startPhotoScene('https://cdn/x.jpg', { fetchImpl: async () => json(status, {}) })).rejects.toMatchObject({ code });
	});
	it('passes the server sentence through for a bad photo', async () => {
		const err = await startPhotoScene('https://cdn/x.jpg', {
			fetchImpl: async () => json(422, { error: 'no_objects_found', message: 'No separate objects were found in the photo.' }),
		}).catch((e) => e);
		expect(err).toBeInstanceOf(PhotoSceneError);
		expect(err.code).toBe('no_objects_found');
		expect(err.message).toMatch(/No separate objects/);
	});
});

describe('waitForPhotoScene', () => {
	const clock = () => {
		let t = 0;
		return { sleep: async (ms) => { t += ms; }, now: () => t };
	};

	it('polls through queued and running, reporting real elapsed time', async () => {
		const answers = [
			json(200, { status: 'queued' }),
			json(200, { status: 'running' }),
			json(200, { status: 'done', result_url: 'https://storage.googleapis.com/b/scene.glb', objects: [{ name: 'object_01' }] }),
		];
		const ticks = [];
		const out = await waitForPhotoScene('j'.repeat(24), {
			fetchImpl: async () => answers.shift(), intervalMs: 4000, onTick: (ms, s) => ticks.push([ms, s]), ...clock(),
		});
		expect(out.result_url).toMatch(/scene\.glb$/);
		expect(ticks).toEqual([[4000, 'queued'], [8000, 'running']]);
	});
	it('surfaces the worker failure sentence', async () => {
		await expect(waitForPhotoScene('j'.repeat(24), {
			fetchImpl: async () => json(200, { status: 'failed', error: 'no object could be reconstructed' }), ...clock(),
		})).rejects.toMatchObject({ code: 'failed', message: 'no object could be reconstructed' });
	});
	it('gives up past the deadline', async () => {
		await expect(waitForPhotoScene('j'.repeat(24), {
			fetchImpl: async () => json(200, { status: 'running' }), intervalMs: 1000, deadlineMs: 3000, ...clock(),
		})).rejects.toMatchObject({ code: 'timeout' });
	});
	it('stops when aborted', async () => {
		const ac = new AbortController();
		ac.abort();
		await expect(waitForPhotoScene('j'.repeat(24), { fetchImpl: vi.fn(), signal: ac.signal, ...clock() })).rejects.toMatchObject({ name: 'AbortError' });
	});
});

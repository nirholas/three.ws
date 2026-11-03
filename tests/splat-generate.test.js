// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { generateSplat, validatePhoto, SplatGenerateError, MAX_PHOTO_BYTES } from '../src/splat-generate.js';

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

// A scripted fetch: each route answers from its queue, in order, and every call
// is recorded so the test can assert the exact sequence the browser makes.
function scriptedFetch(routes) {
	const calls = [];
	const impl = vi.fn(async (url, init = {}) => {
		calls.push({ url, init });
		const key = Object.keys(routes).find((k) => url.startsWith(k));
		if (!key) throw new Error(`unexpected fetch ${url}`);
		const next = routes[key].shift();
		if (next instanceof Error) throw next;
		return next;
	});
	return { impl, calls };
}

const photo = (type = 'image/png', size = 1024) => new File([new Uint8Array(size)], 'chair.png', { type });
const fast = { pollIntervalMs: 0, now: (() => { let t = 0; return () => (t += 1000); })() };

describe('validatePhoto', () => {
	it('accepts PNG, JPG and WebP within the size cap', () => {
		for (const t of ['image/png', 'image/jpeg', 'image/webp']) expect(validatePhoto(photo(t))).toBeNull();
	});
	it('refuses other types, empty files and oversize files', () => {
		expect(validatePhoto(photo('image/gif'))).toMatch(/PNG, JPG or WebP/);
		expect(validatePhoto(photo('image/png', 0))).toMatch(/empty/);
		expect(validatePhoto(photo('image/png', MAX_PHOTO_BYTES + 1))).toMatch(/8 MB/);
	});
});

describe('generateSplat', () => {
	it('uploads a photo, queues the job, polls to done and returns the splat', async () => {
		const { impl, calls } = scriptedFetch({
			'/api/forge-upload': [json(200, { upload_url: 'https://storage.example/put', public_url: 'https://cdn.example/p.png' })],
			'https://storage.example/put': [json(200, {})],
			'/api/forge-splat?job=': [
				json(200, { status: 'queued' }),
				json(200, { status: 'running' }),
				json(200, { status: 'done', splat_url: 'https://cdn.example/s.splat', ply_url: 'https://cdn.example/s.ply', num_gaussians: 65536 }),
			],
			'/api/forge-splat': [json(202, { job_id: 'job_abcdefghijklmnopqrstu', status: 'queued' })],
		});
		const phases = [];
		const out = await generateSplat({ file: photo(), numGaussians: 65536, fetchImpl: impl, onStatus: (s) => phases.push(s.phase), ...fast });
		expect(out).toEqual({ job_id: 'job_abcdefghijklmnopqrstu', splat_url: 'https://cdn.example/s.splat', ply_url: 'https://cdn.example/s.ply', num_gaussians: 65536 });
		const submit = calls.find((c) => c.url === '/api/forge-splat');
		expect(JSON.parse(submit.init.body)).toEqual({ image_url: 'https://cdn.example/p.png', num_gaussians: 65536 });
		expect(calls[0].init.headers['x-forge-client']).toBeTruthy();
		expect(phases).toEqual(['uploading', 'submitting', 'queued', 'queued', 'running']);
	});

	it('skips the upload for a pasted https image URL', async () => {
		const { impl, calls } = scriptedFetch({
			'/api/forge-splat?job=': [json(200, { status: 'done', splat_url: 'https://cdn.example/s.splat' })],
			'/api/forge-splat': [json(202, { job_id: 'job_abcdefghijklmnopqrstu' })],
		});
		await generateSplat({ imageUrl: 'https://img.example/a.jpg', fetchImpl: impl, ...fast });
		expect(calls.some((c) => c.url.includes('forge-upload'))).toBe(false);
	});

	it('refuses a non-https URL before any network call', async () => {
		const { impl } = scriptedFetch({});
		await expect(generateSplat({ imageUrl: 'http://img.example/a.jpg', fetchImpl: impl })).rejects.toMatchObject({ code: 'invalid_input' });
		expect(impl).not.toHaveBeenCalled();
	});

	it('names an unconfigured deployment instead of a generic failure', async () => {
		const { impl } = scriptedFetch({ '/api/forge-splat': [json(503, { error: 'unconfigured' })] });
		await expect(generateSplat({ imageUrl: 'https://img.example/a.jpg', fetchImpl: impl, ...fast })).rejects.toMatchObject({
			code: 'unconfigured',
			message: expect.stringMatching(/not switched on/),
		});
	});

	it('surfaces the worker error when the job fails', async () => {
		const { impl } = scriptedFetch({
			'/api/forge-splat?job=': [json(200, { status: 'failed', error: 'image bytes could not be decoded' })],
			'/api/forge-splat': [json(202, { job_id: 'job_abcdefghijklmnopqrstu' })],
		});
		const err = await generateSplat({ imageUrl: 'https://img.example/a.jpg', fetchImpl: impl, ...fast }).catch((e) => e);
		expect(err).toBeInstanceOf(SplatGenerateError);
		expect(err.message).toMatch(/could not be decoded/);
	});

	it('keeps polling through a dropped poll and gives up at the deadline', async () => {
		const polls = Array.from({ length: 10 }, () => new TypeError('Failed to fetch'));
		const { impl } = scriptedFetch({ '/api/forge-splat?job=': polls, '/api/forge-splat': [json(202, { job_id: 'job_abcdefghijklmnopqrstu' })] });
		await expect(
			generateSplat({ imageUrl: 'https://img.example/a.jpg', fetchImpl: impl, ...fast, deadlineMs: 4500 }),
		).rejects.toMatchObject({ code: 'timeout' });
	});

	it('reports upload storage outages with a way forward', async () => {
		const { impl } = scriptedFetch({ '/api/forge-upload': [json(503, { error: 'storage_unavailable' })] });
		await expect(generateSplat({ file: photo(), fetchImpl: impl, ...fast })).rejects.toMatchObject({
			code: 'upload_unavailable',
			message: expect.stringMatching(/public image URL/),
		});
	});
});

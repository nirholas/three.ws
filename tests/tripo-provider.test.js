// Tripo image_to_model input handling. Tripo's `file` object accepts a public
// http(s) `url` or an uploaded `file_token` — never an inline data: URI. The
// selfie → avatar pipeline hands the adapter base64 data URIs, so the provider
// must upload them via /upload and reference the returned token; passing the
// data URI straight into `file.url` is what produced the 502 "Avatar engine is
// having trouble" error. These tests pin that behaviour.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createTripoProvider } from '../api/_providers/tripo.js';

const KEY = 'tsk_test_key';
const TINY_JPEG_B64 = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).toString('base64');
const DATA_URI = `data:image/jpeg;base64,${TINY_JPEG_B64}`;

function jsonResponse(status, body) {
	return { ok: status >= 200 && status < 300, status, json: async () => body };
}

let fetchMock;
beforeEach(() => {
	fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe('createTripoProvider.imageTo3d — input routing', () => {
	it('uploads a data URI then submits the task with the returned file_token', async () => {
		fetchMock
			.mockResolvedValueOnce(jsonResponse(200, { code: 0, data: { image_token: 'img-123' } })) // /upload
			.mockResolvedValueOnce(jsonResponse(200, { code: 0, data: { task_id: 'task-789' } })); // /task

		const provider = createTripoProvider(KEY);
		const out = await provider.imageTo3d({ imageUrl: DATA_URI, tier: { polycount: 30000, pbr: true } });

		expect(out).toEqual({ kind: 'task', taskId: 'task-789' });
		expect(fetchMock).toHaveBeenCalledTimes(2);

		// First call: multipart upload, bearer only (no JSON content-type so fetch
		// can set the multipart boundary), FormData body.
		const [uploadUrl, uploadOpts] = fetchMock.mock.calls[0];
		expect(uploadUrl).toBe('https://api.tripo3d.ai/v2/openapi/upload');
		expect(uploadOpts.method).toBe('POST');
		expect(uploadOpts.headers).toEqual({ authorization: `Bearer ${KEY}` });
		expect(uploadOpts.body).toBeInstanceOf(FormData);

		// Second call: the task references the uploaded token, never a data: URI.
		const taskBody = JSON.parse(fetchMock.mock.calls[1][1].body);
		expect(taskBody.type).toBe('image_to_model');
		expect(taskBody.file).toEqual({ type: 'jpg', file_token: 'img-123' });
		expect(JSON.stringify(taskBody)).not.toContain('data:image');
	});

	it('accepts an older upload response that returns file_token', async () => {
		fetchMock
			.mockResolvedValueOnce(jsonResponse(200, { code: 0, data: { file_token: 'tok-legacy' } }))
			.mockResolvedValueOnce(jsonResponse(200, { code: 0, data: { task_id: 't2' } }));

		const provider = createTripoProvider(KEY);
		await provider.imageTo3d({ imageUrl: DATA_URI, tier: { polycount: 30000, pbr: false } });

		const taskBody = JSON.parse(fetchMock.mock.calls[1][1].body);
		expect(taskBody.file.file_token).toBe('tok-legacy');
	});

	it('passes a real http(s) URL straight through without an upload call', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(200, { code: 0, data: { task_id: 'task-url' } }));

		const provider = createTripoProvider(KEY);
		const out = await provider.imageTo3d({
			imageUrl: 'https://cdn.example.com/selfie.png',
			tier: { polycount: 30000, pbr: true },
		});

		expect(out.taskId).toBe('task-url');
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const taskBody = JSON.parse(fetchMock.mock.calls[0][1].body);
		expect(taskBody.file).toEqual({ type: 'png', url: 'https://cdn.example.com/selfie.png' });
	});

	it('honors an explicit targetPolycount override over the tier default face_limit', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(200, { code: 0, data: { task_id: 'task-override' } }));

		const provider = createTripoProvider(KEY);
		await provider.textToGeometry({ prompt: 'a brass telescope', tier: { polycount: 30000 }, targetPolycount: 90_000 });

		const taskBody = JSON.parse(fetchMock.mock.calls[0][1].body);
		expect(taskBody.face_limit).toBe(90_000);
	});

	it('falls back to the tier polycount when no override is supplied', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(200, { code: 0, data: { task_id: 'task-default' } }));

		const provider = createTripoProvider(KEY);
		await provider.textToGeometry({ prompt: 'a brass telescope', tier: { polycount: 30000 } });

		const taskBody = JSON.parse(fetchMock.mock.calls[0][1].body);
		expect(taskBody.face_limit).toBe(30000);
	});

	it('honors targetPolycount on the image_to_model path too', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(200, { code: 0, data: { task_id: 'task-img-override' } }));

		const provider = createTripoProvider(KEY);
		await provider.imageTo3d({
			imageUrl: 'https://cdn.example.com/selfie.png',
			tier: { polycount: 30000, pbr: true },
			targetPolycount: 60_000,
		});

		const taskBody = JSON.parse(fetchMock.mock.calls[0][1].body);
		expect(taskBody.face_limit).toBe(60_000);
	});

	it('maps an upload auth failure to invalid_key (401) and never submits a task', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(401, { code: 1001, message: 'bad key' }));

		const provider = createTripoProvider(KEY);
		await expect(
			provider.imageTo3d({ imageUrl: DATA_URI, tier: { polycount: 30000, pbr: true } }),
		).rejects.toMatchObject({ code: 'invalid_key', status: 401 });
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('maps an out-of-credits upload to insufficient_credits (402)', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(402, { code: 2000, message: 'no credits' }));

		const provider = createTripoProvider(KEY);
		await expect(
			provider.imageTo3d({ imageUrl: DATA_URI, tier: { polycount: 30000, pbr: true } }),
		).rejects.toMatchObject({ code: 'insufficient_credits', status: 402 });
	});

	it('treats an upload with no token as a provider_error (502)', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(200, { code: 0, data: {} }));

		const provider = createTripoProvider(KEY);
		await expect(
			provider.imageTo3d({ imageUrl: DATA_URI, tier: { polycount: 30000, pbr: true } }),
		).rejects.toMatchObject({ code: 'provider_error', status: 502 });
	});
});

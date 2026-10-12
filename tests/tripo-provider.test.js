// Tripo v3 provider. v3 unifies every file/task source under a single `input`
// string field (no more `{type, file_token}` wrapper object) and splits the
// old single `/task` endpoint into one dedicated endpoint per capability.
// The selfie -> avatar pipeline hands the adapter base64 data URIs, which have
// no public URL, so the provider must upload them via /files and reference
// the returned file_token as `input`; passing the data URI straight through is
// what produced the 502 "Avatar engine is having trouble" error on v2. These
// tests pin v3's request/response shapes end to end.

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

describe('createTripoProvider: v3 request shapes', () => {
	it('text-to-model hits the dedicated v3 endpoint with prompt/model/face_limit', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(200, { code: 0, data: { task_id: 'task-default' } }));

		const provider = createTripoProvider(KEY);
		const out = await provider.textToGeometry({ prompt: 'a brass telescope', tier: { polycount: 30000 } });

		expect(out).toEqual({ kind: 'task', taskId: 'task-default' });
		const [url, opts] = fetchMock.mock.calls[0];
		expect(url).toBe('https://openapi.tripo3d.com/v3/generation/text-to-model');
		expect(opts.headers.authorization).toBe(`Bearer ${KEY}`);
		const body = JSON.parse(opts.body);
		expect(body).toEqual({
			prompt: 'a brass telescope',
			model: 'v3.1-20260211',
			face_limit: 30000,
			texture: false,
			pbr: false,
		});
	});

	it('honors an explicit targetPolycount override over the tier default face_limit', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(200, { code: 0, data: { task_id: 'task-override' } }));

		const provider = createTripoProvider(KEY);
		await provider.textToGeometry({ prompt: 'a brass telescope', tier: { polycount: 30000 }, targetPolycount: 90_000 });

		const body = JSON.parse(fetchMock.mock.calls[0][1].body);
		expect(body.face_limit).toBe(90_000);
	});

	it('image-to-model uploads a data URI then submits input as the returned file_token', async () => {
		fetchMock
			.mockResolvedValueOnce(jsonResponse(200, { code: 0, data: { file_token: 'file-123' } })) // /files
			.mockResolvedValueOnce(jsonResponse(200, { code: 0, data: { task_id: 'task-789' } })); // /generation/image-to-model

		const provider = createTripoProvider(KEY);
		const out = await provider.imageTo3d({ imageUrl: DATA_URI, tier: { polycount: 30000, pbr: true } });

		expect(out).toEqual({ kind: 'task', taskId: 'task-789' });
		expect(fetchMock).toHaveBeenCalledTimes(2);

		// First call: multipart upload to /files, bearer only (no JSON content-type
		// so fetch can set the multipart boundary), FormData body.
		const [uploadUrl, uploadOpts] = fetchMock.mock.calls[0];
		expect(uploadUrl).toBe('https://openapi.tripo3d.com/v3/files');
		expect(uploadOpts.method).toBe('POST');
		expect(uploadOpts.headers).toEqual({ authorization: `Bearer ${KEY}` });
		expect(uploadOpts.body).toBeInstanceOf(FormData);

		// Second call: input is the plain file_token string, never a data: URI or
		// the old v2 {type, file_token} wrapper.
		const [taskUrl, taskOpts] = fetchMock.mock.calls[1];
		expect(taskUrl).toBe('https://openapi.tripo3d.com/v3/generation/image-to-model');
		const taskBody = JSON.parse(taskOpts.body);
		expect(taskBody.input).toBe('file-123');
		expect(JSON.stringify(taskBody)).not.toContain('data:image');
	});

	it('passes a real http(s) URL straight through as input without an upload call', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(200, { code: 0, data: { task_id: 'task-url' } }));

		const provider = createTripoProvider(KEY);
		const out = await provider.imageTo3d({
			imageUrl: 'https://cdn.example.com/selfie.png',
			tier: { polycount: 30000, pbr: true },
		});

		expect(out.taskId).toBe('task-url');
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const body = JSON.parse(fetchMock.mock.calls[0][1].body);
		expect(body.input).toBe('https://cdn.example.com/selfie.png');
		expect(body.pbr).toBe(true);
	});

	it('honors targetPolycount on the image-to-model path too', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(200, { code: 0, data: { task_id: 'task-img-override' } }));

		const provider = createTripoProvider(KEY);
		await provider.imageTo3d({
			imageUrl: 'https://cdn.example.com/selfie.png',
			tier: { polycount: 30000, pbr: true },
			targetPolycount: 60_000,
		});

		const body = JSON.parse(fetchMock.mock.calls[0][1].body);
		expect(body.face_limit).toBe(60_000);
	});

	it('TRIPO_MODEL_VERSION overrides the default model on both generation paths', async () => {
		const prior = process.env.TRIPO_MODEL_VERSION;
		process.env.TRIPO_MODEL_VERSION = 'v3.0-20250812';
		try {
			fetchMock.mockResolvedValueOnce(jsonResponse(200, { code: 0, data: { task_id: 'task-pinned' } }));
			const provider = createTripoProvider(KEY);
			await provider.textToGeometry({ prompt: 'a cat', tier: { polycount: 10000 } });
			const body = JSON.parse(fetchMock.mock.calls[0][1].body);
			expect(body.model).toBe('v3.0-20250812');
		} finally {
			if (prior === undefined) delete process.env.TRIPO_MODEL_VERSION;
			else process.env.TRIPO_MODEL_VERSION = prior;
		}
	});

	it('status() polls GET /tasks/{id} and maps a successful model task', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(200, {
			code: 0,
			data: {
				task_id: 'task-abc123',
				type: 'text_to_model',
				status: 'success',
				progress: 100,
				output: { model_url: 'https://cdn.tripo3d.ai/output/model_pbr.glb' },
				credits_consumed: 100,
			},
		}));

		const provider = createTripoProvider(KEY);
		const result = await provider.status({ taskId: 'task-abc123' });

		expect(fetchMock.mock.calls[0][0]).toBe('https://openapi.tripo3d.com/v3/tasks/task-abc123');
		expect(result).toEqual({
			status: 'done',
			progress: 100,
			resultGlbUrl: 'https://cdn.tripo3d.ai/output/model_pbr.glb',
			creditsConsumed: 100,
		});
	});

	it('status() surfaces a running task without a result url', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(200, {
			code: 0,
			data: { task_id: 't1', status: 'running', progress: 42 },
		}));
		const provider = createTripoProvider(KEY);
		const result = await provider.status({ taskId: 't1' });
		expect(result).toEqual({ status: 'running', progress: 42 });
	});

	it('status() surfaces a failed task with the error message', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(200, {
			code: 0,
			data: { task_id: 't1', status: 'failed', progress: 0, error_message: 'Generation failed' },
		}));
		const provider = createTripoProvider(KEY);
		const result = await provider.status({ taskId: 't1' });
		expect(result).toEqual({ status: 'failed', progress: 0, error: 'Generation failed' });
	});

	it('status() maps rig-check output {riggable, rig_type} distinctly from a model url', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(200, {
			code: 0,
			data: { task_id: 't2', status: 'success', progress: 100, output: { riggable: true, rig_type: 'biped' }, credits_consumed: 0 },
		}));
		const provider = createTripoProvider(KEY);
		const result = await provider.status({ taskId: 't2' });
		expect(result).toEqual({ status: 'done', progress: 100, riggable: true, rigType: 'biped', creditsConsumed: 0 });
	});

	it('rigCheck() posts to /animations/rig-check with input', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(200, { code: 0, data: { task_id: 'task-rc' } }));
		const provider = createTripoProvider(KEY);
		const out = await provider.rigCheck({ input: 'task_abc123' });
		expect(out).toEqual({ kind: 'task', taskId: 'task-rc' });
		expect(fetchMock.mock.calls[0][0]).toBe('https://openapi.tripo3d.com/v3/animations/rig-check');
		expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ input: 'task_abc123' });
	});

	it('rig() defaults spec to mixamo so output plugs into glb-canonicalize.js', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(200, { code: 0, data: { task_id: 'task-rig' } }));
		const provider = createTripoProvider(KEY);
		await provider.rig({ input: 'task_abc123', rigType: 'biped' });
		const body = JSON.parse(fetchMock.mock.calls[0][1].body);
		expect(fetchMock.mock.calls[0][0]).toBe('https://openapi.tripo3d.com/v3/animations/rig');
		expect(body).toEqual({ input: 'task_abc123', spec: 'mixamo', out_format: 'glb', rig_type: 'biped' });
	});

	it('retarget() sends a single animation by default and an array when given animations', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(200, { code: 0, data: { task_id: 'task-rt' } }));
		const provider = createTripoProvider(KEY);
		await provider.retarget({ input: 'task_rigged', animations: ['preset:idle', 'preset:walk'] });
		const body = JSON.parse(fetchMock.mock.calls[0][1].body);
		expect(fetchMock.mock.calls[0][0]).toBe('https://openapi.tripo3d.com/v3/animations/retarget');
		expect(body).toEqual({ input: 'task_rigged', out_format: 'glb', bake_animation: true, animations: ['preset:idle', 'preset:walk'] });
	});

	it('decimate() builds the game-ready quad request against /mesh/decimate', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(200, { code: 0, data: { task_id: 'task-dec' } }));
		const provider = createTripoProvider(KEY);
		await provider.decimate({ input: 'task_abc123', faceLimit: 15000, quad: true, model: 'v3.0' });
		const body = JSON.parse(fetchMock.mock.calls[0][1].body);
		expect(fetchMock.mock.calls[0][0]).toBe('https://openapi.tripo3d.com/v3/mesh/decimate');
		expect(body).toEqual({ input: 'task_abc123', model: 'v3.0', quad: true, face_limit: 15000 });
	});

	it('segment() posts to /mesh/segment with the default v1 model', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(200, { code: 0, data: { task_id: 'task-seg' } }));
		const provider = createTripoProvider(KEY);
		await provider.segment({ input: 'task_abc123' });
		const body = JSON.parse(fetchMock.mock.calls[0][1].body);
		expect(fetchMock.mock.calls[0][0]).toBe('https://openapi.tripo3d.com/v3/mesh/segment');
		expect(body).toEqual({ input: 'task_abc123', model: 'v1.0-20250506' });
	});

	it('maps a 401 to invalid_key and never submits a task', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(401, { code: 1000, message: 'Invalid API Key', suggestion: 'check your key', request_id: 'req_1' }));
		const provider = createTripoProvider(KEY);
		await expect(
			provider.textToGeometry({ prompt: 'a cat', tier: { polycount: 10000 } }),
		).rejects.toMatchObject({ code: 'invalid_key', status: 401 });
	});

	it('maps a 403 with error code 2010 to insufficient_credits', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(403, { code: 2010, message: 'Insufficient credits', suggestion: 'top up', request_id: 'req_2' }));
		const provider = createTripoProvider(KEY);
		await expect(
			provider.textToGeometry({ prompt: 'a cat', tier: { polycount: 10000 } }),
		).rejects.toMatchObject({ code: 'insufficient_credits', status: 402 });
	});

	it('maps a 403 without the credits error code to invalid_key (permission denied)', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(403, { code: 1001, message: 'Unauthorized', suggestion: 'check headers', request_id: 'req_3' }));
		const provider = createTripoProvider(KEY);
		await expect(
			provider.textToGeometry({ prompt: 'a cat', tier: { polycount: 10000 } }),
		).rejects.toMatchObject({ code: 'invalid_key', status: 401 });
	});

	it('maps a 429 to rate_limited', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(429, { code: 2000, message: 'Rate limit exceeded', suggestion: 'slow down', request_id: 'req_4' }));
		const provider = createTripoProvider(KEY);
		await expect(
			provider.textToGeometry({ prompt: 'a cat', tier: { polycount: 10000 } }),
		).rejects.toMatchObject({ code: 'rate_limited', status: 429 });
	});

	it('treats a 200 with no task_id as a provider_error (502)', async () => {
		fetchMock.mockResolvedValueOnce(jsonResponse(200, { code: 0, data: {} }));
		const provider = createTripoProvider(KEY);
		await expect(
			provider.textToGeometry({ prompt: 'a cat', tier: { polycount: 10000 } }),
		).rejects.toMatchObject({ code: 'provider_error', status: 502 });
	});

	it('throws missing_key when constructed without an API key', () => {
		expect(() => createTripoProvider('')).toThrow(expect.objectContaining({ code: 'missing_key' }));
	});
});

// TRELLIS.2 lab plumbing: the per-stage sampler overrides the lab sends reach
// the worker intact, bad values are refused at the boundary with a field-level
// message, and the worker's per-task telemetry (queue, GPU time, applied
// parameters) survives the poll hop so the lab can show measured numbers.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { normalizeForgeOptions, summarizeForgeOptions } from '../api/_lib/forge-options.js';

const fetchUpstreamMock = vi.fn();
vi.mock('../api/_lib/upstream-fetch.js', () => ({
	fetchUpstream: (...args) => fetchUpstreamMock(...args),
}));

describe('normalizeForgeOptions: sampler', () => {
	it('absent sampler is not an option', () => {
		const o = normalizeForgeOptions({});
		expect(o.sampler).toBeNull();
		expect(o.hasOptions).toBe(false);
	});

	it('accepts per-stage steps and guidance', () => {
		const o = normalizeForgeOptions({
			sampler: { shape_slat: { steps: 24, guidance_strength: 9 }, tex_slat: { steps: 8 } },
		});
		expect(o.errors).toEqual([]);
		expect(o.sampler).toEqual({ shape_slat: { steps: 24, guidance_strength: 9 }, tex_slat: { steps: 8 } });
		expect(o.hasOptions).toBe(true);
		expect(summarizeForgeOptions(o).sampler).toEqual(o.sampler);
	});

	it('rejects an unknown stage, an unknown key and out-of-range values', () => {
		expect(normalizeForgeOptions({ sampler: { decoder: { steps: 4 } } }).errors[0].field).toBe('sampler');
		expect(normalizeForgeOptions({ sampler: { tex_slat: { rescale_t: 3 } } }).errors[0].field).toBe('sampler');
		expect(normalizeForgeOptions({ sampler: { tex_slat: { steps: 0 } } }).errors[0].field).toBe('sampler');
		expect(normalizeForgeOptions({ sampler: { tex_slat: { steps: 51 } } }).errors[0].field).toBe('sampler');
		expect(normalizeForgeOptions({ sampler: { tex_slat: { steps: 2.5 } } }).errors[0].field).toBe('sampler');
		expect(normalizeForgeOptions({ sampler: { tex_slat: { guidance_strength: 16 } } }).errors[0].field).toBe('sampler');
		expect(normalizeForgeOptions({ sampler: 'fast' }).errors[0].field).toBe('sampler');
	});

	it('an empty sampler object is not an option', () => {
		const o = normalizeForgeOptions({ sampler: {} });
		expect(o.errors).toEqual([]);
		expect(o.sampler).toBeNull();
	});
});

const ENV_KEYS = ['GCP_RECONSTRUCTION_KEY', 'MODEL_TRELLIS2_URL'];
const prior = {};
let createRegenProvider;

beforeEach(async () => {
	for (const k of ENV_KEYS) prior[k] = process.env[k];
	process.env.GCP_RECONSTRUCTION_KEY = 'test-bearer-key';
	process.env.MODEL_TRELLIS2_URL = 'https://trellis2.example.test';
	fetchUpstreamMock.mockReset();
	vi.resetModules();
	({ createRegenProvider } = await import('../api/_providers/gcp.js'));
});

afterEach(() => {
	for (const k of ENV_KEYS) {
		if (prior[k] === undefined) delete process.env[k];
		else process.env[k] = prior[k];
	}
});

describe('gcp provider: trellis2 lab fields', () => {
	it('forwards the sampler block to the worker', async () => {
		fetchUpstreamMock.mockResolvedValue({
			status: 202,
			ok: true,
			json: async () => ({ task_id: 'task-1', status: 'queued' }),
		});
		const provider = createRegenProvider();
		const sampler = { sparse_structure: { steps: 20 }, tex_slat: { guidance_strength: 2 } };
		await provider.submit({
			mode: 'trellis2',
			sourceUrl: 'https://cdn.example.test/ref.png',
			params: { images: ['https://cdn.example.test/ref.png'], resolution: 512, seed: 7, sampler },
		});
		const [, init] = fetchUpstreamMock.mock.calls[0];
		const body = JSON.parse(init.body);
		expect(body.sampler).toEqual(sampler);
		expect(body.resolution).toBe(512);
		expect(body.seed).toBe(7);
	});

	it('surfaces worker telemetry on a finished task', async () => {
		fetchUpstreamMock.mockResolvedValue({
			status: 200,
			ok: true,
			json: async () => ({
				status: 'done',
				result_gcs_url: 'https://storage.googleapis.com/b/raw-meshes/trellis2/t.glb',
				resolution: 1024,
				resolution_served: 1024,
				queue_ms: 1500,
				gpu_ms: 60000,
				elapsed_ms: 62000,
				bytes: 12345678,
				params: { seed: 7, texture_size: 2048, decimation_target: 300000, sampler: {} },
			}),
		});
		const provider = createRegenProvider();
		const id = Buffer.from(
			JSON.stringify({
				mode: 'trellis2',
				taskId: 't',
				baseUrl: 'https://trellis2.example.test',
				resultKey: 'result_gcs_url',
			}),
		).toString('base64url');
		const out = await provider.status(id);
		expect(out.status).toBe('done');
		expect(out.workerStats).toEqual({
			queue_ms: 1500,
			gpu_ms: 60000,
			elapsed_ms: 62000,
			bytes: 12345678,
			resolution: 1024,
			resolution_served: 1024,
			params: { seed: 7, texture_size: 2048, decimation_target: 300000, sampler: {} },
		});
	});

	it('reports no telemetry when an older worker sends none', async () => {
		fetchUpstreamMock.mockResolvedValue({
			status: 200,
			ok: true,
			json: async () => ({ status: 'done', result_gcs_url: 'https://storage.googleapis.com/b/x.glb' }),
		});
		const provider = createRegenProvider();
		const id = Buffer.from(
			JSON.stringify({ mode: 'trellis2', taskId: 't', baseUrl: 'https://trellis2.example.test', resultKey: 'result_gcs_url' }),
		).toString('base64url');
		const out = await provider.status(id);
		expect(out.workerStats).toBeUndefined();
	});
});

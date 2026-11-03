// The gcp provider fronts every self-host GPU worker (TRELLIS, Hunyuan3D, ...).
// Its submit and poll calls used to share ONE process-wide circuit breaker named
// 'gcp-forge-worker'. The TRELLIS worker's event loop freezes for 30 to 140 s
// while it post-processes a mesh, so the status polls of running jobs time out;
// five of them opened the shared breaker and every submit to every worker then
// failed in zero milliseconds with provider_unreachable, even though the worker
// answered /health 200. That is how the free text-to-3D lane reported
// "platform TRELLIS lane unavailable (provider_unreachable)" on 2026-11-03.
//
// These tests drive the real fetchUpstream and breaker with a stubbed network.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ENV_KEYS = ['GCP_RECONSTRUCTION_KEY', 'MODEL_TRELLIS_URL', 'GCP_HUNYUAN3D_URL'];
const prior = {};
const TRELLIS = 'https://trellis.example.test';
const HUNYUAN = 'https://hunyuan.example.test';

function jobId(mode, baseUrl, taskId = 't1') {
	return Buffer.from(
		JSON.stringify({ mode, taskId, baseUrl, resultKey: 'result_gcs_url' }),
		'utf8',
	).toString('base64url');
}

function timeoutError() {
	const e = new Error('The operation was aborted due to timeout');
	e.name = 'TimeoutError';
	return e;
}

let provider;
let stalled;
let calls;

beforeEach(async () => {
	for (const k of ENV_KEYS) prior[k] = process.env[k];
	process.env.GCP_RECONSTRUCTION_KEY = 'test-bearer-key';
	process.env.MODEL_TRELLIS_URL = TRELLIS;
	process.env.GCP_HUNYUAN3D_URL = HUNYUAN;
	stalled = new Set();
	calls = [];
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url, init) => {
			const u = String(url);
			calls.push({ url: u, method: init?.method || 'GET' });
			if ([...stalled].some((host) => u.startsWith(host))) throw timeoutError();
			if (u.includes('/tasks/')) {
				return new Response(JSON.stringify({ status: 'running' }), { status: 200 });
			}
			return new Response(JSON.stringify({ task_id: 'task-123', status: 'queued' }), {
				status: 202,
			});
		}),
	);
	vi.resetModules();
	const { createRegenProvider } = await import('../api/_providers/gcp.js');
	provider = createRegenProvider();
});

afterEach(() => {
	vi.unstubAllGlobals();
	for (const k of ENV_KEYS) {
		if (prior[k] === undefined) delete process.env[k];
		else process.env[k] = prior[k];
	}
});

const submitTrellis = () =>
	provider.submit({ mode: 'trellis', sourceUrl: 'https://img.example.test/a.png', params: {} });
const submitHunyuan = () =>
	provider.submit({ mode: 'hunyuan', sourceUrl: 'https://img.example.test/a.png', params: {} });

describe('gcp provider circuit breakers', () => {
	it('keeps accepting submits after status polls to the same worker time out', async () => {
		stalled.add(TRELLIS);
		for (let i = 0; i < 6; i++) {
			const out = await provider.status(jobId('trellis', TRELLIS, `job-${i}`));
			expect(out.status).toBe('running');
		}
		stalled.clear();
		calls.length = 0;

		const out = await submitTrellis();

		expect(out.backend).toBe('gcp');
		expect(calls.some((c) => c.method === 'POST' && c.url.startsWith(TRELLIS))).toBe(true);
	}, 60_000);

	it('keeps accepting submits to one worker after another worker fails repeatedly', async () => {
		stalled.add(TRELLIS);
		for (let i = 0; i < 6; i++) {
			await expect(submitTrellis()).rejects.toMatchObject({ code: 'provider_unreachable' });
		}
		calls.length = 0;

		const out = await submitHunyuan();

		expect(out.backend).toBe('gcp');
		expect(calls.some((c) => c.method === 'POST' && c.url.startsWith(HUNYUAN))).toBe(true);
	}, 120_000);
});

// get_job, the idempotency_key argument and progress notifications on the free
// studio MCP surfaces. Only the network edge is stubbed (the forge client); the
// dispatcher, the tool handlers and the idempotency store run for real, and the
// store is the shared cache (process memory when Redis is not configured).

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/_mcp-studio/gpt-forge-client.js', async (importOriginal) => {
	const real = await importOriginal();
	return {
		...real,
		pollOnce: vi.fn(),
		generate: vi.fn(),
		rig: vi.fn(),
		directPrompt: vi.fn(async () => null),
	};
});

import { pollOnce, generate } from '../api/_mcp-studio/gpt-forge-client.js';
import { dispatch } from '../api/_mcp-studio/dispatch.js';
import { jobProgress } from '../api/_mcp-studio/tools.js';
import { progressTokenOf } from '../api/_mcp-studio/handler.js';

const req = { headers: { host: 'three.ws', 'x-forwarded-proto': 'https' } };

let seq = 0;
const uniq = (label) => `${label}-${Date.now()}-${++seq}`;

async function call(name, args, auth = { caller: 'ip:203.0.113.7' }, extra = {}, params = {}) {
	const res = await dispatch(
		{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args, ...params } },
		auth,
		req,
		extra,
	);
	return res.result;
}

beforeEach(() => {
	pollOnce.mockReset();
	generate.mockReset();
});

describe('get_job', () => {
	it('reports a running job with progress, eta and when to check again', async () => {
		pollOnce.mockResolvedValueOnce({ status: 'running', elapsed_seconds: 30, eta_remaining_seconds: 90, prompt: 'a teapot' });
		const r = await call('get_job', { job_id: 'job-abc12345' });
		expect(r.isError).toBeFalsy();
		expect(r.structuredContent).toMatchObject({
			job_id: 'job-abc12345',
			status: 'running',
			progress: 0.25,
			eta_seconds: 90,
			elapsed_seconds: 30,
			next_check_seconds: 45,
		});
	});

	it('reports a queued job and never claims progress it does not know', async () => {
		pollOnce.mockResolvedValueOnce({ status: 'queued' });
		const r = await call('get_job', { job_id: 'job-abc12345' });
		expect(r.structuredContent).toMatchObject({ status: 'queued', progress: null, eta_seconds: null });
		expect(r.structuredContent.next_check_seconds).toBe(15);
	});

	it('returns the asset links when the job is done', async () => {
		pollOnce.mockResolvedValueOnce({ status: 'done', glb_url: 'https://cdn.example.com/models/teapot.glb', prompt: 'a teapot' });
		const r = await call('get_job', { job_id: 'job-abc12345' });
		expect(r.isError).toBeFalsy();
		expect(r.structuredContent).toMatchObject({ job_id: 'job-abc12345', status: 'done', progress: 1, eta_seconds: 0 });
		expect(r.structuredContent.glb_url).toContain('teapot.glb');
		expect(r.structuredContent.viewer_url).toContain('/viewer?src=');
		expect(r.structuredContent.poster_png_url).toContain('/api/render/glb');
	});

	it('explains a failure and what to do about it', async () => {
		pollOnce.mockResolvedValueOnce({ status: 'failed', error: 'generation hit a snag', retry_backends: ['trellis'] });
		const r = await call('get_job', { job_id: 'job-abc12345' });
		expect(r.isError).toBe(true);
		expect(r.structuredContent).toMatchObject({ status: 'failed', retryable: true, progress: null });
		expect(r.structuredContent.error).toContain('generation hit a snag');
		expect(r.structuredContent.remedy).toContain('trellis');
		expect(r.content[0].text).toContain(r.structuredContent.remedy);
	});

	it('says an unrecognized id is final and a transient check failure is not', async () => {
		pollOnce.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'unknown_job' }));
		const gone = await call('get_job', { job_id: 'job-abc12345' });
		expect(gone.structuredContent).toMatchObject({ status: 'not_found', retryable: false });

		pollOnce.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'busy', retryAfter: 20 }));
		const busy = await call('get_job', { job_id: 'job-abc12345' });
		expect(busy.structuredContent).toMatchObject({ status: 'unknown', retryable: true });
		expect(busy.structuredContent.remedy).toContain('20s');
	});
});

describe('jobProgress', () => {
	it('is elapsed over elapsed plus remaining, capped below done', () => {
		expect(jobProgress({ status: 'running', elapsedSeconds: 60, etaRemainingSeconds: 60 })).toBe(0.5);
		expect(jobProgress({ status: 'running', elapsedSeconds: 500, etaRemainingSeconds: 1 })).toBe(0.95);
		expect(jobProgress({ status: 'done' })).toBe(1);
		expect(jobProgress({ status: 'running' })).toBeNull();
	});
});

describe('idempotency_key', () => {
	const pending = (jobId) => ({ _timedOut: true, job_id: jobId, status: 'running' });

	it('returns the original job for the same caller and key without generating twice', async () => {
		const key = uniq('retry');
		generate.mockResolvedValue(pending('job-first-0001'));
		pollOnce.mockResolvedValue({ status: 'running', elapsed_seconds: 10, eta_remaining_seconds: 50 });

		const first = await call('forge_free', { prompt: 'a red teapot', idempotency_key: key });
		const second = await call('forge_free', { prompt: 'a red teapot', idempotency_key: key });

		expect(generate).toHaveBeenCalledTimes(1);
		expect(first.structuredContent.jobId).toBe('job-first-0001');
		expect(second.structuredContent.jobId).toBe('job-first-0001');
		expect(first.structuredContent.idempotency).toEqual({ key, replayed: false });
		expect(second.structuredContent.idempotency).toEqual({ key, replayed: true });
		expect(second.content[0].text).toContain('Replayed');
	});

	it('gives a different caller with the same key its own job', async () => {
		const key = uniq('shared');
		generate.mockResolvedValueOnce(pending('job-alice-0001')).mockResolvedValueOnce(pending('job-bob-00001'));

		const alice = await call('forge_free', { prompt: 'a red teapot', idempotency_key: key }, { caller: 'inst:alice' });
		const bob = await call('forge_free', { prompt: 'a red teapot', idempotency_key: key }, { caller: 'inst:bob' });

		expect(generate).toHaveBeenCalledTimes(2);
		expect(alice.structuredContent.jobId).toBe('job-alice-0001');
		expect(bob.structuredContent.jobId).toBe('job-bob-00001');
	});

	it('refuses a key reused for a different request', async () => {
		const key = uniq('reuse');
		generate.mockResolvedValue(pending('job-first-0002'));
		await call('forge_free', { prompt: 'a red teapot', idempotency_key: key });
		const other = await call('forge_free', { prompt: 'a blue chair', idempotency_key: key });
		expect(other.isError).toBe(true);
		expect(other.structuredContent.code).toBe('idempotency_key_reused');
		expect(generate).toHaveBeenCalledTimes(1);
	});

	it('does not remember a failed attempt, so the same key can retry', async () => {
		const key = uniq('fail');
		generate.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'busy' }));
		const failed = await call('forge_free', { prompt: 'a red teapot', idempotency_key: key });
		expect(failed.isError).toBe(true);

		generate.mockResolvedValueOnce(pending('job-retry-0001'));
		const retried = await call('forge_free', { prompt: 'a red teapot', idempotency_key: key });
		expect(retried.structuredContent.jobId).toBe('job-retry-0001');
		expect(retried.structuredContent.idempotency.replayed).toBe(false);
	});

	it('starts a fresh job when the remembered one has since failed', async () => {
		const key = uniq('stale');
		generate.mockResolvedValueOnce(pending('job-doomed-001'));
		pollOnce.mockResolvedValueOnce({ status: 'failed', error: 'generation hit a snag' });
		await call('forge_free', { prompt: 'a red teapot', idempotency_key: key });

		generate.mockResolvedValueOnce(pending('job-second-001'));
		const again = await call('forge_free', { prompt: 'a red teapot', idempotency_key: key });
		expect(generate).toHaveBeenCalledTimes(2);
		expect(again.structuredContent.jobId).toBe('job-second-001');
	});

	it('replays a finished job as the finished model', async () => {
		const key = uniq('done');
		generate.mockResolvedValueOnce(pending('job-late-00001'));
		pollOnce.mockResolvedValue({ status: 'done', glb_url: 'https://cdn.example.com/models/late.glb', prompt: 'a red teapot' });
		await call('forge_free', { prompt: 'a red teapot', idempotency_key: key });
		const second = await call('forge_free', { prompt: 'a red teapot', idempotency_key: key });
		expect(generate).toHaveBeenCalledTimes(1);
		expect(second.structuredContent.glbUrl).toContain('late.glb');
		expect(second.structuredContent.idempotency.replayed).toBe(true);
	});

	it('runs normally without a key', async () => {
		generate.mockResolvedValue(pending('job-nokey-0001'));
		await call('forge_free', { prompt: 'a red teapot' });
		await call('forge_free', { prompt: 'a red teapot' });
		expect(generate).toHaveBeenCalledTimes(2);
	});
});

describe('progress notifications', () => {
	it('sends a rising notifications/progress for the client progressToken', async () => {
		const sent = [];
		generate.mockImplementation(async (_base, _args, opts) => {
			opts.onPoll({ status: 'running', elapsed_seconds: 10, eta_remaining_seconds: 90 });
			opts.onPoll({ status: 'running', elapsed_seconds: 10, eta_remaining_seconds: 90 });
			opts.onPoll({ status: 'running', elapsed_seconds: 50, eta_remaining_seconds: 50 });
			return { _timedOut: true, job_id: 'job-prog-00001' };
		});
		await call(
			'forge_free',
			{ prompt: 'a red teapot' },
			{ caller: 'ip:203.0.113.7' },
			{ notify: (m) => sent.push(m) },
			{ _meta: { progressToken: 'tok-1' } },
		);
		expect(sent.map((m) => m.method)).toEqual(['notifications/progress', 'notifications/progress']);
		expect(sent.map((m) => m.params.progress)).toEqual([10, 50]);
		expect(sent[0].params).toMatchObject({ progressToken: 'tok-1', total: 100 });
	});

	it('sends nothing without a progressToken or a stream', async () => {
		const sent = [];
		generate.mockImplementation(async (_b, _a, opts) => {
			expect(opts.onPoll).toBeUndefined();
			return { _timedOut: true, job_id: 'job-prog-00002' };
		});
		await call('forge_free', { prompt: 'a red teapot' }, { caller: 'ip:1' }, { notify: (m) => sent.push(m) });
		expect(sent).toEqual([]);
	});

	it('reads a usable progressToken from a tools/call only', () => {
		expect(progressTokenOf({ method: 'tools/call', params: { _meta: { progressToken: 7 } } })).toBe(7);
		expect(progressTokenOf({ method: 'tools/call', params: { _meta: { progressToken: 'a' } } })).toBe('a');
		expect(progressTokenOf({ method: 'tools/call', params: { _meta: { progressToken: {} } } })).toBeNull();
		expect(progressTokenOf({ method: 'tools/list', params: { _meta: { progressToken: 1 } } })).toBeNull();
	});
});

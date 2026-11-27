// The hosted TRELLIS lane (stats id trellis_nvcf, api/_providers/nvidia.js) at
// the network boundary, against the responses NVIDIA documents for NVCF:
//
//   POST .../v1/genai/microsoft/trellis        -> 202 + NVCF-REQID, or 200 + body
//   GET  .../v2/nvcf/pexec/status/{requestId}  -> 200 fulfilled (result in the
//        body), 202 pending, 302 large result (fetch the Location URL), 402
//        cloud credits expired, 403 missing scope
//        (https://docs.api.nvidia.com/cloud-functions/reference/getfunctioninvocationresult)
//
// What is pinned here, and why it is not covered by providers-nvidia.test.js:
//   - a finished job is only "done" when the bytes are a real, non-empty glTF
//     model. A truncated file, an HTML error page or an empty scene used to be
//     persisted and sold as a finished model.
//   - the documented 302 large-result handoff is followed through the SSRF guard
//     (and the key is never sent to the download host).
//   - a 402 poll (credits expired) is terminal, not "running" for 45 minutes.
//   - the full asynchronous flow: 202, poll, complete, download, validate, store.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { zipSync } from 'fflate';
import { Document, NodeIO } from '@gltf-transform/core';
import { createNvidiaProvider } from '../../api/_providers/nvidia.js';
import { cubeGlb } from '../_helpers/print-glb.js';

const TRELLIS_INVOKE = 'https://ai.api.nvidia.com/v1/genai/microsoft/trellis';
const NVCF_STATUS = 'https://api.nvcf.nvidia.com/v2/nvcf/pexec/status';
// A public IP literal: the SSRF guard classifies it without a DNS lookup.
const DOWNLOAD_HOST = 'https://93.184.216.34';

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_KEY = process.env.NVIDIA_API_KEY;

const putObjectMock = vi.fn(async () => ({}));
vi.mock('../../api/_lib/r2.js', () => ({
	putObject: (...args) => putObjectMock(...args),
	cdnUrl: (key) => `https://three.ws/cdn/${key}`,
}));

let glb;
beforeEach(async () => {
	process.env.NVIDIA_API_KEY = 'nvapi-test-key';
	putObjectMock.mockClear();
	glb = Buffer.from(await cubeGlb());
});
afterEach(() => {
	globalThis.fetch = ORIGINAL_FETCH;
	if (ORIGINAL_KEY === undefined) delete process.env.NVIDIA_API_KEY;
	else process.env.NVIDIA_API_KEY = ORIGINAL_KEY;
	vi.restoreAllMocks();
});

const json = (body, status = 200, headers = {}) =>
	new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const artifacts = (buf) => json({ artifacts: [{ base64: buf.toString('base64'), finishReason: 'SUCCESS' }] });

describe('hosted TRELLIS: a result is stored only when it is a real model', () => {
	it('refuses an HTML error page that arrived with a 200 and stores nothing', async () => {
		const page = Buffer.from('<html><body>upstream error</body></html>');
		globalThis.fetch = vi.fn(async () => artifacts(page));
		const res = await createNvidiaProvider().status({ taskId: 'req-1' });
		expect(res).toMatchObject({ status: 'failed', code: 'nvcf_bad_artifact' });
		expect(res.error).toMatch(/not a valid 3D model/i);
		expect(putObjectMock).not.toHaveBeenCalled();
	});

	it('refuses a GLB cut short in transit (declared length longer than the bytes)', async () => {
		globalThis.fetch = vi.fn(async () => artifacts(glb.subarray(0, Math.floor(glb.length / 2))));
		const res = await createNvidiaProvider().status({ taskId: 'req-1' });
		expect(res).toMatchObject({ status: 'failed', code: 'nvcf_bad_artifact' });
		expect(putObjectMock).not.toHaveBeenCalled();
	});

	it('refuses a well-formed GLB with no mesh in it (an empty scene is not a model)', async () => {
		const doc = new Document();
		doc.createScene().addChild(doc.createNode('empty'));
		const empty = Buffer.from(await new NodeIO().writeBinary(doc));
		globalThis.fetch = vi.fn(async () => artifacts(empty));
		const res = await createNvidiaProvider().status({ taskId: 'req-1' });
		expect(res).toMatchObject({ status: 'failed', code: 'nvcf_bad_artifact' });
		expect(putObjectMock).not.toHaveBeenCalled();
	});

	it('refuses a synchronous 200 that carries garbage instead of storing it', async () => {
		globalThis.fetch = vi.fn(async () => artifacts(Buffer.from('not a model at all')));
		await expect(createNvidiaProvider().textTo3d({ prompt: 'a cube' })).rejects.toMatchObject({
			code: 'provider_error',
			status: 502,
		});
		expect(putObjectMock).not.toHaveBeenCalled();
	});

	it('stores a real model and records the exact bytes', async () => {
		globalThis.fetch = vi.fn(async () => artifacts(glb));
		const res = await createNvidiaProvider().status({ taskId: 'req-1' });
		expect(res.status).toBe('done');
		expect(putObjectMock.mock.calls[0][0].body.equals(glb)).toBe(true);
	});
});

describe('hosted TRELLIS: the whole asynchronous flow', () => {
	it('202 with a request id, pending polls, completion, validation, durable URL', async () => {
		const seen = [];
		let polls = 0;
		globalThis.fetch = vi.fn(async (url, init) => {
			seen.push({ url: String(url), method: init?.method || 'GET' });
			if (String(url) === TRELLIS_INVOKE) return new Response(null, { status: 202, headers: { 'nvcf-reqid': 'req-async-1' } });
			expect(String(url)).toBe(`${NVCF_STATUS}/req-async-1`);
			polls++;
			return polls < 3 ? new Response(null, { status: 202, headers: { 'nvcf-status': 'in-progress' } }) : artifacts(glb);
		});
		const provider = createNvidiaProvider();
		const job = await provider.textTo3d({ prompt: 'a small cube', tier: 'draft', seed: 7 });
		expect(job).toEqual({ kind: 'text-to-3d', taskId: 'req-async-1' });

		expect(await provider.status({ taskId: job.taskId })).toEqual({ status: 'running' });
		expect(await provider.status({ taskId: job.taskId })).toEqual({ status: 'running' });
		const done = await provider.status({ taskId: job.taskId });
		expect(done.status).toBe('done');
		expect(done.resultGlbUrl).toBe(`https://three.ws/cdn/${putObjectMock.mock.calls[0][0].key}`);
		expect(putObjectMock).toHaveBeenCalledTimes(1);
		expect(putObjectMock.mock.calls[0][0].body.equals(glb)).toBe(true);
		expect(seen.map((s) => s.method)).toEqual(['POST', 'GET', 'GET', 'GET']);
	});

	it('follows the documented 302 large-result handoff: Location is fetched, the key is not sent to it', async () => {
		const requests = [];
		globalThis.fetch = vi.fn(async (url, init) => {
			requests.push({ url: String(url), init });
			if (String(url).startsWith(NVCF_STATUS)) {
				return new Response(null, { status: 302, headers: { location: `${DOWNLOAD_HOST}/results/req-big.bin?sig=abc`, 'nvcf-status': 'fulfilled' } });
			}
			return new Response(glb, { status: 200, headers: { 'content-type': 'application/octet-stream' } });
		});
		const res = await createNvidiaProvider().status({ taskId: 'req-big' });
		expect(res.status).toBe('done');
		expect(putObjectMock.mock.calls[0][0].body.equals(glb)).toBe(true);

		const statusCall = requests.find((r) => r.url.startsWith(NVCF_STATUS));
		expect(statusCall.init.redirect).toBe('manual');
		const download = requests.find((r) => r.url.startsWith(DOWNLOAD_HOST));
		expect(download).toBeTruthy();
		expect(JSON.stringify(download.init?.headers || {}).toLowerCase()).not.toContain('authorization');
		expect(JSON.stringify(download.init?.headers || {}).toLowerCase()).not.toContain('nvapi');
	});

	it('unpacks a large result delivered as a zip holding the GLB', async () => {
		const zip = Buffer.from(zipSync({ 'output/model.glb': new Uint8Array(glb) }));
		globalThis.fetch = vi.fn(async (url) =>
			String(url).startsWith(NVCF_STATUS)
				? new Response(null, { status: 302, headers: { location: `${DOWNLOAD_HOST}/results/z.zip` } })
				: new Response(zip, { status: 200, headers: { 'content-type': 'application/zip' } }),
		);
		const res = await createNvidiaProvider().status({ taskId: 'req-zip' });
		expect(res.status).toBe('done');
		expect(putObjectMock.mock.calls[0][0].body.equals(glb)).toBe(true);
	});

	it('unpacks a large result delivered as a zip holding the artifacts JSON', async () => {
		const body = JSON.stringify({ artifacts: [{ base64: glb.toString('base64') }] });
		const zip = Buffer.from(zipSync({ 'response.json': new TextEncoder().encode(body) }));
		globalThis.fetch = vi.fn(async (url) =>
			String(url).startsWith(NVCF_STATUS)
				? new Response(null, { status: 302, headers: { location: `${DOWNLOAD_HOST}/results/z2.zip` } })
				: new Response(zip, { status: 200, headers: { 'content-type': 'application/zip' } }),
		);
		const res = await createNvidiaProvider().status({ taskId: 'req-zip2' });
		expect(res.status).toBe('done');
		expect(putObjectMock.mock.calls[0][0].body.equals(glb)).toBe(true);
	});

	it('fails honestly when the large-result download itself fails', async () => {
		globalThis.fetch = vi.fn(async (url) =>
			String(url).startsWith(NVCF_STATUS)
				? new Response(null, { status: 302, headers: { location: `${DOWNLOAD_HOST}/results/gone` } })
				: new Response('expired', { status: 403 }),
		);
		const res = await createNvidiaProvider().status({ taskId: 'req-gone' });
		expect(res.status).toBe('failed');
		expect(res.code).toBe('nvcf_bad_artifact');
		expect(putObjectMock).not.toHaveBeenCalled();
	});
});

describe('hosted TRELLIS: a URL the upstream names is never fetched blindly', () => {
	it('does not fetch a link-local artifact url from a 200 body', async () => {
		const calls = [];
		globalThis.fetch = vi.fn(async (url) => {
			calls.push(String(url));
			return json({ artifacts: [{ url: 'http://169.254.169.254/latest/meta-data/' }] });
		});
		const res = await createNvidiaProvider().status({ taskId: 'req-ssrf' });
		expect(res.status).toBe('failed');
		expect(calls.filter((u) => u.includes('169.254'))).toEqual([]);
		expect(putObjectMock).not.toHaveBeenCalled();
	});

	it('does not follow a 302 whose Location is a private address', async () => {
		const calls = [];
		globalThis.fetch = vi.fn(async (url) => {
			calls.push(String(url));
			return new Response(null, { status: 302, headers: { location: 'https://10.0.0.5/results/x' } });
		});
		const res = await createNvidiaProvider().status({ taskId: 'req-ssrf2' });
		expect(res.status).toBe('failed');
		expect(calls.filter((u) => u.includes('10.0.0.5'))).toEqual([]);
	});

	it('stops a runaway artifact download at a size ceiling instead of buffering it', async () => {
		globalThis.fetch = vi.fn(async (url) =>
			String(url).startsWith(NVCF_STATUS)
				? json({ artifacts: [{ url: `${DOWNLOAD_HOST}/huge.glb` }] })
				: new Response('x', { status: 200, headers: { 'content-length': String(900 * 1024 * 1024) } }),
		);
		const res = await createNvidiaProvider().status({ taskId: 'req-huge' });
		expect(res.status).toBe('failed');
		expect(putObjectMock).not.toHaveBeenCalled();
	});
});

describe('hosted TRELLIS: poll statuses that can never recover are terminal', () => {
	// NVIDIA documents 402 on the status route: cloud credits for the public
	// function expired. Polling that as "running" held every job to the reaper.
	it('fails a 402 poll as out of credits instead of polling it for 45 minutes', async () => {
		globalThis.fetch = vi.fn(async () => new Response('{"detail":"credits expired"}', { status: 402 }));
		const res = await createNvidiaProvider().status({ taskId: 'req-402' });
		expect(res).toMatchObject({ status: 'failed', code: 'insufficient_credits', providerStatus: 402 });
	});

	it.each([400, 422])('fails a %i poll (the request was rejected, it will not change)', async (status) => {
		globalThis.fetch = vi.fn(async () => new Response('{"detail":"bad request"}', { status }));
		const res = await createNvidiaProvider().status({ taskId: 'req-4xx' });
		expect(res.status).toBe('failed');
	});

	it('still keeps a job alive through a 429 and reports the stated wait', async () => {
		globalThis.fetch = vi.fn(async () => new Response('slow down', { status: 429, headers: { 'retry-after': '45' } }));
		const res = await createNvidiaProvider().status({ taskId: 'req-429' });
		expect(res).toMatchObject({ status: 'running', retryAfter: 45 });
	});

	it('still keeps a job alive through a 503 mid-flight', async () => {
		globalThis.fetch = vi.fn(async () => new Response('busy', { status: 503 }));
		expect((await createNvidiaProvider().status({ taskId: 'req-503' })).status).toBe('running');
	});
});

describe('hosted TRELLIS: a throttle states its own wait', () => {
	it('carries Retry-After given in seconds', async () => {
		globalThis.fetch = vi.fn(async () => new Response('limit', { status: 429, headers: { 'retry-after': '300' } }));
		await expect(createNvidiaProvider().textTo3d({ prompt: 'a cube' })).rejects.toMatchObject({
			code: 'rate_limited',
			providerStatus: 429,
			retryAfter: 300,
		});
	});

	it('carries Retry-After given as an HTTP date, converted to seconds from now', async () => {
		const date = new Date(Date.now() + 180_000).toUTCString();
		globalThis.fetch = vi.fn(async () => new Response('limit', { status: 429, headers: { 'retry-after': date } }));
		const err = await createNvidiaProvider().textTo3d({ prompt: 'a cube' }).catch((e) => e);
		expect(err.code).toBe('rate_limited');
		expect(err.retryAfter).toBeGreaterThan(170);
		expect(err.retryAfter).toBeLessThanOrEqual(180);
	});
});

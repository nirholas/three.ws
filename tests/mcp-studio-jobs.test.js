// Jobs an agent can trust across retries (api/_mcp-studio/jobs.js, get_job in
// api/_mcp-studio/job-tools.js).
//
// A scheduled agent retries a generation that timed out. With an
// idempotency_key the retry must get the first call's job, never a second
// generation, and a different caller using the same key must get its own job.
// get_job must report each job state in one vocabulary (status, progress,
// eta_seconds, links when done, reason and remedy when failed), and a client
// that sent a progressToken must get notifications/progress over SSE.
//
// The real studio client, ticket and idempotency code run here over the real
// in-memory cache (no Redis in the test env). Only the HTTP boundary to
// /api/gpt-forge is replaced, answering with the frame fixtures below, which
// are captured from that endpoint's own response shapes.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';

vi.mock('../api/_mcp-studio/gpt-forge-client.js', async (importOriginal) => {
	const real = await importOriginal();
	return { ...real, directPrompt: vi.fn(async () => null) };
});

const FIXTURE_GLB = 'https://three.ws/cdn/forge/fixture-teapot.glb';
const FIXTURE_FRAMES = {
	running: { status: 'running', backend: 'trellis', tier: 'standard', elapsed_seconds: 30, eta_seconds: 120, eta_remaining_seconds: 90 },
	queued: { status: 'queued', backend: 'hunyuan3d', tier: 'high', elapsed_seconds: 12, eta_seconds: 240, eta_remaining_seconds: 228, cold_start: true, cold_start_seconds: 90 },
	done: { status: 'done', glb_url: FIXTURE_GLB, prompt: 'a red ceramic teapot', backend: 'trellis' },
	failed: { status: 'failed', error: 'The mesh came back empty for this prompt.', retryable: true, retry_backends: ['hunyuan3d'] },
};

let dispatch, studioHandler, forge;

// The /api/gpt-forge double: every submit gets a fresh job token, and a poll
// answers whatever frame the test set for that job.
function installForge() {
	const state = { submits: [], polls: [], frames: new Map(), next: 0, submitStatus: 200, submitGate: null };
	const fetchStub = vi.fn(async (url, init = {}) => {
		const u = new URL(String(url));
		if (!u.pathname.endsWith('/api/gpt-forge')) throw new Error(`unexpected fetch ${url}`);
		if ((init.method || 'GET') === 'POST') {
			const ticket = init.headers?.['x-forge-ticket'] || null;
			state.submits.push({ body: JSON.parse(init.body), ticket, rig: u.searchParams.get('action') === 'rig' });
			// Honor the abort signal as real fetch does, so a submit window can close.
			if (state.submitGate) {
				await Promise.race([
					state.submitGate,
					new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(init.signal.reason))),
				]);
			}
			if (state.submitStatus !== 200) {
				return new Response(JSON.stringify({ error: 'rate_limited', message: 'The 3D generator is busy right now.', retry_after: 20 }), {
					status: state.submitStatus,
				});
			}
			const jobId = `jobtok-${++state.next}`;
			state.frames.set(jobId, state.frames.get('*') || FIXTURE_FRAMES.running);
			return Response.json({ job_id: jobId, status: 'queued', eta_seconds: 120 });
		}
		const job = u.searchParams.get('job');
		state.polls.push(job);
		if (job.startsWith('t1.')) return Response.json({ job_id: job, status: 'queued', stage: 'submit', elapsed_seconds: 1 });
		const frame = state.frames.get(job);
		if (frame === 404) return new Response(JSON.stringify({ error: 'unknown_job' }), { status: 404 });
		if (frame === 429) return new Response(JSON.stringify({ error: 'rate_limited', retry_after: 7 }), { status: 429 });
		if (!frame) return new Response(JSON.stringify({ error: 'invalid_job' }), { status: 400 });
		return Response.json({ job_id: job, ...frame });
	});
	vi.stubGlobal('fetch', fetchStub);
	return state;
}

const req = { headers: { host: 'three.ws', 'x-forwarded-proto': 'https' } };
let rpcId = 0;

async function call(name, args, { caller = 'inst:caller-a', surface = 'grok' } = {}) {
	const r = await dispatch(
		{ jsonrpc: '2.0', id: ++rpcId, method: 'tools/call', params: { name, arguments: args } },
		{ userId: null, rateKey: '203.0.113.9', scope: '' },
		req,
		{ surface, caller },
	);
	return r.result;
}

beforeAll(async () => {
	process.env.STUDIO_API_BASE = 'https://three.ws';
	({ dispatch } = await import('../api/_mcp-studio/dispatch.js'));
	({ studioHandler } = await import('../api/_mcp-studio/handler.js'));
});

beforeEach(() => {
	// Return a pending job at once instead of waiting out a real render.
	process.env.STUDIO_FORGE_TIMEOUT_MS = '1';
	process.env.STUDIO_RIG_TIMEOUT_MS = '1';
	forge = installForge();
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('idempotency_key on generation tools', () => {
	it('every generation tool accepts it, and only those', async () => {
		const { toolCatalogFor } = await import('../api/_mcp-studio/dispatch.js');
		const keyed = toolCatalogFor('full')
			.filter((t) => t.inputSchema?.properties?.idempotency_key)
			.map((t) => t.name)
			.sort();
		expect(keyed).toEqual(['forge_avatar', 'forge_free', 'mesh_forge', 'refine_model', 'rig_mesh', 'text_to_avatar']);
	});

	it('a duplicate call from the same caller returns the same job and submits once', async () => {
		const args = { prompt: 'a red ceramic teapot', idempotency_key: 'grok-task-42' };
		const first = await call('forge_free', args);
		const second = await call('forge_free', args);

		expect(forge.submits).toHaveLength(1);
		expect(first.structuredContent.status).toBe('pending');
		expect(first.structuredContent.job_id).toBe('jobtok-1');
		expect(first.structuredContent.idempotent_replay).toBe(false);
		expect(second.structuredContent.job_id).toBe('jobtok-1');
		expect(second.structuredContent.idempotent_replay).toBe(true);
		expect(second.content[0].text).toMatch(/nothing new was started/);
	});

	it('a different caller with the same key gets its own job', async () => {
		const args = { prompt: 'a red ceramic teapot', idempotency_key: 'grok-task-43' };
		const a = await call('forge_free', args, { caller: 'inst:caller-a' });
		const b = await call('forge_free', args, { caller: 'inst:caller-b' });

		expect(forge.submits).toHaveLength(2);
		expect(a.structuredContent.job_id).toBe('jobtok-1');
		expect(b.structuredContent.job_id).toBe('jobtok-2');
		expect(b.structuredContent.idempotent_replay).toBe(false);
	});

	it('without a key every call is a new generation', async () => {
		await call('forge_free', { prompt: 'a red ceramic teapot' });
		await call('forge_free', { prompt: 'a red ceramic teapot' });
		expect(forge.submits).toHaveLength(2);
	});

	it('refuses a key reused for different arguments, and submits nothing', async () => {
		await call('forge_free', { prompt: 'a red ceramic teapot', idempotency_key: 'k-reuse' });
		const other = await call('forge_free', { prompt: 'a blue glass vase', idempotency_key: 'k-reuse' });
		expect(forge.submits).toHaveLength(1);
		expect(other.isError).toBe(true);
		expect(other.structuredContent.reason).toBe('idempotency_key_reused');
	});

	it('gives the key back when no job was accepted, so the retry runs', async () => {
		forge.submitStatus = 429;
		const busy = await call('forge_free', { prompt: 'a red ceramic teapot', idempotency_key: 'k-busy' });
		expect(busy.isError).toBe(true);
		forge.submitStatus = 200;
		const retry = await call('forge_free', { prompt: 'a red ceramic teapot', idempotency_key: 'k-busy' });
		expect(retry.structuredContent.job_id).toBe('jobtok-1');
		expect(retry.structuredContent.idempotent_replay).toBe(false);
		expect(forge.submits).toHaveLength(2);
	});

	it('a finished job replays from the record with no further calls upstream', async () => {
		process.env.STUDIO_FORGE_TIMEOUT_MS = '60000';
		process.env.STUDIO_POLL_MS = '1';
		forge.frames.set('*', FIXTURE_FRAMES.done);
		const first = await call('forge_free', { prompt: 'a red ceramic teapot', idempotency_key: 'k-done' });
		const callsAfterFirst = forge.submits.length + forge.polls.length;
		const second = await call('forge_free', { prompt: 'a red ceramic teapot', idempotency_key: 'k-done' });

		expect(first.structuredContent).toMatchObject({ status: 'done', job_id: 'jobtok-1', glbUrl: FIXTURE_GLB });
		expect(second.structuredContent).toMatchObject({ status: 'done', job_id: 'jobtok-1', glbUrl: FIXTURE_GLB, idempotent_replay: true });
		expect(forge.submits.length + forge.polls.length).toBe(callsAfterFirst);
		delete process.env.STUDIO_POLL_MS;
	});

	it('a repeat that arrives while the first submit is in flight follows its ticket', async () => {
		let open;
		forge.submitGate = new Promise((r) => (open = r));
		const args = { prompt: 'a red ceramic teapot', idempotency_key: 'k-race' };
		const firstCall = call('forge_free', args);
		await vi.waitFor(() => expect(forge.submits).toHaveLength(1));

		const repeat = await call('forge_free', args);
		const handle = `t1.${forge.submits[0].ticket}`;
		expect(repeat.structuredContent.job_id).toBe(handle);
		expect(repeat.structuredContent.phase).toBe('submitting');

		open();
		const first = await firstCall;
		expect(first.structuredContent.job_id).toBe('jobtok-1');
		expect(forge.submits).toHaveLength(1);
	});

	it('a submit still in flight at the call budget returns its ticket as a submitting job', async () => {
		const { generate } = await import('../api/_mcp-studio/gpt-forge-client.js');
		const { jobFields } = await import('../api/_mcp-studio/jobs.js');
		let open;
		forge.submitGate = new Promise((r) => (open = r));
		// A deadline already spent: the ticketed submit gets only its short floor.
		const ticket = 'lzk3m0aa-11111111-2222-4333-8444-555555555555';
		const job = await generate('https://three.ws', { prompt: 'a red ceramic teapot' }, { deadline: Date.now() - 1, ticket });
		open();
		expect(job).toMatchObject({ _timedOut: true, job_id: `t1.${ticket}`, stage: 'submit' });
		expect(jobFields(job).phase).toBe('submitting');
	});

	it('rig_mesh sends a ticket so its job has a handle before the rig exists', async () => {
		await call('rig_mesh', { glb_url: FIXTURE_GLB, idempotency_key: 'k-rig' });
		expect(forge.submits[0].rig).toBe(true);
		expect(forge.submits[0].ticket).toMatch(/^[0-9a-z]+-[0-9a-f-]{36}$/);
	});
});

describe('get_job', () => {
	it('reports a running job with progress and eta_seconds', async () => {
		forge.frames.set('jobtok-77', FIXTURE_FRAMES.running);
		const r = await call('get_job', { job_id: 'jobtok-77' });
		expect(r.isError).toBeFalsy();
		expect(r.structuredContent).toMatchObject({
			status: 'pending',
			phase: 'running',
			job_id: 'jobtok-77',
			progress: 0.25,
			eta_seconds: 90,
			elapsed_seconds: 30,
		});
		expect(r.content[0].text).toContain('call the get_job tool');
	});

	it('reports a queued job on a waking worker as queued', async () => {
		forge.frames.set('jobtok-78', FIXTURE_FRAMES.queued);
		const r = await call('get_job', { job_id: 'jobtok-78' });
		expect(r.structuredContent).toMatchObject({ status: 'pending', phase: 'queued', coldStart: true });
	});

	it('returns the model and its four links when done', async () => {
		forge.frames.set('jobtok-79', FIXTURE_FRAMES.done);
		const r = await call('get_job', { job_id: 'jobtok-79' });
		expect(r.isError).toBeFalsy();
		const sc = r.structuredContent;
		expect(sc).toMatchObject({ status: 'done', phase: 'done', progress: 1, eta_seconds: 0, job_id: 'jobtok-79' });
		expect(sc.glb_url).toBe(FIXTURE_GLB);
		expect(sc.viewer_url).toContain('/viewer?src=');
		expect(sc.poster_png_url).toContain('/api/render/glb');
		expect(sc.embed_html).toContain('<');
	});

	it('explains a failed job and how to recover, without marking it retryable', async () => {
		forge.frames.set('jobtok-80', FIXTURE_FRAMES.failed);
		const r = await call('get_job', { job_id: 'jobtok-80' });
		expect(r.isError).toBe(true);
		expect(r.structuredContent).toMatchObject({ status: 'failed', reason: 'generation_failed', job_id: 'jobtok-80' });
		expect(r.structuredContent.retryable).toBeUndefined();
		expect(r.structuredContent.remedy).toMatch(/Start a new generation/);
		expect(r.content[0].text).toContain('The mesh came back empty');
	});

	it('names an unknown job as final', async () => {
		forge.frames.set('jobtok-81', 404);
		const r = await call('get_job', { job_id: 'jobtok-81' });
		expect(r.structuredContent).toMatchObject({ status: 'failed', reason: 'unknown_job' });
	});

	it('marks a failed check as retryable with a wait, since the job keeps running', async () => {
		forge.frames.set('jobtok-82', 429);
		const r = await call('get_job', { job_id: 'jobtok-82' });
		expect(r.structuredContent).toMatchObject({ status: 'unknown', reason: 'check_failed', retryable: true, retry_after: 7 });
	});

	it('is listed on the full and Grok surfaces but not the ChatGPT listing', async () => {
		const { toolCatalogFor } = await import('../api/_mcp-studio/dispatch.js');
		expect(toolCatalogFor('full').map((t) => t.name)).toContain('get_job');
		expect(toolCatalogFor('grok').map((t) => t.name)).toContain('get_job');
		expect(toolCatalogFor('chatgpt').map((t) => t.name)).not.toContain('get_job');
	});
});

// A minimal node-style req/res pair for driving the real HTTP handler.
function httpPair(body, headers = {}) {
	const payload = Buffer.from(JSON.stringify(body));
	const ip = '198.51.100.23';
	const req = {
		method: 'POST',
		url: '/api/mcp-studio',
		headers: { host: 'three.ws', 'content-type': 'application/json', 'x-forwarded-for': ip, ...headers },
		socket: { remoteAddress: ip },
		async *[Symbol.asyncIterator]() {
			yield payload;
		},
		on(event, cb) {
			if (event === 'data') cb(payload);
			if (event === 'end') cb();
			return this;
		},
	};
	const out = { headers: {}, body: '', ended: false };
	const res = {
		statusCode: 200,
		headersSent: false,
		writableEnded: false,
		setHeader(k, v) {
			out.headers[k.toLowerCase()] = v;
		},
		getHeader(k) {
			return out.headers[k.toLowerCase()];
		},
		removeHeader(k) {
			delete out.headers[k.toLowerCase()];
		},
		flushHeaders() {
			this.headersSent = true;
		},
		write(chunk) {
			out.body += chunk;
			return true;
		},
		end(chunk) {
			if (chunk) out.body += chunk;
			out.status = this.statusCode;
			this.headersSent = true;
			this.writableEnded = true;
			out.ended = true;
		},
	};
	return { req, res, out };
}

function sseMessages(body) {
	return body
		.split('\n\n')
		.filter((block) => block.startsWith('event: message'))
		.map((block) => JSON.parse(block.split('\n').find((l) => l.startsWith('data: ')).slice(6)));
}

describe('progress notifications', () => {
	const toolCall = (meta) => ({
		jsonrpc: '2.0',
		id: 9,
		method: 'tools/call',
		params: { name: 'forge_free', arguments: { prompt: 'a red ceramic teapot' }, ...(meta ? { _meta: meta } : {}) },
	});

	it('streams notifications/progress then the result when the client sent a progressToken', async () => {
		process.env.STUDIO_FORGE_TIMEOUT_MS = '60000';
		process.env.STUDIO_POLL_MS = '1';
		let polls = 0;
		forge.frames.set('*', FIXTURE_FRAMES.running);
		const realFetch = globalThis.fetch;
		vi.stubGlobal('fetch', async (url, init) => {
			if (String(url).includes('job=')) {
				// Status frames arrive seconds apart in production; progress is
				// reported in tenths of a second, so space these past that.
				await new Promise((r) => setTimeout(r, 120));
				polls++;
				if (polls >= 3) forge.frames.set('jobtok-1', FIXTURE_FRAMES.done);
			}
			return realFetch(url, init);
		});
		const { req: rq, res, out } = httpPair(toolCall({ progressToken: 'tok-1' }), { accept: 'application/json, text/event-stream' });
		await studioHandler({ surface: 'full' })(rq, res);
		delete process.env.STUDIO_POLL_MS;

		expect(out.headers['content-type']).toMatch(/^text\/event-stream/);
		const msgs = sseMessages(out.body);
		const progress = msgs.filter((m) => m.method === 'notifications/progress');
		expect(progress.length).toBeGreaterThanOrEqual(2);
		for (const p of progress) expect(p.params.progressToken).toBe('tok-1');
		const values = progress.map((p) => p.params.progress);
		for (let i = 1; i < values.length; i++) expect(values[i]).toBeGreaterThan(values[i - 1]);
		expect(progress.some((p) => /Rendering the model/.test(p.params.message))).toBe(true);
		const final = msgs.at(-1);
		expect(final.id).toBe(9);
		expect(final.result.structuredContent.glbUrl).toBe(FIXTURE_GLB);
		expect(out.ended).toBe(true);
	});

	it('answers plain JSON when no progressToken was sent', async () => {
		const { req: rq, res, out } = httpPair(toolCall(null), { accept: 'application/json, text/event-stream' });
		await studioHandler({ surface: 'full' })(rq, res);
		expect(out.headers['content-type']).toMatch(/^application\/json/);
		expect(JSON.parse(out.body).result.structuredContent.status).toBe('pending');
	});

	it('answers plain JSON when the client does not accept an event stream', async () => {
		const { req: rq, res, out } = httpPair(toolCall({ progressToken: 3 }), { accept: 'application/json' });
		await studioHandler({ surface: 'full' })(rq, res);
		expect(out.headers['content-type']).toMatch(/^application\/json/);
	});
});

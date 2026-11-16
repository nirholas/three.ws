// /api/forge/export-usd: the real handler behind a real HTTP server, talking
// to a real HTTP server on loopback that speaks the workers/usd-export contract
// (POST /export answers 202 with a task record, GET /tasks/<id> walks it through
// its stages to done). The creation loader is injected because production reads
// Postgres; everything after it (validation, SSRF guard, bearer auth, worker
// error mapping, the public job shape) is the production code path.

import { createServer } from 'node:http';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createExportUsdHandler, toJob } from '../api/forge/export-usd.js';

const ID = '9b2e4c61-3a7d-4f10-8c55-1e2d3f4a5b6c';
const PRIVATE = '9b2e4c61-3a7d-4f10-8c55-1e2d3f4a5b6d';
const KEY = 'worker-secret';
const STAGES = ['fetching', 'converting', 'physics', 'packaging', 'validating', 'uploading'];
const TASK = 'a'.repeat(40);

const worker = { requests: [], polls: 0, failNext: null };

function record(status, stage, extra = {}) {
	return { task_id: TASK, status, stage, stages: STAGES, exporter: 'three.ws-usd-export/1', ...extra };
}

function startWorker() {
	return new Promise((resolve) => {
		const server = createServer((req, res) => {
			let raw = '';
			req.on('data', (c) => (raw += c));
			req.on('end', () => {
				const send = (status, body) => {
					res.writeHead(status, { 'content-type': 'application/json' });
					res.end(JSON.stringify(body));
				};
				if (req.headers.authorization !== `Bearer ${KEY}`) return send(401, { detail: 'invalid API key' });
				if (worker.failNext) {
					const f = worker.failNext;
					f.times -= 1;
					if (f.times <= 0) worker.failNext = null;
					return send(f.status, f.body);
				}
				if (req.method === 'POST' && req.url === '/export') {
					worker.requests.push(JSON.parse(raw));
					worker.polls = 0;
					return send(202, record('queued', 'queued'));
				}
				if (req.method === 'GET' && req.url === `/tasks/${TASK}`) {
					worker.polls += 1;
					if (worker.polls < 3) return send(200, record('running', STAGES[worker.polls - 1]));
					return send(
						200,
						record('done', 'done', {
							files: { usdz: 'https://storage.googleapis.com/b/usd/x/asset.usdz' },
							summary: { label: 'chair', mass_kg: 35.17, validation: { passed: true } },
						}),
					);
				}
				if (req.method === 'GET' && req.url.startsWith('/tasks/')) return send(404, { detail: 'task not found' });
				send(404, { detail: 'not found' });
			});
		});
		server.listen(0, '127.0.0.1', () => resolve(server));
	});
}

let workerServer;
let apiServer;
let base;
let configured = true;

beforeAll(async () => {
	workerServer = await startWorker();
	const workerBase = `http://127.0.0.1:${workerServer.address().port}`;
	const handler = createExportUsdHandler({
		loadCreation: async (id) =>
			id === ID
				? { glb_url: '/cdn/forge/abc/model.glb', prompt: 'a wooden chair', category: 'furniture' }
				: null,
		config: () => (configured ? { base: workerBase, key: KEY } : { base: '', key: '' }),
	});
	apiServer = createServer((req, res) => handler(req, res));
	await new Promise((r) => apiServer.listen(0, '127.0.0.1', r));
	base = `http://127.0.0.1:${apiServer.address().port}/api/forge/export-usd`;
});

afterAll(async () => {
	await new Promise((r) => apiServer.close(r));
	await new Promise((r) => workerServer.close(r));
});

beforeEach(() => {
	configured = true;
	worker.requests = [];
	worker.failNext = null;
});

const post = (body) =>
	fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('POST starts an export', () => {
	it('resolves a creation id to an absolute GLB URL with its prompt and category', async () => {
		const r = await post({ id: ID });
		expect(r.status).toBe(202);
		const job = await r.json();
		expect(worker.requests[0]).toEqual({
			glb_url: 'https://three.ws/cdn/forge/abc/model.glb',
			prompt: 'a wooden chair',
			category: 'furniture',
			creation_id: ID,
		});
		expect(job).toMatchObject({ job: TASK, status: 'queued', progress: 0, poll: `/api/forge/export-usd?job=${TASK}` });
		expect(job.stages.map((s) => s.id)).toEqual(STAGES);
		expect(job.stages[2].label).toBe('Building collision hulls and mass');
	});

	it('passes validated overrides and lets the caller prompt win', async () => {
		const r = await post({ id: ID, prompt: 'a steel chair', label: 'Chair', size_m: 1.2, density_kg_m3: 7850 });
		expect(r.status).toBe(202);
		expect(worker.requests[0]).toMatchObject({ prompt: 'a steel chair', label: 'chair', size_m: 1.2, density_kg_m3: 7850 });
	});

	it('refuses bad overrides before calling the worker', async () => {
		for (const body of [
			{ id: ID, size_m: 0 },
			{ id: ID, size_m: 'big' },
			{ id: ID, density_kg_m3: 90000 },
			{ id: ID, label: '<script>' },
		]) {
			const r = await post(body);
			expect(r.status).toBe(400);
			expect((await r.json()).error).toBe('validation_error');
		}
		expect(worker.requests).toHaveLength(0);
	});

	it('404s a private or unknown creation and 400s a malformed id', async () => {
		expect((await post({ id: PRIVATE })).status).toBe(404);
		expect((await post({ id: 'not-a-uuid' })).status).toBe(400);
		expect((await post({})).status).toBe(400);
	});

	it('refuses a private-network src (SSRF guard)', async () => {
		const r = await post({ src: 'https://127.0.0.1/model.glb' });
		expect(r.status).toBe(400);
		expect((await r.json()).error_description).toMatch(/public https URL/);
		expect(worker.requests).toHaveLength(0);
	});

	it('surfaces a worker input refusal as a 400 with its reason', async () => {
		worker.failNext = { status: 400, body: { detail: 'glb_url host is not allowed' }, times: 1 };
		const r = await post({ id: ID });
		expect(r.status).toBe(400);
		expect((await r.json()).error_description).toBe('glb_url host is not allowed');
	});

	it('maps a worker outage to an actionable 502 after its retry', async () => {
		worker.failNext = { status: 503, body: { detail: 'overloaded' }, times: 5 };
		const r = await post({ id: ID });
		expect(r.status).toBe(502);
		expect((await r.json()).error).toBe('worker_unavailable');
		worker.failNext = null;
	});

	it('answers 503 with the variables to set when the worker is not configured', async () => {
		configured = false;
		const r = await post({ id: ID });
		expect(r.status).toBe(503);
		expect((await r.json()).error_description).toMatch(/GCP_USD_EXPORT_URL/);
	});
});

describe('GET polls a job through its stages', () => {
	it('walks running stages to done with files and the summary', async () => {
		await post({ id: ID });
		const seen = [];
		let job;
		do {
			const r = await fetch(`${base}?job=${TASK}`);
			expect(r.status).toBe(200);
			expect(r.headers.get('cache-control')).toBe('no-store');
			job = await r.json();
			seen.push(job.stage);
		} while (job.status !== 'done');
		expect(seen).toEqual(['fetching', 'converting', 'done']);
		expect(job.progress).toBe(1);
		expect(job.files.usdz).toMatch(/asset\.usdz$/);
		expect(job.summary).toMatchObject({ label: 'chair', mass_kg: 35.17 });
	});

	it('404s an unknown job and 400s a malformed one', async () => {
		expect((await fetch(`${base}?job=${'b'.repeat(40)}`)).status).toBe(404);
		expect((await fetch(`${base}?job=../etc`)).status).toBe(400);
	});
});

describe('toJob', () => {
	it('reports fractional progress and carries the worker error', () => {
		const job = toJob(record('error', 'validating', { error: 'the exported USD did not pass validation' }));
		expect(job.progress).toBe(0.67);
		expect(job.stage_label).toMatch(/usdchecker/);
		expect(job.error).toMatch(/did not pass validation/);
	});
});

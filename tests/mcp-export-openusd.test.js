// export_openusd MCP tool: the real tool handler talking to a real HTTP server
// on loopback that speaks the workers/usd-export contract. Only the creation
// loader (Postgres in production) and the sleep between polls are injected; the
// validation, worker auth, polling loop and error mapping are production code.

import { createServer } from 'node:http';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createExportOpenUsdHandler, toolDefs } from '../api/_mcp3d/tools/openusd.js';

const ID = '9b2e4c61-3a7d-4f10-8c55-1e2d3f4a5b6c';
const KEY = 'worker-secret';
const STAGES = ['fetching', 'converting', 'physics', 'packaging', 'validating', 'uploading'];
const TASK = 'b'.repeat(40);

const worker = { requests: [], polls: 0, doneAfter: 3, down: false };

function record(status, stage, extra = {}) {
	return { task_id: TASK, status, stage, stages: STAGES, exporter: 'three.ws-usd-export/1', ...extra };
}

const DONE = record('done', 'done', {
	files: {
		usdz: 'https://storage.googleapis.com/b/usd/x/asset.usdz',
		zip: 'https://storage.googleapis.com/b/usd/x/asset.zip',
		usda: 'https://storage.googleapis.com/b/usd/x/asset.usda',
		report: 'https://storage.googleapis.com/b/usd/x/report.json',
	},
	summary: {
		label: 'chair',
		size_m: [0.5, 0.52, 0.9],
		mass_kg: 35.1742,
		hulls: 16,
		rigged: false,
		validation: {
			usd: { usdchecker: { errors: 0, warnings: 0 }, asset_validator: { errors: 0, warnings: 1 } },
			usdz: { usdchecker: { errors: 0, warnings: 0 }, asset_validator: { errors: 0, warnings: 1 } },
		},
	},
});

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
				if (worker.down) return send(503, { detail: 'unavailable' });
				if (req.method === 'POST' && req.url === '/export') {
					worker.requests.push(JSON.parse(raw));
					worker.polls = 0;
					return send(202, record('queued', 'queued'));
				}
				if (req.method === 'GET' && req.url === `/tasks/${TASK}`) {
					worker.polls += 1;
					if (worker.polls < worker.doneAfter) return send(200, record('running', STAGES[worker.polls - 1]));
					return send(200, DONE);
				}
				send(404, { detail: 'task not found' });
			});
		});
		server.listen(0, '127.0.0.1', () => resolve(server));
	});
}

let server;
let handler;

beforeAll(async () => {
	server = await startWorker();
	const base = `http://127.0.0.1:${server.address().port}`;
	handler = createExportOpenUsdHandler({
		loadCreation: async (id) =>
			id === ID ? { glb_url: '/cdn/forge/abc/model.glb', prompt: 'a wooden chair', category: 'furniture' } : null,
		config: () => ({ base, key: KEY }),
		sleep: async () => {},
		pollMs: 0,
	});
});

afterAll(() => new Promise((r) => server.close(r)));

beforeEach(() => {
	worker.requests = [];
	worker.polls = 0;
	worker.doneAfter = 3;
	worker.down = false;
});

describe('export_openusd tool definition', () => {
	it('is registered with a schema that names both inputs and the poll handle', () => {
		const def = toolDefs.find((d) => d.name === 'export_openusd');
		expect(def).toBeTruthy();
		expect(Object.keys(def.inputSchema.properties)).toEqual(
			expect.arrayContaining(['creation_id', 'glb_url', 'job', 'wait_seconds']),
		);
		expect(def.annotations.destructiveHint).toBe(false);
	});
});

describe('export_openusd handler', () => {
	it('exports a creation, waits for the worker and returns the files', async () => {
		const out = await handler({ creation_id: ID });
		expect(out.isError).toBeUndefined();
		expect(worker.requests[0]).toMatchObject({
			glb_url: 'https://three.ws/cdn/forge/abc/model.glb',
			prompt: 'a wooden chair',
			category: 'furniture',
			creation_id: ID,
		});
		const text = out.content[0].text;
		expect(text).toContain('OpenUSD export ready');
		expect(text).toContain('class "chair"');
		expect(text).toContain('35.17 kg');
		expect(text).toContain('16 convex collision hulls');
		expect(text).toContain('0 validator errors, 2 warnings');
		expect(text).toContain(DONE.files.usdz);
		expect(text).toContain(DONE.files.report);
		expect(out.structuredContent).toMatchObject({ job: TASK, status: 'done', progress: 1 });
	});

	it('returns the running job when the wait runs out, then finishes when polled by job', async () => {
		worker.doneAfter = 99;
		const first = await handler({ creation_id: ID, wait_seconds: 0 });
		expect(first.structuredContent).toMatchObject({ job: TASK, status: 'queued' });
		expect(first.content[0].text).toContain(`job="${TASK}"`);

		worker.doneAfter = 1;
		worker.polls = 0;
		const second = await handler({ job: TASK });
		expect(second.structuredContent.status).toBe('done');
		expect(second.content[0].text).toContain('OpenUSD export ready');
	});

	it('refuses bad input before calling the worker', async () => {
		const none = await handler({});
		expect(none).toMatchObject({ isError: true, structuredContent: { code: 'validation_error' } });
		const badId = await handler({ creation_id: 'not-a-uuid' });
		expect(badId.structuredContent.code).toBe('validation_error');
		const badSize = await handler({ creation_id: ID, size_m: -1 });
		expect(badSize.structuredContent.code).toBe('validation_error');
		const badJob = await handler({ job: 'nope' });
		expect(badJob.structuredContent.code).toBe('validation_error');
		expect(worker.requests).toHaveLength(0);
	});

	it('reports a missing creation and a private glb_url host', async () => {
		const missing = await handler({ creation_id: '9b2e4c61-3a7d-4f10-8c55-1e2d3f4a5b6d' });
		expect(missing.structuredContent.code).toBe('creation_not_found');
		const internal = await handler({ glb_url: 'https://127.0.0.1/model.glb' });
		expect(internal.structuredContent.code).toBe('validation_error');
	});

	it('maps a worker outage to an actionable error instead of throwing', async () => {
		worker.down = true;
		const out = await handler({ creation_id: ID });
		expect(out.isError).toBe(true);
		expect(out.structuredContent.code).toBe('worker_unavailable');
		expect(out.content[0].text).toMatch(/Try again in a minute/);
	});
});

import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { json } from '../api/_lib/http.js';

// POST /api/forge (generate) and POST /api/forge?action=rig start GPU work. A
// client that loses the response (a dropped connection, a timeout, a retry
// policy in an SDK) and sends the same request again must get the first job
// back, not start a second generation. The SDKs send an `Idempotency-Key`
// header on every create call; these tests pin that the forge honours it on the
// same shared 24-hour store the v1 agents API and the MCP studio use.

function makeRes() {
	const sent = {};
	let resolveDone;
	const done = new Promise((r) => (resolveDone = r));
	const res = {
		statusCode: 200,
		headersSent: false,
		writableEnded: false,
		setHeader(k, v) { sent[k.toLowerCase()] = v; },
		getHeader(k) { return sent[k.toLowerCase()]; },
		removeHeader(k) { delete sent[k.toLowerCase()]; },
		writeHead(code, h) { this.statusCode = code; Object.entries(h || {}).forEach(([k, v]) => this.setHeader(k, v)); return this; },
		write() { return true; },
		end(body) {
			this.headersSent = true;
			this.writableEnded = true;
			resolveDone({ status: this.statusCode, headers: sent, body: body ? JSON.parse(String(body)) : null });
		},
	};
	return { res, done };
}

function makeReq(body, headers = {}) {
	// Cloud Run's server pre-parses JSON onto req.body (server/index.mjs).
	return {
		method: 'POST',
		url: '/api/forge',
		headers: { host: 'three.ws', 'content-type': 'application/json', ...headers },
		socket: { remoteAddress: '203.0.113.7' },
		body,
	};
}

describe('withForgeIdempotency', async () => {
	const { withForgeIdempotency } = await import('../api/_lib/forge-idempotency.js');

	it('runs the work once and replays the stored response for a repeat key', async () => {
		const key = randomUUID();
		let runs = 0;
		const work = (res) => async () => {
			runs += 1;
			json(res, 200, { job_id: `job-${runs}`, status: 'queued' });
		};

		const a = makeRes();
		await withForgeIdempotency(makeReq({ prompt: 'a teapot' }, { 'idempotency-key': key }), a.res, {
			scope: 'generate',
			caller: 'ip:203.0.113.7',
			run: work(a.res),
		});
		const first = await a.done;

		const b = makeRes();
		await withForgeIdempotency(makeReq({ prompt: 'a teapot' }, { 'idempotency-key': key }), b.res, {
			scope: 'generate',
			caller: 'ip:203.0.113.7',
			run: work(b.res),
		});
		const second = await b.done;

		expect(runs).toBe(1);
		expect(first.body.job_id).toBe('job-1');
		expect(second.status).toBe(200);
		expect(second.body.job_id).toBe('job-1');
		expect(second.headers['idempotent-replayed']).toBe('true');
	});

	it('refuses a key reused with a different body', async () => {
		const key = randomUUID();
		const a = makeRes();
		await withForgeIdempotency(makeReq({ prompt: 'a teapot' }, { 'idempotency-key': key }), a.res, {
			scope: 'generate',
			caller: 'ip:203.0.113.7',
			run: async () => json(a.res, 200, { job_id: 'j', status: 'queued' }),
		});
		await a.done;

		const b = makeRes();
		let ran = false;
		await withForgeIdempotency(makeReq({ prompt: 'a lamp' }, { 'idempotency-key': key }), b.res, {
			scope: 'generate',
			caller: 'ip:203.0.113.7',
			run: async () => { ran = true; },
		});
		const second = await b.done;
		expect(ran).toBe(false);
		expect(second.status).toBe(422);
		expect(second.body.error).toBe('idempotency_key_reused');
	});

	it('gives the key back when the work fails, so a retry can run', async () => {
		const key = randomUUID();
		const a = makeRes();
		await withForgeIdempotency(makeReq({ prompt: 'a teapot' }, { 'idempotency-key': key }), a.res, {
			scope: 'generate',
			caller: 'ip:203.0.113.7',
			run: async () => json(a.res, 503, { error: 'lane_busy', message: 'busy' }),
		});
		expect((await a.done).status).toBe(503);

		const b = makeRes();
		let ran = false;
		await withForgeIdempotency(makeReq({ prompt: 'a teapot' }, { 'idempotency-key': key }), b.res, {
			scope: 'generate',
			caller: 'ip:203.0.113.7',
			run: async () => { ran = true; json(b.res, 200, { job_id: 'retry', status: 'queued' }); },
		});
		expect(ran).toBe(true);
		expect((await b.done).body.job_id).toBe('retry');
	});

	it('runs normally when no key is sent', async () => {
		const a = makeRes();
		let runs = 0;
		await withForgeIdempotency(makeReq({ prompt: 'a teapot' }), a.res, {
			scope: 'generate',
			caller: 'ip:203.0.113.7',
			run: async () => { runs += 1; json(a.res, 200, { ok: true }); },
		});
		await a.done;
		expect(runs).toBe(1);
		expect(a.res.getHeader('idempotent-replayed')).toBeUndefined();
	});
});

describe('POST /api/forge honours Idempotency-Key', async () => {
	const { default: handler } = await import('../api/forge.js');

	it('rejects an over-long key before starting any work', async () => {
		const { res, done } = makeRes();
		handler(makeReq({ prompt: 'a teapot' }, { 'idempotency-key': 'k'.repeat(201) }), res);
		const got = await done;
		expect(got.status).toBe(400);
		expect(got.body.error).toBe('invalid_idempotency_key');
	});
});

/**
 * Cartographer WORK runner (capability bit 3). Runs the real runner against a
 * real local HTTP server standing in for /api/diorama, so the only thing swapped
 * is the network boundary. The recorded plan below is the shape the live composer
 * returned on 2026-11-04 (composePlanFromPrompt output, normalized).
 */

import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import { createHash } from 'node:crypto';

import { runCartographer, CartographerError } from '../workers/agora-citizens/work/cartographer.js';
import { canonicalJsonBytes } from '../workers/agora-citizens/work/_skills.js';

const PLAN = {
	title: 'Stormy Lighthouse',
	mood: 'night',
	ground: 'stone',
	island: 'craggy',
	objects: [
		{ label: 'lighthouse', prompt: 'tall white lighthouse with red stripes, weathered stone', position: [0, 0, 0], scale: 2, rotationY: 0 },
		{ label: 'rocks', prompt: 'jagged dark basalt rock cluster', position: [2.5, 0, 1.5], scale: 1, rotationY: 1.2 },
	],
};

let server;
async function serve(handler) {
	server = http.createServer(handler);
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	return `http://127.0.0.1:${server.address().port}`;
}
afterEach(async () => {
	if (server) await new Promise((r) => server.close(r));
	server = null;
});

const json = (res, status, body) => {
	res.writeHead(status, { 'content-type': 'application/json' });
	res.end(JSON.stringify(body));
};
const citizen = { agentIdHex: 'ab12' };
const job = { prompt: 'a lonely lighthouse on a stormy cliff' };

describe('runCartographer', () => {
	it('returns the canonical plan with a proof that is the sha256 of its canonical JSON', async () => {
		let seen;
		const apiBase = await serve((req, res) => {
			let b = '';
			req.on('data', (c) => (b += c));
			req.on('end', () => {
				// The runner composes first, then tries a best-effort permalink save;
				// this test pins the compose request. The save gets no id back, so
				// the deliverable (and proof) carries the plan alone.
				const body = JSON.parse(b);
				if (body.action === 'compose') seen = { url: req.url, body };
				json(res, 200, { diorama: PLAN });
			});
		});
		const r = await runCartographer({ cfg: { apiBase }, citizen, job });
		expect(seen.url).toBe('/api/diorama');
		expect(seen.body).toEqual({ action: 'compose', prompt: job.prompt });
		const expected = canonicalJsonBytes({ kind: 'agora.diorama.v1', prompt: job.prompt, diorama: PLAN });
		expect(r.proofHashHex).toBe(createHash('sha256').update(expected).digest('hex'));
		expect(r.summary).toContain('Stormy Lighthouse');
	});

	it('is deterministic for a fixed brief and plan', async () => {
		const apiBase = await serve((req, res) => json(res, 200, { diorama: PLAN }));
		const a = await runCartographer({ cfg: { apiBase }, citizen, job });
		const b = await runCartographer({ cfg: { apiBase }, citizen, job });
		expect(a.proofHashHex).toBe(b.proofHashHex);
	});

	it('surfaces a stalled composer as a typed compose_timeout', async () => {
		const apiBase = await serve(() => {});
		const err = await runCartographer({ cfg: { apiBase, cartographerTimeoutMs: 150 }, citizen, job }).catch((e) => e);
		expect(err).toBeInstanceOf(CartographerError);
		expect(err.code).toBe('compose_timeout');
	});

	it('turns a composer failure into a typed failure with no fabricated map', async () => {
		const apiBase = await serve((req, res) => json(res, 503, { error: 'composer_unavailable' }));
		const err = await runCartographer({ cfg: { apiBase }, citizen, job }).catch((e) => e);
		expect(err).toBeInstanceOf(CartographerError);
		expect(err.code).toBe('compose_failed');
		expect(err.message).toContain('composer_unavailable');
	});

	it('rejects an empty plan', async () => {
		const apiBase = await serve((req, res) => json(res, 200, { diorama: { ...PLAN, objects: [] } }));
		const err = await runCartographer({ cfg: { apiBase }, citizen, job }).catch((e) => e);
		expect(err.code).toBe('compose_invalid');
	});

	it('rejects a plan with an object that has no forge target or a bad position', async () => {
		for (const bad of [
			{ label: 'x', position: [0, 0, 0] },
			{ label: 'x', prompt: 'a tree', position: [0, 0] },
			{ label: 'x', prompt: 'a tree', position: [0, 'a', 0] },
		]) {
			const apiBase = await serve((req, res) => json(res, 200, { diorama: { ...PLAN, objects: [PLAN.objects[0], bad] } }));
			const err = await runCartographer({ cfg: { apiBase }, citizen, job }).catch((e) => e);
			expect(err.code).toBe('compose_invalid');
			await new Promise((r) => server.close(r));
			server = null;
		}
	});
});

describe('runCartographer permalink', () => {
	const ID = '123e4567-e89b-42d3-a456-426614174000';
	it('saves the map and binds the permalink into the deliverable and proof', async () => {
		const actions = [];
		const apiBase = await serve((req, res) => {
			let b = '';
			req.on('data', (c) => (b += c));
			req.on('end', () => {
				const body = JSON.parse(b);
				actions.push(body.action);
				if (body.action === 'save') return json(res, 200, { id: ID, url: `https://three.ws/diorama?id=${ID}` });
				json(res, 200, { diorama: PLAN });
			});
		});
		const r = await runCartographer({ cfg: { apiBase }, citizen, job });
		expect(actions).toEqual(['compose', 'save']);
		expect(r.meta.dioramaId).toBe(ID);
		expect(r.result.permalink).toBe(`https://three.ws/diorama?id=${ID}`);
		const expected = canonicalJsonBytes({ kind: 'agora.diorama.v1', prompt: job.prompt, diorama: PLAN, dioramaId: ID, permalink: `https://three.ws/diorama?id=${ID}` });
		expect(r.proofHashHex).toBe(createHash('sha256').update(expected).digest('hex'));
	});

	it('still completes honestly without a permalink when sharing is unavailable', async () => {
		const apiBase = await serve((req, res) => {
			let b = '';
			req.on('data', (c) => (b += c));
			req.on('end', () => (JSON.parse(b).action === 'save' ? json(res, 503, { error: 'sharing_unavailable' }) : json(res, 200, { diorama: PLAN })));
		});
		const r = await runCartographer({ cfg: { apiBase }, citizen, job });
		expect(r.meta.dioramaId).toBeUndefined();
		expect(r.result.permalink).toBeUndefined();
	});
});

// The Agora citizens are a platform worker: their Sculptor forges GLBs on
// /api/forge and their Cartographer composes and saves worlds on /api/diorama,
// both of which refuse a caller with no account. The worker answers for its
// citizens as a platform job (the deployment's CRON_SECRET as x-forge-seed),
// marked on-behalf so what a citizen makes is born unlisted rather than joining
// the curated showcase.

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import http from 'node:http';

import { runCartographer } from '../workers/agora-citizens/work/cartographer.js';
import { runSculptor } from '../workers/agora-citizens/work/sculptor.js';

let server;
async function serve(handler) {
	server = http.createServer(handler);
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	return `http://127.0.0.1:${server.address().port}`;
}
const json = (res, status, body) => {
	res.writeHead(status, { 'content-type': 'application/json' });
	res.end(JSON.stringify(body));
};

const prevSecret = process.env.CRON_SECRET;
beforeEach(() => { process.env.CRON_SECRET = 'agora-test-secret'; });
afterEach(async () => {
	if (prevSecret === undefined) delete process.env.CRON_SECRET;
	else process.env.CRON_SECRET = prevSecret;
	if (server) await new Promise((r) => server.close(r));
	server = null;
});

const PLAN = {
	title: 'Harbour', mood: 'day', ground: 'grass', island: 'round',
	objects: [{ label: 'boat', prompt: 'a small boat', position: [0, 0, 0], scale: 1, rotationY: 0 }],
};

describe('Agora creation calls carry the platform-job credential', () => {
	it('Cartographer compose and save send x-forge-seed marked on-behalf', async () => {
		const seen = [];
		const apiBase = await serve((req, res) => {
			let b = '';
			req.on('data', (c) => (b += c));
			req.on('end', () => {
				seen.push({ action: JSON.parse(b).action, headers: req.headers });
				json(res, 200, { diorama: PLAN });
			});
		});
		await runCartographer({ cfg: { apiBase }, citizen: { agentIdHex: 'ab12' }, job: { prompt: 'a harbour' } });
		expect(seen.map((s) => s.action)).toEqual(['compose', 'save']);
		for (const s of seen) {
			expect(s.headers['x-forge-seed']).toBe('agora-test-secret');
			expect(s.headers['x-forge-on-behalf']).toBe('1');
		}
	});

	it('Sculptor forge submit sends x-forge-seed marked on-behalf', async () => {
		let submit;
		const apiBase = await serve((req, res) => {
			if (req.method === 'POST' && req.url.startsWith('/api/forge')) {
				submit = req.headers;
				return json(res, 200, { status: 'done', glb_url: `http://127.0.0.1:${server.address().port}/m.glb`, backend: 'nim', tier: 'draft' });
			}
			res.writeHead(200, { 'content-type': 'model/gltf-binary' });
			res.end(Buffer.from('glTF-bytes'));
		});
		await runSculptor({ cfg: { apiBase }, citizen: { agentIdHex: 'ab12' }, job: { prompt: 'a brass key' } }).catch(() => {});
		expect(submit?.['x-forge-seed']).toBe('agora-test-secret');
		expect(submit?.['x-forge-on-behalf']).toBe('1');
	});
});

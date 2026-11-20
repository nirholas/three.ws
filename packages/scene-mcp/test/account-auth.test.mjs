// Every POST /api/diorama action makes something (a plan, a saved world, a
// merged GLB, server-side forges), so three.ws answers an anonymous caller 401
// `sign_in_required`. The scene MCP must send THREE_WS_API_KEY as a bearer on
// those calls, refuse before any request when no key is set, keep the public
// reads (get_scene, list_scenes) keyless, and name a refused key as refused.
//
// Each case runs in a child process with its own env, because config.js reads
// env once at import. A local HTTP server stands in for three.ws; nothing
// reaches the network.
//
// Run: node --test packages/scene-mcp/test/account-auth.test.mjs

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';

const seen = [];
let server;
let base;

before(async () => {
	server = http.createServer((req, res) => {
		req.resume();
		req.on('end', () => {
			seen.push({ method: req.method, url: req.url, authorization: req.headers.authorization || null });
			const send = (status, payload) => {
				res.writeHead(status, { 'content-type': 'application/json' });
				res.end(JSON.stringify(payload));
			};
			if (req.method === 'GET') return send(200, { dioramas: [] });
			if (!req.headers.authorization) {
				return send(401, { error: 'sign_in_required', message: 'Sign in to compose a world.', api_keys_url: '/dashboard/api-keys' });
			}
			if (req.headers.authorization !== 'Bearer sk_good') {
				return send(401, { error: 'invalid_api_key', message: 'Invalid API key.' });
			}
			return send(200, { diorama: { title: 'Lantern Cove', objects: [] } });
		});
	});
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
	await new Promise((r) => server.close(r));
});

const TOOLS = new URL('../src/index.js', import.meta.url).href;

function runTool(apiKey, name, args) {
	const env = { ...process.env, THREE_WS_BASE: base };
	if (apiKey === undefined) delete env.THREE_WS_API_KEY;
	else env.THREE_WS_API_KEY = apiKey;
	const script = `
		const { TOOLS } = await import(${JSON.stringify(TOOLS)});
		const tool = TOOLS.find((t) => t.name === ${JSON.stringify(name)});
		try {
			const out = await tool.handler(${JSON.stringify(args)});
			console.log(JSON.stringify({ ok: true, out }));
		} catch (err) {
			console.log(JSON.stringify({ ok: false, code: err.code, status: err.status, message: err.message }));
		}`;
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, ['--input-type=module', '-e', script], { env });
		let out = '';
		let errOut = '';
		child.stdout.on('data', (c) => (out += c));
		child.stderr.on('data', (c) => (errOut += c));
		child.on('error', reject);
		child.on('close', (code) =>
			code === 0 ? resolve(JSON.parse(out.trim().split('\n').pop())) : reject(new Error(`child exited ${code}: ${errOut}`)),
		);
	});
}

const MAKERS = [
	['compose_scene', { prompt: 'a lantern-lit fishing cove' }],
	['build_world', { prompt: 'a lantern-lit fishing cove' }],
	['export_scene', { diorama: { title: 'Lantern Cove', objects: [] } }],
];

for (const [name, args] of MAKERS) {
	test(`${name} sends THREE_WS_API_KEY as a bearer`, async () => {
		seen.length = 0;
		const res = await runTool('sk_good', name, args);
		assert.equal(res.ok, true, res.message);
		assert.equal(seen.length, 1);
		assert.equal(seen[0].authorization, 'Bearer sk_good');
	});

	test(`${name} without a key says how to get one and sends nothing`, async () => {
		seen.length = 0;
		const res = await runTool(undefined, name, args);
		assert.equal(res.ok, false);
		assert.equal(res.code, 'sign_in_required');
		assert.equal(res.status, 401);
		assert.match(res.message, /THREE_WS_API_KEY/);
		assert.match(res.message, /dashboard\/api-keys/);
		assert.deepEqual(seen, []);
	});
}

test('a refused key is named as refused', async () => {
	const res = await runTool('sk_revoked', 'compose_scene', { prompt: 'a lantern-lit fishing cove' });
	assert.equal(res.code, 'sign_in_required');
	assert.equal(res.status, 401);
	assert.match(res.message, /refused THREE_WS_API_KEY/);
});

test('the public reads need no key and never send one', async () => {
	seen.length = 0;
	const res = await runTool('sk_good', 'list_scenes', {});
	assert.equal(res.ok, true, res.message);
	const none = await runTool(undefined, 'list_scenes', {});
	assert.equal(none.ok, true, none.message);
	assert.equal(seen.length, 2);
	for (const r of seen) assert.equal(r.authorization, null);
});

// Making a model on three.ws needs an account: POST /api/forge answers 401
// `sign_in_required` to an anonymous caller. The forge bridge must send
// THREE_WS_API_KEY as a bearer on every three.ws API call (submit and poll),
// refuse before any request when no key is set, and never send the key to the
// CDN that serves the finished GLB.
//
// Each case runs in its own child process with its own env, because config.js
// reads env once at import. A local HTTP server stands in for three.ws; nothing
// reaches the network.
//
// Run: node --test packages/blender-mcp/test/forge-generate-auth.test.mjs

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';

const seen = [];
let server;
let base;

before(async () => {
	server = http.createServer((req, res) => {
		let body = '';
		req.on('data', (c) => (body += c));
		req.on('end', () => {
			seen.push({ method: req.method, url: req.url, authorization: req.headers.authorization || null });
			const send = (status, payload) => {
				res.writeHead(status, { 'content-type': 'application/json' });
				res.end(JSON.stringify(payload));
			};
			if (req.url.startsWith('/api/forge')) {
				if (!req.headers.authorization) {
					return send(401, { error: 'sign_in_required', message: 'Sign in to make a model.', api_keys_url: '/dashboard/api-keys' });
				}
				if (req.headers.authorization !== 'Bearer sk_good') {
					return send(401, { error: 'invalid_api_key', message: 'Invalid API key.' });
				}
				if (req.method === 'POST') return send(202, { job_id: 'job1', status: 'queued', backend: 'stand-in' });
				return send(200, { status: 'done', glb_url: `${base}/cdn/box.glb`, backend: 'stand-in' });
			}
			if (req.url === '/cdn/box.glb') {
				res.writeHead(200, { 'content-type': 'model/gltf-binary' });
				return res.end(Buffer.from('glTF'));
			}
			res.writeHead(404);
			res.end();
		});
	});
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
	await new Promise((r) => server.close(r));
});

const FORGE = new URL('../src/lib/forge.js', import.meta.url).href;

// Submit, poll and download in a child process so config.js reads this case's
// env. Async spawn keeps this process's event loop free to serve the stand-in.
function generate(apiKey, kind) {
	const env = { ...process.env, THREE_WS_BASE: base };
	if (apiKey === undefined) delete env.THREE_WS_API_KEY;
	else env.THREE_WS_API_KEY = apiKey;
	const script = `
		const forge = await import(${JSON.stringify(FORGE)});
		const os = await import('node:os');
		const path = await import('node:path');
		try {
			const job = ${JSON.stringify(kind)} === 'image'
				? await forge.submitImageTo3d({ imageUrls: ['https://cdn.example/ref.png'] })
				: await forge.submitTextTo3d({ prompt: 'a brass lantern' });
			const done = await forge.waitForGlb(job.job_id, { timeoutMs: 5000 });
			await forge.downloadGlb(done.glb_url, path.join(os.tmpdir(), 'blender-mcp-auth-' + process.pid + '.glb'));
			console.log(JSON.stringify({ ok: true, job: job.job_id }));
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
			code === 0 ? resolve(JSON.parse(out.trim())) : reject(new Error(`child exited ${code}: ${errOut}`)),
		);
	});
}

for (const kind of ['text', 'image']) {
	test(`${kind}-to-3D sends THREE_WS_API_KEY on submit and poll, never to the CDN`, async () => {
		seen.length = 0;
		const out = await generate('sk_good', kind);
		assert.equal(out.ok, true, out.message);
		const api = seen.filter((r) => r.url.startsWith('/api/'));
		assert.ok(api.some((r) => r.method === 'POST') && api.some((r) => r.method === 'GET'));
		for (const r of api) assert.equal(r.authorization, 'Bearer sk_good', r.url);
		assert.equal(seen.find((r) => r.url === '/cdn/box.glb').authorization, null);
	});

	test(`${kind}-to-3D without a key says how to get one and sends nothing`, async () => {
		seen.length = 0;
		const err = await generate(undefined, kind);
		assert.equal(err.ok, false);
		assert.equal(err.code, 'sign_in_required');
		assert.equal(err.status, 401);
		assert.match(err.message, /THREE_WS_API_KEY/);
		assert.match(err.message, /dashboard\/api-keys/);
		assert.deepEqual(seen, [], 'no request leaves without a key');
	});
}

test('a refused key on generation says the key was refused', async () => {
	const err = await generate('sk_revoked', 'text');
	assert.equal(err.code, 'sign_in_required');
	assert.equal(err.status, 401);
	assert.match(err.message, /refused THREE_WS_API_KEY/);
});

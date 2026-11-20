// Uploading a local reference image needs a three.ws account (api/forge-upload.js
// answers 401 `sign_in_required` without one). The forge bridge must send
// THREE_WS_API_KEY as a bearer on that call, and turn a refusal into an answer
// that says how to get a key and how to go keyless (a public image_url).
//
// Each case runs in its own child process with its own env, because config.js
// reads env once at import. A local HTTP server stands in for three.ws; nothing
// reaches the network.
//
// Run: node --test packages/blender-mcp/test/forge-upload-auth.test.mjs

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const seen = [];
let server;
let base;
let dir;
let png;

before(async () => {
	server = http.createServer((req, res) => {
		let body = '';
		req.on('data', (c) => (body += c));
		req.on('end', () => {
			seen.push({ method: req.method, url: req.url, authorization: req.headers.authorization || null });
			if (req.method === 'POST' && req.url === '/api/forge-upload') {
				if (req.headers.authorization !== 'Bearer sk_good') {
					res.writeHead(401, { 'content-type': 'application/json' });
					return res.end(JSON.stringify({ error: 'sign_in_required', message: 'Sign in to upload a photo.' }));
				}
				res.writeHead(200, { 'content-type': 'application/json' });
				return res.end(
					JSON.stringify({
						upload_url: `${base}/_put/a.png`,
						public_url: 'https://cdn.example/forge/uploads/x/a.png',
						method: 'PUT',
						headers: { 'content-type': 'image/png' },
					}),
				);
			}
			if (req.method === 'PUT' && req.url === '/_put/a.png') {
				res.writeHead(200);
				return res.end();
			}
			res.writeHead(404);
			res.end();
		});
	});
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	base = `http://127.0.0.1:${server.address().port}`;
	dir = await mkdtemp(path.join(os.tmpdir(), 'blender-mcp-upload-'));
	png = path.join(dir, 'ref.png');
	await writeFile(png, Buffer.from('\x89PNG test bytes', 'binary'));
});

after(async () => {
	await new Promise((r) => server.close(r));
	await rm(dir, { recursive: true, force: true });
});

const FORGE = new URL('../src/lib/forge.js', import.meta.url).href;

// Run uploadReferenceImage in a child process so config.js reads this case's
// env. Async spawn keeps this process's event loop free to serve the stand-in.
function upload(apiKey) {
	const env = { ...process.env, THREE_WS_BASE: base };
	if (apiKey === undefined) delete env.THREE_WS_API_KEY;
	else env.THREE_WS_API_KEY = apiKey;
	const script = `
		const { uploadReferenceImage } = await import(${JSON.stringify(FORGE)});
		try {
			const out = await uploadReferenceImage(process.argv[1]);
			console.log(JSON.stringify({ ok: true, url: out.url }));
		} catch (err) {
			console.log(JSON.stringify({ ok: false, code: err.code, status: err.status, message: err.message }));
		}`;
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, ['--input-type=module', '-e', script, png], { env });
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

test('sends THREE_WS_API_KEY as a bearer and returns the public URL', async () => {
	seen.length = 0;
	const out = await upload('sk_good');
	assert.equal(out.ok, true, out.message);
	assert.equal(out.url, 'https://cdn.example/forge/uploads/x/a.png');
	const presign = seen.find((r) => r.url === '/api/forge-upload');
	assert.equal(presign.authorization, 'Bearer sk_good');
	// The key goes to three.ws only, never to the storage PUT.
	const put = seen.find((r) => r.method === 'PUT');
	assert.equal(put.authorization, null);
});

test('without a key, explains how to get one and the keyless route', async () => {
	seen.length = 0;
	const err = await upload(undefined);
	assert.equal(err.ok, false);
	assert.equal(err.code, 'sign_in_required');
	assert.equal(err.status, 401);
	assert.match(err.message, /THREE_WS_API_KEY/);
	assert.match(err.message, /dashboard\/api-keys/);
	assert.match(err.message, /image_url/);
	assert.equal(seen.find((r) => r.url === '/api/forge-upload').authorization, null);
	assert.ok(!seen.some((r) => r.method === 'PUT'), 'nothing is uploaded without a key');
});

test('a refused key says the key was refused', async () => {
	const err = await upload('sk_revoked');
	assert.equal(err.code, 'sign_in_required');
	assert.match(err.message, /refused THREE_WS_API_KEY/);
});

// The studio client: how a tools/call answer becomes a model, and how the
// transport reports the ways a call can fail.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { describeStatus, readModelResult, readToolResult, textOf, normalizeOrigin, rpc, callTool, TOOLS } from '../src/studio.js';

test('a structured result yields the model', () => {
	const model = readModelResult({
		structuredContent: {
			kind: 'model',
			glbUrl: 'https://three.ws/cdn/creations/abc/mesh.glb',
			viewerUrl: 'https://three.ws/viewer?src=x',
			format: 'glb',
			prompt: 'a frog',
		},
	});
	assert.equal(model.glbUrl, 'https://three.ws/cdn/creations/abc/mesh.glb');
	assert.equal(model.prompt, 'a frog');
});

test('a snake_case glb_url is accepted too', () => {
	assert.equal(
		readModelResult({ structuredContent: { glb_url: 'https://x/y.glb' } }).glbUrl,
		'https://x/y.glb',
	);
});

test('an error result surfaces what the studio said', () => {
	assert.throws(
		() => readModelResult({ isError: true, content: [{ type: 'text', text: 'lane is busy' }] }),
		/lane is busy/,
	);
});

test('a result with no model is a failure, not an empty viewer', () => {
	assert.throws(() => readModelResult({ content: [] }), /no model URL/);
	assert.throws(() => readModelResult(null), /empty response/);
});

test('a non-http URL is refused rather than opened', () => {
	assert.throws(() => readModelResult({ structuredContent: { glbUrl: 'file:///etc/passwd' } }), /no model URL/);
});

test('text blocks are joined and capped', () => {
	assert.equal(textOf({ content: [{ text: ' one ' }, { text: 'two' }] }), 'one\ntwo');
	assert.equal(textOf({}), '');
});

test('the origin must be an http(s) origin', () => {
	assert.equal(normalizeOrigin('https://three.ws/'), 'https://three.ws');
	assert.throws(() => normalizeOrigin('three.ws'), /must be an http\(s\) origin/);
});

test('a JSON-RPC error is reported with its message', async () => {
	const server = createServer((req, res) => {
		res.writeHead(200, { 'content-type': 'application/json' });
		res.end(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'prompt too short' } }));
	});
	await new Promise((r) => server.listen(0, r));
	const origin = `http://127.0.0.1:${server.address().port}`;
	await assert.rejects(() => rpc(origin, { jsonrpc: '2.0', id: 1, method: 'tools/list' }), /prompt too short/);
	server.close();
});

test('a non-JSON body is reported with its status', async () => {
	const server = createServer((req, res) => {
		res.writeHead(502, { 'content-type': 'text/html' });
		res.end('<html>bad gateway</html>');
	});
	await new Promise((r) => server.listen(0, r));
	const origin = `http://127.0.0.1:${server.address().port}`;
	await assert.rejects(() => rpc(origin, { jsonrpc: '2.0', id: 1, method: 'tools/list' }), /502 with a non-JSON body/);
	server.close();
});

test('callTool posts a tools/call for the named tool', async () => {
	let seen = null;
	const server = createServer((req, res) => {
		let body = '';
		req.on('data', (c) => (body += c));
		req.on('end', () => {
			seen = JSON.parse(body);
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end(
				JSON.stringify({
					jsonrpc: '2.0',
					id: seen.id,
					result: { structuredContent: { glbUrl: 'https://x/y.glb' } },
				}),
			);
		});
	});
	await new Promise((r) => server.listen(0, r));
	const origin = `http://127.0.0.1:${server.address().port}`;
	const model = await callTool(origin, TOOLS.model, { prompt: 'a frog', tier: 'draft' });
	assert.equal(model.glbUrl, 'https://x/y.glb');
	assert.equal(seen.method, 'tools/call');
	assert.equal(seen.params.name, 'forge_free');
	assert.deepEqual(seen.params.arguments, { prompt: 'a frog', tier: 'draft' });
	server.close();
});

test('a timeout is reported as a timeout', async () => {
	const server = createServer(() => {});
	await new Promise((r) => server.listen(0, r));
	const origin = `http://127.0.0.1:${server.address().port}`;
	await assert.rejects(
		() => rpc(origin, { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { timeoutMs: 60 }),
		/did not answer within/,
	);
	server.close();
});

/** A studio that answers the first call pending and finishes the job on a later check_job. */
function pendingStudio(script) {
	const calls = [];
	const server = createServer((req, res) => {
		let body = '';
		req.on('data', (c) => (body += c));
		req.on('end', () => {
			const rpcBody = JSON.parse(body);
			calls.push(rpcBody.params);
			const result = script(rpcBody.params, calls.length);
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end(JSON.stringify({ jsonrpc: '2.0', id: rpcBody.id, result }));
		});
	});
	return { server, calls };
}

const PENDING = {
	content: [{ type: 'text', text: 'The model is still rendering (roughly 40s to go).' }],
	structuredContent: { status: 'pending', jobId: 'f1.job-abc', job_id: 'f1.job-abc', stage: 'mesh', etaRemainingSeconds: 40, viewer_url: 'https://three.ws/viewer?job=f1.job-abc' },
};

test('callTool collects a pending generation through check_job instead of failing', async () => {
	const { server, calls } = pendingStudio((params, n) => {
		if (n === 1) return PENDING;
		if (n === 2) return { ...PENDING, structuredContent: { ...PENDING.structuredContent, etaRemainingSeconds: 12 } };
		return { structuredContent: { glbUrl: 'https://three.ws/cdn/forge/anon/done.glb', prompt: 'a lantern' } };
	});
	await new Promise((r) => server.listen(0, r));
	const origin = `http://127.0.0.1:${server.address().port}`;
	const statuses = [];
	const model = await callTool(origin, TOOLS.model, { prompt: 'a lantern' }, { pollMs: 5, onStatus: (s) => statuses.push(s) });
	server.close();
	assert.equal(model.glbUrl, 'https://three.ws/cdn/forge/anon/done.glb');
	assert.equal(calls[0].name, 'forge_free');
	assert.deepEqual(calls[1], { name: 'check_job', arguments: { job_id: 'f1.job-abc' } });
	assert.equal(calls.length, 3);
	assert.ok(statuses.some((s) => /40s/.test(s.message)), JSON.stringify(statuses));
	assert.ok(statuses.every((s) => s.jobId === 'f1.job-abc'));
});

test('a check that failed while the job is fine is retried; a failed job is reported', async () => {
	const { server } = pendingStudio((params, n) => {
		if (n === 1) return PENDING;
		if (n === 2) return { isError: true, content: [{ type: 'text', text: 'status check timed out' }], structuredContent: { error: true, retryable: true, retry_after: 1 } };
		if (n === 3) return { structuredContent: { glbUrl: 'https://x/ok.glb' } };
		return null;
	});
	await new Promise((r) => server.listen(0, r));
	const origin = `http://127.0.0.1:${server.address().port}`;
	const model = await callTool(origin, TOOLS.model, { prompt: 'a lantern' }, { pollMs: 5 });
	assert.equal(model.glbUrl, 'https://x/ok.glb');
	server.close();

	const failing = pendingStudio((params, n) =>
		n === 1 ? PENDING : { isError: true, content: [{ type: 'text', text: 'The generation failed on every engine.' }], structuredContent: { error: true, status: 'failed' } },
	);
	await new Promise((r) => failing.server.listen(0, r));
	const origin2 = `http://127.0.0.1:${failing.server.address().port}`;
	await assert.rejects(() => callTool(origin2, TOOLS.model, { prompt: 'x y z' }, { pollMs: 5 }), /failed on every engine/);
	failing.server.close();
});

test('readToolResult tells a pending handle from a model', () => {
	assert.deepEqual(readToolResult(PENDING), {
		pending: true,
		jobId: 'f1.job-abc',
		stage: 'mesh',
		next: null,
		etaSeconds: 40,
		watchUrl: 'https://three.ws/viewer?job=f1.job-abc',
		message: 'The model is still rendering (roughly 40s to go).',
	});
	assert.equal(readToolResult({ structuredContent: { glbUrl: 'https://x/y.glb' } }).glbUrl, 'https://x/y.glb');
});

test('describeStatus speaks in the studio facts and never invents a number', () => {
	assert.equal(describeStatus({ stage: 'mesh', etaSeconds: 40 }), 'rendering the mesh, about 40s to go');
	assert.equal(describeStatus({ stage: 'rig', etaSeconds: null }), 'rigging the mesh (heavier models take a few minutes)');
	assert.match(describeStatus({ message: 'The GPU worker for this model is waking up (about 30s of boot left).' }), /waking up/);
});

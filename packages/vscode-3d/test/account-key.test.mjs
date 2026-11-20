// Making, rigging, refining or animating a model on three.ws needs a free
// account: the studio's creator tools answer an anonymous call with a
// sign_in_required result, and /api/forge-motion answers 401. The extension
// sends the stored API key as a bearer on every studio and motion call,
// refuses a creator call before any request when no key is stored, and keeps
// the reads (check_job, the catalog) working without one. The studio MCP
// server it hands to Copilot carries the same credential.

import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { TOOLS, callTool, rpc, toolCall, readModelResult, setApiKeyProvider, SignInRequiredError } from '../src/studio.js';
import { generateMotion } from '../src/animations.js';
import { serverList } from '../src/mcp-servers.js';

afterEach(() => setApiKeyProvider(null));

async function serve(handler) {
	const seen = [];
	const server = createServer((req, res) => {
		let body = '';
		req.on('data', (c) => (body += c));
		req.on('end', () => {
			seen.push({ method: req.method, url: req.url, authorization: req.headers.authorization || null, body });
			handler(req, res, body);
		});
	});
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	const origin = `http://127.0.0.1:${server.address().port}`;
	return { origin, seen, close: () => new Promise((r) => server.close(r)) };
}

const modelReply = (req, res, body) => {
	res.writeHead(200, { 'content-type': 'application/json' });
	res.end(JSON.stringify({ jsonrpc: '2.0', id: JSON.parse(body).id, result: { structuredContent: { glbUrl: 'https://cdn.example/m.glb' } } }));
};

test('a creator tool carries the stored key as a bearer', async () => {
	setApiKeyProvider(async () => 'sk_test_synthetic123');
	const { origin, seen, close } = await serve(modelReply);
	try {
		const model = await callTool(origin, TOOLS.model, { prompt: 'a brass lantern' });
		assert.equal(model.glbUrl, 'https://cdn.example/m.glb');
		assert.equal(seen[0].authorization, 'Bearer sk_test_synthetic123');
	} finally {
		await close();
	}
});

for (const name of [TOOLS.model, TOOLS.avatar, TOOLS.rig, TOOLS.refine]) {
	test(`${name} without a stored key refuses before any request and says how to connect`, async () => {
		const { origin, seen, close } = await serve(modelReply);
		try {
			await assert.rejects(
				() => callTool(origin, name, { prompt: 'a brass lantern' }),
				(err) => {
					assert.ok(err instanceof SignInRequiredError);
					assert.equal(err.code, 'sign_in_required');
					assert.match(err.message, /free three\.ws account/);
					assert.match(err.message, /\/dashboard\/api-keys/);
					return true;
				},
			);
			assert.equal(seen.length, 0);
		} finally {
			await close();
		}
	});
}

test('check_job and the catalog need no key', async () => {
	const { origin, seen, close } = await serve((req, res, body) => {
		res.writeHead(200, { 'content-type': 'application/json' });
		res.end(JSON.stringify({ jsonrpc: '2.0', id: JSON.parse(body).id, result: { content: [] } }));
	});
	try {
		await rpc(origin, toolCall(TOOLS.check, { job_id: 'j1' }));
		await rpc(origin, toolCall('search_catalog', { query: 'chair' }));
		assert.equal(seen.length, 2);
		for (const r of seen) assert.equal(r.authorization, null);
	} finally {
		await close();
	}
});

test('a sign-in result from the studio becomes SignInRequiredError', () => {
	const result = {
		isError: true,
		content: [{ type: 'text', text: 'Sign in to make a 3D model. A three.ws account is free.' }],
		structuredContent: { error: true, status: 'sign_in_required', api_keys_url: 'https://three.ws/dashboard/api-keys' },
	};
	assert.throws(() => readModelResult(result), (err) => err instanceof SignInRequiredError && /Sign in to make a 3D model/.test(err.message));
});

test('a key the studio refuses (HTTP 401) is named as refused', async () => {
	setApiKeyProvider(async () => 'sk_live_revoked12345');
	const { origin, close } = await serve((req, res) => {
		res.writeHead(401, { 'content-type': 'application/json' });
		res.end(JSON.stringify({ error: 'invalid_api_key', message: 'Invalid API key.' }));
	});
	try {
		await assert.rejects(() => callTool(origin, TOOLS.model, { prompt: 'a brass lantern' }), (err) => err instanceof SignInRequiredError && /refused/.test(err.message));
	} finally {
		await close();
	}
});

test('a text-described motion carries the key and refuses without one', async () => {
	const { origin, seen, close } = await serve((req, res) => {
		res.setHeader('content-type', 'application/json');
		if (req.method === 'POST') return res.end(JSON.stringify({ job_id: 'job-1', status: 'queued' }));
		if (req.url.startsWith('/api/forge-motion?job=')) return res.end(JSON.stringify({ status: 'done', clip_url: `${origin}/clip.json` }));
		res.end(JSON.stringify({ name: 'mx-wave', duration: 1, tracks: [{ name: 'Hips.quaternion', type: 'quaternion', times: [0], values: [0, 0, 0, 1] }] }));
	});
	try {
		await assert.rejects(() => generateMotion(origin, 'wave', { pollMs: 5 }), SignInRequiredError);
		assert.equal(seen.length, 0);
		setApiKeyProvider(async () => 'sk_test_synthetic123');
		await generateMotion(origin, 'wave', { pollMs: 5 });
		const motion = seen.filter((r) => r.url.startsWith('/api/forge-motion'));
		assert.ok(motion.length >= 2);
		for (const r of motion) assert.equal(r.authorization, 'Bearer sk_test_synthetic123');
		assert.equal(seen.find((r) => r.url === '/clip.json').authorization, null, 'the clip file never gets the key');
	} finally {
		await close();
	}
});

test('the studio MCP server Copilot gets carries the account credential', () => {
	const keyed = serverList({ origin: 'https://three.ws', account: { mode: 'key', key: 'sk_live_abcdefgh123' } });
	assert.deepEqual(keyed[0].headers, { Authorization: 'Bearer sk_live_abcdefgh123' });
	const oauth = serverList({ origin: 'https://three.ws', account: { mode: 'oauth' } });
	assert.equal(oauth[0].uri, 'https://three.ws/api/mcp-studio?auth=oauth', 'OAuth mode asks the studio to challenge, so VS Code runs sign-in');
	const anon = serverList({ origin: 'https://three.ws', account: null });
	assert.equal(anon[0].uri, 'https://three.ws/api/mcp-studio');
	assert.deepEqual(anon[0].headers, {});
});

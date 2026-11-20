import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, test } from 'node:test';
import { createApp } from '../server.mjs';
import { loadConfig } from '../lib/config.mjs';
import { readSSE } from '../shared/sse.js';
import { TEST_KEYS, capturedResult, fakeUpstreams, fixture, jsonResponse, testConfig } from './helpers.mjs';

const servers = [];
after(() => Promise.all(servers.map((s) => new Promise((r) => s.close(r)))));

async function start(options) {
	const server = await createApp({ log: () => {}, ...options });
	servers.push(server);
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	return `http://127.0.0.1:${server.address().port}`;
}

const noUpstream = async (url) => {
	throw new Error(`no upstream call expected, got ${url}`);
};

async function events(res) {
	const out = [];
	for await (const evt of readSSE(res.body)) out.push([evt.event, JSON.parse(evt.data)]);
	return out;
}

test('with no keys: status names both keys and where to get them, and chat answers 503 setup_required', async () => {
	const base = await start({ config: loadConfig({}), fetchImpl: noUpstream });
	const status = await (await fetch(`${base}/api/status`)).json();
	assert.equal(status.ready, false);
	assert.equal(status.model, 'grok-4.7');
	assert.deepEqual(status.missing.map((m) => m.name), ['XAI_API_KEY', 'THREE_WS_API_KEY']);
	assert.equal(status.keyHelp.THREE_WS_API_KEY.url, 'https://three.ws/dashboard/api-keys');

	const chat = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"message":"hi"}' });
	assert.equal(chat.status, 503);
	assert.equal((await chat.json()).error.code, 'setup_required');
});

test('the page is served with a CSP that allows exactly its import map by hash', async () => {
	const base = await start({ config: loadConfig({}), fetchImpl: noUpstream });
	const res = await fetch(`${base}/`);
	assert.equal(res.status, 200);
	const html = await res.text();
	const map = html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1];
	const hash = createHash('sha256').update(map).digest('base64');
	const csp = res.headers.get('content-security-policy');
	assert.ok(csp.includes(`'sha256-${hash}'`));
	assert.doesNotMatch(csp, /unsafe-inline/);
	assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
	assert.equal(readFileSync(new URL('../public/index.html', import.meta.url), 'utf8'), html);
});

test('static files: three.js and the shared parser are served, nothing outside the mounts is', async () => {
	const base = await start({ config: loadConfig({}), fetchImpl: noUpstream });
	assert.equal((await fetch(`${base}/vendor/three/build/three.module.js`, { method: 'HEAD' })).status, 200);
	assert.equal((await fetch(`${base}/vendor/three/examples/jsm/loaders/GLTFLoader.js`, { method: 'HEAD' })).status, 200);
	assert.equal((await fetch(`${base}/shared/sse.js`)).status, 200);
	for (const path of ['/%2e%2e/server.mjs', '/..%2fserver.mjs', '/vendor/three/build/..%2f..%2fpackage.json', '/shared/..%2flib/config.mjs', '/.env', '/%00', '/nope.js']) {
		assert.equal((await fetch(`${base}${path}`)).status, 404, path);
	}
	assert.equal((await fetch(`${base}/`, { method: 'DELETE' })).status, 405);
	assert.equal((await fetch(`${base}/api/chat`)).status, 405);
	assert.equal((await fetch(`${base}/api/unknown`)).status, 404);
	assert.deepEqual(await (await fetch(`${base}/healthz`)).json(), { ok: true });
});

test('status checks each key with its cheapest call and never echoes a key back', async () => {
	const config = testConfig();
	const seen = [];
	const fetchImpl = async (url, init) => {
		seen.push({ url: String(url), auth: init.headers.authorization });
		if (String(url) === 'https://api.x.ai/v1/api-key') return jsonResponse(fixture('xai/401-no-key.json').response, 401);
		return jsonResponse({ jsonrpc: '2.0', id: JSON.parse(init.body).id, result: { tools: [{ name: 'forge_free' }] } });
	};
	const base = await start({ config, fetchImpl });
	const text = await (await fetch(`${base}/api/status`)).text();
	const status = JSON.parse(text);
	assert.equal(status.ready, false);
	assert.equal(status.problem.code, 'xai_unauthorized');
	assert.equal(status.checks.threeWs.ok, true);
	assert.ok(!text.includes(TEST_KEYS.XAI_API_KEY) && !text.includes(TEST_KEYS.THREE_WS_API_KEY));
	assert.deepEqual(seen.map((s) => s.auth).sort(), [`Bearer ${TEST_KEYS.THREE_WS_API_KEY}`, `Bearer ${TEST_KEYS.XAI_API_KEY}`].sort());

	await fetch(`${base}/api/status`);
	assert.equal(seen.length, 2, 'results are cached');
	await fetch(`${base}/api/status?refresh=1`);
	assert.equal(seen.length, 4, 'refresh=1 checks again');
});

test('an outage only warns: the chat stays usable', async () => {
	const fetchImpl = async (url) => {
		if (String(url).includes('x.ai')) return new Response('bad gateway', { status: 502 });
		throw new TypeError('fetch failed');
	};
	const base = await start({ config: testConfig(), fetchImpl });
	const status = await (await fetch(`${base}/api/status`)).json();
	assert.equal(status.ready, true);
	assert.equal(status.problem, null);
	assert.ok(['xai_unavailable', 'three_ws_unavailable'].includes(status.warning.code));
});

test('a chat turn streams Grok\'s tool calls, the render and the model as server-sent events', async () => {
	const config = testConfig();
	const { rounds } = fixture('xai/responses-stream-forge.json');
	const rpc = (path) => ({ jsonrpc: '2.0', result: capturedResult(path) });
	const up = fakeUpstreams({ config, xaiRounds: rounds, mcpAnswers: [rpc('three-ws/robot-get-job-done.json')] });
	const base = await start({ config, fetchImpl: up.fetchImpl });
	// The captured job carries no usable estimate here, so followJob waits its
	// 3 second minimum before the first get_job poll: this test takes about 3s.
	const res = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'A friendly round robot mascot in glossy white plastic' }) });
	assert.equal(res.status, 200);
	assert.match(res.headers.get('content-type'), /^text\/event-stream/);
	const got = await events(res);
	const names = got.map(([n]) => n);
	assert.deepEqual([names[0], names.at(-1)], ['round', 'done']);
	assert.ok(names.includes('tool') && names.includes('job') && names.includes('model'));
	assert.equal(got.find(([n]) => n === 'model')[1].glbUrl, 'https://three.ws/cdn/forge/anon/e0fb27ab-1064-4237-bf6a-53fa58a83349.glb');
	assert.equal(got.at(-1)[1].responseId, 'resp_doc_round2');
	assert.match(up.requests[0].body.safety_identifier, /^[0-9a-f]{32}$/);
});

test('a turn that fails upstream ends its stream with one mapped error event', async () => {
	const config = testConfig();
	const up = fakeUpstreams({ config, xaiRounds: [jsonResponse(fixture('xai/401-no-key.json').response, 401)] });
	const base = await start({ config, fetchImpl: up.fetchImpl });
	const res = await fetch(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"message":"a lamp"}' });
	const got = await events(res);
	assert.deepEqual(got.map(([n]) => n), ['round', 'error']);
	assert.equal(got[1][1].code, 'xai_unauthorized');
});

test('bad input answers 400 and the per-address rate limit answers 429 with Retry-After', async () => {
	const config = testConfig({ RATE_LIMIT_PER_MINUTE: '2' });
	const base = await start({ config, fetchImpl: noUpstream });
	const post = (body) => fetch(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
	const bad = await post('{"message":""}');
	assert.equal(bad.status, 400);
	assert.equal((await bad.json()).error.code, 'bad_input');
	assert.equal((await post('not json')).status, 400);
	const limited = await post('{"message":"third"}');
	assert.equal(limited.status, 429);
	assert.ok(Number(limited.headers.get('retry-after')) > 0);
	assert.equal((await limited.json()).error.code, 'rate_limited');
});

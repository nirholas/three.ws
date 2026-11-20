import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createForge, ThreeWsError } from '../src/index.js';

// Making or rigging a model on three.ws needs an account: POST /api/forge
// answers 401 `sign_in_required` to an anonymous caller. The SDK sends the
// account's API key (the `apiKey` option, else THREE_WS_API_KEY) as a bearer on
// submit and poll, refuses before any request when there is none, and leaves
// the x402 pay-per-call lane keyless (a wallet payment is the credential there).

function stubFetch(responses) {
	const calls = [];
	const queue = [...responses];
	const fetch = async (url, init) => {
		calls.push({ url: new URL(url), init });
		const next = queue.shift();
		if (!next) throw new Error('stubFetch: no more queued responses');
		const { status = 200, body = {} } = next;
		return {
			ok: status >= 200 && status < 300,
			status,
			headers: { get: () => null },
			text: async () => JSON.stringify(body),
		};
	};
	return { fetch, calls };
}

let savedKey;
beforeEach(() => {
	savedKey = process.env.THREE_WS_API_KEY;
	delete process.env.THREE_WS_API_KEY;
});
afterEach(() => {
	if (savedKey === undefined) delete process.env.THREE_WS_API_KEY;
	else process.env.THREE_WS_API_KEY = savedKey;
});

const isSignInRequired = (pattern) => (e) => {
	assert.ok(e instanceof ThreeWsError);
	assert.equal(e.code, 'sign_in_required');
	assert.equal(e.status, 401);
	assert.match(e.message, pattern);
	return true;
};

test('forge() sends the apiKey as a bearer on submit and every poll', async () => {
	const { fetch, calls } = stubFetch([
		{ body: { job_id: 'j1', status: 'queued' } },
		{ body: { job_id: 'j1', status: 'done', glb_url: 'https://three.ws/cdn/a.glb' } },
	]);
	const client = createForge({ fetch, apiKey: 'sk_test_synthetic' });
	await client.forge('a brass lantern', { pollIntervalMs: 1 });
	assert.equal(calls.length, 2);
	for (const c of calls) assert.equal(c.init.headers.authorization, 'Bearer sk_test_synthetic');
});

test('THREE_WS_API_KEY is the default key, so the bare exports work once it is set', async () => {
	process.env.THREE_WS_API_KEY = 'sk_test_fromenv';
	const { fetch, calls } = stubFetch([{ body: { status: 'done', glb_url: 'https://three.ws/cdn/a.glb' } }]);
	await createForge({ fetch }).forge('a brass lantern');
	assert.equal(calls[0].init.headers.authorization, 'Bearer sk_test_fromenv');
});

test('forge() without a key says how to get one and sends nothing', async () => {
	const { fetch, calls } = stubFetch([]);
	const client = createForge({ fetch, baseUrl: 'https://three.ws' });
	await assert.rejects(() => client.forge('a brass lantern'), isSignInRequired(/THREE_WS_API_KEY/));
	await assert.rejects(() => client.forge('a brass lantern'), isSignInRequired(/https:\/\/three\.ws\/dashboard\/api-keys/));
	assert.equal(calls.length, 0);
});

test('rig() without a key refuses before any request', async () => {
	const { fetch, calls } = stubFetch([]);
	await assert.rejects(() => createForge({ fetch }).rig('https://three.ws/cdn/raw.glb'), isSignInRequired(/account/));
	assert.equal(calls.length, 0);
});

// A server-side caller can bring its own credential header instead of an API
// key: a bearer it already holds, or the deployment's platform-job seed (the
// Agora citizen worker). The server judges that credential; the SDK must not
// refuse the call client-side just because `apiKey` is unset.
test('forge() and rig() send a caller-supplied credential header instead of refusing', async () => {
	const { fetch, calls } = stubFetch([
		{ body: { status: 'done', glb_url: 'https://three.ws/cdn/a.glb' } },
		{ body: { status: 'done', glb_url: 'https://three.ws/cdn/b.glb' } },
	]);
	const client = createForge({ fetch });
	await client.forge('a brass lantern', { headers: { 'x-forge-seed': 'synthetic-seed', 'x-forge-on-behalf': '1' } });
	await client.rig('https://three.ws/cdn/a.glb', { headers: { authorization: 'Bearer sk_test_held' } });
	assert.equal(calls.length, 2);
	assert.equal(calls[0].init.headers['x-forge-seed'], 'synthetic-seed');
	assert.equal(calls[1].init.headers.authorization, 'Bearer sk_test_held');
});

test('a key the server refuses is named as refused', async () => {
	const { fetch } = stubFetch([{ status: 401, body: { error: 'invalid_api_key', message: 'Invalid API key.' } }]);
	const client = createForge({ fetch, apiKey: 'sk_live_revoked' });
	await assert.rejects(() => client.forge('a brass lantern'), isSignInRequired(/refused/));
});

test('a server sign_in_required keeps its code and points at the keys page', async () => {
	const { fetch } = stubFetch([
		{ status: 401, body: { error: 'sign_in_required', message: 'Sign in to make a 3D model.', api_keys_url: '/dashboard/api-keys' } },
	]);
	const client = createForge({ fetch, apiKey: 'sk_live_whatever', baseUrl: 'https://three.ws' });
	await assert.rejects(() => client.forge('a brass lantern'), isSignInRequired(/dashboard\/api-keys/));
});

test('the x402 lane stays keyless: a wallet payment is its credential', async () => {
	const { fetch, calls } = stubFetch([{ body: { status: 'done', glb_url: 'https://three.ws/cdn/paid.glb' } }]);
	const res = await createForge({ fetch }).forge('a marble bust', { payWith: 'x402' });
	assert.equal(calls[0].url.pathname, '/api/x402/forge');
	assert.equal(calls[0].init.headers.authorization, undefined);
	assert.equal(res.glbUrl, 'https://three.ws/cdn/paid.glb');
});

test('reading the catalog and polling a job need no key', async () => {
	const { fetch, calls } = stubFetch([{ body: { tiers: [], backends: [], paths: [] } }, { body: { job_id: 'j2', status: 'running' } }]);
	const client = createForge({ fetch });
	await client.catalog();
	await client.getJob('j2');
	assert.equal(calls.length, 2);
});

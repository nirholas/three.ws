// scripts/grok-connector-review-check.mjs proves the Grok Bot marketplace
// reviewer path (OAuth discovery, sign-in page, signed-in tools/list, a catalog
// search, a free generation). These tests replay the production run recorded
// with --record through the same code, then break single answers to prove each
// step fails for the right reason instead of passing on a bad server.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

process.env.PUBLIC_APP_ORIGIN ||= 'https://three.ws';

const ROOT = path.resolve(import.meta.dirname, '..');
const FIXTURE = path.join(ROOT, 'tests/fixtures/grok-connector-review');
const recorded = JSON.parse(readFileSync(path.join(FIXTURE, 'exchanges.json'), 'utf8'));
const liveReport = JSON.parse(readFileSync(path.join(FIXTURE, 'report.json'), 'utf8'));

const {
	runReviewCheck,
	formatTable,
	parseRpc,
	challengeParam,
	rendersSignIn,
	fixtureSafe,
	recordingFetch,
	REQUIRED_TOOLS,
} = await import('../scripts/grok-connector-review-check.mjs');

// The PKCE challenge the recorded run sent, so the replayed redirect carries it.
const recordedChallenge = new URLSearchParams(
	new URL(
		recorded.find((e) => e.request.url === '/oauth/authorize').response.headers.location,
		'https://three.ws',
	).searchParams
		.get('next')
		.split('?')[1],
).get('code_challenge');

/** A fetch that answers from the recorded exchanges in order, checking each request matches. */
function replay(exchanges, { edit = () => null } = {}) {
	let i = 0;
	const seen = [];
	const fetchImpl = async (url, init = {}) => {
		const entry = exchanges[i];
		if (!entry) throw new Error(`unexpected extra request ${init.method ?? 'GET'} ${url}`);
		const method = init.method ?? 'GET';
		const pathname = new URL(url).pathname;
		expect(`${method} ${pathname}`).toBe(`${entry.request.method} ${entry.request.url}`);
		seen.push({ url, init });
		const override = edit(i, entry) ?? {};
		const status = override.status ?? entry.response.status;
		const headers = new Headers(override.headers ?? entry.response.headers);
		const body = override.body ?? entry.response.body;
		i++;
		return new Response(
			status === 204 || status === 304 || [101, 205].includes(status) || method === 'HEAD'
				? null
				: body,
			{ status, headers },
		);
	};
	return { fetchImpl, seen, consumed: () => i };
}

const options = (fetchImpl) => ({
	apiKey: 'tws_test_key',
	fetchImpl,
	makePkce: () => ({ challenge: recordedChallenge, verifier: 'v'.repeat(43) }),
	sleep: async () => {},
});

describe('grok-connector-review-check against the recorded production run', () => {
	it('passes every step and finishes with a downloadable GLB', async () => {
		const r = replay(recorded);
		const report = await runReviewCheck(options(r.fetchImpl));
		expect(report.rows.map((row) => [row.step, row.status, row.detail])).toEqual(
			report.rows.map((row) => [row.step, 'PASS', row.detail]),
		);
		expect(report.rows).toHaveLength(10);
		expect(report.glbUrl).toMatch(/^https:\/\/three\.ws\/cdn\/forge\/.+\.glb$/);
		expect(report.signedInToModelMs).toBeTypeOf('number');
		expect(r.consumed()).toBe(recorded.length);
	});

	it('matches what the live run reported, step by step', async () => {
		const report = await runReviewCheck(options(replay(recorded).fetchImpl));
		expect(report.rows.map((row) => row.step)).toEqual(liveReport.rows.map((row) => row.step));
		expect(liveReport.rows.every((row) => row.status === 'PASS')).toBe(true);
		expect(liveReport.signedInToModelMs).toBeGreaterThan(0);
	});

	it('retried the recorded check_job that answered retryable, as a client must', async () => {
		const retryable = recorded.filter((e) => e.response.body.includes('"retryable":true'));
		expect(retryable.length).toBeGreaterThan(0);
		const report = await runReviewCheck(options(replay(recorded).fetchImpl));
		expect(report.rows.at(-1).detail).toMatch(/retryable check/);
	});

	it('authenticates every signed-in call with the API key and carries the session', async () => {
		const r = replay(recorded);
		await runReviewCheck(options(r.fetchImpl));
		const signedIn = r.seen.filter(({ init }) => init.headers?.authorization);
		expect(signedIn.length).toBeGreaterThan(4);
		expect(
			signedIn.every(({ init }) => init.headers.authorization === 'Bearer tws_test_key'),
		).toBe(true);
		expect(
			signedIn
				.slice(1)
				.every(({ init }) => init.headers['mcp-session-id']?.startsWith('grk_')),
		).toBe(true);
	});
});

describe('each step fails on a broken server', () => {
	const at = (url, nth = 0) =>
		recorded.map((e, i) => (e.request.url === url ? i : -1)).filter((i) => i >= 0)[nth];
	const failingStep = async (edit) => {
		const report = await runReviewCheck(options(replay(recorded, { edit }).fetchImpl));
		return report.rows.find((row) => row.status === 'FAIL');
	};

	it('fails when the server lets an unauthenticated initialize through', async () => {
		const row = await failingStep((i) => (i === 0 ? { status: 200 } : null));
		expect(row.step).toMatch(/401/);
		expect(row.detail).toBe('expected 401, got 200');
	});

	it('fails when the 401 carries no resource_metadata', async () => {
		const row = await failingStep((i) =>
			i === 0 ? { headers: { 'www-authenticate': 'Bearer realm="three.ws"' } } : null,
		);
		expect(row.detail).toMatch(/no resource_metadata/);
	});

	it('fails when the protected resource names another server', async () => {
		const row = await failingStep((i, e) =>
			i === 1
				? {
						body: JSON.stringify({
							...JSON.parse(e.response.body),
							resource: 'https://three.ws/api/mcp',
						}),
					}
				: null,
		);
		expect(row.step).toMatch(/protected-resource/);
	});

	it('fails when PKCE S256 is not advertised', async () => {
		const row = await failingStep((i, e) =>
			i === 2
				? {
						body: JSON.stringify({
							...JSON.parse(e.response.body),
							code_challenge_methods_supported: ['plain'],
						}),
					}
				: null,
		);
		expect(row.detail).toBe('S256 is not advertised');
	});

	it('fails when the sign-in redirect drops the consent parameters', async () => {
		const row = await failingStep((i) =>
			i === at('/oauth/authorize') ? { headers: { location: '/login' } } : null,
		);
		expect(row.detail).toMatch(/drops the client_id/);
	});

	it('fails when the sign-in page renders without a form', async () => {
		const row = await failingStep((i) =>
			i === at('/login') ? { body: '<!doctype html><h1>Welcome back</h1>' } : null,
		);
		expect(row.detail).toMatch(/no form with email and password/);
	});

	it('fails when the token endpoint accepts a forged code', async () => {
		const row = await failingStep((i) =>
			i === at('/api/oauth/token') ? { status: 200, body: '{"access_token":"x"}' } : null,
		);
		expect(row.step).toMatch(/forged code/);
	});

	it('fails when tools/list carries a financial-tier tool', async () => {
		const list = recorded.findIndex((e) => e.response.body.includes('"tools":['));
		const row = await failingStep((i, e) => {
			if (i !== list) return null;
			const msg = parseRpc(e.response.body);
			msg.result.tools.push({ name: 'delete_agent' });
			return { body: JSON.stringify(msg) };
		});
		expect(row.detail).toBe('financial-tier tools listed: delete_agent');
	});

	it('fails when a required studio tool is missing', async () => {
		const list = recorded.findIndex((e) => e.response.body.includes('"tools":['));
		const row = await failingStep((i, e) => {
			if (i !== list) return null;
			const msg = parseRpc(e.response.body);
			msg.result.tools = msg.result.tools.filter((t) => t.name !== 'forge_free');
			return { body: JSON.stringify(msg) };
		});
		expect(row.detail).toBe('missing forge_free');
	});

	it('fails when the finished GLB cannot be downloaded', async () => {
		const row = await failingStep((i, e) =>
			e.request.method === 'HEAD' ? { status: 404 } : null,
		);
		expect(row.detail).toBe('the GLB answered 404');
	});

	it('fails a generation that ends in a non-retryable error', async () => {
		const firstPoll = recorded.findIndex(
			(e, i) => i > 10 && e.response.body.includes('"status":"pending"'),
		);
		const row = await failingStep((i) =>
			i === firstPoll + 1
				? {
						body: JSON.stringify({
							jsonrpc: '2.0',
							id: 1,
							result: {
								isError: true,
								content: [
									{ type: 'text', text: 'Generation failed for this prompt.' },
								],
								structuredContent: { status: 'failed' },
							},
						}),
					}
				: null,
		);
		expect(row.step).toMatch(/forge_free/);
		expect(row.detail).toMatch(/Generation failed/);
	});
});

describe('without an API key', () => {
	it('runs the OAuth discovery and skips only the signed-in steps', async () => {
		const discovery = recorded.slice(0, 7);
		const report = await runReviewCheck({
			...options(replay(discovery).fetchImpl),
			apiKey: null,
		});
		expect(report.rows.slice(0, 6).every((row) => row.status === 'PASS')).toBe(true);
		expect(report.rows.slice(6).map((row) => row.status)).toEqual([
			'SKIP',
			'SKIP',
			'SKIP',
			'SKIP',
		]);
	});
});

describe('helpers', () => {
	it('parses JSON and SSE JSON-RPC answers', () => {
		expect(parseRpc('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}').result.ok).toBe(true);
		expect(
			parseRpc('event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"ok":1}}\n\n').result
				.ok,
		).toBe(1);
	});

	it('reads one parameter from a Bearer challenge', () => {
		const h =
			'Bearer resource_metadata="https://three.ws/.well-known/oauth-protected-resource/api/mcp-grok", resource="https://three.ws/api/mcp-grok"';
		expect(challengeParam(h, 'resource')).toBe('https://three.ws/api/mcp-grok');
		expect(challengeParam(h, 'scope')).toBeNull();
	});

	it('recognises the recorded sign-in page as a sign-in form', () => {
		expect(rendersSignIn(recorded.find((e) => e.request.url === '/login').response.body)).toBe(
			true,
		);
		expect(rendersSignIn('<form><input type="text"></form>')).toBe(false);
	});

	it('keeps the fixture to studio tool names and redacts job handles', () => {
		const list = parseRpc(
			recorded.find((e) => e.response.body.includes('"tools":[')).response.body,
		);
		const names = list.result.tools.map((t) => t.name);
		for (const name of REQUIRED_TOOLS) expect(names).toContain(name);
		expect(list.result.tools.every((t) => Object.keys(t).join() === 'name')).toBe(true);
		expect(JSON.stringify(recorded)).not.toMatch(/f1\.[A-Za-z0-9_-]{20,}/);
		expect(JSON.stringify(recorded)).not.toMatch(
			/Bearer (?!<redacted>|[a-z_]+=\\")[A-Za-z0-9]/,
		);
		const trimmed = fixtureSafe(
			[
				{
					request: { url: '/api/mcp-grok' },
					response: {
						body: '{"result":{"tools":[{"name":"forge_free","description":"d"},{"name":"acct"}]}}',
					},
				},
			],
			(n) => n === 'acct',
		);
		expect(JSON.parse(trimmed[0].response.body).result.tools).toEqual([{ name: 'forge_free' }]);
	});

	it('records a challenge header intact and redacts bearer tokens', async () => {
		const log = [];
		const inner = async () =>
			new Response('{"token":"tws_secret_value","auth":"Bearer tws_secret_value"}', {
				status: 401,
				headers: {
					'www-authenticate':
						'Bearer resource_metadata="https://three.ws/x", resource="https://three.ws/y"',
				},
			});
		await recordingFetch(inner, log)('https://three.ws/api/mcp-grok', { method: 'POST' });
		expect(log[0].response.headers['www-authenticate']).toBe(
			'Bearer resource_metadata="https://three.ws/x", resource="https://three.ws/y"',
		);
		expect(log[0].response.body).not.toContain('tws_secret_value');
		expect(log[0].request).toEqual({ method: 'POST', url: '/api/mcp-grok' });
	});

	it('prints one table row per step', () => {
		const table = formatTable([
			{ step: 'a', status: 'PASS', ms: 5, detail: 'ok' },
			{ step: 'bb', status: 'FAIL', ms: 12, detail: 'no' },
		]);
		expect(table.split('\n')).toHaveLength(2);
		expect(table).toMatch(/2\. FAIL\s+bb\s+12 ms {2}no/);
	});
});

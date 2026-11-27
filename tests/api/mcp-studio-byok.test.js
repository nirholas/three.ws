/**
 * The 3D Studio MCP tools run the Meshy engine on the caller's own key. That key
 * is refused locally when it cannot be a real key, a provider failure on the
 * caller's account is reported as exactly what it is, and nothing falls to a
 * platform-paid engine in its place.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../api/_lib/rate-limit.js', () => ({
	limits: {
		mcp3dGenerate: async () => ({ success: true, limit: 60, remaining: 59, reset: Date.now() + 60_000 }),
		mcp3dStatus: async () => ({ success: true, limit: 60, remaining: 59, reset: Date.now() + 60_000 }),
	},
	clientIp: () => '203.0.113.9',
}));
vi.mock('../../api/_lib/db.js', () => ({
	sql: async () => [],
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
	isStoragePressured: async () => ({ pressured: false }),
}));
vi.mock('../../api/_lib/ssrf-guard.js', async (importOriginal) => ({
	...(await importOriginal()),
	assertSafePublicUrl: async (raw) => new URL(raw),
}));

const AUTH = { userId: null, rateKey: 'test-caller' };
const GOOD_KEY = 'msy_studio_test_key_000000000000';
const realFetch = globalThis.fetch;
let calls;

async function tool(name, args, headers) {
	const { toolDefs } = await import('../../api/_mcp3d/tools/studio.js');
	const def = toolDefs.find((t) => t.name === name);
	const req = { method: 'POST', url: '/', headers: { 'content-type': 'application/json', ...headers } };
	return def.handler(args, AUTH, req);
}

const imageArgs = { image_url: 'https://cdn.example.com/chair.png', backend: 'three-geometry' };

beforeEach(() => {
	process.env.JWT_SECRET = 'test-secret-test-secret-test-secret';
	calls = [];
});
afterEach(() => {
	globalThis.fetch = realFetch;
});

function stubFetch(respond) {
	globalThis.fetch = vi.fn(async (url, init) => {
		calls.push({ url: String(url), init });
		return respond(String(url), init);
	});
}

describe('studio MCP tools on a bring-your-own key', () => {
	it('refuses a malformed key before any network call and never repeats it', async () => {
		stubFetch(() => new Response('{}', { status: 200 }));
		const bad = 'not a key\r\nX-Evil: 1';
		const out = await tool('image_to_3d', imageArgs, { 'x-forge-provider-key': bad });
		expect(out.isError).toBe(true);
		expect(out.structuredContent.status).toBe('invalid_key');
		expect(JSON.stringify(out)).not.toContain('X-Evil');
		expect(calls).toHaveLength(0);
	});

	it('reports a provider that says the account is out of credits, with no platform call', async () => {
		stubFetch(() => new Response(JSON.stringify({ message: 'Insufficient credits' }), { status: 402 }));
		const out = await tool('image_to_3d', imageArgs, { 'x-forge-provider-key': GOOD_KEY });
		expect(out.isError).toBe(true);
		expect(out.structuredContent.error).toBe('insufficient_credits');
		expect(out.content[0].text).toMatch(/out of credits/i);
		expect(calls.every((c) => new URL(c.url).host === 'api.meshy.ai')).toBe(true);
	});

	it('reports a provider outage honestly and does not echo the key', async () => {
		stubFetch(() => new Response(`upstream said ${GOOD_KEY}`, { status: 503 }));
		const out = await tool('image_to_3d', imageArgs, { 'x-forge-provider-key': GOOD_KEY });
		expect(out.isError).toBe(true);
		expect(out.structuredContent.error).toBe('provider_unavailable');
		expect(JSON.stringify(out)).not.toContain(GOOD_KEY);
		expect(calls.every((c) => new URL(c.url).host === 'api.meshy.ai')).toBe(true);
	});

	it('tells a poll of a revoked key to check the key, in the provider account terms', async () => {
		stubFetch((url, init) => {
			if (init?.method === 'POST') {
				return new Response(JSON.stringify({ result: 'task-123' }), { status: 200 });
			}
			return new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 });
		});
		const started = await tool('image_to_3d', imageArgs, { 'x-forge-provider-key': GOOD_KEY });
		expect(started.isError).toBeFalsy();
		const jobId = started.structuredContent.job_id;
		const status = await tool('generation_status', { job_id: jobId }, { 'x-forge-provider-key': GOOD_KEY });
		expect(JSON.stringify(status)).not.toContain(GOOD_KEY);
		expect(JSON.stringify(status)).toMatch(/rejected your API key|invalid_key/i);
	});
});

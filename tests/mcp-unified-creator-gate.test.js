// The unified MCP server (/mcp) mounts the free studio's tools too, so the
// studio's "making a model needs an account" rule (api/_mcp/creator-gate.js)
// has to hold on this second door as well. An anonymous caller does not see the
// studio tools that create, rig or render a model, and calling one anyway gets
// an isError result carrying the Apps SDK sign-in challenge for the /mcp
// resource, with nothing sent to the forge. A signed-in caller runs the tool,
// and the forge submit names the account (x-forge-on-behalf-user) so the model
// is theirs. The studio's reads (job status) stay open.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

process.env.PUBLIC_APP_ORIGIN = 'https://three.ws';
process.env.CRON_SECRET = 'vitest-cron-secret-unified-creator-gate';

vi.mock('../api/_lib/auth.js', async (importOriginal) => ({
	...(await importOriginal()),
	extractBearer: () => null,
	authenticateBearer: vi.fn(async () => null),
	hasScope: () => true,
}));
vi.mock('../api/_lib/rate-limit.js', async (importOriginal) => {
	const real = await importOriginal();
	const pass = vi.fn(async () => ({ success: true, limit: 1, remaining: 1, reset: Date.now() + 1000 }));
	return {
		...real,
		limits: {
			...real.limits,
			mcpIp: pass,
			mcpUser: pass,
			studioGenBurst: vi.fn(pass),
			studioGenHourly: vi.fn(pass),
			studioGenPoolHourly: vi.fn(pass),
			studioGenerateGlobal: vi.fn(pass),
		},
		clientIp: vi.fn(() => '203.0.113.12'),
	};
});
vi.mock('../api/_lib/usage.js', async (importOriginal) => ({
	...(await importOriginal()),
	recordEvent: vi.fn(),
	logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}));

const { dispatch, unified } = await import('../api/_mcpall/server.js');
const { CREATOR_TOOL_NAMES } = await import('../api/_mcp-studio/dispatch.js');
const { limits } = await import('../api/_lib/rate-limit.js');

const anon = { userId: null, rateKey: null, scope: '', source: 'free' };
const signedIn = { userId: '9a8b7c6d-0000-4000-8000-0000000000aa', rateKey: null, scope: '', source: 'oauth' };
const bare = () => ({ headers: {}, url: '/mcp' });
const call = (name, args = {}) => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });

// The unified name the registry gave a free-studio tool.
function studioTool(legacy) {
	const t = unified().registry.tools.find((x) => x.source === 'mcp-studio' && x.def._meta['three.ws/source'].name === legacy);
	if (!t) throw new Error(`no unified tool for mcp-studio ${legacy}`);
	return t;
}

let realFetch;
beforeEach(() => {
	realFetch = globalThis.fetch;
	globalThis.fetch = vi.fn(async () => ({
		ok: true,
		status: 200,
		json: async () => ({ status: 'done', glb_url: 'https://three.ws/cdn/creations/model.glb', job_id: 'JOB_1' }),
	}));
});
afterEach(() => {
	globalThis.fetch = realFetch;
});

describe('free studio creator tools on /mcp', () => {
	it('marks every studio tool that creates or rigs as not public, and keeps the reads public', () => {
		const studio = unified().registry.tools.filter((t) => t.source === 'mcp-studio');
		expect(studio.length).toBeGreaterThan(0);
		for (const t of studio) {
			const legacy = t.def._meta['three.ws/source'].name;
			expect(t.isPublic, legacy).toBe(!CREATOR_TOOL_NAMES.has(legacy));
		}
		expect(studioTool('check_job').isPublic).toBe(true);
	});

	it('hides the creator tools from an anonymous tools/list', async () => {
		const r = await dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, anon, bare());
		const names = new Set(r.result.tools.map((t) => t.name));
		expect(names.has(studioTool('forge_free').name)).toBe(false);
		expect(names.has(studioTool('rig_mesh').name)).toBe(false);
	});

	it('refuses an anonymous forge_free with the /mcp sign-in challenge and never submits', async () => {
		const r = await dispatch(call(studioTool('forge_free').name, { prompt: 'a brass telescope' }), anon, bare());
		expect(r.error).toBeUndefined();
		expect(r.result.isError).toBe(true);
		expect(r.result.structuredContent.reason).toBe('auth_required');
		const challenge = r.result._meta['mcp/www_authenticate'][0];
		expect(challenge).toContain('resource="https://three.ws/mcp"');
		expect(challenge).toContain('resource_metadata=');
		expect(globalThis.fetch).not.toHaveBeenCalled();
		expect(limits.studioGenBurst).not.toHaveBeenCalled();
	});

	it('refuses a creator tool for a paid caller with no account instead of running it anonymously', async () => {
		const payer = { userId: null, rateKey: null, scope: '', source: 'x402', x402Paid: true };
		const r = await dispatch(call(studioTool('forge_free').name, { prompt: 'a brass telescope' }), payer, bare());
		expect(r.result.isError).toBe(true);
		expect(r.result.structuredContent.reason).toBe('sign_in_required');
		expect(globalThis.fetch).not.toHaveBeenCalled();
	});

	it('runs forge_free for a signed-in account, keys the quota on it and names it on the forge submit', async () => {
		const r = await dispatch(call(studioTool('forge_free').name, { prompt: 'a brass telescope' }), signedIn, bare());
		expect(r.result.isError).toBeFalsy();
		expect(r.result.structuredContent.glbUrl).toBe('https://three.ws/cdn/creations/model.glb');
		expect(limits.studioGenBurst).toHaveBeenCalledWith(`acct:${signedIn.userId}`);
		expect(limits.studioGenHourly).toHaveBeenCalledWith(`acct:${signedIn.userId}`);
		const submit = globalThis.fetch.mock.calls.find(([url, init]) => String(url).includes('/api/gpt-forge') && init?.method === 'POST');
		expect(submit).toBeTruthy();
		expect(submit[1].headers['x-forge-on-behalf-user']).toBe(signedIn.userId);
		expect(submit[1].headers['x-forge-seed']).toBe(process.env.CRON_SECRET);
	});

	it('leaves check_job open to an anonymous caller', async () => {
		const r = await dispatch(call(studioTool('check_job').name, { job_id: 'JOB_00000001' }), anon, bare());
		expect(r.error).toBeUndefined();
		expect(r.result.structuredContent?.reason).not.toBe('auth_required');
		expect(r.result.structuredContent?.reason).not.toBe('sign_in_required');
	});
});

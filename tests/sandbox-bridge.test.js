// The sandbox bridge (api/_lib/sandbox/bridge.js) against the real sandbox
// schema in an in-process Postgres: a script that calls a fund-moving tool is
// refused whatever the run allows, fetch honors the plan's egress and the
// owner's host allowlist (including on redirect), every call counts against
// the execution's bridge cap atomically, a finished execution gets nothing,
// and bridge tokens cannot be forged, reused for another execution, or used
// after they expire.

import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPgliteSql } from './_helpers/pglite-sql.js';

const holder = vi.hoisted(() => ({ db: null }));

vi.mock('../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, sql: (...args) => holder.db.sql(...args) };
});
// One deterministic read tool next to the real registry, so a permitted call
// can run without reaching a third-party API from the test.
vi.mock('../api/_lib/agent-tools.js', async (importActual) => {
	const actual = await importActual();
	return {
		...actual,
		AGENT_TOOLS: {
			...actual.AGENT_TOOLS,
			echo_args: { description: 'Echo the arguments', parameters: { type: 'object' }, handler: async (args) => ({ echoed: args }) },
		},
	};
});

process.env.DATABASE_URL ||= 'postgres://pglite.test/db';
process.env.SANDBOX_BRIDGE_SECRET = 'test-bridge-secret';

const { bridgeContext, bridgeTools, handleBridge, hostAllowed, normalizeHostPattern, signBridgeToken, verifyBridgeToken } = await import(
	'../api/_lib/sandbox/bridge.js'
);
const store = await import('../api/_lib/sandbox/store.js');
const { limitsFor } = await import('../api/_lib/sandbox/limits.js');

const USER = '11111111-1111-4111-8111-111111111111';
const PRO_USER = '22222222-2222-4222-8222-222222222222';
const MIGRATION = fs.readFileSync(path.resolve(__dirname, '../api/_lib/migrations/20260922220000_agent_sandbox.sql'), 'utf8');

let seq = 0;
async function newExecution({ userId = USER, plan = 'free', toolsAllowed = null, cap } = {}) {
	const runId = `run-test-${++seq}-${Date.now()}`;
	await store.ensureSandboxRun({ runId, userId, backend: 'local', toolsAllowed });
	const limits = { ...limitsFor(plan), ...(cap ? { bridgeCallsPerExecution: cap } : {}) };
	const exec = await store.createExecution({ runId, userId, kind: 'code', backend: 'local', language: 'python', code: 'pass', limits });
	return { runId, exec, ctx: await bridgeContext(exec.id) };
}

beforeAll(async () => {
	holder.db = createPgliteSql();
	await holder.db.exec(`
		create table users (id uuid primary key, plan text);
		create table agent_identities (id uuid primary key);
		insert into users (id, plan) values ('${USER}', 'free'), ('${PRO_USER}', 'pro');
	`);
	await holder.db.exec(MIGRATION);
});
afterAll(async () => {
	await holder.db?.close?.();
});

describe('tokens', () => {
	const id = '33333333-3333-4333-8333-333333333333';
	it('round-trips the execution id', () => {
		expect(verifyBridgeToken(signBridgeToken(id, 60))).toBe(id);
	});
	it('refuses a tampered id or signature', () => {
		const t = signBridgeToken(id, 60);
		const other = '44444444-4444-4444-8444-444444444444';
		expect(verifyBridgeToken(t.replace(id, other))).toBeNull();
		expect(verifyBridgeToken(t.slice(0, -2) + (t.endsWith('AA') ? 'BB' : 'AA'))).toBeNull();
		expect(verifyBridgeToken(t.replace(/\.(\d+)\./, (_, n) => `.${Number(n) + 1000}.`))).toBeNull();
	});
	it('refuses an expired token', () => {
		vi.useFakeTimers();
		try {
			const t = signBridgeToken(id, 5);
			vi.setSystemTime(Date.now() + 10_000);
			expect(verifyBridgeToken(t)).toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});
	it('refuses garbage and a token signed with another key', () => {
		for (const bad of [null, '', 'v1', 'v1.a.b.c', 'x'.repeat(400), 42]) expect(verifyBridgeToken(bad)).toBeNull();
		const t = signBridgeToken(id, 60);
		process.env.SANDBOX_BRIDGE_SECRET = 'rotated';
		try {
			expect(verifyBridgeToken(t)).toBeNull();
		} finally {
			process.env.SANDBOX_BRIDGE_SECRET = 'test-bridge-secret';
		}
	});
});

describe('host allowlist', () => {
	it('normalizes patterns and rejects junk', () => {
		expect(normalizeHostPattern(' API.Example.com. ')).toBe('api.example.com');
		expect(normalizeHostPattern('*.example.com')).toBe('*.example.com');
		for (const bad of ['', 'localhost', 'http://x.com', 'a b.com', '*', '*.', 'x..com', '-a.com']) expect(normalizeHostPattern(bad)).toBeNull();
	});
	it('matches exact hosts and strict subdomains of a wildcard', () => {
		const list = ['api.coingecko.com', '*.example.org'];
		expect(hostAllowed('api.coingecko.com', list)).toBe(true);
		expect(hostAllowed('API.COINGECKO.COM', list)).toBe(true);
		expect(hostAllowed('evil.api.coingecko.com', list)).toBe(false);
		expect(hostAllowed('a.example.org', list)).toBe(true);
		expect(hostAllowed('a.b.example.org', list)).toBe(true);
		expect(hostAllowed('example.org', list)).toBe(false);
		expect(hostAllowed('evilexample.org', list)).toBe(false);
		expect(hostAllowed('api.coingecko.com.evil.net', list)).toBe(false);
	});
});

describe('tool calls', () => {
	it('refuses a financial tool even when the run allows it, naming the preview', async () => {
		const { exec, ctx } = await newExecution({ toolsAllowed: ['pay_and_call', 'echo_args'] });
		const r = await handleBridge(ctx, { op: 'tool', name: 'pay_and_call', args: { resource_url: 'https://x.example' } });
		expect(r.ok).toBe(false);
		expect(r.error.code).toBe('financial_tool');
		expect(r.error.previewTool).toBe('pay_quote');
		expect(r.error.message).toMatch(/preview/);
		const row = await store.getExecution(exec.id);
		expect(row.bridge_calls).toBe(1);
		expect(row.bridge_log[0]).toMatchObject({ op: 'tool', tool: 'pay_and_call', ok: false, code: 'financial_tool', financial: true });
		expect((await store.getSandboxRun(ctx.runId)).refusals).toBe(1);
	});

	it('refuses an unclassified fund-moving name by its shape', async () => {
		const { ctx } = await newExecution();
		const r = await handleBridge(ctx, { op: 'tool', name: 'transfer_everything', args: {} });
		expect(r.error.code).toBe('financial_tool');
	});

	it('never lists a financial tool', async () => {
		const { ctx } = await newExecution();
		const names = bridgeTools(ctx).map((t) => t.name);
		expect(names).toContain('token_price');
		expect(names).toContain('echo_args');
		expect(names.every((n) => !/^(pay|swap|send|transfer)/.test(n))).toBe(true);
	});

	it('runs a permitted read tool and returns its result', async () => {
		const { ctx } = await newExecution();
		const r = await handleBridge(ctx, { op: 'tool', name: 'echo_args', args: { a: 1 } });
		expect(r).toEqual({ ok: true, result: { echoed: { a: 1 } } });
	});

	it('narrows to the run tools_allowed', async () => {
		const { ctx } = await newExecution({ toolsAllowed: ['token_price'] });
		expect((await handleBridge(ctx, { op: 'tool', name: 'echo_args' })).error.code).toBe('tool_not_allowed');
		expect(bridgeTools(ctx).map((t) => t.name)).toEqual(['token_price']);
	});

	it('refuses an unknown tool and an unknown op', async () => {
		const { ctx } = await newExecution();
		expect((await handleBridge(ctx, { op: 'tool', name: 'no_such_tool' })).error.code).toBe('unknown_tool');
		expect((await handleBridge(ctx, { op: 'shell', cmd: 'id' })).error.code).toBe('bad_op');
	});
});

describe('fetch', () => {
	const fakeFetch = vi.fn();
	beforeEach(() => {
		fakeFetch.mockReset();
		fakeFetch.mockImplementation(async () => new Response('{"pong":true}', { status: 200, headers: { 'content-type': 'application/json', 'set-cookie': 'a=b' } }));
	});

	it('is refused on a plan without egress, before any request', async () => {
		const { ctx } = await newExecution({ plan: 'free' });
		const r = await handleBridge(ctx, { op: 'fetch', url: 'https://api.coingecko.com/api/v3/ping' }, { fetchImpl: fakeFetch });
		expect(r.error.code).toBe('egress_off');
		expect(r.error.message).toMatch(/pricing/);
		expect(fakeFetch).not.toHaveBeenCalled();
	});

	it('is refused for a host off the allowlist', async () => {
		await store.saveSandboxSettings(PRO_USER, { allow_hosts: ['api.coingecko.com'] });
		const { ctx } = await newExecution({ userId: PRO_USER, plan: 'pro' });
		const r = await handleBridge(ctx, { op: 'fetch', url: 'https://metadata.google.internal/' }, { fetchImpl: fakeFetch });
		expect(r.error.code).toBe('host_not_allowed');
		expect(fakeFetch).not.toHaveBeenCalled();
	});

	it('fetches an allowed host through the guard and strips cookies and forbidden headers', async () => {
		await store.saveSandboxSettings(PRO_USER, { allow_hosts: ['api.coingecko.com'] });
		const { ctx } = await newExecution({ userId: PRO_USER, plan: 'pro' });
		const r = await handleBridge(
			ctx,
			{ op: 'fetch', url: 'https://api.coingecko.com/api/v3/ping', headers: { accept: 'application/json', host: 'evil', 'x-forwarded-for': '1.2.3.4' } },
			{ fetchImpl: fakeFetch },
		);
		expect(r.ok).toBe(true);
		expect(r.result.status).toBe(200);
		expect(JSON.parse(Buffer.from(r.result.body_base64, 'base64').toString())).toEqual({ pong: true });
		expect(r.result.headers['set-cookie']).toBeUndefined();
		const [url, init, opts] = fakeFetch.mock.calls[0];
		expect(url).toBe('https://api.coingecko.com/api/v3/ping');
		expect(init.headers).toEqual({ accept: 'application/json' });
		expect(opts.maxBytes).toBe(5 * 1024 * 1024);
		await expect(opts.onRedirect(new URL('https://evil.example/'))).rejects.toThrow(/not on the allowlist/);
		await expect(opts.onRedirect(new URL('https://api.coingecko.com/next'))).resolves.toBeUndefined();
	});

	it('reports a redirect off the allowlist as a refusal', async () => {
		await store.saveSandboxSettings(PRO_USER, { allow_hosts: ['api.coingecko.com'] });
		const { ctx } = await newExecution({ userId: PRO_USER, plan: 'pro' });
		fakeFetch.mockImplementation(async (_u, _i, opts) => {
			await opts.onRedirect(new URL('https://169.254.169.254/latest'));
			return new Response('');
		});
		const r = await handleBridge(ctx, { op: 'fetch', url: 'https://api.coingecko.com/redirect' }, { fetchImpl: fakeFetch });
		expect(r.error.code).toBe('host_not_allowed');
	});

	it('the real SSRF guard refuses a private address even when listed', async () => {
		await store.saveSandboxSettings(PRO_USER, { allow_hosts: ['localtest.me'] });
		const { ctx } = await newExecution({ userId: PRO_USER, plan: 'pro' });
		const r = await handleBridge(ctx, { op: 'fetch', url: 'http://localtest.me/' });
		expect(r.ok).toBe(false);
		expect(['blocked_address', 'fetch_failed']).toContain(r.error.code);
	});
});

describe('the bridge cap and the execution lifecycle', () => {
	it('counts concurrent calls atomically and refuses past the cap', async () => {
		const { exec, ctx } = await newExecution({ cap: 3 });
		const results = await Promise.all(Array.from({ length: 6 }, () => handleBridge(ctx, { op: 'tool', name: 'echo_args', args: {} })));
		expect(results.filter((r) => r.ok)).toHaveLength(3);
		expect(results.filter((r) => r.error?.code === 'bridge_limit')).toHaveLength(3);
		expect((await store.getExecution(exec.id)).bridge_calls).toBe(3);
	});

	it('refuses every call once the execution has finished', async () => {
		const { exec, ctx } = await newExecution();
		await store.finishExecution(exec.id, { status: 'succeeded', exitCode: 0 });
		expect((await handleBridge(ctx, { op: 'tool', name: 'echo_args' })).error.code).toBe('execution_finished');
		expect((await handleBridge(ctx, { op: 'tool', name: 'pay_and_call' })).error.code).toBe('execution_finished');
		await expect(bridgeContext(exec.id)).rejects.toMatchObject({ code: 'execution_finished' });
	});

	it('refuses a context for a killed run', async () => {
		const { exec, runId } = await newExecution();
		await store.killSandboxRun(runId, 'owner stopped it');
		await expect(bridgeContext(exec.id)).rejects.toMatchObject({ code: 'run_killed' });
	});
});

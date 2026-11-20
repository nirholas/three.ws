// The mcp_probe healthz sensor (api/_lib/mcp-probe-health.js): the pure verdict
// in every state the work order names, then the real reader over
// mcp_probe_results on PGlite, with the production schema and every migration
// applied (the 20261120205747 table included).

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPgliteSql } from './_helpers/pglite-sql.js';
import { createFullSchemaDb } from './_helpers/pglite-full-schema.js';

const holder = vi.hoisted(() => ({ db: null }));
vi.mock('../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, sql: (...args) => holder.db.sql(...args) };
});

process.env.DATABASE_URL ||= 'postgres://pglite.test/db';

const { serverVerdict, mcpProbeVerdict, gatherMcpProbeHealth, probedServers, STALE_AFTER_MS } = await import('../api/_lib/mcp-probe-health.js');

const NOW = Date.parse('2026-11-20T12:00:00Z');
const at = (minutesAgo) => new Date(NOW - minutesAgo * 60_000).toISOString();
const pass = (m) => ({ checkedAt: at(m), ok: true, failedStep: null, error: null });
const fail = (m, step = 'tools/list', error = 'answered HTTP 502') => ({ checkedAt: at(m), ok: false, failedStep: step, error });

describe('serverVerdict', () => {
	it('ok when the last two probes passed', () => {
		expect(serverVerdict([pass(1), pass(6)], NOW)).toEqual({ status: 'ok', detail: 'last two probes passed' });
	});

	it('ok on the first probe ever when it passed', () => {
		expect(serverVerdict([pass(1)], NOW).status).toBe('ok');
	});

	it('warns (degraded) on one failure, naming the step and the reason', () => {
		expect(serverVerdict([fail(1), pass(6)], NOW)).toEqual({ status: 'degraded', detail: 'latest probe tools/list failed: answered HTTP 502' });
	});

	it('fails (down) on two consecutive failures', () => {
		expect(serverVerdict([fail(1, 'initialize', 'timed out after 10000ms'), fail(6)], NOW)).toEqual({
			status: 'down',
			detail: 'two consecutive failures, initialize failed: timed out after 10000ms',
		});
	});

	it('fails (down) when no probe landed in 15 minutes, even if the last one passed', () => {
		const v = serverVerdict([pass(16), pass(21)], NOW);
		expect(v.status).toBe('down');
		expect(v.detail).toMatch(/no probe for 16m \(limit 15m\)/);
	});

	it('stays ok right at the staleness limit', () => {
		expect(serverVerdict([{ ...pass(0), checkedAt: new Date(NOW - STALE_AFTER_MS).toISOString() }, pass(20)], NOW).status).toBe('ok');
	});

	it('ok again after a single failure clears', () => {
		expect(serverVerdict([pass(1), fail(6)], NOW)).toEqual({ status: 'ok', detail: 'passed, recovered from one failure' });
	});

	it('unknown before the first probe', () => {
		expect(serverVerdict([], NOW).status).toBe('unknown');
	});
});

describe('mcpProbeVerdict', () => {
	const grok = 'https://three.ws/api/mcp-grok';
	const studio = 'https://three.ws/api/mcp-studio';

	it('ok only when every server is ok', () => {
		const v = mcpProbeVerdict(new Map([[grok, [pass(1), pass(6)]], [studio, [pass(2), pass(7)]]]), NOW);
		expect(v.status).toBe('ok');
		expect(v.detail).toBe('2 connectors passing');
	});

	it('the worst server decides and its path leads the detail', () => {
		const v = mcpProbeVerdict(new Map([[grok, [pass(1), pass(6)]], [studio, [fail(2), fail(7)]]]), NOW);
		expect(v.status).toBe('down');
		expect(v.detail).toBe('/api/mcp-studio: two consecutive failures, tools/list failed: answered HTTP 502');
		expect(v.servers.map((s) => s.status)).toEqual(['ok', 'down']);
	});

	it('one failing server among passing ones is a warning', () => {
		expect(mcpProbeVerdict(new Map([[grok, [fail(1), pass(6)]], [studio, [pass(2), pass(7)]]]), NOW).status).toBe('degraded');
	});

	it('a server never probed next to a passing one is not ok yet', () => {
		expect(mcpProbeVerdict(new Map([[grok, [pass(1), pass(6)]], [studio, []]]), NOW).status).toBe('unknown');
	});

	it('unknown before any probe has run', () => {
		expect(mcpProbeVerdict(new Map([[grok, []], [studio, []]]), NOW)).toMatchObject({ status: 'unknown', detail: 'no probe has run yet' });
	});
});

describe('probedServers', () => {
	it('is the Grok-facing set of the deployed manifest on this origin', async () => {
		expect((await probedServers({ base: 'https://three.ws' })).sort()).toEqual(['https://three.ws/api/mcp-grok', 'https://three.ws/api/mcp-studio']);
	});
});

describe('gatherMcpProbeHealth over mcp_probe_results', () => {
	let pg;
	const base = 'https://three.ws';

	beforeAll(async () => {
		({ pg } = await createFullSchemaDb());
		holder.db = createPgliteSql({ pg });
	}, 300_000);

	afterAll(async () => {
		await pg?.close?.();
	});

	async function seed(server, minutesAgo, ok, failedStep = null, error = null) {
		await holder.db.sql`
			insert into mcp_probe_results (checked_at, server, ok, failed_step, latency_ms, error)
			values (now() - make_interval(mins => ${minutesAgo}), ${server}, ${ok}, ${failedStep}, '{}'::jsonb, ${error})
		`;
	}

	it('unknown with no rows', async () => {
		const h = await gatherMcpProbeHealth({ base });
		expect(h).toMatchObject({ name: 'mcp_probe', status: 'unknown', detail: 'no probe has run yet' });
	});

	it('ok when the two newest rows per server passed, older failures ignored', async () => {
		for (const s of ['/api/mcp-grok', '/api/mcp-studio']) {
			await seed(`${base}${s}`, 30, false, 'initialize', 'timed out');
			await seed(`${base}${s}`, 6, true);
			await seed(`${base}${s}`, 1, true);
		}
		const h = await gatherMcpProbeHealth({ base });
		expect(h.status).toBe('ok');
		expect(h.metrics.servers).toHaveLength(2);
		for (const s of h.metrics.servers) expect(s.lastCheckedAt).toMatch(/^\d{4}-/);
	});

	it('degraded on one failure, down on the second in a row', async () => {
		await seed(`${base}/api/mcp-grok`, 0, false, 'tools/call', 'isError');
		expect((await gatherMcpProbeHealth({ base })).status).toBe('degraded');
		await holder.db.sql`update mcp_probe_results set checked_at = now() - interval '1 minute' where server = ${`${base}/api/mcp-grok`} and ok = false and failed_step = 'tools/call'`;
		await seed(`${base}/api/mcp-grok`, 0, false, 'tools/call', 'isError');
		const h = await gatherMcpProbeHealth({ base });
		expect(h.status).toBe('down');
		expect(h.detail).toBe('/api/mcp-grok: two consecutive failures, tools/call failed: isError');
	});

	it('unknown with a migration hint when the table is missing', async () => {
		await holder.db.sql`drop table mcp_probe_results`;
		const h = await gatherMcpProbeHealth({ base });
		expect(h).toMatchObject({ status: 'unknown', detail: 'mcp_probe_results table missing: run npm run db:migrate' });
	});
});

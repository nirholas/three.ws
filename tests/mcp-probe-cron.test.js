// The five-minute probe cron (api/cron/mcp-probe.js) and the public uptime feed
// it fills (api/status/mcp.js), end to end in this process: the cron probes the
// real /api/mcp-grok and /api/mcp-studio handlers over a loopback HTTP server
// (tests/_helpers/mcp-loopback.js), stores real rows in mcp_probe_results on
// PGlite (production schema plus every migration), prunes past 90 days, and
// the feed computes its rates from those rows over real HTTP.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPgliteSql } from './_helpers/pglite-sql.js';
import { createFullSchemaDb } from './_helpers/pglite-full-schema.js';
import { startMcpLoopback } from './_helpers/mcp-loopback.js';

const holder = vi.hoisted(() => ({ db: null }));
vi.mock('../api/_lib/db.js', async (importActual) => {
	const actual = await importActual();
	return { ...actual, sql: (...args) => holder.db.sql(...args) };
});

process.env.DATABASE_URL ||= 'postgres://pglite.test/db';
process.env.JWT_SECRET ||= 'vitest-ephemeral-jwt-secret-00000000000000';
process.env.CRON_SECRET = 'vitest-cron-secret';

let loopback;
let origin;
let cron;
let status;
// Nothing on this port: every connection is refused, the "connector is down" path.
const DEAD = 'http://127.0.0.1:9';
const alerts = [];
const alert = async (title, detail, opts) => {
	alerts.push({ title, detail, signature: opts?.signature });
};
const rows = (where = '') => holder.db.sql`select server, ok, failed_step, latency_ms, error, detail, checked_at from mcp_probe_results ${where ? holder.db.sql.unsafe?.(where) ?? '' : ''} order by checked_at`;

beforeAll(async () => {
	const { pg } = await createFullSchemaDb();
	holder.db = createPgliteSql({ pg });
	cron = await import('../api/cron/mcp-probe.js');
	status = await import('../api/status/mcp.js');
	loopback = await startMcpLoopback({ extraRoutes: { '/api/cron/mcp-probe': cron.default, '/api/status/mcp': status.default } });
	origin = loopback.origin;
}, 300_000);

afterAll(async () => {
	await loopback?.close();
});

describe('transition', () => {
	it('pages on the second failure in a row and on recovery from it, never on one blip', () => {
		expect(cron.transition([], { ok: false })).toBeNull();
		expect(cron.transition([{ ok: true }], { ok: false })).toBeNull();
		expect(cron.transition([{ ok: false }], { ok: false })).toBe('down');
		expect(cron.transition([{ ok: false }, { ok: true }], { ok: true })).toBeNull();
		expect(cron.transition([{ ok: false }, { ok: false }], { ok: true })).toBe('recovered');
		expect(cron.transition([{ ok: true }, { ok: true }], { ok: true })).toBeNull();
	});
});

describe('runMcpProbe', () => {
	it('writes one real row per Grok-facing server, every step timed', async () => {
		const out = await cron.runMcpProbe({ base: origin, stepTimeoutMs: 60_000, alert });
		expect(out.ok).toBe(true);
		expect(out.results.map((r) => new URL(r.server).pathname).sort()).toEqual(['/api/mcp-grok', '/api/mcp-studio']);
		const stored = await holder.db.sql`select * from mcp_probe_results order by server`;
		expect(stored).toHaveLength(2);
		for (const r of stored) {
			expect(r.server.startsWith(origin)).toBe(true);
			expect(r.ok).toBe(true);
			expect(r.failed_step).toBeNull();
			expect(r.error).toBeNull();
			expect(Object.keys(r.latency_ms)).toEqual(['initialize', 'notifications/initialized', 'tools/list', 'tools/call', 'oauth_challenge', 'oauth_metadata']);
			expect(r.detail.sessionIssued).toBe(true);
			expect(r.detail.warnings).toEqual([]);
		}
		expect(alerts).toEqual([]);
	}, 180_000);

	it('deletes rows older than 90 days and keeps the rest', async () => {
		const server = `${origin}/api/mcp-grok`;
		await holder.db.sql`insert into mcp_probe_results (checked_at, server, ok) values (now() - interval '91 days', ${server}, true), (now() - interval '89 days', ${server}, true)`;
		const out = await cron.runMcpProbe({ base: origin, stepTimeoutMs: 60_000, alert });
		expect(out.pruned).toBe(1);
		const [{ n91 }] = await holder.db.sql`select count(*)::int as n91 from mcp_probe_results where checked_at < now() - interval '90 days'`;
		const [{ n89 }] = await holder.db.sql`select count(*)::int as n89 from mcp_probe_results where checked_at < now() - interval '88 days'`;
		expect(n91).toBe(0);
		expect(n89).toBe(1);
	}, 180_000);

	it('records the failing step, pages on the second failure in a row, then on recovery', async () => {
		const first = await cron.runMcpProbe({ base: DEAD, stepTimeoutMs: 2_000, alert });
		expect(first.ok).toBe(false);
		for (const r of first.results) expect(r.failedStep).toBe('initialize');
		expect(alerts).toEqual([]);

		await cron.runMcpProbe({ base: DEAD, stepTimeoutMs: 2_000, alert });
		expect(alerts.map((a) => a.title).sort()).toEqual(['DOWN: MCP connector /api/mcp-grok', 'DOWN: MCP connector /api/mcp-studio']);
		expect(alerts[0].detail).toMatch(/two consecutive probe failures; initialize failed:/);

		// The same server URLs answering again: copy the two failures onto the live origin.
		await holder.db.sql`
			insert into mcp_probe_results (checked_at, server, ok, failed_step, error)
			select checked_at, replace(server, ${DEAD}, ${origin}), ok, failed_step, error
			from mcp_probe_results where server like ${`${DEAD}%`}
		`;
		alerts.length = 0;
		await cron.runMcpProbe({ base: origin, stepTimeoutMs: 60_000, alert });
		expect(alerts.map((a) => a.title).sort()).toEqual(['RECOVERED: MCP connector /api/mcp-grok', 'RECOVERED: MCP connector /api/mcp-studio']);
	}, 180_000);
});

describe('the cron route', () => {
	it('refuses a caller without the cron secret', async () => {
		const res = await fetch(`${origin}/api/cron/mcp-probe`);
		expect(res.status).toBe(401);
	});

	it('runs the probe for the scheduler and answers the per-server summary', async () => {
		const res = await fetch(`${origin}/api/cron/mcp-probe`, { headers: { authorization: 'Bearer vitest-cron-secret' } });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.results).toHaveLength(2);
		for (const r of body.results) expect(Number.isInteger(r.handshakeMs)).toBe(true);
	}, 180_000);
});

describe('GET /api/status/mcp', () => {
	it('computes per-server rates and percentiles from the stored rows, public and cacheable', async () => {
		status.resetMcpStatusCache();
		const res = await fetch(`${origin}/api/status/mcp`);
		expect(res.status).toBe(200);
		expect(res.headers.get('cache-control')).toBe('public, max-age=60, s-maxage=60');
		expect(res.headers.get('access-control-allow-origin')).toBe('*');
		const body = await res.json();
		expect(body.probeIntervalSeconds).toBe(300);

		const grok = body.servers.find((s) => s.server === `${origin}/api/mcp-grok`);
		expect(grok.name).toBe('Grok');
		expect(grok.path).toBe('/api/mcp-grok');
		expect(grok.last.ok).toBe(true);

		const [{ probes, passed }] = await holder.db.sql`
			select count(*)::int as probes, count(*) filter (where ok)::int as passed
			from mcp_probe_results where server = ${`${origin}/api/mcp-grok`} and checked_at > now() - interval '24 hours'
		`;
		expect(grok.windows['24h'].probes).toBe(probes);
		expect(grok.windows['24h'].passed).toBe(passed);
		expect(grok.windows['24h'].successRate).toBeCloseTo(passed / probes, 10);
		expect(passed).toBeLessThan(probes);
		for (const w of ['24h', '7d', '30d']) {
			expect(grok.windows[w].handshakeP50Ms).toBeGreaterThanOrEqual(0);
			expect(grok.windows[w].handshakeP95Ms).toBeGreaterThanOrEqual(grok.windows[w].handshakeP50Ms);
			expect(grok.windows[w].toolCallP95Ms).toBeGreaterThanOrEqual(grok.windows[w].toolCallP50Ms);
		}
		// The 89-day-old row is outside every window; nothing older than 30 days counts.
		expect(grok.windows['30d'].probes).toBe(probes);

		// Public: no error text, no request detail leaves the server.
		const text = JSON.stringify(body);
		expect(text).not.toMatch(/ECONNREFUSED|fetch failed|timed out/);
		expect(text).not.toMatch(/latency_ms|warnings|sessionIssued/);
	});

	it('serves the 60s cache instead of re-querying', async () => {
		const before = await (await fetch(`${origin}/api/status/mcp`)).json();
		await holder.db.sql`insert into mcp_probe_results (server, ok) values (${`${origin}/api/mcp-grok`}, false)`;
		const after = await (await fetch(`${origin}/api/status/mcp`)).json();
		expect(after.generatedAt).toBe(before.generatedAt);
		status.resetMcpStatusCache();
		const fresh = await (await fetch(`${origin}/api/status/mcp`)).json();
		expect(fresh.generatedAt).not.toBe(before.generatedAt);
	});

	it('an empty ledger is an empty server list, which the page renders as its empty state', async () => {
		await holder.db.sql`delete from mcp_probe_results`;
		status.resetMcpStatusCache();
		const body = await (await fetch(`${origin}/api/status/mcp`)).json();
		expect(body.servers).toEqual([]);
	});

	it('an unreadable ledger is an actionable 503, never cached', async () => {
		await holder.db.sql`drop table mcp_probe_results`;
		status.resetMcpStatusCache();
		const res = await fetch(`${origin}/api/status/mcp`);
		expect(res.status).toBe(503);
		expect(res.headers.get('cache-control')).toBe('no-store');
		expect((await res.json()).error).toBe('uptime_unavailable');
	});
});

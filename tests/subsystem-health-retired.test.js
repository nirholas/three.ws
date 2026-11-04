/**
 * world.three.ws retirement: a deleted surface must read "retired", not "down".
 *
 * The hyperfy-world service was deleted on purpose on 2026-10-23, yet the
 * world-health cron kept alerting and healthz kept rolling up "down". Contracts:
 *   1. With the world_retired flag on, checkWorld reports `retired` (with the date
 *      and restore hint) even when stale alerts or a parked down outcome exist; it
 *      is excluded from counts, from `degraded`, and from the rollup status.
 *   2. With the flag off, a 404 still reads `down` exactly as before (reversible).
 *   3. The cron makes no fetch and raises no alert when retired.
 *   4. The forge-health world probe makes no fetch and reports `retired`.
 *   5. An explicit app_flags row beats the WORLD_RETIRED env fallback.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const dbState = vi.hoisted(() => ({ flagRow: null, alertRows: [], flagThrows: false }));
vi.mock('../api/_lib/db.js', () => ({
	sql: async (strings) => {
		const q = strings.join('?');
		if (q.includes('app_flags')) {
			if (dbState.flagThrows) throw new Error('db down');
			return dbState.flagRow ? [dbState.flagRow] : [];
		}
		return dbState.alertRows;
	},
}));
vi.mock('../api/_lib/alerts.js', () => ({ sendOpsAlert: vi.fn() }));

import { gatherSubsystemHealth } from '../api/_lib/ops/subsystem-health.js';
import { cacheSet, cacheDel, cacheGet } from '../api/_lib/cache.js';
import { __clearFlagCache } from '../api/_lib/flags.js';
import { sendOpsAlert } from '../api/_lib/alerts.js';
import handler from '../api/cron/world-health.js';
import { probeForgeHealth, resetForgeHealthCache } from '../api/_lib/forge-health.js';

const sub = (h, n) => h.subsystems.find((s) => s.name === n);
const SECRET = 'test-cron-secret';
const staleDown = () => ({
	detail: 'https://world.three.ws/status returned HTTP 404',
	last_seen: new Date().toISOString(),
});

let savedEnv;
beforeEach(async () => {
	savedEnv = process.env.WORLD_RETIRED;
	delete process.env.WORLD_RETIRED;
	process.env.CRON_SECRET = SECRET;
	dbState.flagRow = null;
	dbState.alertRows = [];
	dbState.flagThrows = false;
	__clearFlagCache();
	resetForgeHealthCache();
	sendOpsAlert.mockReset();
	await cacheDel('world:health');
});
afterEach(() => {
	if (savedEnv === undefined) delete process.env.WORLD_RETIRED;
	else process.env.WORLD_RETIRED = savedEnv;
	vi.unstubAllGlobals();
});

function fakeRes() {
	return {
		statusCode: 0,
		body: undefined,
		headersSent: false,
		writableEnded: false,
		setHeader() {},
		getHeader() {},
		end(b) {
			this.body = b;
			this.writableEnded = true;
		},
	};
}
const cronReq = () => ({ method: 'GET', url: '/api/cron/world-health', headers: { authorization: `Bearer ${SECRET}` } });

describe('world retirement in gatherSubsystemHealth', () => {
	it('reports retired (not down) when the flag is on, ignoring stale alerts', async () => {
		dbState.flagRow = { enabled: true, value: null };
		dbState.alertRows = [staleDown()];
		const health = await gatherSubsystemHealth({ probeDb: false });
		const world = sub(health, 'world');
		expect(world.status).toBe('retired');
		expect(world.detail).toMatch(/2026-10-23/);
		expect(world.detail).toMatch(/deploy\/world\/apply-hardening\.sh/);
		expect(health.degraded).not.toContain('world');
		expect(health.counts.retired).toBeUndefined();
	});

	it('ignores a parked down outcome while retired and keeps the rollup off world', async () => {
		dbState.flagRow = { enabled: true, value: null };
		await cacheSet('world:health', { status: 'down', problems: ['HTTP 404'], checkedAt: Date.now() }, 60);
		const health = await gatherSubsystemHealth({ probeDb: false });
		expect(sub(health, 'world').status).toBe('retired');
		expect(health.degraded).not.toContain('world');
	});

	it('falls back to the WORLD_RETIRED env var when no flag row exists', async () => {
		process.env.WORLD_RETIRED = '1';
		const health = await gatherSubsystemHealth({ probeDb: false });
		expect(sub(health, 'world').status).toBe('retired');
	});

	it('falls back to the env var when the flags table is unreachable', async () => {
		process.env.WORLD_RETIRED = 'true';
		dbState.flagThrows = true;
		const health = await gatherSubsystemHealth({ probeDb: false });
		expect(sub(health, 'world').status).toBe('retired');
	});

	it('an explicit flag row of false beats WORLD_RETIRED=1 (un-retire is one setFlag)', async () => {
		process.env.WORLD_RETIRED = '1';
		dbState.flagRow = { enabled: false, value: null };
		dbState.alertRows = [staleDown()];
		const health = await gatherSubsystemHealth({ probeDb: false });
		expect(sub(health, 'world').status).toBe('down');
		expect(health.degraded).toContain('world');
	});

	it('flag unset and a 404 outcome still reads down exactly as before', async () => {
		dbState.alertRows = [staleDown()];
		const health = await gatherSubsystemHealth({ probeDb: false });
		const world = sub(health, 'world');
		expect(world.status).toBe('down');
		expect(world.detail).toMatch(/HTTP 404/);
		expect(health.degraded).toContain('world');
	});
});

describe('world retirement in the world-health cron', () => {
	it('makes no fetch, raises no alert, and parks a retired outcome', async () => {
		dbState.flagRow = { enabled: true, value: null };
		const fetchMock = vi.fn(async () => ({ ok: false, status: 404 }));
		vi.stubGlobal('fetch', fetchMock);
		const res = fakeRes();
		await handler(cronReq(), res);
		expect(JSON.parse(res.body).status).toBe('retired');
		expect(fetchMock).not.toHaveBeenCalled();
		expect(sendOpsAlert).not.toHaveBeenCalled();
		expect((await cacheGet('world:health')).status).toBe('retired');
	});

	it('probes and alerts as before when not retired', async () => {
		const fetchMock = vi.fn(async () => ({ ok: false, status: 404 }));
		vi.stubGlobal('fetch', fetchMock);
		const res = fakeRes();
		await handler(cronReq(), res);
		expect(JSON.parse(res.body).status).toBe('down');
		expect(fetchMock).toHaveBeenCalled();
		expect(sendOpsAlert).toHaveBeenCalled();
	});
});

describe('world retirement in the forge-health probe', () => {
	it('reports retired without probing world.three.ws', async () => {
		dbState.flagRow = { enabled: true, value: null };
		const fetchMock = vi.fn(async () => {
			throw new Error('network blocked');
		});
		vi.stubGlobal('fetch', fetchMock);
		const health = await probeForgeHealth({ force: true });
		expect(health.world.status).toBe('retired');
		expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('world.three.ws'))).toBe(false);
	});
});

// GET /healthz, the only HTTP surface the worker has and the one Cloud Run's
// probes read. Served by the real health server over a real socket, backed by
// the real adapter registry, the real drain loop and a real Postgres inbox
// (PGlite built from the shipped gateway migrations).

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createGatewayDb } from './_db.js';
import { telegramEnv } from './_telegram.js';

const holder = vi.hoisted(() => ({ db: null }));

vi.mock('../../../api/_lib/db.js', async (importOriginal) => {
	const actual = await importOriginal();
	return { ...actual, sql: (strings, ...values) => holder.db.sql(strings, ...values) };
});

const store = await import('../../../api/_lib/gateway/store.js');
const { startHealthServer } = await import('../src/health.js');
const { loadAdapters } = await import('../src/adapters/index.js');
const { createDrainer } = await import('../src/drain.js');
const { loadConfig } = await import('../src/config.js');

const quietLog = { debug() {}, info() {}, warn() {}, error() {} };
let server = null;

async function boot(env, extra = {}) {
	const config = { ...loadConfig({ PORT: '8080', ...env }), pollMs: 50 };
	const { adapters, skipped } = loadAdapters({ env, config, log: quietLog });
	const drainer = createDrainer({ adapters, config, log: quietLog });
	await drainer.tick();
	server = await startHealthServer({ port: 0, drainer, adapters, skipped, log: quietLog, ...extra });
	return { adapters, skipped, drainer };
}

async function get(path) {
	const { port } = server.address();
	const res = await fetch(`http://127.0.0.1:${port}${path}`);
	return { status: res.status, headers: res.headers, body: await res.json() };
}

beforeAll(async () => {
	holder.db = await createGatewayDb();
});

beforeEach(async () => {
	await holder.db.exec('TRUNCATE gateway_inbox RESTART IDENTITY CASCADE');
});

afterEach(async () => {
	if (server) await new Promise((resolve) => server.close(resolve));
	server = null;
});

describe('/healthz', () => {
	it('answers 200 with the loaded adapter, the open backlog, and why Discord was skipped', async () => {
		await store.enqueueInbox({ platform: 'telegram', dedupeKey: '1', chatKey: 'telegram:1', payload: { update_id: 1 } });
		await boot(telegramEnv);
		const { status, headers, body } = await get('/healthz');
		expect(status).toBe(200);
		expect(headers.get('cache-control')).toBe('no-store');
		expect(body.ok).toBe(true);
		expect(body.platforms).toEqual(['telegram']);
		expect(body.adapters).toEqual({ telegram: { bot: 'threewsbot', mode: 'webhook' } });
		expect(body.skipped).toEqual([
			{ platform: 'discord', missing: ['DISCORD_BOT_TOKEN', 'DISCORD_APP_ID'], reason: 'missing DISCORD_BOT_TOKEN, DISCORD_APP_ID' },
		]);
		expect(body.backlog).toMatchObject({ open: 1 });
		expect(typeof body.backlog.oldestSeconds).toBe('number');
	});

	it('serves the same report on / for the Cloud Run startup probe', async () => {
		await boot(telegramEnv);
		const { status, body } = await get('/');
		expect(status).toBe(200);
		expect(body.ok).toBe(true);
	});

	it('answers 503 and names every missing variable when no adapter loads', async () => {
		await boot({});
		const { status, body } = await get('/healthz');
		expect(status).toBe(503);
		expect(body.ok).toBe(false);
		expect(body.platforms).toEqual([]);
		expect(body.adapters).toEqual({});
		expect(body.skipped).toEqual([
			{ platform: 'telegram', missing: ['TELEGRAM_BOT_TOKEN'], reason: 'missing TELEGRAM_BOT_TOKEN' },
			{ platform: 'discord', missing: ['DISCORD_BOT_TOKEN', 'DISCORD_APP_ID'], reason: 'missing DISCORD_BOT_TOKEN, DISCORD_APP_ID' },
		]);
	});

	it('lists a platform left out by GATEWAY_PLATFORMS with that reason, not silently', async () => {
		await boot({ ...telegramEnv, GATEWAY_PLATFORMS: 'telegram' });
		const { body } = await get('/healthz');
		expect(body.skipped).toEqual([{ platform: 'discord', missing: [], reason: 'excluded by GATEWAY_PLATFORMS' }]);
	});

	it('still answers, with a null backlog, when the inbox cannot be read', async () => {
		await boot(telegramEnv, { backlog: async () => { throw new Error('connection refused'); } });
		const { status, body } = await get('/healthz');
		expect(status).toBe(200);
		expect(body.backlog).toBeNull();
	});

	it('answers 404 for any other path or method', async () => {
		await boot(telegramEnv);
		expect((await get('/metrics')).status).toBe(404);
		const { port } = server.address();
		expect((await fetch(`http://127.0.0.1:${port}/healthz`, { method: 'POST' })).status).toBe(404);
	});
});

describe('entry point', () => {
	it('imports without booting, so the image can prove its module graph at build time', async () => {
		const exit = vi.spyOn(process, 'exit').mockImplementation(() => undefined);
		const mod = await import('../src/index.js');
		expect(typeof mod.main).toBe('function');
		expect(exit).not.toHaveBeenCalled();
		exit.mockRestore();
	});
});

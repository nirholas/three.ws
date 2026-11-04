/**
 * api/_lib/ops/subsystem-health.js — unit tests.
 *
 * The gatherer reads each subsystem's in-process degradation state and rolls it
 * into one verdict. These pin the status vocabulary (ok/degraded/down/paused/
 * unknown), the roll-up (only degraded/down count against overall), and the two
 * cases the 2026-07-03 log export surfaced that a reachability probe can't see:
 * a half-armed x402 ring and an unprotected world.
 *
 * probeDb:false everywhere so the suite never needs a live Neon connection — the
 * DB ping has its own behavior (down when unreachable) that isn't the point here.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { gatherSubsystemHealth, classifySniperBeat } from '../api/_lib/ops/subsystem-health.js';
import { cacheSet, cacheDel } from '../api/_lib/cache.js';
import { Keypair } from '@solana/web3.js';

// Durable ops_alerts rows the world fallback reads. Default empty so every other
// case behaves as before; the world-fallback cases set it per test.
const dbState = vi.hoisted(() => ({ rows: [], throws: false, lastValues: null }));
vi.mock('../api/_lib/db.js', () => ({
	sql: async (strings, ...values) => {
		if (dbState.throws) throw new Error('db down');
		dbState.lastValues = values;
		return dbState.rows;
	},
}));

// Env the ring + x402-config checks read. Save/restore so cases don't leak.
const ENV_KEYS = [
	'X402_AUTONOMOUS_ENABLED',
	'X402_RING_PAUSED',
	'X402_EXTERNAL_ENABLED',
	'X402_CHARITY_AUDIT_BPS',
	'X402_SELF_FACILITATOR_ENABLED',
	'X402_FACILITATOR_URL_SOLANA',
	'X402_PAY_TO_SOLANA',
	'X402_PAY_TO',
	'X402_PAY_TO_BASE',
	'X402_FEE_PAYER_SOLANA',
	'THREE_TREASURY_WALLET',
	'THREE_REWARDS_WALLET',
	'THREE_QUOTE_SECRET',
	'THREE_BUYBACK_ENABLED',
	'THREE_BUYBACK_SECRET_KEY_B64',
	'THREE_MICROBUY_ENABLED',
	'THREE_MICROBUY_SECRET_KEY_B64',
	'NODE_ENV',
	'UPSTASH_CACHE_REST_URL',
	'UPSTASH_CACHE_REST_TOKEN',
	'UPSTASH_REDIS_REST_URL',
	'UPSTASH_REDIS_REST_TOKEN',
];
let saved;

function sub(health, name) {
	return health.subsystems.find((s) => s.name === name);
}

beforeEach(() => {
	saved = {};
	for (const k of ENV_KEYS) {
		saved[k] = process.env[k];
		delete process.env[k];
	}
});

afterEach(() => {
	for (const k of ENV_KEYS) {
		if (saved[k] === undefined) delete process.env[k];
		else process.env[k] = saved[k];
	}
});

describe('gatherSubsystemHealth', () => {
	it('reports the x402 ring as PAUSED when the loop is explicitly disabled', async () => {
		process.env.X402_AUTONOMOUS_ENABLED = 'false';
		const health = await gatherSubsystemHealth({ probeDb: false });
		const ring = sub(health, 'x402_ring');
		expect(ring.status).toBe('paused');
		// A paused ring is a chosen state, not a fault — must not drag overall down.
		expect(health.status).not.toBe('down');
	});

	it('reports the x402 ring as PAUSED via the dedicated X402_RING_PAUSED switch', async () => {
		delete process.env.X402_AUTONOMOUS_ENABLED;
		process.env.X402_RING_PAUSED = 'true';
		const health = await gatherSubsystemHealth({ probeDb: false });
		const ring = sub(health, 'x402_ring');
		expect(ring.status).toBe('paused');
		expect(ring.detail).toMatch(/X402_RING_PAUSED/);
	});

	it('reports the x402 ring as DEGRADED when enabled but guards are unset (half-armed)', async () => {
		// Enabled (not 'false') with the closed-loop guards unset — the exact
		// half-armed config the production log export showed.
		delete process.env.X402_AUTONOMOUS_ENABLED;
		delete process.env.X402_CHARITY_AUDIT_BPS;
		process.env.X402_SELF_FACILITATOR_ENABLED = 'false';
		const health = await gatherSubsystemHealth({ probeDb: false });
		const ring = sub(health, 'x402_ring');
		expect(ring.status).toBe('degraded');
		expect(ring.detail).toMatch(/half-armed/);
		expect(ring.hint).toBeTruthy();
		expect(health.status).toBe('degraded');
		expect(health.degraded).toContain('x402_ring');
	});

	it('reports the x402 ring as OK when all closed-loop guards are satisfied', async () => {
		delete process.env.X402_AUTONOMOUS_ENABLED;
		process.env.X402_EXTERNAL_ENABLED = 'false';
		process.env.X402_CHARITY_AUDIT_BPS = '0';
		process.env.X402_SELF_FACILITATOR_ENABLED = 'true';
		// Leave the facilitator URL unset so it defaults to self.
		const health = await gatherSubsystemHealth({ probeDb: false });
		expect(sub(health, 'x402_ring').status).toBe('ok');
	});

	it('flags x402 payment config as DEGRADED when Solana pay-to is set without a fee payer', async () => {
		process.env.X402_PAY_TO_SOLANA = 'THREEsynthetic1111111111111111111111111111111';
		delete process.env.X402_FEE_PAYER_SOLANA;
		const health = await gatherSubsystemHealth({ probeDb: false });
		const cfg = sub(health, 'x402_config');
		expect(cfg.status).toBe('degraded');
		expect(cfg.detail).toMatch(/fee.?payer/i);
	});

	it('flags the $THREE rail as DOWN in production when its receivers are unset', async () => {
		// The exact production state on 2026-09-20: none of the three vars set, so
		// every $THREE-priced purchase answered 503 while every reachability probe
		// stayed green. This check is the signature that condition never had.
		process.env.NODE_ENV = 'production';
		const health = await gatherSubsystemHealth({ probeDb: false });
		const rail = sub(health, 'three_token_rail');
		expect(rail.status).toBe('down');
		expect(rail.missing).toEqual([
			'THREE_TREASURY_WALLET',
			'THREE_REWARDS_WALLET',
			'THREE_QUOTE_SECRET',
		]);
		expect(health.degraded).toContain('three_token_rail');
	});

	it('names only the $THREE vars that are actually missing', async () => {
		process.env.NODE_ENV = 'production';
		process.env.THREE_TREASURY_WALLET = 'THREEsynthetic1111111111111111111111Treasury';
		process.env.THREE_QUOTE_SECRET = 'test-quote-signing-key';
		const health = await gatherSubsystemHealth({ probeDb: false });
		const rail = sub(health, 'three_token_rail');
		expect(rail.status).toBe('down');
		expect(rail.missing).toEqual(['THREE_REWARDS_WALLET']);
	});

	it('reports the $THREE rail as OK once all three are configured', async () => {
		process.env.NODE_ENV = 'production';
		process.env.THREE_TREASURY_WALLET = 'THREEsynthetic1111111111111111111111Treasury';
		process.env.THREE_REWARDS_WALLET = 'THREEsynthetic11111111111111111111111Rewards';
		process.env.THREE_QUOTE_SECRET = 'test-quote-signing-key';
		const health = await gatherSubsystemHealth({ probeDb: false });
		expect(sub(health, 'three_token_rail').status).toBe('ok');
	});

	it('flags the $THREE rail as DOWN when the rewards wallet is an armed buyback signer', async () => {
		const signer = Keypair.generate();
		process.env.NODE_ENV = 'production';
		process.env.THREE_TREASURY_WALLET = 'THREEsynthetic1111111111111111111111Treasury';
		process.env.THREE_REWARDS_WALLET = signer.publicKey.toBase58();
		process.env.THREE_QUOTE_SECRET = 'test-quote-signing-key';
		process.env.THREE_BUYBACK_ENABLED = '1';
		process.env.THREE_BUYBACK_SECRET_KEY_B64 = Buffer.from(signer.secretKey).toString('base64');
		const health = await gatherSubsystemHealth({ probeDb: false });
		const rail = sub(health, 'three_token_rail');
		expect(rail.status).toBe('down');
		expect(rail.conflict).toBe('rewards_wallet_is_signer');
		expect(rail.lanes).toEqual(['buyback']);
		expect(health.degraded).toContain('three_token_rail');
	});

	it('flags the micro-buy lane when it falls back to a buyback key equal to the rewards wallet', async () => {
		const signer = Keypair.generate();
		process.env.NODE_ENV = 'production';
		process.env.THREE_TREASURY_WALLET = 'THREEsynthetic1111111111111111111111Treasury';
		process.env.THREE_REWARDS_WALLET = signer.publicKey.toBase58();
		process.env.THREE_QUOTE_SECRET = 'test-quote-signing-key';
		process.env.THREE_MICROBUY_ENABLED = 'true';
		process.env.THREE_BUYBACK_SECRET_KEY_B64 = Buffer.from(signer.secretKey).toString('base64');
		const rail = sub(await gatherSubsystemHealth({ probeDb: false }), 'three_token_rail');
		expect(rail.conflict).toBe('rewards_wallet_is_signer');
		expect(rail.lanes).toEqual(['microbuy']);
	});

	it('stays OK when the rewards wallet matches a signer whose lane is not enabled', async () => {
		const signer = Keypair.generate();
		process.env.NODE_ENV = 'production';
		process.env.THREE_TREASURY_WALLET = 'THREEsynthetic1111111111111111111111Treasury';
		process.env.THREE_REWARDS_WALLET = signer.publicKey.toBase58();
		process.env.THREE_QUOTE_SECRET = 'test-quote-signing-key';
		process.env.THREE_BUYBACK_SECRET_KEY_B64 = Buffer.from(signer.secretKey).toString('base64');
		const rail = sub(await gatherSubsystemHealth({ probeDb: false }), 'three_token_rail');
		expect(rail.status).toBe('ok');
		expect(rail.conflict).toBeUndefined();
	});

	it('stays neutral outside production, where the $THREE dev fallbacks apply', async () => {
		process.env.NODE_ENV = 'test';
		const health = await gatherSubsystemHealth({ probeDb: false });
		const rail = sub(health, 'three_token_rail');
		expect(rail.status).toBe('unknown');
		expect(health.degraded).not.toContain('three_token_rail');
	});

	it('reports world as UNKNOWN when no world-health report has been parked', async () => {
		const health = await gatherSubsystemHealth({ probeDb: false });
		expect(sub(health, 'world').status).toBe('unknown');
	});

	it('reports world as DEGRADED (unprotected) from a parked world-health outcome', async () => {
		await cacheSet(
			'world:health',
			{ status: 'degraded', protected: false, problems: ['unprotected'], missingCount: 0, checkedAt: Date.now() },
			3600,
		);
		const health = await gatherSubsystemHealth({ probeDb: false });
		const world = sub(health, 'world');
		expect(world.status).toBe('degraded');
		expect(world.detail).toMatch(/UNPROTECTED/);
		expect(world.hint).toMatch(/ADMIN_CODE/);
	});

	describe('world durable fallback (order 453)', () => {
		afterEach(() => {
			dbState.rows = [];
			dbState.throws = false;
			dbState.lastValues = null;
		});

		it('reports DOWN from a fresh ops_alerts row when the cache entry is missing', async () => {
			await cacheDel('world:health');
			dbState.rows = [
				{
					detail: 'https://world.three.ws/status returned HTTP 404',
					last_seen: new Date(Date.now() - 4 * 60 * 1000).toISOString(),
				},
			];
			const health = await gatherSubsystemHealth({ probeDb: false });
			const world = sub(health, 'world');
			expect(world.status).toBe('down');
			expect(world.detail).toMatch(/HTTP 404/);
			expect(health.degraded).toContain('world');
		});

		it('reports DOWN from a fresh alert when the cache entry is stale', async () => {
			await cacheSet(
				'world:health',
				{ status: 'ok', protected: true, problems: [], checkedAt: Date.now() - 3 * 60 * 60 * 1000 },
				3600,
			);
			dbState.rows = [{ detail: 'unreachable - timeout', last_seen: new Date().toISOString() }];
			const health = await gatherSubsystemHealth({ probeDb: false });
			expect(sub(health, 'world').status).toBe('down');
			await cacheDel('world:health');
		});

		it('stays UNKNOWN when the only alert row is older than the cron window', async () => {
			await cacheDel('world:health');
			dbState.rows = [
				{ detail: 'old', last_seen: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString() },
			];
			const health = await gatherSubsystemHealth({ probeDb: false });
			expect(sub(health, 'world').status).toBe('unknown');
		});

		it('stays UNKNOWN when there is no alert row at all', async () => {
			await cacheDel('world:health');
			dbState.rows = [];
			const health = await gatherSubsystemHealth({ probeDb: false });
			expect(sub(health, 'world').status).toBe('unknown');
		});

		it('degrades to cache-only UNKNOWN when the database read fails', async () => {
			await cacheDel('world:health');
			dbState.throws = true;
			const health = await gatherSubsystemHealth({ probeDb: false });
			expect(sub(health, 'world').status).toBe('unknown');
		});

		it('queries only the two down signatures the cron writes (sha256 prefix of the literal)', async () => {
			await cacheDel('world:health');
			await gatherSubsystemHealth({ probeDb: false });
			const { createHash } = await import('node:crypto');
			const h = (t) => createHash('sha256').update(t).digest('hex').slice(0, 16);
			expect(dbState.lastValues).toEqual([h('world-health:status-http'), h('world-health:status-unreachable')]);
		});
	});

	it('reports world as DOWN from a parked world-health outcome', async () => {
		await cacheSet(
			'world:health',
			{ status: 'down', protected: null, problems: ['HTTP 503'], missingCount: 0, checkedAt: Date.now() },
			3600,
		);
		const health = await gatherSubsystemHealth({ probeDb: false });
		const world = sub(health, 'world');
		expect(world.status).toBe('down');
		expect(world.detail).toMatch(/503/);
		expect(health.status).toBe('down');
		expect(health.degraded).toContain('world');
		await cacheDel('world:health');
	});

	it('reports cache as OK on the in-memory backend when no Redis is configured', async () => {
		const health = await gatherSubsystemHealth({ probeDb: false });
		const cache = sub(health, 'cache');
		expect(cache.status).toBe('ok');
		expect(cache.backend).toBe('memory');
	});

	it('reports Helius as OK (public RPC) when no Helius key is configured', async () => {
		const health = await gatherSubsystemHealth({ probeDb: false });
		expect(sub(health, 'helius').status).toBe('ok');
	});

	it('skips the DB ping when probeDb is false (database → unknown, not down)', async () => {
		const health = await gatherSubsystemHealth({ probeDb: false });
		expect(sub(health, 'database').status).toBe('unknown');
	});

	it('skips the sniper heartbeat probe when probeDb is false (sniper → unknown)', async () => {
		const health = await gatherSubsystemHealth({ probeDb: false });
		expect(sub(health, 'sniper').status).toBe('unknown');
	});

	it('rolls the overall verdict to the worst subsystem and lists degraded names', async () => {
		process.env.X402_PAY_TO_SOLANA = 'THREEsynthetic1111111111111111111111111111111';
		delete process.env.X402_FEE_PAYER_SOLANA; // → x402_config degraded
		const health = await gatherSubsystemHealth({ probeDb: false });
		expect(health.status).toBe('degraded');
		expect(health.degraded).toContain('x402_config');
		// Counts is a tally of every status bucket.
		expect(Object.values(health.counts).reduce((a, b) => a + b, 0)).toBe(health.subsystems.length);
	});
});

// The sniper-worker heartbeat classifier — pins the exact failure that went
// unpaged on 2026-07-03: heartbeat frozen for 36h while /api/oracle/stats
// flat-lined at scored_24h=0. A stale beat must classify as DOWN (which the
// uptime cron escalates to Telegram), not blend into "ok".
describe('classifySniperBeat', () => {
	const NOW = 1_800_000_000_000;
	const beat = (ageMs, meta = {}, mode = 'live') => ({
		mode,
		last_beat_at: new Date(NOW - ageMs).toISOString(),
		meta,
	});
	const liveMeta = { feedConnected: true, lastEventAgeMs: 2_000, feedWatchdogMs: 180_000, strategies: 6 };

	it('reports UNKNOWN when no heartbeat row exists (fresh deploy, never started)', () => {
		expect(classifySniperBeat(null, NOW).status).toBe('unknown');
	});

	it('reports OK for a fresh beat with a live feed', () => {
		const s = classifySniperBeat(beat(30_000, liveMeta), NOW);
		expect(s.status).toBe('ok');
		expect(s.detail).toContain('mode=live');
	});

	it('reports DOWN with a redeploy hint once the heartbeat is stale (the 2026-07-03 outage)', () => {
		const s = classifySniperBeat(beat(36 * 3_600_000, liveMeta), NOW);
		expect(s.status).toBe('down');
		expect(s.detail).toContain('2160 min');
		expect(s.hint).toContain('deploy:sniper');
	});

	it('reports DEGRADED between fresh and dead (mid-restart window)', () => {
		expect(classifySniperBeat(beat(3 * 60_000, liveMeta), NOW).status).toBe('degraded');
	});

	it('reports DEGRADED when alive but the feed is disconnected', () => {
		const s = classifySniperBeat(beat(30_000, { ...liveMeta, feedConnected: false }), NOW);
		expect(s.status).toBe('degraded');
		expect(s.detail).toContain('feed');
	});

	it('reports DEGRADED when alive but the feed has been silent past its watchdog window', () => {
		const s = classifySniperBeat(beat(30_000, { ...liveMeta, lastEventAgeMs: 240_000 }), NOW);
		expect(s.status).toBe('degraded');
	});

	it('treats a row with no last_beat_at as DOWN, not ok', () => {
		expect(classifySniperBeat({ mode: 'live', last_beat_at: null, meta: {} }, NOW).status).toBe('down');
	});

	// Solvency: the 2026-07-29 outage shape. Fresh heartbeat, live feed, strategies
	// armed, and every wallet too poor to place a buy. This block used to report OK
	// for ten days while the fleet booked 1,000+ failed entries and closed nothing.
	it('reports DOWN when the process is healthy but no wallet can fund a trade', () => {
		const s = classifySniperBeat(
			beat(30_000, { ...liveMeta, solvency: { state: 'starved', agents: 2, starved: 2, tradeable: 0, deficitSol: 0.13, masterSol: 0.0018, masterCanCover: false } }),
			NOW,
		);
		expect(s.status).toBe('down');
		expect(s.detail).toContain('out of trading capital');
		// The master held dust, so the hint must name the human action.
		expect(s.hint).toContain('move SOL');
	});

	it('reports DEGRADED when only part of the fleet can still trade', () => {
		const s = classifySniperBeat(
			beat(30_000, { ...liveMeta, solvency: { state: 'degraded', agents: 3, starved: 1, tradeable: 2, deficitSol: 0.05, masterSol: 5, masterCanCover: true } }),
			NOW,
		);
		expect(s.status).toBe('degraded');
		expect(s.hint).toContain('auto-funder');
	});

	it('ranks starvation above a silent feed: the more actionable diagnosis wins', () => {
		const s = classifySniperBeat(
			beat(30_000, { ...liveMeta, lastEventAgeMs: 240_000, solvency: { state: 'starved', agents: 1, starved: 1, tradeable: 0, deficitSol: 0.06, masterSol: 0, masterCanCover: false } }),
			NOW,
		);
		expect(s.status).toBe('down');
		expect(s.detail).toContain('out of trading capital');
	});

	it('still reports OK when the fleet is funded', () => {
		const s = classifySniperBeat(
			beat(30_000, { ...liveMeta, solvency: { state: 'funded', agents: 2, starved: 0, tradeable: 2, deficitSol: 0 } }),
			NOW,
		);
		expect(s.status).toBe('ok');
	});

	it('does not downgrade a worker build that reports no solvency at all', () => {
		// Older revisions publish no solvency key. Absence is not insolvency, or
		// every pre-upgrade deploy would page as broken.
		expect(classifySniperBeat(beat(30_000, liveMeta), NOW).status).toBe('ok');
		expect(classifySniperBeat(beat(30_000, { ...liveMeta, solvency: null }), NOW).status).toBe('ok');
		expect(classifySniperBeat(beat(30_000, { ...liveMeta, solvency: { state: 'unknown' } }), NOW).status).toBe('ok');
	});
});

describe('database_storage subsystem', () => {
	const top = [
		{ table: 'a', mb: 900 },
		{ table: 'b', mb: 500 },
		{ table: 'c', mb: 300 },
		{ table: 'd', mb: 10 },
	];

	it('is ok below 75% of the mark and names the top 3 tables', async () => {
		const { classifyDatabaseStorage } = await import('../api/_lib/ops/database-storage-health.js');
		const r = classifyDatabaseStorage({ sizeMb: 1000, markMb: 2000, topTables: top });
		expect(r.status).toBe('ok');
		expect(r.detail).toContain('a 900MB, b 500MB, c 300MB');
		expect(r.detail).not.toContain('d 10MB');
	});

	it('is degraded from 75% up to the mark', async () => {
		const { classifyDatabaseStorage } = await import('../api/_lib/ops/database-storage-health.js');
		expect(classifyDatabaseStorage({ sizeMb: 1500, markMb: 2000 }).status).toBe('degraded');
		expect(classifyDatabaseStorage({ sizeMb: 2000, markMb: 2000 }).status).toBe('degraded');
	});

	it('is down above the mark and carries the last retention run', async () => {
		const { classifyDatabaseStorage } = await import('../api/_lib/ops/database-storage-health.js');
		const lastRun = { at: '2026-11-03T12:00:00.000Z', size_before_mb: 2100, size_after_mb: 2090, deleted: 5 };
		const r = classifyDatabaseStorage({ sizeMb: 2001, markMb: 2000, topTables: top, lastRun });
		expect(r.status).toBe('down');
		expect(r.detail).toContain('2026-11-03T12:00:00.000Z');
		expect(r.hint).toMatch(/db-archive-table/);
	});

	it('reads the mark from DB_RETENTION_HIGH_WATER_MB and rolls up into the overall verdict', async () => {
		const { highWaterMb } = await import('../api/_lib/ops/database-storage-health.js');
		expect(highWaterMb({ DB_RETENTION_HIGH_WATER_MB: '20992' })).toBe(20992);
		expect(highWaterMb({})).toBe(470);
		const r = await gatherSubsystemHealth({ probeDb: false });
		expect(r.subsystems.find((s) => s.name === 'database_storage')?.status).toBe('unknown');
	});
});

// Order 268: the rpc_lanes subsystem carries the 24h call ledger so healthz
// answers "who is spending the quota" without a separate tool.
describe('rpc_lanes call ledger', () => {
	let spend;
	beforeEach(async () => {
		spend = await import('../api/_lib/solana/rpc-spend.js');
		spend._resetRpcSpend();
		// The ledger lives in the shared cache (memory here), so drop every hourly
		// index the window could read; otherwise one case's shard leaks into the next.
		const hour = spend.hourStart(Date.now());
		for (let h = 0; h <= 25; h++) await cacheDel(`${spend.SPEND_PREFIX}:idx:${hour - h * 3_600_000}`);
	});

	it('adds calls_24h, saved_24h and the top caller to the detail, the metrics and each lane row', async () => {
		const first = sub(await gatherSubsystemHealth({ probeDb: false }), 'rpc_lanes');
		expect(first.lanes.length).toBeGreaterThan(0);
		const host = new URL(first.lanes[0].url).host;
		const now = Date.now();
		for (let i = 0; i < 7; i++) spend.recordRpcSpend({ lane: host, methods: ['getAccountInfo'], caller: '/api/crypto/security', now });
		for (let i = 0; i < 3; i++) spend.recordRpcSpend({ lane: host, methods: ['getBalance'], caller: '/api/wallet/balance', now });
		for (let i = 0; i < 4; i++) spend.recordRpcSpend({ lane: 'cache', methods: ['getAccountInfo'], caller: '/api/crypto/holders', now });
		await spend.flushRpcSpend(now);

		const lanes = sub(await gatherSubsystemHealth({ probeDb: false }), 'rpc_lanes');
		expect(lanes.metrics.calls_24h).toBe(10);
		expect(lanes.metrics.saved_24h).toBe(4);
		expect(lanes.metrics.top_caller).toBe('/api/crypto/security');
		expect(lanes.metrics.top_caller_calls_24h).toBe(7);
		expect(lanes.detail).toMatch(/; 10 calls\/24h, top \/api\/crypto\/security \(7\)$/);
		expect(lanes.lanes[0].calls_24h).toBe(10);
		expect(lanes.lanes.slice(1).every((l) => l.calls_24h === 0 || new URL(l.url).host === host)).toBe(true);
		// The lane verdict itself does not depend on the ledger.
		expect(lanes.status).toBe(first.status);
	});

	it('reports zero calls and no top caller on an empty ledger', async () => {
		const lanes = sub(await gatherSubsystemHealth({ probeDb: false }), 'rpc_lanes');
		expect(lanes.metrics.calls_24h).toBe(0);
		expect(lanes.metrics.top_caller).toBeNull();
		expect(lanes.detail).toMatch(/; 0 calls\/24h$/);
	});
});

// Order 279: /api/guardian/assess answered 503 guardian_unconfigured in
// production for weeks while every probe stayed green. granite_guardian gives
// that state a signature, and probes the self-hosted vLLM lane's /health when
// one is wired. The upstream here is a real local HTTP server, not a fetch mock.
describe('granite_guardian subsystem', () => {
	const GUARDIAN_KEYS = [
		'GRANITE_GUARDIAN_URL',
		'GRANITE_GUARDIAN_API_KEY',
		'GRANITE_GUARDIAN_MODEL_ID',
		'GCP_RECONSTRUCTION_KEY',
		'WATSONX_API_KEY',
		'WATSONX_PROJECT_ID',
		'WATSONX_SPACE_ID',
	];
	let guardianSaved;
	let server;
	let healthStatus;
	let healthHits;

	async function startUpstream() {
		const { createServer } = await import('node:http');
		server = createServer((req, res) => {
			if (req.url === '/health') healthHits++;
			res.writeHead(req.url === '/health' ? healthStatus : 404);
			res.end();
		});
		await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
		return `http://127.0.0.1:${server.address().port}`;
	}

	beforeEach(() => {
		guardianSaved = {};
		for (const k of GUARDIAN_KEYS) {
			guardianSaved[k] = process.env[k];
			delete process.env[k];
		}
		healthStatus = 200;
		healthHits = 0;
	});

	afterEach(async () => {
		for (const k of GUARDIAN_KEYS) {
			if (guardianSaved[k] === undefined) delete process.env[k];
			else process.env[k] = guardianSaved[k];
		}
		if (server) await new Promise((resolve) => server.close(resolve));
		server = null;
	});

	it('is DOWN in production when no Granite Guardian lane is configured', async () => {
		process.env.NODE_ENV = 'production';
		const health = await gatherSubsystemHealth({ probeDb: false });
		const g = sub(health, 'granite_guardian');
		expect(g.status).toBe('down');
		expect(g.detail).toMatch(/guardian_unconfigured/);
		expect(g.missing).toEqual(['GRANITE_GUARDIAN_URL']);
		expect(g.hint).toMatch(/workers\/granite-guardian/);
		expect(health.degraded).toContain('granite_guardian');
	});

	it('names the missing bearer when the self-hosted URL is set without a key', async () => {
		process.env.NODE_ENV = 'production';
		process.env.GRANITE_GUARDIAN_URL = 'http://127.0.0.1:9';
		const g = sub(await gatherSubsystemHealth({ probeDb: false }), 'granite_guardian');
		expect(g.status).toBe('down');
		expect(g.missing).toEqual(['GRANITE_GUARDIAN_API_KEY or GCP_RECONSTRUCTION_KEY']);
	});

	it('stays neutral outside production when nothing is configured', async () => {
		process.env.NODE_ENV = 'test';
		const health = await gatherSubsystemHealth({ probeDb: false });
		expect(sub(health, 'granite_guardian').status).toBe('unknown');
		expect(health.degraded).not.toContain('granite_guardian');
	});

	it('is OK when the self-hosted lane answers /health', async () => {
		process.env.NODE_ENV = 'production';
		process.env.GRANITE_GUARDIAN_URL = `${await startUpstream()}/`;
		process.env.GCP_RECONSTRUCTION_KEY = 'test-worker-bearer';
		const g = sub(await gatherSubsystemHealth({ probeDb: false }), 'granite_guardian');
		expect(healthHits).toBe(1);
		expect(g.status).toBe('ok');
		expect(g.detail).toMatch(/^self-hosted ibm-granite\/granite-guardian-3\.3-8b healthy/);
		expect(g.metrics.lanes).toEqual(['self-hosted']);
		expect(typeof g.metrics.latency_ms).toBe('number');
	});

	it('is DOWN when the only lane fails its /health probe', async () => {
		process.env.NODE_ENV = 'production';
		healthStatus = 503;
		process.env.GRANITE_GUARDIAN_URL = await startUpstream();
		process.env.GRANITE_GUARDIAN_API_KEY = 'test-guardian-bearer';
		const g = sub(await gatherSubsystemHealth({ probeDb: false }), 'granite_guardian');
		expect(g.status).toBe('down');
		expect(g.detail).toMatch(/self-hosted \/health answered 503/);
	});

	it('is DEGRADED when the self-hosted lane fails but watsonx is still configured', async () => {
		process.env.NODE_ENV = 'production';
		healthStatus = 503;
		process.env.GRANITE_GUARDIAN_URL = await startUpstream();
		process.env.GRANITE_GUARDIAN_API_KEY = 'test-guardian-bearer';
		process.env.WATSONX_API_KEY = 'test-watsonx-key';
		process.env.WATSONX_PROJECT_ID = 'test-project';
		const g = sub(await gatherSubsystemHealth({ probeDb: false }), 'granite_guardian');
		expect(g.status).toBe('degraded');
		expect(g.metrics.lanes).toEqual(['watsonx', 'self-hosted']);
	});

	it('is OK on the watsonx lane alone, without a network probe', async () => {
		process.env.NODE_ENV = 'production';
		process.env.WATSONX_API_KEY = 'test-watsonx-key';
		process.env.WATSONX_SPACE_ID = 'test-space';
		const g = sub(await gatherSubsystemHealth({ probeDb: false }), 'granite_guardian');
		expect(g.status).toBe('ok');
		expect(g.detail).toMatch(/watsonx/);
		expect(g.metrics.lanes).toEqual(['watsonx']);
	});
});

// Order 726: with no Telegram chat and no alert recipients, every alert lands in
// ops_alerts and nobody is told. alerts_push gives that state a signature and
// names the exact vars, so a silent dashboard-only production reads as a gap.
describe('alerts_push subsystem', () => {
	const ALERT_KEYS = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_ALERTS_CHAT_ID', 'OPS_ALERT_EMAILS', 'RESEND_API_KEY'];
	let alertSaved;
	beforeEach(() => {
		alertSaved = {};
		for (const k of ALERT_KEYS) {
			alertSaved[k] = process.env[k];
			delete process.env[k];
		}
	});
	afterEach(() => {
		for (const k of ALERT_KEYS) {
			if (alertSaved[k] === undefined) delete process.env[k];
			else process.env[k] = alertSaved[k];
		}
	});

	it('is DEGRADED in production when neither push channel is wired, naming every var', async () => {
		process.env.NODE_ENV = 'production';
		const health = await gatherSubsystemHealth({ probeDb: false });
		const a = sub(health, 'alerts_push');
		expect(a.status).toBe('degraded');
		expect(a.missing).toEqual(['OPS_ALERT_EMAILS', 'RESEND_API_KEY', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_ALERTS_CHAT_ID']);
		expect(a.hint).toMatch(/--update-env-vars OPS_ALERT_EMAILS=/);
		expect(a.hint).not.toMatch(/--set-env-vars/);
		expect(health.degraded).toContain('alerts_push');
	});

	it('names only the recipient list when Resend is already configured', async () => {
		process.env.NODE_ENV = 'production';
		process.env.RESEND_API_KEY = 're_test_key';
		const a = sub(await gatherSubsystemHealth({ probeDb: false }), 'alerts_push');
		expect(a.status).toBe('degraded');
		expect(a.missing).toEqual(['OPS_ALERT_EMAILS', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_ALERTS_CHAT_ID']);
	});

	it('flags addresses it had to drop', async () => {
		process.env.NODE_ENV = 'production';
		process.env.RESEND_API_KEY = 're_test_key';
		process.env.OPS_ALERT_EMAILS = 'not-an-address';
		const a = sub(await gatherSubsystemHealth({ probeDb: false }), 'alerts_push');
		expect(a.status).toBe('degraded');
		expect(a.detail).toMatch(/not-an-address/);
	});

	it('is OK once email is wired, and reports a half-set Telegram as a gap in the detail', async () => {
		process.env.NODE_ENV = 'production';
		process.env.RESEND_API_KEY = 're_test_key';
		process.env.OPS_ALERT_EMAILS = 'ops@three.ws';
		process.env.TELEGRAM_BOT_TOKEN = 'bot-token';
		const a = sub(await gatherSubsystemHealth({ probeDb: false }), 'alerts_push');
		expect(a.status).toBe('ok');
		expect(a.metrics).toEqual({ telegram: false, email: true, email_recipients: 1 });
		expect(a.detail).toMatch(/TELEGRAM_ALERTS_CHAT_ID/);
	});

	it('is OK with Telegram alone', async () => {
		process.env.NODE_ENV = 'production';
		process.env.TELEGRAM_BOT_TOKEN = 'bot-token';
		process.env.TELEGRAM_ALERTS_CHAT_ID = '-1001234567890';
		const a = sub(await gatherSubsystemHealth({ probeDb: false }), 'alerts_push');
		expect(a.status).toBe('ok');
	});

	it('stays neutral outside production', async () => {
		process.env.NODE_ENV = 'test';
		const health = await gatherSubsystemHealth({ probeDb: false });
		expect(sub(health, 'alerts_push').status).toBe('unknown');
		expect(health.degraded).not.toContain('alerts_push');
	});
});

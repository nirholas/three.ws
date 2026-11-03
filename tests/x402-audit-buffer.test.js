// Tests for the x402 audit-log write buffer (api/_lib/x402/audit-log.js).
//
// Hot paid routes queue one audit write per request. Firing each as its own Neon
// HTTP fetch turned a slow-DB spell into a self-amplifying storm, so writes are
// coalesced into a Redis list and drained by a batch flusher off the request path
// (the same buffer→cron pattern as usage events). These tests cover:
//   1. logPaymentEvent pushes to the Redis buffer instead of hitting Postgres.
//   2. logPaymentEvent falls back to a bounded direct insert when Redis is absent.
//   3. flushAuditBuffer drains the buffer as ONE multi-row INSERT and trims it.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Fakes ─────────────────────────────────────────────────────────────────────
// A minimal in-memory Redis list supporting exactly the ops the buffer uses.
function makeFakeRedis() {
	const lists = new Map();
	const get = (k) => lists.get(k) ?? [];
	const BUFFER = 'x402:audit:buffer';
	return {
		_list: (k = BUFFER) => get(k),
		_set: (v) => { lists.set(BUFFER, v); },
		rpush: vi.fn(async (k, ...vals) => { const l = get(k).concat(vals); lists.set(k, l); return l.length; }),
		lrange: vi.fn(async (k, start, stop) => get(k).slice(start, stop + 1)),
		ltrim: vi.fn(async (k, start, stop) => { lists.set(k, get(k).slice(start, stop === -1 ? undefined : stop + 1)); }),
		llen: vi.fn(async (k) => get(k).length),
		expire: vi.fn(async () => 1),
	};
}

let fakeRedis = null; // null → Redis unavailable
const sqlCalls = [];
const sqlImpl = vi.fn(async (...args) => { sqlCalls.push(args); return []; });

vi.mock('../api/_lib/redis.js', () => ({
	getRedis: () => fakeRedis,
	isRedisAuthError: () => false,
}));
vi.mock('../api/_lib/db.js', () => ({ sql: (...args) => sqlImpl(...args), isDbUnavailableError: () => false, isDbCapacityError: () => false }));
// Pass-through retry wrapper so the direct-insert path actually calls sql.
vi.mock('../api/_lib/db-retry.js', () => ({ withDbRetry: (run) => run() }));

const { logPaymentEvent, flushAuditBuffer } = await import('../api/_lib/x402/audit-log.js');

// logPaymentEvent runs its work in a queueMicrotask; let it settle.
const settle = () => new Promise((r) => setTimeout(r, 0));

const EVENT = {
	eventType: 'siwx_grant',
	route: '/api/x402/dance-tip',
	payer: 'Payer1111111111111111111111111111111111111',
	network: 'solana:mainnet',
	amountAtomics: '1000',
	metadata: { ttlSeconds: 3600 },
};

beforeEach(() => {
	fakeRedis = makeFakeRedis();
	sqlCalls.length = 0;
	sqlImpl.mockClear();
});

describe('logPaymentEvent — buffered write path', () => {
	it('pushes to the Redis buffer and does NOT touch Postgres', async () => {
		logPaymentEvent(EVENT);
		await settle();
		expect(fakeRedis.rpush).toHaveBeenCalledTimes(1);
		expect(sqlImpl).not.toHaveBeenCalled();
		// The buffered record is a normalized positional row (14 columns).
		const stored = JSON.parse(fakeRedis._list()[0]);
		expect(Array.isArray(stored)).toBe(true);
		expect(stored).toHaveLength(14);
		expect(stored[0]).toBe('siwx_grant');
		expect(stored[1]).toBe('/api/x402/dance-tip');
		// JSON columns are pre-stringified in the record.
		expect(stored[13]).toBe(JSON.stringify({ ttlSeconds: 3600 }));
	});

	it('sets the buffer TTL exactly once (on the first push)', async () => {
		logPaymentEvent(EVENT);
		await settle();
		logPaymentEvent(EVENT);
		await settle();
		expect(fakeRedis.expire).toHaveBeenCalledTimes(1);
	});

	it('falls back to a bounded direct insert when Redis is unavailable', async () => {
		fakeRedis = null;
		logPaymentEvent(EVENT);
		await settle();
		expect(sqlImpl).toHaveBeenCalledTimes(1);
		const [text, params] = sqlCalls[0];
		expect(text).toMatch(/INSERT INTO x402_audit_log/);
		expect(text).toMatch(/VALUES \(\$1/);
		expect(params).toHaveLength(14);
		expect(params[0]).toBe('siwx_grant');
	});
});

describe('flushAuditBuffer — batched drain', () => {
	it('drains many rows as ONE multi-row INSERT and empties the buffer', async () => {
		// Seed 3 buffered rows directly.
		for (let i = 0; i < 3; i++) { logPaymentEvent({ ...EVENT, amountAtomics: String(i) }); await settle(); }
		expect(fakeRedis._list()).toHaveLength(3);

		const res = await flushAuditBuffer({ limit: 100 });
		expect(res.flushed).toBe(3);
		expect(res.remaining).toBe(0);
		expect(res.errors).toBe(0);
		// A single INSERT statement carried all three rows: 3 rows × 14 cols = 42 params.
		expect(sqlImpl).toHaveBeenCalledTimes(1);
		const [text, params] = sqlCalls[0];
		expect(text).toMatch(/^INSERT INTO x402_audit_log/);
		expect(params).toHaveLength(42);
		// JSONB columns get a ::jsonb cast on their placeholders.
		expect(text).toContain('::jsonb');
		expect(fakeRedis._list()).toHaveLength(0);
	});

	it('no-ops cleanly when Redis is unavailable', async () => {
		fakeRedis = null;
		const res = await flushAuditBuffer({ limit: 100 });
		expect(res).toMatchObject({ flushed: 0, skipped: 'redis_unavailable' });
		expect(sqlImpl).not.toHaveBeenCalled();
	});

	it('moves rows to the dead-letter list when the batch INSERT fails (no loss, no infinite retry)', async () => {
		logPaymentEvent(EVENT); await settle();
		sqlImpl.mockRejectedValueOnce(new Error('db query exceeded 3000ms deadline'));
		const res = await flushAuditBuffer({ limit: 100 });
		expect(res.errors).toBe(1);
		expect(res.remaining).toBe(0); // the buffer is drained, not re-read forever
		expect(fakeRedis._list()).toHaveLength(0);
		expect(fakeRedis._list('x402:audit:dead')).toHaveLength(1); // and the row survives
	});
});

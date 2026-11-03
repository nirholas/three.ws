// Durability tests for the x402 payment audit ledger (api/_lib/x402/audit-log.js).
//
// The ledger used to drop rows silently: a failed or timed-out batch insert was
// trimmed off the Redis buffer anyway, the table had no uniqueness on the
// transaction hash so a replay could double-write, and the overflow cap shed the
// oldest rows. These tests pin the replacement behaviour:
//   (a) a flush whose insert throws leaves the events in the dead-letter list,
//   (b) replaying the same (tx_hash, event_type) inserts once,
//   (c) a flush whose insert hangs past the timeout re-queues instead of dropping,
//   (d) a flush drains in batches, in order,
//   (e) a later drain moves dead-lettered rows into the table, one per tx hash,
//   (f) rows are not trimmed off the buffer when the dead-letter push itself fails,
//   (g) a row that keeps failing is parked in the durable dead-letter table.

import { describe, it, expect, vi, beforeEach } from 'vitest';

function makeFakeRedis() {
	const lists = new Map();
	const get = (k) => lists.get(k) ?? [];
	return {
		_list: (k) => get(k),
		_failRpushFor: null,
		rpush: vi.fn(async function (k, ...vals) {
			if (this && this._failRpushFor === k) throw new Error('redis down');
			const l = get(k).slice();
			l.push(...vals);
			lists.set(k, l);
			return l.length;
		}),
		lrange: vi.fn(async (k, s, e) => get(k).slice(s, e === -1 ? undefined : e + 1)),
		ltrim: vi.fn(async (k, s, e) => { lists.set(k, get(k).slice(s, e === -1 ? undefined : e + 1)); }),
		llen: vi.fn(async (k) => get(k).length),
		expire: vi.fn(async () => 1),
	};
}

let fakeRedis = null;

// In-memory stand-in for the two tables, honouring the unique index only when the
// statement says ON CONFLICT DO NOTHING (exactly what Postgres does).
const table = [];
const deadTable = [];
let dbMode = 'ok'; // 'ok' | 'throw' | 'hang'
const insertBatches = [];

const sqlImpl = vi.fn(async (text, params) => {
	if (typeof text !== 'string') return [];
	if (text.startsWith('INSERT INTO x402_audit_log')) {
		if (dbMode === 'throw') throw new Error('connection terminated');
		if (dbMode === 'hang') return new Promise(() => {});
		const cols = 14;
		const batch = [];
		for (let i = 0; i < params.length; i += cols) batch.push(params.slice(i, i + cols));
		insertBatches.push(batch.map((r) => r[7]));
		const conflict = /ON CONFLICT/i.test(text);
		for (const row of batch) {
			const dup = row[7] != null && table.some((t) => t[7] === row[7] && t[0] === row[0]);
			if (dup && conflict) continue;
			if (dup) throw new Error('duplicate key value violates unique constraint');
			table.push(row);
		}
		return [];
	}
	if (text.startsWith('INSERT INTO x402_audit_dead_letter')) {
		if (dbMode === 'throw') throw new Error('connection terminated');
		deadTable.push(params);
		return [];
	}
	return [];
});

vi.mock('../api/_lib/redis.js', () => ({
	getRedis: () => fakeRedis,
	isRedisAuthError: () => false,
}));
vi.mock('../api/_lib/db.js', () => ({
	sql: (...a) => sqlImpl(...a),
	isDbUnavailableError: () => false,
	isDbCapacityError: () => false,
}));
vi.mock('../api/_lib/db-retry.js', () => ({ withDbRetry: (run) => run() }));

const { logPaymentEvent, flushAuditBuffer, drainAuditDeadLetter, getAuditDeadLetterStats } =
	await import('../api/_lib/x402/audit-log.js');

const settle = () => new Promise((r) => setTimeout(r, 0));
const BUFFER = 'x402:audit:buffer';
const DEAD = 'x402:audit:dead';

const ev = (n, extra = {}) => ({
	eventType: 'payment_settled',
	route: '/api/x402/dance-tip',
	payer: 'Payer1111111111111111111111111111111111111',
	network: 'solana:mainnet',
	amountAtomics: '1000',
	txHash: `THREEsynthetic${String(n).padStart(4, '0')}`,
	...extra,
});

async function enqueue(events) {
	for (const e of events) logPaymentEvent(e);
	await settle();
}

beforeEach(() => {
	fakeRedis = makeFakeRedis();
	table.length = 0;
	deadTable.length = 0;
	insertBatches.length = 0;
	dbMode = 'ok';
	sqlImpl.mockClear();
});

describe('flushAuditBuffer durability', () => {
	it('(a) keeps events in the dead-letter list when the insert throws', async () => {
		await enqueue([ev(1), ev(2), ev(3)]);
		dbMode = 'throw';
		const res = await flushAuditBuffer();
		expect(res.errors).toBe(1);
		expect(table).toHaveLength(0);
		expect(fakeRedis._list(BUFFER)).toHaveLength(0);
		expect(fakeRedis._list(DEAD)).toHaveLength(3);
		const first = JSON.parse(fakeRedis._list(DEAD)[0]);
		expect(first.attempts).toBe(1);
		expect(first.row[7]).toBe('THREEsynthetic0001');
		expect(first.error).toMatch(/connection terminated/);
	});

	it('(b) replaying the same tx hash and event type inserts once', async () => {
		await enqueue([ev(1)]);
		await flushAuditBuffer();
		await enqueue([ev(1)]);
		const res = await flushAuditBuffer();
		expect(res.errors).toBe(0);
		expect(table).toHaveLength(1);
		expect(fakeRedis._list(DEAD)).toHaveLength(0);
	});

	it('(b2) the same tx hash under a different event type is a different row', async () => {
		await enqueue([ev(1), ev(1, { eventType: 'siwx_grant' })]);
		await flushAuditBuffer();
		expect(table).toHaveLength(2);
	});

	it('(c) a flush that hangs past the timeout re-queues instead of discarding', async () => {
		await enqueue([ev(1), ev(2)]);
		dbMode = 'hang';
		const res = await flushAuditBuffer({ insertTimeoutMs: 20 });
		expect(res.errors).toBe(1);
		expect(fakeRedis._list(BUFFER)).toHaveLength(0);
		expect(fakeRedis._list(DEAD)).toHaveLength(2);
		expect(JSON.parse(fakeRedis._list(DEAD)[0]).error).toMatch(/timed out/i);
	});

	it('(d) drains in batches of 200, preserving order', async () => {
		const events = Array.from({ length: 450 }, (_, i) => ev(i));
		await enqueue(events);
		const res = await flushAuditBuffer({ limit: 1000 });
		expect(res.flushed).toBe(450);
		expect(insertBatches.map((b) => b.length)).toEqual([200, 200, 50]);
		expect(insertBatches.flat()).toEqual(events.map((e) => e.txHash));
		expect(fakeRedis._list(BUFFER)).toHaveLength(0);
	});

	it('stops at the first failed batch and leaves later batches buffered', async () => {
		await enqueue(Array.from({ length: 450 }, (_, i) => ev(i)));
		dbMode = 'throw';
		const res = await flushAuditBuffer({ limit: 1000 });
		expect(res.errors).toBe(1);
		expect(fakeRedis._list(DEAD)).toHaveLength(200);
		expect(fakeRedis._list(BUFFER)).toHaveLength(250);
	});

	it('(f) does not trim the buffer when the dead-letter push also fails', async () => {
		await enqueue([ev(1), ev(2)]);
		dbMode = 'throw';
		fakeRedis._failRpushFor = DEAD;
		const res = await flushAuditBuffer();
		expect(res.errors).toBe(1);
		expect(fakeRedis._list(BUFFER)).toHaveLength(2);
	});
});

describe('drainAuditDeadLetter', () => {
	it('(e) retries dead-lettered rows after backoff and ends with one row per tx hash', async () => {
		await enqueue([ev(1), ev(2), ev(2)]);
		dbMode = 'throw';
		await flushAuditBuffer();
		expect(fakeRedis._list(DEAD)).toHaveLength(3);

		// Backoff has not elapsed: nothing is retried and nothing is lost.
		dbMode = 'ok';
		const early = await drainAuditDeadLetter({ now: Date.now() });
		expect(early.inserted).toBe(0);
		expect(fakeRedis._list(DEAD)).toHaveLength(3);

		const late = await drainAuditDeadLetter({ now: Date.now() + 2 * 3_600_000 });
		expect(late.errors).toBe(0);
		expect(fakeRedis._list(DEAD)).toHaveLength(0);
		expect(table.map((r) => r[7]).sort()).toEqual(['THREEsynthetic0001', 'THREEsynthetic0002']);
	});

	it('re-queues with a higher attempt count when the DB is still down', async () => {
		await enqueue([ev(1)]);
		dbMode = 'throw';
		await flushAuditBuffer();
		const res = await drainAuditDeadLetter({ now: Date.now() + 2 * 3_600_000 });
		expect(res.requeued).toBe(1);
		const item = JSON.parse(fakeRedis._list(DEAD)[0]);
		expect(item.attempts).toBe(2);
	});

	it('(g) parks a row that exhausted its attempts in the durable dead-letter table', async () => {
		await enqueue([ev(1)]);
		dbMode = 'throw';
		await flushAuditBuffer();
		// Make the stored item look like it has failed 9 times already.
		const item = JSON.parse(fakeRedis._list(DEAD)[0]);
		item.attempts = 9;
		fakeRedis.ltrim(DEAD, 1, -1);
		await fakeRedis.rpush(DEAD, JSON.stringify(item));
		// The audit insert still fails, but the dead-letter table is reachable.
		sqlImpl.mockImplementation(async (text, params) => {
			if (text.startsWith('INSERT INTO x402_audit_log')) throw new Error('row rejected');
			if (text.startsWith('INSERT INTO x402_audit_dead_letter')) { deadTable.push(params); return []; }
			return [];
		});
		const res = await drainAuditDeadLetter({ now: Date.now() + 2 * 3_600_000 });
		expect(res.parked).toBe(1);
		expect(deadTable).toHaveLength(1);
		expect(fakeRedis._list(DEAD)).toHaveLength(0);
	});
});

describe('getAuditDeadLetterStats', () => {
	it('reports depth and the age of the oldest failure', async () => {
		await enqueue([ev(1), ev(2)]);
		dbMode = 'throw';
		await flushAuditBuffer();
		const stats = await getAuditDeadLetterStats();
		expect(stats.depth).toBe(2);
		expect(typeof stats.oldestFailedAt).toBe('number');
	});
});

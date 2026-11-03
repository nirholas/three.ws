// Archive-then-delete retention (api/_lib/audit-archive.js): a row is deleted only
// after its gzip JSONL archive object exists and verifies; a failed archive keeps
// the day's rows; unconfigured storage deletes nothing.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { gunzipSync } from 'node:zlib';

let rowsByDay;
let deletedIds;
const sqlImpl = vi.fn(async (text, params) => {
	if (text.includes('GROUP BY 1')) return Object.keys(rowsByDay).filter((d) => rowsByDay[d].length).sort().map((day) => ({ day }));
	if (text.startsWith('SELECT to_jsonb')) {
		const day = params[0].slice(0, 10);
		return (rowsByDay[day] ?? []).slice(0, 2).map((row) => ({ row }));
	}
	if (text.startsWith('DELETE FROM')) {
		for (const day of Object.keys(rowsByDay)) {
			rowsByDay[day] = rowsByDay[day].filter((r) => !params[0].includes(r.id));
		}
		deletedIds.push(...params[0]);
		return params[0].map((id) => ({ id }));
	}
	return [];
});
vi.mock('../api/_lib/db.js', () => ({ sql: (...a) => sqlImpl(...a) }));
vi.mock('../api/_lib/r2.js', () => ({ putObject: vi.fn(), headObject: vi.fn(), objectStorageConfigured: () => true }));

const { pruneTableWithArchive, parseRetentionDays } = await import('../api/_lib/audit-archive.js');

const row = (id, tx) => ({ id, event_type: 'payment_settled', tx_hash: tx, created_at: '2025-01-01T00:00:00Z' });

function makeStore({ failPut = false, shortHead = false } = {}) {
	const objects = new Map();
	return {
		objects,
		configured: () => true,
		put: async (key, body) => { if (failPut) throw new Error('storage 503'); objects.set(key, body); },
		head: async (key) => (objects.has(key) ? { ContentLength: objects.get(key).length - (shortHead ? 1 : 0) } : null),
	};
}

beforeEach(() => {
	deletedIds = [];
	sqlImpl.mockClear();
	rowsByDay = { '2025-01-01': [row('a', 'T1'), row('b', 'T2'), row('c', 'T3')] };
});

describe('pruneTableWithArchive', () => {
	it('archives every part as gzip JSONL, verifies it, then deletes exactly those rows', async () => {
		const store = makeStore();
		const res = await pruneTableWithArchive({ table: 'x402_audit_log', retentionDays: 365, batchRows: 2, store });
		expect(res.failures).toEqual([]);
		expect(res.deleted).toBe(3);
		expect(res.archivedRows).toBe(3);
		expect(store.objects.size).toBe(2);
		const lines = [...store.objects.values()]
			.flatMap((b) => gunzipSync(b).toString('utf8').trim().split('\n'))
			.map((l) => JSON.parse(l).tx_hash);
		expect(lines.sort()).toEqual(['T1', 'T2', 'T3']);
		expect(deletedIds.sort()).toEqual(['a', 'b', 'c']);
	});

	it('refuses to delete a day whose archive upload failed', async () => {
		const res = await pruneTableWithArchive({ table: 'x402_audit_log', retentionDays: 365, store: makeStore({ failPut: true }) });
		expect(res.deleted).toBe(0);
		expect(res.failures).toHaveLength(1);
		expect(deletedIds).toEqual([]);
		expect(rowsByDay['2025-01-01']).toHaveLength(3);
	});

	it('refuses to delete when the stored object does not verify', async () => {
		const res = await pruneTableWithArchive({ table: 'x402_audit_log', retentionDays: 365, store: makeStore({ shortHead: true }) });
		expect(res.deleted).toBe(0);
		expect(res.failures[0].error).toMatch(/verification failed/);
		expect(deletedIds).toEqual([]);
	});

	it('deletes nothing when object storage is not configured', async () => {
		const store = { ...makeStore(), configured: () => false };
		const res = await pruneTableWithArchive({ table: 'audit_log', retentionDays: 365, store });
		expect(res.refused).toBe('object_storage_not_configured');
		expect(sqlImpl).not.toHaveBeenCalled();
	});

	it('rejects a table outside the allowlist', async () => {
		await expect(pruneTableWithArchive({ table: 'users', retentionDays: 365, store: makeStore() })).rejects.toThrow(/not allowed/);
	});
});

describe('parseRetentionDays', () => {
	it('defaults, parses, and floors', () => {
		expect(parseRetentionDays(undefined)).toBe(365);
		expect(parseRetentionDays('730')).toBe(730);
		expect(parseRetentionDays('abc')).toBe(365);
		expect(parseRetentionDays('0')).toBe(365);
		expect(parseRetentionDays('3')).toBe(30);
	});
});

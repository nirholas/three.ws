// Archive-before-delete retention for x402_audit_log (api/_lib/x402/audit-archive.js).
// A row is deleted only after its batch is stored as gzip JSONL and read back
// byte-identical. Any failure on that path keeps the rows.

import { describe, it, expect, vi } from 'vitest';
import { gunzipSync } from 'node:zlib';

vi.mock('../api/_lib/db.js', () => ({ sql: vi.fn() }));
vi.mock('../api/_lib/env.js', () => ({ env: { JWT_SECRET: 'test-secret' } }));
vi.mock('../api/_lib/r2.js', () => ({
	objectStorageConfigured: () => true,
	putObject: vi.fn(),
	getObjectBuffer: vi.fn(),
}));

const { archiveAndPruneAuditLog, buildArchiveObject, archiveBatch } = await import(
	'../api/_lib/x402/audit-archive.js'
);

function makeRows(n, startId = 0) {
	return Array.from({ length: n }, (_, i) => ({
		id: `id-${startId + i}`,
		event_type: 'payment_settled',
		route: '/api/x402/dance-tip',
		tx_hash: `sig${startId + i}`,
		created_at: new Date(Date.UTC(2025, 0, 1, 0, 0, startId + i)).toISOString(),
	}));
}

// Fake table + object store. `sql` is a tagged template: SELECT returns the next
// page of `table`, DELETE removes the ids it is handed.
function harness({ rows, configured = true, putFails = false, corrupt = false }) {
	const table = [...rows];
	const store = new Map();
	const deleted = [];
	const sql = vi.fn(async (strings, ...vals) => {
		const text = strings.join('?');
		if (/^\s*SELECT/.test(text)) {
			const limit = vals[vals.length - 1];
			return table.slice(0, limit);
		}
		const ids = vals[0];
		deleted.push(...ids);
		for (const id of ids) table.splice(table.findIndex((r) => r.id === id), 1);
		return ids.map((id) => ({ id }));
	});
	const deps = {
		sql,
		secret: () => 'test-secret',
		configured: () => configured,
		put: vi.fn(async ({ key, body }) => {
			if (putFails) throw new Error('storage unavailable');
			store.set(key, corrupt ? Buffer.from(body).subarray(0, 8) : body);
		}),
		get: vi.fn(async (key) => store.get(key)),
	};
	return { deps, table, store, deleted };
}

describe('archiveAndPruneAuditLog', () => {
	it('archives every batch as verified gzip JSONL before deleting it', async () => {
		const h = harness({ rows: makeRows(12) });
		const res = await archiveAndPruneAuditLog(365, { batch: 5 }, h.deps);

		expect(res.deleted).toBe(12);
		expect(res.archived).toBe(12);
		expect(res.objects).toHaveLength(3);
		expect(h.table).toHaveLength(0);
		const restored = [...h.store.values()].flatMap((b) =>
			gunzipSync(b).toString('utf8').trim().split('\n').map((l) => JSON.parse(l)),
		);
		expect(restored.map((r) => r.tx_hash)).toEqual(makeRows(12).map((r) => r.tx_hash));
		// Every delete came after its put.
		const firstPut = h.deps.put.mock.invocationCallOrder[0];
		const firstDelete = h.deps.sql.mock.invocationCallOrder[1];
		expect(firstPut).toBeLessThan(firstDelete);
	});

	it('refuses to delete when the archive write fails', async () => {
		const h = harness({ rows: makeRows(4), putFails: true });
		const res = await archiveAndPruneAuditLog(365, { batch: 5 }, h.deps);
		expect(res.deleted).toBe(0);
		expect(res.error).toMatch(/archive failed, rows kept/);
		expect(h.table).toHaveLength(4);
		expect(h.deleted).toHaveLength(0);
	});

	it('refuses to delete when the read-back does not match', async () => {
		const h = harness({ rows: makeRows(4), corrupt: true });
		const res = await archiveAndPruneAuditLog(365, { batch: 5 }, h.deps);
		expect(res.deleted).toBe(0);
		expect(res.error).toMatch(/archive failed/);
		expect(h.table).toHaveLength(4);
	});

	it('refuses to delete anything when object storage is not configured', async () => {
		const h = harness({ rows: makeRows(4), configured: false });
		const res = await archiveAndPruneAuditLog(365, { batch: 5 }, h.deps);
		expect(res).toMatchObject({ deleted: 0, skipped: 'archive_storage_unconfigured' });
		expect(h.deps.sql).not.toHaveBeenCalled();
		expect(h.table).toHaveLength(4);
	});

	it('stops after maxBatches so one tick stays bounded', async () => {
		const h = harness({ rows: makeRows(30) });
		const res = await archiveAndPruneAuditLog(365, { batch: 5, maxBatches: 2 }, h.deps);
		expect(res.deleted).toBe(10);
		expect(h.table).toHaveLength(20);
	});
});

describe('archive object', () => {
	it('keys by day and an unguessable content HMAC, identical for identical rows', () => {
		const rows = makeRows(3);
		const a = buildArchiveObject(rows, 's1');
		const b = buildArchiveObject(rows, 's1');
		const c = buildArchiveObject(rows, 's2');
		expect(a.key).toMatch(/^x402-audit-log\/2025-01-01\/[0-9a-f]{24}\.jsonl\.gz$/);
		expect(a.key).toBe(b.key);
		expect(a.key).not.toBe(c.key);
	});

	it('archiveBatch returns the key only when the stored body round-trips', async () => {
		const h = harness({ rows: [] });
		const key = await archiveBatch(makeRows(2), h.deps);
		expect(h.store.has(key)).toBe(true);
	});
});

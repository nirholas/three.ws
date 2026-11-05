// The Coin Intelligence firehose (the data behind /radar) used to be hard-deleted
// past the retention window with no copy kept, so only the last few days of
// observed launches ever existed. These tests pin the replacement contract:
// nothing leaves Postgres before a verified archive part exists for it.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { archiveAndPruneMints, archiveAndPruneOrphans, FIREHOSE_MASTER } from '../api/_lib/firehose-archive.js';

function harness({ tables, storeFails = false, md5Lies = false }) {
	const events = [];
	const objects = new Map();
	const query = async (text, params) => {
		if (/^\s*SELECT ctid::text AS tid, to_jsonb/i.test(text)) {
			const t = text.match(/FROM (\w+) t/)[1];
			events.push('select:' + t);
			return (tables[t] || []).filter((r) => params[0].includes(r.mint)).map((r, i) => ({ tid: `(0,${i + 1})`, mint: r.mint, line: JSON.stringify(r) }));
		}
		if (/^\s*SELECT s\.ctid/i.test(text)) {
			const t = text.match(/FROM (\w+) s/)[1];
			events.push('select-orphans:' + t);
			return (tables[t] || []).map((r, i) => ({ tid: `(0,${i + 1})`, mint: r.mint, line: JSON.stringify(r) }));
		}
		if (/DELETE FROM/i.test(text)) {
			const t = text.match(/DELETE FROM (\w+)/)[1];
			events.push('delete:' + t);
			if (t === FIREHOSE_MASTER) events.push(/NOT EXISTS/.test(text) ? 'master-guarded' : 'master-unguarded');
			return [{ n: params[0].length }];
		}
		throw new Error('unexpected sql: ' + text);
	};
	const store = {
		async put(name, body) {
			events.push('put:' + name);
			if (storeFails) throw new Error('gcs unavailable');
			objects.set(name, body);
			const md5 = createHash('md5').update(body).digest('base64');
			return { name, size: String(body.length), md5Hash: md5Lies ? 'AAAA' : md5 };
		},
	};
	return { events, objects, query, store };
}

const batch = [
	{ mint: 'THREEsynthetic1111', first_seen_at: '2026-10-20T01:00:00.000Z' },
	{ mint: 'THREEsynthetic2222', first_seen_at: '2026-10-20T02:00:00.000Z' },
];
const tables = {
	pump_coin_intel: batch.map((b) => ({ ...b, quality_score: 50 })),
	pump_coin_wallets: [
		{ mint: 'THREEsynthetic1111', wallet: 'w1' },
		{ mint: 'THREEsynthetic2222', wallet: 'w2' },
	],
	pump_coin_outcomes: [{ mint: 'THREEsynthetic1111', outcome: 'graduated' }],
};
const satellites = ['pump_coin_wallets', 'pump_coin_outcomes'];
const run = (h) =>
	archiveAndPruneMints({ query: h.query, store: h.store, satellites, batch, runId: 'r1', batchIndex: 0, cutoff: '2026-10-22T00:00:00.000Z' });

describe('firehose archive-before-delete', () => {
	it('uploads every table part and manifest before the first delete', async () => {
		const h = harness({ tables });
		const r = await run(h);
		const firstDelete = h.events.findIndex((e) => e.startsWith('delete:'));
		const before = h.events.slice(0, firstDelete);
		for (const t of [...satellites, FIREHOSE_MASTER]) {
			expect(before.some((e) => e.startsWith(`put:${t}/2026-10-20/`) && e.endsWith('.ndjson.gz')), t).toBe(true);
			expect(before.some((e) => e.startsWith(`put:${t}/2026-10-20/`) && e.endsWith('.manifest.json')), t).toBe(true);
		}
		expect(r.archived).toEqual({ pump_coin_wallets: 2, pump_coin_outcomes: 1, pump_coin_intel: 2 });
		expect(r.deleted.pump_coin_intel).toBe(2);
	});

	it('archives the full rows, readable back from the gzip part', async () => {
		const h = harness({ tables });
		await run(h);
		const part = [...h.objects.keys()].find((k) => k.startsWith('pump_coin_intel/') && k.endsWith('.ndjson.gz'));
		const lines = gunzipSync(h.objects.get(part)).toString().split('\n').filter(Boolean).map(JSON.parse);
		expect(lines.map((l) => l.mint)).toEqual(batch.map((b) => b.mint));
		const manifest = JSON.parse(h.objects.get(part.replace('.ndjson.gz', '.manifest.json')).toString());
		expect(manifest.rows).toBe(2);
		expect(manifest.min_key[0].slice(0, 10)).toBe('2026-10-20');
	});

	it('deletes satellites before the master, and guards the master against the FK cascade', async () => {
		const h = harness({ tables });
		await run(h);
		const deletes = h.events.filter((e) => e.startsWith('delete:'));
		expect(deletes[deletes.length - 1]).toBe(`delete:${FIREHOSE_MASTER}`);
		expect(h.events).toContain('master-guarded');
		expect(h.events).not.toContain('master-unguarded');
	});

	it('deletes nothing when the archive store is down', async () => {
		const h = harness({ tables, storeFails: true });
		const r = await run(h);
		expect(h.events.some((e) => e.startsWith('delete:'))).toBe(false);
		expect(r.skipped).toMatch(/gcs unavailable/);
		expect(r.deleted).toEqual({});
	});

	it('deletes nothing when a stored checksum does not match', async () => {
		const h = harness({ tables, md5Lies: true });
		const r = await run(h);
		expect(h.events.some((e) => e.startsWith('delete:'))).toBe(false);
		expect(r.skipped).toMatch(/checksum/);
	});

	it('archives orphaned satellite rows before deleting them', async () => {
		const h = harness({ tables: { pump_coin_wallets: [{ mint: 'THREEsyntheticGone', wallet: 'w9' }] } });
		const r = await archiveAndPruneOrphans({ query: h.query, store: h.store, table: 'pump_coin_wallets', limit: 100, runId: 'r1' });
		const del = h.events.indexOf('delete:pump_coin_wallets');
		expect(h.events.slice(0, del).some((e) => e.endsWith('.manifest.json'))).toBe(true);
		expect(r).toMatchObject({ archived: 1, deleted: 1, skipped: null });
	});

	it('orphan sweep deletes nothing when the archive store is down', async () => {
		const h = harness({ tables: { pump_coin_wallets: [{ mint: 'THREEsyntheticGone', wallet: 'w9' }] }, storeFails: true });
		const r = await archiveAndPruneOrphans({ query: h.query, store: h.store, table: 'pump_coin_wallets', limit: 100, runId: 'r1' });
		expect(h.events).not.toContain('delete:pump_coin_wallets');
		expect(r.skipped).toMatch(/gcs unavailable/);
	});
});

describe('db-retention cron', () => {
	const src = readFileSync(path.join(process.cwd(), 'api/cron/db-retention.js'), 'utf8');

	it('never hard-deletes firehose rows outside the archive path', () => {
		expect(src).not.toMatch(/DELETE FROM pump_coin_intel/);
		expect(src).not.toMatch(/DELETE FROM \$\{t\} WHERE mint/);
		expect(src).toMatch(/archiveAndPruneMints/);
		expect(src).toMatch(/archiveAndPruneOrphans/);
	});
});

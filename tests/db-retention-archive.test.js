// Archive-then-prune contract for the big history tables (order 249).
//
// 1. The table inventory: the 2026-11-03 storage incident happened because the
//    biggest growers were not in any retention list, so the cron promised
//    "retention will reclaim space" and reclaimed nothing.
// 2. archive-before-delete ordering: no DELETE without a verified part + manifest.
// 3. archive outage means skip, never delete.
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { ARCHIVED_TABLES, archivedTableNames } from '../api/_lib/db-archive-tables.js';
import { archiveSlice, createGcsStore } from '../api/_lib/db-archive.js';

describe('archived table inventory', () => {
	it('covers every table that was over 500 MB on 2026-11-03 or documents why not', () => {
		const names = archivedTableNames();
		for (const t of [
			'agent_onchain_events',
			'oracle_training_set',
			'x402_self_facilitator_log',
			'firewall_decisions',
			'usage_events',
			'sniper_llm_verdicts',
			'ops_alerts',
		]) {
			expect(names, `${t} must be archived then pruned`).toContain(t);
		}
	});

	it('names the longest reader lookback it audited for every table', () => {
		for (const spec of ARCHIVED_TABLES) {
			expect(spec.readers, spec.table).toBeTruthy();
			expect(spec.days, spec.table).toBeGreaterThanOrEqual(7);
			expect(spec.pk.length, spec.table).toBeGreaterThan(0);
		}
	});

	it('never prunes billing rows from usage_events', () => {
		const usage = ARCHIVED_TABLES.find((t) => t.table === 'usage_events');
		expect(usage.where).toMatch(/kind\s*<>\s*'metered'/);
	});
});

// A scripted sql + store pair that records the order of operations.
function harness({ rows, storeFails = false, md5Lies = false }) {
	const events = [];
	const query = async (text, params) => {
		if (/^\s*SELECT/i.test(text)) {
			events.push('select');
			const out = rows.splice(0, params[params.length - 1]);
			return out;
		}
		if (/DELETE FROM/i.test(text)) {
			events.push('delete');
			return [{ n: params[0].length }];
		}
		throw new Error('unexpected sql: ' + text);
	};
	const store = {
		async put(name, body) {
			events.push('put:' + name.split('.').slice(1).join('.'));
			if (storeFails) throw new Error('gcs unavailable');
			const md5 = createHash('md5').update(body).digest('base64');
			return { name, size: String(body.length), md5Hash: md5Lies ? 'AAAA' : md5 };
		},
	};
	return { events, query, store };
}

const spec = {
	table: 't_demo',
	tsColumn: 'ts',
	pk: [{ col: 'id', type: 'bigint' }],
	days: 30,
	readers: 'none',
};
const mk = (n) =>
	Array.from({ length: n }, (_, i) => ({ line: JSON.stringify({ id: i + 1 }), k_ts: '2026-01-01T00:00:00Z', k_0: String(i + 1) }));

describe('archiveSlice ordering', () => {
	it('uploads the part and the manifest before it deletes anything', async () => {
		const h = harness({ rows: mk(3) });
		const r = await archiveSlice({ query: h.query, store: h.store, spec, prune: true, maxRows: 10, partRows: 10, runId: 'r1' });
		const firstDelete = h.events.indexOf('delete');
		expect(firstDelete).toBeGreaterThan(-1);
		expect(h.events.slice(0, firstDelete)).toEqual(expect.arrayContaining(['put:ndjson.gz', 'put:manifest.json']));
		expect(h.events.indexOf('put:manifest.json')).toBeLessThan(firstDelete);
		expect(r.archivedRows).toBe(3);
		expect(r.deletedRows).toBe(3);
	});

	it('skips instead of deleting when the archive store is unavailable', async () => {
		const h = harness({ rows: mk(3), storeFails: true });
		const r = await archiveSlice({ query: h.query, store: h.store, spec, prune: true, maxRows: 10, partRows: 10, runId: 'r1' });
		expect(h.events).not.toContain('delete');
		expect(r.deletedRows).toBe(0);
		expect(r.skipped).toMatch(/gcs unavailable/);
	});

	it('refuses to delete when the stored checksum does not match', async () => {
		const h = harness({ rows: mk(3), md5Lies: true });
		const r = await archiveSlice({ query: h.query, store: h.store, spec, prune: true, maxRows: 10, partRows: 10, runId: 'r1' });
		expect(h.events).not.toContain('delete');
		expect(r.skipped).toMatch(/checksum/);
	});

	it('archive-only mode never deletes', async () => {
		const h = harness({ rows: mk(3) });
		const r = await archiveSlice({ query: h.query, store: h.store, spec, prune: false, maxRows: 10, partRows: 10, runId: 'r1' });
		expect(h.events).not.toContain('delete');
		expect(r.archivedRows).toBe(3);
	});
});

describe('createGcsStore', () => {
	it('creates objects with ifGenerationMatch=0 and server-side md5 verification', async () => {
		let seen;
		const store = createGcsStore({
			bucket: 'b',
			getToken: async () => 'tok',
			fetchImpl: async (url, init) => {
				seen = { url, init };
				const body = Buffer.from(init.body);
				const md5 = createHash('md5').update(body.subarray(body.indexOf('\r\n\r\n', body.indexOf('\r\n\r\n') + 4) + 4, body.lastIndexOf('\r\n--'))).digest('base64');
				return new Response(JSON.stringify({ name: 'x', size: '3', md5Hash: md5 }), { status: 200 });
			},
		});
		const meta = await store.put('x', Buffer.from('abc'), 'text/plain');
		expect(seen.url).toContain('ifGenerationMatch=0');
		expect(seen.init.headers.authorization).toBe('Bearer tok');
		expect(meta.size).toBe('3');
	});
});

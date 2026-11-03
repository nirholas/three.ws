#!/usr/bin/env node
// Archive, prune, verify and restore the big history tables
// (docs/ops/db-retention.md, "Archive layout").
//
//   node scripts/db-archive-table.mjs <table|--all>                 archive only (read-only against the DB)
//   node scripts/db-archive-table.mjs <table|--all> --prune         archive, verify, then delete the archived rows
//   node scripts/db-archive-table.mjs <table|--all> --verify        re-read every part and check counts and hashes
//   node scripts/db-archive-table.mjs <table> --restore --from 2026-08-01 --to 2026-09-01 [--apply]
//
// Options: --max-rows N (default 100000000), --days N (override the window).
//
// Environment: DATABASE_URL (node scripts/read-service-env.mjs '^DATABASE_URL$' --raw).
// GCS auth: GCS_ACCESS_TOKEN, else `gcloud auth print-access-token`.
//
// Archive-only mode never writes to the database. It resumes from the newest
// manifest's max key, so a rerun does not archive the same rows twice. --prune
// shares the exact archive-verify-delete path the cron uses.

import { execFileSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { neon } from '@neondatabase/serverless';
import { ARCHIVED_TABLES } from '../api/_lib/db-archive-tables.js';
import { archiveSlice, createGcsStore, verifyTable, ARCHIVE_BUCKET } from '../api/_lib/db-archive.js';

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const target = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1]?.startsWith('--') !== true);

function token() {
	if (process.env.GCS_ACCESS_TOKEN) return process.env.GCS_ACCESS_TOKEN;
	return execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();
}
const store = createGcsStore({ bucket: process.env.DB_ARCHIVE_BUCKET || ARCHIVE_BUCKET, getToken: async () => token() });

const specs = flag('--all') ? ARCHIVED_TABLES : ARCHIVED_TABLES.filter((s) => s.table === target);
if (!specs.length) {
	console.error(`usage: db-archive-table.mjs <${ARCHIVED_TABLES.map((s) => s.table).join('|')}|--all> [--prune|--verify|--restore]`);
	process.exit(2);
}

if (flag('--verify')) {
	let bad = 0;
	for (const spec of specs) {
		const r = await verifyTable({ store, table: spec.table });
		console.log(JSON.stringify(r));
		if (r.problems.length) bad++;
	}
	process.exit(bad ? 1 : 0);
}

if (!process.env.DATABASE_URL) {
	console.error('DATABASE_URL is required');
	process.exit(2);
}
const db = neon(process.env.DATABASE_URL);
const query = (text, params) => db.query(text, params);

if (flag('--restore')) {
	const spec = specs[0];
	const from = opt('--from', '0000-01-01');
	const to = opt('--to', '9999-12-31');
	const names = (await store.list(`${spec.table}/`)).filter((n) => n.endsWith('.manifest.json'));
	let rows = 0;
	for (const mName of names) {
		const m = JSON.parse((await store.get(mName)).toString());
		const day = m.min_key[0].slice(0, 10);
		const lastDay = m.max_key[0].slice(0, 10);
		if (lastDay < from || day >= to) continue;
		const lines = gunzipSync(await store.get(m.part)).toString().split('\n').filter(Boolean);
		rows += lines.length;
		if (flag('--apply')) {
			for (let i = 0; i < lines.length; i += 1000) {
				const chunk = '[' + lines.slice(i, i + 1000).join(',') + ']';
				await query(
					`INSERT INTO ${spec.table} SELECT * FROM jsonb_populate_recordset(null::${spec.table}, $1::jsonb) ON CONFLICT DO NOTHING`,
					[chunk],
				);
			}
		}
		console.log(`${flag('--apply') ? 'restored' : 'would restore'} ${lines.length} rows from ${m.part}`);
	}
	console.log(`${flag('--apply') ? 'restored' : 'dry run:'} ${rows} rows into ${spec.table}`);
	process.exit(0);
}

const prune = flag('--prune');
const maxRows = Number(opt('--max-rows', 100_000_000));
const runId = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
for (const spec of specs) {
	const s = opt('--days') ? { ...spec, days: Number(opt('--days')) } : spec;
	let after = null;
	if (!prune) {
		// Resume from the newest manifest for this table.
		const manifests = (await store.list(`${spec.table}/`)).filter((n) => n.endsWith('.manifest.json'));
		let best = null;
		for (const n of manifests) {
			const m = JSON.parse((await store.get(n)).toString());
			if (!best || m.max_key.join('\u0000') > best.max_key.join('\u0000')) best = m;
		}
		after = best?.max_key ?? null;
	}
	let total = { archived: 0, deleted: 0, parts: 0 };
	const t0 = Date.now();
	// Slices of 200k rows keep the progress line moving and bound memory.
	while (total.archived < maxRows) {
		const r = await archiveSlice({ query, store, spec: s, prune, maxRows: Math.min(200_000, maxRows - total.archived), runId, after });
		total.archived += r.archivedRows;
		total.deleted += r.deletedRows;
		total.parts += r.parts;
		after = r.cursor;
		console.log(`${spec.table}: +${r.archivedRows} archived, +${r.deletedRows} deleted (total ${total.archived}/${total.deleted}, ${total.parts} parts, ${Math.round((Date.now() - t0) / 1000)}s)`);
		if (r.skipped) {
			console.error(`${spec.table}: SKIPPED, nothing further deleted: ${r.skipped}`);
			process.exit(1);
		}
		if (r.archivedRows === 0) break;
	}
	console.log(JSON.stringify({ table: spec.table, ...total, prune }));
}

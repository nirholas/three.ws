#!/usr/bin/env node
// The data the x402 loop paid for, from x402_paid_responses (every paid call's
// receipt plus its full response body, written by payX402).
//
//   npm run x402:paid-data -- summary [--since 2026-11-01]
//       per-endpoint rollup: calls, spend, payers, distinct bodies, bytes, last purchase
//   npm run x402:paid-data -- export --out data.jsonl [--endpoint /api/x | key] [--pipeline P] [--since D] [--no-bodies]
//       one JSON line per paid call with its full body, oldest first (stdout without --out)
//   npm run x402:paid-data -- accounting [--since D] [--until D] [--csv out.csv]
//       per-wallet ledger: what each payer paid and bought; fresh wallets add funded/returned/reclaimed and tx sigs
//   npm run x402:paid-data -- ingest-spool [--limit N]
//       replay responses spooled to object storage while the database was down
//
// Add --prod-env to read DATABASE_URL and the object-storage env from the
// three-ws-api Cloud Run service through your own gcloud login. Read-only apart
// from ingest-spool, which inserts the spooled rows and deletes each spool object
// once its row is confirmed.

import { createWriteStream } from 'node:fs';
import { once } from 'node:events';

import { loadCloudRunEnv } from './lib/cloud-run-env.mjs';

const [cmd, ...args] = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, dflt = null) => {
	const i = args.indexOf(name);
	return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : dflt;
};
const USAGE = 'Usage: npm run x402:paid-data -- <summary|export|accounting|ingest-spool> [--prod-env] [options]  (see the header of scripts/x402-paid-data.mjs)';

if (!['summary', 'export', 'accounting', 'ingest-spool'].includes(cmd)) {
	console.error(USAGE);
	process.exit(cmd === '--help' || cmd === '-h' ? 0 : 1);
}

if (flag('--prod-env')) {
	const n = loadCloudRunEnv({ wanted: /^(DATABASE_URL|S3_[A-Z_]+|STORAGE_FALLBACK_[A-Z_]+|R2_[A-Z_]+)$/, required: ['DATABASE_URL'] });
	console.error(`loaded ${n} env vars from Cloud Run`);
}
if (!process.env.DATABASE_URL) {
	console.error('x402-paid-data: DATABASE_URL is not set (pass --prod-env, or start with the production env)');
	process.exit(1);
}

const validDate = (s, name) => {
	if (s == null) return null;
	if (Number.isNaN(Date.parse(s))) {
		console.error(`x402-paid-data: ${name} is not a date: ${s}`);
		process.exit(1);
	}
	return new Date(s).toISOString();
};
const since = validDate(opt('--since'), '--since');
const until = validDate(opt('--until'), '--until');

const { sql } = await import('../api/_lib/db.js');
const store = await import('../api/_lib/x402/paid-responses.js');
await store.ensurePaidResponsesSchema(sql);

const usdc = (atomic) => (Number(atomic || 0) / 1e6).toFixed(6);

if (cmd === 'summary') {
	const rows = await store.paidDataSummary({ sql, sinceIso: since });
	if (!rows.length) {
		console.log('no paid responses recorded yet' + (since ? ` since ${since}` : ''));
	} else {
		console.table(rows.map((r) => ({
			endpoint: r.endpoint_path, calls: r.calls, spent_usdc: usdc(r.spent_atomic), payers: r.payers,
			distinct_bodies: r.distinct_bodies, kb: Math.round(Number(r.bytes || 0) / 1024), last_at: new Date(r.last_at).toISOString(),
		})));
		const total = rows.reduce((a, r) => ({ calls: a.calls + r.calls, spent: a.spent + Number(r.spent_atomic || 0) }), { calls: 0, spent: 0 });
		console.log(`${total.calls} paid calls across ${rows.length} endpoints, ${usdc(total.spent)} spent`);
	}
}

if (cmd === 'export') {
	const outPath = opt('--out');
	const sink = outPath ? createWriteStream(outPath) : process.stdout;
	let afterId = 0;
	let written = 0;
	let bodyErrors = 0;
	for (;;) {
		const page = await store.listPaidResponses({
			sql, endpoint: opt('--endpoint'), pipeline: opt('--pipeline'), sinceIso: since, afterId, limit: 500, withBodies: !flag('--no-bodies'),
		});
		if (!page.length) break;
		for (const row of page) {
			if (row.body_error) bodyErrors += 1;
			if (!sink.write(JSON.stringify(row) + '\n')) await once(sink, 'drain');
		}
		written += page.length;
		afterId = page[page.length - 1].id;
	}
	if (outPath) {
		sink.end();
		await once(sink, 'finish');
	}
	console.error(`exported ${written} paid responses${outPath ? ` to ${outPath}` : ''}${bodyErrors ? ` (${bodyErrors} bodies could not be loaded, see body_error)` : ''}`);
}

if (cmd === 'accounting') {
	const rows = await store.walletAccounting({ sql, sinceIso: since, untilIso: until });
	const csvPath = opt('--csv');
	if (csvPath) {
		const cols = ['payer', 'wallet_kind', 'responses', 'paid_atomic', 'bytes', 'first_at', 'last_at', 'endpoints', 'fresh_wallet_id', 'fresh_state',
			'usdc_funded_atomic', 'usdc_returned_atomic', 'sol_funded_lamports', 'sol_reclaimed_lamports', 'rent_reclaimed_lamports', 'fund_sig', 'pay_sig', 'sweep_sig'];
		const cell = (v) => {
			if (v == null) return '';
			const s = v instanceof Date ? v.toISOString() : Array.isArray(v) ? v.join(' ') : String(v);
			return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
		};
		const sink = createWriteStream(csvPath);
		sink.write(cols.join(',') + '\n');
		for (const r of rows) sink.write(cols.map((c) => cell(r[c])).join(',') + '\n');
		sink.end();
		await once(sink, 'finish');
		console.log(`wrote ${rows.length} wallets to ${csvPath}`);
	} else if (!rows.length) {
		console.log('no paid responses recorded yet');
	} else {
		console.table(rows.map((r) => ({
			payer: r.payer, kind: r.wallet_kind, responses: r.responses, paid_usdc: usdc(r.paid_atomic),
			funded_usdc: r.usdc_funded_atomic == null ? '' : usdc(r.usdc_funded_atomic),
			returned_usdc: r.usdc_returned_atomic == null ? '' : usdc(r.usdc_returned_atomic),
			state: r.fresh_state || '', last_at: new Date(r.last_at).toISOString(),
		})));
		const byKind = {};
		for (const r of rows) {
			const k = (byKind[r.wallet_kind] ||= { wallets: 0, responses: 0, paid: 0 });
			k.wallets += 1;
			k.responses += r.responses;
			k.paid += Number(r.paid_atomic || 0);
		}
		for (const [kind, k] of Object.entries(byKind)) console.log(`${kind}: ${k.wallets} wallets, ${k.responses} responses, ${usdc(k.paid)} paid`);
	}
}

if (cmd === 'ingest-spool') {
	const out = await store.drainPaidSpool({ sql, limit: Math.max(1, Number(opt('--limit', 5000)) || 5000) });
	console.log(`listed ${out.listed}  ingested ${out.ingested}  already stored ${out.duplicates}  failed ${out.failed.length}`);
	for (const e of out.list_errors) console.log(`  list error (that store's half was skipped): ${e}`);
	for (const f of out.failed) console.log(`  kept ${f.key}: ${f.error}`);
	process.exit(out.failed.length ? 2 : 0);
}

process.exit(0);

#!/usr/bin/env node
// Backfill Florence-2 descriptions (caption, detailed caption, tags, objects)
// for finished 3D creations, newest first (work order 819).
//
// Shares the claim ledger with the creation-describe cron
// (api/_lib/creation-descriptions.js), so a run never redescribes a done row,
// resumes where the last run stopped, and can overlap the cron safely.
//
// Modes:
//   --dry-run
//       Coverage only: how many creations exist, how many are described,
//       queued, failed or skipped, and how many remain. Writes nothing.
//
//   --worker <url> [--limit 500] [--concurrency 2] [--per-minute 120]
//       Describe through a running model-florence2 service, rate limited to
//       --per-minute requests. Prints progress per batch.
//
//   --export <n> --out gs://bucket/path/in.json
//       Lease the next n creations (newest first) and write [{id, image_url}]
//       for the GPU batch job (workers/model-florence2/batch.py).
//
//   --import gs://bucket/path/out.json
//       Store every result the batch job wrote; failed items go back to the
//       queue (and to 'failed' after three attempts).
//
// Env: DATABASE_URL, and for --worker GCP_RECONSTRUCTION_KEY (the shared
// worker bearer). Loaded from .env.local / .env when not already set. --export
// and --import shell out to `gcloud storage`, so gcloud must be authenticated.

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadEnvFile(path) {
	let raw;
	try {
		raw = readFileSync(path, 'utf8');
	} catch {
		return;
	}
	for (const line of raw.split('\n')) {
		const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
		if (!m || process.env[m[1]] !== undefined) continue;
		process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
	}
}
loadEnvFile(join(root, '.env.local'));
loadEnvFile(join(root, '.env'));

function arg(name, fallback = null) {
	const i = process.argv.indexOf(`--${name}`);
	if (i === -1) return fallback;
	const v = process.argv[i + 1];
	return v === undefined || v.startsWith('--') ? true : v;
}

const lib = await import('../api/_lib/creation-descriptions.js');

function printStats(label, s) {
	const pct = s.creations ? ((s.described / s.creations) * 100).toFixed(2) : '0.00';
	console.log(
		`${label}: ${s.described}/${s.creations} described (${pct}%), ${s.queued} queued, ${s.failed} failed, ${s.skipped} skipped, ${s.remaining} remaining, ${s.ownerEdited} owner-edited, p50 ${s.latencyMsP50 ?? '-'} ms`,
	);
}

function gcsRead(uri) {
	return execFileSync('gcloud', ['storage', 'cat', uri], { encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
}

function gcsWrite(uri, text) {
	const dir = mkdtempSync(join(tmpdir(), 'fl2-'));
	try {
		const file = join(dir, 'in.json');
		writeFileSync(file, text);
		execFileSync('gcloud', ['storage', 'cp', '--quiet', file, uri], { stdio: 'inherit' });
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

async function dryRun() {
	printStats('coverage', await lib.describeStats());
}

async function exportBatch() {
	const n = Number(arg('export'));
	const out = arg('out');
	if (!Number.isFinite(n) || n < 1 || typeof out !== 'string' || !out.startsWith('gs://')) {
		throw new Error('usage: --export <n> --out gs://bucket/path/in.json');
	}
	const entries = [];
	const skipped = [];
	while (entries.length + skipped.length < n) {
		const want = Math.min(500, n - entries.length - skipped.length);
		const batch = await lib.claimDescribeBatch({ limit: want, backfill: true });
		if (!batch.items.length && !batch.skipped.length) break;
		entries.push(...batch.items.map((i) => ({ id: i.id, image_url: i.imageUrl })));
		skipped.push(...batch.skipped);
	}
	gcsWrite(out, JSON.stringify(entries));
	console.log(`exported ${entries.length} creations to ${out} (${skipped.length} skipped: no poster and no renderable GLB)`);
}

async function importBatch() {
	const uri = arg('import');
	if (typeof uri !== 'string' || !uri.startsWith('gs://')) throw new Error('usage: --import gs://bucket/path/out.json');
	const data = JSON.parse(gcsRead(uri));
	let stored = 0;
	let failed = 0;
	for (const item of data.items || []) {
		if (!item?.id) continue;
		if (item.ok) {
			const ok = await lib.storeDescription({ creationId: item.id, result: item.result, sourceImageUrl: item.image_url || null });
			if (ok) stored += 1;
			else failed += 1;
		} else {
			await lib.markDescribeFailed({ creationId: item.id, error: item.error });
			failed += 1;
		}
	}
	console.log(`imported ${stored} descriptions, ${failed} failures from ${uri}`);
	if (data.stats) console.log('job stats:', JSON.stringify(data.stats));
	printStats('coverage', await lib.describeStats());
}

async function viaWorker() {
	const url = String(arg('worker')).replace(/\/+$/, '');
	const limit = Number(arg('limit', 500));
	const concurrency = Number(arg('concurrency', 2));
	const perMinute = Number(arg('per-minute', 120));
	const batchSize = Math.max(1, Math.min(50, concurrency * 4));
	let done = 0;
	const t0 = Date.now();
	while (done < limit) {
		const started = Date.now();
		const r = await lib.runDescribeBatch({ limit: Math.min(batchSize, limit - done), concurrency, url });
		if (!r.claimed) {
			console.log('nothing left to describe');
			break;
		}
		done += r.claimed;
		console.log(`batch: ${r.described} described, ${r.failed} failed, ${r.skipped} skipped (${done}/${limit}, ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
		// Rate limit: a batch of n requests may not finish faster than n / perMinute.
		const floorMs = (r.claimed / perMinute) * 60_000;
		const wait = floorMs - (Date.now() - started);
		if (wait > 0) await new Promise((res) => setTimeout(res, wait));
	}
	printStats('coverage', await lib.describeStats());
}

try {
	if (arg('dry-run')) await dryRun();
	else if (arg('export')) await exportBatch();
	else if (arg('import')) await importBatch();
	else if (arg('worker')) await viaWorker();
	else {
		console.log('usage: --dry-run | --worker <url> | --export <n> --out gs://... | --import gs://...');
		process.exitCode = 2;
	}
} catch (err) {
	console.error(err?.message || err);
	process.exitCode = 1;
}
process.exit(process.exitCode ?? 0);

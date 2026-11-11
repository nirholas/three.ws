#!/usr/bin/env node
// Forge lane benchmark over real production rows (the TRELLIS.2 lab's numbers).
// ---------------------------------------------------------------------------
// Reads forge_creations (read-only, one SELECT) for a trailing window and
// computes, per lane (the `backend` column) and per tier inside each lane:
//
//   end-to-end time   completed_at - created_at, p50 / p90 / p99 (nearest rank)
//   queue time        queue_ms, as measured by the serving worker
//   GPU time          gpu_ms, as measured by the serving worker
//   failure rate      failed / (done + failed); in-flight rows are excluded
//   output size       size_bytes of done rows, p50 / p90 / p99
//
// Queue and GPU time exist only where the worker reported them (the TRELLIS.2
// worker does; api/_lib/forge-store.js persists them with voxel_resolution).
// Any group with no recorded value says the literal string "not measured";
// nothing is estimated. A done row without completed_at contributes to the
// failure rate and size, never to the time percentiles (counted as e2e_missing).
//
// Writes data/trellis2-benchmark.json, which the lab at /lab/trellis2 reads for
// its preset speed labels. Rerun any time:
//
//   npm run trellis2:benchmark                 last 30 days
//   npm run trellis2:benchmark -- --days 7     a different window
//   npm run trellis2:benchmark -- --stdout     print, do not write the file
//
// Reads DATABASE_URL from the environment, then .env.local, then .env.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { neon } from '@neondatabase/serverless';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_FILE = path.join(REPO_ROOT, 'data', 'trellis2-benchmark.json');
const NOT_MEASURED = 'not measured';

// The lab's presets, keyed to the voxel resolution each one runs, which the
// worker reports back and the store records per creation (voxel_resolution).
export const PRESET_RESOLUTIONS = { fast_draft: 512, balanced: 1024, maximum_detail: 1536 };

// The forge tier each resolution is requested on (512 drafts, the rest run
// standard). Mirrors tierFor in src/lab-trellis2/params.js.
const presetTier = (resolution) => (resolution === 512 ? 'draft' : 'standard');

function loadEnv() {
	for (const envFile of ['.env.local', '.env']) {
		let raw;
		try {
			raw = readFileSync(path.resolve(REPO_ROOT, envFile), 'utf8');
		} catch {
			continue;
		}
		for (const line of raw.split('\n')) {
			const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
			if (!m || process.env[m[1]]) continue;
			process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
		}
	}
}

function parseArgs(argv) {
	const out = { days: 30, stdout: false };
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === '--stdout') out.stdout = true;
		else if (argv[i] === '--days') out.days = Number(argv[++i]);
	}
	if (!Number.isInteger(out.days) || out.days < 1 || out.days > 365) {
		throw new Error('--days must be an integer from 1 to 365');
	}
	return out;
}

// Nearest-rank percentile over an ascending array: the smallest value with at
// least p% of samples at or below it. Every reported number is a real sample.
export function percentile(sorted, p) {
	if (!sorted.length) return null;
	const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
	return sorted[rank - 1];
}

function distribution(values, round) {
	const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
	if (!sorted.length) return NOT_MEASURED;
	const r = (v) => (round ? round(v) : v);
	return { n: sorted.length, p50: r(percentile(sorted, 50)), p90: r(percentile(sorted, 90)), p99: r(percentile(sorted, 99)) };
}

const seconds = (v) => Math.round(v * 10) / 10;

// Summarise one group of rows (a lane, or a tier inside a lane).
export function summarize(rows) {
	let done = 0;
	let failed = 0;
	let inFlight = 0;
	let e2eMissing = 0;
	const e2e = [];
	const bytes = [];
	const queue = [];
	const gpu = [];
	for (const row of rows) {
		if (row.status === 'done') {
			done++;
			if (row.e2e_s == null) e2eMissing++;
			else e2e.push(Number(row.e2e_s));
			if (row.size_bytes != null) bytes.push(Number(row.size_bytes));
			if (row.queue_ms != null) queue.push(Number(row.queue_ms) / 1000);
			if (row.gpu_ms != null) gpu.push(Number(row.gpu_ms) / 1000);
		} else if (row.status === 'failed') {
			failed++;
		} else {
			inFlight++;
		}
	}
	const settled = done + failed;
	return {
		rows: rows.length,
		done,
		failed,
		in_flight: inFlight,
		failure_rate: settled ? Math.round((failed / settled) * 10000) / 10000 : NOT_MEASURED,
		e2e_seconds: distribution(e2e, seconds),
		e2e_missing: e2eMissing,
		queue_seconds: distribution(queue, seconds),
		gpu_seconds: distribution(gpu, seconds),
		output_bytes: distribution(bytes, Math.round),
	};
}

export function buildReport(rows, { from, to, days }) {
	const byLane = new Map();
	for (const row of rows) {
		const lane = row.backend || 'unrecorded';
		if (!byLane.has(lane)) byLane.set(lane, []);
		byLane.get(lane).push(row);
	}
	const lanes = [...byLane.entries()]
		.map(([lane, laneRows]) => {
			const byTier = new Map();
			for (const row of laneRows) {
				const tier = row.tier || 'unrecorded';
				if (!byTier.has(tier)) byTier.set(tier, []);
				byTier.get(tier).push(row);
			}
			const tiers = Object.fromEntries(
				[...byTier.entries()].sort((a, b) => b[1].length - a[1].length).map(([tier, t]) => [tier, summarize(t)]),
			);
			const byRes = new Map();
			for (const row of laneRows) {
				if (row.voxel_resolution == null) continue;
				const k = String(row.voxel_resolution);
				if (!byRes.has(k)) byRes.set(k, []);
				byRes.get(k).push(row);
			}
			const resolutions = Object.fromEntries([...byRes.entries()].map(([k, r]) => [k, summarize(r)]));
			return { lane, ...summarize(laneRows), tiers, resolutions };
		})
		.sort((a, b) => b.rows - a.rows);

	const trellis2 = lanes.find((l) => l.lane === 'trellis2') || null;
	const presets = Object.fromEntries(
		Object.entries(PRESET_RESOLUTIONS).map(([preset, resolution]) => {
			const r = trellis2?.resolutions?.[String(resolution)];
			const tier = presetTier(resolution);
			const t = trellis2?.tiers?.[tier];
			return [preset, {
				resolution,
				rows: r ? r.rows : 0,
				done: r ? r.done : 0,
				e2e_seconds: r ? r.e2e_seconds : NOT_MEASURED,
				gpu_seconds: r ? r.gpu_seconds : NOT_MEASURED,
				queue_seconds: r ? r.queue_seconds : NOT_MEASURED,
				tier,
				tier_rows: t ? t.rows : 0,
				tier_failed: t ? t.failed : 0,
			}];
		}),
	);

	return {
		generated_at: new Date().toISOString(),
		source: 'forge_creations (production database), read-only',
		window: { from, to, days },
		method: {
			e2e: 'completed_at minus created_at on done rows; nearest-rank percentiles',
			failure_rate: 'failed / (done + failed); generating rows excluded',
			output_bytes: 'size_bytes on done rows; nearest-rank percentiles',
			queue_and_gpu: 'queue_ms and gpu_ms as reported by the serving worker (TRELLIS.2); groups with none recorded say not measured',
			presets: 'trellis2 lane rows grouped by the voxel_resolution the worker reported; tier_rows and tier_failed count the whole tier the preset runs on, because a job killed mid-run never reports its resolution',
		},
		row_count: rows.length,
		lane_count: lanes.length,
		trellis2_rows: trellis2 ? trellis2.rows : 0,
		presets,
		lanes,
	};
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	loadEnv();
	if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set (env, .env.local or .env)');
	const sql = neon(process.env.DATABASE_URL);
	const to = new Date();
	const from = new Date(to.getTime() - args.days * 86_400_000);
	const rows = await sql`
		select backend, tier, status, size_bytes, voxel_resolution, queue_ms, gpu_ms,
		       extract(epoch from (completed_at - created_at))::float8 as e2e_s
		  from forge_creations
		 where created_at >= ${from.toISOString()} and created_at < ${to.toISOString()}`;
	const report = buildReport(rows, { from: from.toISOString(), to: to.toISOString(), days: args.days });
	const json = `${JSON.stringify(report, null, '\t')}\n`;
	if (args.stdout) {
		process.stdout.write(json);
		return;
	}
	writeFileSync(OUT_FILE, json);
	console.log(`[trellis2-benchmark] ${report.row_count} rows over ${args.days} days, ${report.lane_count} lanes, trellis2 rows: ${report.trellis2_rows}`);
	console.log(`[trellis2-benchmark] wrote ${path.relative(REPO_ROOT, OUT_FILE)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((err) => {
		console.error(`[trellis2-benchmark] ${err.message}`);
		process.exit(1);
	});
}

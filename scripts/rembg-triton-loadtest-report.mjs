#!/usr/bin/env node
// Join k6 summaries from scripts/rembg-triton-loadtest.k6.js with Cloud
// Monitoring utilisation for the same time window, and print the comparison
// table that docs/nvidia-triton-serving.md carries.
//
//   node scripts/rembg-triton-loadtest-report.mjs --dir <folder of summary-*.json> \
//     [--out docs/nvidia-triton-loadtest.json]
//
// Labels must look like "<lane>-c<vus>" (cpu-c8, gpu-c8). For each run the
// script reads, over [started_at, ended_at]:
//   cpu lane: run.googleapis.com/container/cpu/utilizations (mean) and
//             instance_count (max) for rembg-service
//   gpu lane: run.googleapis.com/container/gpu/utilizations (mean, the L4) and
//             custom.googleapis.com/triton/avg_batch_size (mean, our exporter)
// Auth: GCP_TOKEN, else `gcloud auth print-access-token`.

import { execFileSync } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
	options: {
		dir: { type: 'string' },
		out: { type: 'string' },
		project: { type: 'string', default: 'aerial-vehicle-466722-p5' },
		'cpu-service': { type: 'string', default: 'rembg-service' },
		'gpu-service': { type: 'string', default: 'rembg-triton' },
	},
});
if (!args.dir) {
	console.error('usage: node scripts/rembg-triton-loadtest-report.mjs --dir <summaries>');
	process.exit(2);
}

const token = process.env.GCP_TOKEN || execFileSync('gcloud', ['auth', 'print-access-token'], { encoding: 'utf8' }).trim();

async function series(filter, start, end, aligner, reducer) {
	const q = new URLSearchParams({
		filter,
		'interval.startTime': start,
		'interval.endTime': end,
		'aggregation.alignmentPeriod': '60s',
		'aggregation.perSeriesAligner': aligner,
	});
	if (reducer) q.set('aggregation.crossSeriesReducer', reducer);
	const resp = await fetch(`https://monitoring.googleapis.com/v3/projects/${args.project}/timeSeries?${q}`, {
		headers: { Authorization: `Bearer ${token}` },
	});
	if (!resp.ok) throw new Error(`monitoring ${resp.status}: ${await resp.text()}`);
	const body = await resp.json();
	return (body.timeSeries || []).flatMap((s) => s.points.map((p) => p.value.doubleValue ?? Number(p.value.int64Value)));
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const max = (xs) => (xs.length ? Math.max(...xs) : null);

const files = (await readdir(args.dir)).filter((f) => /^summary-.*\.json$/.test(f));
const rows = [];
for (const file of files) {
	const s = JSON.parse(await readFile(join(args.dir, file), 'utf8'));
	const [lane] = s.label.split('-');
	// Skip the first minute so ramp-up does not dilute steady-state utilisation.
	const start = new Date(Date.parse(s.started_at) + 60_000).toISOString();
	const end = s.ended_at;
	const svc = lane === 'gpu' ? args['gpu-service'] : args['cpu-service'];
	const runFilter = (metric) =>
		`metric.type="run.googleapis.com/container/${metric}" AND resource.labels.service_name="${svc}"`;
	const row = {
		lane,
		vus: s.vus,
		jobs: s.jobs_done,
		failed: s.jobs_failed,
		throughput_per_min: s.throughput_per_min,
		p50_ms: s.job_ms.med,
		p95_ms: s.job_ms['p(95)'],
		server_p50_ms: s.server_elapsed_ms.med,
		window: [start, end],
	};
	if (lane === 'gpu') {
		row.gpu_util = mean(await series(runFilter('gpu/utilizations'), start, end, 'ALIGN_MEAN'));
		row.avg_batch = mean(await series('metric.type="custom.googleapis.com/triton/avg_batch_size" AND metric.labels.model="isnet-general-use"', start, end, 'ALIGN_MEAN'));
	} else {
		row.cpu_util = mean(await series(runFilter('cpu/utilizations'), start, end, 'ALIGN_MEAN'));
	}
	row.instances = max(await series(runFilter('instance_count'), start, end, 'ALIGN_MAX', 'REDUCE_SUM'));
	rows.push(row);
}
rows.sort((a, b) => a.vus - b.vus || a.lane.localeCompare(b.lane));

const pct = (v) => (v == null ? 'n/a' : `${(100 * v).toFixed(0)}%`);
const sec = (v) => (v == null ? 'n/a' : (v / 1000).toFixed(2));
console.log('| Concurrency | Lane | Jobs/min | p50 s | p95 s | Server p50 s | Utilisation | Avg batch | Instances | Failed |');
console.log('|---|---|---|---|---|---|---|---|---|---|');
for (const r of rows) {
	const util = r.lane === 'gpu' ? `GPU ${pct(r.gpu_util)}` : `CPU ${pct(r.cpu_util)}`;
	const batch = r.lane === 'gpu' ? (r.avg_batch == null ? 'n/a' : r.avg_batch.toFixed(2)) : '-';
	console.log(`| ${r.vus} | ${r.lane === 'gpu' ? 'Triton L4' : 'CPU (ORT)'} | ${r.throughput_per_min.toFixed(1)} | ${sec(r.p50_ms)} | ${sec(r.p95_ms)} | ${sec(r.server_p50_ms)} | ${util} | ${batch} | ${r.instances ?? 'n/a'} | ${r.failed} |`);
}
if (args.out) await writeFile(args.out, JSON.stringify({ generated_at: new Date().toISOString(), rows }, null, 2) + '\n');

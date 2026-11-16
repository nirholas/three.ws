// k6 load test for rembg-service: the CPU lane vs the Triton GPU lane, measured
// the way callers use it (POST /remove, then poll GET /tasks/:id until done).
//
//   k6 run -e BASE_URL=https://bench-cpu---rembg-service-...run.app \
//          -e API_KEY=... -e VUS=8 -e DURATION=2m -e LABEL=cpu-c8 \
//          -e IMAGES="$(cat images.txt)" scripts/rembg-triton-loadtest.k6.js
//
// IMAGES is a newline-separated list of public https image URLs (the real
// evaluation portraits in the reconstruction bucket; see
// docs/nvidia-triton-loadtest.md for the exact set). Each VU loops: submit one
// image, poll every POLL_MS until the task is done or failed, record the
// wall time. The summary is written to summary-<LABEL>.json for
// scripts/rembg-triton-loadtest-report.mjs, which joins it with the Cloud
// Monitoring CPU/GPU utilisation for the same window.

import http from 'k6/http';
import { sleep, check } from 'k6';
import { Trend, Counter } from 'k6/metrics';

const BASE_URL = (__ENV.BASE_URL || '').replace(/\/$/, '');
const API_KEY = __ENV.API_KEY || '';
const VUS = Number(__ENV.VUS || 1);
const DURATION = __ENV.DURATION || '2m';
const LABEL = __ENV.LABEL || `c${VUS}`;
const POLL_MS = Number(__ENV.POLL_MS || 250);
const JOB_TIMEOUT_MS = Number(__ENV.JOB_TIMEOUT_MS || 120000);
const MODEL = __ENV.MODEL || 'rmbg2';
const IMAGES = (__ENV.IMAGES || '')
	.split('\n')
	.map((s) => s.trim())
	.filter(Boolean);

if (!BASE_URL || !API_KEY || IMAGES.length === 0) {
	throw new Error('BASE_URL, API_KEY and IMAGES are required');
}

const jobMs = new Trend('job_ms', true);
const serverMs = new Trend('server_elapsed_ms', true);
const jobsDone = new Counter('jobs_done');
const jobsFailed = new Counter('jobs_failed');

export const options = {
	scenarios: {
		steady: { executor: 'constant-vus', vus: VUS, duration: DURATION, gracefulStop: '2m' },
	},
	summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max', 'count'],
};

const headers = { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' };

export default function () {
	const image = IMAGES[(__VU * 7919 + __ITER) % IMAGES.length];
	const started = Date.now();
	const submit = http.post(`${BASE_URL}/remove`, JSON.stringify({ image, model: MODEL }), {
		headers,
		tags: { name: 'submit' },
	});
	if (!check(submit, { 'submit 202': (r) => r.status === 202 })) {
		jobsFailed.add(1);
		sleep(1);
		return;
	}
	const taskId = submit.json('task_id');
	while (Date.now() - started < JOB_TIMEOUT_MS) {
		sleep(POLL_MS / 1000);
		const poll = http.get(`${BASE_URL}/tasks/${taskId}`, { headers, tags: { name: 'poll' } });
		if (poll.status !== 200) continue;
		const status = poll.json('status');
		if (status === 'done') {
			jobMs.add(Date.now() - started);
			const elapsed = poll.json('elapsed_ms');
			if (typeof elapsed === 'number') serverMs.add(elapsed);
			jobsDone.add(1);
			return;
		}
		if (status === 'failed') {
			jobsFailed.add(1);
			return;
		}
	}
	jobsFailed.add(1);
}

export function handleSummary(data) {
	const m = data.metrics;
	const trend = (name) => (m[name] ? m[name].values : {});
	const count = (name) => (m[name] ? m[name].values.count : 0);
	const summary = {
		label: LABEL,
		base_url: BASE_URL,
		vus: VUS,
		duration: DURATION,
		started_at: new Date(Date.now() - data.state.testRunDurationMs).toISOString(),
		ended_at: new Date().toISOString(),
		run_ms: data.state.testRunDurationMs,
		jobs_done: count('jobs_done'),
		jobs_failed: count('jobs_failed'),
		throughput_per_min: (count('jobs_done') / data.state.testRunDurationMs) * 60000,
		job_ms: trend('job_ms'),
		server_elapsed_ms: trend('server_elapsed_ms'),
	};
	return {
		[`summary-${LABEL}.json`]: JSON.stringify(summary, null, 2),
		stdout: `${LABEL}: ${summary.jobs_done} done, ${summary.jobs_failed} failed, ` +
			`${summary.throughput_per_min.toFixed(1)}/min, p50 ${Math.round(summary.job_ms.med || 0)} ms, ` +
			`p95 ${Math.round(summary.job_ms['p(95)'] || 0)} ms\n`,
	};
}

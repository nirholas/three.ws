// Is a Cloud Run worker running right now? Read from Cloud Monitoring, never
// from the worker itself.
//
// Health probes used to GET each worker's /health on every status read. Every
// GPU worker (and the CPU editing workers) runs with CPU always allocated, so
// an instance bills for its whole life, and Cloud Run keeps an idle instance up
// for about 15 minutes after its last request. A probe therefore cost up to 15
// billed instance-minutes on a worker nobody was using. Measured over 24h on
// 2026-11-27: model-hunyuan3d-21-rtx ran zero jobs and billed 15.4 GPU hours on
// 396 probes from /api/forge?health; granite-guardian served 27 real calls and
// stayed up 24h on 7,042 probes from /api/healthz (the uptime check).
//
// run.googleapis.com/container/instance_count answers "is it up" without
// touching the container. One fleet-wide read is shared through the cache for
// WARMTH_TTL_S, so many lanes and many API instances cost one Monitoring call a
// minute. The metric lags by a minute or two; a worker that just woke may read
// asleep briefly, which only means its /health is read on the next refresh.
//
// Answers:
//   true   the worker has at least one instance: probing it is free
//   false  the worker is scaled to zero: probing it would wake and bill it
//   null   unknown (not a run.app URL, no project, Monitoring unreadable):
//          callers keep their old behavior and probe

import { getGcpAccessToken } from './gcp-auth.js';
import { cacheGet, cacheSet } from './cache.js';

const WARMTH_TTL_S = 60;
const LOOKBACK_MS = 5 * 60_000;
const READ_TIMEOUT_MS = 3_000;
// After a failed read, skip Monitoring for this long on this instance so a
// missing IAM grant does not add a timed-out call to every health request.
const FAILURE_BACKOFF_MS = 5 * 60_000;

let memo = null; // { at, project, services: Record<string, number> }
let failedAt = 0;
let warnedFailure = false;

/** Test hook: forget the cached fleet read and any failure backoff. */
export function resetWorkerWarmth() {
	memo = null;
	failedAt = 0;
	warnedFailure = false;
}

// Cloud Run hosts come in two shapes:
//   <service>-<project number>.<region>.run.app
//   <service>-<10-char hash>-<2-letter region code>.a.run.app
export function cloudRunServiceFromUrl(url) {
	let host;
	try {
		host = new URL(String(url)).hostname.toLowerCase();
	} catch {
		return null;
	}
	let m = host.match(/^([a-z0-9-]+?)-\d{6,}\.([a-z0-9-]+)\.run\.app$/);
	if (m) return { service: m[1], region: m[2] };
	m = host.match(/^([a-z0-9-]+?)-[a-z0-9]{10}-[a-z]{2}\.a\.run\.app$/);
	if (m) return { service: m[1], region: null };
	return null;
}

function workersProject() {
	const env = typeof process !== 'undefined' ? process.env : {};
	return (env.GCP_WORKERS_PROJECT || env.GCP_BILLING_PROJECT || env.GOOGLE_CLOUD_PROJECT || '').trim() || null;
}

async function readFleet(project) {
	const token = await getGcpAccessToken();
	const end = new Date();
	const params = new URLSearchParams({
		filter: 'metric.type="run.googleapis.com/container/instance_count" AND resource.type="cloud_run_revision"',
		'interval.startTime': new Date(end.getTime() - LOOKBACK_MS).toISOString(),
		'interval.endTime': end.toISOString(),
		'aggregation.alignmentPeriod': '60s',
		'aggregation.perSeriesAligner': 'ALIGN_MAX',
		'aggregation.crossSeriesReducer': 'REDUCE_SUM',
		'aggregation.groupByFields': 'resource.label.service_name',
	});
	params.append('aggregation.groupByFields', 'resource.label.location');
	const res = await fetch(`https://monitoring.googleapis.com/v3/projects/${encodeURIComponent(project)}/timeSeries?${params}`, {
		headers: { authorization: `Bearer ${token}` },
		signal: AbortSignal.timeout(READ_TIMEOUT_MS),
	});
	if (!res.ok) throw new Error(`Cloud Monitoring answered HTTP ${res.status}`);
	const body = await res.json();
	const services = {};
	for (const ts of body.timeSeries || []) {
		const labels = ts.resource?.labels || {};
		if (!labels.service_name) continue;
		// Points arrive newest first; the newest aligned minute is "now".
		const p = ts.points?.[0]?.value || {};
		const count = Number(p.int64Value ?? p.doubleValue ?? 0) || 0;
		services[labels.service_name] = (services[labels.service_name] || 0) + count;
		if (labels.location) {
			const k = `${labels.service_name}@${labels.location}`;
			services[k] = (services[k] || 0) + count;
		}
	}
	return services;
}

async function fleet(project) {
	if (memo && memo.project === project && Date.now() - memo.at < WARMTH_TTL_S * 1000) return memo.services;
	if (failedAt && Date.now() - failedAt < FAILURE_BACKOFF_MS) return null;
	const key = `worker-warmth:v1:${project}`;
	const shared = await cacheGet(key).catch(() => null);
	if (shared && typeof shared === 'object') {
		memo = { at: Date.now(), project, services: shared };
		return shared;
	}
	try {
		const services = await readFleet(project);
		memo = { at: Date.now(), project, services };
		failedAt = 0;
		cacheSet(key, services, WARMTH_TTL_S).catch(() => {});
		return services;
	} catch (err) {
		failedAt = Date.now();
		if (!warnedFailure) {
			warnedFailure = true;
			console.warn(`[worker-warmth] cannot read instance_count for ${project} (${err?.message || err}); health probes will call workers directly`);
		}
		return null;
	}
}

/**
 * @param {string} url a worker base URL
 * @returns {Promise<boolean|null>} true running, false scaled to zero, null unknown
 */
export async function isWorkerWarm(url) {
	const svc = cloudRunServiceFromUrl(url);
	const project = workersProject();
	if (!svc || !project) return null;
	const services = await fleet(project);
	if (!services) return null;
	const key = svc.region ? `${svc.service}@${svc.region}` : svc.service;
	return (services[key] || 0) > 0;
}

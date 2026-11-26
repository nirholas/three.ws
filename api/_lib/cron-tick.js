// One Cloud Scheduler job drives every cron declared in vercel.json.
//
// Why: Cloud Scheduler bills $0.10 per job per month past three free jobs per
// billing account, so one job per cron (180 of them on 2026-11-26) cost about
// $18 a month for nothing but a clock. Instead a single job calls
// /api/cron/scheduler-tick once a minute, and this module decides which declared
// crons are due in that minute and invokes each one exactly as its own
// Scheduler job used to: a GET to its path carrying the cron secret.
//
// What stays the same for every cron handler: the path, the method, the
// Authorization: Bearer $CRON_SECRET credential, the Host header it saw before
// (the Cloud Run service host the tick itself was called on), and its own
// wrapCron heartbeat. vercel.json's `crons` array stays the single source of
// truth, and a newly declared cron starts firing with the deploy that ships it,
// with no Scheduler sync step to forget.
//
// Semantics match Cloud Scheduler's unix-cron in UTC. The tick minute comes from
// the X-CloudScheduler-ScheduleTime header when present, so a delivery that
// lands a few seconds late still runs the minute it was scheduled for.

import http from 'node:http';
import https from 'node:https';
import { CronExpressionParser } from 'cron-parser';

export const TICK_PATH = '/api/cron/scheduler-tick';

// The longest cron budget in api/cron is 300s (wrapCron maxDurationMs). A child
// request that outlives that has already been answered by its own wrapCron, so
// this bound only catches a socket that never closes.
export const CHILD_TIMEOUT_MS = 330_000;

/** The UTC minute a tick runs, from the scheduler's header or the clock. */
export function tickMinute(scheduleTimeHeader, now = new Date()) {
	const parsed = typeof scheduleTimeHeader === 'string' ? Date.parse(scheduleTimeHeader) : NaN;
	const ms = Number.isFinite(parsed) ? parsed : now.getTime();
	return new Date(Math.floor(ms / 60_000) * 60_000);
}

/** True when a unix-cron expression fires at exactly this UTC minute. */
export function isDue(schedule, minute) {
	const it = CronExpressionParser.parse(String(schedule), {
		currentDate: new Date(minute.getTime() - 1000),
		tz: 'UTC',
	});
	return it.next().getTime() === minute.getTime();
}

/**
 * The declared crons due in `minute`. A path is fired at most once per minute
 * even if it is declared twice, the tick never schedules itself, and an
 * expression that does not parse is reported rather than thrown, so one bad
 * line in vercel.json cannot stop every other cron.
 */
export function dueCrons(crons, minute) {
	const due = [];
	const invalid = [];
	const seen = new Set();
	for (const cron of crons || []) {
		const cronPath = String(cron?.path || '');
		if (!cronPath.startsWith('/') || cronPath.split('?')[0] === TICK_PATH) continue;
		let fires;
		try {
			fires = isDue(cron.schedule, minute);
		} catch (err) {
			invalid.push({ path: cronPath, schedule: cron.schedule, error: err.message });
			continue;
		}
		if (fires && !seen.has(cronPath)) {
			seen.add(cronPath);
			due.push({ path: cronPath, schedule: cron.schedule });
		}
	}
	return { due, invalid };
}

/**
 * Where child requests go. By default the same container over loopback: the
 * tick request stays open until every child finishes, which keeps Cloud Run's
 * CPU allocated for them, and no extra request crosses the Cloud Run frontend.
 * CRON_TICK_ORIGIN points the fan-out at another deployment instead.
 */
export function childOrigin(env = process.env) {
	return env.CRON_TICK_ORIGIN || `http://127.0.0.1:${Number(env.PORT) || 8080}`;
}

function isLoopback(url) {
	return url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1';
}

/**
 * The headers one child request carries. Over loopback the Host and protocol of
 * the tick request are passed through, so a handler that builds an absolute URL
 * from its own request sees the same service host its Scheduler job used to
 * call. Toward any other origin the Host is the origin's own, which means a
 * forged Host on the tick can never steer the secret somewhere else.
 */
export function childHeaders({ url, secret, tick, host, proto }) {
	const headers = {
		authorization: `Bearer ${secret}`,
		'user-agent': 'three-ws-scheduler-tick',
		'x-cron-tick': tick.toISOString(),
	};
	if (isLoopback(url) && host) {
		headers.host = host;
		headers['x-forwarded-proto'] = proto || 'https';
	}
	return headers;
}

/** GET a URL, drain the body, and resolve with the status. */
export function requestStatus(url, headers, timeoutMs = CHILD_TIMEOUT_MS) {
	const mod = url.protocol === 'https:' ? https : http;
	return new Promise((resolve, reject) => {
		const req = mod.request(url, { method: 'GET', headers }, (res) => {
			res.on('error', reject);
			res.on('end', () => resolve(res.statusCode));
			res.resume();
		});
		req.setTimeout(timeoutMs, () => req.destroy(new Error(`no response within ${timeoutMs}ms`)));
		req.on('error', reject);
		req.end();
	});
}

/**
 * Fire every due cron at once (as their separate Scheduler jobs did) and wait
 * for all of them. Each result records the status or the transport error; a
 * failed child never stops the others.
 */
export async function runDue(due, { origin, secret, tick, host, proto, request = requestStatus }) {
	return Promise.all(
		due.map(async ({ path: cronPath }) => {
			const url = new URL(cronPath, origin);
			const t0 = Date.now();
			try {
				const status = await request(url, childHeaders({ url, secret, tick, host, proto }));
				return { path: cronPath, status, ok: status >= 200 && status < 400, ms: Date.now() - t0 };
			} catch (err) {
				return { path: cronPath, status: null, ok: false, ms: Date.now() - t0, error: err.message };
			}
		}),
	);
}

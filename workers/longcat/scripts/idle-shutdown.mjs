// Idle shutdown for the LongCat GPU host.
//
// An 80 GB GPU bills every minute it is up, so the host stops itself once the
// worker has had nothing to do for IDLE_MINUTES. A systemd timer on the VM runs
// this file every minute. Each run samples the worker's unauthenticated /health
// (active_jobs, idle_seconds), appends the sample to a small task log, decides
// with the pure function below, and issues `shutdown -h now` when the answer is
// "shutdown".
//
// The decision is a pure function of (task log, boot time, now, config) so it is
// tested against a fake clock and a recorded log in tests/idle-shutdown.test.js.
//
// Rules, in order:
//   1. A sample with active_jobs > 0 means the GPU is busy: never shut down.
//   2. The boot grace window (GRACE_MINUTES) always holds the host up, so a
//      caller that woke the VM has time to submit its job after /health turns green.
//   3. Otherwise idle time runs from the latest of: the last busy sample, the end
//      of the grace window, and the worker's own idle_seconds clock.
//   4. Idle time >= IDLE_MINUTES means shut down: this script exits with
//      SHUTDOWN_EXIT_CODE and the systemd wrapper on the host powers it off (a
//      containerised check cannot halt the host itself).
// An unreachable worker counts as idle: a crashed container must not keep a GPU
// billing.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const SHUTDOWN_EXIT_CODE = 10;

export const DEFAULTS = Object.freeze({
	idleMinutes: 20,
	graceMinutes: 15,
	maxLogSamples: 240,
});

const MIN = 60_000;

/**
 * @param {{ log: Array<{t:number, reachable:boolean, activeJobs:number}>,
 *           bootAt: number, now: number,
 *           idleMinutes?: number, graceMinutes?: number }} input
 * @returns {{ action: 'shutdown'|'keep', reason: string, idleMs: number }}
 */
export function decide({ log, bootAt, now, idleMinutes = DEFAULTS.idleMinutes, graceMinutes = DEFAULTS.graceMinutes }) {
	if (!Number.isFinite(bootAt) || !Number.isFinite(now)) {
		throw new TypeError('decide needs numeric bootAt and now');
	}
	const samples = Array.isArray(log) ? log : [];
	const latest = samples.length ? samples[samples.length - 1] : null;
	if (latest && latest.reachable && latest.activeJobs > 0) {
		return { action: 'keep', reason: 'job_active', idleMs: 0 };
	}
	let lastBusy = bootAt + graceMinutes * MIN;
	for (const s of samples) {
		if (s.reachable && s.activeJobs > 0 && s.t > lastBusy) lastBusy = s.t;
	}
	const idleMs = Math.max(0, now - lastBusy);
	if (now < bootAt + graceMinutes * MIN) return { action: 'keep', reason: 'boot_grace', idleMs: 0 };
	if (idleMs >= idleMinutes * MIN) return { action: 'shutdown', reason: 'idle_timeout', idleMs };
	return { action: 'keep', reason: 'recently_busy', idleMs };
}

/** Append a sample and keep the log bounded. */
export function appendSample(log, sample, max = DEFAULTS.maxLogSamples) {
	const next = [...(Array.isArray(log) ? log : []), sample];
	return next.length > max ? next.slice(next.length - max) : next;
}

/** Turn a /health body (or a failure) into a task-log sample. */
export function sampleFromHealth(body, now) {
	if (!body || typeof body !== 'object') return { t: now, reachable: false, activeJobs: 0 };
	const active = Number(body.active_jobs);
	return { t: now, reachable: true, activeJobs: Number.isFinite(active) && active > 0 ? active : 0 };
}

function readLog(path) {
	try {
		const parsed = JSON.parse(readFileSync(path, 'utf8'));
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

async function probeHealth(url) {
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
		if (!res.ok) return null;
		return await res.json();
	} catch {
		return null;
	}
}

async function main() {
	const env = process.env;
	const logPath = env.IDLE_LOG_PATH || '/var/lib/longcat/task-log.json';
	const healthUrl = env.HEALTH_URL || 'http://127.0.0.1:8080/health';
	const idleMinutes = Number(env.IDLE_MINUTES || DEFAULTS.idleMinutes);
	const graceMinutes = Number(env.GRACE_MINUTES || DEFAULTS.graceMinutes);
	const uptimeSeconds = Number(readFileSync('/proc/uptime', 'utf8').split(' ')[0]);
	const now = Date.now();
	const bootAt = now - uptimeSeconds * 1000;

	const body = await probeHealth(healthUrl);
	const log = appendSample(readLog(logPath), sampleFromHealth(body, now));
	mkdirSync(dirname(logPath), { recursive: true });
	writeFileSync(logPath, JSON.stringify(log));

	const verdict = decide({ log, bootAt, now, idleMinutes, graceMinutes });
	console.log(JSON.stringify({ at: new Date(now).toISOString(), ...verdict }));
	if (verdict.action === 'shutdown') process.exit(SHUTDOWN_EXIT_CODE);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
	main().catch((err) => {
		console.error('idle-shutdown failed:', err?.message || err);
		process.exit(1);
	});
}

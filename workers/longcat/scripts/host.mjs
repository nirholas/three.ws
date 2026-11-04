#!/usr/bin/env node
// Lifecycle control for the LongCat GPU host, over `gcloud compute instances`.
//
//   node workers/longcat/scripts/host.mjs status   # state, URL, GPU hours used today
//   node workers/longcat/scripts/host.mjs start    # start the VM (honors the daily cap)
//   node workers/longcat/scripts/host.mjs ensure   # start if stopped, wait for model_loaded
//   node workers/longcat/scripts/host.mjs stop     # stop the VM now
//   node workers/longcat/scripts/host.mjs reap     # stop the VM if it is over the daily cap
//
// The host is the dominant cost of this worker, so it is on demand. Every call
// reconciles the instance's real start/stop timestamps into a GPU-hour ledger
// (gs://<bucket>/longcat-host/ledger.json) and `start`/`ensure` refuse to boot a
// VM once LONGCAT_GPU_HOURS_PER_DAY (default 6) is used up. Exit codes: 0 ok,
// 1 error, 3 refused by the daily cap, 4 host did not become healthy in time.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
	DEFAULT_DAILY_CAP_HOURS,
	capDecision,
	hoursUsedToday,
	pruneLedger,
	upsertInterval,
} from './gpu-ledger.mjs';

const run = promisify(execFile);

const PROJECT = process.env.GCP_PROJECT || 'aerial-vehicle-466722-p5';
const ZONE = process.env.ZONE || 'us-central1-a';
const NAME = process.env.INSTANCE_NAME || 'longcat-avatar';
const LEDGER_URI = process.env.LONGCAT_LEDGER_URI || 'gs://three-ws-avatar-reconstructions/longcat-host/ledger.json';
const CAP_HOURS = Number(process.env.LONGCAT_GPU_HOURS_PER_DAY || DEFAULT_DAILY_CAP_HOURS);
const HEALTH_WAIT_MS = Number(process.env.LONGCAT_HEALTH_WAIT_MS || 30 * 60_000);

async function gcloud(args, { allowFail = false, input } = {}) {
	try {
		const child = run('gcloud', ['--project', PROJECT, ...args], { maxBuffer: 16 * 1024 * 1024 });
		if (input !== undefined) child.child.stdin.end(input);
		return (await child).stdout;
	} catch (err) {
		if (allowFail) return null;
		throw new Error(`gcloud ${args.slice(0, 3).join(' ')} failed: ${(err.stderr || err.message).trim().split('\n')[0]}`);
	}
}

export async function describeHost() {
	const out = await gcloud(['compute', 'instances', 'describe', NAME, '--zone', ZONE, '--format=json'], { allowFail: true });
	if (!out) return { state: 'absent' };
	const d = JSON.parse(out);
	const nat = d.networkInterfaces?.[0]?.accessConfigs?.[0]?.natIP || null;
	return {
		state: d.status,
		ip: nat,
		url: nat ? `https://${nat.replaceAll('.', '-')}.sslip.io` : null,
		lastStart: d.lastStartTimestamp ? Date.parse(d.lastStartTimestamp) : null,
		lastStop: d.lastStopTimestamp ? Date.parse(d.lastStopTimestamp) : null,
		machineType: d.machineType?.split('/').pop(),
	};
}

async function readLedger() {
	const out = await gcloud(['storage', 'cat', LEDGER_URI], { allowFail: true });
	if (!out) return [];
	try {
		const parsed = JSON.parse(out);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

async function writeLedger(ledger) {
	await gcloud(['storage', 'cp', '-', LEDGER_URI, '--content-type=application/json'], { input: JSON.stringify(ledger) });
}

/** Fold the instance's real timestamps into the ledger. Idempotent. */
export function reconcile(ledger, host, now) {
	let next = ledger;
	if (host.lastStart) {
		const stopped = host.state !== 'RUNNING' && host.lastStop && host.lastStop >= host.lastStart;
		next = upsertInterval(next, { start: host.lastStart, stop: stopped ? host.lastStop : null });
	}
	return pruneLedger(next, now);
}

async function snapshot() {
	const now = Date.now();
	const host = await describeHost();
	const before = await readLedger();
	const ledger = reconcile(before, host, now);
	if (JSON.stringify(ledger) !== JSON.stringify(before)) await writeLedger(ledger);
	return { now, host, ledger };
}

async function healthy(url) {
	try {
		const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(10_000) });
		if (!res.ok) return false;
		return (await res.json()).model_loaded === true;
	} catch {
		return false;
	}
}

async function waitHealthy(url) {
	const deadline = Date.now() + HEALTH_WAIT_MS;
	while (Date.now() < deadline) {
		if (await healthy(url)) return true;
		await new Promise((r) => setTimeout(r, 15_000));
	}
	return false;
}

function report(snap, extra = {}) {
	const used = hoursUsedToday(snap.ledger, snap.now);
	return {
		instance: NAME,
		zone: ZONE,
		state: snap.host.state,
		machineType: snap.host.machineType || null,
		url: snap.host.url || null,
		gpuHoursToday: Number(used.toFixed(2)),
		gpuHoursCap: CAP_HOURS,
		...extra,
	};
}

async function start(snap) {
	if (snap.host.state === 'absent') {
		throw new Error('host does not exist: run workers/longcat/deploy-gce.sh first');
	}
	if (snap.host.state === 'RUNNING') return snap;
	const decision = capDecision({ ledger: snap.ledger, now: snap.now, capHours: CAP_HOURS });
	if (!decision.allowed) {
		const err = new Error(`gpu_hour_cap_reached: ${decision.usedHours.toFixed(2)} of ${CAP_HOURS} GPU hours used today (UTC)`);
		err.exitCode = 3;
		throw err;
	}
	await gcloud(['compute', 'instances', 'start', NAME, '--zone', ZONE]);
	return snapshot();
}

async function main() {
	const cmd = process.argv[2];
	if (!['status', 'start', 'stop', 'ensure', 'reap'].includes(cmd)) {
		console.error('usage: host.mjs status|start|ensure|stop|reap');
		process.exit(2);
	}
	let snap = await snapshot();
	if (cmd === 'status') {
		const live = snap.host.url && snap.host.state === 'RUNNING' ? await healthy(snap.host.url) : false;
		console.log(JSON.stringify(report(snap, { modelLoaded: live }), null, 2));
		return;
	}
	if (cmd === 'stop') {
		if (snap.host.state === 'RUNNING') await gcloud(['compute', 'instances', 'stop', NAME, '--zone', ZONE]);
		snap = await snapshot();
		console.log(JSON.stringify(report(snap), null, 2));
		return;
	}
	if (cmd === 'reap') {
		const over = hoursUsedToday(snap.ledger, snap.now) >= CAP_HOURS;
		if (snap.host.state === 'RUNNING' && over) {
			await gcloud(['compute', 'instances', 'stop', NAME, '--zone', ZONE]);
			snap = await snapshot();
			console.log(JSON.stringify(report(snap, { reaped: true }), null, 2));
		} else {
			console.log(JSON.stringify(report(snap, { reaped: false }), null, 2));
		}
		return;
	}
	snap = await start(snap);
	if (cmd === 'ensure') {
		const ok = snap.host.url ? await waitHealthy(snap.host.url) : false;
		console.log(JSON.stringify(report(snap, { modelLoaded: ok }), null, 2));
		if (!ok) process.exit(4);
		return;
	}
	console.log(JSON.stringify(report(snap), null, 2));
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
	main().catch((err) => {
		console.error(err.message);
		process.exit(err.exitCode || 1);
	});
}

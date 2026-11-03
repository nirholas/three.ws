#!/usr/bin/env node
/**
 * One-command pre-event check for the /play client.
 *
 *   npm run audit:event-client                      # every step, local dev server
 *   npm run audit:event-client -- --base https://three.ws   # production ground truth
 *   npm run audit:event-client -- --only mobile:chromium,touch
 *   npm run audit:event-client -- --run-ms 300000   # 5-minute soak (heap growth)
 *   npm run audit:event-client -- --limit chromium.maxTransferMB=1   # seed a regression
 *   npm run audit:event-client -- --json docs/event-readiness/results/<date>.json
 *
 * Steps, each against the canonical $THREE world link:
 *   mobile:chromium  scripts/play-mobile-repro.mjs in an emulated iPhone (heap,
 *                    transfer, time to a visible world, worst frame while walking,
 *                    duplicate GLB/clip downloads, page errors, socket drops)
 *   mobile:webkit    the same in WebKit, which reproduces iOS Safari memory kills
 *   touch            scripts/mobile-touch-audit.mjs on /play (44 px targets,
 *                    canvas touch-action, safe-area bars, sideways overflow)
 *   console          scripts/audit-console.mjs /play, both viewports
 *   failures         scripts/audit-play-failure-modes.mjs (no session, blocked
 *                    IPFS and GLB, hostile query strings, expired pass)
 *
 * The mobile and touch verdicts come from scripts/lib/event-client-verdict.mjs
 * against the committed limits in scripts/audit-event-client.baseline.json; the
 * console and failure-mode harnesses keep their own exit codes.
 *
 * Exit codes: 0 every step passed, 1 a real regression, 3 a step never got a fair
 * reading (navigation timeout or ERR_NETWORK_CHANGED on a busy shared box) even
 * after one retry. 3 means "rerun when the machine is quiet", never "fine".
 */

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { judgeRun, judgeTouch, exitCodeFor } from './lib/event-client-verdict.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(ROOT, 'scripts', 'audit-event-client.baseline.json');
const STEPS = ['mobile:chromium', 'mobile:webkit', 'touch', 'console', 'failures'];

// The link shared for the event (docs/event-readiness/README.md).
const CANONICAL_QUERY =
	'coin=FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump&name=three.ws&symbol=three' +
	'&image=%2Fapi%2Fimg%3Furl%3Dhttps%253A%252F%252Fipfs.io%252Fipfs%252Fbafybeihe22b5sxr3ihnxt7pregfieyteqvubqhik3j3y4bbx243xlqjw3q%26seed%3DFeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';

const C = {
	g: (s) => `\x1b[32m${s}\x1b[0m`,
	r: (s) => `\x1b[31m${s}\x1b[0m`,
	y: (s) => `\x1b[33m${s}\x1b[0m`,
	d: (s) => `\x1b[2m${s}\x1b[0m`,
	b: (s) => `\x1b[1m${s}\x1b[0m`,
};

function parseArgs(argv) {
	const out = { base: process.env.AUDIT_BASE || '', runMs: 120000, only: STEPS, limits: [], json: '' };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		const next = () => {
			const v = argv[++i];
			if (v == null) throw new Error(`${a} needs a value`);
			return v;
		};
		if (a === '--base') out.base = next().replace(/\/+$/, '');
		else if (a === '--run-ms') out.runMs = Number(next());
		else if (a === '--only') out.only = next().split(',').map((s) => s.trim()).filter(Boolean);
		else if (a === '--limit') out.limits.push(next());
		else if (a === '--json') out.json = next();
		else if (a === '--help' || a === '-h') out.help = true;
		else throw new Error(`unknown argument ${a}`);
	}
	for (const s of out.only) if (!STEPS.includes(s)) throw new Error(`unknown step ${s} (steps: ${STEPS.join(', ')})`);
	if (!Number.isFinite(out.runMs) || out.runMs < 10000) throw new Error('--run-ms must be at least 10000');
	return out;
}

// --limit chromium.maxTransferMB=1 overrides one committed limit for this run.
function loadLimits(overrides) {
	const limits = JSON.parse(readFileSync(BASELINE, 'utf8')).limits;
	for (const o of overrides) {
		const m = /^(chromium|webkit)\.(\w+)=(-?[\d.]+)$/.exec(o);
		if (!m) throw new Error(`--limit expects <engine>.<key>=<number>, got ${o}`);
		limits[m[1]] = { ...limits[m[1]], [m[2]]: Number(m[3]) };
	}
	return limits;
}

function run(cmd, args, env = {}) {
	return new Promise((res) => {
		const child = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
		let out = '';
		child.stdout.on('data', (d) => { out += d; });
		child.stderr.on('data', (d) => { out += d; });
		child.on('close', (code) => res({ code: code ?? 1, out }));
	});
}

async function reachable(url) {
	try {
		const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
		return r.ok;
	} catch {
		return false;
	}
}

function freePort() {
	return new Promise((res, rej) => {
		const s = createServer();
		s.unref();
		s.on('error', rej);
		s.listen(0, '127.0.0.1', () => {
			const { port } = s.address();
			s.close(() => res(port));
		});
	});
}

// Reuse the server named by --base / AUDIT_BASE when it answers; otherwise start
// an ephemeral Vite on a free port so this never collides with another session.
async function ensureServer(base) {
	if (base) {
		if (!(await reachable(`${base}/play`))) throw new Error(`${base}/play is not answering`);
		// A Vite dev server answers its own client module; a built deploy does not.
		return { base, dev: await reachable(`${base}/@vite/client`), stop: () => {} };
	}
	const port = await freePort();
	const child = spawn('npx', ['vite', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], {
		cwd: ROOT, stdio: 'ignore', detached: true,
	});
	const url = `http://127.0.0.1:${port}`;
	const deadline = Date.now() + 240000;
	while (Date.now() < deadline) {
		if (child.exitCode != null) throw new Error(`vite exited early (code ${child.exitCode})`);
		if (await reachable(`${url}/play`)) {
			return { base: url, dev: true, stop: () => { try { process.kill(-child.pid); } catch { /* already gone */ } } };
		}
		await new Promise((r) => setTimeout(r, 2000));
	}
	try { process.kill(-child.pid); } catch { /* already gone */ }
	throw new Error('vite did not answer within 240 s');
}

// The size and timing ceilings describe the production bundle. A Vite dev
// server ships every module unbundled and transforms it on first request, so
// against one only the correctness checks (duplicate downloads, page errors,
// console errors, dropped sockets) are judged.
async function mobileStep(engine, base, runMs, limits, scratch, dev) {
	const file = join(scratch, `mobile-${engine}.json`);
	const log = await run(process.execPath, [join(ROOT, 'scripts', 'play-mobile-repro.mjs'), `${base}/play?${CANONICAL_QUERY}`, String(runMs)], {
		ENGINE: engine, SUMMARY_JSON: file,
	});
	// The full harness log (GLB call stacks, every failed request) is what turns
	// a red line into a fix, so it stays beside the summary.
	writeFileSync(file.replace(/\.json$/, '.log'), log.out);
	if (!existsSync(file)) {
		return { status: 'fail', reasons: [`harness exited ${log.code} without a summary: ${log.out.trim().split('\n').slice(-3).join(' | ').slice(0, 300)}`] };
	}
	const summary = JSON.parse(readFileSync(file, 'utf8'));
	return { ...judgeRun(summary, dev ? {} : limits[engine] || {}), summary };
}

async function touchStep(base, scratch) {
	const file = join(scratch, 'touch.json');
	const log = await run(process.execPath, [join(ROOT, 'scripts', 'mobile-touch-audit.mjs'), '--base', base, '--pages', `/play?${CANONICAL_QUERY}`, '--json', file]);
	if (!existsSync(file)) return { status: 'fail', reasons: [`touch audit exited ${log.code} without a report`] };
	return judgeTouch(JSON.parse(readFileSync(file, 'utf8')).results?.[0]);
}

// These two own their pass/fail logic; a non-zero exit is the verdict. Their
// last lines carry the findings, which is what the summary table shows.
async function exitCodeStep(script, args, env) {
	const log = await run(process.execPath, [join(ROOT, 'scripts', script), ...args], env);
	const tail = log.out.replace(/\x1b\[[0-9;]*m/g, '').trim().split('\n').filter(Boolean).slice(-6);
	if (log.code === 0) return { status: 'pass', reasons: [] };
	// Both harnesses report a navigation that never finished as a failure. On a
	// shared box that is the machine, so call it what it is.
	const allTimeouts = /Timeout \d+ms exceeded|net::ERR_NETWORK_CHANGED/.test(log.out) && !/xss|executed|pageerror|console\.(error|warn)/i.test(tail.join('\n'));
	return { status: allTimeouts ? 'unmeasured' : 'fail', reasons: tail };
}

async function runStep(step, ctx) {
	if (step.startsWith('mobile:')) return mobileStep(step.slice(7), ctx.base, ctx.runMs, ctx.limits, ctx.scratch, ctx.dev);
	if (step === 'touch') return touchStep(ctx.base, ctx.scratch);
	if (step === 'console') return exitCodeStep('audit-console.mjs', ['/play'], { AUDIT_BASE: ctx.base });
	return exitCodeStep('audit-play-failure-modes.mjs', [], { BASE_URL: ctx.base });
}

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	if (opts.help) {
		console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
		return 0;
	}
	const limits = loadLimits(opts.limits);
	const scratch = join(tmpdir(), `audit-event-client-${process.pid}`);
	mkdirSync(scratch, { recursive: true });
	const server = await ensureServer(opts.base);
	console.log(C.b('\naudit-event-client') + C.d(`  ${server.base}  run ${opts.runMs / 1000}s  steps ${opts.only.join(', ')}`));
	if (server.dev) console.log(C.y('  dev server: size and timing ceilings are skipped (they describe the production bundle); pass --base https://three.ws to judge them'));
	console.log('');

	const results = [];
	try {
		for (const step of opts.only) {
			const started = Date.now();
			let r = await runStep(step, { base: server.base, dev: server.dev, runMs: opts.runMs, limits, scratch });
			if (r.status === 'unmeasured') {
				console.log(C.y(`  ${step.padEnd(16)} unmeasured (${r.reasons[0]}), retrying once`));
				r = await runStep(step, { base: server.base, dev: server.dev, runMs: opts.runMs, limits, scratch });
			}
			const secs = Math.round((Date.now() - started) / 1000);
			const tag = r.status === 'pass' ? C.g('pass') : r.status === 'fail' ? C.r('FAIL') : C.y('unmeasured');
			console.log(`  ${step.padEnd(16)} ${tag}  ${C.d(`${secs}s`)}`);
			if (r.metrics) console.log(C.d(`                   ${JSON.stringify(r.metrics)}`));
			for (const reason of r.reasons.slice(0, 12)) console.log(`                   ${reason}`);
			results.push({ step, status: r.status, reasons: r.reasons, metrics: r.metrics || null });
		}
	} finally {
		server.stop();
	}

	if (opts.json) {
		const p = resolve(ROOT, opts.json);
		mkdirSync(dirname(p), { recursive: true });
		writeFileSync(p, JSON.stringify({ base: server.base, runMs: opts.runMs, at: new Date().toISOString(), limits, results }, null, 2));
		console.log(C.d(`\n  wrote ${p}`));
	}
	console.log(C.d(`\n  harness summaries and logs: ${scratch}`));
	const code = exitCodeFor(results.map((r) => r.status));
	const msg = code === 0 ? C.g('all steps passed') : code === 1 ? C.r('regression found') : C.y('some steps were never measured; rerun when the machine is quiet');
	console.log(`\n  ${msg}\n`);
	return code;
}

main().then((code) => process.exit(code)).catch((err) => {
	console.error(C.r(`audit-event-client failed: ${err.stack || err.message}`));
	process.exit(1);
});

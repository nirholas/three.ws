#!/usr/bin/env node
// Operator CLI for the Grok-facing MCP connector probe.
//
// Runs exactly the probe the five-minute cron runs (api/_lib/mcp-probe.js:
// initialize, notifications/initialized, tools/list, one read-only tool call,
// then the ?auth=oauth discovery path) from this machine against production
// (or --base), and prints one row per server with per-step latency. Run it
// before any marketplace or directory submission: a FAIL row here is what a
// reviewer would hit.
//
// The server list is the target's own /.well-known/mcp.json (what connectors
// read), so a Grok-facing server added there is probed with no change here.
// Nothing is written anywhere and no credential is sent.
//
//   npm run grok:mcp-probe                                  # https://three.ws, one run
//   npm run grok:mcp-probe -- --runs 20                     # p50/p95 handshake over 20 runs
//   npm run grok:mcp-probe -- --base http://localhost:3280  # a dev server
//   npm run grok:mcp-probe -- --json out.json --timeout 20000
//
// Exit code 0 when every run of every server passed, 1 otherwise.

import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { STEPS, STEP_TIMEOUT_MS, grokFacingTargets, handshakeMs, loadManifest, probeAll } from '../api/_lib/mcp-probe.js';

const { values: args } = parseArgs({
	options: {
		base: { type: 'string', default: 'https://three.ws' },
		runs: { type: 'string', default: '1' },
		timeout: { type: 'string', default: String(STEP_TIMEOUT_MS) },
		json: { type: 'string' },
		help: { type: 'boolean', short: 'h', default: false },
	},
});

if (args.help) {
	console.log('usage: npm run grok:mcp-probe -- [--base <origin>] [--runs <n>] [--timeout <ms per step>] [--json <file>]');
	process.exit(0);
}

const base = args.base.replace(/\/+$/, '');
const runs = Math.max(1, Math.min(200, Number.parseInt(args.runs, 10) || 1));
const stepTimeoutMs = Math.max(1000, Number.parseInt(args.timeout, 10) || STEP_TIMEOUT_MS);

/** Nearest-rank percentile over a sorted copy. */
function percentile(values, p) {
	if (!values.length) return null;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
}

async function readManifest() {
	try {
		return { manifest: await loadManifest({ base, timeoutMs: stepTimeoutMs }), source: `${base}/.well-known/mcp.json` };
	} catch (err) {
		// The directory itself being unreachable is worth saying out loud, but the
		// servers can still be probed from the copy in this checkout.
		console.warn(`warning: could not read ${base}/.well-known/mcp.json (${err?.message || err}); using public/.well-known/mcp.json from this checkout`);
		return { manifest: await loadManifest(), source: 'public/.well-known/mcp.json (local checkout)' };
	}
}

const { manifest, source } = await readManifest();
const targets = grokFacingTargets(manifest, { base });
if (!targets.length) {
	console.error(`No Grok-facing servers in ${source}. The probe takes the grok-bot client's recommendedServer plus every server with a signIn URL.`);
	process.exit(1);
}

console.log(`Probing ${targets.length} Grok-facing MCP server(s) from ${source}, ${runs} run(s), ${stepTimeoutMs}ms per step\n`);

/** @type {Map<string, Array<Awaited<ReturnType<typeof probeAll>>[number]>>} */
const byServer = new Map(targets.map((t) => [t.server, []]));
for (let i = 0; i < runs; i++) {
	const results = await probeAll(targets, { stepTimeoutMs });
	for (const r of results) byServer.get(r.server).push(r);
	if (runs > 1 && process.stdout.isTTY) process.stdout.write(`\r  run ${i + 1}/${runs}`);
}
if (runs > 1 && process.stdout.isTTY) process.stdout.write('\n\n');

// Only the steps some server actually ran get a column (no oauth columns when
// no server publishes a sign-in URL).
const steps = STEPS.filter((s) => [...byServer.values()].some((rs) => rs.some((r) => s in r.latencyMs)));
const SHORT = { initialize: 'init', 'notifications/initialized': 'notif', 'tools/list': 'list', 'tools/call': 'call', oauth_challenge: 'oauth401', oauth_metadata: 'prm' };

const summary = targets.map((t) => {
	const rs = byServer.get(t.server);
	const passed = rs.filter((r) => r.ok);
	const hs = passed.map((r) => handshakeMs(r.latencyMs)).filter((n) => n != null);
	const last = rs[rs.length - 1];
	const median = (step) => percentile(rs.map((r) => r.latencyMs[step]).filter(Number.isFinite), 50);
	return {
		server: t.server,
		name: t.name,
		verdict: passed.length === rs.length ? 'PASS' : 'FAIL',
		runs: rs.length,
		passed: passed.length,
		stepMedianMs: Object.fromEntries(steps.map((s) => [s, median(s)])),
		handshakeP50Ms: percentile(hs, 50),
		handshakeP95Ms: percentile(hs, 95),
		tool: last.detail.tool,
		toolCount: last.detail.toolCount,
		protocolVersion: last.detail.protocolVersion,
		sessionIssued: last.detail.sessionIssued,
		failures: rs.filter((r) => !r.ok).map((r) => ({ checkedAt: r.checkedAt, failedStep: r.failedStep, error: r.error })),
		warnings: [...new Set(rs.flatMap((r) => r.detail.warnings))],
	};
});

const header = ['verdict', 'server', 'runs', ...steps.map((s) => `${SHORT[s] || s} ms`), 'handshake p50', 'p95', 'tool'];
const rows = summary.map((s) => [
	s.verdict,
	new URL(s.server).pathname,
	`${s.passed}/${s.runs}`,
	...steps.map((st) => (s.stepMedianMs[st] == null ? '-' : String(s.stepMedianMs[st]))),
	s.handshakeP50Ms == null ? '-' : String(s.handshakeP50Ms),
	s.handshakeP95Ms == null ? '-' : String(s.handshakeP95Ms),
	s.tool ? `${s.tool} (${s.toolCount} listed)` : '-',
]);
const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
const line = (cells) => cells.map((c, i) => c.padEnd(widths[i])).join('  ');
console.log(line(header));
console.log(widths.map((w) => '-'.repeat(w)).join('  '));
for (const r of rows) console.log(line(r));
console.log(`\nStep columns are medians across runs. Handshake = initialize + notifications/initialized + tools/list, over passing runs.`);

for (const s of summary) {
	for (const w of s.warnings) console.log(`warn  ${new URL(s.server).pathname}: ${w}`);
	for (const f of s.failures) console.log(`FAIL  ${new URL(s.server).pathname} at ${f.checkedAt}: ${f.failedStep} failed: ${f.error}`);
}

if (args.json) {
	writeFileSync(args.json, `${JSON.stringify({ generatedAt: new Date().toISOString(), base, source, runs, stepTimeoutMs, servers: summary }, null, 2)}\n`);
	console.log(`\nWrote ${args.json}`);
}

process.exit(summary.every((s) => s.verdict === 'PASS') ? 0 : 1);

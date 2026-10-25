#!/usr/bin/env node
// Verify every cron handler that vercel.json grants more than the
// DEFAULT_CRON_MAX_DURATION_MS (120s) default actually tells wrapCron about its
// larger budget.
//
// 2026-10-24 incident, found twice by hand from a log signature before this
// check existed: api/cron/x402-ring-leak-scan.js and api/cron/[name].js both
// declared `maxDuration: 300` in vercel.json but never passed `maxDurationMs`
// into wrapCron() (api/_lib/http.js), so wrapCron fell back to its 120s
// default and answered 503 cron_timeout on every run once the workload
// crossed 120s. A follow-up sweep found the identical unwired gap in ten more
// standalone cron handlers. Both classes are structural: a declared budget in
// vercel.json that the handler never actually receives. This script closes
// that gap for every current and future cron, not just the twelve found so
// far.
//
// A handler passes when it statically exports a `maxDuration` constant equal
// to vercel.json's declared value for its route, and its source text wires
// that same constant into wrapCron's `maxDurationMs` option. The second half
// matters: a file can export the right number and still forget to pass it
// (exactly what happened twice), so exports alone are not enough to trust.
//
// Usage:
//   node scripts/check-cron-budget-wiring.mjs          # human-readable
//   node scripts/check-cron-budget-wiring.mjs --json    # machine-readable
//
// Exits non-zero when any in-scope cron is missing the wiring, so it can gate
// a deploy (wired into the `gate` script in package.json).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { globSync } from 'glob';
import { DEFAULT_CRON_MAX_DURATION_MS } from '../api/_lib/http.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CRON_MAX_DURATION_S = DEFAULT_CRON_MAX_DURATION_MS / 1000;

const argv = process.argv.slice(2);
const AS_JSON = argv.includes('--json');

// Routes whose declared budget legitimately differs from what the handler
// itself wires (not the wiring bug this script hunts), named here instead of
// weakening the general check. Keep this list empty unless a real exception
// is found; add a one-line reason next to any entry.
const KNOWN_EXCEPTIONS = new Set([]);

const isCronFile = (p) => p.startsWith('api/cron/') && p.endsWith('.js');

// vercel.json spells a dynamic route segment the Next.js/Vercel way, e.g.
// `api/cron/[name].js`. Those brackets are never a glob character class in
// this file's keys (confirmed: every bracketed key in vercel.json is one of
// this naming convention), but glob() parses `[name]` as "one of n/a/m/e" and
// silently matches nothing. Escape them so the literal filename survives.
const escapeBrackets = (pattern) => pattern.replace(/\[/g, '\\[').replace(/\]/g, '\\]');

/**
 * Every `api/cron/*.js` path vercel.json grants more than the 120s default,
 * mapped to its declared seconds.
 *
 * vercel.json's `functions` object resolves by specificity, not by key order:
 * the broad catch-all `"api/**\/*.js": { maxDuration: 30 }` at the bottom
 * covers every route, but a named/exact route elsewhere overrides it for the
 * files it lists. Applying wildcard keys first and letting named keys win
 * (never the reverse) mirrors that: a plain last-key-wins merge would let the
 * 30s catch-all stomp every real 300s declaration.
 */
function declaredCronBudgets() {
	const { functions } = JSON.parse(readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
	const entries = Object.entries(functions || {}).filter(([, c]) => typeof c?.maxDuration === 'number');
	const [named, wildcard] = [entries.filter(([k]) => !k.includes('*')), entries.filter(([k]) => k.includes('*'))];

	const budgets = new Map();
	for (const [key, config] of wildcard) {
		for (const match of globSync(escapeBrackets(key), { cwd: ROOT })) {
			if (isCronFile(match)) budgets.set(match, config.maxDuration);
		}
	}
	for (const [key, config] of named) {
		for (const match of globSync(escapeBrackets(key), { cwd: ROOT })) {
			if (isCronFile(match)) budgets.set(match, config.maxDuration);
		}
	}
	return budgets;
}

/** Find the exported constant (any name) whose value equals the declared seconds. */
async function wiredExport(cronPath, declaredSeconds) {
	const mod = await import(pathToFileURL(path.join(ROOT, cronPath)).href);
	if (mod.maxDuration === declaredSeconds) return 'maxDuration';
	return Object.keys(mod).find((k) => mod[k] === declaredSeconds) || null;
}

async function main() {
	const budgets = declaredCronBudgets();
	const inScope = [...budgets].filter(([, s]) => s > DEFAULT_CRON_MAX_DURATION_S);
	const problems = [];
	const clean = [];

	for (const [cronPath, declaredSeconds] of inScope) {
		if (KNOWN_EXCEPTIONS.has(cronPath)) continue;

		const exportName = await wiredExport(cronPath, declaredSeconds);
		if (!exportName) {
			problems.push({
				path: cronPath,
				declared: declaredSeconds,
				reason: `declares ${declaredSeconds}s in vercel.json but exports no constant equal to it (wrapCron will fall back to the ${DEFAULT_CRON_MAX_DURATION_S}s default)`,
			});
			continue;
		}

		const src = readFileSync(path.join(ROOT, cronPath), 'utf8');
		const wiredPattern = new RegExp(`maxDurationMs\\s*:\\s*${exportName}\\s*\\*\\s*1000`);
		if (!wiredPattern.test(src)) {
			problems.push({
				path: cronPath,
				declared: declaredSeconds,
				reason: `exports ${exportName} = ${declaredSeconds} but its wrapCron(...) call never passes { maxDurationMs: ${exportName} * 1000 }, so wrapCron still falls back to the ${DEFAULT_CRON_MAX_DURATION_S}s default`,
			});
			continue;
		}

		clean.push({ path: cronPath, declared: declaredSeconds, exportName });
	}

	if (AS_JSON) {
		console.log(JSON.stringify({ checked: inScope.length, clean, problems }, null, 2));
		process.exit(problems.length ? 1 : 0);
	}

	console.log(
		`Checked ${inScope.length} cron route(s) declared above the ${DEFAULT_CRON_MAX_DURATION_S}s default; ${clean.length} correctly wired.`,
	);
	if (problems.length) {
		console.log(`\nUNWIRED budget: ${problems.length}`);
		for (const p of problems) console.log(`  ${p.path}  (declared ${p.declared}s)\n    ${p.reason}`);
	} else {
		console.log('No unwired cron budgets: every declared maxDuration above the default reaches wrapCron.');
	}

	process.exit(problems.length ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	await main();
}

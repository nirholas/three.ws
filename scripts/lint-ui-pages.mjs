#!/usr/bin/env node
// Lints the core three.ws pages with lintapple against ui-policy.json and prints one row per page.
//
// Usage:
//   npm run dev                         # app on :3000 (or any port, then pass --base)
//   npm run lint:ui:core                # every core page
//   node scripts/lint-ui-pages.mjs --base http://localhost:3017 --only /gallery,/create --json report.json
//
// Options:
//   --base <url>       dev server origin (default http://localhost:3000)
//   --only <paths>     comma-separated subset of the core page paths
//   --timeout <ms>     per-step budget handed to lintapple (default 120000). The lintapple CLI pins
//                      15s, which a cold Vite dev server or a busy machine regularly exceeds; this
//                      script calls the library API so the budget is configurable.
//   --json <file>      write the full per-page report (findings, suppressed, errors) as JSON
//
// Exit codes follow lintapple: 0 every page passed, 1 at least one page has findings,
// 2 at least one page could not be checked (an execution error outranks findings, because a page
// that never finished checking proves nothing).
//
// Component targets: lintapple refuses pages with more than 5000 visible elements. A page that
// crosses that line is listed below with `scope`, a selector for the component worth guarding.
// Everything outside that component (and outside its ancestors) is hidden before the check, so
// the rules run on the real component in its real layout and styles.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const POLICY_PATH = 'ui-policy.json';

// Each entry: the route, the selector that proves the app has mounted, and an optional
// component scope for pages too large to check whole.
export const CORE_PAGES = [
	{ path: '/', ready: 'body' },
	{ path: '/gallery', ready: 'main' },
	{ path: '/create', ready: 'main' },
	{ path: '/forge', ready: 'main' },
	{ path: '/discover', ready: 'main' },
	{ path: '/docs', ready: 'main' },
	{ path: '/agents', ready: 'main' },
];

export const EXIT = { PASS: 0, FINDINGS: 1, ERROR: 2 };

// One page result -> its exit code.
export function pageExitCode(result) {
	if (result.error) return EXIT.ERROR;
	return result.findings.length ? EXIT.FINDINGS : EXIT.PASS;
}

// All page results -> the run's exit code. An error anywhere wins, then findings, then pass.
export function aggregateExitCode(results) {
	if (!results.length) return EXIT.ERROR;
	return results.reduce((worst, r) => Math.max(worst, pageExitCode(r)), EXIT.PASS);
}

// Every core page must be a real, listed static page, unique, with a ready selector.
export function validateCorePages(pages, pagesJson) {
	const listed = new Set(pagesJson.sections.flatMap((s) => (s.pages || []).map((p) => p.path)));
	const problems = [];
	const seen = new Set();
	for (const page of pages) {
		if (!page.path || !page.path.startsWith('/')) problems.push(`${page.path}: path must start with /`);
		if (seen.has(page.path)) problems.push(`${page.path}: listed twice`);
		seen.add(page.path);
		if (!listed.has(page.path)) problems.push(`${page.path}: not in data/pages.json`);
		if (typeof page.ready !== 'string' || !page.ready.trim()) problems.push(`${page.path}: needs a ready selector`);
		if (page.scope !== undefined && (typeof page.scope !== 'string' || !page.scope.trim()))
			problems.push(`${page.path}: scope must be a nonempty selector`);
	}
	return problems;
}

// Findings grouped by rule, most frequent first: "control-gap 3, text-contrast 1".
export function ruleCounts(findings) {
	const counts = new Map();
	for (const f of findings) counts.set(f.rule, (counts.get(f.rule) || 0) + 1);
	return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export function formatTable(results) {
	const status = (r) => (r.error ? 'ERROR' : r.findings.length ? 'FINDINGS' : 'PASS');
	const detail = (r) =>
		r.error
			? r.error
			: r.findings.length
				? ruleCounts(r.findings).map(([rule, n]) => `${rule} ${n}`).join(', ')
				: `${r.suppressed} suppressed by policy exceptions`;
	const rows = results.map((r) => [r.path + (r.scope ? ` (${r.scope})` : ''), status(r), String(r.findings.length), detail(r)]);
	const head = ['page', 'status', 'findings', 'detail'];
	const widths = head.map((h, i) => Math.max(h.length, ...rows.map((row) => (i < 3 ? row[i].length : 0))));
	const line = (cells) => cells.map((c, i) => (i < 3 ? c.padEnd(widths[i]) : c)).join('  ');
	return [line(head), line(widths.map((w) => '-'.repeat(w)).concat('------')), ...rows.map(line)].join('\n');
}

export function parseArgs(argv) {
	const opts = { base: 'http://localhost:3000', only: null, timeout: 120000, json: null };
	for (let i = 0; i < argv.length; i++) {
		const key = argv[i];
		const value = argv[i + 1];
		if (!['--base', '--only', '--timeout', '--json'].includes(key)) throw new Error(`Unknown option: ${key}`);
		if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
		i++;
		if (key === '--base') opts.base = value.replace(/\/$/, '');
		else if (key === '--only') opts.only = value.split(',').map((s) => s.trim()).filter(Boolean);
		else if (key === '--timeout') {
			opts.timeout = Number(value);
			if (!Number.isInteger(opts.timeout) || opts.timeout < 1000) throw new Error('--timeout must be an integer of at least 1000 ms');
		} else opts.json = value;
	}
	return opts;
}

// Runs in the page: hide every element that is neither the scope target, inside it, nor one of
// its ancestors, so lintapple sees only the component.
function isolateScope(scope) {
	const target = document.querySelector(scope);
	if (!target) throw new Error(`Scope selector matched nothing: ${scope}`);
	for (const el of document.querySelectorAll('body *')) {
		if (el === target || target.contains(el) || el.contains(target)) continue;
		if (el.closest('script, style, link, template')) continue;
		el.style.setProperty('display', 'none', 'important');
	}
}

async function checkScoped(lintapple, url, policy, page, timeout) {
	const { chromium } = await import('playwright');
	const approved = lintapple.validatePolicy(policy);
	const browser = await chromium.launch();
	const findings = [];
	let suppressed = 0;
	try {
		for (const viewport of approved.viewports)
			for (const colorScheme of approved.colorSchemes) {
				const context = await browser.newContext({ viewport, colorScheme, reducedMotion: 'reduce', locale: 'en-US', timezoneId: 'UTC', deviceScaleFactor: 1 });
				try {
					const tab = await context.newPage();
					tab.setDefaultTimeout(timeout);
					const response = await tab.goto(url, { waitUntil: 'load', timeout });
					if (response && !response.ok()) throw new Error(`Page returned HTTP ${response.status()} at ${response.url()}.`);
					await tab.locator(page.ready).first().waitFor({ state: 'visible' });
					await tab.evaluate(isolateScope, page.scope);
					const result = await lintapple.checkPage(tab, approved);
					findings.push(...result.findings.map((f) => ({ ...f, viewport, colorScheme })));
					suppressed += result.suppressed.length;
				} finally {
					await context.close();
				}
			}
	} finally {
		await browser.close();
	}
	return { findings, suppressed };
}

async function lintPage(lintapple, base, page, policy, timeout) {
	const url = base + page.path;
	const started = Date.now();
	try {
		let findings;
		let suppressed;
		if (page.scope) ({ findings, suppressed } = await checkScoped(lintapple, url, policy, page, timeout));
		else {
			const report = await lintapple.checkUrl(url, policy, { ready: page.ready, timeout });
			findings = report.findings;
			suppressed = report.runs.reduce((n, run) => n + run.suppressed.length, 0);
		}
		return { path: page.path, scope: page.scope, findings, suppressed, error: null, ms: Date.now() - started };
	} catch (error) {
		const message = String(error?.message || error).split('\n')[0].slice(0, 300);
		return { path: page.path, scope: page.scope, findings: [], suppressed: 0, error: message, ms: Date.now() - started };
	}
}

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	const problems = validateCorePages(CORE_PAGES, JSON.parse(readFileSync('data/pages.json', 'utf8')));
	if (problems.length) throw new Error(`Core page list is out of date:\n  ${problems.join('\n  ')}`);
	const pages = opts.only ? CORE_PAGES.filter((p) => opts.only.includes(p.path)) : CORE_PAGES;
	if (opts.only) {
		const unknown = opts.only.filter((p) => !CORE_PAGES.some((c) => c.path === p));
		if (unknown.length) throw new Error(`Not a core page: ${unknown.join(', ')}`);
	}
	const policy = JSON.parse(readFileSync(POLICY_PATH, 'utf8'));
	const lintapple = await import('lintapple');
	lintapple.validatePolicy(policy);

	const results = [];
	for (const page of pages) {
		process.stderr.write(`checking ${page.path}${page.scope ? ` (${page.scope})` : ''} ... `);
		const result = await lintPage(lintapple, opts.base, page, policy, opts.timeout);
		process.stderr.write(`${result.error ? 'error' : `${result.findings.length} findings`} in ${(result.ms / 1000).toFixed(1)}s\n`);
		results.push(result);
	}
	console.log(formatTable(results));
	if (opts.json) writeFileSync(opts.json, JSON.stringify({ base: opts.base, results }, null, 2));
	return aggregateExitCode(results);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	main().then(
		(code) => process.exit(code),
		(error) => {
			console.error(error.message);
			process.exit(EXIT.ERROR);
		},
	);
}

#!/usr/bin/env node
// WCAG 2.2 AA audit of the enterprise surfaces (docs/accessibility/acr.md).
//
// Runs axe-core (MPL-2.0, the engine behind Accessibility Insights for Web's
// automated checks) in a real Chromium on every audited page, in both themes,
// at desktop width and at 400px. Writes a JSON and a Markdown report and exits
// non-zero when any serious or critical violation remains, or when a page
// fails to load. Moderate and minor findings are reported but do not fail.
//
// The audited set:
//   - the 12 highest-priority public pages in data/pages.json (the same
//     ranking the sitemap emits; the repo keeps no page-view analytics),
//     with /forge counted in its own row below;
//   - /login, /microsoft/activate, /microsoft/teams-tab;
//   - the Forge main flow (/forge);
//   - a live agent page (/agents/:id) and its <agent-3d> embed
//     (/agent/:id/embed), with the id read from the live marketplace;
//   - the public accessibility statement (/accessibility), which must meet
//     the standard it describes.
//
// Usage:
//   npm run audit:a11y                       # against http://localhost:3112
//   npm run audit:a11y -- --base https://three.ws
//   npm run audit:a11y -- --only /login,/forge --no-write
//
// The broader 40-page dark-theme floor is tests/e2e/a11y-top-pages.spec.js
// (`npm run audit:a11y:floor`), which also runs under `npm test`.

import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { settleAndFreeze } from './lib/a11y-settle.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'docs', 'accessibility', 'reports');
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const FAILING = new Set(['serious', 'critical']);
const THEMES = ['dark', 'light'];
const VIEWPORTS = {
	desktop: { width: 1366, height: 900 },
	mobile: { width: 400, height: 860 },
};
const TOP_N = 12;

function parseArgs(argv) {
	const args = { base: process.env.A11Y_BASE || 'http://localhost:3112', only: null, write: true, concurrency: 3 };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--base') args.base = argv[++i];
		else if (a === '--only') args.only = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
		else if (a === '--no-write') args.write = false;
		else if (a === '--concurrency') args.concurrency = Math.max(1, Number(argv[++i]) || 1);
	}
	args.base = args.base.replace(/\/$/, '');
	return args;
}

export function topPriorityPaths(pagesData, n = TOP_N, exclude = []) {
	const skip = new Set(exclude);
	return pagesData.sections
		.flatMap((s) => s.pages)
		.filter((p) => !p.path.includes(':') && !skip.has(p.path))
		.map((p, i) => ({ path: p.path, priority: p.priority ?? 0.5, i }))
		.sort((a, b) => b.priority - a.priority || a.i - b.i)
		.slice(0, n)
		.map((p) => p.path);
}

async function liveAgentId(base) {
	const res = await fetch(`${base}/api/marketplace/agents?limit=10`, { headers: { accept: 'application/json' } });
	if (!res.ok) throw new Error(`marketplace agents returned HTTP ${res.status}`);
	const body = await res.json();
	const items = body?.data?.items || [];
	const withBody = items.find((a) => a.avatar_glb_url) || items[0];
	if (!withBody?.id) throw new Error('marketplace returned no agents to audit');
	return withBody.id;
}

export async function auditedSet(base) {
	const pagesData = JSON.parse(readFileSync(join(ROOT, 'data', 'pages.json'), 'utf8'));
	const top = topPriorityPaths(pagesData, TOP_N, ['/forge']);
	const agentId = await liveAgentId(base);
	return [
		...top.map((path) => ({ path, group: 'top-priority' })),
		{ path: '/login', group: 'enterprise' },
		{ path: '/microsoft/activate', group: 'enterprise' },
		{ path: '/microsoft/teams-tab', group: 'enterprise' },
		{ path: '/forge', group: 'forge' },
		{ path: `/agents/${agentId}`, group: 'agent' },
		{ path: `/agent/${agentId}/embed`, group: 'embed' },
		{ path: '/accessibility', group: 'statement' },
	];
}

async function auditOne(browser, base, target, theme, viewportName) {
	const context = await browser.newContext({
		viewport: VIEWPORTS[viewportName],
		colorScheme: theme,
		reducedMotion: 'reduce',
	});
	await context.addInitScript((t) => {
		try {
			localStorage.setItem('twx_theme', t);
		} catch {
			/* storage blocked: colorScheme emulation still applies */
		}
	}, theme);
	const page = await context.newPage();
	const started = Date.now();
	try {
		await page.goto(base + target.path, { waitUntil: 'domcontentloaded', timeout: 180_000 });
		await page.waitForLoadState('load', { timeout: 30_000 }).catch(() => undefined);
		await page.waitForTimeout(800);
		await settleAndFreeze(page);
		const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
		return {
			path: target.path,
			group: target.group,
			theme,
			viewport: viewportName,
			ms: Date.now() - started,
			passes: results.passes.length,
			incomplete: results.incomplete.length,
			violations: results.violations.map((v) => ({
				id: v.id,
				impact: v.impact,
				help: v.help,
				helpUrl: v.helpUrl,
				tags: v.tags.filter((t) => t.startsWith('wcag')),
				nodes: v.nodes.map((n) => ({ target: n.target.join(' '), summary: n.failureSummary })),
			})),
		};
	} catch (err) {
		return { path: target.path, group: target.group, theme, viewport: viewportName, ms: Date.now() - started, error: String(err.message || err) };
	} finally {
		await context.close();
	}
}

async function runPool(jobs, concurrency, worker) {
	const out = new Array(jobs.length);
	let next = 0;
	async function lane() {
		while (next < jobs.length) {
			const i = next++;
			out[i] = await worker(jobs[i]);
		}
	}
	await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, lane));
	return out;
}

function failingCount(r) {
	return (r.violations || []).filter((v) => FAILING.has(v.impact)).length;
}

function toMarkdown(report) {
	const lines = [
		'# Accessibility audit (axe-core)',
		'',
		`Generated ${report.generatedAt} against \`${report.base}\` by \`npm run audit:a11y\` (scripts/audit-a11y.mjs).`,
		`Engine: axe-core ${report.axeVersion}. Rule tags: ${report.tags.join(', ')}. Themes: dark, light. Viewports: 1366px desktop, 400px mobile. Reduced motion emulated.`,
		'',
		`Result: **${report.summary.failing === 0 && report.summary.errors === 0 ? 'PASS' : 'FAIL'}**. ${report.summary.runs} runs, ${report.summary.failing} serious or critical violations, ${report.summary.other} moderate or minor, ${report.summary.errors} load errors.`,
		'',
		'| Page | Group | dark desktop | dark 400px | light desktop | light 400px |',
		'| --- | --- | --- | --- | --- | --- |',
	];
	const byPath = new Map();
	for (const r of report.results) {
		if (!byPath.has(r.path)) byPath.set(r.path, { group: r.group, cells: {} });
		const cell = r.error ? 'load error' : r.violations.length === 0 ? 'clean' : `${failingCount(r)} serious+ / ${r.violations.length} total`;
		byPath.get(r.path).cells[`${r.theme}-${r.viewport}`] = cell;
	}
	for (const [path, { group, cells }] of byPath) {
		lines.push(`| \`${path}\` | ${group} | ${cells['dark-desktop'] || '-'} | ${cells['dark-mobile'] || '-'} | ${cells['light-desktop'] || '-'} | ${cells['light-mobile'] || '-'} |`);
	}
	const detail = report.results.filter((r) => r.error || r.violations.length);
	if (detail.length) {
		lines.push('', '## Findings', '');
		for (const r of detail) {
			lines.push(`### \`${r.path}\` (${r.theme}, ${r.viewport})`, '');
			if (r.error) lines.push(`- Load error: ${r.error}`);
			for (const v of r.violations || []) {
				lines.push(`- [${v.impact}] \`${v.id}\`: ${v.help} (${v.nodes.length} node(s))`);
				for (const n of v.nodes.slice(0, 5)) lines.push(`  - \`${n.target}\``);
			}
			lines.push('');
		}
	}
	return lines.join('\n') + '\n';
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	let targets = await auditedSet(args.base);
	if (args.only) {
		const only = new Set(args.only);
		targets = targets.filter((t) => only.has(t.path) || only.has(t.group));
		for (const p of args.only) if (p.startsWith('/') && !targets.some((t) => t.path === p)) targets.push({ path: p, group: 'ad-hoc' });
	}
	const jobs = targets.flatMap((t) => THEMES.flatMap((theme) => Object.keys(VIEWPORTS).map((vp) => ({ t, theme, vp }))));
	console.log(`auditing ${targets.length} pages x ${THEMES.length} themes x ${Object.keys(VIEWPORTS).length} viewports = ${jobs.length} runs against ${args.base}`);

	const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
	let results;
	try {
		results = await runPool(jobs, args.concurrency, async ({ t, theme, vp }) => {
			const r = await auditOne(browser, args.base, t, theme, vp);
			const tag = r.error ? `ERROR ${r.error.split('\n')[0]}` : `${failingCount(r)} serious+ / ${r.violations.length} total`;
			console.log(`  ${r.path} [${theme} ${vp}] ${tag} (${(r.ms / 1000).toFixed(1)}s)`);
			return r;
		});
	} finally {
		await browser.close();
	}

	const axeVersion = JSON.parse(readFileSync(join(ROOT, 'node_modules', 'axe-core', 'package.json'), 'utf8')).version;
	const summary = {
		runs: results.length,
		failing: results.reduce((n, r) => n + failingCount(r), 0),
		other: results.reduce((n, r) => n + (r.violations || []).filter((v) => !FAILING.has(v.impact)).length, 0),
		errors: results.filter((r) => r.error).length,
	};
	const report = { generatedAt: new Date().toISOString(), base: args.base, axeVersion, tags: TAGS, summary, results };

	if (args.write) {
		mkdirSync(OUT_DIR, { recursive: true });
		writeFileSync(join(OUT_DIR, 'axe-latest.json'), JSON.stringify(report, null, '\t') + '\n');
		writeFileSync(join(OUT_DIR, 'axe-latest.md'), toMarkdown(report));
		console.log(`wrote docs/accessibility/reports/axe-latest.{json,md}`);
	}
	console.log(`summary: ${summary.runs} runs, ${summary.failing} serious/critical, ${summary.other} moderate/minor, ${summary.errors} load errors`);
	process.exitCode = summary.failing === 0 && summary.errors === 0 ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}

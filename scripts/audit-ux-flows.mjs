#!/usr/bin/env node
/**
 * Drift check for the UX Flow Atlas (docs/ux-flows/NN-*.md).
 *
 *   (a) Stale routes: a route cited in a flow heading or routing table that
 *       resolves nowhere (not in data/pages.json, not matched by a vercel.json
 *       route, not a static file). Exits 1.
 *   (b) Coverage: user-facing pages in data/pages.json that no flow cites,
 *       ranked by how prominent they are in public/atlas-index.json. Reported,
 *       and ratcheted against scripts/audit-ux-flows.baseline.json so coverage
 *       can only grow. Exits 1 if a previously covered page loses coverage.
 *   (c) Cited source files that do not exist. Exits 1 for any cluster file in
 *       the baseline's `strictFileClusters`; the older clusters are ratcheted
 *       (the missing count may only shrink).
 *
 *   node scripts/audit-ux-flows.mjs                 check, print a summary
 *   node scripts/audit-ux-flows.mjs --top 30        list the top 30 uncovered pages
 *   node scripts/audit-ux-flows.mjs --update-baseline   write the baseline (coverage grew)
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FLOWS_DIR = 'docs/ux-flows';
const BASELINE_PATH = 'scripts/audit-ux-flows.baseline.json';
const FILE_ROOTS = /^(pages|src|api|public|scripts|docs|packages|workers|server|sdk|specs|data|tests|lib|robinhood|solana-agent-sdk|agent-payments-sdk)\//;
const ASSET_EXT = /\.(js|mjs|css|json|html|png|svg|jpg|webp|glb|txt|xml|ico|woff2?|wasm|md)$/i;

/** Routes cited in headings and in the first cell of routing-table rows. */
export function extractRoutes(markdown) {
	const routes = new Set();
	const take = (text) => {
		for (const m of text.matchAll(/`(\/[^`\s]*)`/g)) {
			const route = normalizeRoute(m[1]);
			if (route) routes.add(route);
		}
	};
	for (const line of markdown.split('\n')) {
		if (/^#{1,4}\s/.test(line)) take(line);
		else if (/^\|\s*`\//.test(line)) take(line.split('|')[1] || '');
	}
	return [...routes];
}

/** Every backticked route anywhere in the text: counts as coverage, never as a stale citation. */
export function extractMentionedRoutes(markdown) {
	const routes = new Set();
	for (const m of markdown.matchAll(/`(\/[^`\s]*)`/g)) {
		const route = normalizeRoute(m[1]);
		if (route) routes.add(route);
	}
	return [...routes];
}

/** Strip query, hash and trailing slash. Returns null for non-page tokens. */
export function normalizeRoute(raw) {
	let route = raw.split('?')[0].split('#')[0];
	if (route.length > 1) route = route.replace(/\/+$/, '');
	if (!route.startsWith('/') || route.startsWith('/api/') || route === '/api') return null;
	if (ASSET_EXT.test(route) && !route.endsWith('.html')) return null;
	return route;
}

/** Repo file paths cited in backticks, with the line they sit on. */
export function extractFileCitations(markdown) {
	const files = new Set();
	for (const m of markdown.matchAll(/`([^`\n]+)`/g)) {
		const token = m[1].trim();
		if (!FILE_ROOTS.test(token) || /[*<>…\s(){}]/.test(token.replace(/\[[^\]]+\]/g, ''))) continue;
		const clean = token.replace(/[.,:;]+$/, '');
		if (!ASSET_EXT.test(clean) && !clean.endsWith('/')) continue;
		files.add(clean);
	}
	return [...files];
}

const PLACEHOLDER_FILLERS = [
	'sample1',
	'3f2b8c1e-5a4d-4e7b-9c1a-0d2e6f8a1b3c',
	'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump',
];

/** Compile the pre-filesystem route table into matchers. */
export function compileRouteTable(vercel) {
	const matchers = [];
	for (const r of vercel.routes || []) {
		if (!r.src || r.continue) continue;
		// Catch-alls resolve every path, so they would hide a dead route.
		if (/^\/\$1$|\/404\.html$/.test(String(r.dest || ''))) continue;
		try {
			matchers.push(new RegExp(`^${r.src}$`));
		} catch {
			continue;
		}
	}
	return matchers;
}

export function routeResolves(route, { pagePaths, matchers, fileExists }) {
	if (pagePaths.has(route)) return true;
	const key = route === '/' ? '/index' : route;
	for (const candidate of [`pages${key}.html`, `public${key}.html`, `public${key}/index.html`, `pages${key}/index.html`]) {
		if (fileExists(candidate)) return true;
	}
	if (route.endsWith('.html') && route !== '/index.html') {
		return routeResolves(route.slice(0, -5), { pagePaths, matchers, fileExists });
	}
	// A placeholder segment (:id, <handle>) must satisfy the route's own pattern,
	// whose character class may demand a UUID or a base58 mint, so try each shape.
	for (const filler of PLACEHOLDER_FILLERS) {
		const probe = route.replace(/<[^>]+>|:[A-Za-z_]+/g, filler);
		if (matchers.some((re) => re.test(probe) || re.test(`${probe}/`))) return true;
	}
	return false;
}

export function collectPagePaths(pagesJson) {
	const paths = new Set();
	(function walk(node) {
		if (Array.isArray(node)) node.forEach(walk);
		else if (node && typeof node === 'object') {
			if (typeof node.path === 'string') paths.add(node.path);
			Object.values(node).forEach(walk);
		}
	})(pagesJson);
	return paths;
}

/**
 * Pages worth tracing: static, user-facing, ranked by the prominence weight
 * public/atlas-index.json gives each page (tuple index 4, 0..1). Pages the
 * atlas leaves out are not user-facing entry points and rank last.
 */
export function rankUncovered(pagePaths, cited, atlas) {
	const weight = new Map();
	for (const tuple of atlas?.pages || []) {
		if (Array.isArray(tuple) && typeof tuple[0] === 'string') weight.set(tuple[0], Number(tuple[4]) || 0);
	}
	return [...pagePaths]
		.filter((p) => p.startsWith('/') && !cited.has(p) && !/[:*<\[]/.test(p) && !p.startsWith('/api/'))
		.map((p) => ({ path: p, weight: weight.get(p) ?? 0 }))
		.sort((x, y) => y.weight - x.weight || x.path.localeCompare(y.path));
}

/** Ratchet: coverage may only grow, and missing cited files may only shrink. */
export function checkRatchet(baseline, covered, missingByFile) {
	const problems = [];
	for (const p of baseline.covered || []) {
		if (!covered.has(p)) problems.push(`coverage regressed: ${p} was cited by a flow and is not any more`);
	}
	const strict = new Set(baseline.strictFileClusters || []);
	for (const [file, missing] of Object.entries(missingByFile)) {
		const allowed = baseline.missingFiles?.[file] ?? 0;
		if (strict.has(file) && missing.length) problems.push(`${file} cites ${missing.length} missing file(s): ${missing.join(', ')}`);
		else if (missing.length > allowed) problems.push(`${file} cites ${missing.length} missing file(s), baseline allows ${allowed}: ${missing.join(', ')}`);
	}
	return problems;
}

export function auditUxFlows({ root = ROOT } = {}) {
	const read = (p) => readFileSync(resolve(root, p), 'utf8');
	const fileExists = (p) => existsSync(resolve(root, p));
	const pagePaths = collectPagePaths(JSON.parse(read('data/pages.json')));
	const matchers = compileRouteTable(JSON.parse(read('vercel.json')));
	const atlas = fileExists('public/atlas-index.json') ? JSON.parse(read('public/atlas-index.json')) : {};
	const files = readdirSync(resolve(root, FLOWS_DIR)).filter((f) => /^\d+.*\.md$/.test(f)).sort();

	const cited = new Set();
	const mentioned = new Set();
	const stale = [];
	const missingByFile = {};
	let fileCitations = 0;
	for (const file of files) {
		const md = read(`${FLOWS_DIR}/${file}`);
		for (const route of extractMentionedRoutes(md)) mentioned.add(route);
		for (const route of extractRoutes(md)) {
			cited.add(route);
			if (!routeResolves(route, { pagePaths, matchers, fileExists })) stale.push({ file, route });
		}
		const missing = [];
		for (const f of extractFileCitations(md)) {
			fileCitations++;
			if (!fileExists(f.replace(/\/$/, ''))) missing.push(f);
		}
		missingByFile[file] = missing;
	}
	const covered = new Set([...mentioned].filter((r) => pagePaths.has(r)));
	const uncovered = rankUncovered(pagePaths, mentioned, atlas);
	return { files, pagePaths, cited, covered, stale, uncovered, missingByFile, fileCitations };
}

function main() {
	const args = process.argv.slice(2);
	const topIdx = args.indexOf('--top');
	const top = topIdx >= 0 ? Number(args[topIdx + 1]) || 20 : 10;
	const result = auditUxFlows();
	const baselineFile = resolve(ROOT, BASELINE_PATH);
	const baseline = existsSync(baselineFile) ? JSON.parse(readFileSync(baselineFile, 'utf8')) : null;

	if (args.includes('--update-baseline')) {
		const missingFiles = {};
		for (const [f, m] of Object.entries(result.missingByFile)) if (m.length && !(baseline?.strictFileClusters || []).includes(f)) missingFiles[f] = m.length;
		const next = {
			note: 'Ratchet for scripts/audit-ux-flows.mjs. Coverage may only grow; missing cited files may only shrink.',
			strictFileClusters: baseline?.strictFileClusters || [],
			missingFiles,
			covered: [...result.covered].sort(),
		};
		writeFileSync(baselineFile, `${JSON.stringify(next, null, '\t')}\n`);
		console.log(`baseline written: ${next.covered.length} covered pages`);
		return;
	}

	console.log(`ux-flows: ${result.files.length} cluster files, ${result.cited.size} routes cited, ${result.covered.size} of ${result.pagePaths.size} indexed pages covered, ${result.fileCitations} source files cited`);
	let failed = false;
	if (result.stale.length) {
		failed = true;
		console.error(`\nStale routes (${result.stale.length}):`);
		for (const s of result.stale) console.error(`  ${s.file}: ${s.route}`);
	}
	if (!baseline) {
		failed = true;
		console.error(`\n${BASELINE_PATH} is missing. Run with --update-baseline.`);
	} else {
		const problems = checkRatchet(baseline, result.covered, result.missingByFile);
		if (problems.length) {
			failed = true;
			console.error('\nRatchet failures:');
			for (const p of problems) console.error(`  ${p}`);
		}
	}
	console.log(`\nTop ${top} uncovered pages (by atlas prominence):`);
	for (const u of result.uncovered.slice(0, top)) console.log(`  ${u.weight.toFixed(2)}  ${u.path}`);
	process.exit(failed ? 1 : 0);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

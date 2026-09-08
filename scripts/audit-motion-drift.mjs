#!/usr/bin/env node
/**
 * Motion-drift ratchet (QB-07): one duration ladder, one easing set.
 *
 * public/tokens.css names four durations (--duration-instant/fast/base/slow)
 * and three easings (--ease-standard/emphasized/out), and collapses the
 * durations to 0ms under prefers-reduced-motion. None of that reaches a
 * transition that spells its timing as a literal. A sweep of every stylesheet
 * under src/ and public/ found the platform saying the same thing 41 different
 * ways: 150ms, 140ms, 120ms, 200ms, 180ms, 160ms and 130ms all mean "a control
 * responding", and `ease` appears thousands of times where a named easing
 * belongs. The values are close enough that nobody notices one transition; what
 * they notice is that the site does not feel like one product.
 *
 * This counts literal times and literal easings inside `transition` and
 * `transition-duration` / `transition-timing-function` declarations, in every
 * stylesheet under src/ and public/ AND in the <style> blocks of HTML pages
 * that load the token vocabulary. That last half is where most of the drift
 * lived: 400 pages style themselves inline, and leaving them out measured a
 * third of the problem. A page that does NOT load the vocabulary is out of
 * scope on purpose, because var(--duration-fast) there resolves to nothing and
 * drops the whole declaration, which is worse than the literal.
 *
 * It does NOT touch @keyframes or `animation`, whose durations are usually
 * intrinsic to the effect (a 2s shimmer loop is not a control response), and it
 * ignores vendored third-party CSS.
 *
 * The count may only go DOWN. Migrate a value to the nearest rung of the
 * ladder rather than adding a token for it: the point of a ladder is that the
 * rungs are few.
 *
 *   0 to 110ms  -> var(--duration-instant)   state flips
 *   111 to 180  -> var(--duration-fast)      controls
 *   181 to 300  -> var(--duration-base)      panels, dropdowns, cards
 *   over 300    -> var(--duration-slow)      reveals
 *   ease        -> var(--ease-standard)
 *
 * Usage:
 *   node scripts/audit-motion-drift.mjs           # exit 1 if drift increased
 *   node scripts/audit-motion-drift.mjs --list    # per-file counts
 *   node scripts/audit-motion-drift.mjs --update  # rewrite the baseline
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = join(ROOT, 'scripts', 'audit-motion-drift.baseline.json');
const SKIP_DIRS = new Set(['node_modules', 'vendor', 'assets', 'libs', 'dist']);

function collectStylesheets(dir) {
	const out = [];
	for (const entry of readdirSync(dir)) {
		const p = join(dir, entry);
		if (statSync(p).isDirectory()) {
			if (SKIP_DIRS.has(entry)) continue;
			out.push(...collectStylesheets(p));
		} else if (entry.endsWith('.css')) {
			out.push(p);
		}
	}
	return out;
}

const TRANSITION_DECL = /transition(?:-duration|-timing-function)?\s*:\s*([^;{}]+)/g;
const LITERAL_TIME = /(?<![\w-])\d*\.?\d+m?s(?![\w-])/g;
// The lookarounds are load-bearing: a bare \b matches `ease` inside
// `var(--ease-standard)`, which would count every already-tokenised
// transition as drift (and, in a rewrite, corrupt it).
const LITERAL_EASE =
	/(?<![\w-])(?:ease-in-out|ease-out|ease-in|linear|ease)(?![\w-])|cubic-bezier\([^)]*\)/g;

/** Count the literals a sheet still spells out instead of naming. */
function countDrift(css) {
	const body = css.replace(/\/\*[\s\S]*?\*\//g, '');
	let n = 0;
	for (const m of body.matchAll(TRANSITION_DECL)) {
		const value = m[1];
		n += (value.match(LITERAL_TIME) || []).length;
		n += (value.match(LITERAL_EASE) || []).length;
	}
	return n;
}

function collectPages(dir) {
	const out = [];
	for (const entry of readdirSync(dir)) {
		const p = join(dir, entry);
		if (statSync(p).isDirectory()) {
			if (SKIP_DIRS.has(entry)) continue;
			out.push(...collectPages(p));
		} else if (entry.endsWith('.html')) {
			out.push(p);
		}
	}
	return out;
}

const STYLE_BLOCK = /<style[^>]*>([\s\S]*?)<\/style>/gi;

/** A page is in scope only if var(--duration-*) actually resolves on it, either
 * from a linked token-carrying sheet or from a local definition. */
function resolvesVocabulary(html, css) {
	return (
		/href=["'][^"']*\/(tokens|style|nav)\.css/.test(html) ||
		/--duration-fast\s*:/.test(css) ||
		/@import[^;]*tokens\.css/.test(css)
	);
}

function audit() {
	const perFile = {};
	let total = 0;
	for (const page of [
		...collectPages(join(ROOT, 'pages')),
		...collectPages(join(ROOT, 'public')),
	]) {
		const html = readFileSync(page, 'utf8');
		let css = '';
		for (const m of html.matchAll(STYLE_BLOCK)) css += m[1];
		if (!css || !resolvesVocabulary(html, css)) continue;
		const n = countDrift(css);
		if (n > 0) {
			perFile[relative(ROOT, page)] = n;
			total += n;
		}
	}
	for (const sheet of [
		...collectStylesheets(join(ROOT, 'src')),
		...collectStylesheets(join(ROOT, 'public')),
	]) {
		// The token sheet is the source of truth. Its one literal is the 1ms
		// collapse inside the prefers-reduced-motion floor, which cannot be a
		// token without pointing a token at itself.
		if (relative(ROOT, sheet) === 'public/tokens.css') continue;
		const n = countDrift(readFileSync(sheet, 'utf8'));
		if (n > 0) {
			perFile[relative(ROOT, sheet)] = n;
			total += n;
		}
	}
	return { total, perFile };
}

const { total, perFile } = audit();

if (process.argv.includes('--list')) {
	for (const [file, n] of Object.entries(perFile).sort((a, b) => b[1] - a[1])) {
		console.log(`${String(n).padStart(5)}  ${file}`);
	}
	console.log(`\n${total} literal duration(s)/easing(s) in transition declarations.`);
	process.exit(0);
}

if (process.argv.includes('--update')) {
	writeFileSync(BASELINE_PATH, JSON.stringify({ total, perFile }, null, '\t') + '\n');
	console.log(`✓ motion-drift baseline updated: ${total} literal(s).`);
	process.exit(0);
}

let baseline;
try {
	baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
} catch {
	console.error('✗ missing baseline (run: node scripts/audit-motion-drift.mjs --update)');
	process.exit(1);
}

if (total > baseline.total) {
	console.error(`\n✗ motion drift increased: ${total} literal(s) in transitions (baseline ${baseline.total}).\n`);
	for (const [file, n] of Object.entries(perFile)) {
		const was = baseline.perFile[file] || 0;
		if (n > was) console.error(`  ${file}: ${n} (was ${was})`);
	}
	console.error(
		'\nName the timing instead of spelling it:\n' +
			'  transition: background var(--duration-fast) var(--ease-standard);\n' +
			'Ladder: <=110ms instant, <=180ms fast, <=300ms base, else slow.\n' +
			'A literal duration also escapes the prefers-reduced-motion zeroing in\n' +
			'public/tokens.css. See DESIGN-TOKENS.md.\n',
	);
	process.exit(1);
}

if (total < baseline.total) {
	console.log(
		`✓ motion drift: ${total} (baseline ${baseline.total}), improved. Lock it in with:\n` +
			'  node scripts/audit-motion-drift.mjs --update',
	);
} else {
	console.log(`✓ motion drift unchanged: ${total} literal(s) in transition declarations.`);
}

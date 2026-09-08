#!/usr/bin/env node
/**
 * Interactive-state ratchet (QB-07): every clickable thing must answer the pointer.
 *
 * B14 gave the platform a focus floor and a disabled floor in public/tokens.css,
 * so a keyboard user now sees a ring on every control and a disabled control
 * always reads as disabled. Hover is the state those floors cannot cover: what
 * "hovered" looks like is component-specific (a card lifts, a button tints, a
 * tab brightens its underline), and a blanket rule would stack on top of every
 * component that already styles its own hover instead of filling the gap.
 *
 * So it is audited instead. A selector that declares `cursor: pointer` is
 * telling the user "this is clickable"; if the same stylesheet never defines a
 * :hover rule for it, that promise has no feedback behind it. The pointer
 * changes shape and nothing else happens, which reads as a dead control.
 *
 * What counts as covered: any rule in the same file whose selector is this
 * selector followed by :hover, or that contains it with a :hover on an ancestor
 * (`.card:hover .thumb`). Selectors already carrying a state pseudo-class are
 * not themselves audited, and neither is anything inside @media (hover: none),
 * where a hover state is meaningless.
 *
 * The count may only go DOWN, same contract as the token-drift ratchet: the
 * baseline lives in audit-interactive-states.baseline.json and a run that
 * exceeds it fails and names the file plus the exact selectors that regressed.
 *
 * Usage:
 *   node scripts/audit-interactive-states.mjs            # exit 1 if it increased
 *   node scripts/audit-interactive-states.mjs --list     # print every gap
 *   node scripts/audit-interactive-states.mjs --update   # rewrite the baseline
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = join(ROOT, 'scripts', 'audit-interactive-states.baseline.json');

/** Every stylesheet we author, minus build output and vendored third-party CSS
 * (public/scene-studio/libs holds CodeMirror; its hover model is not ours to
 * change and editing it would be overwritten by the next version bump). */
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

/** Drop comments, and drop @media blocks where hover cannot happen. */
function normalize(css) {
	const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
	// Remove `@media (hover: none) …{ … }` including its nested rules. Brace
	// counting, because the block contains rules with their own braces.
	let out = '';
	let i = 0;
	while (i < noComments.length) {
		const at = noComments.indexOf('@media', i);
		if (at === -1) {
			out += noComments.slice(i);
			break;
		}
		const open = noComments.indexOf('{', at);
		if (open === -1) {
			out += noComments.slice(i);
			break;
		}
		const query = noComments.slice(at, open);
		if (!/hover\s*:\s*none/.test(query)) {
			out += noComments.slice(i, open + 1);
			i = open + 1;
			continue;
		}
		out += noComments.slice(i, at);
		let depth = 1;
		let j = open + 1;
		while (j < noComments.length && depth > 0) {
			if (noComments[j] === '{') depth++;
			else if (noComments[j] === '}') depth--;
			j++;
		}
		i = j;
	}
	return out;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function gapsIn(css) {
	const sheet = normalize(css);
	const rules = [...sheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
	const gaps = new Set();
	for (const [, selectorList, body] of rules) {
		if (!/cursor:\s*pointer/.test(body)) continue;
		// An invisible hit target (the transparent <input type=file> stretched
		// over a drop zone, a bare click-catcher) has nothing to restyle; the
		// visible element under it owns the feedback.
		if (/opacity:\s*0\s*(;|$)/.test(body)) continue;
		for (const selector of selectorList.split(',').map((s) => s.trim()).filter(Boolean)) {
			if (!selector || selector.startsWith('@')) continue;
			// A selector that already names a state is not the thing being audited.
			if (/:hover|:focus|:active|:checked/.test(selector)) continue;
			const escaped = escapeRe(selector);
			// Three ways a hover rule can cover this selector:
			//   .x:hover                       is the direct rule
			//   .x .y:hover / .x:hover .y      is a :hover elsewhere in the compound
			//   button.tag-pill:hover  for  .pills .tag-pill  is the same element
			//     reached through a differently-spelled selector, so the LAST
			//     compound carrying a hover counts. Without this the audit files
			//     a finding against a control that visibly does respond.
			const lastCompound = selector.split(/[\s>+~]+/).filter(Boolean).pop() || selector;
			// `:hover` can sit on either side of the selector in a covering rule:
			// `.x:hover .y` (ancestor) and `.x .y:hover` (self) both style it.
			const inSameSelector = new RegExp(
				`(?:${escaped}[^{},]*:hover|:hover[^{},]*${escaped})`,
			);
			const covered =
				new RegExp(`${escaped}:hover`).test(sheet) ||
				inSameSelector.test(sheet) ||
				(lastCompound !== selector &&
					// Only when the compound is specific enough to name one
					// component. A bare `button` or `summary` tail would match
					// any `button:hover` in the file and hide every real gap.
					/[.#[]/.test(lastCompound) &&
					new RegExp(`${escapeRe(lastCompound)}(?=[^{},]*:hover)`).test(sheet));
			if (covered) continue;
			gaps.add(selector);
		}
	}
	return [...gaps];
}

function audit() {
	const perFile = {};
	let total = 0;
	for (const sheet of [
		...collectStylesheets(join(ROOT, 'src')),
		...collectStylesheets(join(ROOT, 'public')),
	]) {
		const gaps = gapsIn(readFileSync(sheet, 'utf8'));
		if (gaps.length) {
			perFile[relative(ROOT, sheet)] = gaps.sort();
			total += gaps.length;
		}
	}
	return { total, perFile };
}

const { total, perFile } = audit();

if (process.argv.includes('--list')) {
	for (const [file, gaps] of Object.entries(perFile).sort((a, b) => b[1].length - a[1].length)) {
		console.log(`${file} (${gaps.length})`);
		for (const g of gaps) console.log(`    ${g}`);
	}
	console.log(`\n${total} clickable selector(s) with no hover rule.`);
	process.exit(0);
}

if (process.argv.includes('--update')) {
	const counts = Object.fromEntries(
		Object.entries(perFile).map(([file, gaps]) => [file, gaps.length]),
	);
	writeFileSync(BASELINE_PATH, JSON.stringify({ total, perFile: counts }, null, '\t') + '\n');
	console.log(`✓ interactive-state baseline updated: ${total} clickable selector(s) with no hover rule.`);
	process.exit(0);
}

let baseline;
try {
	baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
} catch {
	console.error('✗ missing baseline (run: node scripts/audit-interactive-states.mjs --update)');
	process.exit(1);
}

if (total > baseline.total) {
	console.error(
		`\n✗ interactive-state gaps increased: ${total} clickable selector(s) with no hover rule (baseline ${baseline.total}).\n`,
	);
	for (const [file, gaps] of Object.entries(perFile)) {
		const was = baseline.perFile[file] || 0;
		if (gaps.length > was) {
			console.error(`  ${file}: ${gaps.length} (was ${was})`);
			for (const g of gaps) console.error(`      ${g}`);
		}
	}
	console.error(
		'\nA selector that sets cursor: pointer promises the element is clickable.\n' +
			'Give it a :hover rule built from tokens, e.g.\n' +
			'  .thing:hover { background: var(--surface-3); border-color: var(--stroke-strong); }\n' +
			'Focus and disabled are already covered platform-wide by the floors in\n' +
			'public/tokens.css (see DESIGN-TOKENS.md); hover is the one you must author.\n',
	);
	process.exit(1);
}

if (total < baseline.total) {
	console.log(
		`✓ interactive-state gaps: ${total} (baseline ${baseline.total}), improved. Lock it in with:\n` +
			'  node scripts/audit-interactive-states.mjs --update',
	);
} else {
	console.log(`✓ interactive-state gaps unchanged: ${total} clickable selector(s) with no hover rule.`);
}

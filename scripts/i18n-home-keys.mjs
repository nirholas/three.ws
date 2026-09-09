#!/usr/bin/env node
/**
 * Every JS-built string in the connected-home lane, as catalog keys.
 *
 * The HTML extractor (scripts/i18n-extract.mjs) reads `data-i18n` annotations,
 * which covers the lane's page shells and misses the house: the rooms, the
 * devices, the refusals, the confirmation and every spoken announcement are
 * assembled in JS from live data and carry no markup to annotate. Those call
 * the bridge in src/home/i18n-home.js:
 *
 *   t('home_scene.cancelled', 'Cancelled. Nothing moved.')
 *   plural('home_scene.desc_devices', n, '{{count}} device.', '{{count}} devices.')
 *
 * and the English argument IS the source value, exactly as the element's own
 * text is for an annotated tag. This script reads those call sites and reports
 * (or, with --write, applies) the difference against public/locales/en.json, so
 * the catalog cannot drift from the code and a new string cannot be shipped
 * without a key. i18n-extract preserves catalog-only keys, so a later extract
 * run leaves everything this writes in place.
 *
 *   node scripts/i18n-home-keys.mjs           # report drift, exit 1 if any
 *   node scripts/i18n-home-keys.mjs --write   # add and update keys in en.json
 *
 * USER DATA IS NEVER A KEY. A room name, an area name, a scene name or a device
 * name is the user's own word and is passed through `{{vars}}`, which the
 * translator's masker already protects byte for byte. A source string with a
 * name baked into it would be machine-translated on the next run, so this
 * script refuses any source value that interpolates a template expression.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { glob } from 'glob';
import { ROOT, readJSON, setDeep, flatten } from './lib/i18n-shared.mjs';
import { extractFromHtml } from './i18n-extract.mjs';

const SOURCES = ['src/home/*.js', 'src/voice/home-voice-ui.js'];
const CATALOG = 'public/locales/en.json';

/**
 * Markup built inside a JS template literal, annotated the ordinary way.
 *
 * A panel that assembles its own HTML (src/voice/home-voice-ui.js does) can
 * carry `data-i18n` on its elements exactly like a page does, and the runtime's
 * MutationObserver swaps the subtree when it mounts. What it cannot do is be
 * seen by scripts/i18n-extract.mjs, which globs `pages/**` and `public/**` HTML
 * FILES. Running that same extractor over the template literals in these
 * modules closes the gap with the tested parser rather than a second one.
 */
function extractFromTemplates(code) {
	const found = new Map();
	for (const literal of templateLiterals(code)) {
		if (!literal.includes('data-i18n')) continue;
		for (const [key, value] of extractFromHtml(literal)) found.set(key, value);
	}
	return found;
}

/** Every backtick template literal in the source, contents only. */
function templateLiterals(code) {
	const out = [];
	let i = 0;
	while (i < code.length) {
		const start = code.indexOf('`', i);
		if (start === -1) break;
		let j = start + 1;
		while (j < code.length) {
			if (code[j] === '\\') { j += 2; continue; }
			if (code[j] === '`') break;
			j++;
		}
		if (j >= code.length) break;
		out.push(code.slice(start + 1, j));
		i = j + 1;
	}
	return out;
}

/**
 * Strip comments and then read the `t()` / `plural()` call sites.
 *
 * Comments come out first because the doc block above every one of these
 * modules quotes example calls, and a scanner that could not tell a quotation
 * from a call would put the examples in the catalog.
 */
export function extractHomeKeys(code) {
	const stripped = stripComments(code);
	const found = new Map();
	const str = String.raw`'((?:[^'\\]|\\.)*)'`;
	// t('key', 'source'. A computed key or a template-literal source is skipped
	// on purpose: neither is knowable without running the program.
	for (const m of stripped.matchAll(new RegExp(String.raw`\bt\(\s*${str}\s*,\s*${str}`, 'g'))) {
		found.set(unescape(m[1]), unescape(m[2]));
	}
	// plural('key', <count>, 'one', 'other'
	for (const m of stripped.matchAll(
		new RegExp(String.raw`\bplural\(\s*${str}\s*,[^,]+,\s*${str}\s*,\s*${str}`, 'g'),
	)) {
		found.set(`${unescape(m[1])}.one`, unescape(m[2]));
		found.set(`${unescape(m[1])}.other`, unescape(m[3]));
	}
	return found;
}

function unescape(value) {
	return value.replace(/\\(['\\ntr])/g, (m, c) => ({ n: '\n', t: '\t', r: '\r' })[c] ?? c);
}

/** Remove /* *\/ and // comments without touching the contents of strings. */
function stripComments(code) {
	let out = '';
	let i = 0;
	let quote = null;
	while (i < code.length) {
		const c = code[i];
		const next = code[i + 1];
		if (quote) {
			out += c;
			if (c === '\\') {
				out += next ?? '';
				i += 2;
				continue;
			}
			if (c === quote) quote = null;
			i++;
			continue;
		}
		if (c === "'" || c === '"' || c === '`') {
			quote = c;
			out += c;
			i++;
			continue;
		}
		if (c === '/' && next === '*') {
			const end = code.indexOf('*/', i + 2);
			i = end === -1 ? code.length : end + 2;
			out += ' ';
			continue;
		}
		if (c === '/' && next === '/') {
			const end = code.indexOf('\n', i);
			i = end === -1 ? code.length : end;
			out += ' ';
			continue;
		}
		out += c;
		i++;
	}
	return out;
}

async function main() {
	const write = process.argv.includes('--write');
	const files = (await glob(SOURCES, { cwd: ROOT, absolute: true, nodir: true })).sort();
	const wanted = new Map();
	const sources = new Map();
	const problems = [];

	for (const file of files) {
		const where = relative(ROOT, file);
		const code = readFileSync(file, 'utf8');
		const pairs = new Map([...extractHomeKeys(code), ...extractFromTemplates(stripComments(code))]);
		for (const [key, value] of pairs) {
			if (/\$\{/.test(value)) {
				problems.push(`${where}: ${key} interpolates into its source string; pass the value through {{vars}} instead`);
				continue;
			}
			const prior = wanted.get(key);
			if (prior !== undefined && prior !== value) {
				problems.push(`${key}: "${prior}" (${sources.get(key)}) vs "${value}" (${where})`);
				continue;
			}
			wanted.set(key, value);
			sources.set(key, where);
		}
	}

	const path = resolve(ROOT, CATALOG);
	const catalog = readJSON(path, {}) || {};
	const flat = flatten(catalog);
	const missing = [];
	const drifted = [];
	for (const [key, value] of wanted) {
		const have = flat[key];
		if (have === undefined) missing.push(key);
		else if (have !== value) drifted.push(`${key}: catalog "${have}" vs source "${value}"`);
	}

	if (problems.length) {
		console.error(`\n✗ ${problems.length} problem(s) in the home lane's call sites:`);
		for (const p of problems) console.error('  ' + p);
	}

	if (write) {
		for (const [key, value] of wanted) setDeep(catalog, key, value);
		writeFileSync(path, JSON.stringify(deepSort(catalog), null, '\t') + '\n');
		console.log(`i18n-home-keys: ${wanted.size} key(s) from ${files.length} file(s) written into ${CATALOG} (${missing.length} new, ${drifted.length} updated)`);
	} else {
		console.log(`i18n-home-keys: ${wanted.size} key(s) across ${files.length} file(s); ${missing.length} missing, ${drifted.length} drifted`);
		for (const key of missing) console.log(`  missing: ${key} = ${JSON.stringify(wanted.get(key))}`);
		for (const line of drifted) console.log('  drift:   ' + line);
	}

	if (problems.length || (!write && (missing.length || drifted.length))) process.exitCode = 1;
}

function deepSort(obj) {
	if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return obj;
	const out = {};
	for (const k of Object.keys(obj).sort()) out[k] = deepSort(obj[k]);
	return out;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}

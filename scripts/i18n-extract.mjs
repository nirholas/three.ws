#!/usr/bin/env node
// i18n-extract: scan annotated HTML and build/refresh the source-of-truth
// catalog (locales/en.json).
//
// three.ws ships copy inline in 150+ static HTML pages, so unlike a greenfield
// i18next app there is no pre-existing key catalog. The migration path is to
// annotate markup incrementally and let this script derive the catalog:
//
//   <h1 data-i18n="home.title">The 3D agent layer of the internet.</h1>
//   <p  data-i18n-html="home.lede">Create <strong>living</strong> agents.</p>
//   <meta name="description" data-i18n-attr="content:home.meta_desc" content="…">
//   <a   data-i18n="common.tour" data-i18n-attr="aria-label:common.tour_aria">Take the tour</a>
//
// The English text already in the element IS the source value. The runtime
// renders en.json even in English, so the catalog must follow the HTML: a value
// whose page copy changed is synced, and the translations of every key whose
// copy really changed (not just a dash or a quote entity) are dropped from each
// locale catalog so the next `i18n:translate` refills them from the current
// English. This used to preserve existing values, and by 2026-11-13 that had
// left 342 values serving copy the pages no longer had.
//
//   --check   report drift and exit 1 without writing anything
//   --prune   drop keys no element references anymore

import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { glob } from 'glob';
import { parse } from 'node-html-parser';
import { ROOT, loadConfig, readJSON, setDeep, getDeep, flatten } from './lib/i18n-shared.mjs';

const collapse = (s) => (s || '').replace(/\s+/g, ' ').trim();

// Pull every (key, sourceValue) pair out of one HTML document. Pure: operates
// on a string so it is unit-testable without the filesystem.
export function extractFromHtml(html) {
	const root = parse(html, {
		comment: false,
		blockTextElements: { script: false, style: false },
	});
	const found = new Map(); // key → value

	for (const el of root.querySelectorAll('[data-i18n]')) {
		const key = el.getAttribute('data-i18n');
		if (key) found.set(key, collapse(el.text));
	}
	for (const el of root.querySelectorAll('[data-i18n-html]')) {
		const key = el.getAttribute('data-i18n-html');
		if (key) found.set(key, collapse(el.innerHTML));
	}
	for (const el of root.querySelectorAll('[data-i18n-attr]')) {
		// "content:home.meta_desc;aria-label:common.tour_aria"
		for (const pair of el.getAttribute('data-i18n-attr').split(';')) {
			const [attr, key] = pair.split(':').map((s) => s && s.trim());
			if (attr && key) found.set(key, collapse(el.getAttribute(attr)));
		}
	}
	return found;
}

function deepSort(obj) {
	if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return obj;
	const out = {};
	for (const k of Object.keys(obj).sort()) out[k] = deepSort(obj[k]);
	return out;
}

// Typography the pages have been normalised through (the em-dash sweep, quote
// entities versus literal quotes, stray whitespace) changes the bytes of a value
// without changing what a translator would write, so it must not throw away 84
// translations of the key.
const typographic = (s) =>
	String(s)
		.replace(/&ldquo;|&rdquo;|&quot;|[“”]/g, '"')
		.replace(/&lsquo;|&rsquo;|&#39;|[‘’]/g, "'")
		.replace(/&mdash;|&ndash;|[\u2014\u2013]/g, '-')
		.replace(/&nbsp;| /g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/\s+/g, ' ')
		.trim();

export function isSubstantiveChange(from, to) {
	return typographic(from) !== typographic(to);
}

// Build the catalog from the extracted (file, pairs) list, in file order. Pure,
// so the sync rules are testable without the filesystem. The HTML wins: a value
// that differs from the existing catalog is taken from the page and reported in
// `changed`. The first file to define a key owns it; a second file with
// different English is a collision.
export function syncCatalog(existing, filePairs, { prune = false } = {}) {
	const catalog = {};
	const seen = new Set();
	const sources = new Map();
	const collisions = [];
	const changed = [];
	let added = 0;
	let unchanged = 0;

	for (const [file, pairs] of filePairs) {
		for (const [key, value] of pairs) {
			if (seen.has(key)) {
				if (getDeep(catalog, key) !== value) {
					collisions.push(`${key}: "${getDeep(catalog, key)}" (${sources.get(key)}) vs "${value}" (${file})`);
				}
				continue;
			}
			seen.add(key);
			sources.set(key, file);
			setDeep(catalog, key, value);
			const prior = getDeep(existing, key);
			if (prior === undefined) added++;
			else if (prior === value) unchanged++;
			else changed.push({ key, from: prior, to: value, substantive: isSubstantiveChange(prior, value), file });
		}
	}

	// Catalog-only keys (strings used from JS via t(), never annotated in HTML)
	// are carried over unless pruning.
	if (!prune) {
		for (const [key, value] of Object.entries(flatten(existing))) {
			if (!seen.has(key)) setDeep(catalog, key, value);
		}
	}

	return { catalog: deepSort(catalog), added, unchanged, changed, collisions };
}

// Drop the translations of the given dotted keys from one locale catalog, in
// place, so `i18n:translate` sees them as missing. Returns how many it removed.
export function invalidateKeys(locale, keys) {
	let removed = 0;
	for (const key of keys) {
		const parts = key.split('.');
		const leaf = parts.pop();
		let node = locale;
		for (const part of parts) {
			node = node && typeof node === 'object' ? node[part] : undefined;
		}
		if (node && typeof node === 'object' && Object.hasOwn(node, leaf)) {
			delete node[leaf];
			removed++;
		}
	}
	return removed;
}

// Same atomic write the translator uses: a stop mid-write never leaves a
// truncated catalog behind.
function writeJsonAtomic(path, value) {
	const tmp = `${path}.tmp-${process.pid}`;
	writeFileSync(tmp, JSON.stringify(value, null, '\t') + '\n');
	renameSync(tmp, path);
}

async function main() {
	const args = new Set(process.argv.slice(2));
	const CHECK = args.has('--check');
	const PRUNE = args.has('--prune');

	const cfg = loadConfig();
	const entryPath = resolve(ROOT, cfg.entry);
	const existing = readJSON(entryPath, {}) || {};

	const patterns = cfg.htmlExtract?.entry || ['pages/**/*.html', 'public/**/*.html'];
	const ignore = cfg.htmlExtract?.exclude || [];
	const files = (await glob(patterns, { cwd: ROOT, ignore, absolute: true, nodir: true })).sort();

	const filePairs = [];
	for (const file of files) {
		try {
			filePairs.push([relative(ROOT, file), extractFromHtml(readFileSync(file, 'utf8'))]);
		} catch (err) {
			console.warn(`! skipped ${relative(ROOT, file)}: ${err.message}`);
		}
	}

	const { catalog, added, unchanged, changed, collisions } = syncCatalog(existing, filePairs, {
		prune: PRUNE,
	});
	const substantive = changed.filter((c) => c.substantive).map((c) => c.key);

	if (CHECK) {
		if (changed.length) {
			console.error(
				`i18n-extract --check: ${changed.length} en.json value(s) differ from their page HTML (${substantive.length} with changed copy):`,
			);
			for (const c of changed) console.error(`  ${c.key} (${c.file})`);
			console.error('Fix: npm run i18n:extract && npm run i18n:translate');
			process.exitCode = 1;
		} else {
			console.log(`i18n-extract --check: en.json matches all ${files.length} annotated files.`);
		}
		return;
	}

	writeFileSync(entryPath, JSON.stringify(catalog, null, '\t') + '\n');

	const total = Object.keys(flatten(catalog)).length;
	console.log(
		`i18n-extract: ${files.length} files → ${total} keys (${added} new, ${changed.length} synced from changed HTML, ${unchanged} unchanged)`,
	);

	if (substantive.length) {
		let dropped = 0;
		let touched = 0;
		for (const code of cfg.outputLocales || []) {
			const path = resolve(ROOT, cfg.output, `${code}.json`);
			const locale = readJSON(path, null);
			if (!locale) continue;
			const n = invalidateKeys(locale, substantive);
			if (!n) continue;
			writeJsonAtomic(path, locale);
			dropped += n;
			touched++;
		}
		console.log(
			`• ${substantive.length} key(s) changed copy; dropped ${dropped} stale translation(s) across ${touched} locale(s). Run \`npm run i18n:translate\` to refill them.`,
		);
	}
	if (collisions.length) {
		console.warn(
			`\n⚠ ${collisions.length} key collision(s): same key, different English text:`,
		);
		for (const c of collisions) console.warn('  ' + c);
		process.exitCode = 1;
	}
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}

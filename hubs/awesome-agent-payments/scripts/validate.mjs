#!/usr/bin/env node
// Dependency-free validator for data/entries.json. Exit 1 on any failure.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const fail = (msg) => errors.push(msg);

function load(rel) {
	try {
		return JSON.parse(readFileSync(join(root, rel), 'utf8'));
	} catch (e) {
		fail(`${rel}: cannot read or parse (${e.message})`);
		return null;
	}
}

const entries = load('data/entries.json');
const categories = load('data/categories.json');
if (!Array.isArray(entries) || !Array.isArray(categories)) {
	console.error(errors.join('\n'));
	process.exit(1);
}

const dashes = /[\u2013\u2014]/;
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const CHAIN = /^[a-z0-9-]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STATUS = new Set(['active', 'early', 'archived']);
const REQUIRED = ['id', 'name', 'url', 'repo', 'category', 'chain', 'description', 'status', 'added'];
const catIds = new Set();
const catOrder = [];

categories.forEach((c, i) => {
	for (const k of ['id', 'title', 'blurb']) {
		if (typeof c[k] !== 'string' || !c[k].trim()) fail(`categories[${i}]: missing "${k}"`);
	}
	if (catIds.has(c.id)) fail(`categories[${i}]: duplicate id "${c.id}"`);
	catIds.add(c.id);
	catOrder.push(c.id);
	if (dashes.test(JSON.stringify(c))) fail(`categories[${i}] (${c.id}): contains an em-dash or en-dash`);
});

function validUrl(s) {
	try {
		const u = new URL(s);
		return u.protocol === 'https:' && u.hostname.includes('.');
	} catch {
		return false;
	}
}

const ids = new Set();
const names = new Set();
const urls = new Set();
entries.forEach((e, i) => {
	const tag = `entries[${i}] (${e && e.id ? e.id : '?'})`;
	if (!e || typeof e !== 'object') return fail(`${tag}: not an object`);
	for (const k of REQUIRED) if (!(k in e)) fail(`${tag}: missing field "${k}"`);
	for (const k of Object.keys(e)) if (!REQUIRED.includes(k)) fail(`${tag}: unknown field "${k}"`);
	if (typeof e.id !== 'string' || !KEBAB.test(e.id)) fail(`${tag}: id must be kebab-case`);
	else if (ids.has(e.id)) fail(`${tag}: duplicate id`);
	else ids.add(e.id);
	if (typeof e.name !== 'string' || !e.name.trim()) fail(`${tag}: name must be a non-empty string`);
	else {
		const n = e.name.toLowerCase();
		if (names.has(n)) fail(`${tag}: duplicate name "${e.name}"`);
		names.add(n);
	}
	if (typeof e.url !== 'string' || !validUrl(e.url)) fail(`${tag}: url must be a valid https URL`);
	else {
		if (urls.has(e.url) && !e.url.includes('github.com')) fail(`${tag}: duplicate url ${e.url}`);
		urls.add(e.url);
	}
	if (e.repo !== null && (typeof e.repo !== 'string' || !validUrl(e.repo))) fail(`${tag}: repo must be null or a valid https URL`);
	if (!catIds.has(e.category)) fail(`${tag}: category "${e.category}" not in categories.json`);
	if (typeof e.chain !== 'string' || !CHAIN.test(e.chain)) fail(`${tag}: chain must be a lowercase slug (solana, base, multi, none, ...)`);
	if (typeof e.description !== 'string' || !e.description.trim()) fail(`${tag}: description is required`);
	else {
		if (e.description.length > 160) fail(`${tag}: description is ${e.description.length} chars (max 160)`);
		if (/\|/.test(e.description)) fail(`${tag}: description must not contain "|"`);
	}
	if (!STATUS.has(e.status)) fail(`${tag}: status must be active, early, or archived`);
	if (typeof e.added !== 'string' || !DATE.test(e.added) || Number.isNaN(Date.parse(e.added))) fail(`${tag}: added must be a valid YYYY-MM-DD date`);
	if (dashes.test(JSON.stringify(e))) fail(`${tag}: contains an em-dash or en-dash character`);
});

// Sorted by category order, then alphabetically by name (case-insensitive) within a category.
const cmp = (a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' });
for (let i = 1; i < entries.length; i++) {
	const p = entries[i - 1];
	const c = entries[i];
	if (!p || !c || !catIds.has(p.category) || !catIds.has(c.category)) continue;
	const pc = catOrder.indexOf(p.category);
	const cc = catOrder.indexOf(c.category);
	if (pc > cc) fail(`entries[${i}] (${c.id}): category "${c.category}" must come before "${p.category}" (follow categories.json order)`);
	else if (pc === cc && cmp(p.name, c.name) > 0) fail(`entries[${i}] (${c.id}): "${c.name}" must be sorted before "${p.name}" within ${c.category}`);
}

for (const f of ['README.md', 'CONTRIBUTING.md']) {
	try {
		if (dashes.test(readFileSync(join(root, f), 'utf8'))) fail(`${f}: contains an em-dash or en-dash character`);
	} catch {
		fail(`${f}: missing`);
	}
}

if (errors.length) {
	console.error(`Validation failed with ${errors.length} problem(s):\n`);
	for (const m of errors) console.error(`  - ${m}`);
	process.exit(1);
}
console.log(`OK: ${entries.length} entries across ${categories.length} categories.`);

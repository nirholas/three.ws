#!/usr/bin/env node
// Dependency-free validator for data/entries.json. Exit code 1 on any failure.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DASHES = new RegExp(`[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`);
const errors = [];
const fail = (msg) => errors.push(msg);

function load(rel) {
	const path = join(root, rel);
	let raw;
	try {
		raw = readFileSync(path, 'utf8');
	} catch (e) {
		fail(`${rel}: cannot read file (${e.code || e.message})`);
		return null;
	}
	if (DASHES.test(raw)) fail(`${rel}: contains an em-dash or en-dash character; use a comma, colon, period or hyphen`);
	try {
		return JSON.parse(raw);
	} catch (e) {
		fail(`${rel}: invalid JSON (${e.message})`);
		return null;
	}
}

const entries = load('data/entries.json');
const categories = load('data/categories.json');
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STATUSES = ['active', 'early', 'archived'];
const FIELDS = ['id', 'name', 'url', 'repo', 'category', 'chain', 'description', 'status', 'added'];

function isHttpUrl(v) {
	try {
		const u = new URL(v);
		return u.protocol === 'https:' || u.protocol === 'http:';
	} catch {
		return false;
	}
}

const catIds = new Set();
if (Array.isArray(categories)) {
	categories.forEach((c, i) => {
		if (!c || typeof c !== 'object') return fail(`categories[${i}]: must be an object`);
		for (const k of ['id', 'title', 'blurb']) {
			if (typeof c[k] !== 'string' || !c[k].trim()) fail(`categories[${i}]: missing "${k}"`);
		}
		if (typeof c.id === 'string') {
			if (!KEBAB.test(c.id)) fail(`categories[${i}]: id "${c.id}" must be kebab-case`);
			if (catIds.has(c.id)) fail(`categories[${i}]: duplicate id "${c.id}"`);
			catIds.add(c.id);
		}
	});
} else if (categories !== null) {
	fail('data/categories.json: must be an array');
}

if (Array.isArray(entries)) {
	const seen = new Set();
	const lastByCat = new Map();
	entries.forEach((e, i) => {
		const label = `entries[${i}]${e && e.id ? ` (${e.id})` : ''}`;
		if (!e || typeof e !== 'object' || Array.isArray(e)) return fail(`${label}: must be an object`);
		for (const k of FIELDS) if (!(k in e)) fail(`${label}: missing required field "${k}"`);
		for (const k of Object.keys(e)) if (!FIELDS.includes(k)) fail(`${label}: unknown field "${k}"`);

		if (typeof e.id === 'string') {
			if (!KEBAB.test(e.id)) fail(`${label}: id must be kebab-case (lowercase letters, digits, hyphens)`);
			if (seen.has(e.id)) fail(`${label}: duplicate id "${e.id}"`);
			seen.add(e.id);
		} else if ('id' in e) fail(`${label}: id must be a string`);

		if ('name' in e && (typeof e.name !== 'string' || !e.name.trim())) fail(`${label}: name must be a non-empty string`);
		if ('url' in e && !(typeof e.url === 'string' && isHttpUrl(e.url))) fail(`${label}: url must be a valid http(s) URL`);
		if ('repo' in e && e.repo !== null && !(typeof e.repo === 'string' && isHttpUrl(e.repo))) fail(`${label}: repo must be a valid http(s) URL or null`);
		if ('category' in e && !catIds.has(e.category)) fail(`${label}: category "${e.category}" is not defined in data/categories.json`);
		if ('chain' in e && !(typeof e.chain === 'string' && KEBAB.test(e.chain))) fail(`${label}: chain must be a lowercase slug such as solana, base, ethereum, multi or none`);
		if ('description' in e) {
			if (typeof e.description !== 'string' || e.description.trim().length < 10) fail(`${label}: description must be a sentence of at least 10 characters`);
			else if (e.description.length > 160) fail(`${label}: description is ${e.description.length} characters, max is 160`);
			else if (e.description !== e.description.trim()) fail(`${label}: description has leading or trailing whitespace`);
		}
		if ('status' in e && !STATUSES.includes(e.status)) fail(`${label}: status must be one of ${STATUSES.join(', ')}`);
		if ('added' in e) {
			const ok = typeof e.added === 'string' && DATE.test(e.added) && !Number.isNaN(Date.parse(e.added));
			if (!ok) fail(`${label}: added must be a real YYYY-MM-DD date`);
		}

		if (typeof e.category === 'string' && typeof e.name === 'string') {
			const prev = lastByCat.get(e.category);
			const key = e.name.toLowerCase();
			if (prev && key < prev.key) fail(`${label}: "${e.name}" must come before "${prev.name}" (entries are sorted alphabetically by name within each category)`);
			lastByCat.set(e.category, { key, name: e.name });
		}
	});

	if (Array.isArray(categories)) {
		const used = new Set(entries.map((e) => e && e.category));
		for (const c of categories) if (c && !used.has(c.id)) fail(`category "${c.id}" has no entries`);
	}
} else if (entries !== null) {
	fail('data/entries.json: must be an array');
}

if (errors.length) {
	console.error(`Validation failed with ${errors.length} problem${errors.length === 1 ? '' : 's'}:\n`);
	for (const m of errors) console.error(`  - ${m}`);
	process.exit(1);
}
console.log(`OK: ${entries.length} entries across ${categories.length} categories.`);

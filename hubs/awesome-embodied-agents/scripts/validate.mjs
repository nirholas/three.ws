#!/usr/bin/env node
// Dependency-free validator for data/entries.json.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (f) => JSON.parse(readFileSync(join(root, 'data', f), 'utf8'));

const errors = [];
const err = (msg) => errors.push(msg);

let entries;
let categories;
try {
	entries = load('entries.json');
	categories = load('categories.json');
} catch (e) {
	console.error(`Cannot read data files: ${e.message}`);
	process.exit(1);
}

if (!Array.isArray(entries)) {
	console.error('data/entries.json must be an array');
	process.exit(1);
}

const categoryIds = new Set(categories.map((c) => c.id));
if (categoryIds.size !== categories.length) err('categories.json has duplicate ids');

const REQUIRED = ['id', 'name', 'url', 'repo', 'category', 'chain', 'description', 'status', 'added'];
const STATUSES = new Set(['active', 'early', 'archived']);
const DASHES = /[\u2013\u2014]/;
const seen = new Set();

const isUrl = (s) => {
	if (typeof s !== 'string') return false;
	try {
		const u = new URL(s);
		return u.protocol === 'https:' || u.protocol === 'http:';
	} catch {
		return false;
	}
};

entries.forEach((e, i) => {
	const at = `entry #${i + 1}${e && e.id ? ` (${e.id})` : ''}`;
	if (!e || typeof e !== 'object') return err(`${at}: not an object`);
	for (const k of REQUIRED) if (!(k in e)) err(`${at}: missing field "${k}"`);
	for (const k of Object.keys(e)) if (!REQUIRED.includes(k)) err(`${at}: unknown field "${k}"`);
	if (typeof e.id !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.id)) err(`${at}: id must be kebab-case`);
	else if (seen.has(e.id)) err(`${at}: duplicate id`);
	else seen.add(e.id);
	if (typeof e.name !== 'string' || !e.name.trim()) err(`${at}: name must be a non-empty string`);
	if (!isUrl(e.url)) err(`${at}: url is not a valid http(s) URL`);
	if (e.repo !== null && !isUrl(e.repo)) err(`${at}: repo must be a valid URL or null`);
	if (!categoryIds.has(e.category)) err(`${at}: category "${e.category}" is not in categories.json`);
	if (typeof e.chain !== 'string' || !e.chain) err(`${at}: chain must be a string ("none" unless onchain)`);
	if (typeof e.description !== 'string') err(`${at}: description must be a string`);
	else {
		if (e.description.length < 10) err(`${at}: description is too short`);
		if (e.description.length > 160) err(`${at}: description is ${e.description.length} chars, max 160`);
		if (/\n/.test(e.description)) err(`${at}: description must be a single line`);
	}
	if (!STATUSES.has(e.status)) err(`${at}: status must be active, early or archived`);
	if (typeof e.added !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.added) || Number.isNaN(Date.parse(e.added))) {
		err(`${at}: added must be a valid YYYY-MM-DD date`);
	}
	for (const [k, v] of Object.entries(e)) {
		if (typeof v === 'string' && DASHES.test(v)) err(`${at}: field "${k}" contains an em-dash or en-dash; use a comma, colon or hyphen`);
	}
});

for (const c of categories) {
	for (const [k, v] of Object.entries(c)) {
		if (typeof v === 'string' && DASHES.test(v)) err(`category ${c.id}: field "${k}" contains an em-dash or en-dash`);
	}
}

// Sorted alphabetically by name within each category.
const key = (e) => String(e.name).toLowerCase();
for (const cat of categories) {
	const list = entries.filter((e) => e && e.category === cat.id);
	for (let i = 1; i < list.length; i++) {
		if (key(list[i - 1]) > key(list[i])) {
			err(`category "${cat.id}": "${list[i].name}" must come before "${list[i - 1].name}" (sort alphabetically by name)`);
		}
	}
}

if (errors.length) {
	console.error(`Validation failed with ${errors.length} problem${errors.length === 1 ? '' : 's'}:\n`);
	for (const m of errors) console.error(`  - ${m}`);
	process.exit(1);
}
console.log(`OK: ${entries.length} entries across ${categories.length} categories.`);

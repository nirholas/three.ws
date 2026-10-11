#!/usr/bin/env node
// Dependency-free validator for data/entries.json. Exits 1 with readable messages.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
const fail = (msg) => errors.push(msg);

function load(rel) {
	try {
		return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8'));
	} catch (e) {
		console.error(`FAIL ${rel}: ${e.message}`);
		process.exit(1);
	}
}

const entries = load('data/entries.json');
const categories = load('data/categories.json');
const schema = load('data/schema.json');

const DASHES = /[\u2013\u2014]/;
const required = schema.items.required;
const statuses = schema.items.properties.status.enum;
const chains = schema.items.properties.chain.enum;
const maxDesc = schema.items.properties.description.maxLength;
const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isUrl(v) {
	try {
		const u = new URL(v);
		return u.protocol === 'https:' || u.protocol === 'http:';
	} catch {
		return false;
	}
}

if (!Array.isArray(entries)) fail('entries.json must be an array');
if (!Array.isArray(categories)) fail('categories.json must be an array');

const catIds = new Set();
(categories || []).forEach((c, i) => {
	for (const k of ['id', 'title', 'blurb']) {
		if (typeof c[k] !== 'string' || !c[k]) fail(`categories[${i}] missing "${k}"`);
	}
	if (catIds.has(c.id)) fail(`categories: duplicate id "${c.id}"`);
	catIds.add(c.id);
	for (const k of ['title', 'blurb']) if (DASHES.test(c[k] || '')) fail(`categories[${i}].${k} contains an em-dash or en-dash`);
});

const ids = new Set();
const urls = new Map();
const byCat = new Map();
(entries || []).forEach((e, i) => {
	const at = `entries[${i}]${e && e.id ? ` (${e.id})` : ''}`;
	for (const k of required) if (!(k in e)) fail(`${at}: missing field "${k}"`);
	for (const k of Object.keys(e)) if (!required.includes(k)) fail(`${at}: unknown field "${k}"`);
	if (typeof e.id !== 'string' || !ID_RE.test(e.id)) fail(`${at}: id must be kebab-case`);
	else if (ids.has(e.id)) fail(`${at}: duplicate id "${e.id}"`);
	else ids.add(e.id);
	if (typeof e.name !== 'string' || !e.name.trim()) fail(`${at}: name must be a non-empty string`);
	if (!isUrl(e.url)) fail(`${at}: url is not a valid http(s) URL`);
	else {
		const key = e.url.replace(/\/+$/, '').toLowerCase();
		if (urls.has(key)) fail(`${at}: url duplicates entry "${urls.get(key)}"`);
		else urls.set(key, e.id);
	}
	if (e.repo !== null && !isUrl(e.repo)) fail(`${at}: repo must be a valid URL or null`);
	if (!catIds.has(e.category)) fail(`${at}: category "${e.category}" is not in categories.json`);
	if (!chains.includes(e.chain)) fail(`${at}: chain must be one of ${chains.join(', ')}`);
	if (typeof e.description !== 'string' || e.description.length < 10) fail(`${at}: description too short`);
	else if (e.description.length > maxDesc) fail(`${at}: description is ${e.description.length} chars (max ${maxDesc})`);
	if (!statuses.includes(e.status)) fail(`${at}: status must be one of ${statuses.join(', ')}`);
	if (typeof e.added !== 'string' || !DATE_RE.test(e.added) || Number.isNaN(Date.parse(e.added))) fail(`${at}: added must be a valid YYYY-MM-DD date`);
	for (const k of ['name', 'description', 'url', 'repo']) {
		if (typeof e[k] === 'string' && DASHES.test(e[k])) fail(`${at}: ${k} contains an em-dash or en-dash`);
	}
	if (!byCat.has(e.category)) byCat.set(e.category, []);
	byCat.get(e.category).push(e);
});

for (const [cat, list] of byCat) {
	for (let i = 1; i < list.length; i++) {
		const a = list[i - 1].name.toLowerCase();
		const b = list[i].name.toLowerCase();
		if (a.localeCompare(b) > 0) fail(`category "${cat}": "${list[i].name}" should come before "${list[i - 1].name}" (alphabetical order)`);
	}
}

if (errors.length) {
	console.error(`Validation failed with ${errors.length} problem${errors.length === 1 ? '' : 's'}:\n`);
	for (const m of errors) console.error(`  - ${m}`);
	process.exit(1);
}
console.log(`OK: ${entries.length} entries across ${catIds.size} categories.`);

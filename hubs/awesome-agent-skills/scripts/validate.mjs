#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (f) => JSON.parse(readFileSync(join(root, 'data', f), 'utf8'));
const errors = [];
const err = (m) => errors.push(m);

let entries, categories;
try {
  entries = load('entries.json');
  categories = load('categories.json');
} catch (e) {
  console.error(`Cannot read data files: ${e.message}`);
  process.exit(1);
}
if (!Array.isArray(entries) || !Array.isArray(categories)) {
  console.error('entries.json and categories.json must both be arrays.');
  process.exit(1);
}

const catIds = categories.map((c) => c.id);
const BAD_DASH = /[\u2013\u2014]/;
const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const STATUS = ['active', 'early', 'archived'];
const FIELDS = ['id', 'name', 'url', 'repo', 'category', 'chain', 'description', 'status', 'added'];
const isUrl = (s) => {
  try { return ['http:', 'https:'].includes(new URL(s).protocol); } catch { return false; }
};

categories.forEach((c, i) => {
  for (const k of ['id', 'title', 'blurb']) {
    if (typeof c[k] !== 'string' || !c[k]) err(`categories[${i}]: missing "${k}"`);
  }
});
if (new Set(catIds).size !== catIds.length) err('categories.json: duplicate category ids');

const seen = new Set();
const seenUrls = new Map();
entries.forEach((e, i) => {
  const at = `entries[${i}] (${e && e.id})`;
  for (const k of FIELDS) if (!(k in e)) err(`${at}: missing field "${k}"`);
  for (const k of Object.keys(e)) if (!FIELDS.includes(k)) err(`${at}: unknown field "${k}"`);
  if (typeof e.id !== 'string' || !ID_RE.test(e.id)) err(`${at}: id must be kebab-case`);
  if (seen.has(e.id)) err(`${at}: duplicate id`);
  seen.add(e.id);
  if (typeof e.name !== 'string' || !e.name.trim()) err(`${at}: name is empty`);
  if (!isUrl(e.url)) err(`${at}: url is not a valid http(s) URL`);
  if (e.repo !== null && !isUrl(e.repo)) err(`${at}: repo must be a valid URL or null`);
  if (typeof e.url === 'string') {
    const key = e.url.replace(/\/$/, '').toLowerCase();
    if (seenUrls.has(key)) err(`${at}: url duplicates entry "${seenUrls.get(key)}"`);
    seenUrls.set(key, e.id);
  }
  if (!catIds.includes(e.category)) err(`${at}: unknown category "${e.category}"`);
  if (typeof e.chain !== 'string' || !e.chain) err(`${at}: chain must be a non-empty string ("none" if not onchain)`);
  if (typeof e.description !== 'string' || e.description.length < 10) err(`${at}: description too short`);
  else if (e.description.length > 160) err(`${at}: description is ${e.description.length} chars (max 160)`);
  if (!STATUS.includes(e.status)) err(`${at}: status must be one of ${STATUS.join(', ')}`);
  if (typeof e.added !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.added) || Number.isNaN(Date.parse(e.added))) {
    err(`${at}: added must be a valid YYYY-MM-DD date`);
  }
  for (const k of ['name', 'description']) {
    if (typeof e[k] === 'string' && BAD_DASH.test(e[k])) err(`${at}: ${k} contains an em-dash or en-dash; use a comma, colon or hyphen`);
  }
});

for (const cat of catIds) {
  const names = entries.filter((e) => e.category === cat).map((e) => e.name);
  for (let i = 1; i < names.length; i++) {
    if (names[i - 1].toLowerCase().localeCompare(names[i].toLowerCase()) > 0) {
      err(`category "${cat}": "${names[i]}" must come before "${names[i - 1]}" (sort alphabetically by name)`);
    }
  }
}

for (const f of ['entries.json', 'categories.json']) {
  if (BAD_DASH.test(readFileSync(join(root, 'data', f), 'utf8'))) err(`${f}: contains an em-dash or en-dash`);
}

if (errors.length) {
  console.error(`Validation failed with ${errors.length} problem(s):\n`);
  for (const m of errors) console.error(`  - ${m}`);
  process.exit(1);
}
console.log(`OK: ${entries.length} entries across ${categories.length} categories.`);

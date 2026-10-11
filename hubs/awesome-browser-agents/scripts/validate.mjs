#!/usr/bin/env node
// Validates data/entries.json against data/categories.json. No dependencies.
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
  console.error(`Could not read data files: ${e.message}`);
  process.exit(1);
}

const DASHES = /[\u2013\u2014]/;
const STATUS = ['active', 'early', 'archived'];
const FIELDS = ['id', 'name', 'url', 'repo', 'category', 'chain', 'description', 'status', 'added'];
const catIds = new Set(categories.map((c) => c.id));
const seen = new Set();

function validUrl(u) {
  try {
    const p = new URL(u);
    return p.protocol === 'https:' || p.protocol === 'http:';
  } catch {
    return false;
  }
}

if (!Array.isArray(entries)) err('entries.json must be an array');
else {
  entries.forEach((e, i) => {
    const tag = `entry #${i + 1} (${e && e.id ? e.id : 'no id'})`;
    for (const f of FIELDS) if (!(f in e)) err(`${tag}: missing field "${f}"`);
    for (const k of Object.keys(e)) if (!FIELDS.includes(k)) err(`${tag}: unknown field "${k}"`);
    if (typeof e.id !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.id)) err(`${tag}: id must be kebab-case`);
    else if (seen.has(e.id)) err(`${tag}: duplicate id`);
    else seen.add(e.id);
    if (typeof e.name !== 'string' || !e.name.trim()) err(`${tag}: name must be a non-empty string`);
    if (!validUrl(e.url)) err(`${tag}: url is not a valid http(s) URL`);
    if (e.repo !== null && !validUrl(e.repo)) err(`${tag}: repo must be a valid URL or null`);
    if (!catIds.has(e.category)) err(`${tag}: category "${e.category}" is not in categories.json`);
    if (e.chain !== 'none') err(`${tag}: chain must be "none"`);
    if (typeof e.description !== 'string' || !e.description.trim()) err(`${tag}: description is required`);
    else if (e.description.length > 160) err(`${tag}: description is ${e.description.length} chars (max 160)`);
    if (!STATUS.includes(e.status)) err(`${tag}: status must be one of ${STATUS.join(', ')}`);
    if (typeof e.added !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.added) || Number.isNaN(Date.parse(e.added)))
      err(`${tag}: added must be a valid YYYY-MM-DD date`);
    if (DASHES.test(JSON.stringify(e))) err(`${tag}: contains an em-dash or en-dash; use a comma, period, or hyphen`);
  });

  const lastByCat = new Map();
  for (const e of entries) {
    const prev = lastByCat.get(e.category);
    if (prev && e.name.localeCompare(prev, 'en', { sensitivity: 'base' }) < 0)
      err(`"${e.name}" is out of order in category "${e.category}" (comes after "${prev}"); sort alphabetically by name`);
    lastByCat.set(e.category, e.name);
  }
}

for (const c of categories) {
  if (!c.id || !c.title || !c.blurb) err(`category ${JSON.stringify(c.id)} needs id, title, and blurb`);
  if (DASHES.test(JSON.stringify(c))) err(`category "${c.id}" contains an em-dash or en-dash`);
}

if (errors.length) {
  console.error(`Validation failed with ${errors.length} problem${errors.length === 1 ? '' : 's'}:\n`);
  for (const m of errors) console.error(`  - ${m}`);
  process.exit(1);
}
console.log(`OK: ${entries.length} entries across ${categories.length} categories.`);

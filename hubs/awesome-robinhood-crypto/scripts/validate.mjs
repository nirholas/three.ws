#!/usr/bin/env node
// Dependency-free validator for data/entries.json. Exit code 1 on any problem.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (f) => JSON.parse(readFileSync(join(root, 'data', f), 'utf8'));

const errors = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);

let entries;
let categories;
try {
  entries = load('entries.json');
  categories = load('categories.json');
} catch (e) {
  console.error(`Could not read data files: ${e.message}`);
  process.exit(1);
}
if (!Array.isArray(entries)) {
  console.error('data/entries.json must be an array');
  process.exit(1);
}

const EMDASH = /[\u2014\u2013]/;
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STATUS = new Set(['active', 'early', 'archived']);
const FIELDS = ['id', 'name', 'url', 'repo', 'category', 'chain', 'description', 'status', 'added'];
const catIds = new Set();
categories.forEach((c, i) => {
  const w = `categories[${i}]`;
  for (const k of ['id', 'title', 'blurb']) {
    if (typeof c[k] !== 'string' || !c[k].trim()) err(w, `missing "${k}"`);
    else if (EMDASH.test(c[k])) err(w, `"${k}" contains an em-dash or en-dash character`);
  }
  if (c.id && !KEBAB.test(c.id)) err(w, `id "${c.id}" is not kebab-case`);
  if (catIds.has(c.id)) err(w, `duplicate category id "${c.id}"`);
  catIds.add(c.id);
});
const catOrder = categories.map((c) => c.id);

const isHttps = (u) => {
  try {
    return new URL(u).protocol === 'https:';
  } catch {
    return false;
  }
};
const key = (s) => s.toLowerCase();

const seen = new Set();
const seenUrls = new Map();
entries.forEach((e, i) => {
  const w = `entries[${i}] (${e && e.id ? e.id : 'no id'})`;
  if (!e || typeof e !== 'object') return err(w, 'must be an object');
  for (const f of FIELDS) if (!(f in e)) err(w, `missing required field "${f}"`);
  for (const f of Object.keys(e)) if (!FIELDS.includes(f)) err(w, `unknown field "${f}"`);
  for (const f of ['id', 'name', 'url', 'category', 'chain', 'description', 'status', 'added']) {
    if (f in e && (typeof e[f] !== 'string' || !e[f].trim())) err(w, `"${f}" must be a non-empty string`);
  }
  if (typeof e.id === 'string') {
    if (!KEBAB.test(e.id)) err(w, `id "${e.id}" is not kebab-case`);
    if (seen.has(e.id)) err(w, `duplicate id "${e.id}"`);
    seen.add(e.id);
  }
  if (typeof e.url === 'string') {
    if (!isHttps(e.url)) err(w, `url "${e.url}" is not a valid https URL`);
    const norm = e.url.replace(/\/+$/, '').toLowerCase();
    if (seenUrls.has(norm)) err(w, `url duplicates entry "${seenUrls.get(norm)}"`);
    seenUrls.set(norm, e.id);
  }
  if (e.repo !== null && e.repo !== undefined && !(typeof e.repo === 'string' && isHttps(e.repo))) {
    err(w, 'repo must be a valid https URL or null');
  }
  if (typeof e.category === 'string' && !catIds.has(e.category)) {
    err(w, `category "${e.category}" is not in data/categories.json`);
  }
  if (typeof e.chain === 'string' && !KEBAB.test(e.chain)) err(w, `chain "${e.chain}" must be kebab-case`);
  if (typeof e.status === 'string' && !STATUS.has(e.status)) err(w, `status "${e.status}" must be active, early or archived`);
  if (typeof e.added === 'string') {
    if (!DATE.test(e.added) || Number.isNaN(Date.parse(e.added))) err(w, `added "${e.added}" must be a real YYYY-MM-DD date`);
  }
  if (typeof e.description === 'string') {
    if (e.description.length > 160) err(w, `description is ${e.description.length} chars (max 160)`);
    if (e.description.length < 10) err(w, 'description is too short');
    if (/\n/.test(e.description)) err(w, 'description must be a single line');
  }
  for (const f of ['name', 'description']) {
    if (typeof e[f] === 'string' && /\|/.test(e[f])) err(w, `"${f}" must not contain a pipe character (breaks the README table)`);
  }
  for (const f of FIELDS) {
    if (typeof e[f] === 'string' && EMDASH.test(e[f])) err(w, `"${f}" contains an em-dash or en-dash character`);
  }
});

// Order: category order from categories.json, then alphabetical by name.
for (let i = 1; i < entries.length; i++) {
  const a = entries[i - 1];
  const b = entries[i];
  if (!a || !b || typeof a.name !== 'string' || typeof b.name !== 'string') continue;
  const ca = catOrder.indexOf(a.category);
  const cb = catOrder.indexOf(b.category);
  if (ca < 0 || cb < 0) continue;
  if (ca > cb) err(`entries[${i}] (${b.id})`, `category "${b.category}" appears after "${a.category}", which is out of the order in categories.json`);
  else if (ca === cb && key(a.name) > key(b.name)) {
    err(`entries[${i}] (${b.id})`, `"${b.name}" must come before "${a.name}" (alphabetical within category)`);
  }
}

for (const c of categories) {
  if (!entries.some((e) => e.category === c.id)) err(`category "${c.id}"`, 'has no entries');
}

if (errors.length) {
  console.error(`Validation failed with ${errors.length} problem${errors.length === 1 ? '' : 's'}:\n`);
  for (const m of errors) console.error(`  - ${m}`);
  process.exit(1);
}
console.log(`OK: ${entries.length} entries in ${categories.length} categories.`);

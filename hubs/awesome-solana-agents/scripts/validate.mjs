#!/usr/bin/env node
// Dependency-free validator for data/entries.json. Exit 1 on any problem.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (f) => JSON.parse(readFileSync(join(root, 'data', f), 'utf8'));

const CHAINS = ['solana', 'multi', 'none'];
const STATUSES = ['active', 'early', 'archived'];
const REQUIRED = ['id', 'name', 'url', 'repo', 'category', 'chain', 'description', 'status', 'added'];
const errors = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);

const isUrl = (s) => {
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
};
const cmp = (a, b) => a.toLowerCase().localeCompare(b.toLowerCase(), 'en');

let entries;
let categories;
try {
  entries = load('entries.json');
  categories = load('categories.json');
} catch (e) {
  console.error(`Cannot read data files: ${e.message}`);
  process.exit(1);
}
if (!Array.isArray(entries)) { console.error('entries.json must be an array'); process.exit(1); }
if (!Array.isArray(categories)) { console.error('categories.json must be an array'); process.exit(1); }

const catIds = new Set();
categories.forEach((c, i) => {
  const w = `categories[${i}]`;
  for (const k of ['id', 'title', 'blurb']) if (typeof c[k] !== 'string' || !c[k]) err(w, `missing "${k}"`);
  if (catIds.has(c.id)) err(w, `duplicate category id "${c.id}"`);
  catIds.add(c.id);
});

const seenIds = new Set();
const seenUrls = new Set();
const byCat = new Map();
entries.forEach((e, i) => {
  const w = `entries[${i}]${e && e.id ? ` (${e.id})` : ''}`;
  if (typeof e !== 'object' || e === null) return err(w, 'must be an object');
  for (const k of REQUIRED) if (!(k in e)) err(w, `missing field "${k}"`);
  for (const k of Object.keys(e)) if (!REQUIRED.includes(k)) err(w, `unknown field "${k}"`);

  if (typeof e.id !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.id)) err(w, 'id must be kebab-case');
  if (seenIds.has(e.id)) err(w, `duplicate id "${e.id}"`);
  seenIds.add(e.id);
  if (typeof e.name !== 'string' || !e.name.trim()) err(w, 'name must be a non-empty string');
  if (!isUrl(e.url)) err(w, `url is not a valid http(s) URL: ${e.url}`);
  else {
    const key = e.url.replace(/\/+$/, '').toLowerCase();
    if (seenUrls.has(key)) err(w, `duplicate url ${e.url}`);
    seenUrls.add(key);
  }
  if (e.repo !== null && !isUrl(e.repo)) err(w, `repo must be null or a valid URL: ${e.repo}`);
  if (!catIds.has(e.category)) err(w, `unknown category "${e.category}"`);
  if (!CHAINS.includes(e.chain)) err(w, `chain must be one of ${CHAINS.join('|')}`);
  if (!STATUSES.includes(e.status)) err(w, `status must be one of ${STATUSES.join('|')}`);
  if (typeof e.description !== 'string' || !e.description.trim()) err(w, 'description must be a non-empty string');
  else if (e.description.length > 160) err(w, `description is ${e.description.length} chars (max 160)`);
  else if (!/[.!?]$/.test(e.description)) err(w, 'description should end with a period');
  if (typeof e.added !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.added) || Number.isNaN(Date.parse(e.added))) err(w, 'added must be a valid YYYY-MM-DD date');

  if (!byCat.has(e.category)) byCat.set(e.category, []);
  byCat.get(e.category).push(e);
});

for (const [cat, list] of byCat) {
  for (let i = 1; i < list.length; i++) {
    if (cmp(list[i - 1].name, list[i].name) > 0) {
      err(`category "${cat}"`, `"${list[i].name}" must come before "${list[i - 1].name}" (sort alphabetically by name)`);
    }
  }
}

const raw = ['entries.json', 'categories.json'].map((f) => readFileSync(join(root, 'data', f), 'utf8')).join('\n');
if (raw.includes(String.fromCharCode(0x2013)) || raw.includes(String.fromCharCode(0x2014))) err('data', 'contains an em-dash or en-dash character; use a comma, colon or hyphen');

if (errors.length) {
  console.error(`Validation failed with ${errors.length} problem(s):\n`);
  for (const m of errors) console.error(`  - ${m}`);
  process.exit(1);
}
console.log(`OK: ${entries.length} entries across ${byCat.size} categories.`);

#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (f) => JSON.parse(readFileSync(join(root, 'data', f), 'utf8'));
const errors = [];
const err = (m) => errors.push(m);

const FORBIDDEN = /[\u2013\u2014]/;
const CHAINS = ['solana', 'evm', 'multi', 'none'];
const STATUSES = ['active', 'early', 'archived'];
const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isUrl(v) {
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

let entries, categories;
try {
  entries = load('entries.json');
  categories = load('categories.json');
} catch (e) {
  console.error(`Could not read data files: ${e.message}`);
  process.exit(1);
}
if (!Array.isArray(entries)) { console.error('entries.json must be an array'); process.exit(1); }
if (!Array.isArray(categories)) { console.error('categories.json must be an array'); process.exit(1); }

const catIds = new Set();
categories.forEach((c, i) => {
  for (const k of ['id', 'title', 'blurb']) {
    if (typeof c[k] !== 'string' || !c[k].trim()) err(`categories[${i}]: missing "${k}"`);
  }
  if (c.id && !KEBAB.test(c.id)) err(`categories[${i}]: id "${c.id}" is not kebab-case`);
  if (catIds.has(c.id)) err(`categories[${i}]: duplicate id "${c.id}"`);
  catIds.add(c.id);
  if (FORBIDDEN.test(JSON.stringify(c))) err(`categories[${i}]: contains an em-dash or en-dash`);
});

const ids = new Set();
const urls = new Map();
const prevByCat = new Map();
const fields = ['id', 'name', 'url', 'repo', 'category', 'chain', 'description', 'status', 'added'];

entries.forEach((e, i) => {
  const label = `entries[${i}]${e && e.id ? ` (${e.id})` : ''}`;
  for (const k of fields) if (!(k in e)) err(`${label}: missing field "${k}"`);
  for (const k of Object.keys(e)) if (!fields.includes(k)) err(`${label}: unknown field "${k}"`);
  if (typeof e.id !== 'string' || !KEBAB.test(e.id)) err(`${label}: id must be kebab-case`);
  if (ids.has(e.id)) err(`${label}: duplicate id`);
  ids.add(e.id);
  if (typeof e.name !== 'string' || !e.name.trim()) err(`${label}: name must be a non-empty string`);
  if (!isUrl(e.url)) err(`${label}: url is not a valid http(s) URL`);
  else {
    const key = e.url.replace(/\/$/, '').toLowerCase();
    if (urls.has(key)) err(`${label}: url duplicates entry "${urls.get(key)}"`);
    urls.set(key, e.id);
  }
  if (e.repo !== null && !isUrl(e.repo)) err(`${label}: repo must be a valid URL or null`);
  if (!catIds.has(e.category)) err(`${label}: category "${e.category}" is not in categories.json`);
  if (!CHAINS.includes(e.chain)) err(`${label}: chain must be one of ${CHAINS.join(', ')}`);
  if (!STATUSES.includes(e.status)) err(`${label}: status must be one of ${STATUSES.join(', ')}`);
  if (typeof e.added !== 'string' || !DATE.test(e.added) || Number.isNaN(Date.parse(e.added))) {
    err(`${label}: added must be a valid YYYY-MM-DD date`);
  }
  if (typeof e.description !== 'string' || !e.description.trim()) err(`${label}: description is required`);
  else if (e.description.length > 160) err(`${label}: description is ${e.description.length} chars (max 160)`);
  else if (/\|/.test(e.description) || /\n/.test(e.description)) err(`${label}: description must be a single line without "|"`);
  if (FORBIDDEN.test(JSON.stringify(e))) err(`${label}: contains an em-dash or en-dash`);

  const prev = prevByCat.get(e.category);
  if (prev && String(e.name).toLowerCase() < prev.toLowerCase()) {
    err(`${label}: "${e.name}" must come before "${prev}" (sort alphabetically by name within "${e.category}")`);
  }
  prevByCat.set(e.category, String(e.name));
});

const order = categories.map((c) => c.id);
let last = -1;
entries.forEach((e, i) => {
  const idx = order.indexOf(e.category);
  if (idx !== -1 && idx < last) err(`entries[${i}] (${e.id}): entries must be grouped in category order`);
  if (idx !== -1) last = Math.max(last, idx);
});

if (errors.length) {
  console.error(`Validation failed with ${errors.length} problem(s):\n`);
  for (const m of errors) console.error(`  - ${m}`);
  process.exit(1);
}
console.log(`OK: ${entries.length} entries across ${categories.length} categories.`);

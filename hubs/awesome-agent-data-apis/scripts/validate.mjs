#!/usr/bin/env node
// Dependency-free validator for data/entries.json.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (f) => JSON.parse(readFileSync(join(root, 'data', f), 'utf8'));

const CHAINS = ['solana', 'evm', 'multi', 'none'];
const STATUSES = ['active', 'early', 'archived'];
const PRICING = ['free', 'freemium', 'paid', 'pay-per-call', 'unknown'];
const FIELDS = ['id', 'name', 'url', 'repo', 'category', 'chain', 'description', 'status', 'pricing', 'added'];
const BANNED = /[\u2013\u2014]/;

const errors = [];
const err = (id, msg) => errors.push(`${id}: ${msg}`);

function isHttpUrl(v) {
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
const sortKey = (e) => e.name.toLowerCase();

let entries, categories;
try {
  entries = load('entries.json');
  categories = load('categories.json');
} catch (e) {
  console.error(`Cannot read data files: ${e.message}`);
  process.exit(1);
}
if (!Array.isArray(entries)) {
  console.error('entries.json must be an array');
  process.exit(1);
}

const catIds = categories.map((c) => c.id);
const seen = new Set();
const seenUrls = new Map();

entries.forEach((e, i) => {
  const id = e && typeof e.id === 'string' ? e.id : `entry[${i}]`;
  for (const f of FIELDS) if (!(f in e)) err(id, `missing field "${f}"`);
  for (const k of Object.keys(e)) if (!FIELDS.includes(k)) err(id, `unknown field "${k}"`);
  if (typeof e.id !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.id)) err(id, 'id must be kebab-case');
  if (seen.has(e.id)) err(id, 'duplicate id');
  seen.add(e.id);
  if (typeof e.name !== 'string' || !e.name.trim()) err(id, 'name must be a non-empty string');
  if (!isHttpUrl(e.url)) err(id, `invalid url "${e.url}"`);
  else {
    const key = e.url.replace(/\/+$/, '').toLowerCase();
    if (seenUrls.has(key)) err(id, `url duplicates ${seenUrls.get(key)}`);
    seenUrls.set(key, id);
  }
  if (e.repo !== null && !isHttpUrl(e.repo)) err(id, 'repo must be a URL or null');
  if (!catIds.includes(e.category)) err(id, `unknown category "${e.category}"`);
  if (!CHAINS.includes(e.chain)) err(id, `chain must be one of ${CHAINS.join('|')}`);
  if (!STATUSES.includes(e.status)) err(id, `status must be one of ${STATUSES.join('|')}`);
  if (!PRICING.includes(e.pricing)) err(id, `pricing must be one of ${PRICING.join('|')}`);
  if (typeof e.description !== 'string' || e.description.length < 10 || e.description.length > 160)
    err(id, `description must be 10-160 chars (got ${e.description ? e.description.length : 0})`);
  if (typeof e.added !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.added) || Number.isNaN(Date.parse(e.added)))
    err(id, 'added must be YYYY-MM-DD');
  for (const f of FIELDS) if (typeof e[f] === 'string' && BANNED.test(e[f])) err(id, `field "${f}" contains an em-dash or en-dash`);
});

for (const cat of catIds) {
  const list = entries.filter((e) => e.category === cat);
  for (let i = 1; i < list.length; i++) {
    if (sortKey(list[i - 1]) > sortKey(list[i]))
      err(list[i].id, `not alphabetical in "${cat}": "${list[i].name}" must come before "${list[i - 1].name}"`);
  }
}

for (const file of ['entries.json', 'categories.json']) {
  if (BANNED.test(readFileSync(join(root, 'data', file), 'utf8'))) errors.push(`${file}: contains an em-dash or en-dash`);
}

if (errors.length) {
  console.error(`Validation failed with ${errors.length} problem(s):\n`);
  for (const m of errors) console.error(`  - ${m}`);
  process.exit(1);
}
console.log(`OK: ${entries.length} entries across ${catIds.length} categories.`);

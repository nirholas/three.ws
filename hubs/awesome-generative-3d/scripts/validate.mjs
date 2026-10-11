#!/usr/bin/env node
// Dependency-free validator for data/entries.json. Exit 1 with readable messages on any problem.
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
if (!Array.isArray(entries)) { console.error('entries.json must be an array'); process.exit(1); }
if (!Array.isArray(categories)) { console.error('categories.json must be an array'); process.exit(1); }

const BANNED = new RegExp('[' + String.fromCharCode(0x2014, 0x2013) + ']');
const STATUSES = ['active', 'early', 'archived'];
const FIELDS = ['id', 'name', 'url', 'repo', 'category', 'chain', 'description', 'status', 'license', 'added'];
const catIds = new Set();
for (const c of categories) {
  for (const k of ['id', 'title', 'blurb']) if (typeof c[k] !== 'string' || !c[k]) err(`categories.json: category ${JSON.stringify(c.id)} missing "${k}"`);
  if (catIds.has(c.id)) err(`categories.json: duplicate category id "${c.id}"`);
  catIds.add(c.id);
  if (BANNED.test(JSON.stringify(c))) err(`categories.json: "${c.id}" contains an em-dash or en-dash`);
}

const isUrl = (s) => { try { const u = new URL(s); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; } };
const seen = new Set();
const lastByCat = new Map();
entries.forEach((e, i) => {
  const tag = `entry #${i + 1} (${e && e.id ? e.id : 'no id'})`;
  if (!e || typeof e !== 'object') return err(`${tag}: not an object`);
  for (const f of FIELDS) if (!(f in e)) err(`${tag}: missing field "${f}"`);
  for (const f of Object.keys(e)) if (!FIELDS.includes(f)) err(`${tag}: unknown field "${f}"`);
  if (typeof e.id !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.id)) err(`${tag}: id must be kebab-case`);
  else if (seen.has(e.id)) err(`${tag}: duplicate id`);
  else seen.add(e.id);
  if (typeof e.name !== 'string' || !e.name.trim()) err(`${tag}: name must be a non-empty string`);
  if (typeof e.url !== 'string' || !isUrl(e.url)) err(`${tag}: url is not a valid http(s) URL`);
  if (e.repo !== null && (typeof e.repo !== 'string' || !isUrl(e.repo))) err(`${tag}: repo must be a valid URL or null`);
  if (!catIds.has(e.category)) err(`${tag}: category "${e.category}" is not in categories.json`);
  if (e.chain !== 'none') err(`${tag}: chain must be "none"`);
  if (typeof e.description !== 'string' || !e.description.trim()) err(`${tag}: description must be a non-empty string`);
  else if (e.description.length > 160) err(`${tag}: description is ${e.description.length} chars (max 160)`);
  if (!STATUSES.includes(e.status)) err(`${tag}: status must be one of ${STATUSES.join(', ')}`);
  if (e.license !== null && typeof e.license !== 'string') err(`${tag}: license must be a string or null`);
  if (typeof e.added !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(e.added) || Number.isNaN(Date.parse(e.added))) err(`${tag}: added must be a valid YYYY-MM-DD date`);
  if (BANNED.test(JSON.stringify(e))) err(`${tag}: contains an em-dash or en-dash character`);
  const prev = lastByCat.get(e.category);
  if (prev && typeof e.name === 'string' && prev.localeCompare(e.name, 'en', { sensitivity: 'base' }) > 0) {
    err(`${tag}: "${e.name}" must come before "${prev}" (sort alphabetically by name within category "${e.category}")`);
  }
  if (typeof e.name === 'string') lastByCat.set(e.category, e.name);
});

if (errors.length) {
  console.error(`Validation failed with ${errors.length} problem${errors.length === 1 ? '' : 's'}:\n`);
  for (const m of errors) console.error(`  - ${m}`);
  process.exit(1);
}
console.log(`OK: ${entries.length} entries across ${categories.length} categories.`);

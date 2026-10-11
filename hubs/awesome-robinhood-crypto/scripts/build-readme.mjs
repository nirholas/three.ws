#!/usr/bin/env node
// Regenerates the entries section of README.md between the ENTRIES markers.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (f) => JSON.parse(readFileSync(join(root, 'data', f), 'utf8'));
const entries = readJson('entries.json');
const categories = readJson('categories.json');

const START = '<!-- ENTRIES:START -->';
const END = '<!-- ENTRIES:END -->';
const CHAIN_LABEL = {
  'robinhood-chain': 'Robinhood Chain',
  solana: 'Solana',
  multi: 'Multi-chain',
  none: 'Off-chain API',
};
const STATUS_LABEL = { active: 'Active', early: 'Early', archived: 'Archived' };
const chainLabel = (c) =>
  CHAIN_LABEL[c] || c.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const esc = (s) => s.replace(/\|/g, '\\|');
const anchor = (t) => t.toLowerCase().replace(/[^a-z0-9 -]/g, '').trim().replace(/ /g, '-');

const out = [];
out.push(`_${entries.length} projects across ${categories.length} categories. Generated from [data/entries.json](data/entries.json), do not edit by hand._`, '');
out.push('**Categories**', '');
for (const c of categories) {
  const n = entries.filter((e) => e.category === c.id).length;
  out.push(`- [${c.title}](#${anchor(c.title)}) (${n}): ${c.blurb}`);
}
out.push('');
for (const c of categories) {
  const items = entries.filter((e) => e.category === c.id);
  out.push(`### ${c.title}`, '', c.blurb, '');
  out.push('| Project | Description | Chain | Status | Source |', '| --- | --- | --- | --- | --- |');
  for (const e of items) {
    const src = e.repo ? `[repo](${e.repo})` : 'docs';
    out.push(`| [${esc(e.name)}](${e.url}) | ${esc(e.description)} | ${chainLabel(e.chain)} | ${STATUS_LABEL[e.status]} | ${src} |`);
  }
  out.push('');
}
const block = `${START}\n\n${out.join('\n')}\n${END}`;

const path = join(root, 'README.md');
const readme = readFileSync(path, 'utf8');
const s = readme.indexOf(START);
const e = readme.indexOf(END);
if (s < 0 || e < 0 || e < s) {
  console.error(`README.md must contain ${START} and ${END} markers, in that order.`);
  process.exit(1);
}
const next = readme.slice(0, s) + block + readme.slice(e + END.length);
if (next !== readme) writeFileSync(path, next);
console.log(`README.md ${next !== readme ? 'updated' : 'already current'}: ${entries.length} entries.`);

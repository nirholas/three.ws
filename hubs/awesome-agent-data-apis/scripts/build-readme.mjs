#!/usr/bin/env node
// Regenerates the entry tables in README.md between the ENTRIES markers.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const entries = JSON.parse(readFileSync(join(root, 'data', 'entries.json'), 'utf8'));
const categories = JSON.parse(readFileSync(join(root, 'data', 'categories.json'), 'utf8'));
const readmePath = join(root, 'README.md');
const START = '<!-- ENTRIES:START -->';
const END = '<!-- ENTRIES:END -->';

const CHAIN = { solana: 'Solana', evm: 'EVM', multi: 'Multi-chain', none: 'Chain-agnostic' };
const esc = (s) => s.replace(/\|/g, '\\|');
const anchor = (title) => title.toLowerCase().replace(/[^a-z0-9 -]/g, '').trim().replace(/ /g, '-');

const out = [];
for (const cat of categories) {
  const list = entries.filter((e) => e.category === cat.id);
  if (!list.length) continue;
  out.push(`### ${cat.title}`, '', `_${cat.blurb}_`, '');
  out.push('| Project | Chain | Pricing | Status | Description |', '| --- | --- | --- | --- | --- |');
  for (const e of list) {
    const name = `[${esc(e.name)}](${e.url})${e.repo ? ` ([repo](${e.repo}))` : ''}`;
    out.push(`| ${name} | ${CHAIN[e.chain]} | ${e.pricing} | ${e.status} | ${esc(e.description)} |`);
  }
  out.push('');
}

const index = categories
  .filter((c) => entries.some((e) => e.category === c.id))
  .map((c) => `- [${c.title}](#${anchor(c.title)}) (${entries.filter((e) => e.category === c.id).length})`)
  .join('\n');

let readme = readFileSync(readmePath, 'utf8');
const s = readme.indexOf(START);
const e = readme.indexOf(END);
if (s === -1 || e === -1 || e < s) {
  console.error(`README.md is missing the ${START} / ${END} markers.`);
  process.exit(1);
}
readme = `${readme.slice(0, s + START.length)}\n\n${out.join('\n')}\n${readme.slice(e)}`;
const IS = '<!-- INDEX:START -->';
const IE = '<!-- INDEX:END -->';
const a = readme.indexOf(IS);
const b = readme.indexOf(IE);
if (a !== -1 && b > a) readme = `${readme.slice(0, a + IS.length)}\n${index}\n${readme.slice(b)}`;
writeFileSync(readmePath, readme);
console.log(`README.md updated with ${entries.length} entries.`);

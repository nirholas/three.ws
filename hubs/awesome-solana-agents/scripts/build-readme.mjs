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

const CHAIN = { solana: 'Solana', multi: 'Multi-chain', none: 'Chain-agnostic' };
const STATUS = { active: 'Active', early: 'Early', archived: 'Archived' };
const cell = (s) => s.replace(/\|/g, '\\|');

const parts = [];
for (const c of categories) {
  const list = entries.filter((e) => e.category === c.id);
  parts.push(`### ${c.title}\n\n${c.blurb}\n`);
  if (!list.length) { parts.push('_No entries yet. Be the first to add one._\n'); continue; }
  parts.push('| Project | Description | Chain | Status |', '| --- | --- | --- | --- |');
  for (const e of list) {
    const links = `[${cell(e.name)}](${e.url})${e.repo && e.repo !== e.url ? ` ([repo](${e.repo}))` : ''}`;
    parts.push(`| ${links} | ${cell(e.description)} | ${CHAIN[e.chain]} | ${STATUS[e.status]} |`);
  }
  parts.push('');
}

const readme = readFileSync(readmePath, 'utf8');
const s = readme.indexOf(START);
const e = readme.indexOf(END);
if (s === -1 || e === -1 || e < s) {
  console.error(`README.md must contain ${START} and ${END} markers.`);
  process.exit(1);
}
const next = `${readme.slice(0, s + START.length)}\n\n${parts.join('\n')}\n${readme.slice(e)}`;
writeFileSync(readmePath, next);
console.log(`README.md updated: ${entries.length} entries in ${categories.length} categories.`);

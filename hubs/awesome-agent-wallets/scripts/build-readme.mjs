#!/usr/bin/env node
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
const STATUS = { active: 'Active', early: 'Early', archived: 'Archived' };
const esc = (s) => String(s).replace(/\|/g, '\\|');
const anchor = (t) => t.toLowerCase().replace(/[^a-z0-9 -]/g, '').trim().replace(/ /g, '-');

const lines = [`_${entries.length} projects across ${categories.length} categories._`, ''];
for (const c of categories) {
  const list = entries
    .filter((e) => e.category === c.id)
    .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase(), 'en'));
  lines.push(`### ${c.title}`, '', c.blurb, '');
  if (!list.length) {
    lines.push('_No entries yet. Be the first to [add one](CONTRIBUTING.md)._', '');
    continue;
  }
  lines.push('| Project | Chain | Status | Description |', '| --- | --- | --- | --- |');
  for (const e of list) {
    const name = `[${esc(e.name)}](${e.url})`;
    const repo = e.repo && e.repo !== e.url ? ` ([repo](${e.repo}))` : '';
    lines.push(`| ${name}${repo} | ${CHAIN[e.chain]} | ${STATUS[e.status]} | ${esc(e.description)} |`);
  }
  lines.push('');
}
const block = `${START}\n${lines.join('\n').trimEnd()}\n${END}`;

const readme = readFileSync(readmePath, 'utf8');
const s = readme.indexOf(START);
const e = readme.indexOf(END);
if (s === -1 || e === -1 || e < s) {
  console.error(`README.md must contain ${START} and ${END} markers.`);
  process.exit(1);
}
const next = readme.slice(0, s) + block + readme.slice(e + END.length);
if (next !== readme) writeFileSync(readmePath, next);
console.log(`README.md ${next === readme ? 'already up to date' : 'updated'}: ${entries.length} entries.`);

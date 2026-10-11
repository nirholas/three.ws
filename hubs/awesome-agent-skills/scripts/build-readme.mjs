#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (f) => JSON.parse(readFileSync(join(root, 'data', f), 'utf8'));
const entries = load('entries.json');
const categories = load('categories.json');
const START = '<!-- ENTRIES:START -->';
const END = '<!-- ENTRIES:END -->';
const esc = (s) => s.replace(/\|/g, '\\|');

const sections = [];
for (const c of categories) {
  const rows = entries.filter((e) => e.category === c.id);
  if (!rows.length) continue;
  const lines = [`### ${c.title}`, '', c.blurb, '', '| Project | Description | Source | Status |', '| --- | --- | --- | --- |'];
  for (const e of rows) {
    const src = e.repo ? `[repo](${e.repo})` : '-';
    lines.push(`| [${esc(e.name)}](${e.url}) | ${esc(e.description)} | ${src} | ${e.status} |`);
  }
  sections.push(lines.join('\n'));
}
const block = `${START}\n\n${sections.join('\n\n')}\n\n${END}`;

const path = join(root, 'README.md');
const readme = readFileSync(path, 'utf8');
const s = readme.indexOf(START);
const e = readme.indexOf(END);
if (s === -1 || e === -1 || e < s) {
  console.error(`README.md must contain ${START} and ${END} markers.`);
  process.exit(1);
}
writeFileSync(path, readme.slice(0, s) + block + readme.slice(e + END.length));
console.log(`README.md updated: ${entries.length} entries.`);

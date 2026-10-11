#!/usr/bin/env node
// Regenerates the entries section of README.md from data/*.json. No dependencies.
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
const anchor = (t) => t.toLowerCase().replace(/[^a-z0-9 -]/g, '').trim().replace(/ /g, '-');
const badge = { active: 'active', early: 'early', archived: 'archived' };

const parts = [];
for (const c of categories) {
  const rows = entries.filter((e) => e.category === c.id);
  if (!rows.length) continue;
  parts.push(`### ${c.title}\n\n${c.blurb}\n`);
  parts.push('| Project | Description | Repo | Status |\n| --- | --- | --- | --- |');
  for (const e of rows) {
    const repo = e.repo ? `[repo](${e.repo})` : '-';
    parts.push(`| [${esc(e.name)}](${e.url}) | ${esc(e.description)} | ${repo} | ${badge[e.status]} |`);
  }
  parts.push('');
}
const index = categories
  .filter((c) => entries.some((e) => e.category === c.id))
  .map((c) => `- [${c.title}](#${anchor(c.title)}) (${entries.filter((e) => e.category === c.id).length})`)
  .join('\n');

const body = `${START}\n\n**${entries.length} projects** across ${categories.length} categories.\n\n${index}\n\n${parts.join('\n')}\n${END}`;

const path = join(root, 'README.md');
const readme = readFileSync(path, 'utf8');
const s = readme.indexOf(START);
const e = readme.indexOf(END);
if (s === -1 || e === -1 || e < s) {
  console.error(`README.md must contain ${START} and ${END} markers.`);
  process.exit(1);
}
writeFileSync(path, readme.slice(0, s) + body + readme.slice(e + END.length));
console.log(`README.md updated with ${entries.length} entries.`);

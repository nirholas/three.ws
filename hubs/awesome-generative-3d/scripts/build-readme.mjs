#!/usr/bin/env node
// Dependency-free: regenerates the entry tables in README.md from data/*.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readme = join(root, 'README.md');
const entries = JSON.parse(readFileSync(join(root, 'data', 'entries.json'), 'utf8'));
const categories = JSON.parse(readFileSync(join(root, 'data', 'categories.json'), 'utf8'));
const START = '<!-- ENTRIES:START -->';
const END = '<!-- ENTRIES:END -->';

const esc = (s) => String(s).replace(/\|/g, '\\|');
const anchor = (title) => title.toLowerCase().replace(/[^a-z0-9 -]/g, '').trim().replace(/ /g, '-');

const sections = categories.map((c) => {
  const rows = entries.filter((e) => e.category === c.id);
  const lines = [`### ${c.title}`, '', c.blurb, ''];
  if (!rows.length) {
    lines.push('_No entries yet. [Add the first one](CONTRIBUTING.md)._');
  } else {
    lines.push('| Project | Description | Repo | License | Status |', '| --- | --- | --- | --- | --- |');
    for (const e of rows) {
      lines.push(`| [${esc(e.name)}](${e.url}) | ${esc(e.description)} | ${e.repo ? `[GitHub](${e.repo})` : '-'} | ${e.license ? esc(e.license) : '-'} | ${e.status} |`);
    }
  }
  return lines.join('\n');
});

const index = categories.map((c) => `- [${c.title}](#${anchor(c.title)}) (${entries.filter((e) => e.category === c.id).length})`).join('\n');
const block = `${START}\n\n${sections.join('\n\n')}\n\n${END}`;

let text = readFileSync(readme, 'utf8');
const s = text.indexOf(START), e = text.indexOf(END);
if (s === -1 || e === -1 || e < s) {
  console.error(`README.md must contain ${START} and ${END} markers.`);
  process.exit(1);
}
text = text.slice(0, s) + block + text.slice(e + END.length);
const IS = '<!-- INDEX:START -->', IE = '<!-- INDEX:END -->';
const is = text.indexOf(IS), ie = text.indexOf(IE);
if (is !== -1 && ie > is) text = text.slice(0, is) + `${IS}\n${index}\n${IE}` + text.slice(ie + IE.length);
writeFileSync(readme, text);
console.log(`README.md updated: ${entries.length} entries in ${categories.length} categories.`);

#!/usr/bin/env node
// Regenerates the category index and entry tables in README.md between the ENTRIES markers.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const START = '<!-- ENTRIES:START -->';
const END = '<!-- ENTRIES:END -->';

const entries = JSON.parse(readFileSync(join(root, 'data/entries.json'), 'utf8'));
const categories = JSON.parse(readFileSync(join(root, 'data/categories.json'), 'utf8'));

const esc = (s) => String(s).replace(/\|/g, '\\|');
const slug = (t) => t.toLowerCase().replace(/[^a-z0-9 -]/g, '').trim().replace(/ /g, '-');
const STATUS = { active: 'Active', early: 'Early', archived: 'Archived' };

const lines = [START, '', '### Category index', ''];
for (const c of categories) {
	const n = entries.filter((e) => e.category === c.id).length;
	lines.push(`- [${c.title}](#${slug(c.title)}) (${n})`);
}
lines.push('');

for (const c of categories) {
	const rows = entries.filter((e) => e.category === c.id);
	lines.push(`### ${c.title}`, '', c.blurb, '');
	lines.push('| Project | Chain | Status | Description |', '| --- | --- | --- | --- |');
	for (const e of rows) {
		const name = `[${esc(e.name)}](${e.url})${e.repo && e.repo !== e.url ? ` ([repo](${e.repo}))` : ''}`;
		lines.push(`| ${name} | ${e.chain} | ${STATUS[e.status] || e.status} | ${esc(e.description)} |`);
	}
	lines.push('');
}
lines.push(`_${entries.length} projects across ${categories.length} categories. This section is generated from \`data/entries.json\` by \`npm run build\`; edit the JSON, not the tables._`, '', END);

const readmePath = join(root, 'README.md');
const readme = readFileSync(readmePath, 'utf8');
const s = readme.indexOf(START);
const e = readme.indexOf(END);
if (s === -1 || e === -1 || e < s) {
	console.error(`README.md must contain ${START} and ${END} markers, in that order.`);
	process.exit(1);
}
const next = readme.slice(0, s) + lines.join('\n') + readme.slice(e + END.length);
if (next !== readme) writeFileSync(readmePath, next);
console.log(`README.md ${next === readme ? 'already up to date' : 'updated'}: ${entries.length} entries.`);

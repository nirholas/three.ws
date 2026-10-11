#!/usr/bin/env node
// Regenerates the category index and entry tables in README.md between the marker comments.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readmePath = path.join(root, 'README.md');
const entries = JSON.parse(fs.readFileSync(path.join(root, 'data/entries.json'), 'utf8'));
const categories = JSON.parse(fs.readFileSync(path.join(root, 'data/categories.json'), 'utf8'));

const START = '<!-- ENTRIES:START -->';
const END = '<!-- ENTRIES:END -->';
const esc = (s) => s.replace(/\|/g, '\\|');
const label = { active: 'Active', early: 'Early', archived: 'Archived' };

const parts = [];
for (const c of categories) {
	const list = entries
		.filter((e) => e.category === c.id)
		.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
	parts.push(`### ${c.title}\n\n${c.blurb}\n`);
	if (!list.length) {
		parts.push('_No entries yet. Add the first one with a pull request._\n');
		continue;
	}
	const rows = ['| Project | Description | Repo | Chain | Status |', '| --- | --- | --- | --- | --- |'];
	for (const e of list) {
		rows.push(
			`| [${esc(e.name)}](${e.url}) | ${esc(e.description)} | ${e.repo ? `[repo](${e.repo})` : ''} | ${e.chain === 'none' ? '' : e.chain} | ${label[e.status]} |`,
		);
	}
	parts.push(rows.join('\n') + '\n');
}
const block = `${START}\n\n${parts.join('\n')}\n${END}`;

const readme = fs.readFileSync(readmePath, 'utf8');
const s = readme.indexOf(START);
const e = readme.indexOf(END);
if (s === -1 || e === -1 || e < s) {
	console.error(`README.md is missing the ${START} ... ${END} markers.`);
	process.exit(1);
}
let next = readme.slice(0, s) + block + readme.slice(e + END.length);

const idxStart = '<!-- INDEX:START -->';
const idxEnd = '<!-- INDEX:END -->';
const is = next.indexOf(idxStart);
const ie = next.indexOf(idxEnd);
if (is !== -1 && ie > is) {
	const anchor = (t) => t.toLowerCase().replace(/[^a-z0-9 -]/g, '').trim().replace(/ /g, '-');
	const lines = categories.map((c) => `- [${c.title}](#${anchor(c.title)}) (${entries.filter((x) => x.category === c.id).length})`);
	next = next.slice(0, is) + `${idxStart}\n${lines.join('\n')}\n${idxEnd}` + next.slice(ie + idxEnd.length);
}
fs.writeFileSync(readmePath, next);
console.log(`README.md updated: ${entries.length} entries, ${categories.length} categories.`);

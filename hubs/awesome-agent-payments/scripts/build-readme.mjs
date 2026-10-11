#!/usr/bin/env node
// Regenerates the entries section and category index of README.md from data/*.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readmePath = join(root, 'README.md');
const entries = JSON.parse(readFileSync(join(root, 'data/entries.json'), 'utf8'));
const categories = JSON.parse(readFileSync(join(root, 'data/categories.json'), 'utf8'));

const esc = (s) => s.replace(/\|/g, '\\|');
const statusLabel = { active: 'active', early: 'early', archived: 'archived' };

const index = categories
	.map((c) => {
		const n = entries.filter((e) => e.category === c.id).length;
		return `- [${c.title}](#${c.id}) (${n}): ${c.blurb}`;
	})
	.join('\n');

const sections = categories.map((c) => {
	const rows = entries
		.filter((e) => e.category === c.id)
		.map((e) => {
			const repo = e.repo && e.repo !== e.url ? `[repo](${e.repo})` : '';
			return `| [${esc(e.name)}](${e.url}) | ${e.chain} | ${statusLabel[e.status]} | ${esc(e.description)} | ${repo} |`;
		});
	if (!rows.length) return '';
	return [`<a id="${c.id}"></a>`, `### ${c.title}`, '', c.blurb, '', '| Project | Chain | Status | What it does | Source |', '| --- | --- | --- | --- | --- |', ...rows, ''].join('\n');
});

const block = ['<!-- ENTRIES:START -->', '', `${entries.length} projects. Generated from [data/entries.json](data/entries.json), do not edit by hand.`, '', index, '', ...sections.filter(Boolean), '<!-- ENTRIES:END -->'].join('\n');

const readme = readFileSync(readmePath, 'utf8');
const re = /<!-- ENTRIES:START -->[\s\S]*?<!-- ENTRIES:END -->/;
if (!re.test(readme)) {
	console.error('README.md is missing the <!-- ENTRIES:START --> / <!-- ENTRIES:END --> markers.');
	process.exit(1);
}
writeFileSync(readmePath, readme.replace(re, () => block));
console.log(`README.md updated: ${entries.length} entries in ${categories.length} categories.`);

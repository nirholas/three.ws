#!/usr/bin/env node
// Regenerates the entries section of README.md from data/*.json.
// Usage: node scripts/build-readme.mjs [--check]
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (f) => JSON.parse(readFileSync(join(root, 'data', f), 'utf8'));
const entries = load('entries.json');
const categories = load('categories.json');

const START = '<!-- ENTRIES:START -->';
const END = '<!-- ENTRIES:END -->';
const esc = (s) => String(s).replace(/\|/g, '\\|');
const slug = (t) =>
	t
		.toLowerCase()
		.replace(/[^a-z0-9 -]/g, '')
		.trim()
		.replace(/ /g, '-');
const key = (e) => e.name.toLowerCase();

const out = [];
for (const cat of categories) {
	const list = entries.filter((e) => e.category === cat.id).sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
	out.push(`### ${cat.title}`, '', cat.blurb, '');
	if (!list.length) {
		out.push('No projects listed yet. [Add the first one](CONTRIBUTING.md).', '');
		continue;
	}
	out.push('| Project | Description | Source | Status |', '| --- | --- | --- | --- |');
	for (const e of list) {
		const src = e.repo ? `[repo](${e.repo})` : '';
		out.push(`| [${esc(e.name)}](${e.url}) | ${esc(e.description)} | ${src} | ${e.status} |`);
	}
	out.push('');
}
const block = `${START}\n\n${out.join('\n').trimEnd()}\n\n${END}`;

const index = categories
	.map((c) => `- [${c.title}](#${slug(c.title)}) (${entries.filter((e) => e.category === c.id).length})`)
	.join('\n');
const IS = '<!-- INDEX:START -->';
const IE = '<!-- INDEX:END -->';

const path = join(root, 'README.md');
let readme = readFileSync(path, 'utf8');
const replaceBlock = (text, s, e, body) => {
	const a = text.indexOf(s);
	const b = text.indexOf(e);
	if (a === -1 || b === -1 || b < a) {
		console.error(`README.md is missing the ${s} ... ${e} markers`);
		process.exit(1);
	}
	return text.slice(0, a) + body + text.slice(b + e.length);
};
const next = replaceBlock(replaceBlock(readme, START, END, block), IS, IE, `${IS}\n\n${index}\n\n${IE}`);

if (process.argv.includes('--check')) {
	if (next !== readme) {
		console.error('README.md is out of date. Run: node scripts/build-readme.mjs');
		process.exit(1);
	}
	console.log('README.md is up to date.');
} else {
	writeFileSync(path, next);
	console.log(`README.md updated: ${entries.length} entries in ${categories.length} categories.`);
}

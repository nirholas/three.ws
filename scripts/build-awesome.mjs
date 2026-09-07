#!/usr/bin/env node
/**
 * Generate the Awesome 3D Agents list from data/awesome.json.
 *
 * One source, two outputs, so the GitHub-facing list and the browsable page on
 * three.ws can never disagree:
 *   awesome/README.md    the list, in the awesome-list format people expect
 *   public/awesome.json  the same data plus counts and a tag index, for /awesome
 *
 *   node scripts/build-awesome.mjs           write both
 *   node scripts/build-awesome.mjs --check   fail if either is out of date
 *
 * The --check mode runs in `npm run gate`, so an edit to the data that never
 * got built cannot ship a stale README.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const check = process.argv.includes('--check');

const list = JSON.parse(readFileSync(path.join(root, 'data/awesome.json'), 'utf8'));

const problems = [];
const slugs = new Set();
const urls = new Map();
for (const section of list.sections) {
	if (slugs.has(section.id)) problems.push(`duplicate section id: ${section.id}`);
	slugs.add(section.id);
	if (!section.items.length) problems.push(`empty section: ${section.id}`);
	for (const item of section.items) {
		for (const field of ['name', 'url', 'description']) {
			if (!item[field]) problems.push(`${section.id}/${item.name ?? '?'} is missing ${field}`);
		}
		if (item.url && !/^https?:\/\//.test(item.url)) problems.push(`${item.name}: url must be absolute`);
		// The awesome format renders one sentence per entry. A description that
		// runs past this reads as a paragraph in a list and breaks the scan.
		if (item.description && item.description.length > 260) {
			problems.push(`${item.name}: description is ${item.description.length} chars, keep it under 260`);
		}
		if (/[\u2014\u2013]/.test(`${item.name}${item.description}`)) {
			problems.push(`${item.name}: uses a dash character that is banned in this repo`);
		}
		const key = item.url?.replace(/\/+$/, '').toLowerCase();
		if (key && urls.has(key)) problems.push(`${item.name} repeats the url of ${urls.get(key)}`);
		else if (key) urls.set(key, item.name);
	}
}
if (problems.length) {
	for (const p of problems) console.error(`[build-awesome] ${p}`);
	process.exit(1);
}

const total = list.sections.reduce((n, s) => n + s.items.length, 0);

// ── awesome/README.md ────────────────────────────────────────────────────────
const anchor = (title) =>
	title
		.toLowerCase()
		.replace(/[^\w\s-]/g, '')
		.trim()
		.replace(/\s+/g, '-');

const md = [];
md.push(`# ${list.title}`);
md.push('');
md.push('[![Awesome](https://awesome.re/badge-flat2.svg)](https://awesome.re)');
md.push('');
md.push(`> ${list.tagline}`);
md.push('');
md.push(list.intro);
md.push('');
md.push(
	`${total} entries across ${list.sections.length} sections. Browsable, searchable, and filterable at [${list.page.replace(/^https?:\/\//, '')}](${list.page}). Every link is checked with \`npm run awesome:links\`.`,
);
md.push('');
md.push('## Contents');
md.push('');
for (const section of list.sections) {
	md.push(`- [${section.title}](#${anchor(section.title)}) (${section.items.length})`);
}
md.push('');
for (const section of list.sections) {
	md.push(`## ${section.title}`);
	md.push('');
	md.push(section.description);
	md.push('');
	for (const item of section.items) {
		md.push(`- [${item.name}](${item.url}) - ${item.description}`);
	}
	md.push('');
}
md.push('## Contributing');
md.push('');
md.push(
	'Additions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first: entries live in [`data/awesome.json`](../data/awesome.json), not in this file, which is generated.',
);
md.push('');
md.push('## License');
md.push('');
md.push(
	'The list is published under [Apache-2.0](../LICENSE) with the rest of this repository. Each linked project carries its own license.',
);
md.push('');
const readme = md.join('\n');

// ── public/awesome.json ──────────────────────────────────────────────────────
const tagCounts = new Map();
for (const section of list.sections) {
	for (const item of section.items) {
		for (const tag of item.tags ?? []) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
	}
}
const payload = {
	title: list.title,
	tagline: list.tagline,
	intro: list.intro,
	repo: `${list.repo}/tree/main/awesome`,
	markdown: `${list.repo}/blob/main/awesome/README.md`,
	counts: { items: total, sections: list.sections.length, tags: tagCounts.size },
	// Tags the page offers as filter chips, most common first. A tag used once
	// is noise in a filter bar, so it stays searchable but is not offered.
	tags: [...tagCounts.entries()]
		.filter(([, n]) => n > 1)
		.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		.map(([id, count]) => ({ id, count })),
	sections: list.sections.map((s) => ({
		id: s.id,
		title: s.title,
		description: s.description,
		items: s.items.map((i) => ({ ...i, tags: i.tags ?? [] })),
	})),
};
const json = `${JSON.stringify(payload, null, '\t')}\n`;

const outputs = [
	{ file: path.join(root, 'awesome/README.md'), content: readme },
	{ file: path.join(root, 'public/awesome.json'), content: json },
];

if (check) {
	const stale = outputs.filter((o) => {
		try {
			return readFileSync(o.file, 'utf8') !== o.content;
		} catch {
			return true;
		}
	});
	if (stale.length) {
		for (const o of stale) console.error(`[build-awesome] out of date: ${path.relative(root, o.file)}`);
		console.error('[build-awesome] run `npm run build:awesome`');
		process.exit(1);
	}
	console.log(`[build-awesome] up to date (${total} entries)`);
} else {
	for (const o of outputs) {
		mkdirSync(path.dirname(o.file), { recursive: true });
		writeFileSync(o.file, o.content);
		console.log(`[build-awesome] wrote ${path.relative(root, o.file)}`);
	}
	console.log(`[build-awesome] ${total} entries across ${list.sections.length} sections`);
}

#!/usr/bin/env node
/**
 * Generate the Awesome 3D Agents list from data/awesome.json.
 *
 * One source, two outputs, so the GitHub-facing list and the browsable page on
 * three.ws can never disagree:
 *   awesome/README.md    the list, in the awesome-list format people expect
 *   public/awesome.json  the same data plus counts and a tag index, for /awesome
 *
 *   node scripts/build-awesome.mjs               write both
 *   node scripts/build-awesome.mjs --check       fail if either is out of date
 *   node scripts/build-awesome.mjs --standalone  emit a publishable mirror repo
 *
 * The --standalone mode exists because awesome-lint's awesome-github rule is
 * satisfied by repository topics, not by file content: a list living in a
 * subdirectory of a product repo can never pass it, and so can never be
 * submitted to the awesome.re index. It writes a self-describing mirror repo
 * (readme, contributing, code of conduct, license) to --out, defaulting to a
 * sibling of this checkout, and prints the commands to publish it. Nothing in
 * that directory is committed here.
 *
 * The --check mode runs in `npm run gate`, so an edit to the data that never
 * got built cannot ship a stale README.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const check = argv.includes('--check');
const standalone = argv.includes('--standalone');
const outFlag = (() => {
	const i = argv.indexOf('--out');
	return i === -1 ? null : argv[i + 1];
})();

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
			if (!item[field])
				problems.push(`${section.id}/${item.name ?? '?'} is missing ${field}`);
		}
		if (item.url && !/^https?:\/\//.test(item.url))
			problems.push(`${item.name}: url must be absolute`);
		// The awesome format renders one sentence per entry. A description that
		// runs past this reads as a paragraph in a list and breaks the scan.
		if (item.description && item.description.length > 260) {
			problems.push(
				`${item.name}: description is ${item.description.length} chars, keep it under 260`,
			);
		}
		if (/[\u2014\u2013]/.test(`${item.name}${item.description}`)) {
			problems.push(`${item.name}: uses a dash character that is banned in this repo`);
		}
		// awesome-lint's awesome-list-item rule, enforced here so a contribution
		// cannot break eligibility for the awesome.re index without failing first.
		if (item.description && !/^[A-Z0-9"'`]/.test(item.description)) {
			problems.push(
				`${item.name}: description must start with a capital, so "${item.description.slice(0, 24)}..." needs rephrasing`,
			);
		}
		if (item.description && !/[.!?]$/.test(item.description)) {
			problems.push(`${item.name}: description must end with a period`);
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

// `mirror` retargets the two relative links that only resolve inside this
// repository, so the standalone copy has no dead links.
function renderReadme({ mirror }) {
	const md = [];
	// awesome-lint requires the badge on the heading line itself, and the exact
	// badge.svg asset. Anything else fails remark-lint:awesome-badge.
	md.push(`# ${list.title} [![Awesome](https://awesome.re/badge.svg)](https://awesome.re)`);
	md.push('');
	md.push(`> ${list.tagline}`);
	md.push('');
	md.push(list.intro);
	md.push('');
	md.push(
		`${total} entries across ${list.sections.length} sections. Browsable, searchable, and filterable at [${list.page.replace(/^https?:\/\//, '')}](${list.page}). Every link is fetched and verified before it ships.`,
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
		`Additions are welcome. Read [CONTRIBUTING.md](${mirror ? 'contributing.md' : 'CONTRIBUTING.md'}) first: entries live in [\`data/awesome.json\`](${mirror ? `${list.repo}/blob/main/data/awesome.json` : '../data/awesome.json'}), not in this file, which is generated. The list is published under Apache-2.0, and each linked project carries its own license.`,
	);
	md.push('');
	return md.join('\n');
}

const readme = renderReadme({ mirror: false });

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

// ── standalone mirror repo ───────────────────────────────────────────────────
// awesome-lint's awesome-github rule reads the repository's topics, so a list
// inside a product repo fails it no matter how the file is written. This emits
// the publishable mirror: a directory that is already a valid awesome list, so
// creating the repo is a copy and a push rather than a rewrite.
if (standalone) {
	const out = path.resolve(outFlag ?? path.join(root, '..', list.slug));
	const files = [
		{ name: 'readme.md', content: renderReadme({ mirror: true }) },
		{
			name: 'contributing.md',
			content: [
				'# Contributing',
				'',
				`This repository is a published mirror. \`readme.md\` is generated, so an edit made here is overwritten by the next build.`,
				'',
				'## Add an entry',
				'',
				`Open a pull request against [\`data/awesome.json\`](${list.repo}/blob/main/data/awesome.json) in the source repository. Add an object to the section it belongs in:`,
				'',
				'```json',
				'{',
				'  "name": "glTF-Transform",',
				'  "url": "https://github.com/donmccurdy/glTF-Transform",',
				'  "description": "Read, edit, optimise, and validate glTF from Node or the CLI.",',
				'  "tags": ["oss", "js", "cli"]',
				'}',
				'```',
				'',
				'## What gets in',
				'',
				'The bar is "a working engineer would be glad someone showed them this".',
				'',
				'- **It has to be usable now.** A repo with no release, no docs, and no commits in two years is a bookmark, not a recommendation.',
				'- **It has to earn its section.** If a new entry beats an existing one at the same job, say so in the description, or replace the old one.',
				'- **One sentence, under 260 characters**, starting with a capital and ending with a period. The build fails otherwise, and so does `awesome-lint`.',
				'- **No em-dash (U+2014) or en-dash (U+2013).** Use a period, a comma, a colon, or parentheses. A plain hyphen is fine.',
				'- **No marketing copy.** "Blazing fast next-generation platform" tells a reader nothing. "Single image to 3D in under a second on one GPU" does.',
				'- **Working links only.** Every url is fetched and classified as ok, moved, bot-filtered, or broken before a change ships. A broken url fails the run.',
				'',
				'## Code of conduct',
				'',
				'By participating you agree to the [code of conduct](code-of-conduct.md).',
				'',
			].join('\n'),
		},
	];

	// The code of conduct and license are the repository's own, copied rather
	// than reworded so the mirror cannot drift from the terms it inherits.
	for (const [source, name] of [
		['CODE_OF_CONDUCT.md', 'code-of-conduct.md'],
		['LICENSE', 'license'],
	]) {
		files.push({ name, content: readFileSync(path.join(root, source), 'utf8') });
	}

	mkdirSync(out, { recursive: true });
	for (const file of files) {
		writeFileSync(path.join(out, file.name), file.content);
		console.log(`[build-awesome] wrote ${path.join(out, file.name)}`);
	}
	console.log(`\n[build-awesome] mirror ready: ${total} entries, ${files.length} files.`);
	console.log('Publish it with:\n');
	console.log(`  cd ${out}`);
	console.log('  git init -b main && git add -A');
	console.log(`  git commit -m "${list.title}: ${total} curated entries"`);
	console.log(`  gh repo create ${list.slug} --public --source=. --push \\`);
	console.log(`    --description ${JSON.stringify(list.tagline)}`);
	console.log(`  gh repo edit --add-topic awesome --add-topic awesome-list \\`);
	console.log('    --add-topic 3d --add-topic ai-agents --add-topic avatars');
	console.log('\nThe two topics are what awesome-lint checks; without them the list');
	console.log('cannot be submitted to the awesome.re index.');
	process.exit(0);
}

if (check) {
	const stale = outputs.filter((o) => {
		try {
			return readFileSync(o.file, 'utf8') !== o.content;
		} catch {
			return true;
		}
	});
	if (stale.length) {
		for (const o of stale)
			console.error(`[build-awesome] out of date: ${path.relative(root, o.file)}`);
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

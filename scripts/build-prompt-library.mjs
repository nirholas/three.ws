#!/usr/bin/env node
/**
 * Build the public prompt library from data/prompt-library.json.
 *
 * One source, two published outputs, so the page a human browses and the file
 * an agent fetches can never disagree:
 *   public/prompts.json  the library plus counts and indexes, for /prompts
 *   public/prompts.txt   the same prompts as plain text, for `curl` and for
 *                        pasting a whole category into an assistant at once
 *
 *   node scripts/build-prompt-library.mjs           write both
 *   node scripts/build-prompt-library.mjs --check   fail if either is stale
 *
 * The --check mode runs in `npm run gate`, so an edit to the data that never
 * got built cannot ship a stale library. Validation runs in both modes: a
 * malformed entry fails the build rather than rendering a broken card.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

const library = JSON.parse(read('data/prompt-library.json'));
const pages = JSON.parse(read('data/pages.json'));

const routes = new Set();
for (const section of pages.sections) for (const page of section.pages) routes.add(page.path);

const problems = [];
const fail = (where, message) => problems.push(`${where}: ${message}`);

const setupIds = new Set(library.setups.map((s) => s.id));
const categoryIds = new Set(library.categories.map((c) => c.id));
const seen = new Set();

// The house style bans both dash glyphs everywhere we write, and a prompt is
// copy that ends up in someone else's editor, so it is held to the same rule.
const BANNED_GLYPHS = /[\u2014\u2013]/;

for (const entry of library.prompts) {
	const at = `prompt "${entry.id || '(no id)'}"`;
	if (!entry.id || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(entry.id)) fail(at, 'id must be kebab-case');
	if (seen.has(entry.id)) fail(at, 'duplicate id');
	seen.add(entry.id);
	if (!entry.title) fail(at, 'missing title');
	if (!entry.summary) fail(at, 'missing summary');
	if (!entry.returns) fail(at, 'missing returns (what the user gets back)');
	if (!categoryIds.has(entry.category)) fail(at, `unknown category "${entry.category}"`);
	if (!setupIds.has(entry.setup)) fail(at, `unknown setup "${entry.setup}"`);
	if (!Array.isArray(entry.prompt) || entry.prompt.length === 0) fail(at, 'prompt must be a non-empty array of lines');
	if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.added || '')) fail(at, 'added must be YYYY-MM-DD');

	const body = Array.isArray(entry.prompt) ? entry.prompt.join('\n') : '';
	if (BANNED_GLYPHS.test(body + entry.title + entry.summary + entry.returns)) {
		fail(at, 'contains an em-dash or en-dash');
	}
	const open = (body.match(/</g) || []).length;
	const close = (body.match(/>/g) || []).length;
	if (open !== close) fail(at, 'unbalanced <placeholder> brackets');

	for (const link of entry.links || []) {
		if (!link.label || !link.href) fail(at, 'a link is missing label or href');
		if (link.href.startsWith('/')) {
			const known = routes.has(link.href) || link.href.startsWith('/api/');
			if (!known) fail(at, `link ${link.href} is not a route declared in data/pages.json`);
		} else if (!link.href.startsWith('https://')) {
			fail(at, `link ${link.href} must be an internal path or an https URL`);
		}
	}
}

for (const category of library.categories) {
	if (!library.prompts.some((p) => p.category === category.id)) {
		fail(`category "${category.id}"`, 'has no prompts');
	}
}

if (problems.length) {
	console.error('data/prompt-library.json is invalid:\n  ' + problems.join('\n  '));
	process.exit(1);
}

const prompts = library.prompts.map((entry) => ({
	...entry,
	prompt: entry.prompt.join('\n'),
	lines: entry.prompt.length,
}));

const countBy = (key) =>
	Object.fromEntries(
		[...new Set(prompts.map((p) => p[key]))].map((value) => [
			value,
			prompts.filter((p) => p[key] === value).length,
		]),
	);

const tags = {};
for (const entry of prompts) for (const tag of entry.tags || []) tags[tag] = (tags[tag] || 0) + 1;

const json = {
	version: library.version,
	title: library.title,
	tagline: library.tagline,
	intro: library.intro,
	count: prompts.length,
	categories: library.categories.map((category) => ({
		...category,
		count: prompts.filter((p) => p.category === category.id).length,
	})),
	setups: library.setups.map((setup) => ({
		...setup,
		count: prompts.filter((p) => p.setup === setup.id).length,
	})),
	byCategory: countBy('category'),
	bySetup: countBy('setup'),
	tags: Object.fromEntries(Object.entries(tags).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))),
	prompts,
};

const setupById = new Map(library.setups.map((s) => [s.id, s]));
const text = [];
text.push(library.title);
text.push('='.repeat(library.title.length));
text.push('');
text.push(library.tagline);
text.push('');
text.push(library.intro);
text.push('');
text.push(`${prompts.length} prompts. Browse them at https://three.ws/prompts, or fetch this file again any time.`);
text.push('');
for (const category of library.categories) {
	const inCategory = prompts.filter((p) => p.category === category.id);
	text.push('');
	text.push(`## ${category.label}`);
	text.push(category.blurb);
	text.push('');
	for (const entry of inCategory) {
		const setup = setupById.get(entry.setup);
		text.push(`### ${entry.title}`);
		text.push(entry.summary);
		text.push(`Setup: ${setup.label}. ${setup.blurb}`);
		for (const step of setup.how || []) text.push(`  ${step}`);
		if (entry.caution) text.push(`Caution: ${entry.caution}`);
		text.push('');
		text.push('--- prompt ---');
		text.push(entry.prompt);
		text.push('--- end prompt ---');
		text.push('');
		text.push(`You get: ${entry.returns}`);
		if ((entry.links || []).length) {
			text.push(
				'More: ' +
					entry.links
						.map((l) => `${l.label} ${l.href.startsWith('/') ? 'https://three.ws' + l.href : l.href}`)
						.join(' | '),
			);
		}
		text.push('');
	}
}
text.push('');
text.push('Every prompt above is copy-paste ready. Replace anything in <angle brackets>.');
text.push('');

const outputs = [
	['public/prompts.json', JSON.stringify(json, null, '\t') + '\n'],
	['public/prompts.txt', text.join('\n')],
];

if (process.argv.includes('--check')) {
	const stale = outputs.filter(([rel, body]) => {
		try {
			return read(rel) !== body;
		} catch {
			return true;
		}
	});
	if (stale.length) {
		console.error(
			`Prompt library outputs are stale: ${stale.map(([rel]) => rel).join(', ')}\n` +
				'Run `npm run build:prompt-library`.',
		);
		process.exit(1);
	}
	console.log(`prompt library: ${prompts.length} prompts, outputs up to date`);
} else {
	for (const [rel, body] of outputs) writeFileSync(path.join(root, rel), body);
	console.log(`prompt library: wrote ${outputs.map(([rel]) => rel).join(' and ')} (${prompts.length} prompts)`);
}

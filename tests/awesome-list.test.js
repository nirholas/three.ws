// The Awesome 3D Agents list (data/awesome.json and its generated outputs).
//
// The list is published in two places at once: awesome/README.md, which people
// read and fork on GitHub, and public/awesome.json, which /awesome renders. A
// generator bug that desynchronises them is invisible until someone notices the
// page and the README disagree, so the invariants that keep both honest are
// pinned here. `npm run check:awesome` already fails the build when the
// committed outputs drift from the source; these tests cover the curation rules
// a regenerate would happily preserve.
//
// Link liveness is NOT tested here on purpose: it needs the network and a
// hundred third-party hosts. That check is `npm run awesome:links`.

import { readFileSync } from 'node:fs';

import { describe, it, expect } from 'vitest';

const source = JSON.parse(readFileSync('data/awesome.json', 'utf8'));
const published = JSON.parse(readFileSync('public/awesome.json', 'utf8'));
const readme = readFileSync('awesome/README.md', 'utf8');

const allItems = source.sections.flatMap((s) => s.items);

describe('Awesome 3D Agents source', () => {
	it('gives every entry a name, an absolute url, and a description', () => {
		for (const item of allItems) {
			expect(item.name, 'entry name').toBeTruthy();
			expect(item.description, `${item.name} description`).toBeTruthy();
			expect(item.url, `${item.name} url`).toMatch(/^https?:\/\//);
		}
	});

	it('links each project once, so the list cannot recommend the same thing twice', () => {
		const seen = new Map();
		for (const item of allItems) {
			const key = item.url.replace(/\/+$/, '').toLowerCase();
			expect(seen.get(key), `${item.name} repeats ${seen.get(key)}`).toBeUndefined();
			seen.set(key, item.name);
		}
	});

	it('keeps descriptions to the one-sentence length the awesome format expects', () => {
		for (const item of allItems) {
			expect(item.description.length, `${item.name} description length`).toBeLessThanOrEqual(260);
		}
	});

	it('honours the repository-wide ban on em-dash and en-dash characters', () => {
		const banned = /[\u2014\u2013]/;
		for (const item of allItems) {
			expect(banned.test(item.name), `${item.name} name`).toBe(false);
			expect(banned.test(item.description), `${item.name} description`).toBe(false);
		}
		for (const section of source.sections) {
			expect(banned.test(section.title + section.description), `${section.id} section`).toBe(false);
		}
		expect(banned.test(readme), 'awesome/README.md').toBe(false);
	});

	it('uses a unique, anchor-safe id for every section', () => {
		const ids = source.sections.map((s) => s.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
	});

	it('never ships an empty section', () => {
		for (const section of source.sections) {
			expect(section.items.length, `${section.id} is empty`).toBeGreaterThan(0);
		}
	});
});

describe('Awesome 3D Agents generated outputs', () => {
	it('publishes exactly what the source holds', () => {
		expect(published.counts.items).toBe(allItems.length);
		expect(published.counts.sections).toBe(source.sections.length);
		expect(published.sections.map((s) => s.id)).toEqual(source.sections.map((s) => s.id));
	});

	it('gives every published entry a tags array, so the page can filter without a guard', () => {
		for (const section of published.sections) {
			for (const item of section.items) expect(Array.isArray(item.tags)).toBe(true);
		}
	});

	it('offers only tags that appear more than once as filter chips', () => {
		const counts = new Map();
		for (const item of allItems) {
			for (const tag of item.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1);
		}
		for (const { id, count } of published.tags) {
			expect(counts.get(id), `${id} count`).toBe(count);
			expect(count, `${id} is offered as a chip`).toBeGreaterThan(1);
		}
		// Most common first, so the filter bar leads with the useful facets.
		const ordered = [...published.tags].sort((a, b) => b.count - a.count || a.id.localeCompare(b.id));
		expect(published.tags).toEqual(ordered);
	});

	it('renders every entry into the README in the awesome-list format', () => {
		for (const item of allItems) {
			expect(readme, `${item.name} in README`).toContain(`- [${item.name}](${item.url}) - `);
		}
		expect(readme).toContain('[![Awesome](https://awesome.re/badge-flat2.svg)](https://awesome.re)');
	});

	it('lists every section in the README contents', () => {
		for (const section of source.sections) {
			expect(readme, `${section.title} in contents`).toContain(`## ${section.title}`);
		}
	});
});

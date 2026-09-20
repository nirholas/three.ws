import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(root, rel), 'utf8');

const library = JSON.parse(read('data/prompt-library.json'));
const published = JSON.parse(read('public/prompts.json'));
const text = read('public/prompts.txt');
const pages = JSON.parse(read('data/pages.json'));

const routes = new Set();
for (const section of pages.sections) for (const page of section.pages) routes.add(page.path);

describe('prompt library data', () => {
	it('has a prompt in every category and a category for every prompt', () => {
		const categories = new Set(library.categories.map((c) => c.id));
		for (const entry of library.prompts) expect(categories).toContain(entry.category);
		for (const category of library.categories) {
			expect(library.prompts.some((p) => p.category === category.id)).toBe(true);
		}
	});

	it('names a setup that the page can explain', () => {
		const setups = new Set(library.setups.map((s) => s.id));
		for (const entry of library.prompts) expect(setups).toContain(entry.setup);
	});

	it('gives every prompt a unique kebab-case id usable as a deep link', () => {
		const ids = library.prompts.map((p) => p.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
	});

	it('closes every <placeholder> it opens, so nobody pastes a half-written slot', () => {
		for (const entry of library.prompts) {
			const body = entry.prompt.join('\n');
			expect((body.match(/</g) || []).length).toBe((body.match(/>/g) || []).length);
		}
	});

	it('links only to routes the site actually declares', () => {
		for (const entry of library.prompts) {
			for (const link of entry.links || []) {
				if (!link.href.startsWith('/')) {
					expect(link.href.startsWith('https://')).toBe(true);
					continue;
				}
				expect(routes.has(link.href) || link.href.startsWith('/api/')).toBe(true);
			}
		}
	});

	it('keeps the stop-for-confirmation line on every prompt that can spend money', () => {
		const spenders = library.prompts.filter((p) => p.setup === 'wallet');
		expect(spenders.length).toBeGreaterThan(0);
		for (const entry of spenders) {
			const body = entry.prompt.join('\n').toLowerCase();
			const guarded =
				body.includes('stop and wait') ||
				body.includes('do not pay') ||
				body.includes('do not move any funds') ||
				body.includes('until i have confirmed');
			expect(guarded, `${entry.id} may spend without asking`).toBe(true);
		}
	});

	it('writes prompts as an array of lines so a diff shows the line that changed', () => {
		for (const entry of library.prompts) {
			expect(Array.isArray(entry.prompt)).toBe(true);
			expect(entry.prompt.length).toBeGreaterThan(0);
		}
	});

	it('avoids the banned dash glyphs in copy that lands in someone else editor', () => {
		for (const entry of library.prompts) {
			const copy = [entry.title, entry.summary, entry.returns, entry.prompt.join('\n')].join('\n');
			expect(copy).not.toMatch(/[\u2014\u2013]/);
		}
	});
});

describe('published prompt library', () => {
	it('carries every source prompt with the body joined into one string', () => {
		expect(published.count).toBe(library.prompts.length);
		expect(published.prompts).toHaveLength(library.prompts.length);
		for (const entry of library.prompts) {
			const shipped = published.prompts.find((p) => p.id === entry.id);
			expect(shipped).toBeTruthy();
			expect(shipped.prompt).toBe(entry.prompt.join('\n'));
		}
	});

	it('counts each category and setup so the filter chips can show a number', () => {
		for (const category of published.categories) {
			expect(category.count).toBe(library.prompts.filter((p) => p.category === category.id).length);
		}
		for (const setup of published.setups) {
			expect(setup.count).toBe(library.prompts.filter((p) => p.setup === setup.id).length);
		}
	});

	it('ships a plain-text copy that holds every prompt', () => {
		for (const entry of library.prompts) {
			expect(text).toContain(entry.title);
			expect(text).toContain(entry.prompt[0]);
		}
	});
});

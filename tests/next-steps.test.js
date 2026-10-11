// The "what next?" strip (public/next-steps.js) must only ever link to pages
// that exist, and must never offer a page as its own next step.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../public/next-steps.js', import.meta.url), 'utf8');
const body = src.match(/var STEPS = (\{[\s\S]*?\n\t\});\n/);
const STEPS = new Function(`return ${body[1]}`)();

const pages = JSON.parse(readFileSync(new URL('../data/pages.json', import.meta.url), 'utf8'));
const known = new Set(pages.sections.flatMap((s) => s.pages.map((p) => p.path)));

describe('next-steps strip', () => {
	it('has an entry to render', () => {
		expect(Object.keys(STEPS).length).toBeGreaterThan(5);
	});

	it('is only keyed on pages that exist', () => {
		for (const path of Object.keys(STEPS)) expect(known.has(path), path).toBe(true);
	});

	it('links only to pages that exist, never to the page itself', () => {
		for (const [path, entry] of Object.entries(STEPS)) {
			expect(entry.steps.length).toBeGreaterThanOrEqual(3);
			for (const step of entry.steps) {
				expect(known.has(step.href), `${path} -> ${step.href}`).toBe(true);
				expect(step.href, `${path} links to itself`).not.toBe(path);
				expect(step.title && step.desc, `${path} -> ${step.href} needs copy`).toBeTruthy();
			}
		}
	});
});

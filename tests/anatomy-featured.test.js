// The featured rocket cutaways on /anatomy: every number a visitor can read
// must be listed in docs/anatomy/rocket-engines-sources.md for that design,
// the specs must normalize cleanly, the tours must teach in the right order,
// and nothing may carry a third party's marks.

import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

import { featuredDesign, featuredList, isFeaturedId } from '../api/_lib/anatomy/featured/index.js';
import { normalizeSpec } from '../src/anatomy/spec.js';

const ENGINE_ID = '85160213-4c15-4b00-ba96-5990b9385249';
const STACK_ID = 'd72da3e9-8aae-47cd-a96c-45ccd33bf1a0';
const SOURCES = readFileSync(new URL('../docs/anatomy/rocket-engines-sources.md', import.meta.url), 'utf8');

// The sources document has one section per design; numbers are checked
// against the section for their own design, not the whole file.
function sourcesSection(heading) {
	const start = SOURCES.indexOf(`## ${heading}`);
	expect(start, `sources doc has a "## ${heading}" section`).toBeGreaterThan(-1);
	const next = SOURCES.indexOf('\n## ', start + 4);
	return SOURCES.slice(start, next === -1 ? undefined : next);
}

const TEXT_KEYS = new Set(['title', 'subtitle', 'summary', 'name', 'description', 'body', 'label', 'caption']);

/** Every string a visitor can read in a spec, with its path. */
function visibleText(value, path = [], out = []) {
	if (typeof value === 'string') {
		if (TEXT_KEYS.has(path.at(-1))) out.push({ path: path.join('.'), text: value });
	} else if (Array.isArray(value)) value.forEach((v, i) => visibleText(v, [...path, i], out));
	else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) visibleText(v, [...path, k], out);
	return out;
}

const numbersIn = (text) => text.match(/\d[\d,]*(?:\.\d+)?/g)?.map((n) => n.replace(/,$/, '')) ?? [];
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mentions = (doc, n) => new RegExp(`(?<![\\d,.])${escape(n)}(?![\\d]|,\\d)`).test(doc);

const designs = [
	{ id: ENGINE_ID, section: 'Engine' },
	{ id: STACK_ID, section: 'Launch stack' },
];

describe('featured rocket cutaways', () => {
	it('lists exactly the two rocket designs as featured', () => {
		expect(featuredList().map((d) => d.id).sort()).toEqual([ENGINE_ID, STACK_ID].sort());
		expect(isFeaturedId(ENGINE_ID)).toBe(true);
		expect(isFeaturedId('00000000-0000-4000-8000-000000000000')).toBe(false);
	});

	for (const { id, section } of designs) {
		describe(section, () => {
			const design = featuredDesign(id);
			const texts = [...visibleText(design.spec), { path: 'shareText', text: design.shareText }];

			it('normalizes with no warnings', () => {
				const { warnings } = normalizeSpec(design.spec);
				expect(warnings).toEqual([]);
			});

			it('has a guided tour of 8 to 12 steps', () => {
				expect(design.spec.steps.length).toBeGreaterThanOrEqual(8);
				expect(design.spec.steps.length).toBeLessThanOrEqual(12);
			});

			it('shows only numbers that are listed in its sources section', () => {
				const doc = sourcesSection(section);
				const missing = [];
				for (const { path, text } of texts) for (const n of numbersIn(text)) if (!mentions(doc, n)) missing.push(`${n} (${path})`);
				expect(missing, 'numbers shown without a source row').toEqual([]);
			});

			it('carries no third-party marks and stays generic in its title', () => {
				const marks = /space\s?x|starship|super heavy|\bxai\b|\bgrok\b|elon|musk/i;
				for (const { path, text } of texts) expect(marks.test(text), `${path}: ${text}`).toBe(false);
				expect(design.title).not.toMatch(/raptor/i);
			});

			it('uses no em or en dashes', () => {
				for (const { path, text } of texts) expect(/[\u2013\u2014]/.test(text), path).toBe(false);
			});

			it('has a share text and an OG card path', () => {
				expect(design.shareText.length).toBeGreaterThan(40);
				expect(design.shareText).not.toMatch(/\$|token|coin|price|wallet/i);
				expect(design.ogImage).toMatch(/^\/anatomy\/og\/[a-z-]+\.png$/);
			});
		});
	}

	describe('engine cutaway contents', () => {
		const { spec } = featuredDesign(ENGINE_ID);
		const parts = spec.parts.map((p) => p.name.toLowerCase());

		it('draws both preburners, both turbopump shafts, the injector, chamber and regen nozzle', () => {
			for (const want of ['fuel-rich preburner', 'oxygen-rich preburner', 'methane turbopump shaft', 'oxygen turbopump shaft', 'main injector', 'main combustion chamber', 'regeneratively cooled nozzle']) {
				expect(parts, want).toContain(want);
			}
		});

		it('spins both turbopump shafts, which carry their turbines and impellers', () => {
			const shafts = spec.parts.filter((p) => /turbopump shaft/i.test(p.name));
			expect(shafts).toHaveLength(2);
			for (const s of shafts) {
				expect(s.motion?.some((m) => m.type === 'spin')).toBe(true);
				const children = spec.parts.filter((p) => p.parent === s.id).map((p) => p.name.toLowerCase());
				expect(children.some((n) => n.includes('turbine') && !n.includes('housing'))).toBe(true);
				expect(children.some((n) => n.includes('impeller'))).toBe(true);
			}
		});

		it('colours flows by species, includes coolant flow, and ends in a shock-diamond plume', () => {
			const colours = new Set(spec.flows.map((f) => f.color));
			expect(colours.size).toBeGreaterThanOrEqual(5);
			expect(spec.flows.some((f) => /cooling/i.test(f.name))).toBe(true);
			expect(spec.effects.some((e) => e.type === 'exhaust' && /shock diamonds/i.test(e.name))).toBe(true);
		});

		it('opens with a section cut', () => {
			expect(spec.view.section).toBeTruthy();
		});
	});

	describe('launch stack tour', () => {
		const { spec } = featuredDesign(STACK_ID);

		it('runs from liftoff through hot staging and boostback to the catch, in order', () => {
			const titles = spec.steps.map((s) => s.title.toLowerCase());
			const at = (word) => titles.findIndex((t) => t.includes(word));
			const order = ['liftoff', 'hot staging', 'boostback', 'catch'].map(at);
			expect(order.every((i) => i > -1), titles.join(' | ')).toBe(true);
			expect([...order].sort((a, b) => a - b)).toEqual(order);
		});

		it('moves the catch arms and grid fins', () => {
			expect(spec.parts.filter((p) => p.motion?.length).length).toBeGreaterThanOrEqual(3);
		});
	});
});

// The Forge product has one public name, and it is the name filed with NVIDIA
// for the Accelerated Apps Catalog (docs/nvidia-apps-catalog-listing.md):
//
//   Forge: AI 3D Model Generator
//
// NVIDIA's App Publishing team checks that the name in the portal record is the
// name the product page uses. On 2026-11-26 the English page was right, but a
// reviewer whose browser was set to any other language got a different name in
// the tab title and share titles ("Forge · Text & Bild → 3D"), because those
// strings had been translated from the previous English title. The page's
// build-injected structured data also still declared the WebApplication under
// the old registry title. A product name is a proper noun: it must read the
// same in every language and in every machine-readable copy.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { rewriteHead } from '../server/seo-head.mjs';
import { jsonLdNodes } from '../api/_lib/structured-data.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');
const readJSON = (rel) => JSON.parse(read(rel));

const NAME = 'Forge: AI 3D Model Generator';
const TITLE = `${NAME} · three.ws`;
const stripTags = (s) => String(s).replace(/<[^>]+>/g, '');

const i18nrc = readJSON('.i18nrc.json');
const locales = [i18nrc.entryLocale, ...i18nrc.outputLocales];

describe('Forge product name', () => {
	it('is the page heading and title in the page source', () => {
		const html = read('pages/forge.html');
		const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
		expect(stripTags(h1)).toBe(NAME);
		expect(html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]).toBe(TITLE);
	});

	it.each(locales)('reads the same in the %s catalog', (code) => {
		const forge = readJSON(`${i18nrc.output}/${code}.json`).forge || {};
		expect(forge.meta_title).toBe(TITLE);
		expect(forge.meta_og_title).toBe(NAME);
		expect(forge.meta_twitter_title).toBe(NAME);
		// A locale without the heading key falls back to English at runtime, and
		// the next translation run would fill it in with a translated name.
		expect(stripTags(forge.product_name)).toBe(NAME);
	});

	it('is protected from translation by the glossary', () => {
		// "Forge" is already a glossary term; the descriptor has to be one too, so
		// the translator masks the whole name and `i18n:lint` reports a drop.
		expect(i18nrc.doNotTranslate).toContain('Forge');
		expect(i18nrc.doNotTranslate).toContain('AI 3D Model Generator');
	});

	it('is the registry title that drives structured data, sitemap and llms.txt', () => {
		const page = readJSON('data/pages.json')
			.sections.flatMap((s) => s.pages || [])
			.find((p) => p.path === '/forge');
		expect(page.title).toBe(NAME);
	});

	it('is the only name the served page declares in its structured data', () => {
		const out = rewriteHead('/forge', read('pages/forge.html'));
		const names = ['WebPage', 'WebApplication']
			.flatMap((type) => jsonLdNodes(out, type))
			.map((n) => n.name);
		expect(names.length).toBeGreaterThan(0);
		expect([...new Set(names)]).toEqual([NAME]);
	});
});

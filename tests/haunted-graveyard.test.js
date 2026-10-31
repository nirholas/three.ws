import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const catalog = JSON.parse(readFileSync(join(ROOT, 'public/objects/kenney-graveyard/catalog.json'), 'utf8'));
const src = readFileSync(join(ROOT, 'src/haunted/page.js'), 'utf8');
const html = readFileSync(join(ROOT, 'pages/haunted.html'), 'utf8');

/** Every model slug the /haunted layout can ask for, read from the page source. */
function usedSlugs() {
	const region = src.slice(src.indexOf('const STONES'), src.indexOf('const ONE_SHOT'));
	const slugs = new Set();
	for (const m of region.matchAll(/add\('([a-z-]+)'/g)) slugs.add(m[1]);
	for (const m of region.matchAll(/(?:pick|const [A-Z]+ =)\s*\(?\[([^\]]+)\]/g)) {
		for (const s of m[1].matchAll(/'([a-z-]+)'/g)) slugs.add(s[1]);
	}
	for (const m of region.matchAll(/id: '([a-z-]+)'/g)) slugs.add(m[1]);
	return [...slugs];
}

describe('Kenney Graveyard Kit catalog', () => {
	const models = Object.values(catalog.models);

	it('is CC0 end to end and attributes Kenney', () => {
		expect(catalog.license).toBe('CC0');
		expect(models.length).toBeGreaterThan(80);
		for (const m of models) {
			expect(m.license).toBe('CC0');
			expect(m.authors).toContain('Kenney');
			expect(m.status).toBe('done');
		}
	});

	it('ships every GLB self-contained at the path the catalog names', () => {
		for (const m of models) {
			const file = join(ROOT, 'public', m.glb_file);
			expect(existsSync(file), m.glb_file).toBe(true);
			const buf = readFileSync(file);
			expect(buf.readUInt32LE(0)).toBe(0x46546c67); // "glTF"
			const jsonLen = buf.readUInt32LE(12);
			const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
			for (const img of json.images || []) expect(img.uri, `${m.slug} has an external image`).toBeUndefined();
			for (const b of json.buffers || []) expect(b.uri, `${m.slug} has an external buffer`).toBeUndefined();
		}
	});
});

describe('/haunted page', () => {
	it('only places models that exist in the catalog', () => {
		const slugs = usedSlugs();
		expect(slugs.length).toBeGreaterThan(25);
		for (const s of slugs) expect(catalog.models[s], `${s} missing from catalog`).toBeDefined();
	});

	it('gives all five characters animation clips', () => {
		for (const id of ['character-keeper', 'character-zombie', 'character-skeleton', 'character-vampire', 'character-ghost']) {
			expect(catalog.models[id].animations?.length, id).toBeGreaterThan(0);
		}
	});

	it('has every element id the script looks up', () => {
		const ids = new Set([...src.matchAll(/'(hn-[a-z-]+)'/g)].map((m) => m[1]));
		for (const id of ids) {
			if (id === 'hn-chip') continue; // class name, built at runtime
			expect(html.includes(`id="${id}"`), id).toBe(true);
		}
	});

	it('is routed and built', () => {
		expect(readFileSync(join(ROOT, 'vercel.json'), 'utf8')).toContain('"/haunted.html"');
		expect(readFileSync(join(ROOT, 'vite.config.js'), 'utf8')).toContain("pages/haunted.html");
		expect(readFileSync(join(ROOT, 'data/pages.json'), 'utf8')).toContain('"/haunted"');
	});
});

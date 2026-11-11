// The accessibility statement (/accessibility) and the conformance report it
// summarises (docs/accessibility/acr.md) must say the same thing. These tests
// fail when a criterion is re-rated in the ACR without the statement following,
// when the ACR stops covering every WCAG 2.2 A and AA criterion, when a cited
// repository file disappears, or when the page loses its route or footer link.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const page = read('pages/accessibility.html');
const acr = read('docs/accessibility/acr.md');

// WCAG 2.2 Level A and AA success criteria (4.1.1 is kept: 2.2 marks it
// obsolete, and VPAT 2.5 still lists it).
const WCAG22_A_AA = [
	'1.1.1', '1.2.1', '1.2.2', '1.2.3', '1.2.4', '1.2.5', '1.3.1', '1.3.2', '1.3.3', '1.3.4', '1.3.5',
	'1.4.1', '1.4.2', '1.4.3', '1.4.4', '1.4.5', '1.4.10', '1.4.11', '1.4.12', '1.4.13',
	'2.1.1', '2.1.2', '2.1.4', '2.2.1', '2.2.2', '2.3.1', '2.4.1', '2.4.2', '2.4.3', '2.4.4', '2.4.5',
	'2.4.6', '2.4.7', '2.4.11', '2.5.1', '2.5.2', '2.5.3', '2.5.4', '2.5.7', '2.5.8',
	'3.1.1', '3.1.2', '3.2.1', '3.2.2', '3.2.3', '3.2.4', '3.2.6', '3.3.1', '3.3.2', '3.3.3', '3.3.4',
	'3.3.7', '3.3.8', '4.1.1', '4.1.2', '4.1.3',
];

function acrRatings() {
	const out = new Map();
	for (const m of acr.matchAll(/^\| (\d\.\d+\.\d+) [^|]+\| ([^|]+?) \|/gm)) out.set(m[1], m[2].trim());
	return out;
}

describe('docs/accessibility/acr.md', () => {
	const ratings = acrRatings();

	it('rates every WCAG 2.2 A and AA criterion exactly once', () => {
		expect([...ratings.keys()].sort()).toEqual([...WCAG22_A_AA].sort());
	});

	it('uses only the VPAT conformance terms', () => {
		const terms = new Set(['Supports', 'Partially Supports', 'Does Not Support', 'Not Applicable']);
		for (const [sc, r] of ratings) expect(terms.has(r), `${sc}: ${r}`).toBe(true);
	});

	it('is dated and versioned to match package.json', () => {
		const version = JSON.parse(read('package.json')).version;
		expect(acr).toContain(`version ${version}`);
		expect(acr).toMatch(/## Report Date\s+\d{4}-\d{2}-\d{2}/);
	});
});

describe('pages/accessibility.html', () => {
	const ratings = acrRatings();
	const count = (term) => [...ratings.values()].filter((r) => r === term).length;

	it('states the same totals as the ACR', () => {
		const supported = count('Supports');
		const partial = count('Partially Supports');
		const na = count('Not Applicable');
		expect(page).toContain(`Of the ${ratings.size} Level A and AA criteria, ${supported} are supported, ${partial} are partially supported and ${na} do not apply`);
		expect(page).toContain(`${partial} of ${ratings.size - na} applicable criteria have known gaps`);
		expect(page).toContain(count('Does Not Support') === 0 && partial > 0 ? 'partially conforms' : 'fully conforms');
	});

	it('lists every partially supported criterion as a known limitation', () => {
		const limits = page.slice(page.indexOf('id="limitations"'), page.indexOf('id="contact"'));
		for (const [sc, r] of ratings) if (r === 'Partially Supports') expect(limits, sc).toContain(`<td>${sc}</td>`);
	});

	it('links only to repository files that exist', () => {
		const links = [...page.matchAll(/https:\/\/github\.com\/nirholas\/three\.ws\/blob\/main\/([^"#?]+)/g)].map((m) => m[1]);
		expect(links.length).toBeGreaterThan(0);
		for (const p of links) expect(existsSync(resolve(ROOT, p)), p).toBe(true);
	});

	it('offers a contact route that exists', () => {
		expect(page).toContain('mailto:support@three.ws');
		expect(page).toContain('href="/support"');
		expect(existsSync(resolve(ROOT, 'pages/support.html'))).toBe(true);
	});

	it('is routed in production and dev, listed in pages.json, and linked from the footer', () => {
		const vercel = JSON.parse(read('vercel.json'));
		expect(vercel.routes.some((r) => r.src === '/accessibility/?' && r.dest === '/accessibility.html')).toBe(true);
		const vite = read('vite.config.js');
		expect(vite).toContain("accessibility: resolve(__dirname, 'pages/accessibility.html')");
		expect(vite).toMatch(/\/\^\\\/accessibility\\\/\?\$\/\.test\(path\)/);
		expect(read('data/pages.json')).toContain('"path": "/accessibility"');
		expect(read('public/footer.html')).toContain('<a href="/accessibility">Accessibility</a>');
	});
});

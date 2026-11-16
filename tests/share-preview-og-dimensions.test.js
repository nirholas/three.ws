// LinkedIn sizes its preview card from og:image:width/height before the image
// downloads, and falls back to a small thumbnail when they are missing. Every
// shell whose og:image is one of our two known 1200x630 PNGs must say so.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KNOWN_1200x630 = /^(https:\/\/three\.ws)?\/(api\/page-og(\?|$)|og-image\.png$)/;

function htmlFiles(dir) {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
		const p = path.join(dir, e.name);
		return e.isDirectory() ? htmlFiles(p) : p.endsWith('.html') ? [p] : [];
	});
}

function ogImage(html) {
	for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
		if (!/property=["']og:image["']/i.test(m[0])) continue;
		return /content=["']([^"']*)["']/i.exec(m[0])?.[1] ?? null;
	}
	return null;
}

describe('og:image dimensions on page shells', () => {
	const offenders = [];
	for (const file of [...htmlFiles(path.join(ROOT, 'pages')), ...htmlFiles(path.join(ROOT, 'docs'))]) {
		const html = readFileSync(file, 'utf8');
		const img = ogImage(html);
		if (!img || !KNOWN_1200x630.test(img.replace(/&amp;/g, '&'))) continue;
		const w = /property=["']og:image:width["'][^>]*content=["']1200["']/i.test(html);
		const h = /property=["']og:image:height["'][^>]*content=["']630["']/i.test(html);
		if (!w || !h) offenders.push(path.relative(ROOT, file));
	}

	it('declares 1200x630 wherever the image is a known 1200x630 PNG', () => {
		expect(offenders).toEqual([]);
	});
});

describe('model shell canonical', () => {
	it('has a canonical link matching its og:url so the unrewritten fallback unfurls cleanly', () => {
		const html = readFileSync(path.join(ROOT, 'pages/model.html'), 'utf8');
		expect(html).toMatch(/<link rel="canonical" href="https:\/\/three\.ws\/creations"/);
	});
});

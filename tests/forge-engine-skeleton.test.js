// The /forge engine pill ships hidden skeleton lanes so it wraps to its settled
// height in the first frame (a cold visit used to grow the composer by up to
// 190 px when /api/forge?catalog answered). The skeleton labels are written
// into pages/forge.html by hand, so this keeps them in step with the labels
// buildEngineButtons() renders.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';

const html = readFileSync(new URL('../pages/forge.html', import.meta.url), 'utf8');
const js = readFileSync(new URL('../src/forge.js', import.meta.url), 'utf8');

const pill = html.match(/id="engine"\s*>([\s\S]*?)<\/div>\s*<\/div>\s*<p class="engine-legend"/);
const labels = pill ? [...pill[1].matchAll(/<span class="eng-label">([^<]+)<\/span>/g)].map((m) => m[1]) : [];
const engineLabels = new Set(
	[...js.match(/const ENGINE_LABELS = \{([\s\S]*?)\n\};/)[1].matchAll(/:\s*'([^']+)'/g)].map((m) => m[1]),
);

describe('forge engine pill skeleton', () => {
	it('ships skeleton lanes in the markup', () => {
		expect(labels.length).toBeGreaterThanOrEqual(6);
	});
	it('only uses labels that buildEngineButtons can render', () => {
		for (const l of labels) expect(engineLabels.has(l), l).toBe(true);
	});
	it('keeps skeleton buttons inert and hidden until the live catalog replaces them', () => {
		expect(pill[1].match(/<button[^>]*>/g).every((b) => /disabled/.test(b) && /tabindex="-1"/.test(b) && !/data-engine/.test(b))).toBe(true);
		expect(html).toMatch(/\.engine-pill > button:not\(\[data-engine\]\)\s*\{\s*visibility: hidden/);
	});
	it('has buildEngineButtons clear the skeleton before writing lanes', () => {
		expect(js).toMatch(/function buildEngineButtons\(\)[\s\S]*?els\.engine\.innerHTML = '';/);
	});
	it('holds the toolbar and caption height for late content', () => {
		expect(html).toMatch(/id="enhance-skel"[^>]*disabled/);
		expect(readFileSync(new URL('../src/forge-enhance.js', import.meta.url), 'utf8')).toMatch(/getElementById\('enhance-skel'\)\?\.remove\(\)/);
		expect(html).toMatch(/fq-estimate-ghost" aria-hidden="true"/);
		expect(html).toMatch(/\.fq-estimate-ghost\s*\{\s*visibility: hidden/);
	});
});

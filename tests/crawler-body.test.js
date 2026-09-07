// Coverage for server/crawler-body.mjs.
//
// /tutorials/<slug> and /walkthroughs/<slug> resolve to one shared shell whose
// body is filled by a client-side fetch. Before this module those 76 URLs were
// submitted to Google carrying no text: the walkthrough shell was an empty
// <div>, and the tutorial shell was worse than empty, because its static
// fallback copy reads "Tutorial not found" under a blank <h1>.
//
// The invariants that matter, and why each is asserted rather than eyeballed:
//   1. The rendered page carries the tutorial's real heading and prose, so
//      there is something to index at all.
//   2. Exactly one <h1>. The shell's hero owns it, so the markdown's own title
//      line must be stripped; two competing top-level headings is the defect
//      this module would otherwise introduce.
//   3. An unknown slug changes nothing. Inventing a page for a URL with no
//      content is how a 404 gets banked as a real page.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const { renderCrawlerBody } = await import('../server/crawler-body.mjs');

const root = resolve(import.meta.dirname, '..');
const tutorialShell = readFileSync(resolve(root, 'pages/tutorial.html'), 'utf8');
const walkthroughShell = readFileSync(resolve(root, 'pages/walkthrough.html'), 'utf8');

const headings = (html, tag) =>
	[...html.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'g'))]
		.map((m) => m[1].replace(/<[^>]*>/g, '').trim())
		.filter(Boolean);

describe('tutorial pages', () => {
	const out = renderCrawlerBody('/tutorials/text-to-3d', tutorialShell);

	it('renders the tutorial body into the shell', () => {
		expect(out).toBeTruthy();
		expect(out.length).toBeGreaterThan(tutorialShell.length);
		expect(out).not.toContain('<h1 id="tdoc-title"></h1>');
	});

	it('emits exactly one h1, taken from the markdown title', () => {
		const h1s = headings(out, 'h1');
		expect(h1s).toHaveLength(1);
		expect(h1s[0]).toBe('Turn a Text Prompt into a 3D Model');
	});

	it('reveals the hero that the shell hides for the client player', () => {
		expect(tutorialShell).toContain('id="tdoc-hero" hidden');
		expect(out).not.toContain('id="tdoc-hero" hidden');
	});

	it('drops the not-found fallback copy from the article', () => {
		const article = out.match(/<article class="tdoc-article" id="tdoc-article">([\s\S]*?)<\/article>/)[1];
		expect(article).not.toMatch(/Loading tutorial/);
		expect(article.replace(/<[^>]*>/g, '').trim().length).toBeGreaterThan(400);
	});

	it('leaves a slug with no markdown untouched', () => {
		expect(renderCrawlerBody('/tutorials/no-such-tutorial-here', tutorialShell)).toBeNull();
	});

	it('refuses a slug that is not a slug', () => {
		expect(renderCrawlerBody('/tutorials/..%2F..%2Fetc%2Fpasswd', tutorialShell)).toBeNull();
		expect(renderCrawlerBody('/tutorials/a/b', tutorialShell)).toBeNull();
	});
});

describe('walkthrough pages', () => {
	const out = renderCrawlerBody('/walkthroughs/embed-a-3d-avatar', walkthroughShell);

	it('renders the walkthrough steps into the empty root', () => {
		expect(out).toBeTruthy();
		expect(walkthroughShell).toMatch(/<div id="wt-root" data-state="loading"><\/div>/);
		expect(out.length).toBeGreaterThan(walkthroughShell.length);
	});

	it('emits one h1 and the step headings below it', () => {
		expect(headings(out, 'h1')).toHaveLength(1);
		expect(headings(out, 'h2').length).toBeGreaterThan(0);
	});

	it('leaves an unknown walkthrough untouched', () => {
		expect(renderCrawlerBody('/walkthroughs/not-a-walkthrough', walkthroughShell)).toBeNull();
	});
});

describe('routing', () => {
	it('ignores paths it does not own', () => {
		for (const p of ['/markets', '/tutorials', '/walkthroughs', '/', '/docs/portal']) {
			expect(renderCrawlerBody(p, tutorialShell)).toBeNull();
		}
	});

	it('tolerates a trailing slash', () => {
		expect(renderCrawlerBody('/tutorials/text-to-3d/', tutorialShell)).toBeTruthy();
	});

	it('returns null rather than a half-injected page when the shell changes shape', () => {
		expect(renderCrawlerBody('/tutorials/text-to-3d', '<html><body>a different shell</body></html>')).toBeNull();
	});
});

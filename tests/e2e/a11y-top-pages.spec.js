// Task 07: automated accessibility floor. Runs axe-core against the top 30
// pages by data/pages.json priority (the same ranking that drives the
// sitemap/llms.txt) plus ten more high-traffic main/build routes, catching
// contrast-below-AA, missing labels, and keyboard traps before they ship.
// `wcag2a`/`wcag2aa`/`wcag21aa` rule sets only (no experimental or
// best-practice rules), so this stays a hard gate and not a taste argument.

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const pagesData = JSON.parse(readFileSync(join(ROOT, 'data', 'pages.json'), 'utf8'));

const allPages = pagesData.sections.flatMap((s) => s.pages);
const top30 = [...allPages]
	.sort((a, b) => (b.priority ?? 0.5) - (a.priority ?? 0.5))
	.slice(0, 30);

// Ten more high-traffic routes beyond the priority top 30, drawn from the
// main/build sections of data/pages.json (the next-highest priorities not
// already covered above). Extends the floor to 40 pages total.
const EXTRA_HIGH_TRAFFIC = [
	'/search',
	'/characters',
	'/what-is',
	'/walk',
	'/concierge',
	'/partners',
	'/openai',
	'/nvidia',
	'/pricing',
	'/irl',
	// The Home Assistant lane, every public route of it. A voice-controlled
	// house is assistive technology for the people most likely to need it, so
	// these carry the same hard WCAG floor as the marketing surfaces above and
	// never ride on their own priority scores staying high enough to land in
	// the top 30. The two authed views, /smart-home/:id and /home/:id, are not
	// here because they need a session and a connected house; they are covered
	// by the lane's own live suite instead.
	'/smart-home',
	'/smart-home/join',
	'/smart-home/plan',
	'/smart-home/satellite',
];
const coveredPaths = new Set(top30.map((p) => p.path));
const extraPages = allPages.filter(
	(p) => EXTRA_HIGH_TRAFFIC.includes(p.path) && !coveredPaths.has(p.path),
);
const auditPages = [...top30, ...extraPages];

// Known, accepted contrast exceptions: third-party embeds we don't control
// the markup of, or pages that intentionally render user-generated content.
// Keep this list short and named — it is an exception ledger, not a bypass.
const KNOWN_EXCEPTIONS = new Set([]);

// axe measures whatever frame it lands on. Feeds that stagger their rows in
// (src/ui-juice.js enterStagger: opacity 0 to 1 over --duration-base, up to
// 320ms of per-row delay, starting whenever the fetch resolves) can still be
// mid-fade at the 500ms mark, and axe blends a half-opaque row's ink into
// the background and reports the resting-state-correct text as a contrast
// failure: /agi flaked on rows 5 to 8 this way. Waiting for every FINITE
// animation and transition to finish measures the page a user actually
// reads. Infinite loops (pulses, shimmers, marquee floors) are skipped, and
// the whole wait is capped so a runaway effect can never stall the gate;
// the axe assertion itself is untouched.
async function settleFiniteAnimations(page, capMs = 5_000) {
	// One pass is not enough on a page that polls. /agi re-renders its decision
	// stream on an interval and staggers the new rows in, so rows that started
	// fading AFTER the first wait resolved were still half-opaque when axe
	// measured them, and axe blends a half-opaque row's ink into the background:
	// it reported `--ink` body text (16:1 at rest) as a contrast failure. Keep
	// settling until a pass finds nothing running, which is the resting state a
	// reader actually sees. The deadline is shared across passes, so a page that
	// never goes quiet costs the same as before and the axe assertion is
	// untouched either way.
	await page.evaluate(async (cap) => {
		const finite = document.getAnimations().filter((a) => {
			const timing = a.effect && typeof a.effect.getTiming === 'function' ? a.effect.getTiming() : null;
			return a.playState !== 'finished' && !!timing && Number.isFinite(timing.iterations);
		});
		if (finite.length === 0) return;
		const settled = Promise.all(finite.map((a) => a.finished.catch(() => undefined)));
		await Promise.race([settled, new Promise((resolve) => setTimeout(resolve, cap))]);
	}, capMs);
}

// Snap every animation and transition to its resting frame, and keep doing it
// for elements that appear later.
//
// Waiting for the animations that exist at one instant cannot settle a page
// that polls: /agi re-renders its decision stream on an interval and staggers
// the new rows in (src/ui-juice.css `.juice-enter` fades opacity 0 to 1 with a
// per-row delay), so a row inserted after the wait was still half-opaque when
// axe read it. axe composites a half-opaque row's ink into the background and
// reports it as a contrast failure: it flagged `--ink` body text, which
// measures 16:1 at rest. A stylesheet, unlike a wait, also governs every row
// that arrives afterwards.
//
// This changes no colour, no layout and no content. It removes only the
// in-between frames, so what axe measures is the resting state a reader
// actually sees, which is the state the contrast rule is about.
async function freezeAnimations(page) {
	await page.addStyleTag({
		content: `*, *::before, *::after {
			animation-delay: 0s !important;
			animation-duration: 1ms !important;
			transition-delay: 0s !important;
			transition-duration: 1ms !important;
		}`,
	});
	// One frame for the snapped animations to land on their final values.
	await page.waitForTimeout(50);
}

for (const { path } of auditPages) {
	test(`a11y floor: ${path}`, async ({ page }) => {
		if (KNOWN_EXCEPTIONS.has(path)) test.skip();
		// 180s, not 60s. playwright.config.js budgets 300s per test precisely
		// because a cold Vite dev server transforms a page's whole module graph
		// on first hit and heavy routes legitimately take minutes. Capping the
		// navigation at 60s inside that 300s budget meant a slow transform was
		// reported as a failed accessibility floor, so the gate flagged pages
		// whose markup axe never got to look at. The axe run and its assertion
		// below are unchanged; this only stops the dev server's speed from
		// deciding the verdict, and still leaves 120s for the axe pass itself.
		await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 180_000 });
		await page.waitForTimeout(500); // let above-the-fold async content settle
		await settleFiniteAnimations(page);
		await freezeAnimations(page);

		const results = await new AxeBuilder({ page })
			.withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
			.analyze();

		if (results.violations.length > 0) {
			const summary = results.violations
				.map((v) => `[${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s))\n  ${v.nodes.map((n) => n.target.join(' ')).join('\n  ')}`)
				.join('\n\n');
			throw new Error(`axe found ${results.violations.length} violation(s) on ${path}:\n\n${summary}`);
		}

		expect(results.violations).toEqual([]);
	});
}

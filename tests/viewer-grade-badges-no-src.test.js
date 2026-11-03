// @vitest-environment jsdom
//
// /viewer with no ?src= shows "No model to show". Both grade badges in its
// header (<sim-readiness> and <engine-qa>) render a loading skeleton the moment
// they connect, and only the page's own script tells them what to show next.
// With no model that script returned early and left both skeletons shimmering
// forever beside the empty state, promising a grade that could never arrive
// (and, on a phone, pushing the header past the screen edge).
//
// This runs the real page markup and its real inline script with no src, after
// the real element definitions, and asserts no badge is left loading.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, it, expect, beforeAll } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const PAGE = readFileSync(resolve(ROOT, 'public/viewer.html'), 'utf8');

/** The page's main inline script: the plain <script> that reads ?src=. */
function inlineScript() {
	const blocks = [...PAGE.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
	const main = blocks.find((b) => b.includes("params.get('src')"));
	if (!main) throw new Error('viewer inline script not found');
	return main;
}

/** The page body markup with every <script> removed, so only markup lands. */
function bodyMarkup() {
	const body = PAGE.match(/<body[^>]*>([\s\S]*)<\/body>/)[1];
	return body.replace(/<script[\s\S]*?<\/script>/g, '');
}

describe('/viewer with no ?src=', () => {
	beforeAll(async () => {
		window.history.replaceState(null, '', '/viewer');
		await import('../public/sim-readiness-panel.js');
		await import('../public/engine-qa-panel.js');
		document.body.innerHTML = bodyMarkup();
		// The page script runs once against this document, exactly as a browser
		// would after parsing the markup above it.
		new Function(inlineScript())();
		await Promise.resolve();
	});

	it('leaves no grade badge showing a loading skeleton', () => {
		for (const id of ['sim-badge', 'engine-qa-badge']) {
			const el = document.getElementById(id);
			const visible = Boolean(el && el.isConnected && !el.hidden);
			const loading = visible && !!el.shadowRoot?.querySelector('.skeleton');
			expect({ id, loading }).toEqual({ id, loading: false });
		}
	});

	it('still shows the empty state', () => {
		expect(document.body.textContent).toContain('No model to show');
	});
});

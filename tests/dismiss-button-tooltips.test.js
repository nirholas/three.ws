// @vitest-environment jsdom
// The small "×" dismiss buttons on the shared page chrome (the "what next?" strip and the Cmd+K
// hint chip) are icon buttons: their accessible name comes from aria-label, and sighted pointer
// and keyboard users read the same words in a linked role="tooltip". lintapple (axe's
// label-content-name-mismatch) reported "×Dismiss suggestions": a text glyph inside the button
// joins the tooltip words in the visible label, so the label no longer matches the name. The
// atlas chip's "×" also had no tooltip at all and a 13x15 px hit area.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const nextStepsSrc = readFileSync(resolve(__dirname, '../public/next-steps.js'), 'utf8');

// Text a sighted user sees as the button's label, outside its tooltip.
function glyphText(button) {
	return [...button.childNodes]
		.filter((n) => !(n.nodeType === 1 && n.getAttribute('role') === 'tooltip'))
		.map((n) => n.textContent)
		.join('')
		.trim();
}

function expectIconButtonWithTooltip(button, name) {
	expect(button, 'dismiss button rendered').toBeTruthy();
	expect(button.getAttribute('aria-label')).toBe(name);
	const tipId = button.getAttribute('aria-describedby');
	expect(tipId, 'aria-describedby names the tooltip').toBeTruthy();
	const tip = document.getElementById(tipId);
	expect(tip?.getAttribute('role')).toBe('tooltip');
	expect(tip.textContent.trim()).toBe(name);
	expect(glyphText(button), 'no text glyph beside the tooltip words').toBe('');
	expect(button.querySelector('svg[aria-hidden="true"]'), 'the cross is a hidden icon').toBeTruthy();
}

afterEach(() => {
	document.head.innerHTML = '';
	document.body.innerHTML = '';
	delete window.__twsNextSteps;
	delete window.__twsAtlas;
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('next-steps strip dismiss button', () => {
	it('is an icon button whose visible label is exactly its tooltip', () => {
		window.history.pushState({}, '', '/forge');
		new Function(nextStepsSrc)();
		expectIconButtonWithTooltip(document.querySelector('#tws-next-steps .tn-x'), 'Dismiss suggestions');
	});
});

describe('atlas Cmd+K hint chip dismiss button', () => {
	it('is an icon button with a linked tooltip and a 24px hit area', async () => {
		vi.useFakeTimers();
		localStorage.clear();
		vi.stubGlobal('matchMedia', (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
		vi.stubGlobal('fetch', () => Promise.reject(new Error('offline in tests')));
		window.history.pushState({}, '', '/create');
		await import('../public/atlas.js');
		vi.advanceTimersByTime(4000);
		const chip = document.querySelector('.tws-atlas-hint');
		expect(chip, 'hint chip mounted').toBeTruthy();
		const dismiss = chip.querySelector('.tws-atlas-hint-x');
		expectIconButtonWithTooltip(dismiss, 'Dismiss search hint');
		const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n');
		expect(css).toMatch(/\.tws-atlas-hint \.tws-atlas-hint-x\{[^}]*width:24px;height:24px/);
	});
});

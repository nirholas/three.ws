// @vitest-environment jsdom
//
// The tab title while Forge generates (src/forge-tab-title.js) and the polite
// screen reader channel (src/forge-sr.js). The title must say whether the job is
// running, done or stopped, and put the page's own title back afterwards.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTabTitle } from '../src/forge-tab-title.js';
import { announcePolite } from '../src/forge-sr.js';

describe('forge tab title', () => {
	beforeEach(() => {
		document.title = 'Forge: AI 3D Model Generator · three.ws';
	});

	it('shows the real elapsed clock while running and restores the page title after', () => {
		const t = createTabTitle(document);
		t.running(0);
		expect(document.title).toBe('Forging 0:00 · three.ws');
		t.running(75);
		expect(document.title).toBe('Forging 1:15 · three.ws');
		t.idle();
		expect(document.title).toBe('Forge: AI 3D Model Generator · three.ws');
	});

	it('says the model is ready, and that a generation stopped', () => {
		const t = createTabTitle(document);
		t.running(130);
		t.done();
		expect(document.title).toBe('Model ready · three.ws');
		t.running(5);
		t.failed();
		expect(document.title).toBe('Forge stopped · three.ws');
		t.idle();
		expect(document.title).toBe('Forge: AI 3D Model Generator · three.ws');
	});

	it('never overwrites a title something else set while it was idle', () => {
		const t = createTabTitle(document);
		t.running(1);
		t.idle();
		document.title = 'Image to 3D · three.ws';
		t.idle();
		expect(document.title).toBe('Image to 3D · three.ws');
		t.running(2);
		t.idle();
		expect(document.title).toBe('Image to 3D · three.ws');
	});

	it('does nothing when idle is called before any generation', () => {
		const t = createTabTitle(document);
		t.idle();
		expect(document.title).toBe('Forge: AI 3D Model Generator · three.ws');
	});
});

describe('forge tab title follows the panels', () => {
	beforeEach(() => {
		document.title = 'Forge: AI 3D Model Generator · three.ws';
	});

	it('runs while generating, keeps "Model ready" on the result, and restores on any other panel', () => {
		const t = createTabTitle(document);
		t.show('generating');
		expect(document.title).toBe('Forging 0:00 · three.ws');
		t.running(42);
		t.show('generating');
		expect(document.title).toBe('Forging 0:42 · three.ws');
		t.done();
		t.show('result');
		expect(document.title).toBe('Model ready · three.ws');
		t.show('empty');
		expect(document.title).toBe('Forge: AI 3D Model Generator · three.ws');
	});

	it('does not claim a model is ready for a result opened from the gallery', () => {
		const t = createTabTitle(document);
		t.show('result');
		expect(document.title).toBe('Forge: AI 3D Model Generator · three.ws');
	});

	it('reads as stopped on the error panel', () => {
		const t = createTabTitle(document);
		t.show('generating');
		t.show('error');
		expect(document.title).toBe('Forge stopped · three.ws');
		t.show('empty');
		expect(document.title).toBe('Forge: AI 3D Model Generator · three.ws');
	});

	it('puts the page title back when the person returns to the tab after it finished', () => {
		const t = createTabTitle(document);
		t.show('generating');
		t.done();
		t.show('result');
		Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
		document.dispatchEvent(new Event('visibilitychange'));
		expect(document.title).toBe('Model ready · three.ws');
		Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
		document.dispatchEvent(new Event('visibilitychange'));
		expect(document.title).toBe('Forge: AI 3D Model Generator · three.ws');
	});
});

describe('forge polite announcer', () => {
	beforeEach(() => {
		document.body.innerHTML = '';
		vi.stubGlobal('requestAnimationFrame', (fn) => {
			fn();
			return 1;
		});
	});

	it('writes into one visually hidden polite status region and reuses it', () => {
		announcePolite('Your model is ready.');
		const region = document.querySelector('.forge-sr-status');
		expect(region.getAttribute('role')).toBe('status');
		expect(region.getAttribute('aria-live')).toBe('polite');
		expect(region.textContent).toBe('Your model is ready.');
		announcePolite('Taking a little longer than typical. Still running.');
		expect(document.querySelectorAll('.forge-sr-status')).toHaveLength(1);
		expect(region.textContent).toContain('Taking a little longer');
	});

	it('ignores empty text', () => {
		announcePolite('');
		expect(document.querySelector('.forge-sr-status')).toBeNull();
	});
});

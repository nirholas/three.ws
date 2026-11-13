// @vitest-environment jsdom
//
// Regression guard for the theme switcher's light-capability probe.
//
// The platform is dark-first, so public/theme-switcher.js probes whether the
// current page honours the light palette (does <body> go light when
// data-theme='light'?) and pins the page dark when it does not. That probe used
// to memoise its verdict on the very first call, which runs while the module
// boots.
//
// Most pages get their light palette from public/tokens.css, which arrives
// through nav.css's @import behind an asynchronously injected <link>: two extra
// round trips after that first probe. Reading the page's own dark --bg before
// the token sheet lands therefore cached "this page is a dark island" for the
// whole visit, and a user with light saved was served dark on roughly a third
// of loads of /create/prompt (measured 2026-08-25).
//
// These tests pin the fix: a not-capable verdict stays provisional until a
// stylesheet actually lands, and the page flips to the user's chosen theme the
// moment one does.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SOURCE = readFileSync(resolve(process.cwd(), 'public/theme-switcher.js'), 'utf8');

// jsdom does not apply stylesheets, so the "does the body go light?" probe is
// driven directly: bodyBg() is what getComputedStyle would report, and the test
// flips it when the token sheet "arrives".
let bodyBg;

function boot() {
	Object.defineProperty(window, 'getComputedStyle', {
		configurable: true,
		writable: true,
		value: (el) => (el === document.body ? { backgroundColor: bodyBg() } : { backgroundColor: 'rgba(0, 0, 0, 0)' }),
	});
	new Function(SOURCE)();
}

function addStylesheet() {
	const link = document.createElement('link');
	link.rel = 'stylesheet';
	link.href = '/nav.css';
	document.head.appendChild(link);
	return link;
}

beforeEach(() => {
	document.documentElement.innerHTML = '<head></head><body></body>';
	document.documentElement.setAttribute('data-theme', 'light');
	localStorage.setItem('twx_theme', 'light');
	delete window.threeTheme;
});

afterEach(() => {
	localStorage.clear();
	delete window.threeTheme;
});

describe('theme switcher light-capability probe', () => {
	it('pins a page dark while its body still reads dark', () => {
		bodyBg = () => 'rgb(0, 0, 0)';
		boot();
		expect(window.threeTheme.supportsLight()).toBe(false);
		expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
	});

	it('does not freeze that verdict: a stylesheet landing later flips the page to light', async () => {
		bodyBg = () => 'rgb(0, 0, 0)';
		const link = addStylesheet();
		boot();
		expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

		// tokens.css resolves behind nav.css and the body turns light.
		bodyBg = () => 'rgb(255, 255, 255)';
		link.dispatchEvent(new Event('load'));

		expect(window.threeTheme.supportsLight()).toBe(true);
		expect(document.documentElement.getAttribute('data-theme')).toBe('light');
	});

	it('picks up a stylesheet that is injected after boot, not just one already in the head', async () => {
		bodyBg = () => 'rgb(0, 0, 0)';
		boot();
		expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

		// nav.js injects its <link> asynchronously, well after this module ran.
		const link = addStylesheet();
		await new Promise((r) => setTimeout(r, 0));
		bodyBg = () => 'rgb(255, 255, 255)';
		link.dispatchEvent(new Event('load'));

		expect(document.documentElement.getAttribute('data-theme')).toBe('light');
	});

	it('keeps a capable page on the theme the user chose', () => {
		bodyBg = () => 'rgb(255, 255, 255)';
		boot();
		expect(window.threeTheme.supportsLight()).toBe(true);
		expect(document.documentElement.getAttribute('data-theme')).toBe('light');
	});

	it('suspends colour transitions for the whole probe and leaves nothing behind', () => {
		// The probe flips data-theme to light and back inside one JS turn. Without
		// a transition suspension the forced recalc arms a colour transition that
		// starts FROM the light palette on every element with a `transition:
		// color` (the shared nav), and the sheet watch re-arms it on each DOM
		// mutation, so the nav sat at the light grey over the dark bar (3:1) for
		// seconds on a cold load. The suspension goes through adoptedStyleSheets
		// where the document has them (jsdom 31 does) and a <style> fallback
		// otherwise; either way it must be in place at the moment the body is
		// read, and gone once the probe returns.
		const suspended = () =>
			document.querySelector('style[data-twx-theme-probe]') !== null ||
			(document.adoptedStyleSheets || []).some((sheet) =>
				Array.from(sheet.cssRules).some((rule) => /transition:\s*none/.test(rule.cssText)),
			);
		let suspendedDuringRead = null;
		bodyBg = () => {
			suspendedDuringRead = suspended();
			return 'rgb(255, 255, 255)';
		};
		boot();
		expect(window.threeTheme.supportsLight()).toBe(true);
		expect(suspendedDuringRead).toBe(true);
		expect(suspended()).toBe(false);
		expect(document.documentElement.getAttribute('data-theme')).toBe('light');
	});

	it('does not let its own probe stylesheet re-trigger the sheet watch', async () => {
		// A dark island keeps a MutationObserver alive to re-probe when a sheet
		// lands. The probe's fallback <style> is itself a childList mutation; if
		// the watch reacted to it, every probe would schedule another probe and
		// the page would never stop re-probing.
		let probes = 0;
		bodyBg = () => {
			probes += 1;
			return 'rgb(0, 0, 0)';
		};
		boot();
		const afterBoot = probes;
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(probes).toBe(afterBoot);
		expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
	});

	it('does not re-probe on every stylesheet for a visitor who wants dark', async () => {
		// Each probe flips data-theme on <html> and reads the body, which forces a
		// full-document style recalc (and the transition suspension forces
		// another). Measured on a Pixel 5 (4x CPU) against production /marketplace
		// on 2026-11-13: ten probes per load, the last one 304 ms on its own over
		// 7,200 nodes, about 1.8 s of main-thread time on a page that is a genuine
		// dark island. For a visitor whose theme resolves to dark the verdict
		// cannot change what paints, only whether the nav toggle shows, so a
		// stylesheet landing must not cost a synchronous probe; one settle probe
		// after load answers the toggle question.
		localStorage.setItem('twx_theme', 'dark');
		document.documentElement.setAttribute('data-theme', 'dark');
		Object.defineProperty(document, 'readyState', { configurable: true, get: () => 'interactive' });
		let probes = 0;
		bodyBg = () => {
			probes += 1;
			return 'rgb(0, 0, 0)';
		};
		try {
			boot();
			const afterBoot = probes;
			const links = Array.from({ length: 6 }, addStylesheet);
			await new Promise((r) => setTimeout(r, 0));
			for (const link of links) link.dispatchEvent(new Event('load'));
			const style = document.createElement('style');
			style.textContent = 'main{color:red}';
			document.head.appendChild(style);
			// The nav (and its toggle) is injected after boot.
			const btn = document.createElement('button');
			btn.id = 'nav-theme-toggle';
			document.body.appendChild(btn);
			await new Promise((r) => setTimeout(r, 0));
			expect(probes - afterBoot, 'stylesheets and the nav must reuse the boot verdict').toBe(0);
			expect(btn.hidden).toBe(true);
			expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
		} finally {
			delete document.readyState;
		}
	});

	it('settles a dark visitor\'s toggle with one probe after load', async () => {
		localStorage.setItem('twx_theme', 'dark');
		document.documentElement.setAttribute('data-theme', 'dark');
		Object.defineProperty(document, 'readyState', { configurable: true, get: () => 'interactive' });
		const btn = document.createElement('button');
		btn.id = 'nav-theme-toggle';
		document.body.appendChild(btn);
		let probes = 0;
		let light = false;
		bodyBg = () => {
			probes += 1;
			return light ? 'rgb(255, 255, 255)' : 'rgb(0, 0, 0)';
		};
		vi.useFakeTimers();
		// Earlier tests' instances still listen on this shared window, so keep
		// this instance's own load handler instead of dispatching a global event.
		const onLoad = [];
		const addListener = window.addEventListener.bind(window);
		const spy = vi.spyOn(window, 'addEventListener').mockImplementation((type, fn, opts) => {
			if (type === 'load') onLoad.push(fn);
			else addListener(type, fn, opts);
		});
		try {
			boot();
			spy.mockRestore();
			expect(btn.hidden).toBe(true);
			const afterBoot = probes;
			// tokens.css lands behind nav.css: the page turns out to be capable.
			light = true;
			const link = addStylesheet();
			await Promise.resolve();
			link.dispatchEvent(new Event('load'));
			expect(probes).toBe(afterBoot);
			Object.defineProperty(document, 'readyState', { configurable: true, get: () => 'complete' });
			expect(onLoad.length).toBe(1);
			onLoad[0](new Event('load'));
			await vi.runAllTimersAsync();
			expect(probes - afterBoot).toBe(1);
			expect(btn.hidden, 'a capable page shows the toggle once settled').toBe(false);
			expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
		} finally {
			spy.mockRestore();
			vi.useRealTimers();
			delete document.readyState;
		}
	});

	it('still honours an explicit dark preference on a light-capable page', () => {
		localStorage.setItem('twx_theme', 'dark');
		bodyBg = () => 'rgb(255, 255, 255)';
		boot();
		expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
	});
});

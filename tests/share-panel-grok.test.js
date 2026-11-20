// @vitest-environment jsdom
// The share panel's two X actions: "Share on X" and "Ask @grok about it".
// Both go through xIntentUrl, carry utm attribution, open a sized popup and
// beacon the entity kind and action. Ask @grok is offered only for models,
// avatars and anatomy designs, and is disabled with a reason while generating.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { showSharePanel } from '../src/shared/share.js';

const MODEL = {
	kind: 'forge',
	id: '0001e5f4-adff-464d-859e-95867eae2f2c',
	title: 'a red vintage motorcycle',
	prompt: 'a red vintage motorcycle',
	shareUrl: 'https://three.ws/forge/share/0001e5f4-adff-464d-859e-95867eae2f2c',
};

function open(entity = MODEL) {
	showSharePanel(entity);
	return {
		x: document.querySelector('.tws-sp-x'),
		grok: document.querySelector('.tws-sp-grok'),
		hint: document.querySelector('.tws-sp-grok-hint'),
	};
}

function intent(href) {
	const u = new URL(href);
	return { base: u.origin + u.pathname, text: u.searchParams.get('text'), url: new URL(u.searchParams.get('url')) };
}

function beaconed() {
	return navigator.sendBeacon.mock.calls.map(([, blob]) => blob);
}

beforeEach(() => {
	HTMLDialogElement.prototype.showModal ??= function () { this.setAttribute('open', ''); };
	HTMLDialogElement.prototype.close ??= function () { this.removeAttribute('open'); };
	document.body.innerHTML = '';
	globalThis.navigator.sendBeacon = vi.fn(() => true);
	vi.restoreAllMocks();
});

describe('Share on X', () => {
	it('builds the intent through xIntentUrl with grok-share attribution', () => {
		const { x } = open();
		const r = intent(x.href);
		expect(r.base).toBe('https://x.com/intent/post');
		expect(r.text).toContain('a red vintage motorcycle');
		expect(r.url.pathname).toBe('/forge/share/0001e5f4-adff-464d-859e-95867eae2f2c');
		expect(r.url.searchParams.get('utm_source')).toBe('x');
		expect(r.url.searchParams.get('utm_medium')).toBe('share');
		expect(r.url.searchParams.get('utm_campaign')).toBe('grok-share');
	});

	it('opens a sized popup and beacons x_share_model', async () => {
		const { x } = open();
		const spy = vi.spyOn(window, 'open').mockReturnValue({});
		const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
		x.dispatchEvent(ev);
		expect(spy).toHaveBeenCalledOnce();
		expect(spy.mock.calls[0][0]).toBe(x.href);
		expect(ev.defaultPrevented).toBe(true);
		const body = JSON.parse(await beaconed()[0].text());
		expect(body).toEqual({ surface: 'x_share_model', kind: 'action' });
	});
});

describe('Ask @grok about it', () => {
	it('opens the intent with a description and a question ending in @grok', () => {
		const { grok } = open();
		expect(grok.tagName).toBe('A');
		expect(grok.getAttribute('aria-label')).toMatch(/ask @grok/i);
		const r = intent(grok.href);
		expect(r.base).toBe('https://x.com/intent/post');
		expect(r.text).toContain('a red vintage motorcycle');
		expect(r.text.trim().endsWith('@grok')).toBe(true);
		expect(r.url.searchParams.get('utm_campaign')).toBe('grok-ask');
	});

	it('beacons grok_ask_<kind> for avatars and anatomy', async () => {
		const spy = vi.spyOn(window, 'open').mockReturnValue({});
		open({ kind: 'anatomy', id: 'dfebfc22-f9d8-4928-8216-c97d074113ec', title: 'Honda CD70 carburetor', shareUrl: 'https://three.ws/anatomy/dfebfc22-f9d8-4928-8216-c97d074113ec' })
			.grok.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
		expect(spy).toHaveBeenCalledOnce();
		expect(JSON.parse(await beaconed()[0].text())).toEqual({ surface: 'grok_ask_anatomy', kind: 'action' });
	});

	it('is disabled with a visible reason while the entity is still generating', () => {
		const spy = vi.spyOn(window, 'open').mockReturnValue({});
		const { grok, hint } = open({ ...MODEL, id: '', title: '' });
		expect(grok.getAttribute('aria-disabled')).toBe('true');
		expect(grok.hasAttribute('href')).toBe(false);
		expect(grok.getAttribute('title')).toMatch(/still generating/i);
		expect(hint.textContent).toMatch(/still generating/i);
		expect(grok.getAttribute('aria-describedby')).toBe(hint.id);
		const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
		grok.dispatchEvent(ev);
		expect(spy).not.toHaveBeenCalled();
		expect(navigator.sendBeacon).not.toHaveBeenCalled();
	});

	it('stays keyboard focusable when disabled so the reason is reachable', () => {
		const { grok } = open({ ...MODEL, id: '' });
		expect(grok.tabIndex).toBe(0);
	});

	it('is not offered for agents, wallets or scans', () => {
		expect(open({ kind: 'agent', id: '1', title: 'Bot', shareUrl: 'https://three.ws/agents/1' }).grok).toBeNull();
	});
});

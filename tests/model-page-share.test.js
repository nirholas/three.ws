// @vitest-environment jsdom
// The model page (/m/:id) Share button opens the share panel with both X
// actions: "Share on X" and "Ask @grok about it". It used to call
// navigator.share or copy the link, so the one page every forge share link
// lands on offered neither action (docs/share-to-x.md).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { modelShareEntity } from '../src/model-lib.js';
import { showSharePanel } from '../src/shared/share.js';
import { grokAskState, shareKindOf } from '../src/shared/grok-ask.js';

const CREATION = {
	id: '0001e5f4-adff-464d-859e-95867eae2f2c',
	prompt: 'A paladin in polished plate armour with a tabard, gauntlets and a sheathed longsword',
	model_category: 'avatar',
	glb_url: 'https://three.ws/cdn/forge/f7f7eb0d7cd1/0001e5f4-adff-464d-859e-95867eae2f2c.web.glb',
};
const PREVIEW = 'https://three.ws/api/render/glb?glbUrl=x&width=1200&height=630';

beforeEach(() => {
	HTMLDialogElement.prototype.showModal ??= function () { this.setAttribute('open', ''); };
	HTMLDialogElement.prototype.close ??= function () { this.removeAttribute('open'); };
	document.body.innerHTML = '';
	globalThis.navigator.sendBeacon = vi.fn(() => true);
	vi.restoreAllMocks();
});

describe('modelShareEntity', () => {
	it('is a ready model entity pointing at the permalink, with real metadata', () => {
		const e = modelShareEntity(CREATION, { previewImage: PREVIEW });
		expect(shareKindOf(e)).toBe('model');
		expect(e.id).toBe(CREATION.id);
		expect(e.shareUrl).toBe(`https://three.ws/m/${CREATION.id}`);
		expect(e.prompt).toBe(CREATION.prompt);
		expect(e.category).toBe('avatar');
		expect(e.previewImage).toBe(PREVIEW);
		expect(grokAskState(e).ready).toBe(true);
	});

	it('asks about the caption of a promptless pipeline creation that was described', () => {
		const e = modelShareEntity({ id: CREATION.id, prompt: '', pipeline: 'scan', described: { caption: 'A carved wooden owl.' } });
		expect(e.prompt).toBe('A carved wooden owl.');
		expect(grokAskState(e).ready).toBe(true);
	});

	it('still offers Ask @grok for a promptless creation nobody described, by its title', () => {
		const e = modelShareEntity({ id: CREATION.id, prompt: '', pipeline: 'scan' });
		expect('prompt' in e).toBe(false);
		expect(e.title).toBeTruthy();
		expect(grokAskState(e).ready).toBe(true);
	});
});

describe('the model page share panel', () => {
	it('shows Share on X and Ask @grok, both attributed and beaconed as model', () => {
		showSharePanel(modelShareEntity(CREATION, { previewImage: PREVIEW }));
		const x = document.querySelector('.tws-sp-x');
		const grok = document.querySelector('.tws-sp-grok');
		expect(x).toBeTruthy();
		expect(grok).toBeTruthy();
		expect(grok.getAttribute('aria-disabled')).toBeNull();
		for (const [a, campaign] of [[x, 'grok-share'], [grok, 'grok-ask']]) {
			const u = new URL(a.href);
			expect(u.origin + u.pathname).toBe('https://x.com/intent/post');
			const link = new URL(u.searchParams.get('url'));
			expect(link.pathname).toBe(`/m/${CREATION.id}`);
			expect(link.searchParams.get('utm_campaign')).toBe(campaign);
		}
		expect(new URL(grok.href).searchParams.get('text')).toMatch(/@grok$/);

		vi.spyOn(window, 'open').mockReturnValue({});
		grok.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
		expect(navigator.sendBeacon).toHaveBeenCalled();
	});

	it('is what the page Share button opens', () => {
		const src = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../src/model-page.js'), 'utf8');
		const handler = src.slice(src.indexOf("$('mp-share')"), src.indexOf("$('mp-remix')"));
		expect(handler).toMatch(/showSharePanel\(\s*modelShareEntity\(/);
		expect(handler).not.toMatch(/navigator\.share\(/);
	});
});

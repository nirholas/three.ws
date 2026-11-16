// @vitest-environment jsdom
// The shared share menu offers Teams and LinkedIn, opens a sized popup on a
// plain click, falls back to the anchor's new-tab navigation when the popup is
// blocked, and leaves modified clicks to the browser.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { showSharePanel } from '../src/shared/share.js';

const ENTITY = { kind: 'forge', id: '1', title: 'Robot', shareUrl: 'https://three.ws/m/abc', shareText: 'A robot' };

function open() {
	showSharePanel(ENTITY);
	return {
		teams: document.querySelector('[data-share-target="teams"]'),
		linkedin: document.querySelector('[data-share-target="linkedin"]'),
	};
}

beforeEach(() => {
	HTMLDialogElement.prototype.showModal ??= function () { this.setAttribute('open', ''); };
	HTMLDialogElement.prototype.close ??= function () { this.removeAttribute('open'); };
	document.body.innerHTML = '';
	globalThis.navigator.sendBeacon = vi.fn(() => true);
});

describe('share menu Microsoft targets', () => {
	it('renders both with the documented URLs', () => {
		const { teams, linkedin } = open();
		const t = new URL(teams.href);
		expect(t.origin + t.pathname).toBe('https://teams.microsoft.com/share');
		expect(t.searchParams.get('href')).toBe(ENTITY.shareUrl);
		expect(t.searchParams.get('msgText')).toBe('A robot');
		expect(new URL(linkedin.href).searchParams.get('url')).toBe(ENTITY.shareUrl);
		for (const a of [teams, linkedin]) {
			expect(a.target).toBe('_blank');
			expect(a.getAttribute('rel')).toContain('noopener');
		}
	});

	it('opens a sized popup, suppresses navigation and counts the action', () => {
		const { teams } = open();
		const spy = vi.spyOn(window, 'open').mockReturnValue({});
		const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
		teams.dispatchEvent(ev);
		expect(spy).toHaveBeenCalledOnce();
		expect(spy.mock.calls[0][2]).toMatch(/width=700,height=600/);
		expect(ev.defaultPrevented).toBe(true);
		expect(navigator.sendBeacon).toHaveBeenCalled();
	});

	it('lets the new-tab fallback run when the popup is blocked', () => {
		const { linkedin } = open();
		vi.spyOn(window, 'open').mockReturnValue(null);
		const ev = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 });
		linkedin.dispatchEvent(ev);
		expect(ev.defaultPrevented).toBe(false);
	});

	it('leaves ctrl-click to the browser', () => {
		const { linkedin } = open();
		const spy = vi.spyOn(window, 'open').mockReturnValue({});
		linkedin.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ctrlKey: true }));
		expect(spy).not.toHaveBeenCalled();
	});
});

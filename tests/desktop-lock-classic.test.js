// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { createBootScreen } from '../src/desktop/boot.js';

const snap = { steps: [], done: 0, total: 0, progress: 1, failed: [], complete: true };
const lockOpts = (mode, extra = {}) => ({ mode, snap, labels: {}, chips: [], ...extra });
const PLACES = [
	{ id: 'office', title: 'Your workstation', sub: 'Sit down to open the desktop', hue: 262, glyph: '<svg></svg>' },
	{ id: 'mine', title: 'The Mine', sub: 'Hold E at a vein to dig for gems', hue: 262 },
];

afterEach(() => {
	document.querySelectorAll('.os-boot').forEach((n) => n.remove());
	document.documentElement.classList.remove('os-lock-up');
});

describe('lock screen entry choices', () => {
	it('offers Continue, the alternate entry and the classic site', () => {
		const boot = createBootScreen({ reducedMotion: true });
		boot.toLock(lockOpts('desktop'));
		const labels = [...boot.el.querySelectorAll('.os-lock-actions button')].map((b) => b.textContent);
		expect(labels).toEqual(['Continue', 'Walk in as your avatar', 'Classic site']);
	});

	it('resolves "classic" when the classic site button is clicked', async () => {
		const boot = createBootScreen({ reducedMotion: true });
		const choice = boot.toLock(lockOpts('world'));
		boot.el.querySelector('.os-lock-classic').click();
		await expect(choice).resolves.toEqual({ to: 'classic' });
	});

	it('resolves the primary mode on Continue', async () => {
		const boot = createBootScreen({ reducedMotion: true });
		const choice = boot.toLock(lockOpts('desktop'));
		boot.el.querySelector('.os-lock-enter').click();
		await expect(choice).resolves.toEqual({ to: 'desktop' });
	});
});

describe('lock screen campus destinations', () => {
	it('renders one tile per place and hides the section when there are none', () => {
		const boot = createBootScreen({ reducedMotion: true });
		boot.toLock(lockOpts('world', { places: PLACES }));
		const tiles = [...boot.el.querySelectorAll('.os-lock-place')];
		expect(tiles.map((t) => t.dataset.place)).toEqual(['office', 'mine']);
		expect(tiles[1].querySelector('b').textContent).toBe('The Mine');
		expect(boot.el.querySelector('.os-lock-places').hidden).toBe(false);

		const bare = createBootScreen({ reducedMotion: true });
		bare.toLock(lockOpts('world'));
		expect(bare.el.querySelector('.os-lock-places').hidden).toBe(true);
	});

	it('walks the visitor in at the place they picked', async () => {
		const boot = createBootScreen({ reducedMotion: true });
		const choice = boot.toLock(lockOpts('desktop', { places: PLACES }));
		boot.el.querySelector('[data-place="mine"]').click();
		await expect(choice).resolves.toEqual({ to: 'world', at: 'mine' });
	});

	it('lets Enter on a focused tile pick that tile instead of the primary entry', () => {
		const boot = createBootScreen({ reducedMotion: true });
		boot.toLock(lockOpts('world', { places: PLACES }));
		const tile = boot.el.querySelector('[data-place="office"]');
		const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
		tile.dispatchEvent(ev);
		expect(ev.defaultPrevented).toBe(false);
	});

	it('treats any other key as the primary entry', async () => {
		const boot = createBootScreen({ reducedMotion: true });
		const choice = boot.toLock(lockOpts('world', { places: PLACES }));
		dispatchEvent(new KeyboardEvent('keydown', { key: 'a', cancelable: true }));
		await expect(choice).resolves.toEqual({ to: 'world' });
	});
});

describe('lock screen presentation', () => {
	it('hides the desktop behind the lock until dismissed', async () => {
		const boot = createBootScreen({ reducedMotion: true });
		boot.toLock(lockOpts('world'));
		expect(document.documentElement.classList.contains('os-lock-up')).toBe(true);
		expect(boot.el.classList.contains('is-locked')).toBe(true);
		await boot.dismiss();
		expect(document.documentElement.classList.contains('os-lock-up')).toBe(false);
		expect(boot.el.isConnected).toBe(false);
	});

	it('colours the market chip by direction and flags a degraded boot', () => {
		const boot = createBootScreen({ reducedMotion: true });
		boot.toLock(
			lockOpts('world', {
				snap: { ...snap, failed: ['market'] },
				labels: { market: '$THREE feed' },
				chips: [{ label: '$THREE', value: '$0.000476 -7.8%', tone: 'down' }, { label: 'Account', value: 'Guest' }],
			}),
		);
		const chips = [...boot.el.querySelectorAll('.os-lock-chip')];
		expect(chips[0].dataset.tone).toBe('down');
		expect(chips[1].dataset.tone).toBeUndefined();
		const status = boot.el.querySelector('.os-lock-status');
		expect(status.dataset.ok).toBe('false');
		expect(status.textContent).toBe('$THREE feed is offline. Everything else is up.');
	});

	it('shows the walking body as the portrait, and initials when there is none', () => {
		const boot = createBootScreen({ reducedMotion: true });
		boot.toLock(lockOpts('world', { portrait: '/avatars/default-poster.webp', initials: 'AB' }));
		const av = boot.el.querySelector('.os-lock-avatar');
		expect(av.classList.contains('has-portrait')).toBe(true);
		expect(av.querySelector('img').getAttribute('src')).toBe('/avatars/default-poster.webp');

		const named = createBootScreen({ reducedMotion: true });
		named.toLock(lockOpts('desktop', { initials: 'AB' }));
		expect(named.el.querySelector('.os-lock-avatar').textContent).toBe('AB');

		const guest = createBootScreen({ reducedMotion: true });
		guest.toLock(lockOpts('desktop', { initials: '?' }));
		expect(guest.el.querySelector('.os-lock-avatar').textContent).toBe('');
	});
});

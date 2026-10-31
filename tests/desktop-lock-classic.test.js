// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createBootScreen } from '../src/desktop/boot.js';

const snap = { steps: [], done: 0, total: 0, progress: 1, failed: [], complete: true };
const lockOpts = (mode) => ({ mode, snap, labels: {}, chips: [] });

describe('lock screen entry choices', () => {
	it('offers Continue, the alternate entry and the classic site', () => {
		const boot = createBootScreen({ reducedMotion: true });
		boot.toLock(lockOpts('desktop'));
		const labels = [...boot.el.querySelectorAll('.os-lock-actions button')].map((b) => b.textContent);
		expect(labels).toEqual(['Continue', 'Walk in as your avatar', 'Classic site']);
		boot.el.remove();
	});

	it('resolves "classic" when the classic site button is clicked', async () => {
		const boot = createBootScreen({ reducedMotion: true });
		const choice = boot.toLock(lockOpts('world'));
		boot.el.querySelector('.os-lock-classic').click();
		await expect(choice).resolves.toBe('classic');
		boot.el.remove();
	});

	it('resolves the primary mode on Continue', async () => {
		const boot = createBootScreen({ reducedMotion: true });
		const choice = boot.toLock(lockOpts('desktop'));
		boot.el.querySelector('.os-lock-enter').click();
		await expect(choice).resolves.toBe('desktop');
		boot.el.remove();
	});
});

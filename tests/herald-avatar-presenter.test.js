import { describe, it, expect, vi } from 'vitest';
import { createAvatarPresenter } from '../herald-sdk/src/presenters/avatar.js';
import { createHerald } from '../herald-sdk/src/index.js';

describe('avatar presenter dwell', () => {
	it('keeps present() pending for dwellMs when the companion returns as soon as the line is up', async () => {
		vi.useFakeTimers();
		try {
			const companion = { announce: vi.fn(async () => true) };
			const p = createAvatarPresenter({ companion });
			let done = false;
			const run = p.present({ text: 'Payment received', tone: 'neutral' }, { dwellMs: 5000 }).then((r) => {
				done = true;
				return r;
			});
			await vi.advanceTimersByTimeAsync(4900);
			expect(done).toBe(false);
			await vi.advanceTimersByTimeAsync(200);
			expect(await run).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});

	it('does not wait when no avatar could be shown', async () => {
		const p = createAvatarPresenter({ companion: { announce: async () => false } });
		expect(await p.present({ text: 'x' }, { dwellMs: 60000 })).toBe(false);
	});
});

describe('reduced motion', () => {
	it('uses the card presenter when the visitor prefers reduced motion', async () => {
		const mk = (name) => ({ name, ready: async () => true, present: vi.fn(async () => true), stop() {} });
		const avatar = mk('avatar');
		const card = mk('card');
		const herald = createHerald({
			presenters: { avatar, card },
			prefersReducedMotion: () => true,
		});
		herald.announce({ text: 'Quiet please', importance: 80 });
		await new Promise((r) => setTimeout(r, 50));
		expect(card.present).toHaveBeenCalledTimes(1);
		expect(avatar.present).not.toHaveBeenCalled();
		herald.stop?.();
	});
});

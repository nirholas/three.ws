// Meetup #3 client audit (failure states): when the wall's first load failed the
// world never asked again (polling only ran once data had loaded, and the load
// only ran on walking into range), and the sign panel claimed "0 names so far"
// when the count was simply unknown.

import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/game/signature-wall.css', () => ({}));
vi.mock('../src/game/screen-texture.js', () => ({ makeScreenTexture: () => ({}), screenMaterial: () => ({}) }));
vi.mock('../src/game/signature-wall-canvas.js', () => ({ WallPainter: class {} }));

const { needsLoadRetry, wallSubtitle } = await import('../src/game/signature-wall.js');

describe('signature wall first-load failure', () => {
	it('retries the first load once the retry time passes while the player is near', () => {
		expect(needsLoadRetry({ awake: true, loaded: false, loading: false, now: 10_000, retryAt: 9_000 })).toBe(true);
	});
	it('does not stack a retry on a load already in flight, or before its time', () => {
		expect(needsLoadRetry({ awake: true, loaded: false, loading: true, now: 10_000, retryAt: 9_000 })).toBe(false);
		expect(needsLoadRetry({ awake: true, loaded: false, loading: false, now: 8_000, retryAt: 9_000 })).toBe(false);
	});
	it('does not retry once loaded, or while the player is out of range', () => {
		expect(needsLoadRetry({ awake: true, loaded: true, loading: false, now: 10_000, retryAt: 9_000 })).toBe(false);
		expect(needsLoadRetry({ awake: false, loaded: false, loading: false, now: 10_000, retryAt: 9_000 })).toBe(false);
	});
	it('never tells a signer there are 0 names when the count did not load', () => {
		expect(wallSubtitle(false, 0)).not.toMatch(/\b0 names\b/);
		expect(wallSubtitle(true, 1234)).toMatch(/1,234 names so far/);
	});
});

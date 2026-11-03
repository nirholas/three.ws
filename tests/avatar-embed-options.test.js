import { describe, it, expect, vi } from 'vitest';
import { isOverlayMode, startRestingPose } from '../src/avatar-embed-options.js';

const q = (s) => new URLSearchParams(s);

describe('isOverlayMode', () => {
	it('accepts overlay=1 and chrome=0', () => {
		expect(isOverlayMode(q('overlay=1'))).toBe(true);
		expect(isOverlayMode(q('chrome=0'))).toBe(true);
	});
	it('accepts overlayMode=1, which the live and exchange pages send', () => {
		expect(isOverlayMode(q('overlayMode=1'))).toBe(true);
	});
	it('is off by default', () => {
		expect(isOverlayMode(q('model=a.glb'))).toBe(false);
		expect(isOverlayMode(q('overlayMode=0'))).toBe(false);
	});
});

describe('startRestingPose', () => {
	const mgr = (current = null) => ({
		currentAction: current,
		ensureLoaded: vi.fn().mockResolvedValue(true),
		play: vi.fn().mockResolvedValue(undefined),
	});

	it('plays the idle clip when nothing else is playing', async () => {
		const m = mgr();
		await startRestingPose(m);
		expect(m.ensureLoaded).toHaveBeenCalledWith('idle');
		expect(m.play).toHaveBeenCalledWith('idle');
	});
	it('does not override a clip a caller already started', async () => {
		const m = mgr({});
		await startRestingPose(m);
		expect(m.play).not.toHaveBeenCalled();
	});
	it('leaves the authored pose when the idle clip cannot load', async () => {
		const m = mgr();
		m.ensureLoaded.mockRejectedValue(new Error('404'));
		await expect(startRestingPose(m)).resolves.toBeUndefined();
		expect(m.play).not.toHaveBeenCalled();
	});
});

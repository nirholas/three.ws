// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// The first pose a freshly loaded <agent-3d> body takes. The renderer paints a
// rig the moment its GLB lands, in its bind pose (a T-pose), and the idle clip
// only takes over once it is fetched and retargeted; the clip then used to fade
// in from that bind pose. Every bare embed opened on a T-pose with its arms
// swinging down, which the /spotlight filming run caught on 2026-10-01. Boot now
// holds the stage hidden (`.stage.is-settling`) and snaps the first clip in
// (fade 0) before revealing it.
vi.mock('../../src/viewer.js', () => ({ Viewer: class {} }));
vi.mock('dat.gui', () => ({
	GUI: class {
		addFolder() { return this; }
		add() { return { onChange: () => this, name: () => this }; }
		addColor() { return { onChange: () => this, name: () => this }; }
		destroy() {}
	},
}));

import '../../src/element.js';

function rigged(el, { defs = [{ name: 'idle', loop: true }] } = {}) {
	const scene = { playClipByName: vi.fn(() => true) };
	const am = {
		getAnimationDefs: () => defs,
		ensureLoaded: vi.fn(async () => true),
		playOnce: vi.fn(async () => {}),
	};
	el._scene = scene;
	el._viewer = { animationManager: am, invalidate: vi.fn() };
	return { scene, am };
}

beforeEach(() => {
	vi.stubGlobal('requestAnimationFrame', (cb) => setTimeout(() => cb(performance.now()), 0));
	vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('<agent-3d> first pose after a body loads', () => {
	it('hides the stage while settling, in the shadow stylesheet', () => {
		const el = document.createElement('agent-3d');
		document.body.appendChild(el);
		const css = [...el.shadowRoot.querySelectorAll('style')].map((s) => s.textContent).join('\n');
		expect(css).toMatch(/\.stage\.is-settling\s*\{\s*opacity:\s*0/);
		el.remove();
	});

	it('snaps a bare avatar into idle instead of fading in from the bind pose', async () => {
		const el = document.createElement('agent-3d');
		const { scene } = rigged(el);
		await el._startInitialPlayback();
		expect(scene.playClipByName).toHaveBeenCalledWith('idle', { loop: true, fade_ms: 0 });
		expect(el._viewer.invalidate).toHaveBeenCalled();
	});

	it('snaps a chat agent into idle the same way', async () => {
		const el = document.createElement('agent-3d');
		el.setAttribute('chat', '');
		expect(el._isChatMode()).toBe(true);
		const { scene } = rigged(el);
		await el._startInitialPlayback();
		expect(scene.playClipByName).toHaveBeenCalledWith('idle', { loop: true, fade_ms: 0 });
	});

	it('fetches a requested one-shot clip before the reveal and settles with a real crossfade', async () => {
		const el = document.createElement('agent-3d');
		el.setAttribute('clip', 'wave');
		const { am } = rigged(el, {
			defs: [
				{ name: 'idle', loop: true },
				{ name: 'wave', loop: false },
			],
		});
		await el._startInitialPlayback();
		expect(am.ensureLoaded).toHaveBeenCalledWith('wave');
		expect(am.playOnce).toHaveBeenCalledWith('wave', { settleTo: 'idle', fade: 0.4, fadeIn: 0 });
	});

	it('keeps the default crossfade for clip changes after boot', () => {
		const el = document.createElement('agent-3d');
		const { scene } = rigged(el);
		el._startDecorationPlayback();
		expect(scene.playClipByName).toHaveBeenCalledWith('idle', { loop: true, fade_ms: 400 });
	});
});

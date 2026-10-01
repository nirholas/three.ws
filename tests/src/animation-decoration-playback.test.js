import { describe, it, expect, vi } from 'vitest';
import { EventDispatcher } from 'three';
import { AnimationManager } from '../../src/animation-manager.js';

// These tests cover the "seamless looping" core of the embed/home avatar UX:
// a one-shot clip (manifest loop:false, e.g. celebrate/wave) must NOT clamp and
// freeze on its final frame — it plays once, then crossfades into the looping
// settle clip (idle), so a small silent thumbnail never hard-snaps at the loop
// boundary. `freeze()` backs the prefers-reduced-motion path: hold a clean pose
// and release the active action so the host render loop can idle.
//
// AnimationManager.playOnce()/crossfadeTo()/freeze() drive a real
// THREE.AnimationMixer + AnimationActions at runtime. Here we stand in
// lightweight doubles for those three primitives (the same approach the
// canonical-support test uses with a fake model) so the manager's own decision
// logic — not three's mixer internals — is what's under test. The mixer double
// is a real EventDispatcher so the `finished` event the settle relies on is the
// genuine three event channel.

function fakeAction(name) {
	return {
		name,
		enabled: true,
		paused: false,
		clampWhenFinished: false,
		_loop: null,
		_played: false,
		reset() {
			this._played = false;
			return this;
		},
		play() {
			this._played = true;
			return this;
		},
		stop() {
			this._played = false;
			return this;
		},
		fadeIn() {
			return this;
		},
		fadeOut() {
			return this;
		},
		setLoop(mode) {
			this._loop = mode;
			return this;
		},
		crossFadeTo() {
			return this;
		},
		getClip() {
			return { name, tracks: [] };
		},
	};
}

// Seed a manager with named actions/clips already "loaded", and a real
// EventDispatcher mixer. model + canonical map stay null so the fallen-pose
// guard (which needs a real rig to sample) is a no-op — every clip is "safe".
function seedManager(names) {
	const mgr = new AnimationManager();
	mgr.mixer = new EventDispatcher();
	mgr.model = null;
	mgr._canonicalToNode = null;
	mgr._animationDefs = names.map((name) => ({
		name,
		url: `/animations/clips/${name}.json`,
		loop: name === 'idle',
	}));
	for (const name of names) {
		const clip = { name, tracks: [] };
		mgr.clips.set(name, clip);
		mgr.actions.set(name, fakeAction(name));
	}
	return mgr;
}

describe('AnimationManager.playOnce (one-shot → settle, no hard snap)', () => {
	it('plays the one-shot as LoopOnce and clamps until the settle picks up', async () => {
		const mgr = seedManager(['celebrate', 'idle']);
		await mgr.playOnce('celebrate', { settleTo: 'idle', fade: 0.2 });

		const celebrate = mgr.actions.get('celebrate');
		expect(mgr.currentName).toBe('celebrate');
		// LoopOnce === 2200 in three; clampWhenFinished holds the final frame so
		// the settle crossfade has something to fade from instead of a frame-0 snap.
		expect(celebrate._loop).toBe(2200);
		expect(celebrate.clampWhenFinished).toBe(true);
		expect(celebrate._played).toBe(true);
	});

	it('crossfades into the settle clip when the one-shot finishes', async () => {
		const mgr = seedManager(['celebrate', 'idle']);
		const crossfadeSpy = vi.spyOn(mgr, 'crossfadeTo');
		await mgr.playOnce('celebrate', { settleTo: 'idle', fade: 0.3 });
		crossfadeSpy.mockClear(); // ignore any crossfade during the initial play

		const celebrate = mgr.actions.get('celebrate');
		// three fires `finished` with the originating action when a LoopOnce action
		// completes; the settle listener reacts only to its own action.
		mgr.mixer.dispatchEvent({ type: 'finished', action: celebrate });

		expect(crossfadeSpy).toHaveBeenCalledWith('idle', 0.3);
	});

	it('ignores a finished event for a different action', async () => {
		const mgr = seedManager(['celebrate', 'idle', 'wave']);
		await mgr.playOnce('celebrate', { settleTo: 'idle' });
		const crossfadeSpy = vi.spyOn(mgr, 'crossfadeTo');

		mgr.mixer.dispatchEvent({ type: 'finished', action: mgr.actions.get('wave') });
		expect(crossfadeSpy).not.toHaveBeenCalled();
	});

	it('does not settle if another clip took over before the one-shot finished', async () => {
		const mgr = seedManager(['celebrate', 'idle', 'dance']);
		await mgr.playOnce('celebrate', { settleTo: 'idle' });
		const celebrate = mgr.actions.get('celebrate');

		// Something else (e.g. a user pill click) grabbed the avatar mid-clip.
		mgr.currentAction = mgr.actions.get('dance');
		mgr.currentName = 'dance';
		const crossfadeSpy = vi.spyOn(mgr, 'crossfadeTo');

		mgr.mixer.dispatchEvent({ type: 'finished', action: celebrate });
		expect(crossfadeSpy).not.toHaveBeenCalled();
	});

	it('snaps a one-shot in with fadeIn 0 but still settles with the full fade', async () => {
		// A freshly loaded body has nothing playing, so fading in means fading
		// from the bind pose: <agent-3d> starts its first clip with fadeIn 0.
		const mgr = seedManager(['celebrate', 'idle']);
		const celebrate = mgr.actions.get('celebrate');
		const fadeInSpy = vi.spyOn(celebrate, 'fadeIn');
		const crossfadeSpy = vi.spyOn(mgr, 'crossfadeTo');
		await mgr.playOnce('celebrate', { settleTo: 'idle', fade: 0.4, fadeIn: 0 });
		expect(fadeInSpy).toHaveBeenCalledWith(0);

		mgr.mixer.dispatchEvent({ type: 'finished', action: celebrate });
		expect(crossfadeSpy).toHaveBeenCalledWith('idle', 0.4);
	});

	it('snaps straight into the settle clip when a snapped one-shot is unavailable', async () => {
		const mgr = seedManager(['idle']);
		const crossfadeSpy = vi.spyOn(mgr, 'crossfadeTo');
		await mgr.playOnce('celebrate', { settleTo: 'idle', fade: 0.4, fadeIn: 0 });
		expect(crossfadeSpy).toHaveBeenCalledWith('idle', 0);
	});

	it('settles into the fallback clip when the one-shot is unavailable on the rig', async () => {
		const mgr = seedManager(['idle']); // celebrate not loaded / unsupported
		const crossfadeSpy = vi.spyOn(mgr, 'crossfadeTo');
		await mgr.playOnce('celebrate', { settleTo: 'idle', fade: 0.25 });
		// Never leave the avatar frozen in bind pose — fall straight to idle.
		expect(crossfadeSpy).toHaveBeenCalledWith('idle', 0.25);
	});
});

describe('AnimationManager.freeze (reduced-motion hold)', () => {
	it('pauses the active action and releases it so the render loop can idle', async () => {
		const mgr = seedManager(['idle']);
		await mgr.crossfadeTo('idle', 0);
		const idle = mgr.actions.get('idle');
		expect(mgr.currentAction).toBe(idle);

		mgr.freeze();
		// Held pose: the action stays paused (keeps applying its pose on any later
		// tick) but is no longer the "current" action, so nothing schedules frames.
		expect(idle.paused).toBe(true);
		expect(mgr.currentAction).toBeNull();
		expect(mgr.currentName).toBeNull();
	});

	it('is a no-op when nothing is playing', () => {
		const mgr = seedManager(['idle']);
		expect(() => mgr.freeze()).not.toThrow();
		expect(mgr.currentAction).toBeNull();
	});
});

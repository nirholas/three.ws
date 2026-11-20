// The caller owns the mouth target. TalkController hands it to a fresh
// LipsyncDriver for every spoken reply, and LipsyncDriver.dispose() disposes
// its target, so tearing the previous driver down with dispose() unbound the
// avatar's morphs and jaw: the first reply moved the mouth, every reply after
// it (and every reply after a barge-in) played with a frozen face. These tests
// speak real turns through the controller and assert the target survives.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AvatarMouthTarget } from '../src/voice/avatar-morph-target.js';
import { TalkController } from '../src/voice/talk-controller.js';

// Smallest Web Audio surface tapAudioElement() and LipsyncDriver touch.
class FakeAnalyser {
	constructor() {
		this.fftSize = 256;
		this.frequencyBinCount = 128;
		this.smoothingTimeConstant = 0;
	}
	getByteFrequencyData(arr) {
		arr.fill(180);
	}
	connect() {}
	disconnect() {}
}
class FakeAudioContext {
	constructor() {
		this.state = 'running';
		this.destination = {};
	}
	createMediaElementSource() {
		return { connect() {}, disconnect() {} };
	}
	createAnalyser() {
		return new FakeAnalyser();
	}
	resume() {
		return Promise.resolve();
	}
}
class FakeAudio {
	constructor() {
		this.onended = null;
		this.onerror = null;
		FakeAudio.last = this;
	}
	play() {
		return Promise.resolve();
	}
	pause() {}
	removeAttribute() {}
	load() {}
}

// A real AvatarMouthTarget bound to a minimal three.js-shaped skinned mesh with
// a jawOpen morph, so "is the mouth still driven" is read off the morph weight
// rather than off a spy.
function boundMouthTarget() {
	const mesh = {
		isMesh: true,
		morphTargetDictionary: { jawOpen: 0, mouthSmile: 1, mouthPucker: 2 },
		morphTargetInfluences: [0, 0, 0],
	};
	const root = {
		traverse(fn) {
			fn(root);
			fn(mesh);
		},
	};
	const target = new AvatarMouthTarget();
	target.attach(root);
	return { target, mesh };
}

describe('TalkController keeps the caller-owned mouth target alive across turns', () => {
	let saved;
	beforeEach(() => {
		saved = {
			window: globalThis.window,
			Audio: globalThis.Audio,
			raf: globalThis.requestAnimationFrame,
			caf: globalThis.cancelAnimationFrame,
			createObjectURL: URL.createObjectURL,
			revokeObjectURL: URL.revokeObjectURL,
		};
		globalThis.window = { AudioContext: FakeAudioContext };
		globalThis.Audio = FakeAudio;
		globalThis.requestAnimationFrame = () => 1;
		globalThis.cancelAnimationFrame = () => {};
		URL.createObjectURL = () => 'blob:tts';
		URL.revokeObjectURL = () => {};
	});
	afterEach(() => {
		globalThis.window = saved.window;
		globalThis.Audio = saved.Audio;
		globalThis.requestAnimationFrame = saved.raf;
		globalThis.cancelAnimationFrame = saved.caf;
		URL.createObjectURL = saved.createObjectURL;
		URL.revokeObjectURL = saved.revokeObjectURL;
	});

	function controllerWith(target) {
		const c = new TalkController({
			avatar: { id: 'avatar-1', name: 'Test' },
			systemPromptFn: () => 'You are a test avatar.',
			mouthTarget: target,
			onError: (e) => {
				throw e;
			},
		});
		c._resolveVoice = async () => null;
		c._fetchTtsFallback = async () => new Blob([new Uint8Array(8)], { type: 'audio/mpeg' });
		return c;
	}

	it('drives the mouth on the second reply, not just the first', async () => {
		const { target, mesh } = boundMouthTarget();
		const c = controllerWith(target);
		const dispose = vi.spyOn(target, 'dispose');

		await c.speakText('First reply.');
		FakeAudio.last.onended();
		await c.speakText('Second reply.');

		expect(dispose).not.toHaveBeenCalled();
		c._driver._step();
		expect(mesh.morphTargetInfluences[0]).toBeGreaterThan(0);
	});

	it('still drives the mouth on the turn after a barge-in', async () => {
		const { target, mesh } = boundMouthTarget();
		const c = controllerWith(target);

		await c.speakText('A reply that gets interrupted.');
		c.hush();
		await c.speakText('The next reply.');

		c._driver._step();
		expect(mesh.morphTargetInfluences[0]).toBeGreaterThan(0);
	});
});

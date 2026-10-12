/**
 * AgentAvatar, active-listening idle reactions (Stage 2c of `_tickEmotion()`).
 *
 * `_onListenStart`/`_onListenEnd` are the handlers the protocol bus invokes
 * when a real VAD/STT signal fires (never a fabricated loading timer); see
 * `_sub(ACTION_TYPES.LISTEN_START, ...)` in `attach()`. Called directly here,
 * mirroring the direct-`_tickEmotion()` approach in
 * tests/agent-avatar-mood-gesture.test.js, so no protocol bus or DOM is needed.
 */

import { describe, it, expect, beforeEach } from 'vitest';

let AgentAvatar;

function makeRoot() {
	return {
		isObject3D: true,
		children: [],
		traverse(fn) {
			fn(this);
		},
	};
}

function makeFakeAnimationManager(loadedNames = []) {
	const loaded = new Set(loadedNames);
	const played = [];
	return {
		currentName: null,
		isLoaded: (name) => loaded.has(name),
		getAnimationDefs: () => [],
		play: (name) => {
			played.push(name);
			return Promise.resolve(true);
		},
		crossfadeTo: (name) => {
			played.push(name);
		},
		played,
	};
}

function makeFakeViewer(am) {
	return {
		content: makeRoot(),
		animationManager: am,
		state: {},
	};
}

function makeAvatar(am) {
	const viewer = makeFakeViewer(am);
	const protocol = {}; // _onListenStart/_onListenEnd are called directly, bus unused
	const identity = { id: 'test' };
	return new AgentAvatar(viewer, protocol, identity);
}

beforeEach(async () => {
	if (!AgentAvatar) {
		const mod = await import('../src/agent-avatar.js');
		AgentAvatar = mod.AgentAvatar;
	}
});

describe('AgentAvatar, active-listening wiring', () => {
	it('_onListenStart sets the attentive-gaze flag the head-transform priority chain reads', () => {
		const avatar = makeAvatar(makeFakeAnimationManager(['nod']));
		expect(avatar._userSpeaking).toBe(false);
		avatar._onListenStart();
		expect(avatar._userSpeaking).toBe(true);
	});

	it('_onListenEnd clears the attentive-gaze flag', () => {
		const avatar = makeAvatar(makeFakeAnimationManager(['nod']));
		avatar._onListenStart();
		avatar._onListenEnd();
		expect(avatar._userSpeaking).toBe(false);
	});

	it('nods on a fixed cadence while the user speaks, driven only by setUserSpeaking (no timer of its own)', () => {
		const am = makeFakeAnimationManager(['nod']);
		const avatar = makeAvatar(am);

		avatar._onListenStart();
		// LISTENING_NOD_INTERVAL_S is 2.8s: tick just under it, nothing yet.
		avatar._tickEmotion(2.7);
		expect(am.played).not.toContain('nod');

		// Cross the threshold: one nod fires.
		avatar._tickEmotion(0.2);
		expect(am.played.filter((n) => n === 'nod')).toHaveLength(1);
	});

	it('stops nodding immediately once the user stops speaking', () => {
		const am = makeFakeAnimationManager(['nod']);
		const avatar = makeAvatar(am);

		avatar._onListenStart();
		avatar._tickEmotion(2.9); // one nod fires
		expect(am.played.filter((n) => n === 'nod')).toHaveLength(1);

		avatar._onListenEnd();
		am.played.length = 0;
		avatar._tickEmotion(10); // would have nodded 3x more if still "listening"
		expect(am.played).not.toContain('nod');
	});

	it('never nods when the user never speaks (idle avatar, no real signal)', () => {
		const am = makeFakeAnimationManager(['nod']);
		const avatar = makeAvatar(am);

		for (let i = 0; i < 20; i++) avatar._tickEmotion(1);
		expect(am.played).not.toContain('nod');
	});

	it('defers the backchannel nod while a higher-priority one-shot gesture is already playing', () => {
		const am = makeFakeAnimationManager(['nod', 'wave']);
		const avatar = makeAvatar(am);

		avatar._onListenStart();
		avatar._playSlot('wave', 5.0); // long one-shot in flight, sets _isPlayingOneShot
		am.played.length = 0;

		avatar._tickEmotion(3.0); // would cross the nod threshold if unblocked
		expect(am.played).not.toContain('nod');
	});
});

/**
 * AgentAvatar, emoji in agent text maps to expression.
 *
 * `_onSpeak()` runs every outgoing utterance through `_analyzeSentiment()`
 * and injects the resulting valence/arousal into `_emotion` (celebration,
 * concern, curiosity, ...), which Stage 4 of `_tickEmotion()` renders onto
 * the avatar's face. Before this fix, `_analyzeSentiment()` only scored a
 * plain-English keyword VOCAB, so a reply carrying nothing but emoji (e.g.
 * "🎉" or "😢" with no English sentiment words) produced zero emotional
 * signal and the avatar stayed neutral regardless of what the emoji said.
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

function makeFakeAnimationManager() {
	return {
		currentName: null,
		isLoaded: () => false,
		getAnimationDefs: () => [],
		play: () => Promise.resolve(true),
		crossfadeTo: () => {},
	};
}

function makeFakeViewer() {
	return {
		content: makeRoot(),
		animationManager: makeFakeAnimationManager(),
		state: {},
	};
}

function makeAvatar() {
	const viewer = makeFakeViewer();
	const protocol = {}; // _onSpeak is called directly, bus unused
	const identity = { id: 'test' };
	return new AgentAvatar(viewer, protocol, identity);
}

beforeEach(async () => {
	if (!AgentAvatar) {
		const mod = await import('../src/agent-avatar.js');
		AgentAvatar = mod.AgentAvatar;
	}
});

describe('AgentAvatar, emoji in agent text maps to expression', () => {
	it('a celebratory emoji with no English sentiment words still raises celebration', () => {
		const avatar = makeAvatar();
		expect(avatar._emotion.celebration).toBe(0);
		avatar._onSpeak({ payload: { text: 'here you go 🎉' } });
		expect(avatar._emotion.celebration).toBeGreaterThan(0.1);
	});

	it('a sad emoji with no English sentiment words raises concern', () => {
		const avatar = makeAvatar();
		expect(avatar._emotion.concern).toBe(0);
		avatar._onSpeak({ payload: { text: 'that did not work out 😢' } });
		expect(avatar._emotion.concern).toBeGreaterThan(0.1);
	});

	it('an emoji glued directly to punctuation with no space still registers', () => {
		// VOCAB's single-token matching splits on whitespace, so an emoji
		// butted up against punctuation (no space) must not be missed.
		const avatar = makeAvatar();
		avatar._onSpeak({ payload: { text: 'done!🎉' } });
		expect(avatar._emotion.celebration).toBeGreaterThan(0.1);
	});

	it('a thinking emoji raises curiosity/arousal, mirroring a question mark', () => {
		const avatar = makeAvatar();
		avatar._onSpeak({ payload: { text: 'let me look into that 🤔' } });
		expect(avatar._emotion.curiosity).toBeGreaterThan(0.1);
	});

	it('plain text with no emoji and no keywords stays neutral (no false positives)', () => {
		const avatar = makeAvatar();
		avatar._onSpeak({ payload: { text: 'the quick brown fox jumps over the lazy dog' } });
		expect(avatar._emotion.celebration).toBe(0);
		expect(avatar._emotion.concern).toBe(0);
	});
});

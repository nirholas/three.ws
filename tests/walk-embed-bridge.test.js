// The walk embed's postMessage bridge forwards exactly the outbound fields its
// documented contract promises, and nothing else.
//
// Regression: the contract (src/walk-embed-events.js, docs/tutorials/
// walk-companion.md) says walk:error carries `fallback: true` when the default
// body is standing in, and walk:gesture carries `played: false` when the body
// cannot perform the gesture. The bridge whitelisted only { code, message } and
// { gesture }, so a host (the /pocket screen) never learned the embed had fallen
// back and treated it as a fatal boot failure, and never learned a wave did not
// play.

import { describe, it, expect } from 'vitest';
import { installEmbedBridge, OUTBOUND } from '../src/walk-embed-events.js';

function harness() {
	const listeners = new Map();
	const runtime = {
		on(event, cb) {
			listeners.set(event, cb);
			return () => listeners.delete(event);
		},
	};
	const posted = [];
	const parent = { postMessage: (msg) => posted.push(msg) };
	const win = { parent, addEventListener() {}, removeEventListener() {} };
	installEmbedBridge(runtime, { win });
	const fire = (event, payload) => listeners.get(event)(payload);
	return { fire, posted };
}

describe('walk embed bridge outbound fields', () => {
	it('tells the host the default body is standing in', () => {
		const { fire, posted } = harness();
		fire(OUTBOUND.ERROR, { code: 'avatar_not_animatable', message: 'cannot drive', fallback: true });
		expect(posted.pop()).toMatchObject({ type: 'walk:error', code: 'avatar_not_animatable', message: 'cannot drive', fallback: true });
	});

	it('leaves fallback off a fatal error', () => {
		const { fire, posted } = harness();
		fire(OUTBOUND.ERROR, { code: 'boot_failed', message: 'no webgl' });
		expect(posted.pop()).not.toHaveProperty('fallback');
	});

	it('says whether a gesture actually played', () => {
		const { fire, posted } = harness();
		fire(OUTBOUND.GESTURE, { gesture: 'wave', played: false });
		expect(posted.pop()).toMatchObject({ type: 'walk:gesture', gesture: 'wave', played: false });
		fire(OUTBOUND.GESTURE, { gesture: 'jump', played: true });
		expect(posted.pop()).toMatchObject({ gesture: 'jump', played: true });
	});

	it('never forwards internal fields the contract does not name', () => {
		const { fire, posted } = harness();
		fire(OUTBOUND.GESTURE, { gesture: 'wave', played: 'yes', clip: { internal: true } });
		const msg = posted.pop();
		expect(msg).not.toHaveProperty('clip');
		expect(msg).not.toHaveProperty('played');
		fire(OUTBOUND.ERROR, { code: 'x', message: 'y', fallback: 'sure', stack: 'secret' });
		const err = posted.pop();
		expect(err).not.toHaveProperty('stack');
		expect(err).not.toHaveProperty('fallback');
	});
});

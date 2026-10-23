// WebXR floor-anchor lifecycle policy (src/ar/anchor-lifecycle.js).
//
// AR's production readiness is entirely about the unhappy paths — the device
// loses tracking, the app gets backgrounded, an anchor can't be created, the
// user taps before the first GPS fix. These tests pin every one of those rules
// against plain values, with no XRSession, no Three.js, no real clock, so the
// recovery behaviour is proven here rather than on a phone:
//   (1) tracking loss is transition-only and survives a one-frame blip;
//   (2) visibility classification matches the WebXR enum;
//   (3) placement copy is honest about a degraded (driftable) anchor;
//   (4) a placement's durable pin saves EXACTLY once — never zero, never twice —
//       whether the fix is live, lands later, or never comes (the headline
//       tap-during-GPS-warm-up scenario from task 05).

import { describe, it, expect, vi } from 'vitest';

import {
	TRACKING_LOSS_FRAMES,
	nextTrackingState,
	XR_PAUSED_STATES,
	isXrVisible,
	placementHint,
	createPersistGate,
	reticleVisual,
	advancePulse,
	RETICLE_PULSE_SECONDS,
} from '../packages/ar-studio/src/studio/anchor-lifecycle.js';

describe('nextTrackingState — transition-only tracking loss', () => {
	it('a single missed frame does not declare loss (blip tolerance)', () => {
		const r = nextTrackingState({ misses: 0, lost: false }, false, 3);
		expect(r.lost).toBe(false);
		expect(r.changed).toBe(false);
		expect(r.state).toEqual({ misses: 1, lost: false });
	});

	it('declares loss exactly when the miss streak reaches the threshold', () => {
		let s = { misses: 0, lost: false };
		let last;
		for (let i = 0; i < 3; i++) {
			last = nextTrackingState(s, false, 3);
			s = last.state;
		}
		expect(last.lost).toBe(true);
		expect(last.changed).toBe(true);          // fires once, on the crossing frame
		expect(s).toEqual({ misses: 3, lost: true });
	});

	it('stays lost without re-firing changed on subsequent pose-less frames', () => {
		let s = { misses: 3, lost: true };
		const r = nextTrackingState(s, false, 3);
		expect(r.lost).toBe(true);
		expect(r.changed).toBe(false);            // already lost — no repeat callback
		expect(r.state.misses).toBe(4);
	});

	it('recovers the instant a pose returns and fires changed once', () => {
		const r = nextTrackingState({ misses: 5, lost: true }, true, 3);
		expect(r.lost).toBe(false);
		expect(r.changed).toBe(true);             // lost → recovered transition
		expect(r.state).toEqual({ misses: 0, lost: false });
	});

	it('a pose while already healthy is a no-op transition', () => {
		const r = nextTrackingState({ misses: 0, lost: false }, true, 3);
		expect(r.changed).toBe(false);
		expect(r.state).toEqual({ misses: 0, lost: false });
	});

	it('a pose resets a partial miss streak below the threshold', () => {
		const r = nextTrackingState({ misses: 2, lost: false }, true, 3);
		expect(r.changed).toBe(false);            // never crossed into lost
		expect(r.state).toEqual({ misses: 0, lost: false });
	});

	it('tolerates a null prior state (fresh session)', () => {
		const r = nextTrackingState(null, false, 3);
		expect(r.state).toEqual({ misses: 1, lost: false });
		expect(r.lost).toBe(false);
	});

	it('uses a sane default threshold (~0.5s at 60fps)', () => {
		expect(TRACKING_LOSS_FRAMES).toBe(30);
		let s = null;
		for (let i = 0; i < TRACKING_LOSS_FRAMES - 1; i++) s = nextTrackingState(s, false).state;
		expect(s.lost).toBe(false);
		expect(nextTrackingState(s, false).lost).toBe(true);
	});
});

describe('isXrVisible — interruption classification', () => {
	it('only "visible" is foreground', () => {
		expect(isXrVisible('visible')).toBe(true);
	});

	it('hidden and visible-blurred are paused', () => {
		expect(isXrVisible('hidden')).toBe(false);
		expect(isXrVisible('visible-blurred')).toBe(false);
		expect([...XR_PAUSED_STATES].sort()).toEqual(['hidden', 'visible-blurred']);
	});

	it('an unknown/undefined state is treated as visible (fail-open, never stuck paused)', () => {
		expect(isXrVisible(undefined)).toBe(true);
		expect(isXrVisible('')).toBe(true);
	});
});

describe('placementHint — degraded-anchor honesty', () => {
	it('a solid anchor reads as rock-solid', () => {
		const hint = placementHint(false);
		expect(hint).toContain('stays put');
		expect(hint).not.toMatch(/drift/i);
	});

	it('a degraded anchor discloses possible drift', () => {
		expect(placementHint(true)).toMatch(/drift/i);
	});
});

describe('createPersistGate — the durable pin saves EXACTLY once', () => {
	it('a tap with a live fix persists immediately, holds nothing', () => {
		const persist = vi.fn();
		const gate = createPersistGate(persist);
		const pose = { id: 'p1' };

		expect(gate.place(pose, true)).toBe('persisted');
		expect(persist).toHaveBeenCalledTimes(1);
		expect(persist).toHaveBeenCalledWith(pose);
		expect(gate.hasPending()).toBe(false);

		// A later fix has nothing to drain — no double-save.
		expect(gate.onFix(true)).toBe(false);
		expect(persist).toHaveBeenCalledTimes(1);
	});

	it('the headline path: tap during GPS warm-up → held → first fix → saved once', () => {
		const persist = vi.fn();
		const gate = createPersistGate(persist);
		const pose = { id: 'warmup' };

		// Tap before the fix — held, NOT saved (zero so far).
		expect(gate.place(pose, false)).toBe('held');
		expect(persist).not.toHaveBeenCalled();
		expect(gate.hasPending()).toBe(true);

		// First GPS fix lands — drains exactly once.
		expect(gate.onFix(true)).toBe(true);
		expect(persist).toHaveBeenCalledTimes(1);
		expect(persist).toHaveBeenCalledWith(pose);
		expect(gate.hasPending()).toBe(false);

		// A second fix (every subsequent GPS update calls onFix) must NOT re-save.
		expect(gate.onFix(true)).toBe(false);
		expect(persist).toHaveBeenCalledTimes(1);
	});

	it('leaving before the fix drops the held pose — never a surprise late pin', () => {
		const persist = vi.fn();
		const gate = createPersistGate(persist);

		gate.place({ id: 'abandoned' }, false);
		expect(gate.hasPending()).toBe(true);

		gate.drop();                              // user exits the session
		expect(gate.hasPending()).toBe(false);

		expect(gate.onFix(true)).toBe(false);     // a fix arrives after they walked away
		expect(persist).not.toHaveBeenCalled();   // zero saves — correct
	});

	it('onFix is inert until a fix is actually ready', () => {
		const persist = vi.fn();
		const gate = createPersistGate(persist);
		gate.place({ id: 'held' }, false);

		expect(gate.onFix(false)).toBe(false);    // not ready yet
		expect(persist).not.toHaveBeenCalled();
		expect(gate.hasPending()).toBe(true);     // still held for the real fix

		expect(gate.onFix(true)).toBe(true);
		expect(persist).toHaveBeenCalledTimes(1);
	});

	it('onFix with nothing pending is a harmless no-op (every GPS tick calls it)', () => {
		const persist = vi.fn();
		const gate = createPersistGate(persist);
		for (let i = 0; i < 5; i++) expect(gate.onFix(true)).toBe(false);
		expect(persist).not.toHaveBeenCalled();
	});

	it('drop is idempotent and safe when nothing is held', () => {
		const persist = vi.fn();
		const gate = createPersistGate(persist);
		gate.drop();
		gate.drop();
		expect(gate.hasPending()).toBe(false);
		expect(persist).not.toHaveBeenCalled();
	});

	it('passes the full payload through so degraded honesty survives the warm-up wait', () => {
		const persist = vi.fn();
		const gate = createPersistGate(persist);
		const payload = { pose: { position: { y: -1.4 } }, degraded: true };

		gate.place(payload, false);
		gate.onFix(true);
		expect(persist).toHaveBeenCalledWith(payload);
		expect(persist.mock.calls[0][0].degraded).toBe(true);
	});
});

describe('reticleVisual — searching ↔ locked look', () => {
	const buf = () => ({ scale: 0, opacity: 0, dot: 0, colorMix: 0 });

	it('locked (hit = 1) is full size, bright, dot filled, fully colour-shifted', () => {
		const v = reticleVisual(buf(), 1, 0, false);
		expect(v.scale).toBeCloseTo(1, 5);
		expect(v.opacity).toBeCloseTo(0.96, 5);
		expect(v.dot).toBe(1);
		expect(v.colorMix).toBe(1);
	});

	it('searching (hit = 0) is smaller, dimmer, dotless, un-shifted', () => {
		const v = reticleVisual(buf(), 0, 0, false);
		expect(v.scale).toBeLessThan(0.9);
		expect(v.opacity).toBeLessThan(0.5);
		expect(v.dot).toBe(0);
		expect(v.colorMix).toBe(0);
	});

	it('the breathing phase only modulates the searching look, never overshoots lock', () => {
		const calm = reticleVisual(buf(), 0, 0, false);
		const peak = reticleVisual(buf(), 0, 1, false);
		expect(peak.scale).toBeGreaterThan(calm.scale);
		expect(peak.opacity).toBeGreaterThan(calm.opacity);
		// Even at the top of the breath, searching stays below the locked values.
		expect(peak.scale).toBeLessThanOrEqual(1);
		expect(peak.opacity).toBeLessThan(0.96);
	});

	it('reduced motion flattens the breath to one calm static value', () => {
		const a = reticleVisual(buf(), 0, 0, true);
		const b = reticleVisual(buf(), 0, 1, true);   // breathe ignored when reduced
		expect(a).toEqual(b);
		expect(a.scale).toBeCloseTo(0.94, 5);
		expect(a.opacity).toBeCloseTo(0.5, 5);
	});

	it('clamps out-of-range hit and breathe instead of extrapolating', () => {
		const over = reticleVisual(buf(), 5, 9, false);
		expect(over.scale).toBeCloseTo(1, 5);
		expect(over.dot).toBe(1);
		const under = reticleVisual(buf(), -3, -2, false);
		expect(under.dot).toBe(0);
		expect(under.colorMix).toBe(0);
	});

	it('writes into the caller-owned buffer and returns it (no per-frame allocation)', () => {
		const out = buf();
		const ret = reticleVisual(out, 0.5, 0.5, false);
		expect(ret).toBe(out);
	});
});

describe('advancePulse — one-shot confirm ring', () => {
	const buf = () => ({ t: 0, scale: 1, opacity: 0, done: false });

	it('starts expanding and fading from the tap point', () => {
		const p = advancePulse(buf(), 0.1);
		expect(p.t).toBeCloseTo(0.1, 5);
		expect(p.scale).toBeGreaterThan(1);
		expect(p.opacity).toBeLessThan(0.85);
		expect(p.opacity).toBeGreaterThan(0);
		expect(p.done).toBe(false);
	});

	it('completes at the full duration: max scale, zero opacity, done', () => {
		const p = advancePulse(buf(), RETICLE_PULSE_SECONDS);
		expect(p.scale).toBeCloseTo(3, 5);
		expect(p.opacity).toBeCloseTo(0, 5);
		expect(p.done).toBe(true);
	});

	it('expands monotonically and fades monotonically across the run', () => {
		const p = buf();
		let prevScale = 0;
		let prevOpacity = 1;
		for (let i = 0; i < 6; i++) {
			advancePulse(p, RETICLE_PULSE_SECONDS / 6);
			expect(p.scale).toBeGreaterThanOrEqual(prevScale);
			expect(p.opacity).toBeLessThanOrEqual(prevOpacity);
			prevScale = p.scale;
			prevOpacity = p.opacity;
		}
		expect(p.done).toBe(true);
	});

	it('mutates the caller-owned state and returns it (reused buffer, no allocation)', () => {
		const out = buf();
		const ret = advancePulse(out, 0.05);
		expect(ret).toBe(out);
	});
});

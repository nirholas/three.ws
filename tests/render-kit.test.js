import { describe, it, expect } from 'vitest';
import { ACESFilmicToneMapping, AgXToneMapping, NeutralToneMapping, NoToneMapping } from 'three';
import { createFrameGovernor } from '../src/render/frame-governor.js';
import { resolveToneMapping, cappedPixelRatio } from '../src/render/studio-look.js';
import { handleContextLoss } from '../src/render/context-loss.js';

// Drive the governor at a steady frame rate for `frames` frames starting at `t`.
function run(gov, fps, frames, t = 0) {
	const changes = [];
	const dt = 1000 / fps;
	for (let i = 0; i < frames; i++) {
		t += dt;
		const r = gov.tick(t);
		if (r !== null) changes.push(r);
	}
	return { t, changes };
}

describe('createFrameGovernor', () => {
	it('starts at the maximum pixel ratio', () => {
		expect(createFrameGovernor({ min: 1, max: 2 }).pixelRatio).toBe(2);
	});

	it('holds full quality while the frame rate is healthy', () => {
		const gov = createFrameGovernor({ min: 1, max: 2 });
		const { changes } = run(gov, 60, 600);
		expect(changes).toEqual([]);
		expect(gov.pixelRatio).toBe(2);
	});

	it('steps down one notch per cooldown when the frame rate is low', () => {
		const gov = createFrameGovernor({ min: 1, max: 2, step: 0.25, samples: 30, cooldownMs: 1000 });
		const { changes } = run(gov, 30, 30 * 4);
		expect(changes[0]).toBe(1.75);
		expect(changes.every((r, i) => i === 0 || r < changes[i - 1])).toBe(true);
		expect(gov.pixelRatio).toBeGreaterThanOrEqual(1);
	});

	it('never goes below min or above max', () => {
		const gov = createFrameGovernor({ min: 1, max: 1.5, samples: 10, cooldownMs: 0 });
		run(gov, 10, 2000);
		expect(gov.pixelRatio).toBe(1);
		const up = createFrameGovernor({ min: 1, max: 1.5, initial: 1, samples: 10, cooldownMs: 0 });
		run(up, 120, 2000);
		expect(up.pixelRatio).toBe(1.5);
	});

	it('recovers resolution when headroom returns', () => {
		const gov = createFrameGovernor({ min: 1, max: 2, samples: 20, cooldownMs: 500 });
		let { t } = run(gov, 25, 200);
		const low = gov.pixelRatio;
		expect(low).toBeLessThan(2);
		run(gov, 60, 400, t);
		expect(gov.pixelRatio).toBeGreaterThan(low);
	});

	it('ignores long gaps so a background tab does not read as a slow GPU', () => {
		const gov = createFrameGovernor({ min: 1, max: 2, samples: 5, cooldownMs: 0 });
		let t = 0;
		for (let i = 0; i < 50; i++) {
			t += 1000; // one frame per second: a throttled background tab
			expect(gov.tick(t)).toBeNull();
		}
		expect(gov.pixelRatio).toBe(2);
	});

	it('pause() drops the gap after a pause instead of sampling it', () => {
		const gov = createFrameGovernor({ min: 1, max: 2, samples: 2, cooldownMs: 0, maxDeltaMs: 10_000 });
		gov.tick(0);
		gov.pause();
		expect(gov.tick(5000)).toBeNull();
		expect(gov.fps).toBeNull();
	});

	it('settles on the lower ratio instead of oscillating forever', () => {
		const gov = createFrameGovernor({ min: 1, max: 2, initial: 1.5, samples: 5, cooldownMs: 0, maxFlips: 2 });
		let t = 0;
		gov.tick(t); // prime the clock so each 5-frame run is exactly one window
		for (let i = 0; i < 20 && !gov.settled; i++) {
			({ t } = run(gov, i % 2 ? 30 : 60, 5, t));
		}
		expect(gov.settled).toBe(true);
		const at = gov.pixelRatio;
		run(gov, 120, 500, t);
		expect(gov.pixelRatio).toBe(at);
	});
});

describe('resolveToneMapping', () => {
	it('defaults an unset renderer to Khronos PBR Neutral', () => {
		expect(resolveToneMapping(undefined, NoToneMapping)).toBe(NeutralToneMapping);
	});
	it('keeps a curve the page already chose', () => {
		expect(resolveToneMapping(undefined, ACESFilmicToneMapping)).toBe(ACESFilmicToneMapping);
	});
	it('accepts names and constants', () => {
		expect(resolveToneMapping('agx', NoToneMapping)).toBe(AgXToneMapping);
		expect(resolveToneMapping('NONE', ACESFilmicToneMapping)).toBe(NoToneMapping);
		expect(resolveToneMapping(AgXToneMapping, NoToneMapping)).toBe(AgXToneMapping);
	});
	it('rejects an unknown name loudly', () => {
		expect(() => resolveToneMapping('filmic', NoToneMapping)).toThrow(/Unknown tone mapping/);
	});
});

describe('handleContextLoss', () => {
	const lose = (canvas) => {
		const e = new Event('webglcontextlost', { cancelable: true });
		canvas.dispatchEvent(e);
		return e;
	};

	it('claims the lost context so the browser will restore it', () => {
		const canvas = new EventTarget();
		const h = handleContextLoss(canvas, { notice: false });
		expect(lose(canvas).defaultPrevented).toBe(true);
		expect(h.lost).toBe(true);
	});

	it('pauses on loss and rebuilds on restore, in order', () => {
		const canvas = new EventTarget();
		const calls = [];
		const h = handleContextLoss(canvas, {
			notice: false,
			onLost: () => calls.push('lost'),
			onRestored: () => calls.push('restored'),
		});
		lose(canvas);
		canvas.dispatchEvent(new Event('webglcontextrestored'));
		expect(calls).toEqual(['lost', 'restored']);
		expect(h.lost).toBe(false);
	});

	it('stops listening after detach', () => {
		const canvas = new EventTarget();
		let n = 0;
		const h = handleContextLoss(canvas, { notice: false, onLost: () => n++ });
		h.detach();
		expect(lose(canvas).defaultPrevented).toBe(false);
		expect(n).toBe(0);
	});
});

describe('cappedPixelRatio', () => {
	it('caps high-DPI screens and floors at 1', () => {
		expect(cappedPixelRatio(2, 3)).toBe(2);
		expect(cappedPixelRatio(2, 1.25)).toBe(1.25);
		expect(cappedPixelRatio(2, 0.5)).toBe(1);
		expect(cappedPixelRatio(2, undefined)).toBe(1);
	});
});

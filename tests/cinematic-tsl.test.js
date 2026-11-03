// The WebGPU cinematic pipeline must grade exactly like the WebGL one. These
// pin the CPU-side mappings it shares with the postprocessing effects, and the
// graph key that decides when the node graph rebuilds.
import { describe, it, expect } from 'vitest';
import { HueSaturationEffect, BrightnessContrastEffect } from 'postprocessing';
import {
	hueVector,
	saturationFactor,
	contrastScale,
	structureKey,
} from '../src/viewer/cinematic-tsl.js';
import { CINEMATIC_PRESETS, CINEMATIC_DEFAULTS } from '../src/viewer/cinematic-presets.js';

describe('cinematic-tsl grade mappings', () => {
	it('hueVector matches the WebGL HueSaturationEffect uniform', () => {
		for (const hue of [0, 0.15, -0.4, Math.PI / 3, -Math.PI]) {
			const fx = new HueSaturationEffect({ hue });
			const ref = fx.uniforms.get('hue').value;
			const [x, y, z] = hueVector(hue);
			expect(x).toBeCloseTo(ref.x, 6);
			expect(y).toBeCloseTo(ref.y, 6);
			expect(z).toBeCloseTo(ref.z, 6);
		}
	});

	it('hueVector(0) is the identity rotation', () => {
		expect(hueVector(0)).toEqual([1, 0, 0]);
	});

	it('saturationFactor follows the shader branch for each sign', () => {
		expect(saturationFactor(0)).toBe(-0);
		expect(saturationFactor(-1)).toBe(1);
		expect(saturationFactor(0.5)).toBeCloseTo(1 - 1 / 0.501, 9);
	});

	it('contrastScale is 1 at zero, grows above, shrinks below', () => {
		expect(contrastScale(0)).toBe(1);
		expect(contrastScale(0.5)).toBe(2);
		expect(contrastScale(-0.5)).toBe(0.5);
	});

	it('every preset maps through the same uniforms the WebGL effects use', () => {
		for (const [name, overrides] of Object.entries(CINEMATIC_PRESETS)) {
			const p = { ...CINEMATIC_DEFAULTS, ...overrides };
			const bc = new BrightnessContrastEffect({ brightness: p.brightness, contrast: p.contrast });
			expect(bc.uniforms.get('contrast').value, name).toBe(p.contrast);
			expect(Number.isFinite(contrastScale(p.contrast)), name).toBe(true);
			expect(Number.isFinite(saturationFactor(p.saturation)), name).toBe(true);
		}
	});
});

describe('cinematic-tsl structureKey', () => {
	it('only render-target stages change the key', () => {
		const base = { ...CINEMATIC_DEFAULTS, ssao: false, dof: false, bloom: 0, chromaticAberration: 0 };
		expect(structureKey(base)).toBe('0000');
		expect(structureKey({ ...base, ssao: true })).toBe('1000');
		expect(structureKey({ ...base, dof: true })).toBe('0100');
		expect(structureKey({ ...base, bloom: 0.3 })).toBe('0010');
		expect(structureKey({ ...base, chromaticAberration: 0.002 })).toBe('0001');
		// Slider-only params never force a rebuild.
		expect(structureKey({ ...base, saturation: 0.4, grain: 0.2, vignette: 0.9 })).toBe('0000');
	});
});

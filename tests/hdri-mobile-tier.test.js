/**
 * The phone-sized HDRI set: that it exists, that it is a sound reduction of the
 * full-size original, and that the tier table actually routes a phone to it.
 *
 * The HDRIs are the largest asset any 3D page downloads. Measured on a Pixel 5
 * over slow 4G against production on 2026-09-08, `/hdri/outdoor.hdr` was
 * 1,435 KB of `/play`'s 5,470 KB. Only the weakest tier opted out of them; a
 * real mid-tier phone lands on 'medium' and was paying full price.
 *
 * The soundness assertion is the one that matters. A downscale through ffmpeg's
 * default `scale` filter CLAMPS float input to 1.0, which silently destroys the
 * high dynamic range while still producing a file that loads and looks like an
 * image. Nothing about the file size or the dimensions reveals that; only the
 * radiance does.
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	hdrStats,
	mobileNameFor,
	MOBILE_WIDTH,
	MOBILE_HEIGHT,
	MEAN_TOLERANCE,
} from '../scripts/build-hdri-mobile.mjs';
import { HDRI_PRESETS, HDRI_PRESETS_MOBILE, QUALITY_TIERS } from '../src/shared/cinematic-render.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HDRI_DIR = join(ROOT, 'public/hdri');
const PRESETS = Object.keys(HDRI_PRESETS);

describe('mobile HDRI variants', () => {
	it('offers a mobile copy of every full-size preset, at the same keys', () => {
		expect(Object.keys(HDRI_PRESETS_MOBILE).sort()).toEqual(PRESETS.slice().sort());
	});

	it.each(PRESETS)('%s ships a committed -mobile.hdr the URL table points at', (preset) => {
		const file = join(HDRI_DIR, mobileNameFor(preset));
		expect(existsSync(file)).toBe(true);
		expect(HDRI_PRESETS_MOBILE[preset]).toBe(`/hdri/${mobileNameFor(preset)}`);
	});

	it.each(PRESETS)('%s reduces to 512x256 and stays under half the bytes', (preset) => {
		const full = hdrStats(join(HDRI_DIR, `${preset}.hdr`));
		const small = hdrStats(join(HDRI_DIR, mobileNameFor(preset)));
		expect(small.width).toBe(MOBILE_WIDTH);
		expect(small.height).toBe(MOBILE_HEIGHT);
		expect(small.bytes).toBeLessThan(full.bytes * 0.5);
	});

	it.each(PRESETS)('%s keeps the light energy of the original (the clamp regression)', (preset) => {
		const full = hdrStats(join(HDRI_DIR, `${preset}.hdr`));
		const small = hdrStats(join(HDRI_DIR, mobileNameFor(preset)));
		const drift = Math.abs(small.mean - full.mean) / full.mean;
		expect(drift).toBeLessThanOrEqual(MEAN_TOLERANCE);
		// A clamped file peaks at exactly 1.0 whatever the source was. Every one of
		// these sources has values well above that, so the copy must too.
		expect(full.max).toBeGreaterThan(1);
		expect(small.max).toBeGreaterThan(1);
	});

	it('routes the mid tier to the small copy and leaves the top tier alone', () => {
		expect(QUALITY_TIERS.medium.hdri).toBe(true);
		expect(QUALITY_TIERS.medium.hdriMobile).toBe(true);
		expect(QUALITY_TIERS.high.hdri).toBe(true);
		expect(QUALITY_TIERS.high.hdriMobile).toBeUndefined();
		// The weakest tier still loads none at all; a 360 KB map is a better answer
		// than 1.4 MB, not a better answer than nothing on a device that cannot
		// afford shadows either.
		expect(QUALITY_TIERS.mobile.hdri).toBe(false);
	});
});

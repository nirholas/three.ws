// The Forge page and the home widget build their request through one pure
// module (src/forge-control-state.js) so they never send a combination the API
// refuses, and so the pre-catalog default is the server's default. Every lane in
// the control record is crossed with every tier, a seed, every aspect ratio and
// fill_other_sides; the body the page would send must pass normalizeForgeOptions
// with no errors.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { normalizeForgeOptions } from '../api/_lib/forge-options.js';
import { BACKENDS } from '../api/_lib/forge-tiers.js';
import { LANE_CONTROLS, FORGE_ASPECT_RATIOS, laneHonorsSeed, laneUsesAspect } from '../api/_lib/forge-controls.js';
import {
	PAGE_DEFAULT_ENGINE,
	controlStateFor,
	honoredRequest,
	madeWithParts,
	madeWithSummary,
} from '../src/forge-control-state.js';

const TIERS = ['draft', 'standard', 'high'];

function pageBody({ backend, path, tier, seed, aspect, images, fill }) {
	const base = { path, tier, backend };
	const body = images
		? { image_urls: ['https://cdn.example/a.png'], ...base }
		: { prompt: 'a brass lantern', aspect_ratio: aspect, director: true, ...base };
	if (fill) body.fill_other_sides = true;
	if (Number.isInteger(seed)) body.seed = seed;
	return honoredRequest(body);
}

describe('the page default engine', () => {
	it('sends no backend before the catalog renders, so the server picks its own default lane', () => {
		expect(PAGE_DEFAULT_ENGINE.backend).toBeNull();
		expect(PAGE_DEFAULT_ENGINE.path).toBe('image');
	});

	it('a pre-catalog Draft or High with a seed passes the API', () => {
		for (const tier of TIERS) {
			const body = pageBody({ backend: PAGE_DEFAULT_ENGINE.backend, path: 'image', tier, seed: 42, aspect: '4:3' });
			expect(body.backend).toBeNull();
			expect(normalizeForgeOptions(body).errors).toEqual([]);
		}
	});

	it('src/forge.js submits from the shared default and through honoredRequest', () => {
		const src = readFileSync(new URL('../src/forge.js', import.meta.url), 'utf8');
		expect(src).toMatch(/const DEFAULT_ENGINE = PAGE_DEFAULT_ENGINE;/);
		expect(src).toMatch(/return honoredRequest\(body\);/);
	});

	it('the home widget config goes through honoredRequest', () => {
		const src = readFileSync(new URL('../src/home-forge-controls.js', import.meta.url), 'utf8');
		expect(src).toMatch(/honoredRequest\(/);
	});
});

describe('every lane, every control: the page never builds a request the API refuses', () => {
	for (const backend of Object.keys(LANE_CONTROLS)) {
		const lane = BACKENDS[backend];
		if (!lane) continue;
		for (const path of lane.paths) {
			for (const tier of TIERS) {
				for (const images of [false, true]) {
					it(`${backend} ${path} ${tier} ${images ? 'photo' : 'text'}`, () => {
						for (const aspect of FORGE_ASPECT_RATIOS) {
							const body = pageBody({ backend, path, tier, seed: 1234, aspect, images, fill: images });
							expect(normalizeForgeOptions(body).errors).toEqual([]);
							if (!laneHonorsSeed(backend)) expect(body).not.toHaveProperty('seed');
							else expect(body.seed).toBe(1234);
							if (!images && !laneUsesAspect(backend)) expect(body).not.toHaveProperty('aspect_ratio');
						}
					});
				}
			}
		}
	}

	it('keeps fill_other_sides only on the lane that paints the missing sides', () => {
		expect(pageBody({ backend: 'pixal3d', path: 'image', tier: 'standard', images: true, fill: true }).fill_other_sides).toBe(true);
		expect(pageBody({ backend: 'trellis2', path: 'image', tier: 'standard', images: true, fill: true })).not.toHaveProperty('fill_other_sides');
	});

	it('leaves Auto (no backend) untouched: the router decides', () => {
		const body = { path: 'image', tier: 'high', backend: null, prompt: 'x', aspect_ratio: '16:9', seed: 9 };
		expect(honoredRequest(body)).toEqual(body);
	});
});

describe('controlStateFor', () => {
	it('locks the tier on a lane that runs at one quality, with the API reason', () => {
		const s = controlStateFor({ backend: 'trellis', label: 'Fast', mode: 'text' });
		expect(s.tierLocked).toBe(true);
		expect(s.tierReason).toMatch(/Fast runs at one quality/);
		expect(s.seedDisabled).toBe(false);
		expect(s.aspectVisible).toBe(true);
	});

	it('disables the seed on a lane that takes none, with the API reason', () => {
		const s = controlStateFor({ backend: 'stability', label: 'Stable Fast 3D', mode: 'text' });
		expect(s.tierLocked).toBe(false);
		expect(s.seedDisabled).toBe(true);
		expect(s.seedReason).toMatch(/Stable Fast 3D takes no seed/);
		expect(s.aspectVisible).toBe(false);
	});

	it('shows aspect only for a text prompt on a lane that paints a reference picture', () => {
		expect(controlStateFor({ backend: 'trellis_selfhost', mode: 'text' }).aspectVisible).toBe(true);
		expect(controlStateFor({ backend: 'trellis_selfhost', mode: 'image' }).aspectVisible).toBe(false);
		expect(controlStateFor({ backend: 'triposg', mode: 'text' }).aspectVisible).toBe(false);
		expect(controlStateFor({ backend: null, mode: 'text' }).aspectVisible).toBe(true);
	});

	it('says what the words under a photo do on each engine', () => {
		expect(controlStateFor({ backend: 'meshy', mode: 'image' }).guidancePlaceholder).toMatch(/guidance/i);
		expect(controlStateFor({ backend: 'trellis_selfhost', mode: 'image' }).guidancePlaceholder).toMatch(/photo alone/);
	});

	it('locks nothing on Auto', () => {
		const s = controlStateFor({ backend: null, mode: 'text' });
		expect(s.tierLocked).toBe(false);
		expect(s.seedDisabled).toBe(false);
	});
});

describe('made with', () => {
	it('lists only the options the lane honored', () => {
		expect(madeWithParts({ tier: 'high', engineLabel: 'TRELLIS', backend: 'trellis_selfhost', aspect: '4:3', seed: 77, fromText: true })).toEqual([
			'High',
			'TRELLIS',
			'4:3 reference',
			'seed 77',
		]);
		expect(madeWithParts({ tier: 'standard', engineLabel: 'Stable Fast 3D', backend: 'stability', aspect: '4:3', seed: 77, fromText: true })).toEqual([
			'Standard',
			'Stable Fast 3D',
		]);
		expect(madeWithParts({ tier: 'draft', engineLabel: 'Auto', backend: null, aspect: '1:1', seed: 3, fromText: false })).toEqual([
			'Draft',
			'Auto',
			'seed 3',
		]);
	});

	it('joins into one line', () => {
		expect(madeWithSummary({ tier: 'standard', engineLabel: 'TRELLIS', backend: 'trellis_selfhost', seed: 5 })).toBe('Made with Standard, TRELLIS, seed 5');
		expect(madeWithSummary(null)).toBe('');
	});
});

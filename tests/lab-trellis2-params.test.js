import { describe, expect, it } from 'vitest';
import {
	PRESETS,
	applyPreset,
	buildLaneBody,
	buildTrellis2Body,
	compareQuery,
	defaultState,
	formatBytes,
	formatSeconds,
	matchPreset,
	parseCompareQuery,
	presetSpeed,
	runFailedMessage,
	samplerOverrides,
	tierFor,
} from '../src/lab-trellis2/params.js';
import { normalizeForgeOptions } from '../api/_lib/forge-options.js';

const IMG = 'https://three.ws/uploads/photo.png';

describe('TRELLIS.2 lab request builder', () => {
	it('sends a minimal body at defaults: no sampler, texture or face overrides', () => {
		const body = buildTrellis2Body(defaultState(), IMG);
		expect(body).toEqual({ path: 'image', backend: 'trellis2', tier: 'standard', resolution: 1024, image_urls: [IMG], seed: 42 });
	});

	it('sends only the sampler fields that differ from upstream defaults', () => {
		const s = defaultState();
		s.sampler.shape_slat.steps = 20;
		s.sampler.tex_slat.guidance_strength = 3;
		expect(samplerOverrides(s.sampler)).toEqual({ shape_slat: { steps: 20 }, tex_slat: { guidance_strength: 3 } });
	});

	it('clamps out-of-range values into what the API accepts', () => {
		const s = defaultState();
		s.seed = -5;
		s.faces = 9_000_000;
		s.sampler.sparse_structure.steps = 99;
		s.sampler.sparse_structure.guidance_strength = 40;
		const body = buildTrellis2Body(s, IMG);
		expect(body.seed).toBe(0);
		expect(body.target_polycount).toBe(500_000);
		expect(body.sampler.sparse_structure).toEqual({ steps: 50, guidance_strength: 15 });
	});

	it('produces a body the server-side validator accepts without errors', () => {
		const s = applyPreset('maximum_detail');
		s.sampler.tex_slat.guidance_strength = 2.5;
		s.textureSize = 2048;
		s.faces = 250_000;
		s.seed = 4_294_967_295;
		const body = buildTrellis2Body(s, IMG);
		const opts = normalizeForgeOptions(body);
		expect(opts.errors).toEqual([]);
		expect(opts).toMatchObject({ seed: 4_294_967_295, resolution: 1536, textureSize: 2048, targetPolycount: 250_000, sampler: body.sampler });
	});

	it('maps 512 to the draft tier and keeps 1536 off the holder-gated high tier', () => {
		expect(tierFor(512)).toBe('draft');
		expect(tierFor(1024)).toBe('standard');
		expect(tierFor(1536)).toBe('standard');
		expect(buildTrellis2Body(applyPreset('maximum_detail'), IMG)).toMatchObject({ tier: 'standard', resolution: 1536, sampler: { shape_slat: { steps: 16 } } });
	});

	it('requires an image', () => {
		expect(() => buildTrellis2Body(defaultState(), '')).toThrow(TypeError);
		expect(() => buildLaneBody('triposg', null)).toThrow(TypeError);
	});

	it('builds the comparison lane with its own defaults', () => {
		expect(buildLaneBody('trellis_selfhost', IMG)).toEqual({ path: 'image', backend: 'trellis_selfhost', tier: 'standard', image_urls: [IMG] });
	});
});

describe('presets', () => {
	it('every preset round-trips through matchPreset', () => {
		for (const p of PRESETS) expect(matchPreset(applyPreset(p.id))).toBe(p.id);
	});

	it('an edited state matches no preset', () => {
		const s = applyPreset('balanced');
		s.seed = 7;
		expect(matchPreset(s)).toBeNull();
	});

	it('rejects unknown presets', () => {
		expect(() => applyPreset('nope')).toThrow(RangeError);
	});

	it('says "not measured" when the benchmark has no rows for a preset', () => {
		const bench = { presets: { fast_draft: { e2e_seconds: 'not measured', gpu_seconds: 'not measured' } } };
		expect(presetSpeed(bench, 'fast_draft')).toMatchObject({ measured: false });
		expect(presetSpeed({}, 'balanced')).toMatchObject({ measured: false });
	});

	it('says a preset is failing when its tier only has failed runs', () => {
		const bench = { presets: { balanced: { resolution: 1024, tier: 'standard', rows: 0, e2e_seconds: 'not measured', tier_rows: 2, tier_failed: 2 } } };
		const s = presetSpeed(bench, 'balanced');
		expect(s).toMatchObject({ measured: false, failing: true, label: 'Failing on production' });
		expect(s.detail).toBe('2 of 2 standard-tier runs (1024 and 1536) failed in the benchmark window and none finished at 1024.');
	});

	it('keeps a measured label when some runs finished despite tier failures', () => {
		const bench = { presets: { fast_draft: { e2e_seconds: { n: 2, p50: 56, p90: 56 }, gpu_seconds: 'not measured', tier: 'draft', tier_rows: 3, tier_failed: 1 } } };
		const s = presetSpeed(bench, 'fast_draft');
		expect(s).toMatchObject({ measured: true, label: 'p50 56 s' });
		expect(s.detail).toContain('1 of 3 draft-tier runs failed');
	});

	it('labels a measured preset from its real percentiles', () => {
		const bench = { presets: { balanced: { e2e_seconds: { n: 3, p50: 74.2, p90: 120, p99: 130 }, gpu_seconds: { n: 3, p50: 41 } } } };
		const s = presetSpeed(bench, 'balanced');
		expect(s.measured).toBe(true);
		expect(s.label).toBe('p50 1 min 14 s');
		expect(s.detail).toContain('3 production runs');
		expect(s.detail).toContain('GPU p50 41 s');
	});
});

describe('share URL', () => {
	const A = '0f8fad5b-d9cb-469f-a165-70867728950e';
	const B = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

	it('round-trips two creation ids', () => {
		expect(parseCompareQuery(`?${compareQuery(A, B)}`)).toEqual({ a: A, b: B });
	});

	it('drops anything that is not a uuid', () => {
		expect(parseCompareQuery('?a=<script>&b=123')).toEqual({ a: null, b: null });
	});

	it('omits a missing lane', () => {
		expect(compareQuery(A, null)).toBe(`a=${A}`);
	});
});

describe('formatting', () => {
	it('formats seconds and bytes', () => {
		expect(formatSeconds(4.25)).toBe('4.3 s');
		expect(formatSeconds(45)).toBe('45 s');
		expect(formatSeconds(120)).toBe('2 min');
		expect(formatSeconds(NaN)).toBe('n/a');
		expect(formatBytes(512)).toBe('512 B');
		expect(formatBytes(2048)).toBe('2.0 KB');
		expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
	});
});

describe('runFailedMessage', () => {
	it('does not double the period when the engine reason already ends a sentence', () => {
		expect(runFailedMessage('The engine ran out of resources. Try again with a simpler request.'))
			.toBe('The run failed: The engine ran out of resources. Try again with a simpler request.');
	});
	it('ends a bare reason with a period and covers a missing one', () => {
		expect(runFailedMessage('timeout')).toBe('The run failed: timeout.');
		expect(runFailedMessage('')).toBe('The run failed: the engine gave up.');
	});
});

import { describe, it, expect } from 'vitest';
import {
	normalizeForgeOptions,
	providerReconstructParams,
	summarizeForgeOptions,
	OUTPUT_FORMATS,
	TEXTURE_SIZES,
} from '../api/_lib/forge-options.js';

describe('normalizeForgeOptions — backward compatibility', () => {
	it('an empty body yields all defaults and no options (current behavior)', () => {
		const o = normalizeForgeOptions({});
		expect(o.seed).toBeNull();
		expect(o.outputFormat).toBe('glb');
		expect(o.compression).toBe('none');
		expect(o.textureSize).toBeNull();
		expect(o.targetPolycount).toBeNull();
		expect(o.hasOptions).toBe(false);
		expect(o.errors).toEqual([]);
	});

	it('null/undefined body is safe', () => {
		expect(normalizeForgeOptions(null).hasOptions).toBe(false);
		expect(normalizeForgeOptions(undefined).errors).toEqual([]);
	});

	it('providerReconstructParams contributes nothing for default options', () => {
		const o = normalizeForgeOptions({});
		expect(providerReconstructParams(o, { polyControl: true })).toEqual({});
	});
});

describe('normalizeForgeOptions — seed', () => {
	it('accepts a valid integer seed', () => {
		const o = normalizeForgeOptions({ seed: 12345 });
		expect(o.seed).toBe(12345);
		expect(o.hasOptions).toBe(true);
	});

	it('clamps an over-large seed into uint32', () => {
		const o = normalizeForgeOptions({ seed: 9_999_999_999 });
		expect(o.seed).toBe(4_294_967_295);
	});

	it('rejects a negative or non-integer seed', () => {
		expect(normalizeForgeOptions({ seed: -1 }).errors[0].field).toBe('seed');
		expect(normalizeForgeOptions({ seed: 1.5 }).errors[0].field).toBe('seed');
		expect(normalizeForgeOptions({ seed: 'abc' }).errors[0].field).toBe('seed');
	});
});

describe('normalizeForgeOptions — output format', () => {
	it('maps each format to the right compression', () => {
		expect(normalizeForgeOptions({ output_format: 'glb' }).compression).toBe('none');
		expect(normalizeForgeOptions({ output_format: 'glb-draco' }).compression).toBe('draco');
		expect(normalizeForgeOptions({ output_format: 'glb-meshopt' }).compression).toBe('meshopt');
	});

	it('accepts the `format` alias and is case-insensitive', () => {
		expect(normalizeForgeOptions({ format: 'GLB-DRACO' }).outputFormat).toBe('glb-draco');
	});

	it('rejects an unknown format', () => {
		const o = normalizeForgeOptions({ output_format: 'obj' });
		expect(o.outputFormat).toBe('glb');
		expect(o.errors[0].field).toBe('output_format');
	});

	it('all advertised formats validate', () => {
		for (const f of OUTPUT_FORMATS) expect(normalizeForgeOptions({ output_format: f }).errors).toEqual([]);
	});
});

describe('normalizeForgeOptions — texture size & polycount', () => {
	it('accepts valid texture sizes via either key', () => {
		for (const s of TEXTURE_SIZES) {
			expect(normalizeForgeOptions({ texture_size: s }).textureSize).toBe(s);
			expect(normalizeForgeOptions({ texture_resolution: s }).textureSize).toBe(s);
		}
	});

	it('rejects an off-list texture size', () => {
		expect(normalizeForgeOptions({ texture_size: 999 }).errors[0].field).toBe('texture_size');
	});

	it('accepts a target_polycount in range and rejects out-of-range', () => {
		expect(normalizeForgeOptions({ target_polycount: 50_000 }).targetPolycount).toBe(50_000);
		expect(normalizeForgeOptions({ target_polycount: 5 }).errors[0].field).toBe('target_polycount');
		expect(normalizeForgeOptions({ target_polycount: 9_000_000 }).errors[0].field).toBe('target_polycount');
	});

	it('maps the quality alias to a polycount', () => {
		expect(normalizeForgeOptions({ quality: 'high' }).targetPolycount).toBe(150_000);
		expect(normalizeForgeOptions({ quality: 'ultra' }).targetPolycount).toBe(300_000);
		expect(normalizeForgeOptions({ quality: 'nope' }).errors[0].field).toBe('quality');
	});

	it('forwards poly-aware params only when polyControl is set', () => {
		const o = normalizeForgeOptions({ seed: 7, texture_size: 2048, target_polycount: 40_000 });
		expect(providerReconstructParams(o, { polyControl: false })).toEqual({ seed: 7 });
		expect(providerReconstructParams(o, { polyControl: true })).toEqual({
			seed: 7,
			texture_size: 2048,
			target_polycount: 40_000,
		});
	});
});

describe('summarizeForgeOptions', () => {
	it('echoes the resolved options for the response', () => {
		const o = normalizeForgeOptions({ seed: 9, output_format: 'glb-draco', texture_size: 1024 });
		expect(summarizeForgeOptions(o)).toEqual({
			seed: 9,
			output_format: 'glb-draco',
			texture_size: 1024,
			target_polycount: null,
			// Material completion is on unless the caller opts out, and the echo
			// says so, so a client can tell why its delivered file carries maps.
			derive_pbr: true,
		});
	});
});

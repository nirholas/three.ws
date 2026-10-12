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

describe('normalizeForgeOptions: view_labels & fill_other_sides', () => {
	it('accepts a valid view_labels array, including null entries', () => {
		const o = normalizeForgeOptions({ view_labels: ['front', null, 'left'] });
		expect(o.viewLabels).toEqual(['front', null, 'left']);
		expect(o.errors).toEqual([]);
		expect(o.hasOptions).toBe(true);
	});

	it('rejects a non-array view_labels', () => {
		expect(normalizeForgeOptions({ view_labels: 'front' }).errors[0].field).toBe('view_labels');
	});

	it('rejects an unknown label inside view_labels', () => {
		expect(normalizeForgeOptions({ view_labels: ['front', 'sideways'] }).errors[0].field).toBe('view_labels');
	});

	it('defaults view_labels to null when omitted', () => {
		expect(normalizeForgeOptions({}).viewLabels).toBeNull();
	});

	it('accepts fill_other_sides as a boolean and defaults to false', () => {
		expect(normalizeForgeOptions({ fill_other_sides: true }).fillOtherSides).toBe(true);
		expect(normalizeForgeOptions({}).fillOtherSides).toBe(false);
	});

	it('rejects a non-boolean fill_other_sides', () => {
		expect(normalizeForgeOptions({ fill_other_sides: 'yes' }).errors[0].field).toBe('fill_other_sides');
	});
});

describe('normalizeForgeOptions: num_parts (PartCrafter)', () => {
	it('accepts an in-range integer and defaults to null when omitted', () => {
		expect(normalizeForgeOptions({ num_parts: 6 }).numParts).toBe(6);
		expect(normalizeForgeOptions({}).numParts).toBeNull();
	});

	it('rejects a value below PartCrafter minParts', () => {
		const o = normalizeForgeOptions({ num_parts: 1 });
		expect(o.numParts).toBeNull();
		expect(o.errors[0].field).toBe('num_parts');
	});

	it('rejects a value above PartCrafter maxParts', () => {
		const o = normalizeForgeOptions({ num_parts: 17 });
		expect(o.numParts).toBeNull();
		expect(o.errors[0].field).toBe('num_parts');
	});

	it('rejects a non-integer num_parts', () => {
		expect(normalizeForgeOptions({ num_parts: 4.5 }).errors[0].field).toBe('num_parts');
	});
});

describe('normalizeForgeOptions: lods (LOD chain)', () => {
	it('accepts lods as a boolean and defaults to false', () => {
		expect(normalizeForgeOptions({ lods: true }).lods).toBe(true);
		expect(normalizeForgeOptions({}).lods).toBe(false);
	});

	it('rejects a non-boolean lods', () => {
		expect(normalizeForgeOptions({ lods: 'yes' }).errors[0].field).toBe('lods');
	});

	it('flips hasOptions when lods is requested', () => {
		expect(normalizeForgeOptions({ lods: true }).hasOptions).toBe(true);
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
			resolution: null,
			view_labels: null,
			fill_other_sides: false,
			num_parts: null,
			// Material completion is on unless the caller opts out, and the echo
			// says so, so a client can tell why its delivered file carries maps.
			derive_pbr: true,
			lods: false,
		});
	});

	it('echoes lods when requested', () => {
		const o = normalizeForgeOptions({ lods: true });
		expect(summarizeForgeOptions(o).lods).toBe(true);
	});

	it('echoes num_parts when supplied', () => {
		const o = normalizeForgeOptions({ num_parts: 8 });
		expect(summarizeForgeOptions(o).num_parts).toBe(8);
	});

	it('echoes view_labels and fill_other_sides when supplied', () => {
		const o = normalizeForgeOptions({ view_labels: ['front', 'back'], fill_other_sides: true });
		const s = summarizeForgeOptions(o);
		expect(s.view_labels).toEqual(['front', 'back']);
		expect(s.fill_other_sides).toBe(true);
	});
});

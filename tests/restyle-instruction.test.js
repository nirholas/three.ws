// Free-text restyle instructions (src/shared/restyle-instruction.js), shared by
// the Forge Materials panel and /api/material-studio?action=restyle.
//
// Same policy as generation prompts (owner directive 2026-08-07): nothing screens
// what a user may ask for; the only checks are shape (clean whitespace, 3 to 300
// characters). On top of that, a request that changes the model's shape rather
// than its surface gets pointed at the tool that can do it, because a material
// restyle never moves a vertex.

import { describe, it, expect } from 'vitest';
import {
	INSTRUCTION_MAX,
	INSTRUCTION_MIN,
	checkInstruction,
	normalizeInstruction,
	shapeIntent,
} from '../src/shared/restyle-instruction.js';

describe('normalizeInstruction', () => {
	it('trims, collapses whitespace and strips control characters', () => {
		expect(normalizeInstruction('  make it\n\n  gold\t ')).toBe('make it gold');
		expect(normalizeInstruction('chrome\u0000\u0007 finish')).toBe('chrome finish');
		expect(normalizeInstruction('zero​width')).toBe('zerowidth');
	});

	it('treats non-strings as empty', () => {
		expect(normalizeInstruction(undefined)).toBe('');
		expect(normalizeInstruction(null)).toBe('');
		expect(normalizeInstruction(42)).toBe('');
	});
});

describe('checkInstruction', () => {
	it('accepts a normal instruction and returns the cleaned text', () => {
		expect(checkInstruction('  polished   white marble ')).toEqual({ ok: true, text: 'polished white marble' });
	});

	it('rejects empty, too short and too long, each with its own code', () => {
		expect(checkInstruction('   ')).toMatchObject({ ok: false, code: 'missing_instruction' });
		expect(checkInstruction('ab')).toMatchObject({ ok: false, code: 'instruction_too_short' });
		expect(checkInstruction('x'.repeat(INSTRUCTION_MAX + 1))).toMatchObject({ ok: false, code: 'instruction_too_long' });
		expect(checkInstruction('x'.repeat(INSTRUCTION_MAX))).toMatchObject({ ok: true });
		expect(checkInstruction('abc')).toMatchObject({ ok: true });
		expect(INSTRUCTION_MIN).toBe(3);
		expect(INSTRUCTION_MAX).toBe(300);
	});

	it('measures length after cleanup, so padding cannot push a valid request over', () => {
		expect(checkInstruction(`gold${' '.repeat(400)}`)).toEqual({ ok: true, text: 'gold' });
	});

	it('every rejection carries a human message', () => {
		for (const bad of ['', 'ab', 'x'.repeat(301)]) {
			const r = checkInstruction(bad);
			expect(typeof r.message).toBe('string');
			expect(r.message.length).toBeGreaterThan(10);
		}
	});
});

describe('shapeIntent', () => {
	const cases = {
		iterate: [
			'make it taller',
			'make the legs longer',
			'add wings',
			'add a tail',
			'add two big horns',
			'remove the hat',
			'give it a cape',
			'take off the helmet',
			'change the pose',
			'reshape the head',
		],
		stylize: ['make it voxel', 'blocky style', 'low poly look', 'low-poly', 'voxelized', 'make it faceted', 'pixelated'],
		refine: ['decimate it', 'fewer polygons please', 'reduce the triangle count', 'fix the holes', 'subdivide', 'weld the seams'],
		optimize: ['remesh it', 'retopology with quads', 'clean quad topology'],
	};
	for (const [tool, list] of Object.entries(cases)) {
		for (const text of list) {
			it(`"${text}" points to ${tool}`, () => {
				const hit = shapeIntent(text);
				expect(hit?.tool).toBe(tool);
				expect(hit.message.length).toBeGreaterThan(20);
				expect(hit.label.length).toBeGreaterThan(2);
			});
		}
	}

	const surface = [
		'make it polished white marble',
		'brick red paint',
		'smooth glossy plastic',
		'rusty weathered metal',
		'gold with black trim',
		'make the hat red',
		'add rust',
		'add gold trim to the wings',
		'turn it into gold',
		'brushed steel',
		'wood grain',
		'neon glow on the edges',
	];
	for (const text of surface) {
		it(`"${text}" is a surface request and passes through`, () => {
			expect(shapeIntent(text)).toBeNull();
		});
	}

	it('handles empty input', () => {
		expect(shapeIntent('')).toBeNull();
		expect(shapeIntent(undefined)).toBeNull();
	});
});

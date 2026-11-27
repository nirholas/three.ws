// src/shared/iterate-plan.js decides what an iteration is before any work is
// spent: a look (restyle, no geometry job), a shape change (rebuild), a
// variation, or a request that should not run at all.

import { describe, it, expect } from 'vitest';
import { isLookOnly, newSubjectOf, planIteration, mintSeed, parseSeed, MAX_SEED } from '../src/shared/iterate-plan.js';

describe('isLookOnly', () => {
	it.each(['make it red', 'less shiny', 'matte black', 'in brushed brass', 'make it metallic', 'glossier finish', 'paint it gold', 'as translucent glass'])(
		'"%s" is a surface change',
		(text) => expect(isLookOnly(text)).toBe(true),
	);
	it.each(['add wings', 'bigger helmet', 'make the helmet red', 'add a red cape', 'make it taller', 'remove the hat', 'voxel style', 'a happier face', ''])(
		'"%s" is not a surface change',
		(text) => expect(isLookOnly(text)).toBe(false),
	);
});

describe('newSubjectOf', () => {
	it('spots a request for a different object and offers it as a new prompt', () => {
		expect(newSubjectOf('turn it into a pickup truck', 'a ceramic owl figurine')).toBe('a pickup truck');
		expect(newSubjectOf('make an elephant', 'a desk lamp')).toBe('an elephant');
		expect(newSubjectOf('replace it with a sailboat', 'a teapot')).toBe('a sailboat');
	});
	it('keeps an iteration that still names the subject, is a look, or has no known subject', () => {
		expect(newSubjectOf('turn it into a robot dog', 'a small robot')).toBeNull();
		expect(newSubjectOf('turn it into gold', 'a teapot')).toBeNull();
		expect(newSubjectOf('make it a bit taller', 'a teapot')).toBeNull();
		expect(newSubjectOf('turn it into a pickup truck', '')).toBeNull();
		expect(newSubjectOf('add wings', 'a teapot')).toBeNull();
	});
});

describe('planIteration', () => {
	it('refuses an empty instruction', () => {
		expect(planIteration({ instruction: '  ' })).toMatchObject({ ok: false, status: 400, code: 'missing_instruction' });
	});
	it('refuses a repeat of the change that made the parent version, ignoring case and punctuation', () => {
		expect(planIteration({ instruction: 'Add wings!', parentInstruction: 'add wings' })).toMatchObject({ ok: false, status: 409, code: 'same_instruction' });
	});
	it('a different object is refused unless the user allows it', () => {
		const args = { instruction: 'turn it into a castle', parentPrompt: 'a red sneaker' };
		expect(planIteration(args)).toMatchObject({ ok: false, code: 'different_object', suggestedPrompt: 'a castle' });
		expect(planIteration({ ...args, allowNewSubject: true })).toMatchObject({ ok: true, kind: 'shape' });
	});
	it('auto picks look or shape from the words, and an explicit mode wins', () => {
		expect(planIteration({ instruction: 'make it red' }).kind).toBe('look');
		expect(planIteration({ instruction: 'add wings' }).kind).toBe('shape');
		expect(planIteration({ instruction: 'make it red', mode: 'shape' }).kind).toBe('shape');
		expect(planIteration({ instruction: 'something odd', mode: 'look' }).kind).toBe('look');
	});
	it('a variation needs a subject prompt and no instruction', () => {
		expect(planIteration({ mode: 'variation', parentPrompt: 'a teapot' })).toMatchObject({ ok: true, kind: 'variation' });
		expect(planIteration({ mode: 'variation', parentPrompt: '' })).toMatchObject({ ok: false, code: 'no_subject' });
	});
});

describe('seeds', () => {
	it('mints seeds inside the range every lane accepts', () => {
		expect(mintSeed(() => 0)).toBe(1);
		expect(mintSeed(() => 0.999999999)).toBeLessThanOrEqual(MAX_SEED);
	});
	it('parses only usable integers', () => {
		expect(parseSeed(42)).toBe(42);
		expect(parseSeed(0)).toBeNull();
		expect(parseSeed(MAX_SEED + 1)).toBeNull();
		expect(parseSeed('42')).toBeNull();
	});
});

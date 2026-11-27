/**
 * The shared "describe a motion" check (src/motion-prompt-check.js), run by
 * /api/forge-motion, the MCP text_to_animation tool and the /pose generator.
 */
import { describe, it, expect } from 'vitest';
import { checkMotionPrompt, MOTION_PROMPT_MAX } from '../src/motion-prompt-check.js';

describe('checkMotionPrompt', () => {
	it('accepts a described movement and tidies its whitespace', () => {
		expect(checkMotionPrompt('  a person   waves hello ')).toEqual({ ok: true, prompt: 'a person waves hello', note: null });
		expect(checkMotionPrompt('hop')).toMatchObject({ ok: true });
		expect(checkMotionPrompt('una persona baila salsa')).toMatchObject({ ok: true });
		expect(checkMotionPrompt('人が手を振る')).toMatchObject({ ok: true });
	});

	it('refuses nothing typed, with an example of what to type', () => {
		for (const raw of [undefined, null, 42, '', '   \n ']) {
			const out = checkMotionPrompt(raw);
			expect(out).toMatchObject({ ok: false, reason: 'empty' });
			expect(out.message).toMatch(/for example/);
		}
	});

	it('refuses strings that are not words', () => {
		for (const raw of ['!!!!!!', '12345', 'aaaaaaa', '?? ??', 'x', ':)']) {
			expect(checkMotionPrompt(raw), raw).toMatchObject({ ok: false, reason: 'not_a_motion' });
		}
	});

	it('refuses an essay with a reason the person can act on', () => {
		const out = checkMotionPrompt('a '.repeat(MOTION_PROMPT_MAX));
		expect(out).toMatchObject({ ok: false, reason: 'too_long' });
		expect(out.message).toMatch(/1000/);
	});

	it('notes that a creature or machine plays as a person acting it out', () => {
		expect(checkMotionPrompt('a dog wagging its tail').note).toMatch(/human body.*"dog"/);
		expect(checkMotionPrompt('walk like a horse').note).toMatch(/"horse"/);
		expect(checkMotionPrompt('a cartwheel').note).toBeNull();
		expect(checkMotionPrompt('catwalk strut').note).toBeNull();
	});
});

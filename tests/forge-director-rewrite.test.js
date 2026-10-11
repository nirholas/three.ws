// The forge art director rewrites a rough idea into a dense photoreal spec and
// forwards THAT to text-to-image, which is the only thing the mesh reconstructor
// ever sees. So a rewrite that arrives truncated does not degrade the result, it
// replaces the subject outright: observed on production 2026-08-07, "a small
// ceramic teapot with a bamboo handle" was directed to "A small," and came back
// as a coffee tamper, and "a red wooden rocking chair" was cut to "A classic
// wooden rocking chair with gracefully curved". These pin the guard that keeps
// the director's stated contract: it may improve a generation, never break one.

import { describe, expect, it } from 'vitest';
import { isUsableDirectorRewrite, directorRewriteProblem } from '../api/_mcp-studio/forge-client.js';
import { isUsableDirectorRewrite as isUsableFromGptClient } from '../api/_mcp-studio/gpt-forge-client.js';
import { meshDirectorFor, avatarDirectorFor } from '../api/_lib/forge-director-prompts.js';

const RAW = 'a small ceramic teapot with a bamboo handle';

// A complete spec as the director actually emits one, verified against
// production output for "a leather messenger bag with brass buckles".
const COMPLETE_SPEC =
	'Ceramic teapot with a rounded silhouette, constructed from a glazed body, a ' +
	'curved spout and a bamboo handle bound with waxed cord, in a photoreal art ' +
	'style with natural daylight-balanced studio lighting, shallow depth of field, ' +
	'and visible micro-detail such as glaze pooling and bamboo grain, full subject ' +
	'in frame, centered, isolated on a plain neutral background, no text or watermark.';

describe('isUsableDirectorRewrite', () => {
	it('accepts a complete, enriched spec', () => {
		expect(isUsableDirectorRewrite(COMPLETE_SPEC, RAW)).toBe(true);
	});

	it('rejects the production truncation that produced a coffee tamper', () => {
		expect(isUsableDirectorRewrite('A small,', RAW)).toBe(false);
	});

	it('rejects a rewrite cut mid-clause on a dangling adjective phrase', () => {
		const raw = 'a red wooden rocking chair';
		expect(isUsableDirectorRewrite('A classic wooden rocking chair with gracefully curved', raw)).toBe(
			false,
		);
	});

	it('rejects any rewrite ending on a separator that promises more text', () => {
		for (const tail of [',', ';', ':', '/', '&', '+', '(']) {
			expect(isUsableDirectorRewrite(`${COMPLETE_SPEC.slice(0, 120)}${tail}`, RAW)).toBe(false);
		}
	});

	it('rejects a rewrite ending on a dangling connective', () => {
		for (const tail of ['and', 'with', 'featuring', 'made', 'the', 'of']) {
			expect(isUsableDirectorRewrite(`${COMPLETE_SPEC.slice(0, 120)} ${tail}`, RAW)).toBe(false);
		}
	});

	it('accepts a complete sentence closed inside a quote or bracket', () => {
		expect(isUsableDirectorRewrite(`${COMPLETE_SPEC.slice(0, 200)}."`, RAW)).toBe(true);
		expect(isUsableDirectorRewrite(`${COMPLETE_SPEC.slice(0, 200)}!`, RAW)).toBe(true);
	});

	it('rejects a rewrite that did not enrich the caller brief', () => {
		// No longer than what the user typed means the director added nothing, and
		// is far more likely a clipped opening clause than a genuine tightening.
		expect(isUsableDirectorRewrite('A ceramic teapot.', RAW)).toBe(false);
		expect(isUsableDirectorRewrite(`${RAW}.`.slice(0, RAW.length), RAW)).toBe(false);
	});

	it('holds the existing length bounds', () => {
		expect(isUsableDirectorRewrite('a.', 'a')).toBe(false);
		expect(isUsableDirectorRewrite(`${'x'.repeat(1000)}.`, RAW)).toBe(false);
	});

	it('rejects a non-string result rather than forwarding it', () => {
		expect(isUsableDirectorRewrite(null, RAW)).toBe(false);
		expect(isUsableDirectorRewrite(undefined, RAW)).toBe(false);
	});

	// Run receipts showed the brief falling back on every studio run on 2026-10-11.
	// The director prompts tell the model to END on the composition list ("... no
	// collage or multi-view grid, no second subject"), and real outputs from the
	// chain copy that list verbatim with no closing period, so the period-only
	// completeness test rejected every well-formed brief it was asked to produce.
	it('accepts a brief that ends on the mandated closing constraint without a period', () => {
		const spec = COMPLETE_SPEC.replace(/, no text or watermark\.$/, ', no text or watermark, no collage or multi-view grid, no second subject');
		expect(isUsableDirectorRewrite(spec, RAW)).toBe(true);
		expect(isUsableDirectorRewrite(spec.replace(/no second subject$/, 'no second character'), RAW)).toBe(true);
		expect(isUsableDirectorRewrite(spec.replace(/no second subject$/, 'one character only'), RAW)).toBe(true);
		// A clip inside that same closing list is still a clip.
		expect(isUsableDirectorRewrite(spec.replace(/no second subject$/, 'no second'), RAW)).toBe(false);
	});

	it('asks the director for a brief the forge will accept (it rejects prompts over 1000 characters)', () => {
		for (const ins of [meshDirectorFor('object'), avatarDirectorFor('person')]) {
			// Words, not characters: the chain's models ignore a character count.
			const m = /under (\d+) words/.exec(ins);
			expect(m, 'the director prompt states a length budget').not.toBeNull();
			// About 7 characters per word of spec prose; stay well under 1000.
			expect(Number(m[1]) * 7).toBeLessThan(1000);
		}
	});

	it('is one implementation shared by both forge clients', () => {
		expect(isUsableFromGptClient).toBe(isUsableDirectorRewrite);
	});

	it('still accepts an enriched spec when the caller brief is absent', () => {
		expect(isUsableDirectorRewrite(COMPLETE_SPEC, '')).toBe(true);
		expect(isUsableDirectorRewrite(COMPLETE_SPEC, undefined)).toBe(true);
	});
});

// The run receipt has to say WHY a brief fell back, so the guard names the
// problem instead of only answering yes or no. Before this every fallback was
// filed as "did not return a usable brief in time", which was false for each of
// the 2026-10-11 runs: the replies arrived in 5 to 10 s and were too long.
describe('directorRewriteProblem', () => {
	it('names each way a rewrite can be unusable', () => {
		expect(directorRewriteProblem(COMPLETE_SPEC, RAW)).toBeNull();
		expect(directorRewriteProblem(`${'x'.repeat(1000)}.`, RAW)).toBe('too_long');
		expect(directorRewriteProblem('A small,', RAW)).toBe('unfinished');
		expect(directorRewriteProblem(`${COMPLETE_SPEC.slice(0, -1)} at https://example.com.`, RAW)).toBe('link');
		expect(directorRewriteProblem('A red car.', 'a red sports car with chrome trim')).toBe('not_enriched');
		expect(directorRewriteProblem('', RAW)).toBe('empty');
		expect(directorRewriteProblem(null, RAW)).toBe('empty');
	});
});

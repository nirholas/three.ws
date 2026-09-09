// Passage selection for the keyless Wikipedia search rung.
//
// The rung used to fetch `exintro=1`, so a source's text was always the article's
// LEAD section. That carries the fact only when the claim is about the page's
// subject. For a claim about an attribute it carries nothing: on 2026-09-09 the
// live chain answered "Napoleon Bonaparte was unusually short" with the leads of
// "Napoleon", "Napoleon III" and "Napoleonic Wars", none of which mention height,
// so every stance came back "neutral" and the verdict was "insufficient" while
// the height discussion sat in the article body untouched.
//
// selectRelevantPassages reads the whole article and returns the paragraphs that
// actually carry the claim's vocabulary. These tests pin that behaviour and, just
// as importantly, pin the floor: when nothing matches it must still return the
// leading prose rather than nothing at all.
import { describe, expect, it } from 'vitest';

import { selectRelevantPassages } from '../agents/fact-checker/src/search-sources.js';

// Shaped like MediaWiki `explaintext` output: blank-line-separated paragraphs
// with "== Heading ==" section titles.
const ARTICLE = [
	'Napoleon Bonaparte was Emperor of the French from 1804 until 1814.',
	'== Military career ==',
	'He commanded the Grande Armee across a long series of European campaigns.',
	'== Cultural depictions ==',
	'British cartoons depicted Napoleon as a short man, and the image of his height persists today.',
	'== References ==',
	'Roberts, Andrew. Napoleon: A Life. A biography covering his height and legacy.',
].join('\n\n');

describe('selectRelevantPassages', () => {
	it('returns the body paragraph that carries the claim, not the lead', () => {
		const out = selectRelevantPassages(ARTICLE, 'Napoleon height short');
		expect(out).toContain('depicted Napoleon as a short man');
		// The lead is about him being Emperor and says nothing about height.
		expect(out.startsWith('Napoleon Bonaparte was Emperor')).toBe(false);
	});

	it('prefixes a passage with the section that contains it', () => {
		const out = selectRelevantPassages(ARTICLE, 'Napoleon height short');
		expect(out).toContain('Cultural depictions: British cartoons');
	});

	it('ignores apparatus sections, which match terms but assert nothing', () => {
		const out = selectRelevantPassages(ARTICLE, 'Napoleon height short');
		expect(out).not.toContain('Roberts, Andrew');
	});

	it('falls back to the leading prose when no paragraph matches', () => {
		// The old intro-only behaviour is the floor: an unmatched query must never
		// turn a real source into an empty snippet.
		const out = selectRelevantPassages(ARTICLE, 'photosynthesis chlorophyll');
		expect(out).toContain('Emperor of the French');
	});

	it('returns nothing for an empty extract', () => {
		expect(selectRelevantPassages('', 'anything')).toBe('');
		expect(selectRelevantPassages('   \n  ', 'anything')).toBe('');
		expect(selectRelevantPassages(null, 'anything')).toBe('');
	});

	it('splits a heading onto its own block even without a blank line around it', () => {
		const tight = 'Lead prose about the organ.\n== Taste ==\nThe tongue map claim about taste zones is a misconception.';
		const out = selectRelevantPassages(tight, 'tongue map taste zones');
		expect(out).toContain('Taste: The tongue map claim');
		// The heading must not be glued into the paragraph text itself.
		expect(out).not.toContain('== Taste ==');
	});

	it('ranks a multi-term paragraph above one that merely repeats a single term', () => {
		const doc = [
			'Coffee coffee coffee coffee coffee is widely consumed.',
			'Moderate coffee intake shows both health benefits and health risks.',
		].join('\n\n');
		const out = selectRelevantPassages(doc, 'coffee health risks benefits');
		expect(out.startsWith('Moderate coffee intake')).toBe(true);
	});

	it('respects the character cap', () => {
		const long = Array.from(
			{ length: 40 },
			(_, i) => `Paragraph ${i} discusses coffee and health at some length to consume budget.`,
		).join('\n\n');
		const out = selectRelevantPassages(long, 'coffee health', { maxChars: 200 });
		expect(out.length).toBeLessThanOrEqual(200);
		expect(out.length).toBeGreaterThan(0);
	});
});

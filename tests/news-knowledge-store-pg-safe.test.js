// The news knowledge store writes every extracted story to Postgres. Postgres
// refuses two things a JavaScript string carries without complaint: an unpaired
// UTF-16 surrogate inside jsonb ("invalid input syntax for type json") and NUL
// ("\u0000 cannot be converted to text"). Publisher pages and length-capped
// slices produce both, and either one dropped the whole story: 120 failed
// writes a day in production (measured 2026-10-09). The write must repair them.

import { describe, it, expect, vi } from 'vitest';

const calls = [];
vi.mock('../api/_lib/db.js', () => ({
	sql: vi.fn(async (strings, ...values) => {
		calls.push({ text: strings.join('?'), values });
		return [];
	}),
}));
vi.mock('../api/_lib/env.js', () => ({ databaseConfigured: () => true }));

const { recordExtraction } = await import('../api/_lib/news-knowledge-store.js');

const LONE_HIGH = '\ud83d';
const hasLoneSurrogate = (s) => /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(s);

describe('recordExtraction writes only what Postgres accepts', () => {
	it('repairs a sliced emoji and drops NUL in the jsonb doc and the text columns', async () => {
		const ok = await recordExtraction({
			id: 'story-1',
			url: 'https://example.com/story',
			title: `Headline cut mid-emoji ${LONE_HIGH}`,
			summary: `Summary with a NUL\u0000 and a split ${LONE_HIGH}`,
			author: 'Reporter\u0000',
			paragraphs: [`First paragraph ends on half an emoji ${LONE_HIGH}`, 'Clean paragraph 😀'],
			key_points: [`Point\u0000`],
			entities: [`Entity ${LONE_HIGH}`],
			content_chars: 120,
		});
		expect(ok).toBe(true);

		const insert = calls.find((c) => /insert into news_knowledge/.test(c.text));
		expect(insert).toBeTruthy();
		const strings = insert.values.flat().filter((v) => typeof v === 'string');
		for (const s of strings) {
			expect(hasLoneSurrogate(s)).toBe(false);
			expect(s.includes('\u0000')).toBe(false);
			// JSON.stringify escapes a lone surrogate as text; that escape is what
			// Postgres rejects inside jsonb.
			expect(/\\ud[89ab][0-9a-f]{2}(?!\\ud[c-f])/i.test(s)).toBe(false);
			expect(s.includes('\\u0000')).toBe(false);
		}

		const doc = JSON.parse(strings.find((s) => s.startsWith('{"paragraphs"')));
		expect(doc.paragraphs[0]).toBe('First paragraph ends on half an emoji �');
		expect(doc.paragraphs[1]).toBe('Clean paragraph 😀');
		expect(doc.key_points[0]).toBe('Point');
	});
});

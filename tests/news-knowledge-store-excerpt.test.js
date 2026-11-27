// The news knowledge base keeps the quotable excerpt, never the publisher's
// body: stored paragraphs, summary and key points are bounded at write time.

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
const { EXCERPT_MAX_CHARS } = await import('../api/_lib/news-rights.js');

describe('recordExtraction stores an excerpt only', () => {
	it('caps a 60-paragraph body, the summary and the key points', async () => {
		const para = 'A full paragraph of the publisher body that runs on for a good while to be realistic. '.repeat(4);
		const ok = await recordExtraction({
			id: 'story-cap',
			url: 'https://publisher.example/story-cap',
			title: 'Headline',
			paragraphs: Array.from({ length: 60 }, () => para),
			summary: 'S'.repeat(1500),
			key_points: Array.from({ length: 6 }, () => 'K'.repeat(300)),
			content_chars: 20000,
		});
		expect(ok).toBe(true);
		const insert = calls.find((c) => /insert into news_knowledge/.test(c.text));
		const doc = JSON.parse(insert.values.find((v) => typeof v === 'string' && v.startsWith('{"paragraphs"')));
		expect(doc.paragraphs.join('').length).toBeLessThanOrEqual(EXCERPT_MAX_CHARS + 1);
		expect(doc.paragraphs.length).toBeLessThanOrEqual(2);
		expect(doc.excerpt_truncated).toBe(true);
		expect(doc.key_points).toHaveLength(3);
		expect(doc.key_points.every((k) => k.length <= 141)).toBe(true);
		const summary = insert.values.find((v) => typeof v === 'string' && v.startsWith('SSS'));
		expect(summary.length).toBeLessThanOrEqual(400);
	});
});

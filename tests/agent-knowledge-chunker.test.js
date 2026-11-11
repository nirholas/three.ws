import { describe, it, expect } from 'vitest';
import {
	chunkDocument,
	TARGET_TOKENS,
	MAX_UNIT_TOKENS,
} from '../api/_lib/knowledge-chunker.js';
import { estimateTokens } from '../api/_lib/chunker.js';

// Inputs mirror the Markdown MarkItDown 0.1.9 actually emits for each format
// (captured from workers/markitdown converting its own fixtures).

const para = (word, n) => Array.from({ length: n }, (_, i) => `${word} sentence ${i}.`).join(' ');

describe('chunkDocument: headings', () => {
	const md = [
		'# Northwind Field Handbook',
		'',
		para('Intro', 12),
		'',
		'## Shift hours',
		'',
		para('Shift', 12),
		'',
		'## Returns policy',
		'',
		'Customers may return a repaired unit within 45 days. ' + para('Returns', 12),
		'',
		'### Damaged returns',
		'',
		para('Damaged', 12),
	].join('\n');

	it('splits on headings and keeps each section separate', () => {
		const chunks = chunkDocument(md, { kind: 'docx' });
		const returns = chunks.find((c) => c.heading.endsWith('Returns policy'));
		expect(returns).toBeTruthy();
		expect(returns.content).toContain('within 45 days');
		expect(returns.content).not.toContain('Shift sentence');
		expect(returns.content).not.toContain('Damaged sentence');
	});

	it('labels every chunk with its heading path', () => {
		const chunks = chunkDocument(md, { kind: 'docx' });
		expect(chunks.map((c) => c.heading)).toEqual([
			'Northwind Field Handbook',
			'Northwind Field Handbook > Shift hours',
			'Northwind Field Handbook > Returns policy',
			'Northwind Field Handbook > Returns policy > Damaged returns',
		]);
		for (const c of chunks) expect(c.content.startsWith(c.heading + '\n')).toBe(true);
	});

	it('ignores heading-like lines inside code fences', () => {
		const fenced = ['## Setup', '', para('Setup', 12), '', '```', '# not a heading', '```', ''].join('\n');
		const chunks = chunkDocument(fenced, { kind: 'docx' });
		expect(chunks).toHaveLength(1);
		expect(chunks[0].content).toContain('# not a heading');
	});

	it('splits a long section on paragraph boundaries and loses no text', () => {
		const paragraphs = Array.from({ length: 30 }, (_, i) => para(`P${i}`, 10));
		const long = ['## Procedures', '', paragraphs.join('\n\n')].join('\n');
		const chunks = chunkDocument(long, { kind: 'docx' });
		expect(chunks.length).toBeGreaterThan(1);
		for (const c of chunks) {
			expect(c.heading).toBe('Procedures');
			expect(c.token_count).toBeLessThanOrEqual(TARGET_TOKENS + 40);
		}
		const all = chunks.map((c) => c.content).join('\n');
		for (let i = 0; i < 30; i++) expect(all).toContain(`P${i} sentence 9.`);
	});

	it('merges a tiny section into the next one instead of embedding a fragment', () => {
		const tiny = ['# Guide', '', 'Short intro.', '', '## Details', '', para('Detail', 12)].join('\n');
		const chunks = chunkDocument(tiny, { kind: 'docx' });
		expect(chunks).toHaveLength(1);
		expect(chunks[0].content).toContain('Short intro.');
		expect(chunks[0].content).toContain('Detail sentence 0.');
	});
});

describe('chunkDocument: slides', () => {
	const deck = [
		'<!-- Slide number: 1 -->',
		'# Northwind 2027 roadmap',
		'Three launches, one per quarter after Q1.',
		'',
		'<!-- Slide number: 2 -->',
		'# Q2: Depot app',
		'Technicians book bays from their phone. Pilot in the Leeds depot.',
		'',
		'### Notes:',
		'Mention the Leeds pilot dates.',
		'',
		'<!-- Slide number: 3 -->',
		'# Q3: Parts locker',
		'Self-service parts pickup open 24 hours, badge access only.',
	].join('\n');

	it('keeps each slide as exactly one chunk, notes included', () => {
		const chunks = chunkDocument(deck, { kind: 'pptx' });
		expect(chunks).toHaveLength(3);
		expect(chunks.map((c) => c.locator)).toEqual(['Slide 1', 'Slide 2', 'Slide 3']);
		expect(chunks[1].heading).toBe('Slide 2: Q2: Depot app');
		expect(chunks[1].content).toContain('Pilot in the Leeds depot.');
		expect(chunks[1].content).toContain('Mention the Leeds pilot dates.');
		expect(chunks[1].content).not.toContain('Slide number');
		expect(chunks[1].content).not.toContain('Parts locker');
	});

	it('does not split a slide that is longer than the prose target', () => {
		const big = ['<!-- Slide number: 1 -->', '# Dense slide', para('Bullet', 220)].join('\n');
		expect(estimateTokens(big)).toBeGreaterThan(TARGET_TOKENS);
		expect(estimateTokens(big)).toBeLessThan(MAX_UNIT_TOKENS);
		const chunks = chunkDocument(big, { kind: 'pptx' });
		expect(chunks).toHaveLength(1);
		expect(chunks[0].content).toContain('Bullet sentence 219.');
	});
});

describe('chunkDocument: sheets', () => {
	const book = [
		'## Price list',
		'| SKU | Item | Price (EUR) |',
		'| --- | --- | --- |',
		'| NW-100 | Battery health check | 19 |',
		'| NW-210 | Screen replacement, 13 inch | 189 |',
		'',
		'## Support tiers',
		'| Tier | Response time | Monthly fee (EUR) |',
		'| --- | --- | --- |',
		'| Basic | 2 business days | 0 |',
		'| Priority | 4 hours | 49 |',
	].join('\n');

	it('keeps each sheet as one chunk with its whole table', () => {
		const chunks = chunkDocument(book, { kind: 'xlsx' });
		expect(chunks).toHaveLength(2);
		expect(chunks.map((c) => c.locator)).toEqual(['Sheet: Price list', 'Sheet: Support tiers']);
		expect(chunks[0].content).toContain('| NW-210 | Screen replacement, 13 inch | 189 |');
		expect(chunks[0].content).not.toContain('Priority');
		expect(chunks[1].content).toContain('| Priority | 4 hours | 49 |');
	});

	it('splits an oversized sheet on row boundaries and repeats the header row', () => {
		const rows = Array.from({ length: 900 }, (_, i) => `| SKU-${i} | Part number ${i} with a description | ${i} |`);
		const huge = ['## Inventory', '| SKU | Item | Qty |', '| --- | --- | --- |', ...rows].join('\n');
		const chunks = chunkDocument(huge, { kind: 'xlsx' });
		expect(chunks.length).toBeGreaterThan(1);
		for (const c of chunks) {
			expect(c.locator).toBe('Sheet: Inventory');
			expect(c.content).toContain('| SKU | Item | Qty |\n| --- | --- | --- |');
			expect(c.token_count).toBeLessThanOrEqual(MAX_UNIT_TOKENS);
			for (const line of c.content.split('\n').filter((l) => l.startsWith('| SKU-'))) {
				expect(line).toMatch(/^\| SKU-\d+ \| Part number \d+ with a description \| \d+ \|$/);
			}
		}
		const all = chunks.map((c) => c.content).join('\n');
		expect(all).toContain('| SKU-0 |');
		expect(all).toContain('| SKU-899 |');
	});
});

describe('chunkDocument: pdf, email, edge cases', () => {
	it('labels pdf chunks with their page from the form-feed page breaks', () => {
		const pdf =
			'Northwind Service Level Brief\nPriority customers receive an engineer on site within 4 hours.\n\n\fEscalation\nUnresolved priority tickets escalate after 24 hours.';
		const chunks = chunkDocument(pdf, { kind: 'pdf' });
		expect(chunks.map((c) => c.locator)).toEqual(['Page 1', 'Page 2']);
		expect(chunks[1].content).toContain('escalate after 24 hours');
		expect(chunks[1].content).not.toContain('\f');
	});

	it('keeps an email as one unit labelled with its subject', () => {
		const msg = [
			'# Email Message',
			'',
			'**From:** depot.lead@northwind.example',
			'**To:** all-technicians@northwind.example',
			'**Subject:** Holiday opening hours',
			'',
			'## Content',
			'',
			'The depot closes at 14:00 on 24 December.',
		].join('\n');
		const chunks = chunkDocument(msg, { kind: 'msg' });
		expect(chunks).toHaveLength(1);
		expect(chunks[0].heading).toBe('Email: Holiday opening hours');
		expect(chunks[0].content).toContain('**From:** depot.lead@northwind.example');
		expect(chunks[0].content).toContain('closes at 14:00 on 24 December');
	});

	it('returns nothing for empty or whitespace-only input', () => {
		expect(chunkDocument('', { kind: 'docx' })).toEqual([]);
		expect(chunkDocument('  \n\n ', { kind: 'pdf' })).toEqual([]);
	});

	it('reports token counts that match the content', () => {
		const chunks = chunkDocument('## A\n\n' + para('A', 30), { kind: 'docx' });
		for (const c of chunks) expect(c.token_count).toBe(estimateTokens(c.content));
	});
});

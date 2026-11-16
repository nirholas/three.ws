// chunkPdfBlocks (api/_lib/knowledge-chunker.js): layout blocks from the NVIDIA
// PDF pipeline become knowledge chunks that keep each table whole, carry the
// page and element type, and stay within the embedder's window.

import { describe, it, expect } from 'vitest';
import { chunkPdfBlocks, MAX_UNIT_TOKENS } from '../api/_lib/knowledge-chunker.js';

const para = (page, text) => ({ type: 'text', page, text, bbox: { x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.2 } });
const title = (page, text) => ({ type: 'title', page, text });
const sentence = (n) => `Sentence ${n} explains how the sliding window attention keeps memory flat as context grows.`;

function table(page, rows, caption = 'Table 2: Comparison of models.') {
	const cells = [['Model', 'MMLU', 'GSM8K'], ...rows];
	const markdown = [`| ${cells[0].join(' | ')} |`, '| --- | --- | --- |', ...cells.slice(1).map((r) => `| ${r.join(' | ')} |`)].join('\n');
	return { type: 'table', page, caption, markdown, cells, text: markdown, bbox: { x0: 0.1, y0: 0.3, x1: 0.9, y1: 0.5 } };
}

describe('chunkPdfBlocks', () => {
	it('emits a table as one chunk with its caption, page and element', () => {
		const chunks = chunkPdfBlocks([
			title(1, 'Results'),
			para(1, sentence(1)),
			table(1, [['Mistral 7B', '60.1%', '52.2%'], ['Llama 2 13B', '55.6%', '34.3%']]),
			para(1, sentence(2)),
		]);
		const t = chunks.find((c) => c.source.element === 'table');
		expect(t.heading).toBe('Page 1 · Table 2: Comparison of models.');
		expect(t.locator).toBe('Page 1');
		expect(t.content).toContain('| Mistral 7B | 60.1% | 52.2% |');
		expect(t.content).toContain('Table 2: Comparison of models.');
		expect(t.source).toEqual({ page: 1, element: 'table', bbox: { x0: 0.1, y0: 0.3, x1: 0.9, y1: 0.5 } });
		// Prose before and after the table is not merged across it.
		const text = chunks.filter((c) => c.source.element === 'text');
		expect(text).toHaveLength(2);
		expect(text[0].heading).toBe('Page 1 · Results');
		expect(chunks.map((c) => c.chunk_index)).toEqual(chunks.map((_, i) => i));
	});

	it('carries the section title across pages and uses the document title first', () => {
		const chunks = chunkPdfBlocks([para(1, sentence(1)), title(1, 'Method'), para(2, sentence(2))], { title: 'Mistral 7B' });
		expect(chunks[0].heading).toBe('Page 1 · Mistral 7B');
		expect(chunks[1].heading).toBe('Page 2 · Method');
		expect(chunks[1].source).toEqual({ page: 2, element: 'text' });
	});

	it('describes a chart by its caption and reads its values into the chunk', () => {
		const chunks = chunkPdfBlocks([
			{ type: 'chart', page: 4, caption: 'Figure 4: Performance by size.', text: 'Categories: MMLU, Reasoning\nValues read from the chart:\nMMLU: 7B = 60.1', bbox: { x0: 0.1, y0: 0.1, x1: 0.5, y1: 0.3 } },
		]);
		expect(chunks).toHaveLength(1);
		expect(chunks[0].heading).toBe('Page 4 · Figure 4: Performance by size.');
		expect(chunks[0].source.element).toBe('chart');
		expect(chunks[0].content).toContain('MMLU: 7B = 60.1');
	});

	it('splits a very long table by rows, repeating the header, and gives each part an embed digest', () => {
		const rows = Array.from({ length: 400 }, (_, i) => [`Model number ${i}`, `${(40 + (i % 50)).toFixed(1)}%`, `${(10 + (i % 70)).toFixed(1)}%`]);
		const chunks = chunkPdfBlocks([table(3, rows, 'Table 9: Every checkpoint we evaluated.')]);
		expect(chunks.length).toBeGreaterThan(1);
		for (const [i, c] of chunks.entries()) {
			expect(c.source).toMatchObject({ page: 3, element: 'table', part: i + 1, parts: chunks.length });
			expect(c.content).toContain('| Model | MMLU | GSM8K |');
			expect(c.token_count).toBeLessThanOrEqual(MAX_UNIT_TOKENS + 50);
			// Parts longer than the embedder's window embed a digest instead.
			if (c.content.length > 1500) {
				expect(c.embed_text.length).toBeLessThanOrEqual(1500);
				expect(c.embed_text).toContain('Table 9: Every checkpoint we evaluated.');
			} else expect(c.embed_text).toBeUndefined();
		}
		// Every row lands in exactly one part.
		const all = chunks.map((c) => c.content).join('\n');
		for (const r of [0, 199, 399]) expect(all.split(`| Model number ${r} |`).length - 1).toBe(1);
	});

	it('skips empty blocks and returns nothing for an empty document', () => {
		expect(chunkPdfBlocks([])).toEqual([]);
		expect(chunkPdfBlocks([para(1, '   '), { type: 'table', page: 1, text: '' }])).toEqual([]);
	});
});

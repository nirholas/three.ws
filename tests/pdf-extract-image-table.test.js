// A table pasted into a born-digital PDF as a picture (a leaderboard
// screenshot) has no text layer. The detector boxes it as a table; the page
// itself has plenty of text, so it is not treated as scanned. The table's
// words must then come from OCR of the crop, or every value in it is lost
// (Mixtral paper, Figure 6: 0/3 in the 2026-11-16 eval).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import sharp from 'sharp';

const ocr = vi.fn();
vi.mock('../api/_lib/nvidia-doc-extract.js', () => ({
	pageElements: vi.fn(async () => ({
		paragraph: [{ x0: 0.1, y0: 0.05, x1: 0.9, y1: 0.3, confidence: 0.9 }],
		table: [{ x0: 0.2, y0: 0.5, x1: 0.8, y1: 0.8, confidence: 0.9 }],
	})),
	// Crop frame: a header row and one data row, two columns.
	tableStructure: vi.fn(async () => ({
		row: [
			{ x0: 0, y0: 0.05, x1: 1, y1: 0.45, confidence: 0.9 },
			{ x0: 0, y0: 0.55, x1: 1, y1: 0.95, confidence: 0.9 },
		],
		column: [
			{ x0: 0.02, y0: 0, x1: 0.48, y1: 1, confidence: 0.9 },
			{ x0: 0.52, y0: 0, x1: 0.98, y1: 1, confidence: 0.9 },
		],
		cell: [],
	})),
	graphicElements: vi.fn(async () => ({})),
	ocr: (...args) => ocr(...args),
	readChart: vi.fn(async () => ''),
}));

// The page: prose words in the top band only; nothing inside the table box.
const prose = 'Mixtral outperforms Llama 2 70B on most benchmarks while using fewer active parameters during inference'.split(' ');
vi.mock('../api/_lib/pdf-render.js', () => ({
	renderPage: vi.fn(async () => {
		const bytes = await sharp({ create: { width: 600, height: 800, channels: 3, background: '#ffffff' } }).jpeg().toBuffer();
		return { bytes, mime: 'image/jpeg', width: 600, height: 800 };
	}),
	pageWords: vi.fn(async () => prose.map((text, i) => ({ text, x0: 0.1 + (i % 8) * 0.1, x1: 0.18 + (i % 8) * 0.1, y0: 0.1 + Math.floor(i / 8) * 0.03, y1: 0.12 + Math.floor(i / 8) * 0.03 }))),
}));

const { extractPage } = await import('../api/_lib/pdf-extract.js');

describe('extractPage: a table that is a picture on a text page', () => {
	beforeEach(() => {
		ocr.mockReset();
		ocr.mockResolvedValue([
			{ text: 'Model', confidence: 0.99, x0: 0.05, y0: 0.15, x1: 0.3, y1: 0.35 },
			{ text: 'Arena Elo', confidence: 0.99, x0: 0.55, y0: 0.15, x1: 0.9, y1: 0.35 },
			{ text: 'GPT-4-0613', confidence: 0.99, x0: 0.05, y0: 0.65, x1: 0.4, y1: 0.85 },
			{ text: '1158', confidence: 0.99, x0: 0.55, y0: 0.65, x1: 0.7, y1: 0.85 },
		]);
	});

	it('reads the table cells with OCR when the text layer has none inside the box', async () => {
		const { scanned, blocks } = await extractPage({}, 6);
		expect(scanned).toBe(false);
		const table = blocks.find((b) => b.type === 'table');
		expect(table).toBeTruthy();
		expect(table.markdown).toContain('| GPT-4-0613 | 1158 |');
		expect(table.method).toBe('ocr');
		expect(ocr).toHaveBeenCalledTimes(1);
	});
});

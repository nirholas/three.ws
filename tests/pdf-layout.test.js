// Layout rules of the NVIDIA PDF extraction pipeline (api/_lib/pdf-layout.js)
// and the response parsing in api/_lib/nvidia-doc-extract.js.
//
// The table case replays real nemotron-table-structure-v1 and nemotron-ocr-v2
// responses recorded on 2026-11-16 for a crop of Table 2 in the Mistral 7B
// paper (arXiv 2310.06825, CC BY 4.0), so the cell assembly is checked
// against what the models actually return, OCR noise included.

import { readFileSync } from 'node:fs';
import { describe, it, expect, afterEach, vi } from 'vitest';

process.env.NVIDIA_API_KEY ||= 'nvapi-test-key';

const L = await import('../api/_lib/pdf-layout.js');
const extract = await import('../api/_lib/nvidia-doc-extract.js');

const fixture = (name) => readFileSync(new URL(`./fixtures/nvidia-doc-extract/${name}`, import.meta.url));
const IMAGE = { bytes: Buffer.from([0xff, 0xd8, 0xff]), mime: 'image/jpeg' };

// One word box; height 0.01 unless given.
const w = (text, x0, y0, x1, y1 = y0 + 0.01) => ({ text, x0, y0, x1, y1 });
// A line of words laid out left to right from x with fixed advance.
function line(text, x, y, step = 0.04) {
	return text.split(' ').map((t, i) => w(t, x + i * step, y, x + i * step + step * 0.8));
}

afterEach(() => vi.unstubAllGlobals());

describe('NVIDIA response parsing', () => {
	it('turns table-structure and OCR responses into normalised boxes', async () => {
		vi.stubGlobal('fetch', vi.fn(async (url) => {
			const name = String(url).includes('table-structure') ? 'mistral7b-p4-table2-structure.json' : 'mistral7b-p4-table2-ocr.json';
			return new Response(fixture(name), { status: 200, headers: { 'content-type': 'application/json' } });
		}));
		const structure = await extract.tableStructure(IMAGE);
		expect(structure.row.length).toBeGreaterThan(4);
		expect(structure.column.length).toBeGreaterThan(10);
		for (const b of [...structure.row, ...structure.column]) {
			expect(b.x0).toBeGreaterThanOrEqual(0);
			expect(b.x1).toBeLessThanOrEqual(1);
			expect(b.y1).toBeGreaterThan(b.y0);
		}
		const lines = await extract.ocr(IMAGE);
		expect(lines.find((l) => l.text === 'Model')).toMatchObject({ x0: expect.any(Number), confidence: expect.any(Number) });

		const cells = L.assembleTable(structure, L.explodeLines(lines));
		const mistral = cells.find((r) => r[0] === 'Mistral 7B');
		expect(mistral).toBeTruthy();
		expect(mistral).toContain('60.1%');
		expect(mistral).toContain('81.3%');
		expect(mistral).toContain('52.2%');
		const llama = cells.find((r) => r[0] === 'LLaMA 2 7B');
		expect(llama.slice(1)).toEqual(['Pretrained', '44.4%', '77.1%', '69.5%', '77.9%', '68.7%', '43.2%', '24.7%', '63.8%', '11.6%', '26.1%', '3.9%', '16.0%']);
		const md = L.tableMarkdown(cells);
		expect(md.split('\n')[1]).toMatch(/^\| --- \|/);
		expect(md).toContain('| Mistral 7B | 60.1% |');
	});

	it('names a retired model instead of failing silently', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => new Response('{"detail":"Gone"}', { status: 410 })));
		const err = await extract.pageElements(IMAGE).catch((e) => e);
		expect(err).toBeInstanceOf(extract.NvidiaExtractError);
		expect(err.status).toBe(410);
		expect(err.retired).toBe(true);
	});
});

describe('table assembly', () => {
	it('merges duplicate bands, drops empty rows and columns', () => {
		const structure = {
			row: [
				{ x0: 0, x1: 1, y0: 0.0, y1: 0.3 },
				{ x0: 0, x1: 1, y0: 0.02, y1: 0.29 }, // the same row found twice
				{ x0: 0, x1: 1, y0: 0.35, y1: 0.65 },
				{ x0: 0, x1: 1, y0: 0.7, y1: 0.95 }, // empty
			],
			column: [
				{ x0: 0.0, x1: 0.3, y0: 0, y1: 1 },
				{ x0: 0.35, x1: 0.6, y0: 0, y1: 1 },
				{ x0: 0.65, x1: 0.95, y0: 0, y1: 1 }, // empty
			],
		};
		const words = [w('Plan', 0.05, 0.1, 0.2), w('Price', 0.4, 0.1, 0.5), w('Team', 0.05, 0.45, 0.2), w('$40', 0.4, 0.45, 0.5)];
		expect(L.assembleTable(structure, words)).toEqual([
			['Plan', 'Price'],
			['Team', '$40'],
		]);
	});

	it('returns null when the detector found no grid', () => {
		expect(L.assembleTable({ row: [], column: [] }, [w('a', 0, 0, 0.1)])).toBeNull();
		expect(L.assembleTable({ row: [{ x0: 0, x1: 1, y0: 0, y1: 1 }], column: [{ x0: 0, x1: 1, y0: 0, y1: 1 }] }, [w('a', 0, 0, 0.1)])).toBeNull();
	});

	it('escapes pipes and pads ragged rows in markdown', () => {
		expect(L.tableMarkdown([['a|b', 'c'], ['d']])).toBe('| a\\|b | c |\n| --- | --- |\n| d |  |');
		expect(L.tableMarkdown([])).toBe('');
	});
});

describe('text', () => {
	it('repairs words hyphenated across a line break', () => {
		const words = [...line('the attention mech-', 0.1, 0.1, 0.12), ...line('anism scales', 0.1, 0.12, 0.12)];
		expect(L.textOf(words)).toBe('the attention mechanism scales');
	});

	it('reads a two-column region column by column', () => {
		const left = [0, 1, 2, 3].flatMap((i) => line(`left col line ${i}`, 0.08, 0.1 + i * 0.02, 0.08));
		const right = [0, 1, 2, 3].flatMap((i) => line(`right col line ${i}`, 0.55, 0.1 + i * 0.02, 0.08));
		const text = L.proseOf([...left, ...right]);
		expect(text.indexOf('left col line 3')).toBeLessThan(text.indexOf('right col line 0'));
		expect(text.split('\n\n')).toHaveLength(2);
	});

	it('flags a page with almost no text layer as scanned', () => {
		expect(L.looksScanned([])).toBe(true);
		expect(L.looksScanned(line('one short header', 0.1, 0.05))).toBe(true);
		expect(L.looksScanned(line('a '.repeat(80).trim(), 0, 0.1, 0.01))).toBe(false);
	});
});

describe('captions', () => {
	const table = { x0: 0.1, y0: 0.3, x1: 0.9, y1: 0.5 };

	it('finds the nearest "Table N:" caption above or below and ignores prose', () => {
		const blocks = [
			{ text: 'The table shows results.', x0: 0.1, y0: 0.52, x1: 0.9, y1: 0.54 },
			{ text: 'Table 2: Comparison of models.', x0: 0.1, y0: 0.51, x1: 0.9, y1: 0.53 },
			{ text: 'Figure 9: far away', x0: 0.1, y0: 0.8, x1: 0.9, y1: 0.82 },
		];
		expect(L.captionIndex(table, blocks)).toBe(1);
		expect(L.isCaption('Fig. 3. Loss curves')).toBe(true);
		expect(L.isCaption('Tables are useful')).toBe(false);
	});

	it('extends a one-line caption through the lines that continue it', () => {
		const first = line('Table 3: Comparison of chat', 0.1, 0.52, 0.1);
		const second = line('models on MT-Bench.', 0.1, 0.535, 0.1);
		const after = line('Unrelated paragraph below.', 0.1, 0.6, 0.1);
		const box = { x0: 0.1, y0: 0.52, x1: 0.6, y1: 0.53 };
		expect(L.textOf(L.captionWords(box, [...first, ...second, ...after]))).toBe('Table 3: Comparison of chat models on MT-Bench.');
	});

	it('trims a caption drawn inside the table box, unless nothing would be left', () => {
		const caption = { x0: 0.1, y0: 0.47, x1: 0.9, y1: 0.5 };
		expect(L.trimAway(table, caption).y1).toBeCloseTo(0.468);
		expect(L.trimAway({ x0: 0.1, y0: 0.46, x1: 0.9, y1: 0.5 }, caption)).toEqual({ x0: 0.1, y0: 0.46, x1: 0.9, y1: 0.5 });
	});
});

describe('reading order', () => {
	it('reads the left column before the right between full-width blocks', () => {
		const blocks = [
			{ id: 'r1', x0: 0.52, y0: 0.2, x1: 0.9, y1: 0.3 },
			{ id: 'title', x0: 0.1, y0: 0.05, x1: 0.9, y1: 0.1 },
			{ id: 'l2', x0: 0.1, y0: 0.4, x1: 0.48, y1: 0.5 },
			{ id: 'l1', x0: 0.1, y0: 0.2, x1: 0.48, y1: 0.3 },
			{ id: 'wide', x0: 0.1, y0: 0.6, x1: 0.9, y1: 0.7 },
			{ id: 'r3', x0: 0.52, y0: 0.75, x1: 0.9, y1: 0.8 },
		];
		expect(L.readingOrder(blocks).map((b) => b.id)).toEqual(['title', 'l1', 'l2', 'r1', 'wide', 'r3']);
	});
});

describe('chart hints', () => {
	it('lists title, axes, categories, series and value labels from graphic boxes', () => {
		const words = [
			w('Accuracy', 0.3, 0.02, 0.5),
			w('MMLU', 0.1, 0.9, 0.2),
			w('GSM8K', 0.4, 0.9, 0.5),
			w('7B', 0.8, 0.1, 0.85),
			w('62.5', 0.12, 0.4, 0.18),
		];
		const graphic = {
			chart_title: [{ x0: 0.3, y0: 0.02, x1: 0.5, y1: 0.03 }],
			xlabel: [{ x0: 0.4, y0: 0.9, x1: 0.5, y1: 0.91 }, { x0: 0.1, y0: 0.9, x1: 0.2, y1: 0.91 }],
			legend_label: [{ x0: 0.8, y0: 0.1, x1: 0.85, y1: 0.11 }],
			value_label: [{ x0: 0.12, y0: 0.4, x1: 0.18, y1: 0.41 }],
		};
		expect(L.chartHints(graphic, words)).toBe('Chart title: Accuracy\nCategories: MMLU, GSM8K\nSeries: 7B\nValue labels: 62.5');
	});
});

describe('geometry helpers', () => {
	it('converts page words to the crop frame and back-checks containment', () => {
		const crop = { x0: 0.5, y0: 0.5, x1: 1, y1: 1 };
		expect(L.toCrop([w('x', 0.75, 0.75, 1, 1)], crop)[0]).toMatchObject({ x0: 0.5, y0: 0.5, x1: 1, y1: 1 });
		expect(L.containment({ x0: 0.6, y0: 0.6, x1: 0.7, y1: 0.7 }, crop)).toBe(1);
		expect(L.padBox({ x0: 0, y0: 0.5, x1: 1, y1: 0.6 }, 0.1)).toEqual({ x0: 0, y0: 0.4, x1: 1, y1: 0.7 });
	});

	it('splits an OCR line that crosses columns into positioned words', () => {
		const out = L.explodeLines([{ text: 'Mistral 60.1%', x0: 0, y0: 0, x1: 0.13, y1: 0.01 }]);
		expect(out.map((x) => x.text)).toEqual(['Mistral', '60.1%']);
		expect(out[1].x0).toBeCloseTo(0.08);
	});
});

// The knowledge panel's table preview parses the markdown the server writes
// (api/_lib/pdf-layout.js tableMarkdown). Round-trip real output through the
// browser parser so escaped pipes, empty cells and separators survive.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../src/api.js', () => ({ apiFetch: vi.fn(), consumeCsrfToken: vi.fn() }));

const { parseMarkdownTable } = await import('../src/agent-knowledge-docs.js');
const { tableMarkdown } = await import('../api/_lib/pdf-layout.js');

describe('parseMarkdownTable', () => {
	it('reads back exactly the grid the server wrote', () => {
		const grid = [
			['Model', 'MMLU', 'Notes'],
			['Mistral 7B', '60.1%', 'a | b'],
			['LLaMA 2 7B', '44.4%', ''],
		];
		expect(parseMarkdownTable(tableMarkdown(grid))).toEqual(grid);
	});

	it('skips aligned separators and non-table lines', () => {
		expect(parseMarkdownTable('Caption\n| a | b |\n|:---|---:|\n| 1 | 2 |')).toEqual([['a', 'b'], ['1', '2']]);
	});

	it('returns nothing for empty or non-table input', () => {
		expect(parseMarkdownTable('')).toEqual([]);
		expect(parseMarkdownTable(null)).toEqual([]);
		expect(parseMarkdownTable('plain text only')).toEqual([]);
	});
});

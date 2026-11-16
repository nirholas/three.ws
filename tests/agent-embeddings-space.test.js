import { describe, it, expect, vi, beforeEach } from 'vitest';

// readAgentVectors is the read path for agent semantic search and identity
// checks. agent_embeddings holds vectors from several models (watsonx Granite
// and each platform lane), so a read without a model would hand back vectors
// from mixed spaces and let a caller cosine them against one query.

const sqlMock = vi.fn(async () => []);
vi.mock('../api/_lib/db.js', () => ({ sql: (...a) => sqlMock(...a) }));
vi.mock('../api/_lib/watsonx.js', () => ({ watsonxEmbed: vi.fn() }));

const { readAgentVectors } = await import('../api/_lib/agent-embeddings.js');

beforeEach(() => sqlMock.mockClear());

describe('readAgentVectors', () => {
	it('refuses to read without naming the model whose space the caller will query', async () => {
		await expect(readAgentVectors(['00000000-0000-0000-0000-000000000001'])).rejects.toThrow(/model is required/);
		await expect(readAgentVectors(['00000000-0000-0000-0000-000000000001'], { model: '' })).rejects.toThrow(/model is required/);
	});

	it('filters the read by that model', async () => {
		sqlMock.mockImplementation(async (strings) => (strings?.join?.('').includes('SELECT') ? [{ agent_id: 'a', vector: [1, 0] }] : true));
		const out = await readAgentVectors(['a'], { model: 'nvidia/nemotron-3-embed-1b@2048' });
		expect(out.get('a')).toEqual([1, 0]);
		const [strings, ...params] = sqlMock.mock.calls.at(-1);
		expect(strings.join('?')).toMatch(/model = \?/);
		expect(params).toContain('nvidia/nemotron-3-embed-1b@2048');
	});
});

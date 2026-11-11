// Agent knowledge in chat: the chunks retrieved from an agent's uploaded
// documents reach the model in the per-message (volatile) half of the system
// prompt, so the prompt-cached persona prefix stays byte-stable, and they carry
// the source document name the model is told to cite.
import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../api/chat.js';
import { knowledgePromptBlock } from '../api/_lib/agent-knowledge.js';

const hit = {
	doc_id: 'kd_1',
	name: 'Returns-Handbook.docx',
	heading: 'Returns policy',
	locator: null,
	score: 0.81,
	content: 'Returns policy\nCustomers may return unworn items within 45 days of delivery.',
};

describe('chat system prompt with agent knowledge', () => {
	it('puts the knowledge block in the volatile half, never the cached prefix', () => {
		const block = knowledgePromptBlock([hit]);
		const sys = buildSystemPrompt({}, 'You are Ada.', [], [], '', block);
		expect(sys.volatile).toContain('[Source: Returns-Handbook.docx | Returns policy]');
		expect(sys.volatile).toContain('within 45 days');
		expect(sys.stable).not.toContain('Returns-Handbook.docx');
		expect(sys.text).toContain('within 45 days');
	});

	it('tells the model to cite the document and to treat it as data', () => {
		const sys = buildSystemPrompt({}, null, [], [], '', knowledgePromptBlock([hit]));
		expect(sys.volatile).toMatch(/cite/i);
		expect(sys.volatile).toMatch(/not instructions/i);
	});

	it('leaves the prompt unchanged when nothing was retrieved', () => {
		const without = buildSystemPrompt({}, 'You are Ada.', [], [], '');
		const empty = buildSystemPrompt({}, 'You are Ada.', [], [], '', knowledgePromptBlock([]));
		expect(empty).toEqual(without);
	});

	it('keeps the stable prefix identical with and without knowledge', () => {
		const a = buildSystemPrompt({}, 'You are Ada.', [], [], '', '');
		const b = buildSystemPrompt({}, 'You are Ada.', [], [], '', knowledgePromptBlock([hit]));
		expect(b.stable).toBe(a.stable);
	});
});

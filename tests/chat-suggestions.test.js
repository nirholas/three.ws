import { describe, it, expect } from 'vitest';
import {
	SUGGEST_MARKER,
	suggestionsInstruction,
	splitSuggestions,
	createReplyFilter,
} from '../api/_lib/chat-suggestions.js';
import { buildSystemPrompt } from '../api/chat.js';

describe('suggestionsInstruction', () => {
	it('is empty when no suggestions are requested', () => {
		expect(suggestionsInstruction(0)).toBe('');
		expect(suggestionsInstruction(undefined)).toBe('');
		expect(suggestionsInstruction(-2)).toBe('');
	});
	it('asks for exactly the requested count, capped at three', () => {
		expect(suggestionsInstruction(2)).toContain('exactly 2 short options');
		expect(suggestionsInstruction(9)).toContain('exactly 3 short options');
		expect(suggestionsInstruction(2)).toContain(SUGGEST_MARKER);
	});
	it('leaves the default system prompt untouched for every other chat surface', () => {
		expect(buildSystemPrompt({}, null, [], [], '')).not.toContain(SUGGEST_MARKER);
	});
});

describe('splitSuggestions', () => {
	it('separates the spoken reply from the options', () => {
		const out = splitSuggestions(`Welcome, traveller.\n${SUGGEST_MARKER} Hello | Tell me more | Goodbye`, 3);
		expect(out.reply).toBe('Welcome, traveller.');
		expect(out.suggestions).toEqual(['Hello', 'Tell me more', 'Goodbye']);
	});
	it('returns the text untouched when the model ignored the instruction', () => {
		expect(splitSuggestions('Just a reply.', 3)).toEqual({ reply: 'Just a reply.', suggestions: [] });
	});
	it('cleans quotes, numbering and trailing punctuation, dedupes, and honours the count', () => {
		const out = splitSuggestions(`ok\n${SUGGEST_MARKER} 1. "Hello!" | hello | - Tell me more. | Goodbye`, 2);
		expect(out.suggestions).toEqual(['Hello', 'Tell me more']);
	});
	it('truncates an overlong option to the lens width', () => {
		const out = splitSuggestions(`x ${SUGGEST_MARKER} ${'a'.repeat(80)}`, 3);
		expect(out.suggestions[0].length).toBeLessThanOrEqual(28);
	});
});

describe('createReplyFilter', () => {
	const run = (chunks) => {
		const f = createReplyFilter();
		return chunks.map((c) => f.push(c)).join('') + f.flush();
	};
	it('passes plain text through unchanged', () => {
		expect(run(['Hel', 'lo ', 'there'])).toBe('Hello there');
	});
	it('withholds the marker line even when split across chunks', () => {
		expect(run(['Hi there.\n<<re', 'plies>> A | B'])).toBe('Hi there.\n');
		expect(run(['Hi', '<', '<replies>', '> A'])).toBe('Hi');
	});
	it('releases a held fragment that turned out not to be the marker', () => {
		expect(run(['3 << 4 is', ' 48'])).toBe('3 << 4 is 48');
		expect(run(['ends with <<rep'])).toBe('ends with <<rep');
	});
	it('drops everything after the marker', () => {
		expect(run([`a ${SUGGEST_MARKER} b`, ' more'])).toBe('a ');
	});
});

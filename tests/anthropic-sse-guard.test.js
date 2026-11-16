import { describe, expect, it } from 'vitest';
import {
	createAnthropicSseGuard,
	lastVisitorText,
	syntheticJsonMessage,
	syntheticSseMessage,
	textHistory,
} from '../api/_lib/anthropic-sse-guard.js';

const frame = (obj) => `event: ${obj.type}\ndata: ${JSON.stringify(obj)}\n\n`;

function parseFrames(text) {
	return text
		.split('\n\n')
		.filter((f) => f.trim())
		.map((f) => JSON.parse(f.split('\n').find((l) => l.startsWith('data:')).slice(5)));
}

/** A protocol check: every started block is stopped, deltas target an open block, and the message ends cleanly. */
function assertValidStream(events) {
	expect(events[0].type).toBe('message_start');
	expect(events.at(-1).type).toBe('message_stop');
	expect(events.at(-2).type).toBe('message_delta');
	const open = new Set();
	for (const e of events) {
		if (e.type === 'content_block_start') open.add(e.index);
		if (e.type === 'content_block_delta') expect(open.has(e.index)).toBe(true);
		if (e.type === 'content_block_stop') open.delete(e.index);
	}
	expect(open.size).toBe(0);
}

function upstreamFrames(texts) {
	return [
		frame({ type: 'message_start', message: { id: 'm1', type: 'message', role: 'assistant', content: [], model: 'x' } }),
		frame({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }),
		...texts.map((text) => frame({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } })),
		frame({ type: 'content_block_stop', index: 0 }),
		frame({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 9 } }),
		frame({ type: 'message_stop' }),
	];
}

function sink() {
	const out = { body: '', ended: false };
	return { out, res: { write: (s) => (out.body += s), end: () => (out.ended = true) } };
}

const textOf = (events) =>
	events
		.filter((e) => e.type === 'content_block_delta' && e.delta?.type === 'text_delta')
		.map((e) => e.delta.text)
		.join('');

describe('lastVisitorText / textHistory', () => {
	it('reads the last user turn as text', () => {
		expect(lastVisitorText([{ role: 'user', content: 'hi there' }])).toBe('hi there');
		expect(lastVisitorText([{ role: 'user', content: [{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }] }])).toBe('a\nb');
	});
	it('is empty on a tool-result round, an assistant tail, or junk', () => {
		expect(lastVisitorText([{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'x' }] }])).toBe('');
		expect(lastVisitorText([{ role: 'assistant', content: 'x' }])).toBe('');
		expect(lastVisitorText(null)).toBe('');
	});
	it('history drops the current turn and non-text roles', () => {
		const h = textHistory([
			{ role: 'user', content: 'one' },
			{ role: 'assistant', content: [{ type: 'text', text: 'two' }, { type: 'tool_use' }] },
			{ role: 'user', content: [{ type: 'tool_result' }] },
			{ role: 'user', content: 'now' },
		]);
		expect(h).toEqual([
			{ role: 'user', content: 'one' },
			{ role: 'assistant', content: 'two' },
		]);
	});
});

describe('synthetic messages', () => {
	it('SSE form is a complete valid stream carrying the text', () => {
		const events = parseFrames(syntheticSseMessage('Not here.', 'm'));
		assertValidStream(events);
		expect(textOf(events)).toBe('Not here.');
	});
	it('JSON form is a finished message', () => {
		const m = syntheticJsonMessage('Not here.', 'm');
		expect(m.content).toEqual([{ type: 'text', text: 'Not here.' }]);
		expect(m.stop_reason).toBe('end_turn');
	});
});

describe('createAnthropicSseGuard', () => {
	const safe = async () => ({ flagged: false });

	it('passes a safe reply through as a valid stream, in order, across odd chunking', async () => {
		const { out, res } = sink();
		const g = createAnthropicSseGuard({ res, userMessage: 'q', replacement: 'R', classify: safe });
		const raw = upstreamFrames(['The sky is blue because of Rayleigh scattering. ', 'Short wavelengths scatter more. ', 'That is all.']).join('');
		for (let i = 0; i < raw.length; i += 7) g.write(raw.slice(i, i + 7));
		const result = await g.close();
		const events = parseFrames(out.body);
		assertValidStream(events);
		expect(textOf(events)).toBe('The sky is blue because of Rayleigh scattering. Short wavelengths scatter more. That is all.');
		expect(result.blocked).toBeNull();
		expect(out.ended).toBe(true);
	});

	it('stops on an unsafe sentence, fires onBlock, and closes with the replacement', async () => {
		const { out, res } = sink();
		let stopped = 0;
		const g = createAnthropicSseGuard({
			res,
			userMessage: 'q',
			replacement: 'I cannot help with that.',
			onBlock: () => stopped++,
			classify: async ({ assistant }) => ({ flagged: /BAD/.test(assistant), categories: ['Violence'] }),
		});
		for (const f of upstreamFrames(['This first sentence is entirely harmless text. ', 'Then BAD content follows here in full. ', 'And more after.'])) g.write(f);
		const result = await g.close();
		const events = parseFrames(out.body);
		assertValidStream(events);
		const text = textOf(events);
		expect(text).not.toMatch(/BAD|more after/);
		expect(text).toMatch(/I cannot help with that\.$/);
		expect(result.blocked?.check).toBe('output_safety');
		expect(stopped).toBe(1);
		expect(events.filter((e) => e.type === 'message_stop')).toHaveLength(1);
	});

	it('writes a valid message even when blocked before any frame was released', async () => {
		const { out, res } = sink();
		const g = createAnthropicSseGuard({
			res,
			userMessage: 'q',
			replacement: 'Nope.',
			classify: async () => ({ flagged: true, categories: [] }),
		});
		g.write(frame({ type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', content: [] } }));
		g.write(frame({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }));
		g.write(frame({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Everything here is flagged by the classifier.' } }));
		await g.close();
		const events = parseFrames(out.body);
		assertValidStream(events);
		expect(textOf(events)).toBe('Nope.');
	});

	it('opens a fresh text block when the hit lands after the text block closed (tool_use follows)', async () => {
		const { out, res } = sink();
		const g = createAnthropicSseGuard({
			res,
			userMessage: 'q',
			replacement: 'Stopped.',
			classify: async ({ assistant }) => ({ flagged: /BAD/.test(assistant) }),
		});
		g.write(frame({ type: 'message_start', message: { id: 'm', type: 'message', role: 'assistant', content: [] } }));
		g.write(frame({ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }));
		g.write(frame({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'A perfectly fine opening sentence lives here.' } }));
		g.write(frame({ type: 'content_block_stop', index: 0 }));
		g.write(frame({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }));
		g.write(frame({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'And a BAD second block arrives afterwards.' } }));
		await g.close();
		const events = parseFrames(out.body);
		assertValidStream(events);
		expect(textOf(events)).not.toMatch(/BAD/);
		expect(textOf(events)).toMatch(/Stopped\.$/);
	});

	it('fails open: a classifier error releases the text and counts it unchecked', async () => {
		const { out, res } = sink();
		const g = createAnthropicSseGuard({
			res,
			userMessage: 'q',
			replacement: 'R',
			classify: async () => {
				throw new Error('410');
			},
		});
		for (const f of upstreamFrames(['Some reply text that the guard cannot judge right now.'])) g.write(f);
		const result = await g.close();
		const events = parseFrames(out.body);
		assertValidStream(events);
		expect(textOf(events)).toBe('Some reply text that the guard cannot judge right now.');
		expect(result.unchecked).toBeGreaterThan(0);
		expect(result.blocked).toBeNull();
	});
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSSEParser, formatSSE, readSSE } from '../shared/sse.js';
import { fixture, sseText, streamingResponse } from './helpers.mjs';

function parseAll(chunks) {
	const out = [];
	const parser = createSSEParser((evt) => out.push(evt));
	for (const c of chunks) parser.push(c);
	parser.end();
	return out;
}

test('parses events with event, data and id fields', () => {
	const events = parseAll(['event: job\ndata: {"a":1}\nid: 7\n\n', 'data: plain\n\n']);
	assert.deepEqual(events, [
		{ event: 'job', data: '{"a":1}', id: '7' },
		{ event: 'message', data: 'plain', id: '7' },
	]);
});

test('gives the same events however the stream is split, down to single characters', () => {
	const text = 'event: text\ndata: {"delta":"hello"}\n\n: keep-alive\n\nevent: done\r\ndata: {}\r\n\r\n';
	const whole = parseAll([text]);
	assert.equal(whole.length, 2);
	assert.deepEqual(parseAll([...text]), whole);
	for (let cut = 1; cut < text.length; cut += 1) assert.deepEqual(parseAll([text.slice(0, cut), text.slice(cut)]), whole, `split at ${cut}`);
});

test('a CRLF pair split across chunks ends exactly one line', () => {
	const events = parseAll(['data: a\r', '\ndata: b\r\n\r\n']);
	assert.deepEqual(events, [{ event: 'message', data: 'a\nb', id: '' }]);
});

test('joins multi-line data with newlines and ignores comments and unknown fields', () => {
	const events = parseAll([': comment\nretry: 100\nfoo: bar\ndata: line 1\ndata: line 2\ndata\n\n']);
	assert.deepEqual(events, [{ event: 'message', data: 'line 1\nline 2\n', id: '' }]);
});

test('a final event without its blank line is still delivered at end()', () => {
	assert.deepEqual(parseAll(['data: last']), [{ event: 'message', data: 'last', id: '' }]);
});

test('an event with no data lines is not dispatched', () => {
	assert.deepEqual(parseAll(['event: ping\n\n']), []);
});

test('readSSE yields every event of a streamed body, including xAI\'s [DONE] marker', async () => {
	const { rounds } = fixture('xai/responses-stream-forge.json');
	const seen = [];
	for await (const evt of readSSE(streamingResponse(sseText(rounds[0]), { chunk: 5 }).body)) seen.push(evt.data);
	assert.equal(seen.length, rounds[0].length + 1);
	assert.equal(seen.at(-1), '[DONE]');
	assert.deepEqual(JSON.parse(seen[0]), rounds[0][0]);
});

test('formatSSE output parses back to the same event', () => {
	const data = { delta: 'two\nlines', n: 1 };
	const [evt] = parseAll([formatSSE('text', data)]);
	assert.equal(evt.event, 'text');
	assert.deepEqual(JSON.parse(evt.data), data);
});

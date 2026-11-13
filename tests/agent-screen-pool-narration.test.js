import { describe, it, expect } from 'vitest';
import {
	drainBrainStream,
	generateNarration,
	parseNarrationJson,
} from '../workers/agent-screen-pool/task-runner.js';

function sse(chunks) {
	const enc = new TextEncoder();
	return new ReadableStream({
		start(c) {
			for (const ch of chunks) c.enqueue(enc.encode(ch));
			c.close();
		},
	});
}

const task = (id) => ({
	id,
	title: 'Look up a pump.fun coin page',
	topic: 'the $THREE token',
	steps: [
		{ id: 'open', kind: 'goto', narration: 'Opening the page' },
		{ id: 'type', kind: 'type', narration: 'Typing the query' },
	],
});

describe('agent-screen-pool narration contract', () => {
	it('parseNarrationJson extracts the object from fenced or chatty model text', () => {
		expect(parseNarrationJson('```json\n{"open":"Go"}\n```')).toEqual({ open: 'Go' });
		expect(parseNarrationJson('Sure: {"a":"b"} done')).toEqual({ a: 'b' });
		expect(parseNarrationJson('no json here')).toBeNull();
		expect(parseNarrationJson('{broken')).toBeNull();
		expect(parseNarrationJson('')).toBeNull();
	});

	it('drainBrainStream joins data chunks across split reads and skips event payloads', async () => {
		const body = sse(['event: meta\ndata: {"model":"x"}\n', 'data: "{\\"open\\":"\ndata: ', '"\\"Hi\\"}"\n\ndata: [DONE]\n']);
		expect(await drainBrainStream(body)).toBe('{"open":"Hi"}');
	});

	it('generateNarration returns the declarative fallback when no baseUrl is set', async () => {
		expect(await generateNarration(task('t-nobase'))).toEqual({ open: 'Opening the page', type: 'Typing the query' });
	});

	it('generateNarration merges model lines over the fallback and trims them', async () => {
		const fetchImpl = async () =>
			new Response(sse(['data: "{\\"open\\":\\"  Loading the coin page  \\"}"\n']), { status: 200 });
		const out = await generateNarration(task('t-merge'), { baseUrl: 'https://x.test', fetchImpl });
		expect(out).toEqual({ open: 'Loading the coin page', type: 'Typing the query' });
	});

	it('generateNarration falls back on a failed brain call and caches per task id', async () => {
		let calls = 0;
		const fetchImpl = async () => {
			calls++;
			return new Response('boom', { status: 503 });
		};
		const t = task('t-fail');
		const a = await generateNarration(t, { baseUrl: 'https://x.test', fetchImpl });
		const b = await generateNarration(t, { baseUrl: 'https://x.test', fetchImpl });
		expect(a).toEqual({ open: 'Opening the page', type: 'Typing the query' });
		expect(b).toBe(a);
		expect(calls).toBe(1);
	});
});

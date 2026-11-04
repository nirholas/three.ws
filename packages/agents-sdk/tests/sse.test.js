import { afterEach, describe, expect, it } from 'vitest';
import { ThreeAgents, parseSse } from '../src/index.ts';
import { startServer } from './_helpers/server.js';

const stream = (chunks) => new ReadableStream({
	start(c) { const enc = new TextEncoder(); for (const x of chunks) c.enqueue(enc.encode(x)); c.close(); },
});
const collect = async (chunks) => { const out = []; for await (const m of parseSse(stream(chunks))) out.push(m); return out; };

describe('parseSse', () => {
	it('parses events, ids and multi-line data', async () => {
		const out = await collect(['id: 1\nevent: step\ndata: a\ndata: b\n\n', 'data: solo\n\n']);
		expect(out).toEqual([
			{ event: 'step', data: 'a\nb', id: '1', retry: null },
			{ event: 'message', data: 'solo', id: '1', retry: null },
		]);
	});
	it('handles a message split across chunks, mid-line and mid-CRLF', async () => {
		const out = await collect(['event: st', 'ep\r', '\ndata: {"a"', ':1}\r\n\r', '\n']);
		expect(out).toEqual([{ event: 'step', data: '{"a":1}', id: null, retry: null }]);
	});
	it('ignores comments and reads retry hints', async () => {
		const out = await collect([': keepalive\nretry: 1500\ndata: x\n\n']);
		expect(out).toEqual([{ event: 'message', data: 'x', id: null, retry: 1500 }]);
	});
	it('flushes a final event with no trailing blank line', async () => {
		expect((await collect(['data: tail'])).map((m) => m.data)).toEqual(['tail']);
	});
});

let srv;
afterEach(async () => { await srv?.close(); srv = null; });

describe('streamRun', () => {
	it('streams GET /runs/:id/events and parses JSON payloads', async () => {
		srv = await startServer((req, res) => {
			res.writeHead(200, { 'content-type': 'text/event-stream' });
			res.write('id: 1\nevent: step\ndata: {"n":1}\n\n');
			res.end('id: 2\nevent: done\ndata: {"ok":true}\n\n');
		});
		const c = new ThreeAgents({ apiKey: 'k', baseUrl: srv.baseUrl, retries: 0 });
		const events = [];
		for await (const ev of c.streamRun('run 1')) events.push(ev);
		expect(events).toEqual([
			{ event: 'step', data: { n: 1 }, id: '1' },
			{ event: 'done', data: { ok: true }, id: '2' },
		]);
		expect(srv.seen[0].path).toBe('/api/v1/runs/run%201/events');
		expect(srv.seen[0].headers.accept).toBe('text/event-stream');
	});

	it('reconnects with Last-Event-ID after the connection drops mid-stream', async () => {
		srv = await startServer((req, res, n) => {
			res.writeHead(200, { 'content-type': 'text/event-stream' });
			if (n === 1) {
				res.write('id: 5\nevent: step\ndata: {"n":5}\n\n');
				setTimeout(() => res.destroy(), 20);
			} else {
				res.end('id: 6\nevent: done\ndata: {"n":6}\n\n');
			}
		});
		const c = new ThreeAgents({ apiKey: 'k', baseUrl: srv.baseUrl, retries: 2, retryDelay: 1 });
		const ids = [];
		for await (const ev of c.streamRun('r1')) ids.push(ev.id);
		expect(ids).toEqual(['5', '6']);
		expect(srv.seen).toHaveLength(2);
		expect(srv.seen[1].headers['last-event-id']).toBe('5');
	});

	it('refuses an empty run id before any request', async () => {
		srv = await startServer(() => {});
		const c = new ThreeAgents({ apiKey: 'k', baseUrl: srv.baseUrl });
		await expect((async () => { for await (const _ of c.streamRun('')) { /* never yields */ } })()).rejects.toMatchObject({ name: 'ValidationError' });
		expect(srv.seen).toHaveLength(0);
	});
});

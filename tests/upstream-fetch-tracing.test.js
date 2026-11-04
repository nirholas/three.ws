// Distributed tracing: traceparent in and out, sampling, and fail-open export.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import express from 'express';
import {
	parseTraceparent,
	formatTraceparent,
	startRootSpan,
	runWithSpan,
	flushSpans,
	pendingSpanCount,
	tracingMiddleware,
	routeName,
	userAgentClass,
	sampleRate,
	_setExporter,
	_resetTracing,
} from '../api/_lib/tracing.js';
import { fetchUpstream } from '../api/_lib/upstream-fetch.js';
import { _resetBreakers } from '../api/_lib/resilience.js';

const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';
const PARENT = '00f067aa0ba902b7';
const sampledHeader = `00-${TRACE}-${PARENT}-01`;
const ok = () => new Response('{}', { status: 200 });

let origFetch;
const origEnv = { ...process.env };
beforeEach(() => {
	origFetch = global.fetch;
	_resetBreakers();
	_resetTracing();
	delete process.env.TRACE_SAMPLE_RATE;
	delete process.env.K_SERVICE;
});
afterEach(() => {
	global.fetch = origFetch;
	process.env = { ...origEnv };
	_resetTracing();
});

describe('traceparent', () => {
	it('parses and formats the W3C header', () => {
		expect(parseTraceparent(sampledHeader)).toEqual({ traceId: TRACE, spanId: PARENT, sampled: true });
		expect(parseTraceparent(`00-${TRACE}-${PARENT}-00`).sampled).toBe(false);
		expect(formatTraceparent({ traceId: TRACE, spanId: PARENT, sampled: true })).toBe(sampledHeader);
	});
	it('rejects malformed and all-zero ids', () => {
		for (const bad of [undefined, '', 'x', `00-${'0'.repeat(32)}-${PARENT}-01`, `00-${TRACE}-${'0'.repeat(16)}-01`, `ff-${TRACE}-${PARENT}-01`]) {
			expect(parseTraceparent(bad)).toBeNull();
		}
	});
});

describe('sampling', () => {
	it('defaults to off outside Cloud Run and 5 percent on it', () => {
		expect(sampleRate()).toBe(0);
		process.env.K_SERVICE = 'three-ws-api';
		expect(sampleRate()).toBe(0.05);
		process.env.TRACE_SAMPLE_RATE = '1';
		expect(sampleRate()).toBe(1);
		process.env.TRACE_SAMPLE_RATE = 'nonsense';
		expect(sampleRate()).toBe(0);
	});
	it('honours an inbound sampled flag even at rate 0, and keeps the trace id', () => {
		const span = startRootSpan('GET /api/x', { traceparent: sampledHeader });
		expect(span.sampled).toBe(true);
		expect(span.traceId).toBe(TRACE);
		expect(span.parentSpanId).toBe(PARENT);
	});
	it('does not record an unsampled inbound request at rate 0', () => {
		const span = startRootSpan('GET /api/x', { traceparent: `00-${TRACE}-${PARENT}-00` });
		expect(span.sampled).toBe(false);
		expect(span.traceId).toBe(TRACE);
	});
	it('a sampled-out request makes no network call and buffers nothing', async () => {
		const exporter = vi.fn();
		_setExporter(exporter);
		global.fetch = vi.fn(async () => ok());
		const root = startRootSpan('GET /api/x');
		await runWithSpan(root, () => fetchUpstream('https://worker.example/infer', {}, { name: 'w' }));
		root.end();
		await flushSpans();
		expect(global.fetch).toHaveBeenCalledTimes(1);
		expect(exporter).not.toHaveBeenCalled();
		expect(pendingSpanCount()).toBe(0);
	});
});

describe('fetchUpstream propagation', () => {
	it('injects a traceparent that points at the upstream client span', async () => {
		const exported = [];
		_setExporter(async (r) => exported.push(r));
		let sent;
		global.fetch = vi.fn(async (_u, init) => {
			sent = init.headers;
			return ok();
		});
		const root = startRootSpan('POST /api/forge', { traceparent: sampledHeader });
		await runWithSpan(root, () => fetchUpstream('https://worker.example/infer?token=s3cret', { method: 'POST', headers: { authorization: 'Bearer x' } }, { name: 'forge:submit' }));
		root.end();
		await flushSpans();
		const tp = parseTraceparent(sent.traceparent);
		expect(tp.traceId).toBe(TRACE);
		expect(tp.sampled).toBe(true);
		expect(sent.authorization).toBe('Bearer x');
		const spans = exported[0].scopeSpans[0].spans;
		const client = spans.find((s) => s.name === 'upstream forge:submit');
		const server = spans.find((s) => s.name === 'POST /api/forge');
		expect(client.spanId).toBe(tp.spanId);
		expect(client.parentSpanId).toBe(server.spanId);
		expect(server.parentSpanId).toBe(PARENT);
		expect(JSON.stringify(spans)).not.toContain('s3cret');
	});
	it('merges into Headers instances and arrays without losing existing headers', async () => {
		const seen = [];
		global.fetch = vi.fn(async (_u, init) => {
			seen.push(init.headers);
			return ok();
		});
		const root = startRootSpan('GET /api/x', { traceparent: sampledHeader });
		await runWithSpan(root, async () => {
			await fetchUpstream('https://a.example/', { headers: new Headers({ 'x-a': '1' }) });
			await fetchUpstream('https://a.example/', { headers: [['x-b', '2']] });
		});
		expect(seen[0].get('x-a')).toBe('1');
		expect(seen[0].get('traceparent')).toMatch(/^00-/);
		expect(seen[1]).toContainEqual(['x-b', '2']);
		expect(seen[1].some(([k]) => k === 'traceparent')).toBe(true);
	});
	it('does not touch headers when there is no active span', async () => {
		let sent;
		global.fetch = vi.fn(async (_u, init) => {
			sent = init.headers;
			return ok();
		});
		await fetchUpstream('https://a.example/', { headers: { 'x-a': '1' } });
		expect(sent).toEqual({ 'x-a': '1' });
	});
	it('records a failing upstream as an error span and rethrows the original failure', async () => {
		const exported = [];
		_setExporter(async (r) => exported.push(r));
		global.fetch = vi.fn(async () => new Response('nope', { status: 404 }));
		const root = startRootSpan('GET /api/x', { traceparent: sampledHeader });
		await expect(runWithSpan(root, () => fetchUpstream('https://a.example/', {}, { name: 'dead', attempts: 1 }))).rejects.toMatchObject({ status: 404 });
		root.end();
		await flushSpans();
		const client = exported[0].scopeSpans[0].spans.find((s) => s.name === 'upstream dead');
		expect(client.status.code).toBe(2);
	});
});

describe('export failure', () => {
	it('never fails the call or the flush', async () => {
		_setExporter(async () => {
			throw new Error('trace backend down');
		});
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		global.fetch = vi.fn(async () => ok());
		const root = startRootSpan('GET /api/x', { traceparent: sampledHeader });
		const res = await runWithSpan(root, () => fetchUpstream('https://a.example/'));
		root.end();
		expect(res.status).toBe(200);
		await expect(flushSpans()).resolves.toBeUndefined();
		expect(warn).toHaveBeenCalledOnce();
		warn.mockRestore();
	});
});

describe('express middleware', () => {
	async function serve(handler) {
		const app = express();
		app.use(tracingMiddleware());
		app.get('/api/forge/:id', handler);
		app.get('/page', (_req, res) => res.send('ok'));
		const server = http.createServer(app);
		await new Promise((r) => server.listen(0, '127.0.0.1', r));
		return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
	}

	it('a request carrying a traceparent yields a span with the same trace id and route', async () => {
		const exported = [];
		_setExporter(async (r) => exported.push(r));
		const s = await serve((req, res) => res.status(202).json({ ok: true }));
		const res = await fetch(`${s.base}/api/forge/9f2c0a1b-1111-2222-3333-444455556666`, { headers: { traceparent: sampledHeader, 'user-agent': 'curl/8' } });
		expect(res.status).toBe(202);
		await new Promise((r) => setTimeout(r, 20));
		await flushSpans();
		await s.close();
		const span = exported[0].scopeSpans[0].spans[0];
		expect(span.traceId).toBe(TRACE);
		expect(span.parentSpanId).toBe(PARENT);
		expect(span.name).toBe('GET /api/forge/:id');
		const attrs = Object.fromEntries(span.attributes.map((a) => [a.key, Object.values(a.value)[0]]));
		expect(attrs['http.response.status_code']).toBe('202');
		expect(attrs['user_agent.class']).toBe('cli');
	});

	it('propagates the active span into the handler so outbound calls join the trace', async () => {
		let outbound;
		global.fetch = vi.fn(async (url, init) => {
			if (String(url).startsWith('http://127.0.0.1')) return origFetch(url, init);
			outbound = init.headers;
			return ok();
		});
		_setExporter(async () => {});
		const s = await serve(async (_req, res) => {
			await fetchUpstream('https://worker.example/infer');
			res.json({});
		});
		await origFetch(`${s.base}/api/forge/abc`, { headers: { traceparent: sampledHeader } });
		await s.close();
		expect(parseTraceparent(outbound.traceparent).traceId).toBe(TRACE);
	});

	it('ignores non-API paths', async () => {
		_setExporter(async () => {});
		const s = await serve((_req, res) => res.end());
		await fetch(`${s.base}/page`, { headers: { traceparent: sampledHeader } });
		await s.close();
		expect(pendingSpanCount()).toBe(0);
	});
});

describe('helpers', () => {
	it('groups ids in route names and classes user agents coarsely', () => {
		expect(routeName('/api/forge/9f2c0a1b-1111-2222-3333-444455556666')).toBe('/api/forge/:id');
		expect(routeName('/api/chat')).toBe('/api/chat');
		expect(userAgentClass('Mozilla/5.0 Chrome')).toBe('browser');
		expect(userAgentClass('Googlebot/2.1')).toBe('bot');
		expect(userAgentClass('')).toBe('none');
	});
});

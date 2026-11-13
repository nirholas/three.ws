// Studio self-calls to /api/gpt-forge must join the caller's trace.
//
// Production regression 2026-11-13: a forced-sampled forge_free request through
// /api/mcp-studio produced a trace holding only the studio root span. startForge,
// startRig, pollJob and pollOnce called /api/gpt-forge with a bare fetch, so no
// traceparent crossed that hop and the forge request (and every worker span under
// it) landed in a separate, independently sampled trace.

import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { startForge, startRig, pollJob, pollOnce } from '../api/_mcp-studio/gpt-forge-client.js';
import { startRootSpan, runWithSpan, parseTraceparent, flushSpans, _setExporter, _resetTracing } from '../api/_lib/tracing.js';

const BASE = 'https://three.ws';
const TRACE = '4bf92f3577b34da6a3ce929d0e0e4736';
const sampled = `00-${TRACE}-00f067aa0ba902b7-01`;
const GLB = 'https://three.ws/cdn/creations/synthetic/mesh.glb';

function respond(body, status = 200) {
	return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

let seen;
let exported;
beforeEach(() => {
	_resetTracing();
	seen = [];
	exported = [];
	_setExporter(async (rs) => exported.push(...rs.scopeSpans[0].spans));
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url, init = {}) => {
			seen.push({ url: String(url), traceparent: new Headers(init.headers).get('traceparent') });
			if (String(url).includes('job=')) return respond({ status: 'done', glb_url: GLB });
			return respond({ status: 'queued', job_id: 'job-1' }, 202);
		}),
	);
});
afterEach(() => {
	vi.unstubAllGlobals();
	_resetTracing();
});

describe('studio forge client trace propagation', () => {
	it('sends a traceparent in the caller trace on submit, rig and both poll paths', async () => {
		const root = startRootSpan('POST /api/mcp-studio', { traceparent: sampled });
		await runWithSpan(root, async () => {
			await startForge(BASE, { prompt: 'a small brass desk lamp', path: 'image', tier: 'standard' });
			await startRig(BASE, GLB);
			await pollJob(BASE, 'job-1', { timeoutMs: 5_000, intervalMs: 10 });
			await pollOnce(BASE, 'job-1');
		});
		root.end();
		expect(seen.length).toBeGreaterThanOrEqual(4);
		for (const call of seen) {
			const ctx = parseTraceparent(call.traceparent);
			expect(ctx, call.url).not.toBeNull();
			expect(ctx.traceId).toBe(TRACE);
			expect(ctx.sampled).toBe(true);
		}
		await flushSpans();
		const clients = exported.filter((s) => s.name.startsWith('studio gpt-forge'));
		expect(clients.map((s) => s.name)).toEqual(expect.arrayContaining(['studio gpt-forge submit', 'studio gpt-forge rig', 'studio gpt-forge poll']));
		for (const s of clients) expect(s.parentSpanId).toBe(root.spanId);
	});

	it('adds no traceparent when no request span is active', async () => {
		await startForge(BASE, { prompt: 'a small brass desk lamp', path: 'image', tier: 'standard' });
		expect(seen[0].traceparent).toBeNull();
	});
});

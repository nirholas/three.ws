// Classification contract for the production triage monitor. Every signature
// added to KNOWN_SIGNATURES should get a case here: the monitor learning a
// benign pattern must never silently swallow a genuine fault that shares text.
import { describe, expect, it } from 'vitest';
import { buildFindings, classify, logCoverage, summarizePageCheckFailure } from '../scripts/gcp-triage.mjs';

describe('gcp-triage classify', () => {
	it('classifies the Colyseus stale-seat refusal as self-healing', () => {
		const sig = classify(
			'Error: seat reservation expired.\n    at WebSocketServer.onConnection (file:///app/node_modules/@colyseus/ws-transport/build/WebSocketTransport.mjs:79:15)',
			['three-ws-multiplayer'],
		);
		expect(sig?.id).toBe('colyseus-seat-expired');
		expect(sig?.class).toBe('self-healing');
	});

	it('classifies the SRH abort only on three-ws-redis-proxy', () => {
		const line = 'Uncaught signal: 10, pid=54, tid=54, fault_addr=0.';
		const onProxy = classify(line, ['three-ws-redis-proxy']);
		expect(onProxy?.id).toBe('redis-proxy-srh-crash');
		expect(onProxy?.class).toBe('self-healing');
	});

	it('leaves the same signal line from any other service unclassified', () => {
		const line = 'Uncaught signal: 10, pid=54, tid=54, fault_addr=0.';
		expect(classify(line, ['three-ws-api'])).toBeNull();
		expect(classify(line, [])).toBeNull();
		expect(classify(line)).toBeNull();
	});

	it('still matches service-unscoped signatures without a services argument', () => {
		const sig = classify('db at storage cap (3072MB >= 3072MB)');
		expect(sig?.id).toBe('db-storage-cap');
	});

	it('classifies the cryptocurrency-cv AI chain exhaustion as owner-gated only on that service', () => {
		const line = 'AI provider groq unavailable (AIRateLimitError), trying next provider... rate-limited / out of quota (429)';
		const onCcv = classify(line, ['cryptocurrency-cv']);
		expect(onCcv?.id).toBe('ccv-ai-providers-unavailable');
		expect(onCcv?.class).toBe('owner');
		expect(classify(line, ['three-ws-api'])?.id).not.toBe('ccv-ai-providers-unavailable');
	});

	it('classifies a truncated body as the SSE stream timeout only on cryptocurrency-cv', () => {
		const line = 'Truncated response body. Usually implies that the request timed out or the application exited before the response was finished.';
		const onCcv = classify(line, ['cryptocurrency-cv']);
		expect(onCcv?.id).toBe('ccv-sse-stream-timeout');
		expect(onCcv?.class).toBe('self-healing');
		expect(classify(line, ['three-ws-api'])).toBeNull();
		expect(classify(line, [])).toBeNull();
	});

	it('classifies a truncated body as the MCP stream timeout only on clink-fun', () => {
		const line = 'Truncated response body. Usually implies that the request timed out or the application exited before the response was finished.';
		const onClink = classify(line, ['clink-fun']);
		expect(onClink?.id).toBe('clink-mcp-stream-timeout');
		expect(onClink?.class).toBe('self-healing');
		expect(classify(line, ['three-ws-api'])).toBeNull();
		expect(classify(line, [])).toBeNull();
	});

	it('classifies a bare SIGKILL as the trellis OOM only on model-trellis', () => {
		const line = 'Container terminated on signal 9.';
		const onTrellis = classify(line, ['model-trellis']);
		expect(onTrellis?.id).toBe('gpu-worker-sigkill');
		expect(onTrellis?.class).toBe('investigate');
		expect(classify(line, ['three-ws-api'])).toBeNull();
		expect(classify(line, ['model-hunyuan3d-21-rtx'])).toBeNull();
	});

	it('returns null for an unknown message', () => {
		expect(classify('some brand new failure nobody has seen', ['three-ws-api'])).toBeNull();
	});
});

describe('gcp-triage HTTP classification', () => {
	const request = ({ service = 'three-ws-api', status, path }) => ({
		resource: { labels: { service_name: service } },
		timestamp: '2026-09-15T00:00:00Z',
		httpRequest: {
			status,
			requestMethod: status === 503 ? 'POST' : 'GET',
			requestUrl: `https://three.ws${path}`,
			userAgent: 'browser',
		},
	});

	it('classifies Forge upload storage rejection as owner-gated', () => {
		const [finding] = buildFindings([request({ status: 503, path: '/api/forge-upload' })]);
		expect(finding.signature).toBe('r2-upload-unavailable');
		expect(finding.class).toBe('owner');
	});

	it('classifies a cryptocurrency-cv AI route 503 as owner-gated', () => {
		const [finding] = buildFindings([request({ service: 'cryptocurrency-cv', status: 503, path: '/api/narratives' })]);
		expect(finding.signature).toBe('ccv-ai-providers-unavailable-503');
		expect(finding.class).toBe('owner');
	});

	it('leaves a cryptocurrency-cv 503 on a non-AI route for investigation', () => {
		const [finding] = buildFindings([request({ service: 'cryptocurrency-cv', status: 503, path: '/api/news' })]);
		expect(finding.signature).not.toBe('ccv-ai-providers-unavailable-503');
		expect(finding.class).toBe('investigate');
	});

	it('classifies pump curve fallback exhaustion as self-healing', () => {
		const [finding] = buildFindings([request({ status: 502, path: '/api/pump/curve' })]);
		expect(finding.signature).toBe('pump-curve-rpc-unavailable');
		expect(finding.class).toBe('self-healing');
	});

	it('classifies an exhausted price-history candle chain as env-action', () => {
		const [finding] = buildFindings([request({ status: 502, path: '/api/pump/price-history' })]);
		expect(finding.signature).toBe('pump-price-history-upstreams-502');
		expect(finding.class).toBe('env-action');
	});

	it('classifies a holder-distribution RPC exhaustion 503 as self-healing', () => {
		const [finding] = buildFindings([request({ status: 503, path: '/api/crypto/holders' })]);
		expect(finding.signature).toBe('holders-rpc-exhausted-503');
		expect(finding.class).toBe('self-healing');
	});

	// 2026-10-12 triage-lane sweep: confirmed live against production that
	// /api/render/animate?avatar=<id> and GET /api/animations/clips/<id> both
	// 502 with the exact same root cause as the rest of the r2-downstream-5xx
	// family (curl of the avatar's own pub-*.r2.dev model_url returned 403,
	// matching healthz object_storage "down"). Both routes fetch an R2-hosted
	// GLB outside api/_lib/r2.js (fetchModel / getObjectBuffer), so neither
	// matched the existing path list and both fell through to `investigate`
	// every sweep even though nothing in the handler is broken.
	it('classifies an animated-render R2 fetch failure as the r2-downstream family', () => {
		const [finding] = buildFindings([request({ status: 502, path: '/api/render/animate' })]);
		expect(finding.signature).toBe('r2-downstream-5xx');
		expect(finding.class).toBe('owner');
	});

	it('classifies a clip-detail R2 fetch failure as the r2-downstream family', () => {
		const [finding] = buildFindings([
			request({ status: 502, path: '/api/animations/clips/345b05d0-f81e-4f6c-9df8-c3f73572716c' }),
		]);
		expect(finding.signature).toBe('r2-downstream-5xx');
		expect(finding.class).toBe('owner');
	});

	// 2026-10-15 deep sweep: remesh-service logged this exact traceback for a
	// mesh fetch hitting the R2 .r2.dev public-domain 403 (the same row-36
	// outage the HTTP-level r2-downstream-5xx family already tracks), but the
	// Python traceback's call-stack frames push the one line that actually
	// names the fault (httpx.HTTPStatusError ... 403 Forbidden ... r2.dev) past
	// byte 400, which is where buildFindings used to cut the classification
	// sample. The finding fell through to `investigate` every sweep even
	// though nothing in the worker is broken.
	const remeshR2Traceback = () => ({
		resource: { labels: { service_name: 'remesh-service' } },
		timestamp: '2026-10-15T00:00:05Z',
		severity: 'ERROR',
		textPayload: [
			'Traceback (most recent call last):',
			'  File "/app/main.py", line 741, in _process',
			'    artifacts, meta = await loop.run_in_executor(',
			'                      ^^^^^^^^^^^^^^^^^^^^^^^^^^^',
			'  File "/usr/local/lib/python3.11/concurrent/futures/thread.py", line 58, in run',
			'    result = self.fn(*self.args, **self.kwargs)',
			'             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^',
			'  File "/app/main.py", line 701, in _run_processing',
			'    data, suffix = _fetch_mesh(mesh_url)',
			'                   ^^^^^^^^^^^^^^^^^^^^^',
			'  File "/app/main.py", line 142, in _fetch_mesh',
			'    data = fetch_remote_bytes(url, timeout=60, max_bytes=MAX_MESH_BYTES)',
			'           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^',
			'  File "/app/worker_security.py", line 154, in fetch_remote_bytes',
			'    resp.raise_for_status()',
			'  File "/usr/local/lib/python3.11/site-packages/httpx/_models.py", line 763, in raise_for_status',
			'    raise HTTPStatusError(message, request=request, response=self)',
			"httpx.HTTPStatusError: Client error '403 Forbidden' for url 'https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/forge/2152b20cad96/fd0a25bf-ecfe-491a-9541-e805a7dc0cb3.glb'",
		].join('\n'),
	});

	it('classifies a GPU worker R2 .r2.dev 403 traceback as the r2-downstream family', () => {
		const [finding] = buildFindings([remeshR2Traceback()]);
		expect(finding.signature).toBe('r2-downstream-5xx');
		expect(finding.class).toBe('owner');
	});
});

describe('gcp-triage page failure summary', () => {
	it('reports actual failures instead of the declared page total', () => {
		const summary = summarizePageCheckFailure(`
[check-pages] sweeping 822 declared pages against https://three.ws
[check-pages] 50/822…
[check-pages] 1 unreachable page(s) on https://three.ws:
[check-pages]   404  /contributors
[check-pages] The running revision is behind this checkout.
`);
		expect(summary.count).toBe(1);
		expect(summary.sample).toContain('/contributors');
		expect(summary.sample).not.toContain('50/822');
	});
});

describe('logCoverage', () => {
	const now = Date.parse('2026-10-10T12:00:00Z');
	const at = (iso) => ({ timestamp: iso });

	it('reports full coverage when the read stopped short of the limit', () => {
		const cov = logCoverage([at('2026-10-10T11:58:00Z')], { since: '6h', limit: 1000, now });
		expect(cov.truncated).toBe(false);
		expect(cov.coveredFraction).toBe(1);
	});

	it('flags a read that hit the limit and measures how far back it reached', () => {
		const entries = [at('2026-10-10T11:59:00Z'), at('2026-10-10T11:56:00Z')];
		const cov = logCoverage(entries, { since: '6h', limit: 2, now });
		expect(cov.truncated).toBe(true);
		expect(cov.coveredMs).toBe(4 * 60_000);
		expect(cov.coveredFraction).toBeCloseTo(4 / 360, 3);
		expect(cov.oldest).toBe('2026-10-10T11:56:00.000Z');
	});

	it('never claims more than the requested window', () => {
		const cov = logCoverage([at('2026-10-09T00:00:00Z')], { since: '1h', limit: 1, now });
		expect(cov.coveredMs).toBe(3_600_000);
	});
});

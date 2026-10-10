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

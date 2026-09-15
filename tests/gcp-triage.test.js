// Classification contract for the production triage monitor. Every signature
// added to KNOWN_SIGNATURES should get a case here: the monitor learning a
// benign pattern must never silently swallow a genuine fault that shares text.
import { describe, expect, it } from 'vitest';
import { buildFindings, classify, summarizePageCheckFailure } from '../scripts/gcp-triage.mjs';

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

	it('classifies pump curve fallback exhaustion as self-healing', () => {
		const [finding] = buildFindings([request({ status: 502, path: '/api/pump/curve' })]);
		expect(finding.signature).toBe('pump-curve-rpc-unavailable');
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

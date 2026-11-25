// The Solana aggregator endpoints must reject a malformed address or signature
// themselves, with a 400, before spending an RPC call on it.
//
// Measured 2026-11-25 in production: GET /api/v1/x/solana/largest-holders?mint=test
// waited about 7s and answered 502 internal_error with an "[api] unhandled" log
// line, an ops alert and a Sentry event. The bad mint went upstream, an RPC
// lane answered -32603 "Internal error" instead of -32602, and rpcResult mapped
// that to a 502. A caller typo looked like a platform outage.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { executeUpstream, resetUpstreamHealth } from '../api/_lib/aggregator.js';
import { PROVIDERS } from '../api/v1/_providers.js';

const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const SIGNATURE = '5'.repeat(88);

afterEach(() => {
	vi.unstubAllGlobals();
	resetUpstreamHealth();
});

const solana = PROVIDERS.find((p) => p.id === 'solana');
const endpointOf = (id) => solana.endpoints.find((e) => e.id === id);

async function run(endpointId, query) {
	return executeUpstream({ provider: solana, endpoint: endpointOf(endpointId), query, apiKey: null });
}

const cases = [
	['largest-holders', 'mint'],
	['token-supply', 'mint'],
	['balance', 'address'],
	['account', 'address'],
	['token-holdings', 'owner'],
	['transaction', 'signature'],
];

describe('solana aggregator param validation', () => {
	it.each(cases)('%s rejects a malformed %s with a 400 and never calls upstream', async (id, param) => {
		const spy = vi.fn();
		vi.stubGlobal('fetch', spy);
		const err = await run(id, { [param]: 'test' }).catch((e) => e);
		expect(err).toBeInstanceOf(Error);
		expect(err.status).toBe(400);
		expect(err.code).toBe('invalid_param');
		expect(err.message).toContain(param);
		expect(spy).not.toHaveBeenCalled();
	});

	it('still forwards a valid mint upstream', async () => {
		const spy = vi.fn(async () =>
			new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { value: [] } }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			}),
		);
		vi.stubGlobal('fetch', spy);
		await run('largest-holders', { mint: THREE_MINT }).catch(() => {});
		expect(spy).toHaveBeenCalled();
		const [, init] = spy.mock.calls[0];
		expect(JSON.parse(init.body).params[0]).toBe(THREE_MINT);
	});

	it('still forwards a valid signature upstream', async () => {
		const spy = vi.fn(async () =>
			new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: null }), {
				status: 200,
				headers: { 'content-type': 'application/json' },
			}),
		);
		vi.stubGlobal('fetch', spy);
		await run('transaction', { signature: SIGNATURE }).catch(() => {});
		expect(spy).toHaveBeenCalled();
	});

	it('keeps missing_param for an absent value, so discovery probes still get their 402', async () => {
		vi.stubGlobal('fetch', vi.fn());
		const err = await run('largest-holders', {}).catch((e) => e);
		expect(err.code).toBe('missing_param');
	});
});

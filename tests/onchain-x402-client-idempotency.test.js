// x402Fetch carries one Idempotency-Key per logical call so a paid call whose
// response was lost can be collected again (server replay) instead of being
// charged or executed twice. fetch and the payments adapter are the only
// boundaries stubbed; the client logic under test is the real module.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const payAgent = vi.fn();
vi.mock('../src/onchain/payments/index.js', () => ({
	getPaymentsAdapter: () => ({ payAgent }),
}));

const { x402Fetch } = await import('../src/onchain/x402/client.js');

const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const AGENT_ID = 'agent-1';
const INVOKE_URL = '/api/agents/x402/invoke';

const manifest = {
	version: 'x402/0.1',
	kind: 'agent-skill',
	agent_id: AGENT_ID,
	skill: 'echo',
	amount: '1000',
	currency: THREE_MINT,
	recipient: 'THREEsynthetic1111111111111111111111111111',
	valid_until: Date.now() + 60_000,
	intent_url: '/api/agents/x402/intent',
	verify_url: '/api/agents/x402/verify',
	retry_with_header: 'x-payment-intent',
	idempotency: { header: 'Idempotency-Key', ttl_seconds: 86400, replay_field: 'replayed' },
};

function jsonResponse(status, body, headers = {}) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json', ...headers },
	});
}

const agentSnippet = () =>
	jsonResponse(200, { agent: { id: AGENT_ID, payments: { cluster: 'mainnet', mint: THREE_MINT } } });

/** Records every invoke request and answers from a scripted queue. */
function scriptFetch(invokeAnswers) {
	const invokes = [];
	const fetchMock = vi.fn(async (url, init = {}) => {
		if (String(url).startsWith(`/api/agents/${AGENT_ID}`)) return agentSnippet();
		const headers = new Headers(init.headers);
		invokes.push({
			key: headers.get('idempotency-key'),
			intent: headers.get('x-payment-intent'),
		});
		const next = invokeAnswers.shift();
		if (!next) throw new Error(`unexpected invoke #${invokes.length}`);
		return next();
	});
	vi.stubGlobal('fetch', fetchMock);
	return invokes;
}

const callOpts = (extra = {}) => ({
	method: 'POST',
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify({ agent_id: AGENT_ID, skill: 'echo', args: { hi: 1 } }),
	...extra,
});

beforeEach(() => {
	payAgent.mockReset();
	payAgent.mockResolvedValue({ intentId: 'intent-1' });
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

describe('x402Fetch idempotency', () => {
	it('sends one Idempotency-Key on the unpaid request and reuses it on the paid retry', async () => {
		const invokes = scriptFetch([
			() => jsonResponse(402, manifest),
			() => jsonResponse(200, { ok: true, replayed: false, result: { hi: 1 } }),
		]);

		const res = await x402Fetch(INVOKE_URL, callOpts());

		expect(res.status).toBe(200);
		expect(invokes).toHaveLength(2);
		expect(invokes[0].key).toMatch(/^[0-9a-f-]{32,36}$/);
		expect(invokes[1].key).toBe(invokes[0].key);
		expect(invokes[0].intent).toBeNull();
		expect(invokes[1].intent).toBe('intent-1');
		expect(payAgent).toHaveBeenCalledTimes(1);
	});

	it('keeps a caller-supplied Idempotency-Key', async () => {
		const invokes = scriptFetch([
			() => jsonResponse(402, manifest),
			() => jsonResponse(200, { ok: true, replayed: false }),
		]);

		await x402Fetch(
			INVOKE_URL,
			callOpts({ headers: { 'content-type': 'application/json', 'Idempotency-Key': 'order-42' } }),
		);

		expect(invokes.map((i) => i.key)).toEqual(['order-42', 'order-42']);
	});

	it('gives separate logical calls separate keys', async () => {
		const invokes = scriptFetch([
			() => jsonResponse(200, { ok: true }),
			() => jsonResponse(200, { ok: true }),
		]);

		await x402Fetch(INVOKE_URL, callOpts());
		await x402Fetch(INVOKE_URL, callOpts());

		expect(invokes[0].key).not.toBe(invokes[1].key);
	});

	it('retries once with the same key when the paid response is lost, and collects the replay', async () => {
		const invokes = scriptFetch([
			() => jsonResponse(402, manifest),
			() => {
				throw new TypeError('Failed to fetch');
			},
			() => jsonResponse(200, { ok: true, replayed: true, result: { hi: 1 } }, { 'idempotent-replayed': 'true' }),
		]);
		const steps = [];

		const res = await x402Fetch(INVOKE_URL, callOpts({ onProgress: (s) => steps.push(s) }));

		expect(res.status).toBe(200);
		expect((await res.json()).replayed).toBe(true);
		expect(invokes).toHaveLength(3);
		expect(new Set(invokes.map((i) => i.key)).size).toBe(1);
		expect(invokes[2].intent).toBe('intent-1');
		expect(payAgent).toHaveBeenCalledTimes(1);
		expect(steps.filter((s) => s === 'retrying')).toHaveLength(2);
	});

	it('surfaces the network error when the post-payment retry also fails', async () => {
		scriptFetch([
			() => jsonResponse(402, manifest),
			() => {
				throw new TypeError('Failed to fetch');
			},
			() => {
				throw new TypeError('Failed to fetch again');
			},
		]);

		await expect(x402Fetch(INVOKE_URL, callOpts())).rejects.toThrow('Failed to fetch again');
		expect(payAgent).toHaveBeenCalledTimes(1);
	});

	it('does not retry a network error before any payment was made', async () => {
		const invokes = scriptFetch([
			() => {
				throw new TypeError('offline');
			},
		]);

		await expect(x402Fetch(INVOKE_URL, callOpts())).rejects.toThrow('offline');
		expect(invokes).toHaveLength(1);
		expect(payAgent).not.toHaveBeenCalled();
	});

	it('waits out idempotency_in_progress after payment and retries with the same key', async () => {
		vi.useFakeTimers();
		const invokes = scriptFetch([
			() => jsonResponse(402, manifest),
			() => jsonResponse(409, { error: 'idempotency_in_progress', retry: true }, { 'retry-after': '2' }),
			() => jsonResponse(200, { ok: true, replayed: true }),
		]);

		const pending = x402Fetch(INVOKE_URL, callOpts());
		await vi.advanceTimersByTimeAsync(2000);
		const res = await pending;

		expect(res.status).toBe(200);
		expect(invokes).toHaveLength(3);
		expect(new Set(invokes.map((i) => i.key)).size).toBe(1);
		expect(payAgent).toHaveBeenCalledTimes(1);
	});

	it('hands back a 409 that is not idempotency_in_progress without waiting', async () => {
		const invokes = scriptFetch([
			() => jsonResponse(402, manifest),
			() => jsonResponse(409, { error: 'idempotency_conflict' }),
		]);

		const res = await x402Fetch(INVOKE_URL, callOpts());

		expect(res.status).toBe(409);
		expect((await res.json()).error).toBe('idempotency_conflict');
		expect(invokes).toHaveLength(2);
	});
});

/**
 * x402 client — fetch wrapper that follows 402 Payment Required automatically.
 *
 * Usage:
 *   import { x402Fetch } from 'src/onchain/x402/client.js';
 *
 *   const res = await x402Fetch('/api/agents/x402/invoke', {
 *     method: 'POST',
 *     headers: { 'content-type': 'application/json' },
 *     body: JSON.stringify({ agent_id, skill: 'echo', args: { hi: 1 } }),
 *     onPaymentRequired: async (manifest) => 'auto', // or 'reject'
 *     onProgress: (step) => console.log(step),
 *   });
 *
 * Flow:
 *   1. Make the request.
 *   2. If 402: parse manifest, hand it to onPaymentRequired (caller can
 *      reject — useful for showing a confirmation modal). On 'auto', use the
 *      Pump.fun payments adapter to pay, then retry once with
 *      `x-payment-intent`.
 *   3. Return the final response (whatever it is — 200, 4xx, etc.).
 */

import { getPaymentsAdapter } from '../payments/index.js';

/** @typedef {{ version: string, kind: string, agent_id: string, skill: string, amount: string, currency: string, recipient: string, valid_until: number, intent_url: string, verify_url: string, retry_with_header: string }} X402Manifest */

const MAX_RETRIES = 1;

/**
 * @param {string|URL} url
 * @param {RequestInit & {
 *   onPaymentRequired?: (manifest: X402Manifest) => Promise<'auto'|'reject'> | 'auto' | 'reject',
 *   onProgress?: (step: string) => void,
 *   provider?: 'pumpfun',
 * }} [opts]
 * @returns {Promise<Response>}
 */
export async function x402Fetch(url, opts = {}) {
	const {
		onPaymentRequired = () => 'auto',
		onProgress = () => {},
		provider = 'pumpfun',
		...fetchOpts
	} = opts;

	let attempt = 0;
	let intentId = null;

	while (true) {
		const headers = new Headers(fetchOpts.headers || {});
		if (intentId) headers.set('x-payment-intent', intentId);
		const response = await fetch(url, {
			...fetchOpts,
			credentials: fetchOpts.credentials || 'include',
			headers,
		});

		if (response.status !== 402) return response;
		if (attempt >= MAX_RETRIES) return response; // gave up after one paid retry

		// Parse 402 manifest. Spec says it's JSON; refuse anything else.
		const ct = response.headers.get('content-type') || '';
		if (!ct.includes('json')) return response;
		const manifest = await response.json();
		if (manifest?.version !== 'x402/0.1' || manifest?.kind !== 'agent-skill') {
			return response;
		}

		const decision = await onPaymentRequired(manifest);
		if (decision !== 'auto') return response;

		// Pay via the configured adapter. Skill is bound into the intent
		// payload so the server can verify the intent matches the call.
		onProgress('paying');
		const adapter = getPaymentsAdapter(provider);
		const paid = await adapter.payAgent({
			agent: {
				id: manifest.agent_id,
				// payAgent() reads agent.payments to discover cluster + mint.
				// In x402, the manifest carries the cluster implicitly via the
				// currency mint; we can read it server-side, but the adapter
				// also needs the mint+cluster from the agent. We fetch a
				// minimal agent record to satisfy that.
				...(await fetchAgentSnippet(manifest.agent_id)),
			},
			currencyMint: manifest.currency,
			amount: manifest.amount,
			memo: manifest.memo,
			onProgress: (s) => onProgress(`paying:${s}`),
		});

		intentId = paid.intentId;
		attempt += 1;
		onProgress('retrying');
	}
}

async function fetchAgentSnippet(agentId) {
	try {
		const r = await fetch(`/api/agents/${encodeURIComponent(agentId)}`, {
			credentials: 'include',
		});
		if (!r.ok) return {};
		const data = await r.json();
		return {
			payments: data?.agent?.payments || data?.payments,
			meta: { payments: data?.agent?.payments || data?.payments },
		};
	} catch {
		return {};
	}
}

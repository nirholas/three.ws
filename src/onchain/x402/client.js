/**
 * x402 client: fetch wrapper that follows 402 Payment Required automatically.
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
 *      reject, useful for showing a confirmation modal). On 'auto', use the
 *      Pump.fun payments adapter to pay, then retry once with
 *      `x-payment-intent`.
 *   3. Return the final response (whatever it is: 200, 4xx, etc.).
 *
 * Idempotency: every logical call carries one `Idempotency-Key` (a caller
 * supplied one is kept, otherwise a fresh UUID). The same key rides the paid
 * retry, so if the server ran the skill but the response was lost, asking
 * again replays the stored result (`replayed: true`) instead of charging or
 * executing twice. A network error after payment is retried once with that
 * same key before the error is surfaced.
 */

import { getPaymentsAdapter } from '../payments/index.js';

/** @typedef {{ version: string, kind: string, agent_id: string, skill: string, amount: string, currency: string, recipient: string, valid_until: number, intent_url: string, verify_url: string, retry_with_header: string, idempotency?: { header: string, ttl_seconds: number, replay_field: string } }} X402Manifest */

const MAX_RETRIES = 1;
const MAX_NETWORK_RETRIES_AFTER_PAYMENT = 1;
// A retry can land while the first paid execution is still running; the
// server answers 409 idempotency_in_progress with a retry-after. Wait it out a
// bounded number of times, then hand the 409 back to the caller.
const MAX_IN_PROGRESS_WAITS = 3;
const MAX_IN_PROGRESS_WAIT_MS = 5000;

async function inProgressDelayMs(response) {
	if (response.status !== 409) return null;
	const ct = response.headers.get('content-type') || '';
	if (!ct.includes('json')) return null;
	const body = await response.clone().json().catch(() => null);
	if (body?.error !== 'idempotency_in_progress') return null;
	const seconds = Number(response.headers.get('retry-after'));
	const ms = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 1000;
	return Math.min(ms, MAX_IN_PROGRESS_WAIT_MS);
}

function newIdempotencyKey() {
	if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
	const bytes = new Uint8Array(16);
	globalThis.crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

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
	let networkRetries = 0;
	let inProgressWaits = 0;
	const idempotencyKey =
		new Headers(fetchOpts.headers || {}).get('idempotency-key') || newIdempotencyKey();

	while (true) {
		const headers = new Headers(fetchOpts.headers || {});
		headers.set('idempotency-key', idempotencyKey);
		if (intentId) headers.set('x-payment-intent', intentId);
		let response;
		try {
			response = await fetch(url, {
				...fetchOpts,
				credentials: fetchOpts.credentials || 'include',
				headers,
			});
		} catch (err) {
			// Once paid, a dropped connection must not strand the payment: the
			// server keys the call on idempotencyKey, so asking again either
			// replays the delivered result or runs the call that never landed.
			if (intentId && networkRetries < MAX_NETWORK_RETRIES_AFTER_PAYMENT) {
				networkRetries += 1;
				onProgress('retrying');
				continue;
			}
			throw err;
		}

		if (intentId && inProgressWaits < MAX_IN_PROGRESS_WAITS) {
			const waitMs = await inProgressDelayMs(response);
			if (waitMs != null) {
				inProgressWaits += 1;
				onProgress('waiting');
				await new Promise((resolve) => setTimeout(resolve, waitMs));
				continue;
			}
		}

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
	const r = await fetch(`/api/agents/${encodeURIComponent(agentId)}`, {
		credentials: 'include',
	});
	if (!r.ok) {
		throw new Error(
			`x402: failed to load agent ${agentId} (status ${r.status}); cannot route payment without payments config`,
		);
	}
	const data = await r.json();
	const payments = data?.agent?.payments || data?.payments;
	if (!payments) {
		throw new Error(
			`x402: agent ${agentId} has no payments config; cannot route payment`,
		);
	}
	return {
		payments,
		meta: { payments },
	};
}

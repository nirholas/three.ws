/**
 * Agent Economy hub — client for the wallet hub Earn tab.
 *
 * Thin, never-throwing fetch layer over the real endpoints — no mocks:
 *   - fetchEconomy   → GET  /api/agents/:id/economy           (earnings, spending, policy, receipts)
 *   - fetchPricing   → GET  /api/agents/:id/skills-pricing     (owner skill prices)
 *   - savePricing    → PUT  /api/agents/:id/skills-pricing     (atomic price replace)
 *   - fetchLimits    → GET  /api/agents/:id/solana/limits      (spend policy snapshot)
 *   - setFrozen      → PUT  /api/agents/:id/solana/limits      (kill switch)
 *   - fetchApiService → GET /api/agents/:id/api-service       (sell-as-API config + earnings)
 *   - saveApiService → PUT  /api/agents/:id/api-service       (owner switch, price, description)
 *
 * Every read is real DB/chain state; every write is owner-authenticated +
 * CSRF-protected server-side. Mirrors the Withdraw tab's `call` shape so the UI
 * always gets a designed { ok, data | code, message } result, never a throw.
 */

import { consumeCsrfToken } from './api.js';

async function call(url, { method = 'GET', body = null } = {}) {
	try {
		const opts = { method, credentials: 'include', headers: {} };
		if (body != null) {
			opts.headers['content-type'] = 'application/json';
			opts.body = JSON.stringify(body);
		}
		// State-changing requests carry a single-use CSRF token; reads don't.
		if (method !== 'GET') {
			const token = await consumeCsrfToken();
			if (token) opts.headers['x-csrf-token'] = token;
		}
		const r = await fetch(url, opts);
		let j = null;
		try {
			j = await r.json();
		} catch {
			/* empty body */
		}
		if (!r.ok) {
			return {
				ok: false,
				status: r.status,
				code: j?.error || j?.code || 'error',
				message: j?.error_description || j?.message || `request failed (${r.status})`,
				detail: j?.detail || null,
				reasons: Array.isArray(j?.reasons) ? j.reasons : null,
			};
		}
		return { ok: true, status: r.status, data: j?.data ?? j };
	} catch (err) {
		return { ok: false, status: 0, code: 'network_error', message: err?.message || 'network error' };
	}
}

const enc = encodeURIComponent;

/** Full economy summary for the Earn tab. */
export function fetchEconomy(agentId, network = 'mainnet') {
	return call(`/api/agents/${enc(agentId)}/economy?network=${enc(network)}`);
}

/** The agent's active skill prices (owner-only). Returns { prices: [...] }. */
export function fetchPricing(agentId) {
	return call(`/api/agents/${enc(agentId)}/skills-pricing`);
}

/**
 * Atomically replace the agent's active skill prices.
 * @param {string} agentId
 * @param {Array<object>} prices - validated price rows (atomic-unit amounts).
 */
export function savePricing(agentId, prices) {
	return call(`/api/agents/${enc(agentId)}/skills-pricing`, { method: 'PUT', body: { prices } });
}

/** Spend policy snapshot: { limits, trade_limits, spent_today_usd }. */
export function fetchLimits(agentId) {
	return call(`/api/agents/${enc(agentId)}/solana/limits`);
}

/** Arm / disarm the kill switch (freeze every autonomous spend path). */
export function setFrozen(agentId, frozen) {
	return call(`/api/agents/${enc(agentId)}/solana/limits`, { method: 'PUT', body: { frozen: !!frozen } });
}

/**
 * The "Sell this agent as an API" service: stored config, endpoint URL, payout,
 * sellability (with owner-facing reasons) and earnings from agent_revenue_events.
 */
export function fetchApiService(agentId) {
	return call(`/api/agents/${enc(agentId)}/api-service`);
}

/**
 * Save { active, price_usd, description }. Validated server-side; activation is
 * refused with `reasons` when the agent cannot be sold.
 */
export function saveApiService(agentId, config) {
	return call(`/api/agents/${enc(agentId)}/api-service`, { method: 'PUT', body: config });
}

/**
 * Provision the agent's custodial Solana wallet (a fresh keypair, no on-chain
 * transaction). The sell-as-API card offers this when the agent has no Solana
 * payout address, which is the one thing a paid call needs to settle to.
 */
export function provisionSolanaWallet(agentId) {
	return call(`/api/agents/${enc(agentId)}/solana`, { method: 'POST', body: {} });
}

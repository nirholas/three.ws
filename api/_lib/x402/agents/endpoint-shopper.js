// @ts-check
// api/_lib/x402/agents/endpoint-shopper.js
//
// Persona: the Endpoint Shopper — a market-intelligence agent.
//
// In character, this agent's whole job is to shop the ring for signal: it buys
// paid intel endpoints (token/market/$THREE feeds) and continuously health-probes
// the paid surface it depends on. So its ring-buyer behaviour is exactly that —
// a deterministic rotation over the intel + health tier of the catalog. It mirrors
// the real /api/agents/endpoint-shopper-run agent (itself a paid endpoint that
// shops endpoints); here it is enlisted as a genuine x402 BUYER inside the ring.
//
// Revenue path (loop closure): every purchase pays the ring treasury
// (X402_PAY_TO_SOLANA) — the seller side is the platform itself. The USDC lands in
// the treasury, is visible in x402_ring_ledger via the settlement, and is
// recycled back to this agent's float by ring-rebalance's float-top-up step. The
// business layer (intel/health responses) is consumed for real; no money leaves
// the controlled-wallet set.
//
// All USDC. Never $THREE or any third-party coin as the payment asset. Labeled
// internal in every log row.

import { priceFor } from '../../x402-prices.js';
import { buildUrl } from './persona-kit.js';
import { pickDeterministic } from './persona-kit.js';

const THREE_CA = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';

// The intel + health endpoints this persona shops. Method/body/query match each
// handler's real contract (verified against the route files). priceSlug feeds
// priceFor() so the spend-limit pre-check uses the deployed price.
const SHOP = [
	{ slug: 'three-intel', priceSlug: 'three-intel', priceDefault: '10000', kind: 'intel', path: '/api/x402/three-intel', method: 'GET' },
	{ slug: 'crypto-intel', priceSlug: 'crypto-intel', priceDefault: '10000', kind: 'intel', path: '/api/x402/crypto-intel', method: 'POST', body: { topic: 'solana' } },
	{ slug: 'token-intel', priceSlug: 'token-intel', priceDefault: '10000', kind: 'intel', path: '/api/x402/token-intel', method: 'GET', query: { mint: THREE_CA, network: 'mainnet' } },
	{ slug: 'feed-health', priceSlug: 'feed-health', priceDefault: '1000', kind: 'health', path: '/api/x402/feed-health', method: 'POST', body: { feed: 'changelog_rss' } },
	{ slug: 'api-key-health', priceSlug: 'api-key-health', priceDefault: '1000', kind: 'health', path: '/api/x402/api-key-health', method: 'POST', body: {} },
	{ slug: 'solana-register-health', priceSlug: 'solana-register-health', priceDefault: '1000', kind: 'health', path: '/api/x402/solana-register-health', method: 'GET' },
	{ slug: 'auth-health', priceSlug: 'auth-health', priceDefault: '1000', kind: 'health', path: '/api/x402/auth-health', method: 'POST', body: {} },
];

export const persona = {
	id: 'endpoint-shopper',
	label: 'Endpoint Shopper',
	kind: 'intel',
	agentName: 'Ring Endpoint Shopper',
	describe: 'Shops the ring for market/$THREE intel and health-probes the paid surface it relies on.',
	// Conservative caps — an intel shopper makes many tiny buys; the daily ceiling
	// bounds a runaway loop, the per-tx ceiling covers the $0.01 intel tier with headroom.
	spendLimits: { daily_usd: 5, per_tx_usd: 0.25 },

	/**
	 * Deterministic purchase plan for one tick.
	 * @param {{ origin: string, seed: number, maxBuys?: number }} ctx
	 * @returns {Array<{ slug, url, method, body, priceAtomic, kind, memo }>}
	 */
	plan({ origin, seed, maxBuys = 1 }) {
		const picks = pickDeterministic(SHOP, seed, maxBuys);
		return picks.map((p) => ({
			slug: p.slug,
			url: buildUrl(origin, p.path, p.query),
			method: p.method,
			body: p.body ?? null,
			priceAtomic: Number(priceFor(p.priceSlug, p.priceDefault)),
			kind: p.kind,
			memo: `endpoint-shopper:${p.kind}`,
		}));
	},
};

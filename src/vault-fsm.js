/**
 * Pure helpers for the `/vault` page (prompt 12) — no DOM, no network, unit
 * tested in `tests/bnb-vault-fsm.test.js`. Two responsibilities:
 *
 *  1. `deriveListingState` mirrors `api/vault/status.js`'s exact state
 *     derivation so the UI can reason about a listing (and render its badge)
 *     from the SAME response shape the real endpoint returns — one source of
 *     truth for "what does this listing look like right now."
 *  2. `nextFlowStep`/`FLOW_STEPS` is the buy→settle→unlock UI progression the
 *     detail panel walks through, decoupled from any single event source so
 *     it's trivial to unit test every transition table-style.
 */

import { shortAddress } from './shared/address.js';

/** Mirrors GreenfieldVault.SaleStatus / api/_lib/bnb/vault-contract.js's SALE_STATUS. */
export const SALE_STATUS = ['Pending', 'Granted', 'Failed', 'Revoked'];

/**
 * Mirrors `api/vault/status.js`'s `state` derivation exactly, from the same
 * inputs a `GET /api/vault/status` response carries. Kept here (not just
 * "trust the API's own `state` field") so the UI can compute an optimistic
 * next state locally right after a `buy()` tx confirms, before the first
 * poll — see `vault.js`'s "optimistic pending-grant" render.
 * @param {{ contractDeployed:boolean, listingActive?:boolean, saleId?:string|number|bigint, saleStatus?:string }} p
 * @returns {'unlisted'|'available'|'pending-grant'|'unlocked'}
 */
export function deriveListingState({ contractDeployed, listingActive, saleId, saleStatus }) {
	if (!contractDeployed) return 'unlisted';
	const sid = typeof saleId === 'bigint' ? saleId : BigInt(saleId || 0);
	if (sid === 0n) return listingActive ? 'available' : 'unlisted';
	return saleStatus === 'Granted' ? 'unlocked' : 'pending-grant';
}

/** Ordered detail-panel steps for the buy → settle → unlock flow. */
export const FLOW_STEPS = ['browse', 'connect', 'buy', 'pending-grant', 'unlocked'];

/**
 * Given the current UI step and a listing state (from `deriveListingState`
 * or a real `/status` response), returns the step the detail panel should be
 * showing. Table-driven and pure so every transition is unit-testable
 * without mounting the page.
 * @param {{ walletConnected:boolean, listingState:string, hasDecrypted:boolean }} ctx
 * @returns {'connect'|'buy'|'pending-grant'|'unlocked'|'viewing'}
 */
export function nextFlowStep({ walletConnected, listingState, hasDecrypted }) {
	if (!walletConnected) return 'connect';
	if (listingState === 'unlisted') return 'unlisted';
	if (listingState === 'available') return 'buy';
	if (listingState === 'pending-grant') return 'pending-grant';
	if (listingState === 'unlocked') return hasDecrypted ? 'viewing' : 'unlocked';
	return 'buy';
}

/** Format an atomic USDC-style price (this vault prices in wei of native BNB) into a human BNB string. */
export function formatBnbAtomic(atomic) {
	let wei;
	try {
		wei = typeof atomic === 'bigint' ? atomic : BigInt(atomic ?? 0);
	} catch {
		return '—';
	}
	const whole = wei / 1_000_000_000_000_000_000n;
	const frac = wei % 1_000_000_000_000_000_000n;
	const fracStr = frac.toString().padStart(18, '0').slice(0, 4).replace(/0+$/, '');
	return fracStr ? `${whole}.${fracStr} BNB` : `${whole} BNB`;
}

/** 0x1234…abcd — never truncates a non-address string, never throws. */
export function truncateAddress(addr) {
	if (typeof addr !== 'string' || !addr.startsWith('0x')) return addr || '';
	return shortAddress(addr, 6, 4);
}

/** Bounded-backoff poll delay in ms for a given attempt index (0-based). Caps at 8s. */
export function pollDelayMs(attempt) {
	return Math.min(1500 * Math.pow(1.5, Math.max(0, attempt)), 8000);
}

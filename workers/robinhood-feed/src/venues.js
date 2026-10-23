// The observed launch venues of Robinhood Chain. Each entry in
// venue-catalog.json is a (contract, selector) pair that was seen minting new
// ERC-20 supply, ranked by how many tokens it actually launched. The catalog is
// learned from the chain (see scripts/build-venue-catalog.mjs), not from any
// launchpad's own marketing, which is why it covers contracts that publish no
// name at all.
//
// Attribution is by the contract the mint transaction CALLED, because an ERC-20
// mints its supply from the zero address no matter who launched it.

import catalog from './venue-catalog.json' with { type: 'json' };

export const CATALOG_META = Object.freeze({
	source: catalog.source,
	generated_at: catalog.generated_at,
	window: catalog.window,
	tokens_scanned: catalog.tokens_scanned,
	venues: catalog.venues.length,
});

const byKey = new Map(); // `${address}:${selector}` → venue
const byAddress = new Map(); // address → venue with the most observed launches
for (const v of catalog.venues) {
	byKey.set(`${v.address}:${v.selector}`, v);
	const prev = byAddress.get(v.address);
	if (!prev || v.observed_launches > prev.observed_launches) byAddress.set(v.address, v);
}

/** A short, stable display name: the catalog label, or the address when nameless. */
export function venueLabel(v) {
	return v.label || `Launchpad ${v.address.slice(0, 6)}…${v.address.slice(-4)}`;
}

/**
 * The venue a transaction launched through, or null when the call is not a
 * catalogued launch entry point. An exact (contract, selector) match wins; a
 * known contract with a new selector still counts as that venue, since one
 * launchpad routinely ships several launch functions.
 *
 * @param {string|null|undefined} to    the transaction's `to`
 * @param {string|null|undefined} input the transaction's calldata
 */
export function venueForCall(to, input) {
	if (!to) return null;
	const address = to.toLowerCase();
	const selector = typeof input === 'string' && input.length >= 10 ? input.slice(0, 10).toLowerCase() : null;
	const hit = (selector && byKey.get(`${address}:${selector}`)) || byAddress.get(address) || null;
	if (!hit) return null;
	return {
		id: hit.id,
		label: venueLabel(hit),
		kind: hit.kind,
		address: hit.address,
		selector,
		observed_launches: hit.observed_launches,
	};
}

/** Every venue in the catalog, for the API's `venues` listing. */
export function listVenues() {
	return catalog.venues.map((v) => ({
		id: v.id,
		label: venueLabel(v),
		kind: v.kind,
		address: v.address,
		observed_launches: v.observed_launches,
		launchable: v.launchable,
	}));
}

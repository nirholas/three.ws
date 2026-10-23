// Rebuild src/venue-catalog.json from a launch-relay checkout's observed venue
// catalog (src/chains/robinhood/venues/catalog.json). Usage:
//
//   node scripts/build-venue-catalog.mjs <path-to-launch-relay-catalog.json>
//
// Only (contract, selector) pairs that read as a token-launch entry point are
// kept. Routers, bridges, account-abstraction entry points and Multicall3 also
// mint tokens from the zero address, but the contract that was called is not
// the launchpad, so attributing a launch to them would be wrong.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = process.argv[2];
if (!src) {
	console.error('usage: node scripts/build-venue-catalog.mjs <catalog.json>');
	process.exit(2);
}

const NOT_A_LAUNCHPAD = /reads as a router|does not read as a launch entry point|^calls arrive through/i;

const catalog = JSON.parse(readFileSync(src, 'utf8'));
const venues = catalog.venues
	.filter((v) => !v.forwarder && !NOT_A_LAUNCHPAD.test(v.reason || ''))
	.map((v) => ({
		id: v.id,
		label: v.label || null,
		kind: v.kind,
		address: v.address.toLowerCase(),
		selector: v.selector,
		observed_launches: v.observed.launches,
		launchable: v.usable === true,
	}))
	.sort((a, b) => b.observed_launches - a.observed_launches);

const out = {
	chain_id: catalog.chainId,
	source: 'launch-relay observed venue catalog',
	generated_at: catalog.generatedAt,
	window: catalog.window,
	tokens_scanned: catalog.tokensScanned,
	venues,
};
const dest = fileURLToPath(new URL('../src/venue-catalog.json', import.meta.url));
writeFileSync(dest, JSON.stringify(out, null, '\t') + '\n');
console.log(`wrote ${venues.length} venues to ${dest}`);

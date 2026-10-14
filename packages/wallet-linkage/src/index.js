// Public entry point: score every pair among 2-10 Solana addresses for shared
// control, using an injected RPC client so callers route through their own
// failover chain instead of a hardcoded endpoint.

import { collectActivity, fetchAccountFacts } from './collect.js';
import { runSignals } from './signals.js';
import { scorePair } from './score.js';
import { loadExclusions } from './exclusions.js';

export { collectActivity, fetchAccountFacts, extractTransfers } from './collect.js';
export { runSignals, ALL_SIGNALS, solanaAccountControl, solanaFeePayer, peerFirstFunding, commonFirstFunder, directTransfer, fundingBurst } from './signals.js';
export { scorePair, bandFor } from './score.js';
export { loadExclusions, resetExclusionsCache } from './exclusions.js';

const MIN_ADDRESSES = 2;
const MAX_ADDRESSES = 10;

/**
 * @param {object} connection an injected RPC client exposing
 *   `getSignaturesForAddress`, `getParsedTransaction`, `getAccountInfo`: a
 *   `@solana/web3.js` Connection, or anything shaped like one. Callers wire in
 *   their own failover chain here (three.ws uses `solanaConnection()`).
 * @param {string[]} addresses 2 to 10 Solana addresses.
 * @param {{ signatureLimit?: number, budgetMs?: number, exclusions?: Set<string> }} [opts]
 * @returns {Promise<{ addresses: string[], pairs: Array<object>, complete: boolean }>}
 */
export async function analyzeLinkage(connection, addresses, opts = {}) {
	const unique = [...new Set(addresses)];
	if (unique.length < MIN_ADDRESSES || unique.length > MAX_ADDRESSES) {
		throw new Error(`analyzeLinkage requires between ${MIN_ADDRESSES} and ${MAX_ADDRESSES} distinct addresses`);
	}
	const exclusions = opts.exclusions ?? loadExclusions();

	const bundles = await Promise.all(
		unique.map(async (address) => {
			const [activity, facts] = await Promise.all([
				collectActivity(connection, address, opts),
				fetchAccountFacts(connection, address),
			]);
			const createTransfer = activity.transfers.find((t) => t.to === address && t.kind === 'create');
			return { ...activity, facts, rentPayer: createTransfer?.from ?? null };
		}),
	);

	// Hub detection across the requested set: a third-party address funding
	// three or more of the addresses under analysis reads as a shared
	// exchange/service wallet, not a controller link (see signals.js).
	const sharedBy = new Map();
	for (const bundle of bundles) {
		const funders = new Set();
		for (const t of bundle.transfers) if (t.to === bundle.address && t.from) funders.add(t.from);
		if (bundle.firstInbound?.from) funders.add(bundle.firstInbound.from);
		for (const f of funders) sharedBy.set(f, (sharedBy.get(f) ?? 0) + 1);
	}
	const ctx = { exclusions, sharedBy };

	const byAddress = new Map(bundles.map((b) => [b.address, b]));
	const pairs = [];
	for (let i = 0; i < unique.length; i++) {
		for (let j = i + 1; j < unique.length; j++) {
			const a = byAddress.get(unique[i]);
			const b = byAddress.get(unique[j]);
			const signalResults = runSignals(a, b, ctx);
			const scored = scorePair(signalResults);
			pairs.push({ a: a.address, b: b.address, ...scored, evidence: signalResults });
		}
	}

	return { addresses: unique, pairs, complete: bundles.every((b) => b.complete) };
}

// Known service/exchange accounts excluded from the signals that key on a
// shared counterparty (fee payer, first funder, funding burst): a hot wallet
// that funds thousands of unrelated users is not evidence two of them share a
// controller. Loaded at runtime from WALLET_LINKAGE_EXCLUDED_ACCOUNTS (a comma
// separated address list) and/or a JSON array file at
// WALLET_LINKAGE_EXCLUSIONS_PATH. Never hardcoded here: a real third-party
// address committed to this repo would need the CLAUDE.md crypto-project
// commit gate, so the set is supplied by the deployment instead (this ports
// the upstream exclusion-list CONCEPT, not its literal list).

import { readFileSync } from 'node:fs';

let cached = null;

export function loadExclusions(env = process.env) {
	if (cached) return cached;
	const set = new Set();
	const inline = env.WALLET_LINKAGE_EXCLUDED_ACCOUNTS;
	if (inline) {
		for (const addr of inline.split(',').map((s) => s.trim()).filter(Boolean)) set.add(addr);
	}
	const path = env.WALLET_LINKAGE_EXCLUSIONS_PATH;
	if (path) {
		try {
			const data = JSON.parse(readFileSync(path, 'utf8'));
			if (Array.isArray(data)) {
				for (const addr of data) if (typeof addr === 'string') set.add(addr);
			}
		} catch {
			// A missing or invalid exclusions file degrades to the inline list
			// only: this set is a precision tweak, never core correctness.
		}
	}
	cached = set;
	return set;
}

export function resetExclusionsCache() {
	cached = null;
}

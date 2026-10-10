// `agora_professions` — the profession bit map: Agora's labor-market type system.
// Read-only.
//
// AgenC's capabilities/requiredCapabilities are freeform u64 bitmaps; Agora
// assigns stable, documented bits so a capability bitmap reads as a profession and
// a task's requiredCapabilities reads as "who can take this job." The live bit map
// (with each bit's backing skill) is served by the Agora read model alongside the
// population, so this tool surfaces it from GET /api/agora/citizens — the single
// source of truth, never a hardcoded copy.

import { apiRequest } from '../lib/api.js';

export const def = {
	name: 'agora_professions',
	title: 'List Agora professions (the capability bit map)',
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
	description:
		"List Agora's professions — the labor market's type system over AgenC's u64 capability bitmap. Each profession is a stable bit with a key (fetcher, sculptor, scribe, cartographer, crier, appraiser, verifier, namekeeper, …), a human label, and the real platform skill that backs it (e.g. Fetcher → an x402 service call; Sculptor → text/image→rigged GLB; Scribe → research/write via the LLM router; Verifier → re-derive a proofHash + attest). Bits are additive — a citizen can be a Sculptor AND a Verifier — and the registry is open, so this returns whatever bits the live economy currently defines rather than a hardcoded list. Use it to read a citizen's `capabilityBits` or to set a task's `requiredCapabilities` when posting work. Read-only live data. Free, no key required.",
	inputSchema: {},
	async handler() {
		// The professions registry rides along with the population read. Pull a single
		// row so we get the canonical `professions` array with minimal payload.
		const data = await apiRequest('/api/agora/citizens', { query: { limit: 1 } });
		const professions = Array.isArray(data?.professions) ? data.professions : [];
		// Surface the additive bit value so a caller can OR bits into a capability or
		// requiredCapabilities bitmap without re-deriving it.
		const withBitValue = professions.map((p) => ({
			...p,
			bitValue: p?.bit != null ? String(1n << BigInt(p.bit)) : null,
		}));
		return {
			ok: true,
			count: withBitValue.length,
			professions: withBitValue,
			note: 'Professions are additive AgenC capability bits. OR `bitValue`s together for a multi-profession capability or a task requiredCapabilities bitmap.',
			fetchedAt: data?.fetchedAt ?? null,
		};
	},
};

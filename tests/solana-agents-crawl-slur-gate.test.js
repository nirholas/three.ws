// The Solana registry crawl indexes names and descriptions straight from
// attacker-controlled registry metadata, and /deploy-onchain's "latest to land"
// strip rendered a slur-named Metaplex agent verbatim (found 2026-10-08). The
// upsert now applies the same slur gate as the ERC-8004 hydration, and the
// structural pass (no name, every 30 minutes) must not re-activate a row an
// earlier metadata pass withheld.

import { describe, expect, it, vi, beforeEach } from 'vitest';

const calls = [];
vi.mock('../api/_lib/db.js', () => ({
	sql: Object.assign(
		async (strings, ...values) => {
			calls.push({ strings: [...strings], values });
			return [];
		},
		{ unsafe: async () => [] },
	),
}));

const { upsertAgent } = await import('../api/_lib/solana-agents-crawl.js');

const squash = (s) => s.replace(/\s+/g, '');

// The INSERT's `active` value: the one followed by `, now(),` in the VALUES list.
function insertedActive(call) {
	const i = call.strings.findIndex((s, k) => k > 0 && squash(s).startsWith(',now(),'));
	return call.values[i - 1];
}
// The ON CONFLICT guard: true when this pass carried no name or description.
function judgedNothing(call) {
	const k = call.strings.findIndex((str) => str.includes('THEN excluded.active AND solana_agents_index.active'));
	return call.values[k - 1];
}

beforeEach(() => {
	calls.length = 0;
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('solana registry upsert slur gate', () => {
	it('withholds an agent whose registry name carries a slur', async () => {
		await upsertAgent({ source: 'metaplex', ref: 'THREEsynthetic1111111111111111111111111A', name: 'nigga bot', active: true });
		expect(insertedActive(calls[0])).toBe(false);
		expect(judgedNothing(calls[0])).toBe(false);
	});

	it('keeps an ordinary agent active, crude names included', async () => {
		await upsertAgent({ source: 'metaplex', ref: 'THREEsynthetic1111111111111111111111111B', name: 'damn good agent', active: true });
		expect(insertedActive(calls[0])).toBe(true);
	});

	it('flags a name-less structural pass so it keeps the stored verdict', async () => {
		await upsertAgent({ source: 'metaplex', ref: 'THREEsynthetic1111111111111111111111111C', active: true, enriched: false });
		expect(insertedActive(calls[0])).toBe(true);
		expect(judgedNothing(calls[0])).toBe(true);
	});
});

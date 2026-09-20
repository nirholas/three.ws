// The ladder must never sell an unbuilt perk as a benefit of holding.
//
// /three, GET /api/pricing and GET /api/three/tier all render TIERS[].perks
// verbatim. Before this guard, "Private worlds" and "Priority MCP routing" sat in
// Silver's perks while their gates were registered with enforced:false, so the
// page promised them flatly in one list and flagged them Planned two rows down.
// These assertions keep the two lists honest: anything without a live gate behind
// it belongs in `planned`, which every surface renders with the Planned flag.

import { describe, it, expect } from 'vitest';
import { TIERS } from '../api/_lib/three-tier.js';
import { GATED_FEATURES } from '../api/_lib/three-access.js';

const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

describe('$THREE tier ladder honesty', () => {
	it('gives every tier both lists', () => {
		for (const t of TIERS) {
			expect(Array.isArray(t.perks), `${t.id}.perks`).toBe(true);
			expect(Array.isArray(t.planned), `${t.id}.planned`).toBe(true);
			expect(t.perks.length, `${t.id} must offer something today`).toBeGreaterThan(0);
		}
	});

	it('never lists the same line as both delivered and planned', () => {
		const delivered = new Set(TIERS.flatMap((t) => t.perks.map(norm)));
		for (const t of TIERS) {
			for (const p of t.planned) {
				expect(delivered.has(norm(p)), `"${p}" is in both perks and planned`).toBe(false);
			}
		}
	});

	it('keeps the label of an unenforced gate out of every perks list', () => {
		const deliveredWords = TIERS.flatMap((t) => t.perks.map(norm));
		for (const [id, f] of Object.entries(GATED_FEATURES)) {
			if (f.enforced) continue;
			// A perk line that restates an unenforced feature's label (in either
			// direction, since the perk copy is shorter than the registry label) is
			// the exact failure this test exists to catch.
			for (const perk of deliveredWords) {
				const label = norm(f.label);
				const overlap = label.includes(perk) || perk.includes(label);
				expect(overlap, `perk "${perk}" promises unenforced feature ${id}`).toBe(false);
			}
		}
	});

	it('declares planned lines on every tier that has an unenforced gate', () => {
		for (const t of TIERS) {
			const unenforcedHere = Object.values(GATED_FEATURES).filter(
				(f) => f.minLevel === t.level && !f.enforced,
			);
			if (unenforcedHere.length === 0) continue;
			expect(t.planned.length, `${t.id} has unenforced gates but no planned list`).toBeGreaterThan(0);
		}
	});

	it('marks the two shipped gates as enforced', () => {
		expect(GATED_FEATURES['forge.high'].enforced).toBe(true);
		expect(GATED_FEATURES['forge.gameready'].enforced).toBe(true);
		expect(GATED_FEATURES['forge.high'].minLevel).toBe(1);
		expect(GATED_FEATURES['forge.gameready'].minLevel).toBe(1);
	});
});

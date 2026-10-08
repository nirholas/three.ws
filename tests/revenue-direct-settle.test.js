// A sale the buyer paid straight into the seller's own wallet is never a
// treasury liability.
//
// agent_revenue_events doubles as the withdrawal ledger: every row with
// settled_to_wallet = false is money the treasury owes the seller. Skill
// purchases, bundle purchases and agent x402 skill calls all settle into the
// seller's payout wallet, yet wrote their rows with the default false, so a
// seller could buy their own skill from a second account (losing nothing) and
// withdraw the price again from the treasury, as often as they liked.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

function revenueInserts(src) {
	return src.match(/insert into agent_revenue_events[\s\S]*?on conflict/gi) || [];
}

describe('direct-to-seller revenue rows are flagged settled_to_wallet', () => {
	for (const rel of ['api/_lib/purchase-confirm.js', 'api/marketplace/purchase-bundle.js', 'api/agents/x402/[action].js']) {
		it(rel, () => {
			const inserts = revenueInserts(read(rel));
			expect(inserts.length).toBeGreaterThan(0);
			for (const ins of inserts) {
				expect(ins).toMatch(/settled_to_wallet\)/);
				expect(ins).toMatch(/,\s*true\)\s*\n\s*on conflict/i);
			}
		});
	}

	it('ships a backfill for rows written before the fix', () => {
		const sql = read('api/_lib/migrations/20261008150000_revenue_direct_settle_backfill.sql');
		expect(sql).toMatch(/set settled_to_wallet = true/);
		expect(sql).toMatch(/'sp\\_%'/);
		expect(sql).toMatch(/'bundle\\_%'/);
	});
});

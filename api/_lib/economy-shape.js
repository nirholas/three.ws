// Pure shaping for the owner-facing agent economy summary (api/agents/:id/economy).
//
// Money is earned three real, distinct ways on three.ws and each is its own
// ledger: skill sales (agent_revenue_events), hires from other agents over the
// x402 mesh (agent_hires), and tips (agent_custody_events). This module composes
// those buckets into the summary's `earnings` object and the running total.
//
// It is deliberately I/O-free — every input is already a plain number from a
// ledger query — so the invariants that matter (hires are their own bucket; the
// total sums all three without double-counting) are unit-testable in full.

// A hire paid straight from a wallet (the hire Blink, api/actions/agent-hire.js)
// has no hiring agent, only the paying wallet. Every hire feed names that
// counterparty by its wallet rather than calling it "Agent".
export function walletLabel(address) {
	const a = typeof address === 'string' ? address.trim() : '';
	if (a.length < 12) return 'Wallet';
	return `Wallet ${a.slice(0, 4)}...${a.slice(-4)}`;
}

function num(v) {
	const n = Number(v);
	return Number.isFinite(n) ? n : 0;
}

function int(v) {
	const n = Math.trunc(Number(v));
	return Number.isFinite(n) ? n : 0;
}

/**
 * Compose the three earning buckets into the summary `earnings` object plus a
 * total across all three. Each bucket is passed through verbatim (preserving any
 * extra fields such as skill_sales.non_usdc_count); only `total` is derived.
 *
 * @param {{ skill_sales: object, hires: object, tips: object }} buckets
 * @returns {{ skill_sales: object, hires: object, tips: object, total: object }}
 */
export function composeEarnings({ skill_sales = {}, hires = {}, tips = {} } = {}) {
	const all = [skill_sales, hires, tips];
	return {
		skill_sales,
		hires,
		tips,
		total: {
			today: all.reduce((s, b) => s + num(b.today), 0),
			week: all.reduce((s, b) => s + num(b.week), 0),
			lifetime: all.reduce((s, b) => s + num(b.lifetime), 0),
			count: all.reduce((s, b) => s + int(b.count), 0),
		},
	};
}

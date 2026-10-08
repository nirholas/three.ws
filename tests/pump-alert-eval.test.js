import { describe, it, expect } from 'vitest';
import {
	cooldownElapsed,
	gradMatchesRule,
	newMintMatchesRule,
	isWhaleBuy,
	evaluatePriceRule,
	buildGraduationPayload,
	buildNewMintPayload,
	buildWhalePayload,
	buildPricePayload,
	formatAlertSummary,
	deriveRuleLabel,
	MINT_TARGETED_KINDS,
	AGENT_TARGETED_KINDS,
	MARKET_TARGETED_KINDS,
	THRESHOLD_KINDS,
} from '../api/_lib/pump-alert-eval.js';

const baseRule = (over = {}) => ({
	id: 'rule-1',
	user_id: 'user-1',
	kind: 'graduation',
	target_mint: null,
	target_agent: null,
	threshold: null,
	deliver_in_app: true,
	cooldown_seconds: 300,
	enabled: true,
	...over,
});

describe('cooldownElapsed', () => {
	it('returns true when never fired', () => {
		expect(cooldownElapsed(null, 300)).toBe(true);
		expect(cooldownElapsed(undefined, 300)).toBe(true);
	});
	it('returns false inside the cooldown window', () => {
		const now = 1_000_000_000_000;
		const lastFired = new Date(now - 60_000); // 60s ago
		expect(cooldownElapsed(lastFired, 300, now)).toBe(false);
	});
	it('returns true once the window has elapsed', () => {
		const now = 1_000_000_000_000;
		const lastFired = new Date(now - 301_000); // 301s ago
		expect(cooldownElapsed(lastFired, 300, now)).toBe(true);
	});
	it('treats an unparseable timestamp as elapsed (fail open)', () => {
		expect(cooldownElapsed('not-a-date', 300)).toBe(true);
	});
});

describe('gradMatchesRule', () => {
	it('global rule matches any graduation', () => {
		expect(gradMatchesRule(baseRule(), { mint: 'MINT_A' })).toBe(true);
	});
	it('mint-scoped rule matches only its mint', () => {
		const r = baseRule({ target_mint: 'MINT_A' });
		expect(gradMatchesRule(r, { mint: 'MINT_A' })).toBe(true);
		expect(gradMatchesRule(r, { mint: 'MINT_B' })).toBe(false);
	});
	it('agent-scoped rule matches only the agent’s mints', () => {
		const r = baseRule({ target_agent: 'agent-9' });
		const agentMints = new Set(['MINT_A', 'MINT_C']);
		expect(gradMatchesRule(r, { mint: 'MINT_A' }, { agentMints })).toBe(true);
		expect(gradMatchesRule(r, { mint: 'MINT_B' }, { agentMints })).toBe(false);
		expect(gradMatchesRule(r, { mint: 'MINT_A' }, {})).toBe(false); // no set → no match
	});
	it('rejects non-graduation kinds and missing mints', () => {
		expect(gradMatchesRule(baseRule({ kind: 'whale_buy' }), { mint: 'X' })).toBe(false);
		expect(gradMatchesRule(baseRule(), {})).toBe(false);
	});
});

describe('newMintMatchesRule', () => {
	const r = baseRule({ kind: 'new_mint', target_agent: 'agent-9' });
	it('matches the target agent’s new mint', () => {
		expect(newMintMatchesRule(r, { agent_id: 'agent-9', mint: 'MINT_A' })).toBe(true);
	});
	it('ignores other agents and requires a target', () => {
		expect(newMintMatchesRule(r, { agent_id: 'agent-1' })).toBe(false);
		expect(newMintMatchesRule(baseRule({ kind: 'new_mint' }), { agent_id: 'agent-9' })).toBe(false);
	});
});

describe('isWhaleBuy', () => {
	const r = baseRule({ kind: 'whale_buy', target_mint: 'MINT_A', threshold: 5 });
	it('fires on a buy at or above the SOL threshold for the right mint', () => {
		expect(isWhaleBuy(r, { mint: 'MINT_A', is_buy: true, sol_amount: 5 })).toBe(true);
		expect(isWhaleBuy(r, { mint: 'MINT_A', is_buy: true, sol_amount: 12.3 })).toBe(true);
	});
	it('ignores sells, small buys, and other mints', () => {
		expect(isWhaleBuy(r, { mint: 'MINT_A', is_buy: false, sol_amount: 50 })).toBe(false);
		expect(isWhaleBuy(r, { mint: 'MINT_A', is_buy: true, sol_amount: 4.99 })).toBe(false);
		expect(isWhaleBuy(r, { mint: 'MINT_B', is_buy: true, sol_amount: 50 })).toBe(false);
	});
	it('requires a positive threshold', () => {
		const bad = baseRule({ kind: 'whale_buy', target_mint: 'MINT_A', threshold: 0 });
		expect(isWhaleBuy(bad, { mint: 'MINT_A', is_buy: true, sol_amount: 100 })).toBe(false);
	});
});

describe('evaluatePriceRule (edge-triggered)', () => {
	it('price_above fires on the up-crossing, then stays quiet while held', () => {
		const r = baseRule({ kind: 'price_above', target_mint: 'M', threshold: 1000 });
		// First observation already above → fire, arm 'over'.
		const a = evaluatePriceRule(r, 1500, {});
		expect(a.fire).toBe(true);
		expect(a.nextState.side).toBe('over');
		// Still above → no re-fire.
		const b = evaluatePriceRule(r, 1600, a.nextState);
		expect(b.fire).toBe(false);
		// Drops below → re-arm 'under', no fire.
		const c = evaluatePriceRule(r, 900, b.nextState);
		expect(c.fire).toBe(false);
		expect(c.nextState.side).toBe('under');
		// Crosses up again → fire.
		const d = evaluatePriceRule(r, 1100, c.nextState);
		expect(d.fire).toBe(true);
	});
	it('price_below fires on the down-crossing', () => {
		const r = baseRule({ kind: 'price_below', target_mint: 'M', threshold: 1000 });
		const a = evaluatePriceRule(r, 800, {});
		expect(a.fire).toBe(true);
		expect(a.nextState.side).toBe('under');
		const b = evaluatePriceRule(r, 700, a.nextState);
		expect(b.fire).toBe(false);
		const c = evaluatePriceRule(r, 1200, b.nextState);
		expect(c.fire).toBe(false);
		expect(c.nextState.side).toBe('over');
		const d = evaluatePriceRule(r, 950, c.nextState);
		expect(d.fire).toBe(true);
	});
	it('does not fire without a usable price and preserves prior state', () => {
		const r = baseRule({ kind: 'price_above', target_mint: 'M', threshold: 1000 });
		const res = evaluatePriceRule(r, null, { side: 'over' });
		expect(res.fire).toBe(false);
		expect(res.nextState.side).toBe('over');
	});
});

describe('payload builders', () => {
	it('graduation payload carries the tx signature as the dedupe key', () => {
		const p = buildGraduationPayload(baseRule(), {
			tx_signature: 'SIG1',
			mint: 'M',
			name: 'Name',
			symbol: 'SYM',
			amount_sol: '12.5',
			market_cap_usd: '90000',
			seen_at: '2026-06-15T00:00:00.000Z',
		});
		expect(p.kind).toBe('graduation');
		expect(p.event_id).toBe('SIG1');
		expect(p.amount_sol).toBe(12.5);
		expect(p.market_cap_usd).toBe(90000);
	});
	it('new_mint payload keys on the mint', () => {
		const p = buildNewMintPayload(baseRule({ kind: 'new_mint', target_agent: 'A' }), { mint: 'M', agent_id: 'A' });
		expect(p.event_id).toBe('M');
		expect(p.agent_id).toBe('A');
	});
	it('whale payload keys on the trade signature', () => {
		const p = buildWhalePayload(
			baseRule({ kind: 'whale_buy', target_mint: 'M', threshold: 5 }),
			{ mint: 'M', symbol: 'S' },
			{ signature: 'TSIG', sol_amount: 9, sol_value_usd: 1800, buyer: 'B' },
		);
		expect(p.event_id).toBe('TSIG');
		expect(p.amount_sol).toBe(9);
		expect(p.amount_usd).toBe(1800);
	});
	it('price payload buckets the dedupe key by hour', () => {
		const p = buildPricePayload(baseRule({ kind: 'price_above', target_mint: 'M', threshold: 1000 }), {
			mint: 'M',
			market_cap_usd: 1500,
		});
		expect(p.kind).toBe('price_above');
		expect(p.event_id.startsWith('price_above:M:')).toBe(true);
		expect(p.threshold_usd).toBe(1000);
	});
});

describe('formatAlertSummary', () => {
	it('renders a readable line per kind', () => {
		expect(formatAlertSummary({ kind: 'graduation', symbol: 'ABC', market_cap_usd: 90000 })).toContain('graduated');
		expect(formatAlertSummary({ kind: 'whale_buy', symbol: 'ABC', amount_sol: 12 })).toContain('Whale');
		expect(formatAlertSummary({ kind: 'price_above', symbol: 'ABC', threshold_usd: 1000, market_cap_usd: 1500 })).toContain('above');
		expect(formatAlertSummary({ kind: 'new_mint', symbol: 'ABC' })).toContain('launched');
	});
	it('falls back to a shortened mint when no symbol/name', () => {
		const s = formatAlertSummary({ kind: 'graduation', mint: 'ABCD1234EFGH5678' });
		expect(s).toContain('ABCD');
	});
});

describe('deriveRuleLabel', () => {
	it('produces a sensible default label per kind', () => {
		expect(deriveRuleLabel(baseRule())).toContain('all tokens');
		expect(deriveRuleLabel(baseRule({ kind: 'whale_buy', target_mint: 'ABCD1234EFGH5678', threshold: 5 }))).toContain('Whale');
		expect(deriveRuleLabel(baseRule({ kind: 'price_below', target_mint: 'ABCD1234EFGH5678', threshold: 1000 }))).toContain('below');
	});
});

describe('kind classification constants', () => {
	it('partitions kinds correctly', () => {
		expect(MINT_TARGETED_KINDS).toEqual(['price_above', 'price_below', 'whale_buy']);
		expect(AGENT_TARGETED_KINDS).toEqual(['new_mint']);
		expect(MARKET_TARGETED_KINDS).toEqual(['market_price']);
		expect(THRESHOLD_KINDS).toEqual(['price_above', 'price_below', 'whale_buy', 'market_price']);
	});
});

import { describe, it, expect, vi } from 'vitest';

// The loader imports the database client; the shaping under test is pure.
vi.mock('../api/_lib/db.js', () => ({ sql: () => Promise.resolve([]) }));

const {
	evidenceTiming,
	receiptTxUrl,
	shapeTradeReceipt,
	summarizeReceipt,
	triggerLabel,
} = await import('../api/_lib/trade-receipt.js');

const OPENED = '2026-09-24T05:46:25.948Z';
const CLOSED = '2026-09-24T05:52:22.479Z';
const SOL_SIG = '3owaJHvhEbES9WmjiDmSXk9kVTepjHft4ZMHkPTauK79tj3HhuM7bbtK4jA42piV49u5jU4xVdCJW4dcDfAJdAbz';

/** A closed, live position on $THREE. Tests override one field at a time. */
function position(over = {}) {
	return {
		id: '11111111-2222-3333-4444-555555555555',
		agent_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
		agent_name: 'Crosshair',
		agent_image: null,
		network: 'mainnet',
		mint: 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump',
		symbol: 'THREE',
		name: 'three.ws',
		status: 'closed',
		exit_reason: 'trailing_stop',
		entry_trigger: 'oracle_crossing',
		trigger_ref: 'score:85',
		entry_quote_lamports: '2000000',
		exit_quote_lamports: '1794738',
		realized_pnl_lamports: '-205262',
		realized_pnl_pct: '-10.2631',
		entry_price_impact_pct: '0.0019',
		buy_sig: SOL_SIG,
		sell_sig: SOL_SIG,
		opened_at: OPENED,
		closed_at: CLOSED,
		...over,
	};
}

const at = (deltaSec) => new Date(new Date(OPENED).getTime() + deltaSec * 1000).toISOString();

describe('evidenceTiming', () => {
	it('places evidence before the entry, inside the clock-skew allowance', () => {
		expect(evidenceTiming(at(-60), OPENED, CLOSED)).toBe('before_entry');
		expect(evidenceTiming(at(90), OPENED, CLOSED)).toBe('before_entry');
	});
	it('separates the hold from the time after the exit', () => {
		expect(evidenceTiming(at(200), OPENED, CLOSED)).toBe('during_trade');
		expect(evidenceTiming(at(3600), OPENED, CLOSED)).toBe('after_exit');
	});
	it('treats an open position as still holding', () => {
		expect(evidenceTiming(at(3600), OPENED, null)).toBe('during_trade');
	});
	it('refuses to place a missing timestamp', () => {
		expect(evidenceTiming(null, OPENED, CLOSED)).toBeNull();
	});
});

describe('receiptTxUrl', () => {
	it('opens a Solana signature on Solscan, devnet included', () => {
		expect(receiptTxUrl(SOL_SIG)).toBe(`https://solscan.io/tx/${SOL_SIG}`);
		expect(receiptTxUrl(SOL_SIG, 'devnet')).toBe(`https://solscan.io/tx/${SOL_SIG}?cluster=devnet`);
	});
	it('opens an EVM payment hash on Basescan', () => {
		const hash = `0x${'ab'.repeat(32)}`;
		expect(receiptTxUrl(hash)).toBe(`https://basescan.org/tx/${hash}`);
	});
	it('never links a paper fill or a malformed value', () => {
		expect(receiptTxUrl('SIMULATED')).toBeNull();
		expect(receiptTxUrl('not a signature')).toBeNull();
		expect(receiptTxUrl(null)).toBeNull();
	});
});

describe('triggerLabel', () => {
	it('names every trigger the sniper writes', () => {
		for (const t of ['new_mint', 'oracle_crossing', 'intel_confirmed', 'llm_intel', 'graduation_ride']) {
			expect(triggerLabel(t).detail).toBeTruthy();
		}
	});
	it('defaults a missing trigger to a fresh launch and humanizes an unknown one', () => {
		expect(triggerLabel(null).label).toBe('Fresh launch');
		expect(triggerLabel('whale_follow').label).toBe('whale follow');
	});
});

describe('shapeTradeReceipt', () => {
	it('keeps every leg in time order with its on-chain link', () => {
		const r = shapeTradeReceipt({
			position: position(),
			journal: [
				{ event: 'exit', reason: 'trailing_stop', rationale: 'Full exit: trailing_stop.', sold_fraction: '1', leg_pnl_lamports: '-205262', ts: CLOSED, sig: SOL_SIG },
				{ event: 'entry', reason: 'oracle_crossing', rationale: 'Entered on oracle_crossing.', sold_fraction: '0', ts: at(2), sig: SOL_SIG },
			],
		});
		expect(r.legs.map((l) => l.event)).toEqual(['entry', 'exit']);
		expect(r.legs[1].leg_pnl_sol).toBeCloseTo(-0.000205262, 9);
		expect(r.legs[0].tx_url).toContain('solscan.io/tx/');
		expect(r.position.share_url).toBe('/trade/11111111-2222-3333-4444-555555555555');
		expect(r.evidence_count).toBe(0);
	});

	it('labels a paper fill and gives it no transaction links', () => {
		const r = shapeTradeReceipt({ position: position({ buy_sig: 'SIMULATED', sell_sig: 'SIMULATED' }), journal: [] });
		expect(r.position.paper).toBe(true);
		expect(r.position.buy_url).toBeNull();
		expect(r.summary).toContain('paper-bought');
	});

	it('drops evidence recorded after the exit, since it cannot have caused the trade', () => {
		const r = shapeTradeReceipt({
			position: position(),
			journal: [],
			sentiment: { signal: 'bullish', headline: 'late read', confidence: '0.9', checked_at: at(3600), tx_signature: SOL_SIG },
			judge: { buy: true, confidence: '0.8', thesis: 'after the fact', model: 'm', created_at: at(3600) },
			intel: { quality_score: 91, observation_ended_at: at(3600) },
		});
		expect(r.evidence.sentiment).toBeNull();
		expect(r.evidence.judge).toBeNull();
		expect(r.evidence.intel).toBeNull();
	});

	it('tags a paid read taken while holding as during_trade, with its payment receipt', () => {
		const r = shapeTradeReceipt({
			position: position(),
			journal: [],
			sentiment: { signal: 'bullish', headline: 'h', confidence: '0.93', sentiment_adj: -4, checked_at: at(200), tx_signature: SOL_SIG },
		});
		expect(r.evidence.sentiment.timing).toBe('during_trade');
		expect(r.evidence.sentiment.confidence).toBeCloseTo(0.93);
		expect(r.evidence.sentiment.receipt_url).toContain(SOL_SIG);
	});

	it('only admits an LLM verdict that existed before the entry', () => {
		const before = shapeTradeReceipt({
			position: position(), journal: [],
			judge: { buy: true, confidence: '0.8', thesis: 'two-sided market', model: 'm', created_at: at(-30) },
		});
		expect(before.evidence.judge).toMatchObject({ buy: true, thesis: 'two-sided market' });
		const during = shapeTradeReceipt({
			position: position(), journal: [],
			judge: { buy: true, confidence: '0.8', thesis: 'x', model: 'm', created_at: at(200) },
		});
		expect(during.evidence.judge).toBeNull();
	});

	it('ranks Oracle reasons by how far they moved the base rate, and hides reasons scored after the exit', () => {
		const reasons = [
			{ text: 'near base', pillar: 'momentum', lift: 1.0 },
			{ text: 'strong lift', pillar: 'structure', lift: 2.7 },
			{ text: 'drag', pillar: 'momentum', lift: 0.3 },
		];
		const r = shapeTradeReceipt({
			position: position(), journal: [],
			oracleHistory: { score: 85, tier: 'strong', pedigree: 33, structure: 23, narrative: 11, momentum: 57, scored_at: at(-3) },
			oracleCurrent: { score: 85, reasons, scored_at: at(-3) },
		});
		expect(r.evidence.oracle.score).toBe(85);
		expect(r.evidence.oracle.reasons.map((x) => x.text)).toEqual(['strong lift', 'drag', 'near base']);
		const late = shapeTradeReceipt({
			position: position(), journal: [],
			oracleHistory: { score: 85, scored_at: at(-3) },
			oracleCurrent: { score: 60, reasons, scored_at: at(3600) },
		});
		expect(late.evidence.oracle.score).toBe(85);
		expect(late.evidence.oracle.reasons).toEqual([]);
	});

	it('carries the firewall checks and the Risk Officer review as recorded', () => {
		const r = shapeTradeReceipt({
			position: position(), journal: [],
			firewall: {
				verdict: 'warn', score: 84, reasons: ['concentrated holders'], simulated: true, enforced: false, created_at: at(0.4),
				checks: [{ name: 'round_trip', status: 'pass', reason: 'roundtrip_simulated_ok', detail: {} }, { status: 'pass' }],
			},
			riskReview: { level: 'shadow', veto: false, severity: 'caution', reasons: ['thin book'], proposed_lamports: '2000000', adjusted_lamports: '1000000', created_at: at(0) },
		});
		expect(r.evidence.firewall.checks).toEqual([{ name: 'round_trip', status: 'pass', reason: 'roundtrip_simulated_ok' }]);
		expect(r.evidence.risk_review).toMatchObject({ severity: 'caution', proposed_sol: 0.002, adjusted_sol: 0.001 });
		expect(r.evidence_count).toBe(2);
	});
});

describe('summarizeReceipt', () => {
	it('states the trigger, the drivers it has evidence for, and the result', () => {
		const r = shapeTradeReceipt({
			position: position(), journal: [],
			oracleHistory: { score: 85, tier: 'strong', scored_at: at(-3) },
			firewall: { verdict: 'warn', score: 84, created_at: at(0) },
		});
		expect(r.summary).toBe('Crosshair bought $THREE. Trigger: Oracle crossing. Oracle score 85 strong, firewall warn. Exited on trailing stop at -10.3%.');
	});
	it('says an open position is still open instead of inventing a result', () => {
		const r = shapeTradeReceipt({ position: position({ status: 'open', closed_at: null, exit_reason: null }), journal: [] });
		expect(summarizeReceipt(r)).toBe('Crosshair bought $THREE. Trigger: Oracle crossing. Still open.');
		expect(r.position.share_url).toBeNull();
	});
});

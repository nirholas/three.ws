import { describe, it, expect } from 'vitest';
import { givebackFraction, median, summarizeArm } from '../workers/agent-sniper/experiment-report.js';

describe('givebackFraction', () => {
	it('is the share of peak surrendered', () => {
		expect(givebackFraction({ peak_value_lamports: '2000', exit_quote_lamports: '1500' })).toBeCloseTo(0.25);
	});
	it('is null when peak or exit is missing, or peak is zero', () => {
		expect(givebackFraction({ peak_value_lamports: null, exit_quote_lamports: '1' })).toBeNull();
		expect(givebackFraction({ peak_value_lamports: '0', exit_quote_lamports: '0' })).toBeNull();
	});
	it('never goes negative when exit beat the recorded peak', () => {
		expect(givebackFraction({ peak_value_lamports: '100', exit_quote_lamports: '120' })).toBe(0);
	});
});

describe('median', () => {
	it('handles odd, even and empty', () => {
		expect(median([3, 1, 2])).toBe(2);
		expect(median([1, 2, 3, 4])).toBe(2.5);
		expect(median([null])).toBeNull();
	});
});

describe('summarizeArm', () => {
	const positions = [
		{ exit_reason: 'trailing_stop', realized_pnl_lamports: '-100000000', peak_value_lamports: '1000', exit_quote_lamports: '800' },
		{ exit_reason: 'trailing_stop', realized_pnl_lamports: '-100000000', peak_value_lamports: '1000', exit_quote_lamports: '600' },
		{ exit_reason: 'take_profit', realized_pnl_lamports: '300000000', peak_value_lamports: '1', exit_quote_lamports: '1' },
	];
	it('nets judge cost out of USD P&L', () => {
		const s = summarizeArm({ positions, judgeCostUsd: 2, verdictsPriced: 10, verdictsUnpriced: 5, solUsd: 100 });
		expect(s.pnlSol).toBeCloseTo(0.1);
		expect(s.pnlUsd).toBeCloseTo(10);
		expect(s.netUsd).toBeCloseTo(8);
		expect(s.trailingStops).toBe(2);
		expect(s.medianGiveback).toBeCloseTo(0.3);
	});
	it('has no USD figures without a SOL price', () => {
		expect(summarizeArm({ positions, solUsd: 0 }).netUsd).toBeNull();
	});
});

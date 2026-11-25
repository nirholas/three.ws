// simulateSell caps a paper sell at the SOL actually sitting in the curve. The
// curve payload it reads (pump-fun.getBondingCurve, api/pump-fun-mcp.js) gives
// that as `solReserves` in whole SOL ("12.0000"), but curveReserves() fed it
// straight into the lamport math, so the cap was 12 lamports instead of 12 SOL
// and every paper sell on a live curve returned roughly zero proceeds.
import { describe, it, expect } from 'vitest';
import { simulateBuy, simulateSell } from '../api/_lib/strategy-battle.js';

const CURVE = {
	complete: false,
	graduationPercent: 14.1,
	solReserves: '12.0000',
	tokenReserves: '793100000000000',
	virtualSolReserves: '42000000000',
	virtualTokenReserves: '766428571428571',
};

describe('paper sell on a live curve', () => {
	it('returns close to what the same SOL bought, minus fees', () => {
		const buy = simulateBuy(CURVE, 0.5);
		const sell = simulateSell(CURVE, buy.tokens);
		// Round trip on the same reserves loses only the two fees (1% each here
		// or whatever BATTLE.feeBps is), never the whole position.
		expect(sell.proceedsSol).toBeGreaterThan(0.45);
		expect(sell.proceedsSol).toBeLessThan(0.5);
	});

	it('still caps proceeds at the SOL the curve really holds', () => {
		const thin = { ...CURVE, solReserves: '0.2000' };
		const sell = simulateSell(thin, 50_000_000);
		expect(sell.proceedsSol + sell.feeSol).toBeCloseTo(0.2, 9);
	});
});

import { describe, it, expect } from 'vitest';
import { scoreSentiment } from '../src/social/sentiment.js';

function posts(texts) {
	return texts.map((text, i) => ({ id: String(i), text }));
}

describe('scoreSentiment', () => {
	it('all-positive → score > 0.5', () => {
		const result = scoreSentiment(
			posts([
				'$WIF is going to the moon 🚀 bullish AF',
				'massive gains incoming, this is a gem 💎',
				'lfg! buy the dip, huge breakout coming 📈',
				'rocket ship energy, 100x potential wagmi 🙌',
				'green candles all day, ATH soon 🔥',
			]),
		);
		expect(result.score).toBeGreaterThan(0.5);
		expect(result.posPct).toBeGreaterThan(50);
	});

	it('all-negative → score < -0.5', () => {
		const result = scoreSentiment(
			posts([
				'$WIF is a scam, total rug pull 💀',
				'rekt again, crash incoming 📉',
				'dump everything now, this is fraud 🐻',
				'bearish collapse, avoid at all costs ⚠️',
				'ponzi scheme, everyone will be liquidated',
			]),
		);
		expect(result.score).toBeLessThan(-0.5);
		expect(result.negPct).toBeGreaterThan(50);
	});

	it('mixed → score near 0 (between -0.4 and 0.4)', () => {
		const result = scoreSentiment(
			posts([
				'$WIF to the moon 🚀',
				'this is a rug, scam warning 💀',
				'bullish on the long term',
				'crash incoming, bearish 📉',
				'just a normal day in crypto',
			]),
		);
		expect(result.score).toBeGreaterThan(-0.4);
		expect(result.score).toBeLessThan(0.4);
	});

	it('returns correct shape', () => {
		const result = scoreSentiment(posts(['moon 🚀', 'scam 💀']));
		expect(result).toMatchObject({
			score: expect.any(Number),
			posPct: expect.any(Number),
			negPct: expect.any(Number),
			neuPct: expect.any(Number),
			count: 2,
			examples: {
				pos: expect.any(Array),
				neg: expect.any(Array),
			},
		});
	});

	it('empty input → zero score, 100% neutral', () => {
		const result = scoreSentiment([]);
		expect(result.score).toBe(0);
		expect(result.neuPct).toBe(100);
		expect(result.count).toBe(0);
	});

	it('pct values sum to 100', () => {
		const result = scoreSentiment(posts(['moon', 'crash', 'nothing']));
		expect(result.posPct + result.negPct + result.neuPct).toBeCloseTo(100, 1);
	});
});

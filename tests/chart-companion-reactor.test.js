// The Chart Companion reaction engine: what the avatar does for each real swap.
//
// The contract: sizes are judged against the coin's own tape (so "whale" means
// something on any coin), dollar floors keep a dead tape quiet, streaks and new
// highs fire once per occurrence, and every line carries the real number that
// caused it.

import { describe, it, expect } from 'vitest';
import {
	createReactor,
	fmtUsd,
	fmtPrice,
	fmtPct,
	tradePrice,
	REACTION_KINDS,
	WHALE_FLOOR_USD,
	BIG_FLOOR_USD,
	QUIET_MS,
	STREAK,
} from '../src/chart-companion/reactor.js';

let seq = 0;
const trade = (usd, isBuy = true, price = 0.0005) => ({
	signature: `sig${++seq}`,
	is_buy: isBuy,
	sol_value_usd: usd,
	token_amount: usd / price,
	timestamp: 1_800_000_000 + seq,
});

function clock(start = 1_000_000) {
	let t = start;
	return { now: () => t, advance: (ms) => { t += ms; } };
}

describe('formatting', () => {
	it('formats dollars compactly', () => {
		expect(fmtUsd(430)).toBe('$430');
		expect(fmtUsd(1234)).toBe('$1.2K');
		expect(fmtUsd(45_000)).toBe('$45K');
		expect(fmtUsd(3_400_000)).toBe('$3.4M');
	});

	it('keeps significant digits on sub-cent prices', () => {
		expect(fmtPrice(0.000465)).toBe('$0.000465');
		expect(fmtPrice(2.5)).toBe('$2.50');
		expect(fmtPrice(0)).toBe('');
	});

	it('signs percentages', () => {
		expect(fmtPct(12.44)).toBe('+12%');
		expect(fmtPct(-3.14)).toBe('-3.1%');
	});

	it('derives a per-token price from a swap, or nothing', () => {
		expect(tradePrice({ sol_value_usd: 100, token_amount: 200_000 })).toBeCloseTo(0.0005);
		expect(tradePrice({ sol_value_usd: 100, token_amount: 0 })).toBeNull();
	});
});

describe('size reactions', () => {
	it('calls a whale only above the floor when the tape is too thin for a median', () => {
		const r = createReactor({ symbol: 'three' });
		expect(r.ingestTrades([trade(WHALE_FLOOR_USD - 1)])[0].kind).toBe('bigBuy');
		const [whale] = r.ingestTrades([trade(WHALE_FLOOR_USD + 500)]);
		expect(whale.kind).toBe('whaleBuy');
		expect(whale.line).toContain('$1.5K');
		expect(whale.line).toContain('$THREE');
		expect(whale.clip).toBe(REACTION_KINDS.whaleBuy.clip);
	});

	it('judges size against the coin\'s own tape once it has a sample', () => {
		const r = createReactor({ symbol: 'big' });
		// A coin whose median swap is $2,000: a $1,500 buy is ordinary.
		r.prime(Array.from({ length: 20 }, () => trade(2000)));
		expect(r.ingestTrades([trade(1500)])).toEqual([]);
		// 8x the median is a whale.
		expect(r.ingestTrades([trade(16_500)])[0].kind).toBe('whaleBuy');
	});

	it('keeps a dead tape of tiny trades silent', () => {
		const r = createReactor();
		r.prime(Array.from({ length: 20 }, () => trade(2)));
		expect(r.ingestTrades([trade(BIG_FLOOR_USD - 1)])).toEqual([]);
	});

	it('reacts to big sells with a sell reaction', () => {
		const r = createReactor();
		const [x] = r.ingestTrades([trade(400, false)]);
		expect(x.kind).toBe('bigSell');
		expect(x.emotion[0]).toBe('concern');
	});

	it('rotates lines so the same kind does not repeat back to back', () => {
		const r = createReactor({ symbol: 'x' });
		const a = r.ingestTrades([trade(300, true)])[0].line;
		const b = r.ingestTrades([trade(300, true)])[0].line;
		expect(a).not.toBe(b);
	});
});

describe('streaks and highs', () => {
	it('fires a buy streak once per streak', () => {
		const r = createReactor();
		const out = r.ingestTrades(Array.from({ length: STREAK + 3 }, () => trade(10)));
		expect(out.filter((x) => x.kind === 'buyStreak')).toHaveLength(1);
		// A sell breaks it; a fresh streak can fire again.
		r.ingestTrades([trade(10, false)]);
		const again = r.ingestTrades(Array.from({ length: STREAK }, () => trade(10)));
		expect(again.map((x) => x.kind)).toContain('buyStreak');
	});

	it('marks a buy above the 24h candle high as a new high, with the price', () => {
		const c = clock();
		const r = createReactor({ symbol: 'three', now: c.now });
		r.ingestCandles([{ o: 0.0004, h: 0.0005, l: 0.0004, c: 0.00045 }]);
		const out = r.ingestTrades([trade(20, true, 0.00055)]);
		const high = out.find((x) => x.kind === 'newHigh');
		expect(high.line).toContain('$0.000550');
		// Within the cooldown a higher print does not fire again.
		expect(r.ingestTrades([trade(20, true, 0.0006)]).find((x) => x.kind === 'newHigh')).toBeUndefined();
	});

	it('orders a frame\'s reactions by priority', () => {
		const r = createReactor();
		r.ingestCandles([{ o: 0.0004, h: 0.0005, l: 0.0004, c: 0.00045 }]);
		const out = r.ingestTrades([trade(5000, true, 0.0009)]);
		expect(out.map((x) => x.kind)).toEqual(['whaleBuy', 'newHigh']);
	});
});

describe('stats, greeting and quiet', () => {
	it('tallies the session', () => {
		const r = createReactor();
		r.ingestTrades([trade(100), trade(50, false), trade(900)]);
		expect(r.stats.buys).toBe(2);
		expect(r.stats.sells).toBe(1);
		expect(r.stats.buyUsd).toBe(1000);
		expect(r.stats.biggest.sol_value_usd).toBe(900);
	});

	it('greets with the real 24h change when candles are in', () => {
		const r = createReactor({ symbol: 'three' });
		r.ingestCandles([{ o: 0.0004, h: 0.0005, l: 0.0004, c: 0.0005 }]);
		expect(r.greeting().line).toContain('+25%');
		expect(createReactor({ symbol: 'x' }).greeting().line).toContain('Watching $X live');
	});

	it('says one quiet line per quiet stretch', () => {
		const c = clock();
		const r = createReactor({ now: c.now });
		expect(r.tick()).toBeNull();
		c.advance(QUIET_MS + 1);
		expect(r.tick().kind).toBe('quiet');
		c.advance(QUIET_MS + 1);
		expect(r.tick()).toBeNull();
		r.ingestTrades([trade(10)]);
		c.advance(QUIET_MS + 1);
		expect(r.tick().kind).toBe('quiet');
	});
});

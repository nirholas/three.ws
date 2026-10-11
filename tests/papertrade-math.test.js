// Papertrade position math (api/_lib/papertrade/math.js). The bust cases are
// real positions read from the exchange's wallet stream: the contract stored
// these bust prices, and the formula must reproduce them to the raw unit.

import { describe, it, expect } from 'vitest';

import {
	WAD, usdToRaw, rawToUsd, priceToRaw, rawToPrice, decodeInstrument, decodePosition, midRaw, bustPriceRaw,
	valuePosition, payoutPnlRaw, isBust, riskPercent, openCapacity,
} from '../api/_lib/papertrade/math.js';

// The live BTC and ETH instrument tuples from GET /state/trading (schemaVersion 1).
const BTC = decodeInstrument([0, 'BTC', 0, '10', true, false, false, false, false, null, null, null,
	'15000000000000000000000', '814598000000000000000', 1000, '10000000000000000000000000', '476041580087574',
	'100000000000000000', '100000000000000000000000', '23590192866625362236353', '18109832138345653207981',
	'1207459685939735687074747', '1207459685939735687074747']);
const ETH = decodeInstrument([1, 'ETH', 1, '100', true, false, false, false, false, null, null, null,
	'15000000000000000000000', '483979000000000000000', 1000, '10000000000000000000000000', '481304050180130',
	'100000000000000000', '100000000000000000000000', '801888041618533102629272', '687966580469056106171688',
	'40032826918072819712163974', '40032826918072819712163974']);

const long = (entry, marginUsd, lev, inst) => ({
	isLong: true, entryPriceRaw: BigInt(entry), marginRaw: usdToRaw(marginUsd), leverage: lev,
	bustPriceRaw: bustPriceRaw(entry, lev, true, inst.bustBufferRaw),
});
const short = (entry, marginUsd, lev, inst) => ({
	isLong: false, entryPriceRaw: BigInt(entry), marginRaw: usdToRaw(marginUsd), leverage: lev,
	bustPriceRaw: bustPriceRaw(entry, lev, false, inst.bustBufferRaw),
});

describe('papertrade scale conversion', () => {
	it('round-trips USD and prices at contract scale', () => {
		expect(usdToRaw(10)).toBe(10n * WAD);
		expect(rawToUsd(-25n * WAD / 10n)).toBe(-2.5);
		expect(priceToRaw(83065.5, BTC.priceScaleRaw)).toBe(830655n);
		expect(rawToPrice(251215n, ETH.priceScaleRaw)).toBe(2512.15);
		expect(midRaw(830650n, 830661n)).toBe(830655n);
	});

	it('decodes instrument and position tuples in wire order', () => {
		expect(BTC).toMatchObject({ id: 0, symbol: 'BTC', maxLeverage: 1000, openable: true, priceScaleRaw: 10n });
		const p = decodePosition(['53573', 1, true, false, '251215', '250000000000000000000', 50, '246309', 1791662616000, null]);
		expect(p).toMatchObject({ id: '53573', instrumentId: 1, isLong: true, leverage: 50, entryPriceRaw: 251215n, bustPriceRaw: 246309n });
		expect(() => decodeInstrument([0, 'BTC'])).toThrow(TypeError);
	});
});

describe('papertrade bust price', () => {
	it('reproduces the bust the contract stored for live positions', () => {
		expect(bustPriceRaw(830465n, 1000, false, BTC.bustBufferRaw)).toBe(830900n);
		expect(bustPriceRaw(251215n, 50, true, ETH.bustBufferRaw)).toBe(246309n);
	});

	it('busts a $100 long at 100x about 0.95% below entry, as documented', () => {
		const p = long(1_000_000n, 1, 100, BTC);
		expect(rawToPrice(p.bustPriceRaw, BTC.priceScaleRaw)).toBeCloseTo(99_047.1, 1);
		expect(isBust(p, p.bustPriceRaw)).toBe(true);
		expect(isBust(p, p.bustPriceRaw + 1n)).toBe(false);
	});
});

describe('papertrade position valuation', () => {
	it('pays nothing for a move inside the 0.2 bps deadband', () => {
		const p = long(1_000_000n, 100, 100, BTC);
		expect(valuePosition(p, 1_000_020n, BTC).adjustedPnlRaw).toBe(0n);
		expect(valuePosition(p, 1_000_000n, BTC).rawPnlRaw).toBe(0n);
	});

	it('floors a loss at the full margin', () => {
		const p = short(1_000_000n, 100, 100, BTC);
		const v = valuePosition(p, 2_000_000n, BTC);
		expect(v.rawPnlRaw).toBeLessThan(-usdToRaw(100));
		expect(v.adjustedPnlRaw).toBe(-usdToRaw(100));
	});

	it('keeps a small share of a small win and most of a large one', () => {
		const p = long(1_000_000n, 100, 100, BTC);
		const keep = (exit) => {
			const v = valuePosition(p, exit, BTC);
			return Number(v.adjustedPnlRaw * 10_000n / v.rawPnlRaw) / 100;
		};
		const small = keep(1_000_100n); // +0.01%
		const large = keep(1_050_000n); // +5%
		expect(small).toBeGreaterThan(0);
		expect(small).toBeLessThan(40);
		expect(large).toBeGreaterThan(85);
		expect(large).toBeLessThan(90); // never above 1 - baseRate
	});

	it('takes the win fee from gains only', () => {
		expect(payoutPnlRaw(100n * WAD, 2n * 10n ** 16n)).toBe(98n * WAD);
		expect(payoutPnlRaw(-5n * WAD, 2n * 10n ** 16n)).toBe(-5n * WAD);
	});

	it('reports risk as the share of the way from entry to bust', () => {
		const p = long(1_000_000n, 100, 100, BTC);
		const half = (p.entryPriceRaw + p.bustPriceRaw) / 2n;
		expect(riskPercent(p, 1_010_000n)).toBe(0);
		expect(riskPercent(p, half)).toBeCloseTo(50, 0);
		expect(riskPercent(p, p.bustPriceRaw - 5n)).toBe(100);
	});
});

describe('papertrade open capacity', () => {
	it('caps margin by the per-position notional at the chosen leverage', () => {
		const cap = openCapacity({ instrument: BTC, isLong: true, leverage: 100, markRaw: 830655n });
		expect(cap.maxMarginRaw).toBe(100_000n * WAD);
		expect(cap.limitedBy).toBe('max_position_notional');
	});

	it('refuses leverage above the market maximum', () => {
		const cap = openCapacity({ instrument: BTC, isLong: false, leverage: 2000, markRaw: 830655n });
		expect(cap).toMatchObject({ maxMarginRaw: 0n, limitedBy: 'leverage_above_market_max' });
	});

	it('binds on open-interest headroom once the side is nearly full', () => {
		const full = { ...BTC, longOiRaw: BTC.longCapRaw - 10n ** 18n };
		const cap = openCapacity({ instrument: full, isLong: true, leverage: 10, markRaw: 830655n });
		expect(cap.limitedBy).toBe('long_open_interest_cap');
		expect(rawToUsd(cap.headroomRaw)).toBeCloseTo(83_065.5, 0);
		expect(rawToUsd(cap.maxMarginRaw)).toBeCloseTo(8_306.55, 1);
	});
});

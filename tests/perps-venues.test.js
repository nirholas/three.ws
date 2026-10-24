// Perps venues beyond the default: the Jupiter and Hyperliquid modules, the
// guards every venue is held to, the Hyperliquid signing scheme, venue health
// failover and the per-agent MCP permission. No network and no wallet: venue
// payloads are the shapes the live APIs returned on 2026-10-23, and the service
// is mocked only at the database edge.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Wallet, verifyTypedData } from 'ethers';
import { encode as refEncode } from '@msgpack/msgpack';

const { venueContractProblems, getVenue, listVenues, listVenueModules } = await import('../api/_lib/perps/index.js');
const { checkPerpsOrder, normalizePerpsLimits, loosenedPerpsKeys, PERPS_LIMIT_DEFAULTS } = await import('../api/_lib/perps/limits.js');
const jupiter = await import('../api/_lib/perps/jupiter.js');
const hl = await import('../api/_lib/perps/hyperliquid.js');
const signing = await import('../api/_lib/perps/hyperliquid-signing.js');
const health = await import('../api/_lib/perps/venue-health.js');
const { perpsError } = await import('../api/_lib/perps/errors.js');

function quote(over = {}) {
	return {
		risk_increasing: true,
		account_leverage_after: 1.5,
		market_max_leverage: 20,
		position_after: { notional_usd: 100 },
		free_collateral_after_usd: 50,
		liquidation_distance_pct: 40,
		slippage_bps: 50,
		...over,
	};
}
const limits = (over = {}) => normalizePerpsLimits({ max_leverage: 2, max_margin_per_position_usd: 1000, live_enabled: true, ...over });
const blockedId = (q, l = limits()) => checkPerpsOrder({ limits: l, quote: q, mode: 'live' }).blocked?.id ?? null;

describe('venue contract', () => {
	it('registers phoenix, jupiter and hyperliquid, all conforming', () => {
		expect(listVenues().map((v) => v.id).sort()).toEqual(['hyperliquid', 'jupiter', 'phoenix']);
		for (const v of listVenueModules()) expect(venueContractProblems(v)).toEqual([]);
	});
	it('reports a venue that drops a member', () => {
		const { ping: _p, ...broken } = jupiter;
		expect(venueContractProblems(broken)).toContain('ping: expected function, got undefined');
	});
	it('puts Solana venues on solana and Hyperliquid on its own chain', () => {
		expect(getVenue('phoenix').chain).toBe('solana');
		expect(getVenue('jupiter').chain).toBe('solana');
		expect(getVenue('hyperliquid').chain).toBe('hyperliquid');
		expect(getVenue('hyperliquid').execution).toBe('api_wallet');
	});
});

describe('guards', () => {
	it('refuses an open above the leverage cap with the leverage check', () => {
		expect(blockedId(quote({ account_leverage_after: 3 }))).toBe('leverage');
		expect(blockedId(quote({ account_leverage_after: 2 }))).toBe(null);
	});
	it('refuses a position over the max notional', () => {
		const l = limits({ max_notional_usd: 200 });
		expect(blockedId(quote({ position_after: { notional_usd: 250 } }), l)).toBe('max_notional');
		expect(blockedId(quote({ position_after: { notional_usd: 200 } }), l)).toBe(null);
	});
	it('refuses an open whose liquidation sits inside the floor', () => {
		expect(blockedId(quote({ liquidation_distance_pct: 4 }))).toBe('liquidation_distance');
		expect(blockedId(quote({ liquidation_distance_pct: 10 }))).toBe(null);
		expect(blockedId(quote({ liquidation_distance_pct: null }))).toBe(null);
	});
	it('never blocks a reduction on notional or liquidation distance', () => {
		const q = quote({ risk_increasing: false, position_after: { notional_usd: 9999 }, liquidation_distance_pct: 1 });
		expect(blockedId(q)).toBe(null);
	});
	it('ships conservative defaults and keeps MCP off', () => {
		expect(PERPS_LIMIT_DEFAULTS.max_notional_usd).toBe(500);
		expect(PERPS_LIMIT_DEFAULTS.min_liquidation_distance_pct).toBe(10);
		expect(normalizePerpsLimits({}).mcp_enabled).toBe(false);
	});
	it('treats the new loosenings as owner-only', () => {
		const prev = { max_notional_usd: 100, min_liquidation_distance_pct: 20, mcp_enabled: false };
		expect(loosenedPerpsKeys(prev, { max_notional_usd: 500 })).toContain('max_notional_usd');
		expect(loosenedPerpsKeys(prev, { min_liquidation_distance_pct: 5 })).toContain('min_liquidation_distance_pct');
		expect(loosenedPerpsKeys(prev, { mcp_enabled: true })).toContain('mcp_enabled');
		expect(loosenedPerpsKeys(prev, { max_notional_usd: 50, min_liquidation_distance_pct: 30 })).toEqual([]);
	});
});

describe('jupiter venue', () => {
	it('builds longs on the market token and shorts on USDC', () => {
		const long = jupiter.increaseBody({ wallet: 'W', symbol: 'SOL', side: 'long', notionalUsd: 100, leverage: 2, markPrice: 100, slippageBps: 100 });
		expect(long.collateralMint).toBe(jupiter.MARKETS.SOL.mint);
		expect(long.collateralTokenDelta).toBe(String(Math.ceil(0.5 * 1e9)));
		expect(long.leverage).toBe('2.0');
		const short = jupiter.increaseBody({ wallet: 'W', symbol: 'SOL', side: 'short', notionalUsd: 100, leverage: 2, markPrice: 100, slippageBps: 100 });
		expect(short.collateralTokenDelta).toBe('50000000');
		expect(short.collateralMint).not.toBe(jupiter.MARKETS.SOL.mint);
	});
	it('refuses what the venue cannot do before anything is signed', () => {
		expect(() => jupiter.buildDeposit()).toThrow(/does not support/);
		expect(() => jupiter.buildConditional()).toThrow(/does not support/);
		expect(jupiter.capabilities.order_types).toEqual(['market']);
		expect(jupiter.normalizeSymbol('btc-perp')).toBe('BTC');
	});
	it('normalizes positions from the raw 6-decimal API rows', () => {
		const acct = jupiter.normalizeAccount('W', []);
		expect(acct.positions).toEqual([]);
		expect(acct.authority).toBe('W');
	});
});

describe('hyperliquid venue', () => {
	const payload = [
		{ universe: [{ name: 'BTC', szDecimals: 5, maxLeverage: 40 }, { name: 'DEAD', szDecimals: 1, maxLeverage: 3, isDelisted: true }] },
		[
			{ markPx: '80000', oraclePx: '80010', prevDayPx: '78000', funding: '0.0000125', openInterest: '1000', dayNtlVlm: '5000000' },
			{ markPx: '1', funding: '0', openInterest: '1', dayNtlVlm: '1' },
		],
	];
	it('normalizes meta and contexts into markets', () => {
		const [btc, dead] = hl.normalizeMarkets(payload);
		expect(btc).toMatchObject({ symbol: 'BTC', max_leverage: 40, size_decimals: 5, asset_index: 0, funding_interval_seconds: 3600 });
		expect(btc.maintenance_margin_rate).toBeCloseTo(1 / 80, 8);
		expect(btc.funding_rate_hourly_pct).toBeCloseTo(0.00125, 8);
		expect(btc.open_interest_usd).toBe(80_000_000);
		expect(dead.status).toBe('delisted');
	});
	it('reads an l2Book into sorted levels', () => {
		const book = hl.normalizeL2({ levels: [[{ px: '99', sz: '2', n: 1 }, { px: '98', sz: '1', n: 1 }], [{ px: '101', sz: '3', n: 1 }]] });
		expect(book.best_bid).toBe(99);
		expect(book.best_ask).toBe(101);
	});
	it('computes the documented liquidation price', () => {
		const long = hl.liquidationPrice({ price: 100, signedSize: 1, equity: 20, maintenanceTotal: 1, mmr: 0.025 });
		expect(long).toBeCloseTo(100 - 19 / (1 - 0.025), 6);
		const short = hl.liquidationPrice({ price: 100, signedSize: -1, equity: 20, maintenanceTotal: 1, mmr: 0.025 });
		expect(short).toBeCloseTo(100 + 19 / (1 + 0.025), 6);
		expect(hl.liquidationPrice({ price: 100, signedSize: 1, equity: 500, maintenanceTotal: 1, mmr: 0.025 })).toBe(null);
	});
	it('normalizes a clearinghouse state with a short and a resting order', () => {
		const state = {
			marginSummary: { accountValue: '1000', totalNtlPos: '800', totalMarginUsed: '40', totalRawUsd: '1100' },
			crossMaintenanceMarginUsed: '10',
			withdrawable: '900',
			assetPositions: [{ position: { coin: 'BTC', szi: '-0.01', entryPx: '80000', positionValue: '800', unrealizedPnl: '-5', marginUsed: '40', liquidationPx: '120000', leverage: { type: 'cross', value: 20 }, cumFunding: { sinceOpen: '0.5' } } }],
		};
		const acct = hl.normalizeAccount('0xabc', state, [{ oid: 7, coin: 'BTC', side: 'B', limitPx: '70000', sz: '0.01', isTrigger: false, reduceOnly: false }], new Map([['BTC', 80000]]));
		expect(acct.positions[0]).toMatchObject({ symbol: 'BTC', side: 'short', size: 0.01, liquidation_price: 120000 });
		expect(acct.positions[0].liquidation_distance_pct).toBe(50);
		expect(acct.orders[0]).toMatchObject({ id: '7', side: 'buy', price: 70000 });
		expect(acct.equity_usd).toBe(1000);
		expect(acct.withdrawable_usd).toBe(900);
	});
	it('builds an order action with the signed key order', () => {
		const action = hl.buildOrderAction({ side: 'long', type: 'market', limit_price: 80800, size_text: '0.01', reduce_only: false, venue_params: { asset_index: 0, sz_decimals: 5 } });
		expect(Object.keys(action.orders[0])).toEqual(['a', 'b', 'p', 's', 'r', 't']);
		expect(action.orders[0]).toMatchObject({ a: 0, b: true, s: '0.01', r: false, t: { limit: { tif: 'Ioc' } } });
		expect(action.grouping).toBe('na');
		expect(hl.buildCancelAction({ assetIndex: 3, orderId: '12' })).toEqual({ type: 'cancel', cancels: [{ a: 3, o: 12 }] });
	});
	it('reads fills, resting orders and refusals from the exchange answer', () => {
		const ok = (st) => ({ status: 'ok', response: { type: 'order', data: { statuses: [st] } } });
		expect(hl.parseOrderResponse(ok({ filled: { oid: 5, totalSz: '0.01', avgPx: '80001' } }))).toMatchObject({ state: 'filled', order_id: '5', avg_price: 80001 });
		expect(hl.parseOrderResponse(ok({ resting: { oid: 6 } }))).toMatchObject({ state: 'resting', order_id: '6' });
		expect(() => hl.parseOrderResponse(ok({ error: 'Insufficient margin' }))).toThrow(/Insufficient margin/);
		expect(() => hl.parseOrderResponse({ status: 'err', response: 'User or API Wallet does not exist.' })).toThrow(/does not exist/);
	});
	it('says plainly what Hyperliquid through three.ws cannot do', () => {
		expect(() => hl.buildWithdraw()).toThrow(/cannot move funds/);
		expect(() => hl.buildConditional()).toThrow(/take-profit/);
		expect(() => hl.accountRef({ meta: {} })).toThrow(/no Hyperliquid account linked/);
		expect(hl.accountRef({ meta: { hyperliquid: { account: '0xabc' } } })).toBe('0xabc');
	});
});

describe('hyperliquid signing', () => {
	it('encodes msgpack byte-identically to the reference encoder', () => {
		const action = { type: 'order', orders: [{ a: 0, b: true, p: '80800', s: '0.01', r: false, t: { limit: { tif: 'Ioc' } } }], grouping: 'na' };
		expect(Buffer.from(signing.msgpackEncode(action))).toEqual(Buffer.from(refEncode(action)));
		const big = { a: 70000, b: 300, c: 'x'.repeat(40), d: [null, false, 255, 65536] };
		expect(Buffer.from(signing.msgpackEncode(big))).toEqual(Buffer.from(refEncode(big)));
	});
	it('signs an Agent payload that recovers to the API wallet', async () => {
		const wallet = Wallet.createRandom();
		const action = { type: 'cancel', cancels: [{ a: 1, o: 99 }] };
		const nonce = 1_700_000_000_000;
		const sig = await signing.signL1Action({ privateKey: wallet.privateKey, action, nonce, isMainnet: true });
		const joined = `${sig.r}${sig.s.slice(2)}${sig.v.toString(16)}`;
		const recovered = verifyTypedData(
			{ name: 'Exchange', version: '1', chainId: 1337, verifyingContract: '0x0000000000000000000000000000000000000000' },
			{ Agent: [{ name: 'source', type: 'string' }, { name: 'connectionId', type: 'bytes32' }] },
			{ source: 'a', connectionId: signing.actionHash(action, nonce, null) },
			joined,
		);
		expect(recovered).toBe(wallet.address);
	});
	it('rounds prices to five significant figures and sizes to the market decimals', () => {
		expect(signing.formatPrice(80812.3456, 5)).toBe('80812');
		expect(signing.formatSize(0.012349, 4)).toBe('0.0123');
	});
});

describe('venue health failover', () => {
	beforeEach(async () => {
		for (const v of listVenueModules()) await health.markVenueHealthy(v.id);
	});
	const outage = () => perpsError(502, 'venue_unavailable', 'down');
	it('fails an unpinned read over to the next venue and says so', async () => {
		const out = await health.readWithFailover(null, async (v) => {
			if (v.id === 'phoenix') throw outage();
			return v.id;
		});
		expect(out.failed_over_from).toBe('phoenix');
		expect(out.venue.id).not.toBe('phoenix');
		expect(out.result).toBe(out.venue.id);
	});
	it('skips a cooling venue without calling it', async () => {
		await health.markVenueUnhealthy('phoenix');
		const seen = [];
		await health.readWithFailover(null, async (v) => {
			seen.push(v.id);
			return 1;
		});
		expect(seen).not.toContain('phoenix');
	});
	it('never reroutes a pinned read', async () => {
		await expect(health.readWithFailover('phoenix', async () => { throw outage(); })).rejects.toMatchObject({ code: 'venue_unavailable' });
	});
	it('does not fail over on a caller error', async () => {
		let calls = 0;
		await expect(health.readWithFailover(null, async () => { calls += 1; throw perpsError(404, 'unknown_market', 'no'); })).rejects.toMatchObject({ code: 'unknown_market' });
		expect(calls).toBe(1);
	});
	it('classifies outages', () => {
		expect(health.isVenueOutage(outage())).toBe(true);
		expect(health.isVenueOutage(perpsError(400, 'bad', 'x'))).toBe(false);
	});
});

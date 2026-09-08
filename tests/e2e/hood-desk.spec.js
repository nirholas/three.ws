// /markets/robinhood/desk - the Hood Desk.
//
// The desk composes two reads (/api/v1/robinhood/desk for the market side,
// /api/v1/robinhood/wallet for a book) and renders seven panels off them. Both
// are stubbed here with payloads shaped exactly like the live responses,
// because the assertions are about what the page DOES with a payload, and a
// spec that depended on one live wallet's balances would fail every time that
// wallet traded. The upstream shapes themselves are pinned separately by
// tests/robinhood-desk.test.js against the real field names.
//
// What this locks down, all of it found by hand first:
//   • every panel has a designed empty state before a wallet is loaded, with a
//     way forward, not a blank card
//   • a bad address is refused with a readable message instead of a dead form
//   • an unpriced token is shown as unpriced and never counted into the book
//   • a dusted wallet's 200-token ladder collapses to the deepest twelve, and
//     the count never lies about what is there
//   • the trade ticket opens the swap panel for a coin and the eligibility
//     gate (never a swap) for a Stock Token

import { test, expect } from '@playwright/test';
import { collectPageErrors, installEvmWallet } from './_support.js';

const LOAD = { waitUntil: 'domcontentloaded', timeout: 120_000 };
const ADDRESS = '0x1111111111111111111111111111111111111111';
const COIN = '0xaaaa000000000000000000000000000000000001';
const STOCK = '0xbbbb000000000000000000000000000000000002';

const BINS = 9;
const bins = Array.from({ length: BINS }, (_, i) => {
	const from = -2 + i * (4 / BINS);
	return { from, to: from + 4 / BINS, center: from + 2 / BINS };
});

function deskPayload() {
	return {
		data: {
			chain: {
				name: 'Robinhood Chain',
				chainId: 4663,
				blockHeight: 57_138_464,
				averageBlockTimeMs: 101,
				totalTransactions: '643348295',
				gas: { slow: 0.27, average: 0.32, fast: 0.64, unit: 'gwei' },
				ethPriceUsd: 2494.79,
				tvlUsd: 908_173_602,
				explorer: 'https://robinhoodchain.blockscout.com',
			},
			ridge: {
				bins,
				layers: Array.from({ length: 4 }, (_, layer) => ({
					minLiquidityUsd: layer * 250_000,
					count: 8 - layer * 2,
					density: bins.map((_, i) => (i === 4 || i === 5 ? 4 - layer : i === 6 ? 1 : 0)),
				})),
				symbols: bins.map((_, i) => (i === 4 ? ['MU', 'AMD'] : [])),
				stats: { priced: 8, total: 95, min: -0.33, max: 1.7, median: 0.69, p10: 0.12, p90: 1.6, spanPct: 2 },
			},
			arb: [
				{
					symbol: 'MU',
					name: 'Micron Technology',
					address: STOCK,
					premiumPct: 1.7,
					navPriceUsd: 1014.79,
					dexPriceUsd: 1032.05,
					liquidityUsd: 1_632_162,
					volume24hUsd: 1_381_494,
					side: 'dex-rich',
				},
			],
			movers: [
				{
					id: 'test-mover',
					symbol: 'MOVER',
					name: 'Mover',
					image: null,
					priceUsd: 0.004138,
					marketCapUsd: 4_096_877,
					volume24hUsd: 4_124_066,
					change24hPct: 303.74,
					sparkline7d: [0.001, 0.002, 0.0015, 0.004],
				},
			],
			launches: [],
			stockCount: 95,
			disclosure: 'Stock Tokens are tokenized debt securities.',
			source: 'test',
			asOf: new Date().toISOString(),
		},
	};
}

// 14 positions: two that carry the book, one deliberately unpriced, and eleven
// dust rows so the ladder has something to collapse.
function positions() {
	const rows = [
		{
			address: COIN,
			symbol: 'MEME',
			name: 'Meme',
			icon: null,
			decimals: 18,
			rawBalance: '5000000000000000000',
			amount: 5,
			kind: 'coin',
			priceUsd: 2,
			priceSource: 'dex',
			navPriceUsd: null,
			dexPriceUsd: 2,
			change24hPct: 78.55,
			liquidityUsd: 86_804,
			valueUsd: 10,
			pairUrl: 'https://dexscreener.com/robinhood/0xpair',
			holders: 306_239,
			sharePct: 25,
		},
		{
			address: STOCK,
			symbol: 'MU',
			name: 'Micron Technology',
			icon: null,
			decimals: 18,
			rawBalance: '1000000000000000000',
			amount: 1,
			kind: 'stock',
			priceUsd: 1014.79,
			priceSource: 'chainlink-nav',
			navPriceUsd: 1014.79,
			dexPriceUsd: 1032.05,
			change24hPct: -1.2,
			liquidityUsd: 1_632_162,
			valueUsd: 1014.79,
			pairUrl: null,
			holders: 12,
			sharePct: 70,
		},
		{
			address: '0xcccc000000000000000000000000000000000003',
			symbol: 'NOPRICE',
			name: 'No pool yet',
			icon: null,
			decimals: 18,
			rawBalance: '908330000000000000000000',
			amount: 908_330,
			kind: 'coin',
			priceUsd: null,
			priceSource: null,
			navPriceUsd: null,
			dexPriceUsd: null,
			change24hPct: null,
			liquidityUsd: null,
			valueUsd: null,
			pairUrl: null,
			holders: 3,
			sharePct: null,
		},
	];
	for (let i = 0; i < 11; i++) {
		rows.push({
			address: `0xdddd00000000000000000000000000000000${String(i).padStart(4, '0')}`,
			symbol: `DUST${i}`,
			name: `Dust ${i}`,
			icon: null,
			decimals: 18,
			rawBalance: '1000000000000000000',
			amount: 1,
			kind: 'coin',
			priceUsd: 0.0001,
			priceSource: 'dex',
			navPriceUsd: null,
			dexPriceUsd: 0.0001,
			change24hPct: 0.5,
			liquidityUsd: 10,
			valueUsd: 0.0001,
			pairUrl: null,
			holders: 2,
			sharePct: 0.00001,
		});
	}
	return rows;
}

function walletPayload(address = ADDRESS) {
	const now = Date.now();
	const series = Array.from({ length: 6 }, (_, i) => ({
		t: now - (5 - i) * 600_000,
		eth: 0.05 + i * 0.01,
		usd: (0.05 + i * 0.01) * 2494.79,
		block: 57_138_000 + i,
	}));
	return {
		data: {
			address,
			native: { symbol: 'ETH', balance: 0.1, balanceWei: '100000000000000000', valueUsd: 249.47 },
			book: {
				// native + MEME + MU. The unpriced token is deliberately absent from
				// the total; the desk must not invent a value for it.
				valueUsd: 249.47 + 10 + 1014.79,
				nativeUsd: 249.47,
				tokensUsd: 1024.79,
				nativeSharePct: 19.6,
				positionCount: 220,
				pricedCount: 13,
			},
			positions: positions(),
			positionsTruncated: true,
			history: {
				series,
				intraday: series,
				daily: [],
				change: { startEth: 0.05, endEth: 0.1, deltaEth: 0.05, pct: 100, fromT: series[0].t, toT: series[5].t },
				sessionChange: { startEth: 0.05, endEth: 0.1, deltaEth: 0.05, pct: 100, fromT: series[0].t, toT: series[5].t },
				usdBasis: { ethPriceUsd: 2494.79, mode: 'current-price' },
			},
			activity: [
				{
					hash: '0xswap',
					timestamp: new Date(now - 60_000).toISOString(),
					kind: 'swap',
					method: 'swapExactETHForTokens',
					direction: 'out',
					counterparty: '0x2222222222222222222222222222222222222222',
					counterpartyName: null,
					valueEth: 0.05,
					feeEth: 0.00002,
					status: 'ok',
					block: 57_138_005,
					tokens: [{ symbol: 'MEME', address: COIN, amount: 27, direction: 'in' }],
				},
				{
					hash: '0xrecv',
					timestamp: new Date(now - 900_000).toISOString(),
					kind: 'receive',
					method: 'transfer',
					direction: 'in',
					counterparty: '0x3333333333333333333333333333333333333333',
					counterpartyName: null,
					valueEth: 0.02,
					feeEth: null,
					status: 'ok',
					block: 57_138_001,
					tokens: [],
				},
			],
			counterparties: [
				{ address: '0x2222222222222222222222222222222222222222', name: null, inCount: 0, outCount: 12, kinds: { swap: 12 }, total: 12 },
				{ address: '0x3333333333333333333333333333333333333333', name: null, inCount: 3, outCount: 0, kinds: { receive: 3 }, total: 3 },
			],
			ethPriceUsd: 2494.79,
			source: 'test',
			asOf: new Date().toISOString(),
		},
	};
}

async function stubDesk(page, { wallet = true } = {}) {
	await page.route('**/api/v1/robinhood/desk*', (route) =>
		route.fulfill({ contentType: 'application/json', body: JSON.stringify(deskPayload()) }),
	);
	if (!wallet) return;
	await page.route('**/api/v1/robinhood/wallet*', (route) => {
		const address = new URL(route.request().url()).searchParams.get('address') || ADDRESS;
		return route.fulfill({ contentType: 'application/json', body: JSON.stringify(walletPayload(address)) });
	});
}

test('every panel is designed before a wallet is loaded, and the market side still renders', async ({ page }) => {
	const errors = collectPageErrors(page);
	await stubDesk(page);
	await page.goto('/markets/robinhood/desk', LOAD);

	// Wallet panels: a heading, guidance, and a way forward. Never a blank card.
	for (const id of ['#hd-balance', '#hd-tape-card', '#hd-book', '#hd-flow']) {
		const empty = page.locator(`${id} .hd-empty`);
		await expect(empty).toBeVisible();
		await expect(empty.locator('strong')).not.toBeEmpty();
		await expect(empty.locator('[data-action="focus-address"]')).toBeVisible();
	}

	// Market panels do not need a wallet, so they carry data immediately.
	await expect(page.locator('#hd-ridge .hd-ridge-svg')).toBeVisible();
	await expect(page.locator('#hd-movers .hd-mover')).toHaveCount(1);
	await expect(page.locator('#hd-stats .hd-stat')).toHaveCount(4);
	await expect(page.locator('#hd-stats')).toContainText('Chain TVL');

	// The empty-state action reaches the one control that unblocks the page.
	await page.locator('#hd-balance [data-action="focus-address"]').click();
	await expect(page.locator('#hd-address')).toBeFocused();
	expect(errors).toEqual([]);
});

test('a bad address is refused in words, a real one loads the whole book', async ({ page }) => {
	const errors = collectPageErrors(page);
	await stubDesk(page);
	await page.goto('/markets/robinhood/desk', LOAD);

	await page.fill('#hd-address', 'not-an-address');
	await page.click('#hd-wallet-form button[type=submit]');
	await expect(page.locator('#hd-alert')).toContainText('Robinhood Chain address');
	await expect(page.locator('#hd-book .hd-empty')).toBeVisible();

	await page.fill('#hd-address', ADDRESS);
	await page.click('#hd-wallet-form button[type=submit]');

	await expect(page.locator('#hd-brand-sub')).toContainText('0x1111');
	expect(new URL(page.url()).searchParams.get('address')).toBe(ADDRESS);
	await expect(page.locator('#hd-stats')).toContainText('Book value');
	await expect(page.locator('#hd-balance svg.hd-chart')).toBeVisible();
	await expect(page.locator('#hd-tape .hd-tape-row')).toHaveCount(2);
	await expect(page.locator('#hd-tape .hd-kind.swap')).toBeVisible();
	await expect(page.locator('#hd-flow .hd-flow-arc')).toHaveCount(2);
	expect(errors).toEqual([]);
});

test('an unpriced token stays unpriced, and the ladder collapses without lying about the count', async ({ page }) => {
	await stubDesk(page);
	await page.goto(`/markets/robinhood/desk?address=${ADDRESS}`, LOAD);

	// 220 held, 100 returned, 12 rendered: each number appears where it belongs.
	await expect(page.locator('#hd-book .hd-card-meta')).toContainText('220 positions');
	await expect(page.locator('#hd-book tbody tr')).toHaveCount(12);
	const expander = page.locator('[data-action="expand-positions"]');
	await expect(expander).toContainText('Show 2 smaller positions');
	await expander.click();
	await expect(page.locator('#hd-book tbody tr')).toHaveCount(14);
	await expect(page.locator('#hd-book .hd-note')).toContainText('deepest 14 of 220');

	// The token with no pool is named as unpriced rather than valued at zero, and
	// the book total is native + the two priced positions only.
	const unpriced = page.locator('#hd-book tbody tr', { hasText: 'NOPRICE' });
	await expect(unpriced).toContainText('unpriced');
	await expect(page.locator('#hd-stats .hd-stat-value').first()).toHaveText('$1.27K');
});

test('the trade ticket swaps a coin and gates a Stock Token', async ({ page }) => {
	await stubDesk(page);
	await page.goto(`/markets/robinhood/desk?address=${ADDRESS}`, LOAD);

	await page.locator('#hd-book tbody tr', { hasText: 'MEME' }).getByRole('button', { name: 'Trade' }).click();
	await expect(page.locator('#hd-trade-title')).toHaveText('Trade MEME');
	await expect(page.locator('#hd-trade-body #rh-buy-amount')).toBeVisible();
	await page.click('#hd-trade-close');
	await expect(page.locator('#hd-trade-body #rh-buy-amount')).toBeHidden();

	// A Stock Token is a tokenized security: the desk shows the disclosure and an
	// outbound link, never an in-house swap.
	await page.locator('#hd-ridge tbody tr', { hasText: 'MU' }).getByRole('button', { name: 'Trade' }).click();
	await expect(page.locator('#hd-trade-body')).toContainText('may not be offered, sold, or delivered to US persons');
	await expect(page.locator('#hd-trade-body #rh-buy-amount')).toHaveCount(0);
});

test('connecting an injected wallet loads that address', async ({ page }) => {
	await installEvmWallet(page, { address: ADDRESS, chainIdHex: '0x1237' });
	await stubDesk(page);
	await page.goto('/markets/robinhood/desk', LOAD);

	await page.click('#hd-connect');
	await expect(page.locator('#hd-brand-sub')).toContainText('0x1111');
	await expect(page.locator('#hd-book tbody tr').first()).toBeVisible();
});

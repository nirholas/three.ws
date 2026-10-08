/**
 * In-world coin trade widget — Playwright e2e spec.
 *
 * Drives the REAL src/game/coin-buy.js TradeModal (the "ape this coin" flow
 * every /play world exposes). It is denomination-aware (SOL- or USDC-paired,
 * detected on mount) and does both buy and sell. Coverage:
 *   • wallet gating: disconnected → "Connect wallet"; connect → trade CTA
 *   • lifecycle stage pill: a bonding-curve coin and a graduated coin render
 *     distinct, unmistakable states (driven by the real /api/pump/quote
 *     detection the widget uses)
 *   • SOL buy happy path: prep → sign → broadcast → confirm
 *   • USDC buy happy path on a graduated coin
 *   • sell happy path: switch to Sell, enter an amount, prep → sign → broadcast
 *   • error copy: a failed prep surfaces specific, actionable copy
 *
 * Fidelity (same contract as launch-token-flow.spec.js):
 *   • /api/pump/quote, /api/pump/{buy,sell}-{prep,confirm} and the Solana RPC
 *     proxy are fulfilled at the route layer with realistic payloads (Vite dev
 *     proxies /api/* to production, so we intercept to stay deterministic and
 *     never touch a real chain). The client makes the real fetches; we assert
 *     the real prep calls fire with the right body.
 *   • prep transactions are genuine, parseable @solana/web3.js
 *     VersionedTransactions built in Node.
 *   • window.solana is the only stubbed surface (an external wallet extension).
 */

import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { TransactionMessage, VersionedTransaction, SystemProgram, Keypair } from '@solana/web3.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const CC_CSS = resolve(repoRoot, 'src/game/coincommunities.css');

const WSOL = 'So11111111111111111111111111111111111111112';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const WALLET_ADDR = Keypair.generate().publicKey.toBase58();
const SIG = '5e2eTradeSyntheticSig11111111111111111111111111111111111111111111111111111111111111111';

const SOL_COIN = { mint: '3wsSolE2eSyntheticMint111111111111111111111', name: 'E2E SOL Coin', symbol: 'E2ESOL' };
const USDC_COIN = { mint: '3wsUsdcE2eSyntheticMint11111111111111111111', name: 'E2E USDC Coin', symbol: 'E2EUSD' };

function buildTxBase64() {
	const payer = Keypair.generate();
	const msg = new TransactionMessage({
		payerKey: payer.publicKey,
		recentBlockhash: Keypair.generate().publicKey.toBase58(),
		instructions: [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: payer.publicKey, lamports: 1 })],
	}).compileToV0Message();
	return Buffer.from(new VersionedTransaction(msg).serialize()).toString('base64');
}

/**
 * @param {object} cfg
 * @param {string} cfg.quoteMint   WSOL or USDC — the coin's detected pairing.
 * @param {boolean} cfg.graduated  lifecycle stage returned by detection.
 */
async function installHarness(page, cfg) {
	const calls = { buyPrep: null, sellPrep: null, broadcast: 0 };
	const txBase64 = buildTxBase64();

	await page.addInitScript((addr) => {
		const pk = { toString: () => addr, toBase58: () => addr };
		window.solana = {
			isPhantom: true,
			isConnected: false,
			publicKey: null,
			async connect() { this.isConnected = true; this.publicKey = pk; return { publicKey: pk }; },
			async disconnect() { this.isConnected = false; this.publicKey = null; },
			async signTransaction(tx) { return { serialize: () => tx.serialize() }; },
			on() {}, removeListener() {},
		};
	}, WALLET_ADDR);

	// Server quote endpoint — drives denomination detection AND priced quotes.
	await page.route('**/api/pump/quote**', (route) => {
		const url = new URL(route.request().url());
		const direction = url.searchParams.get('direction');
		const base = { quote_mint: cfg.quoteMint, graduated: cfg.graduated };
		if (!direction) return route.fulfill({ json: base }); // detection (mount)
		if (direction === 'buy') return route.fulfill({ json: { ...base, quote: { tokens_out: 12_500_000 * 1e6 } } });
		// sell
		return route.fulfill({
			json: { ...base, quote: cfg.quoteMint === WSOL ? { sol_out: 0.42 } : { usdc_out: 63.5 } },
		});
	});

	for (const path of ['buy-prep', 'sell-prep']) {
		await page.route(`**/api/pump/${path}`, async (route) => {
			const body = JSON.parse(route.request().postData() || '{}');
			if (path === 'buy-prep') calls.buyPrep = body;
			else calls.sellPrep = body;
			await route.fulfill({ json: { tx_base64: txBase64, route: cfg.graduated ? 'amm' : 'curve' } });
		});
	}
	for (const path of ['buy-confirm', 'sell-confirm']) {
		await page.route(`**/api/pump/${path}`, (route) => route.fulfill({ json: { ok: true } }));
	}

	// Solana RPC proxy. Read calls (getAccountInfo / getTokenAccountsByOwner)
	// answer like a node; sendTransaction returns a sig; confirmTransaction's
	// block-height race resolves fast (getBlockHeight > lastValidBlockHeight).
	await page.route('**/api/solana-rpc**', (route) => {
		const body = JSON.parse(route.request().postData() || '{}');
		const ok = (result) => route.fulfill({ json: { jsonrpc: '2.0', id: body.id, result } });
		switch (body.method) {
			case 'sendTransaction':
				calls.broadcast += 1;
				return ok(SIG);
			case 'getLatestBlockhash':
				return ok({ context: { slot: 1 }, value: { blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 10 } });
			case 'getBlockHeight':
				return ok(999_999);
			case 'getSignatureStatuses':
				return ok({ context: { slot: 1 }, value: [null] });
			case 'getTokenAccountsByOwner': {
				// Give a healthy USDC balance so a USDC buy isn't gated into the fund
				// flow; everything else (coin holdings) reads empty — typed sells don't
				// need a holdings fixture. Match on the request body so we're robust to
				// the exact mint-filter param shape web3.js sends.
				if ((route.request().postData() || '').includes(USDC)) {
					return ok({
						context: { slot: 1 },
						value: [{
							pubkey: Keypair.generate().publicKey.toBase58(),
							account: {
								lamports: 2039280,
								owner: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
								executable: false,
								rentEpoch: 0,
								space: 165,
								data: {
									program: 'spl-token',
									space: 165,
									parsed: {
										type: 'account',
										info: {
											isNative: false,
											mint: USDC,
											owner: WALLET_ADDR,
											state: 'initialized',
											tokenAmount: { amount: '1000000000', decimals: 6, uiAmount: 1000, uiAmountString: '1000' },
										},
									},
								},
							},
						}],
					});
				}
				return ok({ context: { slot: 1 }, value: [] });
			}
			default:
				// getAccountInfo / getMultipleAccounts → null → AMM SDK "pool
				// unavailable", i.e. a SOL coin reads as still on the bonding curve.
				return ok(null);
		}
	});

	await page.route('**/__e2e/trade-harness', (route) =>
		route.fulfill({
			contentType: 'text/html',
			body: '<!doctype html><html><head><meta charset="utf-8"><title>trade harness</title></head><body></body></html>',
		}),
	);

	return calls;
}

async function openTrade(page, coin) {
	await page.goto('/__e2e/trade-harness');
	await page.addStyleTag({ path: CC_CSS });
	await page.evaluate(async (c) => {
		const mod = await import('/src/game/coin-buy.js');
		mod.openBuyModal(c);
	}, coin);
	await expect(page.locator('.cc-buy-card')).toBeVisible({ timeout: 30_000 });
}

test.describe('Coin trade widget', () => {
	test.beforeEach(async ({ page }) => {
		page.on('pageerror', (err) => {
			if (/websocket|hmr|wss:|failed to connect|ws error/i.test(err.message)) return;
			throw new Error(`Page error: ${err.message}`);
		});
	});

	test('gates on wallet, then shows the buy CTA', async ({ page }) => {
		test.setTimeout(120_000);
		await installHarness(page, { quoteMint: WSOL, graduated: false });
		await openTrade(page, SOL_COIN);

		const cta = page.locator('.cc-buy-cta');
		await expect(cta).toHaveText('Connect wallet');
		await cta.click();
		await expect(cta).toContainText('Buy');
		await expect(cta).toContainText('E2ESOL');
		await expect(page.locator('.cc-buy-wallet')).toContainText('…');
	});

	test('SOL coin on the bonding curve shows the curve stage pill', async ({ page }) => {
		test.setTimeout(120_000);
		await installHarness(page, { quoteMint: WSOL, graduated: false });
		await openTrade(page, SOL_COIN);

		const pill = page.locator('.cc-buy-stage');
		await expect(pill).toBeVisible({ timeout: 30_000 });
		await expect(pill).toHaveText(/On bonding curve/);
		await expect(pill).toHaveClass(/cc-buy-stage-curve/);
		// Input denominated in SOL.
		await expect(page.locator('.cc-buy-unit')).toHaveText('SOL');
	});

	test('graduated USDC coin shows the graduated stage pill and USDC denomination', async ({ page }) => {
		test.setTimeout(120_000);
		await installHarness(page, { quoteMint: USDC, graduated: true });
		await openTrade(page, USDC_COIN);

		const pill = page.locator('.cc-buy-stage');
		await expect(pill).toBeVisible({ timeout: 30_000 });
		await expect(pill).toHaveText(/Graduated/);
		await expect(pill).toHaveClass(/cc-buy-stage-grad/);
		// Detection upgraded the denomination to USDC in place.
		await expect(page.locator('.cc-buy-unit')).toHaveText('USDC', { timeout: 15_000 });
		await expect(page.locator('.cc-buy-stage-curve')).toHaveCount(0);
	});

	test('SOL buy happy path: prep → sign → broadcast → settle', async ({ page }) => {
		test.setTimeout(120_000);
		const calls = await installHarness(page, { quoteMint: WSOL, graduated: false });
		await openTrade(page, SOL_COIN);

		await page.locator('.cc-buy-cta').click(); // connect
		await expect(page.locator('.cc-buy-cta')).toContainText('Buy');
		await page.locator('.cc-buy-cta').click(); // buy

		// Settles to a confirmed CTA; the durable end state is asserted (the
		// transient "Submitted" status can be raced past when confirm is instant).
		await expect(page.locator('.cc-buy-cta')).toContainText('Bought', { timeout: 60_000 });
		expect(calls.buyPrep).toMatchObject({ mint: SOL_COIN.mint, wallet_address: WALLET_ADDR, network: 'mainnet', sol: 0.1 });
		expect(calls.broadcast).toBe(1);
		await expect(page.locator('.cc-buy-status[data-kind="ok"]')).toContainText('Bought');
	});

	test('USDC buy happy path on a graduated coin', async ({ page }) => {
		test.setTimeout(120_000);
		const calls = await installHarness(page, { quoteMint: USDC, graduated: true });
		await openTrade(page, USDC_COIN);
		await expect(page.locator('.cc-buy-unit')).toHaveText('USDC', { timeout: 15_000 });

		await page.locator('.cc-buy-cta').click(); // connect
		// Wait for the USDC balance to settle so the CTA is stably the buy action
		// (an unsettled balance would route the CTA to the fund flow).
		await expect(page.locator('.cc-buy-bal')).toContainText('1,000 USDC', { timeout: 15_000 });
		await expect(page.locator('.cc-buy-cta')).toContainText('Buy 5 USDC');
		await page.locator('.cc-buy-cta').click(); // buy

		await expect(page.locator('.cc-buy-cta')).toContainText('Bought', { timeout: 60_000 });
		expect(calls.buyPrep).toMatchObject({ mint: USDC_COIN.mint, wallet_address: WALLET_ADDR, usdc_amount: 5 });
		expect(calls.broadcast).toBe(1);
	});

	test('sell happy path: switch to Sell, enter amount, prep → broadcast', async ({ page }) => {
		test.setTimeout(120_000);
		const calls = await installHarness(page, { quoteMint: WSOL, graduated: false });
		await openTrade(page, SOL_COIN);

		// Switch to Sell and connect.
		await page.locator('.cc-buy-tab', { hasText: 'Sell' }).click();
		await expect(page.locator('.cc-buy-field-label')).toHaveText('You sell');
		await page.locator('.cc-buy-cta').click(); // connect
		// Enter an explicit token amount (no holdings fixture needed for a typed sell).
		await page.fill('.cc-buy-amount', '1000');
		await expect(page.locator('.cc-buy-cta')).toContainText('Sell');
		await page.locator('.cc-buy-cta').click(); // sell

		await expect(page.locator('.cc-buy-cta')).toContainText('Sold', { timeout: 60_000 });
		expect(calls.sellPrep).toMatchObject({ mint: SOL_COIN.mint, wallet_address: WALLET_ADDR, network: 'mainnet' });
		// 1000 tokens at 6 decimals.
		expect(calls.sellPrep.tokens).toBe('1000000000');
		expect(calls.broadcast).toBe(1);
	});

	test('a failed buy prep shows specific, actionable copy', async ({ page }) => {
		test.setTimeout(120_000);
		await installHarness(page, { quoteMint: WSOL, graduated: false });
		await page.route('**/api/pump/buy-prep', (route) =>
			route.fulfill({ status: 400, json: { error: 'insufficient_funds', error_description: 'insufficient lamports for this buy' } }),
		);
		await openTrade(page, SOL_COIN);

		await page.locator('.cc-buy-cta').click(); // connect
		await expect(page.locator('.cc-buy-cta')).toContainText('Buy');
		await page.locator('.cc-buy-cta').click(); // buy

		await expect(page.locator('.cc-buy-status[data-kind="err"]')).toContainText('Not enough SOL', { timeout: 30_000 });
	});
});

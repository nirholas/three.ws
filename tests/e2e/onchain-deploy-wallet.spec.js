/**
 * OnchainDeployButton: click to signed transaction, in a real browser.
 *
 * The REAL button (src/onchain/deploy-button.js), orchestrator (deploy.js) and
 * Solana adapter run unmodified. Only the surfaces outside our code are
 * stubbed, exactly as tests/e2e/launch-token-flow.spec.js does:
 *   - window.solana, the injected wallet extension (a throwaway keypair's
 *     address, generated per run; no private key exists in this file),
 *   - the backend routes the flow touches (/api/agents/onchain/prep, /confirm,
 *     the SIWS link check) and the Solana RPC proxy, fulfilled at the Playwright
 *     route layer so the run is deterministic and nothing ever lands on a chain.
 * The button is pinned to Solana devnet, so no scenario here can describe a
 * mainnet transaction.
 *
 * Scenarios: idle, no wallet, happy path (pending steps then success chip),
 * wallet rejection, prep failure with a recovery path, and double-click safety.
 */

import { test, expect } from '@playwright/test';
import { Transaction, SystemProgram, Keypair } from '@solana/web3.js';

const DEVNET = 'solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1';
const ASSET = Keypair.generate().publicKey.toBase58();
const TX_SIGNATURE = Array.from({ length: 88 }, (_, i) => 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ123456789'[(i * 7) % 58]).join('');

function buildPrepTxBase64(payer) {
	const tx = new Transaction();
	tx.feePayer = payer;
	tx.recentBlockhash = Keypair.generate().publicKey.toBase58();
	tx.add(SystemProgram.transfer({ fromPubkey: payer, toPubkey: payer, lamports: 1 }));
	return tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
}

/**
 * Wire the page. `wallet: false` leaves window.solana undefined. `prep` decides
 * the prep route: a function (route) => Promise, defaulting to a success.
 */
async function installHarness(page, { wallet = true, prepHandler } = {}) {
	const owner = Keypair.generate().publicKey;
	const calls = { prep: [], confirm: [], broadcast: 0 };

	await page.addInitScript(() => {
		window.localStorage.setItem('tws:onchain-primer:done', '1');
	});

	if (wallet) {
		await page.addInitScript((addr) => {
			const pk = { toString: () => addr, toBase58: () => addr };
			window.__walletMode = 'ok';
			window.__signCalls = 0;
			window.solana = {
				isPhantom: true,
				isConnected: false,
				publicKey: null,
				async connect() {
					this.isConnected = true;
					this.publicKey = pk;
					return { publicKey: pk };
				},
				async disconnect() {
					this.isConnected = false;
					this.publicKey = null;
				},
				async signMessage() {
					return { signature: new Uint8Array(64) };
				},
				async signTransaction(tx) {
					window.__signCalls += 1;
					if (window.__walletMode === 'reject') {
						const e = new Error('User rejected the request.');
						e.code = 4001;
						throw e;
					}
					return { serialize: () => tx.serialize({ requireAllSignatures: false, verifySignatures: false }) };
				},
				on() {},
				removeListener() {},
			};
		}, owner.toBase58());
	}

	await page.route('**/api/auth/wallets/check**', (route) => route.fulfill({ json: { linked: true } }));

	await page.route('**/api/agents/onchain/prep', async (route) => {
		calls.prep.push(JSON.parse(route.request().postData() || '{}'));
		if (prepHandler) return prepHandler(route);
		await route.fulfill({
			json: {
				prepId: 'prep_e2e_1',
				txBase64: buildPrepTxBase64(owner),
				assetPubkey: ASSET,
				contractAddress: ASSET,
			},
		});
	});

	await page.route('**/api/agents/onchain/confirm', async (route) => {
		calls.confirm.push(JSON.parse(route.request().postData() || '{}'));
		await route.fulfill({
			json: {
				agent: {
					onchain: { chain: DEVNET, family: 'solana', tx_hash: TX_SIGNATURE, onchain_id: ASSET, contract_or_mint: ASSET },
				},
			},
		});
	});

	await page.route('**/api/solana-rpc**', async (route) => {
		const body = JSON.parse(route.request().postData() || '{}');
		const reply = (result) => route.fulfill({ json: { jsonrpc: '2.0', id: body.id, result } });
		if (body.method === 'sendTransaction') {
			calls.broadcast += 1;
			return reply(TX_SIGNATURE);
		}
		if (body.method === 'getSignatureStatuses') {
			return reply({ context: { slot: 1 }, value: [{ slot: 1, confirmations: null, confirmationStatus: 'confirmed', err: null }] });
		}
		return reply(null);
	});

	await page.route('**/__e2e/deploy-harness', (route) =>
		route.fulfill({
			contentType: 'text/html',
			body: '<!doctype html><html><head><meta charset="utf-8"><title>deploy harness</title></head><body><div id="host"></div></body></html>',
		}),
	);

	return calls;
}

async function mountButton(page, agent = {}) {
	await page.goto('/__e2e/deploy-harness');
	await page.evaluate(
		async ({ chain, agent }) => {
			const mod = await import('/src/onchain/deploy-button.js');
			const btn = new mod.OnchainDeployButton({
				agent: { id: 'agent-e2e-1', name: 'E2E Deploy Agent', avatarId: 'avatar-e2e-1', ...agent },
				container: document.getElementById('host'),
				preferredChain: chain,
				reveal: false,
			});
			btn.mount();
			window.__deployBtn = btn;
		},
		{ chain: DEVNET, agent },
	);
	await expect(page.locator('.deploy-btn')).toBeVisible({ timeout: 60_000 });
}

test.describe('OnchainDeployButton with an injected Solana wallet (devnet)', () => {
	const consoleErrors = [];
	test.beforeEach(async ({ page }) => {
		consoleErrors.length = 0;
		page.on('pageerror', (err) => {
			if (/websocket|hmr|wss:|failed to connect/i.test(err.message)) return;
			consoleErrors.push(err.message);
		});
	});
	test.afterEach(() => {
		expect(consoleErrors, 'no uncaught page errors').toEqual([]);
	});

	test('idle: the button is enabled, pinned to Solana Devnet, and nothing has been requested', async ({ page }) => {
		test.setTimeout(120_000);
		const calls = await installHarness(page);
		await mountButton(page);

		await expect(page.locator('.deploy-btn')).toBeEnabled();
		await expect(page.locator('.deploy-chain-select')).toHaveValue(DEVNET);
		expect(calls.prep).toHaveLength(0);
		expect(calls.confirm).toHaveLength(0);
	});

	test('no wallet: an actionable error with an install action, and a way back to the button', async ({ page }) => {
		test.setTimeout(120_000);
		const calls = await installHarness(page, { wallet: false });
		await mountButton(page);

		await page.click('.deploy-btn');
		const alert = page.locator('.deploy-error');
		await expect(alert).toContainText('No SOLANA wallet detected');
		await expect(alert.locator('.deploy-action-btn').first()).toHaveText('Install wallet');
		expect(calls.prep).toHaveLength(0);

		await alert.locator('.deploy-action-btn--reset').click();
		await expect(page.locator('.deploy-btn')).toBeEnabled();
	});

	test('happy path: steps advance through prep, sign and confirm, then the success chip links to the explorer', async ({ page }) => {
		test.setTimeout(120_000);
		let releasePrep;
		const gate = new Promise((r) => (releasePrep = r));
		const owner = Keypair.generate().publicKey;
		const calls = await installHarness(page, {
			prepHandler: async (route) => {
				await gate;
				await route.fulfill({
					json: { prepId: 'prep_e2e_1', txBase64: buildPrepTxBase64(owner), assetPubkey: ASSET, contractAddress: ASSET },
				});
			},
		});
		await mountButton(page);

		await page.click('.deploy-btn');
		// While prep is held open the progress strip is real and names the active step.
		await expect(page.locator('.progress-step--active')).toHaveText('Preparing manifest');
		releasePrep();

		const chip = page.locator('.deploy-chip--success');
		await expect(chip).toContainText('On-chain on Solana Devnet', { timeout: 30_000 });
		await expect(chip).toHaveAttribute('href', `https://explorer.solana.com/tx/${TX_SIGNATURE}?cluster=devnet`);

		expect(calls.prep).toHaveLength(1);
		expect(calls.prep[0]).toMatchObject({ agent_id: 'agent-e2e-1', chain: DEVNET, avatar_id: 'avatar-e2e-1' });
		expect(calls.broadcast).toBe(1);
		expect(calls.confirm).toHaveLength(1);
		expect(calls.confirm[0]).toMatchObject({ prep_id: 'prep_e2e_1', tx_hash: TX_SIGNATURE });
	});

	test('wallet rejection: back to a clean, enabled button with no confirm call', async ({ page }) => {
		test.setTimeout(120_000);
		const calls = await installHarness(page);
		await mountButton(page);
		await page.evaluate(() => {
			window.__walletMode = 'reject';
		});

		await page.click('.deploy-btn');
		// The wallet was asked exactly once, and the strip then gives way to the button.
		await page.waitForFunction(() => window.__signCalls === 1, null, { timeout: 30_000 });
		await expect(page.locator('.deploy-progress')).toHaveCount(0, { timeout: 30_000 });
		await expect(page.locator('.deploy-btn')).toBeEnabled();
		await expect(page.locator('.deploy-error')).toHaveCount(0);
		expect(calls.broadcast).toBe(0);
		expect(calls.confirm).toHaveLength(0);
	});

	test('prep failure: the server reason is shown with a Try again that recovers', async ({ page }) => {
		test.setTimeout(120_000);
		const calls = await installHarness(page, {
			prepHandler: (route) =>
				route.fulfill({
					status: 403,
					json: { error: 'forbidden', error_description: 'You do not own this agent.' },
				}),
		});
		await mountButton(page);

		await page.click('.deploy-btn');
		await expect(page.locator('.deploy-error-msg')).toHaveText('You do not own this agent.');
		expect(calls.confirm).toHaveLength(0);
		expect(calls.broadcast).toBe(0);

		await page.locator('.deploy-action-btn--reset').click();
		await expect(page.locator('.deploy-btn')).toBeEnabled();
	});

	test('double click: a second click while a deploy is starting does not start a second one', async ({ page }) => {
		test.setTimeout(120_000);
		const calls = await installHarness(page);
		await mountButton(page);

		await page.evaluate(() => {
			const b = document.querySelector('.deploy-btn');
			b.click();
			b.click();
		});
		await expect(page.locator('.deploy-chip--success')).toBeVisible({ timeout: 30_000 });

		expect(calls.prep).toHaveLength(1);
		expect(calls.broadcast).toBe(1);
		expect(calls.confirm).toHaveLength(1);
	});
});

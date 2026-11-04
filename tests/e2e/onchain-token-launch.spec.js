/**
 * LaunchTokenButton: the pre-launch surface, in a real browser.
 *
 * The REAL button (src/onchain/launch-token-button.js) and the Pump.fun adapter
 * run unmodified. Only the surfaces outside our code are stubbed at the
 * Playwright route layer: the quote endpoint and the Solana RPC proxy, plus the
 * injected wallet. This spec deliberately stops BEFORE a launch: it submits
 * nothing, so no mint is ever created. The full signed flow lives in
 * tests/e2e/launch-token-flow.spec.js.
 *
 * Scenarios: disabled until the agent is deployed on-chain, disabled for an
 * EVM-deployed agent, chip once a token exists, modal with a real cost
 * estimate, a quote outage that degrades honestly, and cancel / overlay-click
 * dismissal that sends nothing.
 */

import { test, expect } from '@playwright/test';
import { Keypair } from '@solana/web3.js';

const OWNER = Keypair.generate().publicKey.toBase58();
const MINT = Keypair.generate().publicKey.toBase58();

async function installHarness(page, { quote } = {}) {
	const calls = { quote: [], prep: 0, confirm: 0, broadcast: 0 };

	await page.addInitScript(() => {
		window.__signCalls = 0;
		window.solana = {
			isPhantom: true,
			async connect() {
				return { publicKey: { toString: () => '', toBase58: () => '' } };
			},
			async signTransaction() {
				window.__signCalls += 1;
				throw new Error('signTransaction must not be called in this spec');
			},
			on() {},
			removeListener() {},
		};
	});

	await page.route('**/api/agents/tokens/launch-quote**', async (route) => {
		calls.quote.push(new URL(route.request().url()).searchParams.get('initial_buy_sol'));
		if (quote) return quote(route);
		await route.fulfill({
			json: { fixed_total_sol: 0.0214, total_sol: 0.0214, initial_buy: null },
		});
	});
	await page.route('**/api/agents/tokens/launch-prep', (route) => {
		calls.prep += 1;
		return route.fulfill({ status: 500, json: { error: 'unexpected' } });
	});
	await page.route('**/api/agents/tokens/launch-confirm', (route) => {
		calls.confirm += 1;
		return route.fulfill({ status: 500, json: { error: 'unexpected' } });
	});
	await page.route('**/api/solana-rpc**', (route) => {
		calls.broadcast += 1;
		return route.fulfill({ json: { jsonrpc: '2.0', id: 1, result: null } });
	});
	await page.route('**/__e2e/launch-harness', (route) =>
		route.fulfill({
			contentType: 'text/html',
			body: '<!doctype html><html><head><meta charset="utf-8"><title>launch harness</title></head><body><div id="host"></div></body></html>',
		}),
	);
	return calls;
}

async function mountButton(page, agent) {
	await page.goto('/__e2e/launch-harness');
	await page.evaluate(async (agent) => {
		const mod = await import('/src/onchain/launch-token-button.js');
		const btn = new mod.LaunchTokenButton({
			agent: { id: 'agent-e2e-1', name: 'Echo', description: 'An e2e agent.', ...agent },
			container: document.getElementById('host'),
		});
		btn.mount();
	}, agent);
}

const solanaAgent = { onchain: { family: 'solana', cluster: 'devnet', wallet: OWNER } };

test.describe('LaunchTokenButton before any launch (devnet)', () => {
	const pageErrors = [];
	test.beforeEach(({ page }) => {
		pageErrors.length = 0;
		page.on('pageerror', (err) => {
			if (/websocket|hmr|wss:|failed to connect/i.test(err.message)) return;
			pageErrors.push(err.message);
		});
	});
	test.afterEach(() => {
		expect(pageErrors, 'no uncaught page errors').toEqual([]);
	});

	test('not deployed on-chain: the button is disabled and says why', async ({ page }) => {
		test.setTimeout(120_000);
		await installHarness(page);
		await mountButton(page, {});
		const btn = page.locator('.launch-token-btn');
		await expect(btn).toBeDisabled({ timeout: 60_000 });
		await expect(page.locator('.launch-token-tooltip')).toContainText('deployed on-chain');
	});

	test('EVM-deployed agent: disabled with the Solana-only reason', async ({ page }) => {
		test.setTimeout(120_000);
		await installHarness(page);
		await mountButton(page, { onchain: { family: 'evm', wallet: '0x0000000000000000000000000000000000000001' } });
		await expect(page.locator('.launch-token-btn')).toBeDisabled({ timeout: 60_000 });
		await expect(page.locator('.launch-token-tooltip')).toContainText('Solana-deployed');
	});

	test('already launched: a chip links to the token and there is no launch button', async ({ page }) => {
		test.setTimeout(120_000);
		await installHarness(page);
		await mountButton(page, {
			...solanaAgent,
			token: { mint: MINT, symbol: 'ECHO', cluster: 'devnet', explorer_url: `https://explorer.solana.com/address/${MINT}?cluster=devnet` },
		});
		const chip = page.locator('.launch-token-chip');
		await expect(chip).toBeVisible({ timeout: 60_000 });
		await expect(chip).toHaveAttribute('href', new RegExp(MINT));
		await expect(page.locator('.launch-token-btn')).toHaveCount(0);
	});

	test('modal shows the live cost estimate and re-quotes when the buy changes', async ({ page }) => {
		test.setTimeout(120_000);
		const calls = await installHarness(page, {
			quote: async (route) => {
				const buy = Number(new URL(route.request().url()).searchParams.get('initial_buy_sol')) || 0;
				await route.fulfill({
					json: { fixed_total_sol: 0.0214, total_sol: 0.0214 + buy, initial_buy: buy ? { tokens_out: 1234567 } : null },
				});
			},
		});
		await mountButton(page, solanaAgent);
		const btn = page.locator('.launch-token-btn');
		await expect(btn).toBeEnabled({ timeout: 60_000 });
		await btn.click();

		const modal = page.locator('.launch-token-modal');
		await expect(modal).toBeVisible();
		await expect(modal.locator('input[name="symbol"]')).toHaveValue('ECHO');
		const quote = modal.locator('.launch-token-quote');
		await expect(quote).toContainText('Estimated cost: 0.02140 SOL');

		await modal.locator('input[name="initial_buy"]').fill('0.5');
		await expect(quote).toContainText('Estimated cost: 0.52140 SOL');
		await expect(quote).toContainText('tokens');
		expect(calls.quote).toContain('0.5');
		expect(calls.prep + calls.confirm + calls.broadcast).toBe(0);
	});

	test('quote outage: the modal says the estimate is unavailable and stays usable', async ({ page }) => {
		test.setTimeout(120_000);
		await installHarness(page, { quote: (route) => route.fulfill({ status: 503, json: { error: 'down' } }) });
		await mountButton(page, solanaAgent);
		await page.locator('.launch-token-btn').click({ timeout: 60_000 });
		await expect(page.locator('.launch-token-quote')).toHaveText('Cost estimate unavailable.');
		await expect(page.locator('.launch-token-submit')).toBeEnabled();
	});

	test('Cancel and an overlay click both dismiss the modal and send no launch traffic', async ({ page }) => {
		test.setTimeout(120_000);
		const calls = await installHarness(page);
		await mountButton(page, solanaAgent);
		const btn = page.locator('.launch-token-btn');
		await expect(btn).toBeEnabled({ timeout: 60_000 });

		await btn.click();
		await expect(page.locator('.launch-token-modal')).toBeVisible();
		await page.locator('.launch-token-cancel').click();
		await expect(page.locator('.launch-token-modal-overlay')).toHaveCount(0);

		await btn.click();
		await expect(page.locator('.launch-token-modal')).toBeVisible();
		// The harness page loads no stylesheet, so the overlay is unstyled and a
		// coordinate click would land on the modal. Dispatch on the overlay itself.
		await page.locator('.launch-token-modal-overlay').dispatchEvent('click');
		await expect(page.locator('.launch-token-modal-overlay')).toHaveCount(0);

		expect(calls.prep + calls.confirm + calls.broadcast).toBe(0);
		expect(await page.evaluate(() => window.__signCalls)).toBe(0);
	});
});

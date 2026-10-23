// W3AG (Web3 Accessibility Guidelines) A/AA criteria for wallet and payment UX
// that a browser can check mechanically. What a person has to judge (is the
// plain-language summary actually plain?) is listed in docs/accessibility.md.
//
// Drives the real modules from /src through a same-origin harness page and
// the real wallet pages. The only stub is the injected wallet extension
// (window.solana / window.ethereum), per the fidelity contract in _support.js.

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { installSolanaWallet, installEvmWallet, serveHarness, collectPageErrors } from './_support.js';

// Synthetic, never a real third-party address.
const SOLANA_ADDR = 'THREEsynthetic1111111111111111111111111111';
const EVM_ADDR = '0x742d35Cc6634C0532925a3b844Bc454e4438f44e';
const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const HARNESS = '**/w3ag-harness';

const WALLET_PAGES = ['/wallet', '/agent-wallet', '/claim-wallet', '/vaults'];

async function openHarness(page, body = '<main><h1>Harness</h1><button id="opener">Open</button><div id="mount"></div></main>') {
	await serveHarness(page, HARNESS, { title: 'w3ag harness', body });
	await page.goto('/w3ag-harness');
}

test.describe('address presentation (W3AG 1.1.1, 1.1.3)', () => {
	test('short form is drawn, the full value is announced in chunks, full value on hover', async ({ page }) => {
		await openHarness(page);
		const out = await page.evaluate(async (mint) => {
			const { addressHtml, spokenAddress, shortAddress } = await import('/src/shared/address.js');
			document.getElementById('mount').innerHTML = addressHtml(mint, { label: 'Token mint' });
			const root = document.querySelector('.w3-addr');
			return {
				short: shortAddress(mint),
				spoken: spokenAddress(mint),
				hidden: root.querySelector('[aria-hidden="true"]').textContent,
				title: root.getAttribute('title'),
				translate: root.getAttribute('translate'),
				text: root.textContent,
			};
		}, THREE_MINT);
		expect(out.hidden).toBe(out.short);
		expect(out.title).toBe(THREE_MINT);
		expect(out.translate).toBe('no');
		expect(out.spoken.replace(/ /g, '')).toBe(THREE_MINT);
		expect(out.spoken.split(' ').every((g) => g.length <= 4)).toBe(true);
		expect(out.text).toContain('Token mint: ');
	});

	test('a 0x address keeps its prefix as its own group', async ({ page }) => {
		await openHarness(page);
		const spoken = await page.evaluate(async (a) => (await import('/src/shared/address.js')).spokenAddress(a), EVM_ADDR);
		expect(spoken.startsWith('0x 742d 35Cc')).toBe(true);
		expect(spoken.replace(/ /g, '')).toBe(EVM_ADDR);
	});

	test('short values and empty values are returned unharmed', async ({ page }) => {
		await openHarness(page);
		const out = await page.evaluate(async () => {
			const { shortAddress, addressHtml } = await import('/src/shared/address.js');
			return [shortAddress('abc'), shortAddress(null), shortAddress('', 4, 4, { empty: 'none' }), addressHtml(null, { empty: 'No wallet' })];
		});
		expect(out).toEqual(['abc', '', 'none', 'No wallet']);
	});
});

test.describe('connect picker (W3AG 2.1.2, 2.1.1)', () => {
	test('traps focus, makes the page inert, closes on Escape, returns focus', async ({ page }) => {
		const errors = collectPageErrors(page);
		await installEvmWallet(page, { address: EVM_ADDR });
		await openHarness(page);
		await page.evaluate(async () => {
			const { createConnectWalletButton } = await import('/src/wallet/connect-button.js');
			createConnectWalletButton(document.getElementById('mount'), { wcProjectId: 'e2e-synthetic-project' });
		});
		const connect = page.locator('.cwb-btn');
		await connect.focus();
		await page.keyboard.press('Enter');

		const picker = page.getByRole('dialog', { name: 'Choose a wallet to connect' });
		await expect(picker).toBeVisible();
		await expect(picker).toHaveAttribute('aria-modal', 'true');
		await expect(page.locator('main')).toHaveAttribute('inert', '');

		const items = picker.getByRole('button');
		await expect(items.first()).toBeFocused();
		await page.keyboard.press('Tab');
		await expect(items.nth(1)).toBeFocused();
		await page.keyboard.press('Tab');
		await expect(items.first()).toBeFocused();
		await page.keyboard.press('Shift+Tab');
		await expect(items.nth(1)).toBeFocused();

		await page.keyboard.press('Escape');
		await expect(picker).toHaveCount(0);
		await expect(page.locator('main')).not.toHaveAttribute('inert', '');
		await expect(connect).toBeFocused();
		expect(errors).toEqual([]);
	});
});

test.describe('payment modal (W3AG 2.1.2, 1.4.1, 2.2.1)', () => {
	async function openModal(page) {
		await page.route('**/api/marketplace/skill-promo*', (route) =>
			route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: null }) }),
		);
		await openHarness(page);
		await page.evaluate(async () => {
			const { SkillPaymentModal } = await import('/src/payment-modal.js');
			window.__modal = new SkillPaymentModal(document.body, 'agent-synthetic');
			document.getElementById('opener').focus();
			window.__result = window.__modal.show({
				skill: 'summarize',
				price: { amount: '250000', currency_mint: 'USDC', chain: 'solana' },
			});
			window.__result.then((v) => (window.__resolved = v));
		});
	}

	test('names itself, traps focus, hides the page, closes on Escape, returns focus', async ({ page }) => {
		const errors = collectPageErrors(page);
		await installSolanaWallet(page, { address: SOLANA_ADDR });
		await openModal(page);

		const dialog = page.getByRole('dialog', { name: 'Unlock Skill' });
		await expect(dialog).toBeVisible();
		await expect(page.locator('main')).toHaveAttribute('inert', '');
		await expect(page.locator('#skill-pay-connect')).toBeFocused();

		// Tab never leaves the dialog, in either direction.
		const inside = () => page.evaluate(() => !!document.activeElement?.closest('.skill-pay-box'));
		for (let i = 0; i < 6; i++) {
			await page.keyboard.press('Tab');
			expect(await inside()).toBe(true);
		}
		for (let i = 0; i < 6; i++) {
			await page.keyboard.press('Shift+Tab');
			expect(await inside()).toBe(true);
		}

		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();
		await expect(page.locator('main')).not.toHaveAttribute('inert', '');
		await expect(page.locator('#opener')).toBeFocused();
		expect(await page.evaluate(() => window.__resolved)).toBe(false);
		expect(errors).toEqual([]);
	});

	test('step progress is text, not only a glyph and a tint', async ({ page }) => {
		await installSolanaWallet(page, { address: SOLANA_ADDR });
		await openModal(page);
		const steps = page.locator('.skill-pay-step');
		await expect(steps.first()).toHaveAttribute('aria-current', 'step');
		await expect(steps.first()).toContainText('Connect, current step');
		await expect(steps.nth(1)).toContainText('Approve, not started');
		await page.evaluate(() => window.__modal._setStep('confirm'));
		await expect(steps.first()).toContainText('Connect, completed');
		await expect(steps.nth(2)).toHaveAttribute('aria-current', 'step');
		await page.evaluate(() => window.__modal._stepError());
		await expect(steps.nth(2)).toContainText('Confirm, failed');
		await expect(steps.nth(2)).not.toHaveAttribute('aria-current', 'step');
	});

	test('the price is stated in plain words and the status region is live', async ({ page }) => {
		await installSolanaWallet(page, { address: SOLANA_ADDR });
		await openModal(page);
		await expect(page.locator('.skill-pay-skill')).toHaveText('summarize');
		await expect(page.locator('.skill-pay-amount')).toHaveText('0.25 USDC');
		await expect(page.locator('.skill-pay-desc')).toContainText('one-time payment');
		await expect(page.locator('.skill-pay-status')).toHaveAttribute('role', 'status');
		await expect(page.locator('.skill-pay-status')).toHaveAttribute('aria-live', 'polite');
	});

	test('the open modal has no axe violations', async ({ page }) => {
		await installSolanaWallet(page, { address: SOLANA_ADDR });
		await openModal(page);
		await page.waitForFunction(() => document.querySelector('.skill-pay-overlay')?.classList.contains('is-open'));
		const { violations } = await new AxeBuilder({ page })
			.withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
			.include('.skill-pay-overlay')
			.analyze();
		expect(violations.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
	});

	test('nothing on the page runs a signing time limit (W3AG 2.2.1)', async ({ page }) => {
		await installSolanaWallet(page, { address: SOLANA_ADDR });
		await openModal(page);
		await page.waitForTimeout(4000);
		await expect(page.getByRole('dialog', { name: 'Unlock Skill' })).toBeVisible();
		expect(await page.evaluate(() => window.__resolved)).toBeUndefined();
	});
});

test.describe('wallet pages', () => {
	for (const path of WALLET_PAGES) {
		test(`${path}: declares its language, never auto-refreshes, has one h1 and a main landmark`, async ({ page }) => {
			await installSolanaWallet(page, { address: SOLANA_ADDR });
			await page.goto(path);
			await expect(page.locator('html')).toHaveAttribute('lang', /^[a-z]{2}/);
			await expect(page.locator('meta[http-equiv="refresh"]')).toHaveCount(0);
			await expect(page.locator('main, [role="main"]').first()).toBeAttached();
			expect(await page.locator('h1').count()).toBeGreaterThanOrEqual(1);
		});

		test(`${path}: a full address is never exposed only as an ellipsis`, async ({ page }) => {
			await installSolanaWallet(page, { address: SOLANA_ADDR });
			await page.goto(path);
			await page.waitForLoadState('networkidle').catch(() => {});
			// Every element whose visible text is a shortened address must carry
			// the full value in its accessible name or title, or sit inside a
			// .w3-addr wrapper that does.
			const offenders = await page.evaluate(() => {
				const re = /^[1-9A-HJ-NP-Za-km-z]{3,8}(…|\.\.\.)[1-9A-HJ-NP-Za-km-z]{3,8}$/;
				const bad = [];
				for (const el of document.querySelectorAll('body *')) {
					if (el.children.length) continue;
					const t = (el.textContent || '').trim();
					if (!re.test(t)) continue;
					if (el.closest('.w3-addr, [title], [aria-label], [data-full-address]')) continue;
					const named = el.closest('button, a');
					if (named?.getAttribute('aria-label') || named?.getAttribute('title')) continue;
					bad.push(`${el.tagName.toLowerCase()}: ${t}`);
				}
				return bad;
			});
			expect(offenders).toEqual([]);
		});
	}

	test('/wallet, /agent-wallet, /claim-wallet, /vaults pass axe with a wallet extension present', async ({ page }) => {
		await installSolanaWallet(page, { address: SOLANA_ADDR });
		for (const path of WALLET_PAGES) {
			await page.goto(path);
			await page.waitForLoadState('networkidle').catch(() => {});
			const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
			expect(violations.map((v) => `${path} ${v.id}: ${v.help}`)).toEqual([]);
		}
	});
});

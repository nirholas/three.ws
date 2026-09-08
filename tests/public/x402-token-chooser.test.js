// @vitest-environment jsdom
//
// The drop-in payment modal's token chooser (public/x402.js).
//
// A three.ws 402 advertises the same resource in more than one Solana asset:
// USDC first, then $THREE. The modal used to take the first Solana accept with
// `.find()` and offer no way to reach the rest, so $THREE was advertised on
// every paid endpoint and payable on none of them from a browser: 666,971
// settled /club tips and not one in $THREE. These tests pin the chooser that
// closes that gap, and the autoConnect interaction that would otherwise skip
// straight past it and silently commit the buyer to USDC.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { pay } from '../../public/x402.js';

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const PAY_TO = THREE_MINT;
const SOLANA_NET = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';

/** The USDC leg: first in `accepts`, matching what the server advertises. */
const usdcAccept = {
	scheme: 'exact',
	network: SOLANA_NET,
	amount: '1000', // $0.001: the /club dance-tip price
	asset: USDC_MINT,
	payTo: PAY_TO,
	maxTimeoutSeconds: 60,
	resource: 'https://three.ws/api/x402/dance-tip',
	extra: { name: 'USDC', decimals: 6, feePayer: PAY_TO },
};

/** The $THREE leg: second, and unreachable before the chooser existed. */
const threeAccept = {
	...usdcAccept,
	amount: '10000000', // 10 THREE
	asset: THREE_MINT,
	extra: { name: 'THREE', decimals: 6, feePayer: PAY_TO },
};

function stub402(accepts) {
	return {
		status: 402,
		headers: { get: () => null },
		json: async () => ({ accepts }),
		text: async () => '{"error":"payment required"}',
	};
}

function flush() {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

function tokenButtons() {
	return [...document.querySelectorAll('[data-token]')];
}

function closeModal(p) {
	document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
	return p.catch(() => {});
}

describe('x402 modal: multi-token chooser', () => {
	beforeEach(() => {
		document.body.innerHTML = '';
		window.phantom = { solana: { isPhantom: true } };
		global.fetch = vi.fn(async () => stub402([usdcAccept, threeAccept]));
		global.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
		vi.stubGlobal('confirm', vi.fn(() => true));
	});

	afterEach(() => {
		delete window.phantom;
		vi.restoreAllMocks();
	});

	it('offers one button per advertised Solana asset, in advertised order', async () => {
		const p = pay({ endpoint: 'https://three.ws/api/x402/dance-tip', merchant: 'Club', action: 'Tip' });
		p.catch(() => {});
		await flush();

		const btns = tokenButtons();
		expect(btns.map((b) => b.dataset.token)).toEqual([USDC_MINT, THREE_MINT]);
		expect(btns.map((b) => b.querySelector('.x402-token-sym').textContent)).toEqual(['USDC', 'THREE']);
		// Each button shows what that token actually costs, so the buyer compares
		// prices before picking rather than after signing.
		expect(btns[0].querySelector('.x402-token-amt').textContent).toBe('0.001');
		expect(btns[1].querySelector('.x402-token-amt').textContent).toBe('10.00');

		await closeModal(p);
	});

	it('defaults to the first advertised token and marks it checked', async () => {
		const p = pay({ endpoint: 'https://three.ws/api/x402/dance-tip', merchant: 'Club', action: 'Tip' });
		p.catch(() => {});
		await flush();

		const [usdcBtn, threeBtn] = tokenButtons();
		expect(usdcBtn.getAttribute('aria-checked')).toBe('true');
		expect(threeBtn.getAttribute('aria-checked')).toBe('false');
		// Header price row reflects the default token.
		expect(document.querySelector('.x402-currency')?.textContent.trim()).toBe('USDC');

		await closeModal(p);
	});

	it('switches the header price and checked state when THREE is picked', async () => {
		const p = pay({ endpoint: 'https://three.ws/api/x402/dance-tip', merchant: 'Club', action: 'Tip' });
		p.catch(() => {});
		await flush();

		tokenButtons()[1].click();
		await flush();

		const [usdcBtn, threeBtn] = tokenButtons();
		expect(threeBtn.getAttribute('aria-checked')).toBe('true');
		expect(usdcBtn.getAttribute('aria-checked')).toBe('false');
		expect(document.querySelector('.x402-currency')?.textContent.trim()).toBe('THREE');

		await closeModal(p);
	});

	it('carries the THREE mint into the on-chain flow, not USDC', async () => {
		// The strongest observable proof that the choice is real: the balance
		// probe the modal fires before signing names a specific mint. If picking
		// THREE only repainted the header, this would still read the USDC mint.
		const probedMints = [];
		window.phantom.solana.connect = async () => ({
			publicKey: { toString: () => 'Payer1111111111111111111111111111111111111' },
		});
		global.fetch = vi.fn(async (url, init) => {
			if (String(url).includes('solana-rpc')) {
				const body = String(init?.body || '');
				for (const mint of [USDC_MINT, THREE_MINT]) {
					if (body.includes(mint)) probedMints.push(mint);
				}
				return {
					ok: true,
					json: async () => ({
						result: {
							value: [{
								account: {
									data: { parsed: { info: { tokenAmount: { amount: '999000000', decimals: 6 } } } },
								},
							}],
						},
					}),
				};
			}
			return stub402([usdcAccept, threeAccept]);
		});
		// Stop the flow at signing: the mint has already been committed by then.
		window.phantom.solana.signTransaction = async () => {
			throw new Error('stop after asset selection');
		};

		const p = pay({ endpoint: 'https://three.ws/api/x402/dance-tip', merchant: 'Club', action: 'Tip' });
		p.catch(() => {});
		await flush();

		tokenButtons()[1].click();
		await flush();
		expect(document.querySelector('.x402-currency')?.textContent.trim()).toBe('THREE');

		document.querySelector('[data-wallet="phantom"]').click();
		await vi.waitFor(() => expect(probedMints.length).toBeGreaterThan(0), { timeout: 15_000, interval: 20 });

		expect(probedMints).toContain(THREE_MINT);
		expect(probedMints).not.toContain(USDC_MINT);

		await closeModal(p);
	});

	it('renders no chooser for a single-token resource', async () => {
		global.fetch = vi.fn(async () => stub402([usdcAccept]));
		const p = pay({ endpoint: 'https://three.ws/api/x402/dance-tip', merchant: 'Club', action: 'Tip' });
		p.catch(() => {});
		await flush();

		expect(tokenButtons()).toHaveLength(0);
		expect(document.querySelector('.x402-token-choice')).toBeNull();

		await closeModal(p);
	});

	it('dedupes repeated accepts for the same mint', async () => {
		// Permit2/auth-hint siblings can repeat a mint; the chooser shows it once.
		global.fetch = vi.fn(async () => stub402([usdcAccept, { ...usdcAccept, amount: '2000' }, threeAccept]));
		const p = pay({ endpoint: 'https://three.ws/api/x402/dance-tip', merchant: 'Club', action: 'Tip' });
		p.catch(() => {});
		await flush();

		expect(tokenButtons().map((b) => b.dataset.token)).toEqual([USDC_MINT, THREE_MINT]);

		await closeModal(p);
	});

	it('autoConnect still shows the chooser once instead of committing to USDC', async () => {
		// /club passes autoConnect:true. Before the guard, a detected Phantom sent
		// the buyer straight to a USDC signature and $THREE was never offered.
		const p = pay({
			endpoint: 'https://three.ws/api/x402/dance-tip',
			merchant: 'Club',
			action: 'Tip',
			autoConnect: true,
		});
		p.catch(() => {});
		await flush();

		expect(tokenButtons()).toHaveLength(2);
		expect(document.querySelector('[data-wallet="phantom"]')).toBeTruthy();

		await closeModal(p);
	});

	it('explains a 503 settlement pause in a sentence, not a JSON envelope', async () => {
		// What /club actually served on 2026-09-08 with the sponsor under its SOL
		// floor. The buyer used to be shown the raw body, which reads as a broken
		// link rather than "we are topping up, nothing was charged".
		global.fetch = vi.fn(async () => ({
			status: 503,
			headers: { get: () => null },
			json: async () => ({ error: 'settlement_unavailable' }),
			text: async () => JSON.stringify({
				error: 'settlement_unavailable',
				error_description: 'paidEndpoint: settlement is temporarily unavailable, the sponsor wallet is below its SOL settle floor.',
			}),
		}));

		const p = pay({ endpoint: 'https://three.ws/api/x402/club-cover', merchant: 'Club', action: 'Cover' });
		p.catch(() => {});
		await vi.waitFor(
			() => expect(document.querySelector('.x402-error-detail, .x402-step.x402-error')).toBeTruthy(),
			{ timeout: 15_000, interval: 20 },
		);

		const shown = document.querySelector('[data-body]')?.textContent || '';
		expect(shown).toMatch(/temporarily paused/i);
		expect(shown).toMatch(/[Nn]othing was charged/);
		// The raw envelope must not reach the buyer.
		expect(shown).not.toMatch(/settlement_unavailable|paidEndpoint|error_description/);

		await closeModal(p);
	});

	it('autoConnect skips the picker as before when only one token is offered', async () => {
		global.fetch = vi.fn(async () => stub402([usdcAccept]));
		window.phantom.solana.connect = async () => {
			throw new Error('connect reached');
		};
		const p = pay({
			endpoint: 'https://three.ws/api/x402/dance-tip',
			merchant: 'Club',
			action: 'Tip',
			autoConnect: true,
		});
		p.catch(() => {});
		await flush();
		await flush();

		// It left the wallet picker on its own: the single-token behavior is intact.
		expect(document.querySelector('[data-wallet="phantom"]')).toBeNull();

		await closeModal(p);
	});
});

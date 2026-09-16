import { describe, expect, it } from 'vitest';
import {
	formatAmount,
	friendlyLaunchError,
	launchCost,
	launchProblems,
	normalizeSymbol,
	parseBuyIn,
	shareText,
	suggestSymbol,
} from '../src/launch/launch-model.js';
import { txPaidPlatformFee } from '../api/_lib/pump-platform-fee.js';

describe('launch model', () => {
	it('normalizes tickers to uppercase letters and digits', () => {
		expect(normalizeSymbol(' $aura-2 ')).toBe('AURA2');
		expect(normalizeSymbol('abcdefghijklmnop')).toBe('ABCDEFGHIJ');
	});

	it('suggests a ticker from a name', () => {
		expect(suggestSymbol('Neon Pilot Agent')).toBe('NPA');
		expect(suggestSymbol('Aurora')).toBe('AURORA');
		expect(suggestSymbol('')).toBe('');
	});

	it('parses dev-buy input strictly', () => {
		expect(parseBuyIn('')).toBe(0);
		expect(parseBuyIn('0.25')).toBe(0.25);
		expect(parseBuyIn('1e3')).toBeNaN();
		expect(parseBuyIn('-1')).toBeNaN();
	});

	it('lists problems top-down and clears when the form is ready', () => {
		const empty = launchProblems({});
		expect(empty.map((p) => p.field)).toEqual(['agent', 'name', 'symbol']);
		expect(launchProblems({ agentId: 'a', name: 'Aurora', symbol: 'AUR', buyIn: '0.5' })).toEqual([]);
		expect(launchProblems({ agentId: 'a', name: 'Aurora', symbol: 'AUR', buyIn: '51' })[0].field).toBe('buyIn');
		expect(launchProblems({ agentId: 'a', name: 'Aurora', symbol: 'AUR', buyIn: '51' }, { quote: 'usdc' })).toEqual([]);
	});

	it('floors the fee to base units the way the server does', () => {
		const sol = launchCost({ buyIn: 0.123456789, quote: 'sol', feeBps: 100, createCostSol: 0.022 });
		expect(sol.fee).toBeCloseTo(0.001234567, 9);
		expect(sol.totalSol).toBeCloseTo(0.022 + 0.123456789 + 0.001234567, 9);
		const usdc = launchCost({ buyIn: 25, quote: 'usdc', feeBps: 100, createCostSol: 0.022 });
		expect(usdc).toMatchObject({ quote: 'USDC', fee: 0.25, totalSol: 0.022, totalQuote: 25.25 });
		expect(launchCost({ buyIn: 0, feeBps: 100 }).fee).toBe(0);
	});

	it('formats amounts without trailing zeros', () => {
		expect(formatAmount(0.5)).toBe('0.5');
		expect(formatAmount(0.0000001)).toBe('<0.000001');
		expect(formatAmount(0)).toBe('0');
	});

	it('writes a share post that links the three.ws coin page', () => {
		const t = shareText({ name: 'Aurora', symbol: 'AUR', mint: 'M1nt', agentName: 'Aurora' });
		expect(t).toContain('$AUR');
		expect(t).toContain('https://three.ws/launches/M1nt');
	});

	it('turns wallet rejections into plain language', () => {
		expect(friendlyLaunchError({ code: 'USER_REJECTED', message: 'x' })).toMatch(/cancelled/);
		expect(friendlyLaunchError(new Error('Blockhash not found'))).toMatch(/expired/);
	});
});

describe('txPaidPlatformFee', () => {
	const recipient = 'Fee1111111111111111111111111111111111111111';
	const solTx = (delta) => ({
		transaction: { message: { accountKeys: [{ pubkey: 'Payer' }, { pubkey: recipient }] } },
		meta: { preBalances: [10_000_000, 1_000], postBalances: [9_000_000, 1_000 + delta] },
	});

	it('accepts a SOL fee that landed and rejects one that did not', () => {
		const fee = { asset: 'SOL', amount: '5000', recipient };
		expect(txPaidPlatformFee(solTx(5000), fee)).toBe(true);
		expect(txPaidPlatformFee(solTx(0), fee)).toBe(false);
		expect(txPaidPlatformFee(solTx(0), null)).toBe(true);
	});

	it('reads USDC fees from token balance deltas', () => {
		const mint = 'USDCmint';
		const tx = {
			transaction: { message: { accountKeys: [] } },
			meta: {
				preTokenBalances: [],
				postTokenBalances: [{ owner: recipient, mint, uiTokenAmount: { amount: '250000' } }],
			},
		};
		expect(txPaidPlatformFee(tx, { asset: 'USDC', amount: '250000', recipient }, mint)).toBe(true);
		expect(txPaidPlatformFee(tx, { asset: 'USDC', amount: '250001', recipient }, mint)).toBe(false);
	});
});

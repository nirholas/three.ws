// Proves api/_lib/pons.js against real Pons V2 launches on Robinhood Chain
// mainnet. The fixture holds the untouched calldata and receipt logs of three
// launches (two atomic launch-and-buys through PonsV2LaunchAndBuy, one bare
// factory launch), so every assertion below is checked against bytes the
// chain actually accepted, not against our own reading of the ABI.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodeFunctionData } from 'viem';
import {
	PONS_ABI,
	PONS_V2_FACTORY,
	PONS_V2_LAUNCH_AND_BUY,
	TOKEN_LAUNCHED_TOPIC,
	PonsError,
	buildLaunchTx,
	buildTokenParams,
	curveState,
	parseLaunchReceipt,
	quoteOpeningBuy,
	ponsCoinUrl,
} from '../api/_lib/pons.js';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/pons-v2-launches.json', import.meta.url), 'utf8'));
const byHash = Object.fromEntries(fixture.launches.map((l) => [l.hash, l]));
const CLEVO = byHash['0xfdbfb6a68bacc675e4be32fa85b83f26238a4359b536def64c52dc3ee8500fad'];
const SMALL_BUY = byHash['0x0aa42e3e96a2b2647b47de3f6c7abde822ac2f0fa0709d0156a4e1de35cf434e'];
const BARE = byHash['0x31f9b87e7d2f67deeb6f381fe38dde71c5876ed5e334ba833bcffc3f44d1b984'];

// The single live native-ETH launch config (getLaunchConfig(0)) and fee as
// read from the factory on 2026-10-08, the terms every fixture launch used.
const LIVE_TERMS = {
	launchEnabled: true,
	launchFee: 500000000000000n,
	maxCreatorTaxBps: 1000n,
	launchConfigId: 0n,
	pairToken: '0x0000000000000000000000000000000000000000',
	config: {
		supply: 1000000000000000000000000000n,
		curveFeeBps: 100n,
		phantomQuote: 1680000000000000000n,
		graduationThreshold: 4200000000000000000n,
		poolFee: 0,
		tickSpacing: 200,
		enabled: true,
	},
	expectedEconomics: '0xa9fc75d4203a33fe660e8fa32c74c3aa41c1fda4bf23d3a39b6bc22a1f8b1ca7',
};

function decode(launch) {
	return decodeFunctionData({ abi: PONS_ABI, data: launch.input });
}

describe('Pons V2 calldata, proven against mainnet', () => {
	it('rebuilds a real launchAndBuy byte-for-byte, value included', () => {
		const { functionName, args } = decode(CLEVO);
		expect(functionName).toBe('launchAndBuy');
		const [onchain, , , quoteIn, , recipient] = args;
		const params = buildTokenParams({ ...onchain });
		const tx = buildLaunchTx({ params, terms: LIVE_TERMS, quoteIn, recipient });
		expect(tx.to.toLowerCase()).toBe(CLEVO.to.toLowerCase());
		expect(tx.value).toBe(BigInt(CLEVO.value));
		// The creator pinned minTokensOut with 2% slippage; ours pins the exact
		// fill, so only that one word differs. Swap it in and compare the rest.
		const ours = decodeFunctionData({ abi: PONS_ABI, data: tx.data }).args;
		expect(ours[4]).toBeGreaterThanOrEqual(args[4]);
		const rebuilt = buildLaunchTx({ params, terms: LIVE_TERMS, quoteIn, recipient });
		const withTheirMin = rebuilt.data.replace(
			ours[4].toString(16).padStart(64, '0'),
			args[4].toString(16).padStart(64, '0'),
		);
		expect(withTheirMin).toBe(CLEVO.input);
	});

	it('rebuilds a real no-buy launch byte-for-byte against the factory', () => {
		const [onchain] = decode(BARE).args;
		const params = buildTokenParams({ ...onchain });
		const tx = buildLaunchTx({ params, terms: LIVE_TERMS, quoteIn: 0n, recipient: BARE.from });
		expect(tx.to).toBe(PONS_V2_FACTORY);
		expect(tx.value).toBe(BigInt(BARE.value));
		expect(tx.data).toBe(BARE.input);
	});

	it('targets the router the factory trusts as its launch forwarder', () => {
		expect(CLEVO.to.toLowerCase()).toBe(PONS_V2_LAUNCH_AND_BUY.toLowerCase());
		expect(BARE.to.toLowerCase()).toBe(PONS_V2_FACTORY.toLowerCase());
		expect(decode(BARE).functionName).toBe('launchToken');
	});

	it('charges launch fee plus opening buy as msg.value', () => {
		for (const launch of [CLEVO, SMALL_BUY]) {
			const quoteIn = decode(launch).args[3];
			expect(BigInt(launch.value)).toBe(LIVE_TERMS.launchFee + quoteIn);
		}
		expect(BigInt(BARE.value)).toBe(LIVE_TERMS.launchFee);
	});
});

describe('quoteOpeningBuy', () => {
	it('reproduces the exact tokens the curve paid on real launches', () => {
		for (const launch of [CLEVO, SMALL_BUY]) {
			const { args } = decode(launch);
			const parsed = parseLaunchReceipt({ logs: launch.logs });
			const quoted = quoteOpeningBuy({
				quoteIn: args[3],
				config: LIVE_TERMS.config,
				creatorTaxBps: args[0].creatorTaxBps,
			});
			expect(quoted).toBe(parsed.openingBuy.tokensOut);
		}
	});

	it('is zero for no buy and clamps at the sellable allocation', () => {
		expect(quoteOpeningBuy({ quoteIn: 0n, config: LIVE_TERMS.config })).toBe(0n);
		const huge = quoteOpeningBuy({ quoteIn: 10n ** 24n, config: LIVE_TERMS.config });
		const { supply, phantomQuote, graduationThreshold } = LIVE_TERMS.config;
		expect(huge).toBe(supply - (supply * phantomQuote) / (phantomQuote + graduationThreshold));
	});
});

describe('parseLaunchReceipt', () => {
	it('reads token, curve, deployer and the opening fill', () => {
		const r = parseLaunchReceipt({ logs: CLEVO.logs });
		expect(r.token).toBe('0x9F98d2b91b2F3d2C09d93097045E37c1e397253B');
		expect(r.curve).toBe('0x7d00D96B06488830A94b9612d410C314E9F55287');
		expect(r.deployer.toLowerCase()).toBe(CLEVO.from.toLowerCase());
		expect(r.openingBuy.quoteIn).toBe(20000000000000000n);
		expect(r.graduationThreshold).toBe(LIVE_TERMS.config.graduationThreshold);
	});

	it('reports no opening buy for a bare launch, and null without a launch', () => {
		expect(parseLaunchReceipt({ logs: BARE.logs }).openingBuy).toBeNull();
		expect(parseLaunchReceipt({ logs: [] })).toBeNull();
	});

	it('matches the factory log topic', () => {
		const factoryLog = CLEVO.logs.find((l) => l.address.toLowerCase() === PONS_V2_FACTORY.toLowerCase());
		expect(factoryLog.topics[0]).toBe(TOKEN_LAUNCHED_TOPIC);
	});
});

describe('buildTokenParams', () => {
	const base = {
		name: 'Test Coin',
		symbol: '$test',
		creatorFeeRecipient: '0x33ed46f1738a7cc093e02c747d95fbd983e7d109',
		salt: `0x${'ab'.repeat(32)}`,
	};

	it('normalises the ticker and checksums the fee recipient', () => {
		const p = buildTokenParams(base);
		expect(p.symbol).toBe('TEST');
		expect(p.creatorFeeRecipient).toBe('0x33ed46f1738a7cC093E02c747d95fbd983E7d109');
		expect(p.expectedEconomics).toBe(`0x${'0'.repeat(64)}`);
	});

	it('enforces the on-chain metadata caps before gas is spent', () => {
		expect(() => buildTokenParams({ ...base, name: 'x'.repeat(65) })).toThrow(PonsError);
		expect(() => buildTokenParams({ ...base, symbol: 'A'.repeat(17) })).toThrow(PonsError);
		expect(() => buildTokenParams({ ...base, description: 'd'.repeat(2049) })).toThrow(PonsError);
	});

	it('rejects unsafe links and malformed tickers', () => {
		expect(() => buildTokenParams({ ...base, logo: 'javascript:alert(1)' })).toThrow(/Logo/);
		expect(() => buildTokenParams({ ...base, socials: { twitter: 'http://x.com/a' } })).toThrow(/twitter/);
		expect(() => buildTokenParams({ ...base, symbol: 'NO SPACE' })).toThrow(/letters and digits/);
	});

	it('refuses a creator tax above the live ceiling', () => {
		const params = buildTokenParams({ ...base, creatorTaxBps: 1500 });
		expect(() => buildLaunchTx({ params, terms: LIVE_TERMS, recipient: base.creatorFeeRecipient })).toThrow(
			/capped at 10%/,
		);
	});
});

describe('ponsCoinUrl', () => {
	it('links the coin page on ponsfamily.com', () => {
		expect(ponsCoinUrl('0x9f98d2b91b2f3d2c09d93097045e37c1e397253b')).toBe(
			'https://ponsfamily.com/launchpad/0x9F98d2b91b2F3d2C09d93097045E37c1e397253B',
		);
	});
});

describe('curveState', () => {
	const ok = (result) => ({ status: 'success', result });
	const threshold = 4200000000000000000n;

	it('prices a live curve from its reserves and reports progress', () => {
		const s = curveState([ok([1680000000000000000n, 1000000000000000000000000000n]), ok(420000000000000000n), ok(false)], threshold);
		expect(s.graduated).toBe(false);
		expect(s.priceEth).toBeCloseTo(1.68e-9, 15);
		expect(s.progressPct).toBe(10);
	});

	it('leaves price to the V4 pool once graduated', () => {
		expect(curveState([ok([1n, 1n]), ok(threshold), ok(true)], threshold)).toEqual({ graduated: true, priceEth: null, progressPct: 100 });
	});

	it('reports nothing it could not read', () => {
		expect(curveState([{ status: 'failure' }, { status: 'failure' }, { status: 'failure' }], threshold)).toEqual({
			graduated: null,
			priceEth: null,
			progressPct: null,
		});
	});
});

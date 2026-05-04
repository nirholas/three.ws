// Tests for the pumpkit-derived helpers under api/_lib/{solana,format}.

import { describe, it, expect, vi } from 'vitest';

import {
	PUMP_PROGRAM_ID,
	PUMP_AMM_PROGRAM_ID,
	PUMP_FEE_PROGRAM_ID,
	WSOL_MINT,
	MONITORED_PROGRAM_IDS,
	CREATE_V2_DISCRIMINATOR,
	TRADE_EVENT_DISCRIMINATOR,
	matchDiscriminator,
} from '../api/_lib/solana/programs.js';

import { deriveWsUrl, RpcFallback, createRpcFallback } from '../api/_lib/solana/rpc-fallback.js';

import {
	link, bold, code, italic,
	solscanTx, solscanAccount, pumpFunToken, dexScreenerToken,
	shortenAddress, formatSol, formatUsdc, formatNumber, formatCompact, urls,
} from '../api/_lib/format/links.js';

import { loadPumpIdl, loadPumpAmmIdl, loadPumpFeesIdl, loadAllPumpIdls } from '../api/_lib/solana/idl.js';

describe('solana/programs', () => {
	it('exposes canonical mainnet program IDs', () => {
		expect(PUMP_PROGRAM_ID).toBe('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P');
		expect(PUMP_AMM_PROGRAM_ID).toBe('pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA');
		expect(PUMP_FEE_PROGRAM_ID).toBe('pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ');
		expect(WSOL_MINT).toBe('So11111111111111111111111111111111111111112');
		expect(MONITORED_PROGRAM_IDS).toHaveLength(3);
		expect(Object.isFrozen(MONITORED_PROGRAM_IDS)).toBe(true);
	});

	it('discriminators are 8-byte buffers', () => {
		expect(CREATE_V2_DISCRIMINATOR).toHaveLength(8);
		expect(TRADE_EVENT_DISCRIMINATOR).toHaveLength(8);
	});

	it('matchDiscriminator identifies known instruction prefixes', () => {
		const padded = Buffer.concat([CREATE_V2_DISCRIMINATOR, Buffer.alloc(16)]);
		expect(matchDiscriminator(padded)).toBe('create_v2');
		expect(matchDiscriminator(TRADE_EVENT_DISCRIMINATOR)).toBe('trade_event');
		expect(matchDiscriminator(Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]))).toBeNull();
		expect(matchDiscriminator(Buffer.from([0, 1, 2]))).toBeNull();
		expect(matchDiscriminator(null)).toBeNull();
	});
});

describe('solana/rpc-fallback', () => {
	it('deriveWsUrl swaps protocols', () => {
		expect(deriveWsUrl('https://rpc.example.com/solana')).toBe('wss://rpc.example.com/solana');
		expect(deriveWsUrl('http://localhost:8899')).toBe('ws://localhost:8899');
	});

	it('throws when constructed without a primary url', () => {
		expect(() => new RpcFallback({})).toThrow(/primary url/i);
	});

	it('createRpcFallback returns a working instance', () => {
		const r = createRpcFallback({ url: 'https://example.com', fallbackUrls: ['https://b.example.com'] });
		expect(r).toBeInstanceOf(RpcFallback);
		expect(r.currentUrl).toBe('https://example.com');
	});

	it('withFallback returns the fn result and reports success', async () => {
		const r = new RpcFallback({ url: 'https://a' });
		const res = await r.withFallback(async () => 42);
		expect(res).toBe(42);
		expect(r.failCounts[0]).toBe(0);
	});

	it('withFallback rotates after retryable errors', async () => {
		const r = new RpcFallback({ url: 'https://a', fallbackUrls: ['https://b'] });
		const seen = [];
		const res = await r.withFallback(async () => {
			seen.push(r.currentUrl);
			if (r.currentUrl === 'https://a') throw new Error('fetch failed');
			return 'ok';
		}).catch((e) => e);
		expect(seen[0]).toBe('https://a');
		// after enough failures it should rotate to b and succeed
		expect(res).toBe('ok');
	});

	it('withFallback re-throws non-retryable errors immediately', async () => {
		const r = new RpcFallback({ url: 'https://a', fallbackUrls: ['https://b'] });
		await expect(r.withFallback(async () => { throw new Error('403 forbidden'); })).rejects.toThrow(/403/);
	});
});

describe('format/links', () => {
	it('produces escaped HTML anchors', () => {
		expect(link('Hello & World', 'https://x.test/?a=1&b=2'))
			.toBe('<a href="https://x.test/?a=1&amp;b=2">Hello &amp; World</a>');
	});

	it('bold/code/italic wrap text', () => {
		expect(bold('x')).toBe('<b>x</b>');
		expect(code('x')).toBe('<code>x</code>');
		expect(italic('x')).toBe('<i>x</i>');
	});

	it('solscan/pumpfun/dexscreener link helpers point at the right hosts', () => {
		expect(solscanTx('SIG')).toContain('solscan.io/tx/SIG');
		expect(solscanAccount('AAAABBBBCCCCDDDDEEEE').toString()).toContain('solscan.io/account/AAAABBBBCCCCDDDDEEEE');
		expect(pumpFunToken('MINT')).toContain('pump.fun/coin/MINT');
		expect(dexScreenerToken('MINT')).toContain('dexscreener.com/solana/MINT');
		expect(urls.solscanTx('S')).toBe('https://solscan.io/tx/S');
	});

	it('shortenAddress only abbreviates long strings', () => {
		expect(shortenAddress('short')).toBe('short');
		expect(shortenAddress('AAAABBBBCCCCDDDD')).toBe('AAAA...DDDD');
		expect(shortenAddress('AAAABBBBCCCCDDDD', 2)).toBe('AA...DD');
	});

	it('formatSol scales lamports to SOL with adaptive precision', () => {
		expect(formatSol(0)).toBe('0.00 SOL');
		expect(formatSol(100_000_000)).toBe('0.1000 SOL');
		expect(formatSol(2_500_000_000)).toBe('2.50 SOL');
		expect(formatSol(1_500_000_000n)).toBe('1.50 SOL');
	});

	it('formatUsdc renders 6-decimal base units as dollars', () => {
		expect(formatUsdc(1_500_000)).toBe('$1.50');
		expect(formatUsdc(1_234_567_890)).toBe('$1,234.57');
	});

	it('formatCompact uses K/M/B/T suffixes', () => {
		expect(formatCompact(999)).toBe('999.00');
		expect(formatCompact(1_500)).toBe('1.50K');
		expect(formatCompact(1_500_000)).toBe('1.50M');
		expect(formatCompact(1_500_000_000)).toBe('1.50B');
		expect(formatCompact(1_500_000_000_000)).toBe('1.50T');
	});

	it('formatNumber adds thousands separators', () => {
		expect(formatNumber(1234567)).toBe('1,234,567');
	});
});

describe('solana/idl', () => {
	it('loads each Pump IDL with the expected program metadata', () => {
		const pump = loadPumpIdl();
		expect(pump.address || pump.metadata?.address || pump.metadata?.name || pump.name).toBeTruthy();
		const all = loadAllPumpIdls();
		expect(all).toHaveProperty('pump');
		expect(all).toHaveProperty('pump_amm');
		expect(all).toHaveProperty('pump_fees');
		expect(loadPumpAmmIdl()).toBe(all.pump_amm);
		expect(loadPumpFeesIdl()).toBe(all.pump_fees);
	});

	it('IDLs cache on repeated calls', () => {
		const a = loadPumpIdl();
		const b = loadPumpIdl();
		expect(a).toBe(b);
	});
});

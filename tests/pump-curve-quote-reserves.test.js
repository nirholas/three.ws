// Pump renamed the bonding curve's quote-side reserves when USDC became a
// possible quote asset: `virtual_sol_reserves` -> `virtual_quote_reserves` and
// `real_sol_reserves` -> `real_quote_reserves` (same u64s, same offsets). Both
// installed SDKs (@nirholas/pump-sdk and @pump-fun/pump-sdk) decode only the
// new names. Readers that still asked for `virtualSolReserves` broke in two
// ways seen in production on 2026-11-25:
//   - sdk-bridge getBondingCurveState threw "Cannot read properties of
//     undefined (reading 'toString')" on every live curve (122 times in 6h), so
//     the curve view, alpha liquidity and bonding progress lost on-chain data;
//   - the pump-fun-mcp worker and the pump-stats snapshot cron read
//     `undefined ?? '0'` and reported every live curve as 0 SOL raised.
//
// The curve account below is laid out byte for byte like the on-chain
// BondingCurve and decoded by the real SDK; only the RPC transport is stubbed.

import { describe, it, expect, vi } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import { createHash } from 'node:crypto';

const MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const RESERVES = {
	virtualToken: 1_073_000_000_000_000n,
	virtualQuote: 30_000_000_010n,
	realToken: 793_100_000_000_000n,
	realQuote: 12_000_000_000n, // 12 SOL raised
	totalSupply: 1_000_000_000_000_000n,
};

function curveAccountData() {
	const data = Buffer.alloc(151);
	createHash('sha256').update('account:BondingCurve').digest().subarray(0, 8).copy(data, 0);
	[RESERVES.virtualToken, RESERVES.virtualQuote, RESERVES.realToken, RESERVES.realQuote, RESERVES.totalSupply].forEach((v, i) =>
		data.writeBigUInt64LE(v, 8 + i * 8),
	);
	new PublicKey(MINT).toBuffer().copy(data, 49); // creator
	return data;
}

const accountInfo = () => ({ data: curveAccountData(), owner: new PublicKey('6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P'), lamports: 1, executable: false });

// The worker imports @pump-fun/pump-sdk. Keep the real decoder and only replace
// the network read so the worker sees exactly what the SDK decodes on chain.
vi.mock('@pump-fun/pump-sdk', async (importOriginal) => {
	const real = await importOriginal();
	class OnlinePumpSdk {
		async fetchBuyState() {
			return { bondingCurve: real.PUMP_SDK.decodeBondingCurve(accountInfo()) };
		}
	}
	return { ...real, OnlinePumpSdk };
});

const { getBondingCurveState } = await import('../api/_lib/solana/sdk-bridge.js');
const { curveQuoteReserve } = await import('../api/_lib/pump-curve-fields.js');
const { default: worker } = await import('../workers/pump-fun-mcp/worker.js');

describe('reading the renamed quote reserves', () => {
	it('getBondingCurveState returns the reserves of a live curve instead of throwing', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const connection = { getAccountInfo: vi.fn(async () => accountInfo()) };
		const state = await getBondingCurveState(connection, MINT);
		expect(warn).not.toHaveBeenCalled();
		warn.mockRestore();
		expect(state).toEqual({
			virtualTokenReserves: RESERVES.virtualToken.toString(),
			virtualSolReserves: RESERVES.virtualQuote.toString(),
			realTokenReserves: RESERVES.realToken.toString(),
			realSolReserves: RESERVES.realQuote.toString(),
			tokenTotalSupply: RESERVES.totalSupply.toString(),
			complete: false,
			creator: MINT,
			isMayhemMode: false,
		});
	});

	it('curveQuoteReserve reads the current names and falls back to the legacy ones', async () => {
		const { PUMP_SDK } = await import('@nirholas/pump-sdk');
		const decoded = PUMP_SDK.decodeBondingCurve(accountInfo());
		expect(curveQuoteReserve(decoded, 'real')).toBe(RESERVES.realQuote.toString());
		expect(curveQuoteReserve(decoded, 'virtual')).toBe(RESERVES.virtualQuote.toString());
		expect(curveQuoteReserve({ realSolReserves: 5n }, 'real')).toBe('5');
		expect(curveQuoteReserve({}, 'virtual')).toBeNull();
		expect(curveQuoteReserve(null, 'real')).toBeNull();
	});

	it('the pump-fun-mcp worker reports the SOL a live curve has raised', async () => {
		const res = await worker.fetch(
			new Request('https://pump-fun-mcp.example/', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_bonding_curve', arguments: { mint: MINT } } }),
			}),
			{ SOLANA_RPC_URL: 'http://127.0.0.1:1' },
		);
		const json = await res.json();
		const out = json.result.structuredContent ?? JSON.parse(json.result.content[0].text);
		expect(out.solReserves).toBe('12.0000');
		expect(out.virtualSolReserves).toBe(RESERVES.virtualQuote.toString());
		expect(out.graduationPercent).toBeGreaterThan(0);
	});
});

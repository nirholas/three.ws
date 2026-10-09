// Balance readers of the fresh-wallet workers lane
// (api/_lib/x402/fresh-workers/chain.js). These two reads gate every tick: the
// SOL funder's headroom over the sponsor floor and the treasury's USDC. Both
// once read the { info, cause } wrapper returned by readAccountInfoOrNull as if
// it were the account, so every balance came back 0 and the lane skipped with
// funder_headroom on every tick from launch, never minting a single wallet.
//
// What these lock down, for both readers:
//   • a funded account reports its real balance.
//   • an account that does not exist reads as empty (0 / exists:false).
//   • an RPC transport failure reads as unknown (null), never as zero.

import { describe, it, expect, vi } from 'vitest';

import { readSolLamports, readUsdc } from '../api/_lib/x402/fresh-workers/chain.js';

const PUBKEY = 'WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW';

const connReturning = (value) => ({ getAccountInfo: vi.fn(async () => value) });
const connFailing = () => ({
	getAccountInfo: vi.fn(async () => { throw Object.assign(new Error('fetch failed'), { name: 'TypeError' }); }),
});

function tokenAccountData(amount) {
	const data = Buffer.alloc(165);
	data.writeBigUInt64LE(BigInt(amount), 64);
	return data;
}

describe('readSolLamports', () => {
	it('returns the live lamports of a funded account', async () => {
		expect(await readSolLamports(connReturning({ lamports: 651_828, data: Buffer.alloc(0) }), PUBKEY)).toBe(651_828);
	});

	it('returns 0 for an account that does not exist', async () => {
		expect(await readSolLamports(connReturning(null), PUBKEY)).toBe(0);
	});

	it('returns null, not 0, when the RPC is unreachable', async () => {
		expect(await readSolLamports(connFailing(), PUBKEY)).toBeNull();
	});
});

describe('readUsdc', () => {
	it('returns the atomic amount held by an existing token account', async () => {
		expect(await readUsdc(connReturning({ lamports: 2_039_280, data: tokenAccountData(2_587_000) }), PUBKEY))
			.toEqual({ exists: true, atomic: 2_587_000n });
	});

	it('reports a missing token account as not existing', async () => {
		expect(await readUsdc(connReturning(null), PUBKEY)).toEqual({ exists: false, atomic: 0n });
	});

	it('returns null when the RPC is unreachable', async () => {
		expect(await readUsdc(connFailing(), PUBKEY)).toBeNull();
	});
});

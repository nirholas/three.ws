// Who pays the Solana fee on a ring sweep or float move. A dry sponsor used to
// be asked to pay regardless, so every sweep failed with "insufficient funds for
// rent" on account 0 and the ring stopped settling (2026-10-03). The source
// wallet now pays its own fee whenever the sponsor visibly cannot.
import { describe, it, expect, vi } from 'vitest';
import { Keypair } from '@solana/web3.js';
import {
	canPayFee,
	resolveFeePayer,
	RENT_EXEMPT_SYSTEM_LAMPORTS,
} from '../api/_lib/x402/pipelines/ring-rebalance.js';

const sponsor = Keypair.generate();
const treasury = Keypair.generate();
const connWith = (getBalance) => ({ getBalance: vi.fn(getBalance) });

describe('canPayFee', () => {
	it('refuses a wallet at or under the rent-exempt minimum', () => {
		expect(canPayFee(651_828)).toBe(false);
		expect(canPayFee(RENT_EXEMPT_SYSTEM_LAMPORTS)).toBe(false);
	});

	it('accepts a wallet with room for the fee above rent', () => {
		expect(canPayFee(2_000_000)).toBe(true);
	});
});

describe('resolveFeePayer', () => {
	it('keeps the sponsor when it can afford the fee', async () => {
		const conn = connWith(async () => 5_000_000);
		expect(await resolveFeePayer(conn, sponsor, treasury)).toBe(sponsor);
	});

	it('falls back to the moving wallet when the sponsor is below rent', async () => {
		const conn = connWith(async () => 651_828);
		expect(await resolveFeePayer(conn, sponsor, treasury)).toBe(treasury);
	});

	it('keeps the sponsor when its balance cannot be read', async () => {
		const conn = connWith(async () => {
			throw new Error('rpc down');
		});
		expect(await resolveFeePayer(conn, sponsor, treasury)).toBe(sponsor);
	});

	it('uses the fallback without an RPC call when no sponsor is configured', async () => {
		const conn = connWith(async () => 0);
		expect(await resolveFeePayer(conn, null, treasury)).toBe(treasury);
		expect(conn.getBalance).not.toHaveBeenCalled();
	});
});

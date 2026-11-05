// A venue SDK can hand back its own ComputeBudget instructions. The compiled
// transaction must carry exactly one limit and one price instruction (a
// duplicate makes the RPC refuse it), and ours must win.

import { describe, it, expect, vi } from 'vitest';
import { ComputeBudgetProgram, Keypair, SystemProgram, TransactionInstruction } from '@solana/web3.js';

vi.mock('../api/_lib/db.js', () => ({ sql: vi.fn() }));
const { compile } = await import('../api/_lib/lending/service.js');

const owner = Keypair.generate().publicKey;
const conn = { getLatestBlockhash: async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 10 }) };

describe('compile', () => {
	it('drops venue compute-budget instructions so there is only one limit', async () => {
		const venueLimit = ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 });
		const transfer = SystemProgram.transfer({ fromPubkey: owner, toPubkey: Keypair.generate().publicKey, lamports: 1 });
		const { vtx } = await compile(conn, owner.toBase58(), [venueLimit, transfer], [], 400_000);
		const budget = vtx.message.compiledInstructions.filter((ix) => vtx.message.staticAccountKeys[ix.programIdIndex].equals(ComputeBudgetProgram.programId));
		const limits = budget.filter((ix) => ix.data[0] === 2);
		expect(limits).toHaveLength(1);
		expect(Buffer.from(limits[0].data).readUInt32LE(1)).toBe(400_000);
		expect(budget.filter((ix) => ix.data[0] === 3)).toHaveLength(1);
		expect(vtx.message.compiledInstructions).toHaveLength(3);
	});
});

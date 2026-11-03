// The pre-broadcast recording hook and the on-chain verdicts that settle a
// withdrawal whose payout may have been broadcast. The Solana Connection and the
// EVM client are hand-built boundaries (no RPC); the engine, the transaction
// bytes and the verdict logic are real.

import { describe, it, expect, vi } from 'vitest';
import { Keypair, SystemProgram, VersionedTransaction } from '@solana/web3.js';
import { submitProtected } from '../api/_lib/execution-engine.js';
import { checkSolanaSend, checkEvmSend } from '../api/_lib/withdrawal-chain-status.js';

function engineConnection(events) {
	return {
		getLatestBlockhash: vi.fn(async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 4242 })),
		simulateTransaction: vi.fn(async () => ({ value: { err: null, unitsConsumed: 50_000, logs: [] } })),
		getRecentPrioritizationFees: vi.fn(async () => [{ prioritizationFee: 1000 }]),
		sendRawTransaction: vi.fn(async (raw) => {
			events.push({ kind: 'broadcast', raw });
			return 'sig';
		}),
		getSignatureStatuses: vi.fn(async () => ({ value: [{ err: null, confirmationStatus: 'confirmed', slot: 7 }], context: { slot: 7 } })),
		getSignatureStatus: vi.fn(async () => ({ value: { err: null, confirmationStatus: 'confirmed', slot: 7 } })),
		getBlockHeight: vi.fn(async () => 10),
	};
}

describe('submitProtected onSigned hook', () => {
	const payer = Keypair.generate();
	const ix = () => [SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1000 })];

	it('hands over the signature of the exact transaction, before it is broadcast', async () => {
		const events = [];
		const conn = engineConnection(events);
		const result = await submitProtected({
			network: 'devnet',
			connection: conn,
			payer,
			instructions: ix(),
			opts: { onSigned: async (signed) => { events.push({ kind: 'recorded', ...signed }); } },
		});

		const kinds = events.map((e) => e.kind);
		expect(kinds.indexOf('recorded')).toBeGreaterThanOrEqual(0);
		expect(kinds.indexOf('recorded')).toBeLessThan(kinds.indexOf('broadcast'));

		const recorded = events.find((e) => e.kind === 'recorded');
		expect(recorded.signature).toBe(result.signature);
		expect(recorded.lastValidBlockHeight).toBe(4242);

		const sent = VersionedTransaction.deserialize(events.find((e) => e.kind === 'broadcast').raw);
		expect(sent.signatures.some((s) => s.some((b) => b !== 0))).toBe(true);
	});

	it('never broadcasts when the record cannot be written', async () => {
		const events = [];
		const conn = engineConnection(events);
		await expect(
			submitProtected({
				network: 'devnet',
				connection: conn,
				payer,
				instructions: ix(),
				opts: { onSigned: async () => { throw new Error('db down'); } },
			}),
		).rejects.toMatchObject({ code: 'PRESEND_RECORD_FAILED' });
		expect(conn.sendRawTransaction).not.toHaveBeenCalled();
	});
});

describe('checkSolanaSend', () => {
	const row = (attempts) => ({ chain: 'solana', send_attempts: attempts });
	const conn = ({ statuses, height }) => ({
		getSignatureStatuses: vi.fn(async () => ({ value: statuses })),
		getBlockHeight: vi.fn(async () => height),
	});

	it('is confirmed when any attempt landed, even if a later one never did', async () => {
		const verdict = await checkSolanaSend(
			row([{ signature: 'A', lastValidBlockHeight: 100 }, { signature: 'B', lastValidBlockHeight: 200 }]),
			{ connection: conn({ statuses: [null, { err: null, confirmationStatus: 'finalized' }], height: 10 }) },
		);
		expect(verdict).toEqual({ state: 'confirmed', signature: 'B' });
	});

	it('stays pending while any attempt is inside its landing window', async () => {
		const verdict = await checkSolanaSend(
			row([{ signature: 'A', lastValidBlockHeight: 100 }]),
			{ connection: conn({ statuses: [null], height: 100 }) },
		);
		expect(verdict.state).toBe('pending');
	});

	it('expires only after every unlanded attempt is past its window', async () => {
		const verdict = await checkSolanaSend(
			row([{ signature: 'A', lastValidBlockHeight: 100 }, { signature: 'B', lastValidBlockHeight: 200 }]),
			{ connection: conn({ statuses: [null, null], height: 150 }) },
		);
		expect(verdict.state).toBe('pending');
		const later = await checkSolanaSend(
			row([{ signature: 'A', lastValidBlockHeight: 100 }, { signature: 'B', lastValidBlockHeight: 200 }]),
			{ connection: conn({ statuses: [null, null], height: 201 }) },
		);
		expect(later.state).toBe('expired');
	});

	it('treats an on-chain revert as no movement of funds', async () => {
		const verdict = await checkSolanaSend(row([{ signature: 'A', lastValidBlockHeight: 100 }]), {
			connection: conn({ statuses: [{ err: { InstructionError: [0, 'Custom'] } }], height: 10 }),
		});
		expect(verdict.state).toBe('expired');
	});

	it('never declares an attempt dead when its window was not recorded', async () => {
		const verdict = await checkSolanaSend(row([{ signature: 'A', lastValidBlockHeight: null }]), {
			connection: conn({ statuses: [null], height: 99_999_999 }),
		});
		expect(verdict.state).toBe('pending');
	});

	it('falls back to the single persisted signature when no attempt list exists', async () => {
		const verdict = await checkSolanaSend(
			{ chain: 'solana', send_attempts: [], send_signature: 'A', last_valid_block_height: 100 },
			{ connection: conn({ statuses: [{ err: null, confirmationStatus: 'confirmed' }], height: 10 }) },
		);
		expect(verdict).toEqual({ state: 'confirmed', signature: 'A' });
	});
});

describe('checkEvmSend', () => {
	const notFound = Object.assign(new Error('not found'), { name: 'TransactionReceiptNotFoundError' });
	const client = ({ nonceCount, receipts }) => ({
		getTransactionCount: vi.fn(async () => nonceCount),
		getTransactionReceipt: vi.fn(async ({ hash }) => {
			if (!receipts[hash]) throw notFound;
			return receipts[hash];
		}),
	});
	const row = { chain: 'base', send_attempts: [{ signature: '0xabc', nonce: 7 }], send_nonce: 7 };
	const deps = (c) => ({ client: c, treasury: '0x0000000000000000000000000000000000000001' });

	it('is confirmed on a successful receipt', async () => {
		const verdict = await checkEvmSend(row, deps(client({ nonceCount: 8, receipts: { '0xabc': { status: 'success' } } })));
		expect(verdict).toEqual({ state: 'confirmed', signature: '0xabc' });
	});

	it('stays pending while the nonce is still open', async () => {
		const verdict = await checkEvmSend(row, deps(client({ nonceCount: 7, receipts: {} })));
		expect(verdict.state).toBe('pending');
	});

	it('expires when the nonce was consumed by another transaction', async () => {
		const verdict = await checkEvmSend(row, deps(client({ nonceCount: 8, receipts: {} })));
		expect(verdict.state).toBe('expired');
	});

	it('expires when the transaction reverted', async () => {
		const verdict = await checkEvmSend(row, deps(client({ nonceCount: 8, receipts: { '0xabc': { status: 'reverted' } } })));
		expect(verdict.state).toBe('expired');
	});
});

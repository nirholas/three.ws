// The self-hosted Solana facilitator checks buyer signatures and blockhash
// liveness before /verify answers valid.
//
// verify used to prove only that the authority was LISTED as a signer and then
// simulate with sigVerify:false and a replaced blockhash, so:
//   - a transfer naming any funded wallet, with garbage signatures, verified as
//     valid and the paid handler ran before settle failed;
//   - a transfer signed against a dead blockhash verified, then settle resent it
//     with preflight off, timed out, and answered `pending`, which the resource
//     server delivers on. The buyer never paid and could repeat it forever.

import { describe, it, expect } from 'vitest';
import { Keypair, TransactionMessage, VersionedTransaction, SystemProgram } from '@solana/web3.js';
import { verifyBuyerSignatures, blockhashIsLive } from '../api/_lib/x402/self-facilitator.js';

const BLOCKHASH = '11111111111111111111111111111111';

function txSignedBy(payerKp, signer = payerKp, feePayer = payerKp.publicKey) {
	const ix = SystemProgram.transfer({ fromPubkey: payerKp.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 });
	const msg = new TransactionMessage({ payerKey: feePayer, recentBlockhash: BLOCKHASH, instructions: [ix] }).compileToV0Message();
	const tx = new VersionedTransaction(msg);
	if (signer) tx.sign([signer]);
	return tx;
}

describe('verifyBuyerSignatures', () => {
	it('accepts a self-pay transaction the buyer really signed', () => {
		const buyer = Keypair.generate();
		const tx = txSignedBy(buyer);
		expect(verifyBuyerSignatures({ tx, feePayer: buyer.publicKey.toBase58(), selfPay: true })).toEqual({ ok: true });
	});

	it('refuses a transaction signed by a different key than the listed authority', () => {
		const victim = Keypair.generate();
		const attacker = Keypair.generate();
		const tx = txSignedBy(victim, null);
		tx.signatures[0] = attacker.secretKey.slice(0, 64);
		const r = verifyBuyerSignatures({ tx, feePayer: victim.publicKey.toBase58(), selfPay: true });
		expect(r.ok).toBe(false);
		expect(r.reason).toMatch(/^invalid_signature:/);
	});

	it('refuses an unsigned (all-zero) buyer slot', () => {
		const buyer = Keypair.generate();
		const tx = txSignedBy(buyer, null);
		const r = verifyBuyerSignatures({ tx, feePayer: buyer.publicKey.toBase58(), selfPay: true });
		expect(r).toEqual({ ok: false, reason: `missing_signature:${buyer.publicKey.toBase58()}` });
	});

	it('skips only the sponsor slot in sponsor mode, and still checks the buyer', () => {
		const buyer = Keypair.generate();
		const sponsor = Keypair.generate();
		const ix = SystemProgram.transfer({ fromPubkey: buyer.publicKey, toPubkey: Keypair.generate().publicKey, lamports: 1 });
		const msg = new TransactionMessage({ payerKey: sponsor.publicKey, recentBlockhash: BLOCKHASH, instructions: [ix] }).compileToV0Message();
		const signed = new VersionedTransaction(msg);
		signed.sign([buyer]);
		expect(verifyBuyerSignatures({ tx: signed, feePayer: sponsor.publicKey.toBase58(), selfPay: false })).toEqual({ ok: true });

		const forged = new VersionedTransaction(msg);
		const r = verifyBuyerSignatures({ tx: forged, feePayer: sponsor.publicKey.toBase58(), selfPay: false });
		expect(r).toEqual({ ok: false, reason: `missing_signature:${buyer.publicKey.toBase58()}` });
	});
});

describe('blockhashIsLive', () => {
	it('reports a live blockhash', async () => {
		const conn = { isBlockhashValid: async () => ({ value: true }) };
		expect(await blockhashIsLive(conn, BLOCKHASH, { recheckMs: 0 })).toBe(true);
	});

	it('re-asks once before believing a dead blockhash', async () => {
		let calls = 0;
		const conn = { isBlockhashValid: async () => { calls += 1; return { value: calls > 1 }; } };
		expect(await blockhashIsLive(conn, BLOCKHASH, { recheckMs: 1 })).toBe(true);
		const dead = { isBlockhashValid: async () => ({ value: false }) };
		expect(await blockhashIsLive(dead, BLOCKHASH, { recheckMs: 1 })).toBe(false);
	});

	it('answers unknown (null) when the RPC cannot say, so an outage never fails a payment on its own', async () => {
		const down = { isBlockhashValid: async () => { throw new Error('rpc down'); } };
		expect(await blockhashIsLive(down, BLOCKHASH, { recheckMs: 0 })).toBeNull();
		expect(await blockhashIsLive({}, BLOCKHASH)).toBeNull();
	});
});

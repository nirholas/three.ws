import { describe, it, expect } from 'vitest';
import { Keypair, VersionedTransaction } from '@solana/web3.js';

// While the sponsor wallet sits under its SOL floor, x402-spec.js advertises the
// Solana accept WITHOUT extra.feePayer (the self-pay contract). The in-house
// payer used to read accept.extra.feePayer unconditionally, so `new PublicKey(
// undefined)` threw and every seeder/showcase purchase answered 500 flow_failed.
// These tests decode the signed transaction and assert who pays the fee.

const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
process.env.X402_ASSET_MINT_SOLANA = USDC;

const { buildSolanaPaymentPayload } = await import('../api/x402-pay.js');

const buyer = Keypair.generate();
const conn = {
	getAccountInfo: async () => ({ lamports: 1 }),
	getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 1 }),
};

function accept(extra) {
	return {
		scheme: 'exact',
		network: 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp',
		asset: USDC,
		payTo: Keypair.generate().publicKey.toBase58(),
		amount: '1000',
		extra,
	};
}

function signedPayer(payload) {
	const vtx = VersionedTransaction.deserialize(Buffer.from(payload.payload.transaction, 'base64'));
	return vtx.message.staticAccountKeys[0].toBase58();
}

describe('buildSolanaPaymentPayload fee payer', () => {
	it('makes the buyer its own fee payer when the accept advertises none (self-pay)', async () => {
		const payload = await buildSolanaPaymentPayload({
			accept: accept({ name: 'USDC', decimals: 6 }), buyer, conn, resourceUrl: 'https://three.ws/api/x402/crypto-intel',
		});
		expect(signedPayer(payload)).toBe(buyer.publicKey.toBase58());
	});

	it('keeps the advertised sponsor as fee payer when there is one', async () => {
		const sponsor = Keypair.generate().publicKey.toBase58();
		const payload = await buildSolanaPaymentPayload({
			accept: accept({ name: 'USDC', decimals: 6, feePayer: sponsor }), buyer, conn, resourceUrl: 'https://three.ws/api/x402/crypto-intel',
		});
		expect(signedPayer(payload)).toBe(sponsor);
	});
});

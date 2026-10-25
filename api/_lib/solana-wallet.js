// Solana wallet adapter — produces the `ctx.wallet` contract used by signing skills
// (pump-fun-trade, jupiter-swap, etc). Built on top of recoverSolanaAgentKeypair.

import { Connection, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import { solanaConnection } from './solana/connection.js';
import { confirmOrThrow } from './solana/confirm.js';
import { recoverSolanaAgentKeypair } from './agent-wallet.js';

/**
 * Build a wallet from an encrypted secret. Returns the contract:
 *   { publicKey, signTransaction(tx), sendAndConfirm(tx, conn) }
 * publicKey is a PublicKey (not a string) so it can be used with web3.js directly.
 */
export async function loadWallet(encryptedSecret, audit) {
	if (!audit?.agentId) {
		throw Object.assign(new Error('loadWallet requires audit.agentId so the signing mode is enforced and the key use is recorded'), {
			status: 500,
			code: 'audit_required',
		});
	}
	const kp = await recoverSolanaAgentKeypair(encryptedSecret, audit);

	function signTransaction(tx) {
		if (tx instanceof VersionedTransaction) {
			tx.sign([kp]);
		} else if (tx instanceof Transaction) {
			tx.partialSign(kp);
		} else {
			throw new Error('signTransaction: unsupported tx type');
		}
		return tx;
	}

	// NOT routed through submitProtected: this is a generic signer used by signing
	// skills (pump-fun-trade, jupiter-swap) that hand us an already-built tx, not
	// raw instructions — so the instruction-rebuilding protected sender doesn't
	// apply. We broadcast the caller's tx and confirm via confirmOrThrow (a revert
	// throws). Skills that DO have instructions should prefer submitProtected.
	async function sendAndConfirm(tx, conn) {
		signTransaction(tx);
		const raw = tx.serialize();
		const sig = await conn.sendRawTransaction(raw, { skipPreflight: false });
		const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
		await confirmOrThrow(
			conn,
			{ signature: sig, blockhash, lastValidBlockHeight },
			'confirmed',
		);
		return sig;
	}

	return { publicKey: kp.publicKey, signTransaction, sendAndConfirm };
}

/**
 * Convenience: build a Connection from a URL, defaulting to mainnet.
 */
export function makeConnection(rpcUrl) {
	return solanaConnection({ url: rpcUrl ?? 'https://api.mainnet-beta.solana.com', commitment: 'confirmed' });
}

export { PublicKey };

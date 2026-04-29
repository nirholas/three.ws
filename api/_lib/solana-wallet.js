// Solana wallet adapter — produces the `ctx.wallet` contract used by signing skills
// (pump-fun-trade, jupiter-swap, etc). Built on top of recoverSolanaAgentKeypair.

import { Connection, PublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import { recoverSolanaAgentKeypair } from './agent-wallet.js';

/**
 * Build a wallet from an encrypted secret. Returns the contract:
 *   { publicKey, signTransaction(tx), sendAndConfirm(tx, conn) }
 * publicKey is a PublicKey (not a string) so it can be used with web3.js directly.
 */
export async function loadWallet(encryptedSecret) {
	const kp = await recoverSolanaAgentKeypair(encryptedSecret);

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

	async function sendAndConfirm(tx, conn) {
		signTransaction(tx);
		const raw = tx.serialize();
		const sig = await conn.sendRawTransaction(raw, { skipPreflight: false });
		const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash();
		await conn.confirmTransaction(
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
	return new Connection(rpcUrl ?? 'https://api.mainnet-beta.solana.com', 'confirmed');
}

export { PublicKey };

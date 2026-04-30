import { Connection, PublicKey, Transaction, Keypair } from '@solana/web3.js';
import {
	getAssociatedTokenAddress,
	createAssociatedTokenAccountInstruction,
	createTransferInstruction,
} from '@solana/spl-token';
import bs58 from 'bs58';

const SOLANA_RPC = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

/**
 * Transfer SPL tokens from the platform treasury to a recipient address.
 * @param {object} opts
 * @param {string} opts.fromWallet   base58-encoded treasury keypair (64 bytes)
 * @param {string} opts.toAddress    recipient Solana address
 * @param {bigint|number} opts.amount  token amount in smallest units (e.g. 6-decimal USDC)
 * @param {string} opts.mint         SPL mint address
 * @returns {Promise<string>}        transaction signature
 */
export async function transferSolanaUSDC({ fromWallet, toAddress, amount, mint }) {
	const kp = Keypair.fromSecretKey(bs58.decode(fromWallet));
	const mintPubkey = new PublicKey(mint);
	const recipientPubkey = new PublicKey(toAddress);

	const connection = new Connection(SOLANA_RPC, 'confirmed');

	const senderATA = await getAssociatedTokenAddress(mintPubkey, kp.publicKey);
	const recipientATA = await getAssociatedTokenAddress(mintPubkey, recipientPubkey);

	const tx = new Transaction();

	const recipientAccount = await connection.getAccountInfo(recipientATA);
	if (!recipientAccount) {
		tx.add(createAssociatedTokenAccountInstruction(kp.publicKey, recipientATA, recipientPubkey, mintPubkey));
	}

	tx.add(createTransferInstruction(senderATA, recipientATA, kp.publicKey, BigInt(amount)));

	const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
	tx.feePayer = kp.publicKey;
	tx.recentBlockhash = blockhash;

	tx.sign(kp);
	const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: false });
	await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
	return sig;
}

// Funding helpers shared by the devnet smoke scripts. A funder keypair file
// (SMOKE_FUNDER_KEYPAIR) is preferred; otherwise the devnet faucet is tried with
// backoff, because the public faucet rate-limits aggressively.
import fs from 'node:fs';
import { Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function loadKeypair(file) {
	return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, 'utf8'))));
}

export async function airdrop(conn, pubkey, sol) {
	let lastErr;
	for (let attempt = 0; attempt < 6; attempt++) {
		try {
			const sig = await conn.requestAirdrop(pubkey, Math.round(sol * LAMPORTS_PER_SOL));
			await conn.confirmTransaction(sig, 'confirmed');
			return;
		} catch (e) {
			lastErr = e;
			await sleep(2000 * (attempt + 1));
		}
	}
	throw new Error(`devnet airdrop failed after retries: ${lastErr?.message}. Set SMOKE_FUNDER_KEYPAIR to a funded devnet keypair file.`);
}

/** Make sure `kp` holds at least `minSol`, from the funder file if set, else the faucet. */
export async function ensureSol(conn, kp, minSol) {
	const have = await conn.getBalance(kp.publicKey);
	if (have >= minSol * LAMPORTS_PER_SOL) return;
	const need = minSol * LAMPORTS_PER_SOL - have;
	if (process.env.SMOKE_FUNDER_KEYPAIR) {
		const funder = loadKeypair(process.env.SMOKE_FUNDER_KEYPAIR);
		const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: kp.publicKey, lamports: need }));
		await sendAndConfirmTransaction(conn, tx, [funder], { commitment: 'confirmed' });
		return;
	}
	await airdrop(conn, kp.publicKey, Math.ceil(need / LAMPORTS_PER_SOL));
}

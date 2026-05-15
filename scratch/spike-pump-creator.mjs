// Spike: prove pump.fun `create_v2` accepts `creator != user` (signer).
// Devnet only. Generates fresh keypairs, airdrops, builds + sends a create_v2
// transaction, then reads the resulting BondingCurve account and asserts
// bondingCurve.creator == payoutOwner.publicKey while the signer was visitor.

import {
	Connection,
	Keypair,
	PublicKey,
	TransactionMessage,
	VersionedTransaction,
	LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { PumpSdk, bondingCurvePda } from '@pump-fun/pump-sdk';

const RPC = process.env.SOLANA_RPC_URL_DEVNET || 'https://api.devnet.solana.com';
const conn = new Connection(RPC, 'confirmed');

const payoutOwner = Keypair.generate(); // becomes BondingCurve.creator — never signs
const visitor = Keypair.generate();      // signs + pays
const mint = Keypair.generate();         // new mint keypair

console.log('payoutOwner:', payoutOwner.publicKey.toBase58());
console.log('visitor    :', visitor.publicKey.toBase58());
console.log('mint       :', mint.publicKey.toBase58());

async function airdrop(pubkey, sol) {
	for (let attempt = 1; attempt <= 8; attempt++) {
		try {
			const sig = await conn.requestAirdrop(pubkey, sol * LAMPORTS_PER_SOL);
			const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
			await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
			const bal = await conn.getBalance(pubkey);
			console.log(`airdropped ${sol} SOL → ${pubkey.toBase58()} (balance: ${bal / LAMPORTS_PER_SOL} SOL) [attempt ${attempt}]`);
			return;
		} catch (e) {
			console.log(`  airdrop attempt ${attempt} failed: ${e.message}; retrying in ${attempt * 2}s`);
			await new Promise((r) => setTimeout(r, attempt * 2000));
		}
	}
	throw new Error('airdrop failed after 8 attempts');
}

// Devnet faucet caps single requests at ~1 SOL. Two requests give us headroom.
await airdrop(visitor.publicKey, 1);
await airdrop(visitor.publicKey, 1);

const sdk = new PumpSdk();
const ix = await sdk.createV2Instruction({
	mint: mint.publicKey,
	name: 'CreatorSplitTest',
	symbol: 'CST',
	uri: 'https://example.invalid/meta.json',
	creator: payoutOwner.publicKey, // <-- DIFFERENT from signer
	user: visitor.publicKey,         // <-- the only signer
	mayhemMode: false,
});

const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
const msg = new TransactionMessage({
	payerKey: visitor.publicKey,
	recentBlockhash: blockhash,
	instructions: [ix],
}).compileToV0Message();
const vtx = new VersionedTransaction(msg);
vtx.sign([visitor, mint]); // payoutOwner does NOT sign

console.log('\nsubmitting tx...');
const sig = await conn.sendTransaction(vtx, { skipPreflight: false });
console.log('signature:', sig);

await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
console.log('confirmed.');

const bcPda = bondingCurvePda(mint.publicKey);
console.log('\nBondingCurve PDA:', bcPda.toBase58());

const acct = await conn.getAccountInfo(bcPda);
if (!acct) throw new Error('bonding curve account not found post-tx');

// BondingCurve layout (from IDL):
//  8 bytes discriminator
//  6 × u64 (virt_token, virt_quote, real_token, real_quote, total_supply, ...)
//  Actually per IDL: virtual_token_reserves u64, virtual_quote_reserves u64,
//  real_token_reserves u64, real_quote_reserves u64, token_total_supply u64,
//  complete bool (1 byte), creator pubkey (32 bytes), is_mayhem_mode bool,
//  is_cashback_coin bool, quote_mint pubkey.
const d = acct.data;
const off = 8 + 5 * 8 + 1; // after disc + 5 u64s + complete bool
const creatorBytes = d.slice(off, off + 32);
const creatorOnChain = new PublicKey(creatorBytes);

console.log('\nBondingCurve.creator on-chain:', creatorOnChain.toBase58());
console.log('Expected (payoutOwner)        :', payoutOwner.publicKey.toBase58());
console.log('Actual signer (visitor)       :', visitor.publicKey.toBase58());

if (creatorOnChain.equals(payoutOwner.publicKey)) {
	console.log('\n✅ PROVEN: BondingCurve.creator was set to a pubkey that NEVER signed.');
	console.log('   The launchpad architecture is empirically confirmed on devnet.');
} else {
	console.log('\n❌ Unexpected: BondingCurve.creator does not match payoutOwner.');
	console.log('   Investigate offset / layout. Raw account data (hex):');
	console.log(d.toString('hex'));
	process.exit(1);
}

console.log('\nDevnet explorer:');
console.log(`  https://solscan.io/tx/${sig}?cluster=devnet`);
console.log(`  https://solscan.io/account/${bcPda.toBase58()}?cluster=devnet`);

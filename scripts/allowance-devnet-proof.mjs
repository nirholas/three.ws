#!/usr/bin/env node
// Devnet end-to-end proof for owner-funded agent budgets (api/_lib/onchain-allowance.js).
//
// Runs the full lifecycle against the real Subscriptions program on devnet with
// throwaway keypairs and a throwaway mint:
//   create -> pull within cap -> over-cap refused by the guard AND by the program
//   -> revoke -> post-revoke refused by the guard AND by the program.
// Prints every signature. Refuses to run against anything but devnet.
//
//   node scripts/allowance-devnet-proof.mjs
//   DEVNET_RPC_URL=https://... node scripts/allowance-devnet-proof.mjs

import { Connection, Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token';
import {
	prepareCreateAllowance,
	prepareRevokeAllowance,
	checkAllowancePull,
	buildSignedPull,
	describeProgramFailure,
	readAllowance,
} from '../api/_lib/onchain-allowance.js';

const RPC = process.env.DEVNET_RPC_URL || 'https://api.devnet.solana.com';
const network = 'devnet';
const DECIMALS = 6;
const unit = (n) => BigInt(Math.round(n * 10 ** DECIMALS));
const conn = new Connection(RPC, 'confirmed');

// DEVNET_GENESIS is the real cluster. A local validator that cloned the program
// from devnet (LOCAL_VALIDATOR=1, http://127.0.0.1) is accepted only for fast
// iteration; the recorded transcript for the work order is the devnet run.
const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const local = process.env.LOCAL_VALIDATOR === '1' && /^http:\/\/(127\.0\.0\.1|localhost)/.test(RPC);
if (!local) {
	const genesis = await conn.getGenesisHash();
	if (genesis !== DEVNET_GENESIS) {
		console.error(`refusing to run: genesis ${genesis} is not devnet`);
		process.exit(2);
	}
}

const transcript = [];
const step = (name, data) => {
	transcript.push({ step: name, ...data });
	console.log(`\n== ${name}`);
	for (const [k, v] of Object.entries(data)) console.log(`   ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
};

async function fund(kp, sol) {
	for (let attempt = 0; attempt < 4; attempt++) {
		try {
			const sig = await conn.requestAirdrop(kp.publicKey, Math.round(sol * LAMPORTS_PER_SOL));
			const bh = await conn.getLatestBlockhash();
			await conn.confirmTransaction({ signature: sig, ...bh }, 'confirmed');
			return;
		} catch (e) {
			if (attempt === 3) throw e;
			await new Promise((r) => setTimeout(r, 2500 * (attempt + 1)));
		}
	}
}

async function signAndSend(base64, signer) {
	const tx = Transaction.from(Buffer.from(base64, 'base64'));
	tx.partialSign(signer);
	const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false });
	const bh = await conn.getLatestBlockhash();
	await conn.confirmTransaction({ signature: sig, ...bh }, 'confirmed');
	return sig;
}

async function simulateRejection(tx) {
	const sim = await conn.simulateTransaction(tx);
	if (!sim.value.err) return { rejected: false };
	const logs = (sim.value.logs || []).join('\n');
	return { rejected: true, err: JSON.stringify(sim.value.err), message: describeProgramFailure(new Error(`${JSON.stringify(sim.value.err)}\n${logs}`)) };
}

const owner = Keypair.generate();
const agent = Keypair.generate();
await fund(owner, 1.5);
await fund(agent, 0.5);
step('keys', { owner: owner.publicKey.toBase58(), agent: agent.publicKey.toBase58(), rpc: RPC });

const mint = await createMint(conn, owner, owner.publicKey, null, DECIMALS);
const ownerAta = await getOrCreateAssociatedTokenAccount(conn, owner, mint, owner.publicKey);
await mintTo(conn, owner, mint, ownerAta.address, owner, unit(1000));
step('mint', { mint: mint.toBase58(), ownerTokenAccount: ownerAta.address.toBase58(), ownerBalance: '1000' });

const CAP = unit(100);
const prep = await prepareCreateAllowance({
	network,
	owner: owner.publicKey.toBase58(),
	delegatee: agent.publicKey.toBase58(),
	mint: mint.toBase58(),
	amount: CAP,
	expiryTs: Math.floor(Date.now() / 1000) + 3600,
	connection: conn,
});
const createSig = await signAndSend(prep.transaction, owner);
step('create allowance (owner-signed)', { signature: createSig, delegationPda: prep.delegationPda, cap: '100', initializesAuthority: prep.initializesAuthority });

const common = { network, kind: 'fixed', delegationPda: prep.delegationPda, connection: conn };

const okCheck = await checkAllowancePull({ ...common, amount: unit(40) });
const pull = await buildSignedPull({ ...common, owner: owner.publicKey.toBase58(), mint: mint.toBase58(), amount: unit(40), agentKeypair: agent });
const pullSig = await conn.sendRawTransaction(pull.tx.serialize());
await conn.confirmTransaction({ signature: pullSig, blockhash: pull.blockhash, lastValidBlockHeight: pull.lastValidBlockHeight }, 'confirmed');
const afterPull = await readAllowance(common);
step('pull 40 within cap (agent-signed)', { guard: okCheck.code, signature: pullSig, remainingOnChain: `${Number(afterPull.remaining) / 10 ** DECIMALS}` });

const overCheck = await checkAllowancePull({ ...common, amount: unit(80) });
const overTx = await buildSignedPull({ ...common, owner: owner.publicKey.toBase58(), mint: mint.toBase58(), amount: unit(80), agentKeypair: agent });
const overSim = await simulateRejection(overTx.tx);
step('pull 80 over remaining 60', { guardCode: overCheck.code, guardAllow: overCheck.allow, programRejected: overSim.rejected, programError: overSim.message });

const rev = await prepareRevokeAllowance({ network, owner: owner.publicKey.toBase58(), delegationPda: prep.delegationPda, connection: conn });
const revokeSig = await signAndSend(rev.transaction, owner);
step('revoke (owner-signed)', { signature: revokeSig });

const postCheck = await checkAllowancePull({ ...common, amount: unit(10) });
const postTx = await buildSignedPull({ ...common, owner: owner.publicKey.toBase58(), mint: mint.toBase58(), amount: unit(10), agentKeypair: agent });
const postSim = await simulateRejection(postTx.tx);
step('pull 10 after revoke', { guardCode: postCheck.code, guardAllow: postCheck.allow, programRejected: postSim.rejected, programError: postSim.message });

const failures = [];
if (okCheck.allow !== true) failures.push('guard should allow an in-cap pull');
if (overCheck.allow !== false || overCheck.code !== 'allowance_exceeded') failures.push('guard should refuse an over-cap pull');
if (!overSim.rejected) failures.push('program should reject an over-cap pull');
if (postCheck.allow !== false || postCheck.code !== 'no_allowance') failures.push('guard should refuse a post-revoke pull');
if (!postSim.rejected) failures.push('program should reject a post-revoke pull');
if (failures.length) {
	console.error('\nFAILED:\n - ' + failures.join('\n - '));
	process.exit(1);
}
console.log('\nOK: all five lifecycle assertions held on devnet');
console.log(JSON.stringify({ signatures: { create: createSig, pull: pullSig, revoke: revokeSig } }, null, 2));

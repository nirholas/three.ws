#!/usr/bin/env node
// Devnet proof for the open Solana agent registry (api/_lib/solana-8004.js).
//
// With throwaway keypairs it registers an agent through the same SDK path the
// platform authority uses, has a second wallet leave feedback, then reads the
// agent back and prints its trust tier and score. No database, no real funds.
// Refuses to run against anything but devnet (a local validator that cloned the
// registry programs from devnet is accepted with LOCAL_VALIDATOR=1).
//
//   node scripts/prove-8004-registry.mjs
//   DEVNET_RPC_URL=https://... node scripts/prove-8004-registry.mjs

import { Connection, Keypair, LAMPORTS_PER_SOL, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { build8004Sdk, read8004Standing, registryProgramIds } from '../api/_lib/solana-8004.js';

const RPC = process.env.DEVNET_RPC_URL || 'https://api.devnet.solana.com';
const DEVNET_GENESIS = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const local = process.env.LOCAL_VALIDATOR === '1' && /^http:\/\/(127\.0\.0\.1|localhost)/.test(RPC);
const conn = new Connection(RPC, 'confirmed');

if (!local && (await conn.getGenesisHash()) !== DEVNET_GENESIS) {
	console.error('refusing to run: the RPC is not devnet');
	process.exit(2);
}

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

const ids = await registryProgramIds('devnet');
console.log('registry program:', ids.registry);
console.log('atom engine     :', ids.atomEngine);

const authority = Keypair.generate();
const reviewer = Keypair.generate();
await fund(authority, 1);
if (process.env.FUND_REVIEWER_FROM_AUTHORITY === '1') {
	const tx = new Transaction().add(
		SystemProgram.transfer({ fromPubkey: authority.publicKey, toPubkey: reviewer.publicKey, lamports: 0.1 * LAMPORTS_PER_SOL }),
	);
	await sendAndConfirmTransaction(conn, tx, [authority]);
} else {
	await fund(reviewer, 1);
}

const sdk = await build8004Sdk('devnet', { signer: authority, rpcUrl: RPC });
const uri = `https://three.ws/api/agents/00000000-0000-4000-8000-000000000000/registration`;
const reg = await sdk.registerAgent(uri, { atomEnabled: true });
const asset = reg.asset.toBase58();
console.log('\nregistered asset :', asset);
console.log('register tx      :', reg.signature);

const before = await read8004Standing(asset, 'devnet', { sdk });
console.log('standing (new)   :', JSON.stringify(before));

const reviewerSdk = await build8004Sdk('devnet', { signer: reviewer, rpcUrl: RPC });
const fb = await reviewerSdk.giveFeedback(reg.asset, { value: '90', score: 90, tag1: 'quality', feedbackUri: '' });
console.log('feedback tx      :', fb.signature);

const after = await read8004Standing(asset, 'devnet', { sdk });
console.log('standing (after) :', JSON.stringify(after));
if (!after.registered || after.total_feedbacks < 1) {
	console.error('read-back did not show the feedback');
	process.exit(1);
}
console.log('\nOK');

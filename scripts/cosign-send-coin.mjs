#!/usr/bin/env node
// Co-signs a partial-signed pump.fun create-coin tx (from build-create-coin-tx.mjs)
// using a local Solana keypair file, then submits to the configured RPC.
//
// Usage: SOLANA_RPC_URL=... node scripts/cosign-send-coin.mjs \
//   --build-json /tmp/coin-build.json --keypair www-vanity.json --mint-keypair test-mint.json

import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import {
	Connection,
	Keypair,
	VersionedTransaction,
	PublicKey,
} from '@solana/web3.js';

const { values } = parseArgs({
	options: {
		'build-json':    { type: 'string' },
		keypair:         { type: 'string' },
		'mint-keypair':  { type: 'string' },
		'dry-run':       { type: 'boolean', default: false },
	},
	strict: true,
});

const buildPath = values['build-json'];
const keypairPath = values.keypair;
const mintKeypairPath = values['mint-keypair'];
const dryRun = Boolean(values['dry-run']);
if (!buildPath || !keypairPath || !mintKeypairPath) {
	console.error('usage: --build-json <path> --keypair <path> --mint-keypair <path> [--dry-run]');
	process.exit(1);
}

const rpcUrl = process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
if (!rpcUrl) { console.error('set SOLANA_RPC_URL'); process.exit(1); }

const build = JSON.parse(readFileSync(buildPath, 'utf8'));
const signer = Keypair.fromSecretKey(new Uint8Array(JSON.parse(readFileSync(keypairPath, 'utf8'))));
const mintKp = Keypair.fromSecretKey(new Uint8Array(JSON.parse(readFileSync(mintKeypairPath, 'utf8'))));
if (mintKp.publicKey.toBase58() !== build.mintPublicKey) {
	console.error(`mint keypair mismatch: file=${mintKp.publicKey.toBase58()} build=${build.mintPublicKey}`);
	process.exit(1);
}
const txBytes = Buffer.from(build.transaction, 'base64');
const tx = VersionedTransaction.deserialize(txBytes);

const conn = new Connection(rpcUrl, 'confirmed');

console.log('signer       :', signer.publicKey.toBase58());
console.log('mint         :', build.mintPublicKey);
console.log('rpc          :', rpcUrl);
console.log('init buy SOL :', (build.solLamports / 1e9).toFixed(6));
console.log('tokenizedAgent:', build.tokenizedAgent, 'buybackBps:', build.buybackBps);

const balance = await conn.getBalance(signer.publicKey);
console.log('signer balance:', (balance / 1e9).toFixed(9), 'SOL');
if (balance < build.solLamports + 0.01 * 1e9) {
	console.error(`insufficient balance: need ~${(build.solLamports / 1e9 + 0.01).toFixed(4)} SOL, have ${(balance/1e9).toFixed(6)}`);
	process.exit(2);
}

const accountKeys = tx.message.staticAccountKeys.map(k => k.toBase58());
console.log('fee payer    :', accountKeys[tx.message.header.numRequiredSignatures > 0 ? 0 : -1]);
const numSigners = tx.message.header.numRequiredSignatures;
console.log('required sigs:', numSigners);

console.log('\nrefreshing blockhash + signing with [signer, mint]…');
const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
tx.message.recentBlockhash = blockhash;
tx.sign([signer, mintKp]);

console.log('\nsimulating…');
const sim = await conn.simulateTransaction(tx, { sigVerify: true, replaceRecentBlockhash: false });
if (sim.value.err) {
	console.error('SIM FAILED:', JSON.stringify(sim.value.err));
	if (sim.value.logs) console.error('logs:\n' + sim.value.logs.join('\n'));
	process.exit(3);
}
console.log('  units consumed:', sim.value.unitsConsumed);
console.log('  ok ✓');

if (dryRun) {
	console.log('\n--dry-run: not sending. Re-run without --dry-run to submit.');
	process.exit(0);
}

console.log('\nsending…');
const sig = await conn.sendRawTransaction(tx.serialize(), {
	skipPreflight: false,
	maxRetries: 3,
});
console.log('  sig:', sig);

console.log('\nconfirming…');
const conf = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
if (conf.value.err) {
	console.error('CONFIRM FAILED:', JSON.stringify(conf.value.err));
	console.error('explorer: https://solscan.io/tx/' + sig);
	process.exit(4);
}

console.log('\n✦ launched');
console.log('  mint:    ', build.mintPublicKey);
console.log('  pump.fun: https://pump.fun/coin/' + build.mintPublicKey);
console.log('  solscan: https://solscan.io/tx/' + sig);

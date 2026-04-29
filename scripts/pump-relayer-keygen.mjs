#!/usr/bin/env node
// Generate a Solana keypair for the pump.fun trade relayer.
// Prints the base64-encoded secret key + base58 pubkey.
//
// Usage:
//   node scripts/pump-relayer-keygen.mjs
//
// Then set in your env (Vercel project / .env.local):
//   PUMP_RELAYER_SECRET_KEY_B64=<the base64 string>
//
// Fund the printed pubkey with a small amount of SOL (mainnet) or use
// `solana airdrop 1 <pubkey> --url devnet` for devnet testing.

import { Keypair } from '@solana/web3.js';

const kp = Keypair.generate();
const secretB64 = Buffer.from(kp.secretKey).toString('base64');

console.log('Pump relayer keypair (KEEP SECRET KEY PRIVATE):');
console.log('  pubkey: ', kp.publicKey.toBase58());
console.log('  secret base64: ', secretB64);
console.log('');
console.log('Add to env:');
console.log(`  PUMP_RELAYER_SECRET_KEY_B64='${secretB64}'`);
console.log('');
console.log('Fund the pubkey with SOL before serving relay-trade requests.');

import bs58 from 'bs58';
import { readFileSync } from 'node:fs';
import { Keypair } from '@solana/web3.js';
const arr = JSON.parse(readFileSync('/home/codespace/.config/x402-test-wallets/solana.json', 'utf8'));
const kp = Keypair.fromSecretKey(Uint8Array.from(arr));
console.log('public:', kp.publicKey.toBase58());
console.log('SECRET_BASE58:', bs58.encode(Uint8Array.from(arr)));

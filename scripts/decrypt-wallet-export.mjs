#!/usr/bin/env node
// Decrypt a three.ws wallet export file offline.
//
//   node scripts/decrypt-wallet-export.mjs <export.json>
//
// Prompts for the passphrase you chose in the export dialog (input is read from
// the terminal, not from argv, so it stays out of shell history) and prints the
// 64-byte Solana keypair as a JSON array that `solana-keygen` and most wallets
// import. Run it on a machine you trust: the output is the plaintext key.

import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { decryptKeyEnvelope } from '../src/wallet/export.js';

const file = process.argv[2];
if (!file) {
	console.error('usage: node scripts/decrypt-wallet-export.mjs <export.json>');
	process.exit(2);
}

let envelope;
try {
	envelope = JSON.parse(await readFile(file, 'utf8'));
} catch (err) {
	console.error(`could not read ${file}: ${err.message}`);
	process.exit(2);
}

const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
rl._writeToOutput = (s) => { if (s.includes('Passphrase')) process.stderr.write(s); };
const passphrase = await new Promise((resolve) => rl.question('Passphrase: ', resolve));
rl.close();
process.stderr.write('\n');

try {
	const key = await decryptKeyEnvelope(envelope, passphrase);
	console.log(JSON.stringify(Array.from(key)));
} catch (err) {
	console.error(err.message);
	process.exit(1);
}

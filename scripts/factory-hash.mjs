#!/usr/bin/env node
// Compiles ThreeWSFactory.sol and prints the initCodeHash for vanity grinding.
// No constructor args — factory has no constructor parameters.
//
// Usage: node scripts/factory-hash.mjs

import solc from 'solc';
import { readFileSync } from 'node:fs';
import { keccak256, getBytes } from 'ethers';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(resolve(root, 'contracts/ThreeWSFactory.sol'), 'utf8');

process.stdout.write('compiling… ');
const output = JSON.parse(solc.compile(JSON.stringify({
  language: 'Solidity',
  sources: { 'ThreeWSFactory.sol': { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { '*': { '*': ['evm.bytecode.object'] } },
  },
})));

const errs = (output.errors || []).filter(e => e.severity === 'error');
if (errs.length) { errs.forEach(e => console.error(e.formattedMessage)); process.exit(1); }
console.log('ok');

const bytecode = '0x' + output.contracts['ThreeWSFactory.sol']['ThreeWSFactory'].evm.bytecode.object;
const initCodeHash = keccak256(getBytes(bytecode));

const ARACHNID = '0x4e59b44847b379578588920cA78FbF26c0B4956C';

console.log('\n─────────────────────────────────────────');
console.log('ThreeWSFactory initcode hash');
console.log('─────────────────────────────────────────');
console.log('factory (Arachnid):', ARACHNID);
console.log('initcode size:     ', bytecode.length / 2 - 1, 'bytes');
console.log('initcode hash:     ', initCodeHash);
console.log('─────────────────────────────────────────');
console.log('\nNext steps:');
console.log('1. Open http://localhost:3000/eth-vanity → Smart contract (CREATE2) tab');
console.log('2. Factory: Arachnid proxy', ARACHNID);
console.log('3. Init code hash:', initCodeHash);
console.log('4. Prefix: 0000000 (7 zeros)');
console.log('5. Grind → paste salt + address here');

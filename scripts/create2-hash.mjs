// Compiles ThreeWSPayments.sol, encodes the constructor arg (owner address),
// and prints the initcode hash needed by the /eth-vanity CREATE2 grinder.
//
// Usage:
//   node scripts/create2-hash.mjs <owner-address>
//   node scripts/create2-hash.mjs 0xYourWallet
//
// Paste the output "initcode hash" into three.ws/eth-vanity,
// set the factory to Arachnid (0x4e59b44847b379578588920cA78FbF26c0B4956C),
// and grind for prefix "333".

import solc from 'solc';
import { readFileSync } from 'node:fs';
import { keccak256, AbiCoder, getBytes, hexlify } from 'ethers';

const ownerArg = process.argv[2];
if (!ownerArg || !/^0x[0-9a-fA-F]{40}$/.test(ownerArg)) {
  console.error('usage: node scripts/create2-hash.mjs 0xYOUR_OWNER_ADDRESS');
  process.exit(1);
}

const source = readFileSync(new URL('../contracts/ThreeWSPayments.sol', import.meta.url), 'utf8');

const input = {
  language: 'Solidity',
  sources: { 'ThreeWSPayments.sol': { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { '*': { '*': ['evm.bytecode.object', 'abi'] } },
  },
};

process.stdout.write('compiling… ');
const output = JSON.parse(solc.compile(JSON.stringify(input)));
const errors = (output.errors || []).filter(e => e.severity === 'error');
if (errors.length) {
  console.error('\ncompile errors:');
  errors.forEach(e => console.error(e.formattedMessage));
  process.exit(1);
}
console.log('ok');

const contract = output.contracts['ThreeWSPayments.sol']['ThreeWSPayments'];
const bytecode = contract.evm.bytecode.object;

// ABI-encode the constructor argument (address owner)
const abiCoder = new AbiCoder();
const encodedArgs = abiCoder.encode(['address'], [ownerArg]).slice(2); // strip 0x

const initcode = '0x' + bytecode + encodedArgs;
const initcodeHash = keccak256(getBytes(initcode));

const FACTORY = '0x4e59b44847b379578588920cA78FbF26c0B4956C';

console.log('\n─────────────────────────────────────────');
console.log('ThreeWSPayments initcode hash');
console.log('─────────────────────────────────────────');
console.log('owner:         ', ownerArg);
console.log('factory:       ', FACTORY);
console.log('initcode size: ', (initcode.length / 2 - 1), 'bytes');
console.log('initcode hash: ', initcodeHash);
console.log('─────────────────────────────────────────');
console.log('\nNext steps:');
console.log('1. Open https://three.ws/eth-vanity');
console.log('2. Factory: Arachnid proxy (0x4e59b44847b379578588920cA78FbF26c0B4956C)');
console.log('3. Paste initcode hash:', initcodeHash);
console.log('4. Prefix: 333  (or 333333 for more 3s — takes a few seconds)');
console.log('5. Click Grind → copy the salt');
console.log('6. Run: node scripts/create2-deploy.mjs <salt>');

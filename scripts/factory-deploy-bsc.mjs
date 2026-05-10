#!/usr/bin/env node
// Deploys ThreeWSFactory to a CREATE2 vanity address on BNB Smart Chain
// using the Arachnid deterministic deployment proxy.
//
// Usage:
//   PK=0x... SALT=0x... EXPECTED=0x... node scripts/factory-deploy-bsc.mjs

import {
  createPublicClient, createWalletClient, http,
  getCreate2Address, keccak256, parseGwei,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';
import solc from 'solc';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FACTORY = '0x4e59b44847b379578588920cA78FbF26c0B4956C';
const RPC     = process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org/';

const PK       = process.env.PK;
const SALT     = process.env.SALT;
const EXPECTED = process.env.EXPECTED;

if (!PK || !SALT) {
  console.error('Required: PK=0x... SALT=0x... [EXPECTED=0x...]');
  process.exit(1);
}

// 1) Compile ThreeWSFactory.sol
const source = readFileSync(resolve(root, 'contracts/ThreeWSFactory.sol'), 'utf8');
process.stdout.write('compiling… ');
const compiled = JSON.parse(solc.compile(JSON.stringify({
  language: 'Solidity',
  sources: { 'ThreeWSFactory.sol': { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { '*': { '*': ['evm.bytecode.object'] } },
  },
})));
const errs = (compiled.errors || []).filter(e => e.severity === 'error');
if (errs.length) { errs.forEach(e => console.error(e.formattedMessage)); process.exit(1); }
console.log('ok');

const bytecode = '0x' + compiled.contracts['ThreeWSFactory.sol']['ThreeWSFactory'].evm.bytecode.object;
const initCodeHash = keccak256(bytecode);

// 2) Predict address
const predicted = getCreate2Address({ from: FACTORY, salt: SALT, bytecodeHash: initCodeHash });
console.log('\nArachnid factory:', FACTORY);
console.log('salt:            ', SALT);
console.log('initCodeHash:    ', initCodeHash);
console.log('predicted:       ', predicted);

if (EXPECTED && EXPECTED.toLowerCase() !== predicted.toLowerCase()) {
  console.error(`\n❌ Predicted ${predicted} ≠ EXPECTED ${EXPECTED}`);
  process.exit(1);
}

// 3) Check if already deployed
const account = privateKeyToAccount(PK.startsWith('0x') ? PK : '0x' + PK);
const pub = createPublicClient({ chain: bsc, transport: http(RPC) });
const existing = await pub.getCode({ address: predicted }).catch(() => undefined);
if (existing && existing !== '0x') {
  console.log('\n✓ Already deployed at', predicted);
  process.exit(0);
}

// 4) Check balance
const bnb = await pub.getBalance({ address: account.address });
console.log('\nDeployer :', account.address);
console.log('BNB      :', Number(bnb) / 1e18);

// 5) Deploy via Arachnid: salt || initCode
const wallet = createWalletClient({ account, chain: bsc, transport: http(RPC) });
const txData = (SALT + bytecode.slice(2));
console.log('\nSending tx to Arachnid…');
const hash = await wallet.sendTransaction({
  to: FACTORY,
  data: txData,
  gas: 800_000n,
  gasPrice: parseGwei('1'),
});
console.log('tx hash :', hash);
console.log('bscscan : https://bscscan.com/tx/' + hash);

const rcpt = await pub.waitForTransactionReceipt({ hash });
console.log('status  :', rcpt.status);
console.log('gas used:', rcpt.gasUsed.toString());

const codeAfter = await pub.getCode({ address: predicted }).catch(() => undefined);
if (codeAfter !== undefined && codeAfter === '0x') {
  console.error('❌ Factory not found at predicted address after deploy');
  process.exit(1);
}

console.log('\n✅ ThreeWSFactory deployed at:', predicted);
console.log('   bscscan: https://bscscan.com/address/' + predicted);
console.log('\nNext: grind ThreeWSPayments using your factory as deployer');
console.log('  Factory:', predicted);
console.log('  Run:    node scripts/create2-hash.mjs <owner-address>');
console.log('  Then open eth-vanity with factory =', predicted);

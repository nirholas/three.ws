#!/usr/bin/env node
// Deploys ThreeWSPayments to a CREATE2 vanity address on BNB Smart Chain
// via ThreeWSFactory (not Arachnid directly).
//
// Usage:
//   PK=0x... \
//   OWNER=0x4022de2d36c334e73c7a108805cea11c0564f402 \
//   SALT=0x... \
//   EXPECTED=0x... \
//   node scripts/payments-deploy-bsc.mjs

import {
  createPublicClient, createWalletClient, http,
  encodeAbiParameters, getCreate2Address,
  keccak256, concatHex, encodeFunctionData, parseGwei,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';
import solc from 'solc';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const FACTORY = process.env.FACTORY || '0x00000000D49195AE81759cd247cFeDD9D0B479df';
const USDC    = '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d'; // BSC USDC
const RPC     = process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org/';

const PK       = process.env.PK;
const OWNER    = process.env.OWNER || '0x4022de2d36c334e73c7a108805cea11c0564f402';
const SALT     = process.env.SALT;
const EXPECTED = process.env.EXPECTED;

if (!PK || !SALT) {
  console.error('Required: PK=0x... SALT=0x... [EXPECTED=0x...]');
  process.exit(1);
}

// 1) Compile ThreeWSPayments.sol
const source = readFileSync(resolve(root, 'contracts/ThreeWSPayments.sol'), 'utf8');
process.stdout.write('compiling… ');
const compiled = JSON.parse(solc.compile(JSON.stringify({
  language: 'Solidity',
  sources: { 'ThreeWSPayments.sol': { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { '*': { '*': ['evm.bytecode.object', 'abi'] } },
  },
})));
const errs = (compiled.errors || []).filter(e => e.severity === 'error');
if (errs.length) { errs.forEach(e => console.error(e.formattedMessage)); process.exit(1); }
console.log('ok');

const bytecode = '0x' + compiled.contracts['ThreeWSPayments.sol']['ThreeWSPayments'].evm.bytecode.object;
const args = encodeAbiParameters(
  [{ type: 'address' }, { type: 'address' }],
  [OWNER, USDC]
);
const initCode = concatHex([bytecode, args]);
const initCodeHash = keccak256(initCode);

// 2) Predict address via ThreeWSFactory
const predicted = getCreate2Address({ from: FACTORY, salt: SALT, bytecodeHash: initCodeHash });
console.log('\nThreeWSFactory :', FACTORY);
console.log('owner          :', OWNER);
console.log('usdc           :', USDC);
console.log('salt           :', SALT);
console.log('initCodeHash   :', initCodeHash);
console.log('predicted      :', predicted);

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

// 5) Deploy via ThreeWSFactory.deploy(salt, initCode)
const wallet = createWalletClient({ account, chain: bsc, transport: http(RPC) });
const calldata = encodeFunctionData({
  abi: [{ name: 'deploy', type: 'function', inputs: [{ type: 'bytes32' }, { type: 'bytes' }], outputs: [{ type: 'address' }] }],
  functionName: 'deploy',
  args: [SALT, initCode],
});

console.log('\nDeploying via ThreeWSFactory…');
const hash = await wallet.sendTransaction({
  to: FACTORY,
  data: calldata,
  gas: 2_000_000n,
  gasPrice: parseGwei('1'),
});
console.log('tx hash  :', hash);
console.log('bscscan  : https://bscscan.com/tx/' + hash);

const rcpt = await pub.waitForTransactionReceipt({ hash });
console.log('status   :', rcpt.status);
console.log('gas used :', rcpt.gasUsed.toString());

const codeAfter = await pub.getCode({ address: predicted }).catch(() => undefined);
if (codeAfter !== undefined && codeAfter === '0x') {
  console.error('❌ Contract not found at predicted address');
  process.exit(1);
}

console.log('\n✅ ThreeWSPayments deployed at:', predicted);
console.log('   bscscan: https://bscscan.com/address/' + predicted);
console.log('\nNext: verify on BSCScan, then update X402_PAY_TO_BASE in Vercel env');

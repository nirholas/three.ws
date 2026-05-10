#!/usr/bin/env node
// Deploys ThreeWSPayments to a vanity address on any EVM chain
// via ThreeWSFactory.
//
// Usage:
//   CHAIN=base|arbitrum|bsc \
//   PK=0x... \
//   SALT=0x... \
//   EXPECTED=0x... \
//   node scripts/payments-deploy-chain.mjs

import {
  createPublicClient, createWalletClient, http,
  encodeAbiParameters, getCreate2Address,
  keccak256, concatHex, encodeFunctionData, parseGwei,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, arbitrum, bsc } from 'viem/chains';
import solc from 'solc';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FACTORY = '0x00000000D49195AE81759cd247cFeDD9D0B479df';

const CHAINS = {
  base:     { chain: base,     usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', rpc: process.env.BASE_RPC_URL || 'https://rpc.ankr.com/base',     gasPrice: parseGwei('0.01'), explorer: 'https://basescan.org' },
  arbitrum: { chain: arbitrum, usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', rpc: process.env.ARB_RPC_URL  || 'https://rpc.ankr.com/arbitrum', gasPrice: parseGwei('0.1'),  explorer: 'https://arbiscan.io' },
  bsc:      { chain: bsc,      usdc: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', rpc: process.env.BSC_RPC_URL  || 'https://bsc-dataseed.binance.org/', gasPrice: parseGwei('1'), explorer: 'https://bscscan.com' },
};

const CHAIN_NAME = process.env.CHAIN;
const PK         = process.env.PK;
const OWNER      = process.env.OWNER || '0x4022de2d36c334e73c7a108805cea11c0564f402';
const SALT       = process.env.SALT;
const EXPECTED   = process.env.EXPECTED;

if (!CHAIN_NAME || !CHAINS[CHAIN_NAME]) { console.error('Required: CHAIN=base|arbitrum|bsc'); process.exit(1); }
if (!PK || !SALT) { console.error('Required: PK=0x... SALT=0x...'); process.exit(1); }

const { chain, usdc, rpc, gasPrice, explorer } = CHAINS[CHAIN_NAME];

process.stdout.write('compiling… ');
const source = readFileSync(resolve(root, 'contracts/ThreeWSPayments.sol'), 'utf8');
const compiled = JSON.parse(solc.compile(JSON.stringify({
  language: 'Solidity',
  sources: { 'ThreeWSPayments.sol': { content: source } },
  settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { '*': { '*': ['evm.bytecode.object'] } } },
})));
const errs = (compiled.errors || []).filter(e => e.severity === 'error');
if (errs.length) { errs.forEach(e => console.error(e.formattedMessage)); process.exit(1); }
console.log('ok');

const bytecode = '0x' + compiled.contracts['ThreeWSPayments.sol']['ThreeWSPayments'].evm.bytecode.object;
const args = encodeAbiParameters([{ type: 'address' }, { type: 'address' }], [OWNER, usdc]);
const initCode = concatHex([bytecode, args]);
const initCodeHash = keccak256(initCode);
const predicted = getCreate2Address({ from: FACTORY, salt: SALT, bytecodeHash: initCodeHash });

console.log(`\nchain    : ${CHAIN_NAME}`);
console.log(`factory  : ${FACTORY}`);
console.log(`owner    : ${OWNER}`);
console.log(`usdc     : ${usdc}`);
console.log(`salt     : ${SALT}`);
console.log(`predicted: ${predicted}`);

if (EXPECTED && EXPECTED.toLowerCase() !== predicted.toLowerCase()) {
  console.error(`\n❌ Predicted ${predicted} ≠ EXPECTED ${EXPECTED}`);
  process.exit(1);
}

const account = privateKeyToAccount(PK.startsWith('0x') ? PK : '0x' + PK);
const pub = createPublicClient({ chain, transport: http(rpc) });
const existing = await pub.getCode({ address: predicted }).catch(() => undefined);
if (existing && existing !== '0x') {
  console.log(`\n✓ Already deployed at ${predicted}`);
  process.exit(0);
}

const bnb = await pub.getBalance({ address: account.address });
console.log(`\ndeployer : ${account.address}`);
console.log(`balance  : ${(Number(bnb) / 1e18).toFixed(6)}`);

const wallet = createWalletClient({ account, chain, transport: http(rpc) });
const calldata = encodeFunctionData({
  abi: [{ name: 'deploy', type: 'function', inputs: [{ type: 'bytes32' }, { type: 'bytes' }], outputs: [{ type: 'address' }] }],
  functionName: 'deploy',
  args: [SALT, initCode],
});

console.log(`\ndeploying via ThreeWSFactory…`);
const hash = await wallet.sendTransaction({ to: FACTORY, data: calldata, gas: 2_000_000n, gasPrice });
console.log(`tx     : ${explorer}/tx/${hash}`);
const rcpt = await pub.waitForTransactionReceipt({ hash, timeout: 300_000 });
console.log(`status : ${rcpt.status}`);
console.log(`\n✅ ThreeWSPayments on ${CHAIN_NAME}: ${explorer}/address/${predicted}`);

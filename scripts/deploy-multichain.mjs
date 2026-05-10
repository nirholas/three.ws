#!/usr/bin/env node
// Deploys ThreeWSFactory + ThreeWSPayments to the same vanity addresses
// across Ethereum, Base, Arbitrum, and BNB Smart Chain.
//
// Prerequisites:
//   - Fund PK wallet with native gas on each chain
//   - Set FACTORY_SALT + PAYMENTS_SALT after grinding
//
// Usage:
//   PK=0x... \
//   OWNER=0x4022de2d36c334e73c7a108805cea11c0564f402 \
//   FACTORY_SALT=0xfc1ecd1953bb17cf798c1eaeed287873008f3a3038f438e9e74c3b33ce370ef5 \
//   PAYMENTS_SALT=0x... \
//   node scripts/deploy-multichain.mjs

import {
  createPublicClient, createWalletClient, http,
  getCreate2Address, keccak256, encodeAbiParameters, concatHex, parseGwei,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet, base, arbitrum, bsc } from 'viem/chains';
import solc from 'solc';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ARACHNID = '0x4e59b44847b379578588920cA78FbF26c0B4956C';

const PK            = process.env.PK;
const OWNER         = process.env.OWNER || '0x4022de2d36c334e73c7a108805cea11c0564f402';
const FACTORY_SALT  = process.env.FACTORY_SALT  || '0xfc1ecd1953bb17cf798c1eaeed287873008f3a3038f438e9e74c3b33ce370ef5';
const PAYMENTS_SALT = process.env.PAYMENTS_SALT;

if (!PK) { console.error('Required: PK=0x...'); process.exit(1); }
if (!PAYMENTS_SALT) { console.error('Required: PAYMENTS_SALT=0x... (grind it first at three.ws/eth-vanity)'); process.exit(1); }

const CHAINS = [
  {
    chain: mainnet,
    name: 'Ethereum',
    rpc: process.env.ETH_RPC_URL || 'https://eth.llamarpc.com',
    usdc: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    gasPrice: parseGwei('5'),
    explorer: 'https://etherscan.io',
  },
  {
    chain: base,
    name: 'Base',
    rpc: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    gasPrice: parseGwei('0.01'),
    explorer: 'https://basescan.org',
  },
  {
    chain: arbitrum,
    name: 'Arbitrum',
    rpc: process.env.ARB_RPC_URL || 'https://arb1.arbitrum.io/rpc',
    usdc: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    gasPrice: parseGwei('0.1'),
    explorer: 'https://arbiscan.io',
  },
  {
    chain: bsc,
    name: 'BSC',
    rpc: process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org/',
    usdc: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
    gasPrice: parseGwei('1'),
    explorer: 'https://bscscan.com',
  },
];

// Compile contracts
process.stdout.write('compiling contracts… ');
const factorySrc  = readFileSync(resolve(root, 'contracts/ThreeWSFactory.sol'), 'utf8');
const paymentsSrc = readFileSync(resolve(root, 'contracts/ThreeWSPayments.sol'), 'utf8');

const compiled = JSON.parse(solc.compile(JSON.stringify({
  language: 'Solidity',
  sources: {
    'ThreeWSFactory.sol':  { content: factorySrc },
    'ThreeWSPayments.sol': { content: paymentsSrc },
  },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { '*': { '*': ['evm.bytecode.object'] } },
  },
})));
const errs = (compiled.errors || []).filter(e => e.severity === 'error');
if (errs.length) { errs.forEach(e => console.error(e.formattedMessage)); process.exit(1); }
console.log('ok');

const factoryBytecode  = '0x' + compiled.contracts['ThreeWSFactory.sol']['ThreeWSFactory'].evm.bytecode.object;
const paymentsBytecode = '0x' + compiled.contracts['ThreeWSPayments.sol']['ThreeWSPayments'].evm.bytecode.object;
const factoryInitCodeHash = keccak256(factoryBytecode);

const FACTORY_ADDR = getCreate2Address({ from: ARACHNID, salt: FACTORY_SALT, bytecodeHash: factoryInitCodeHash });
console.log('\nThreeWSFactory  :', FACTORY_ADDR, '(same on all chains)');

const account = privateKeyToAccount(PK.startsWith('0x') ? PK : '0x' + PK);
console.log('Deployer wallet :', account.address);
console.log('Owner           :', OWNER);
console.log('');

async function deployToChain({ chain, name, rpc, usdc, gasPrice, explorer }) {
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`${name}`);
  console.log(`${'─'.repeat(50)}`);

  const pub    = createPublicClient({ chain, transport: http(rpc) });
  const wallet = createWalletClient({ account, chain, transport: http(rpc) });

  const bal = await pub.getBalance({ address: account.address });
  console.log(`balance: ${(Number(bal) / 1e18).toFixed(6)} ${chain.nativeCurrency.symbol}`);

  // --- Deploy ThreeWSFactory via Arachnid ---
  const existingFactory = await pub.getCode({ address: FACTORY_ADDR }).catch(() => undefined);
  if (existingFactory && existingFactory !== '0x') {
    console.log(`factory: already deployed at ${FACTORY_ADDR}`);
  } else {
    console.log(`factory: deploying…`);
    const txData = FACTORY_SALT + factoryBytecode.slice(2);
    const hash = await wallet.sendTransaction({ to: ARACHNID, data: txData, gas: 800_000n, gasPrice });
    console.log(`factory: tx ${explorer}/tx/${hash}`);
    await pub.waitForTransactionReceipt({ hash });
    console.log(`factory: ✅ ${FACTORY_ADDR}`);
  }

  // --- Deploy ThreeWSPayments via ThreeWSFactory ---
  const args = encodeAbiParameters(
    [{ type: 'address' }, { type: 'address' }],
    [OWNER, usdc]
  );
  const paymentsInitCode = concatHex([paymentsBytecode, args]);
  const paymentsInitCodeHash = keccak256(paymentsInitCode);
  const paymentsAddr = getCreate2Address({ from: FACTORY_ADDR, salt: PAYMENTS_SALT, bytecodeHash: paymentsInitCodeHash });

  console.log(`payments addr: ${paymentsAddr}`);
  console.log(`payments usdc: ${usdc}`);

  const existingPayments = await pub.getCode({ address: paymentsAddr }).catch(() => undefined);
  if (existingPayments && existingPayments !== '0x') {
    console.log(`payments: already deployed at ${paymentsAddr}`);
    return { factory: FACTORY_ADDR, payments: paymentsAddr };
  }

  const { encodeFunctionData } = await import('viem');
  const calldata = encodeFunctionData({
    abi: [{ name: 'deploy', type: 'function', inputs: [{ type: 'bytes32' }, { type: 'bytes' }], outputs: [{ type: 'address' }] }],
    functionName: 'deploy',
    args: [PAYMENTS_SALT, paymentsInitCode],
  });

  console.log(`payments: deploying via ThreeWSFactory…`);
  const hash = await wallet.sendTransaction({ to: FACTORY_ADDR, data: calldata, gas: 2_000_000n, gasPrice });
  console.log(`payments: tx ${explorer}/tx/${hash}`);
  const rcpt = await pub.waitForTransactionReceipt({ hash });
  console.log(`payments: status ${rcpt.status}`);

  const code = await pub.getCode({ address: paymentsAddr }).catch(() => undefined);
  if (!code || code === '0x') {
    console.error(`payments: ❌ not found at ${paymentsAddr}`);
  } else {
    console.log(`payments: ✅ ${explorer}/address/${paymentsAddr}`);
  }

  return { factory: FACTORY_ADDR, payments: paymentsAddr };
}

for (const chainCfg of CHAINS) {
  await deployToChain(chainCfg);
}

console.log('\n\n✅ All chains done');

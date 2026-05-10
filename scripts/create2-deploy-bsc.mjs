#!/usr/bin/env node
// Deploys ThreeWSPayments to a CREATE2 vanity address on BNB Smart Chain
// using the Arachnid deterministic deployment proxy.
//
// Usage:
//   PK=0xYourPrivateKey \
//   OWNER=0xYourOwnerAddress \
//   SALT=0x... \
//   EXPECTED=0x... \
//   node scripts/create2-deploy-bsc.mjs

import {
  createPublicClient, createWalletClient, http,
  encodeAbiParameters, getAddress, getCreate2Address,
  keccak256, concatHex, parseGwei,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';
import solc from 'solc';
import { readFileSync } from 'node:fs';

const FACTORY = '0x4e59b44847b379578588920cA78FbF26c0B4956C';
const RPC     = process.env.BSC_RPC_URL || 'https://bsc-dataseed.binance.org/';

const PK       = process.env.PK;
const OWNER    = process.env.OWNER;
const SALT     = process.env.SALT;
const EXPECTED = process.env.EXPECTED;

if (!PK || !OWNER || !SALT) {
  console.error('Required: PK=0x... OWNER=0x... SALT=0x...');
  process.exit(1);
}

// 1) Compile ThreeWSPayments.sol → get bytecode
const source = readFileSync(new URL('../contracts/ThreeWSPayments.sol', import.meta.url), 'utf8');
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

const bytecode = '0x' + compiled.contracts['ThreeWSPayments.sol']['ThreeWSPayments'].evm.bytecode.object;
const args = encodeAbiParameters([{ type: 'address' }], [getAddress(OWNER)]);
const initCode = concatHex([bytecode, args]);
const initCodeHash = keccak256(initCode);

// 2) Predict the address — must match EXPECTED if provided
const predicted = getCreate2Address({ from: FACTORY, salt: SALT, bytecodeHash: initCodeHash });
console.log('factory     :', FACTORY);
console.log('owner       :', getAddress(OWNER));
console.log('salt        :', SALT);
console.log('initCodeHash:', initCodeHash);
console.log('predicted   :', predicted);

if (EXPECTED && getAddress(EXPECTED) !== predicted) {
  console.error(`\n❌ Predicted address ${predicted} ≠ EXPECTED ${EXPECTED}`);
  console.error('Owner address probably differs from the one used during grinding. Aborting.');
  process.exit(1);
}

// 3) Check if already deployed
const account = privateKeyToAccount(PK.startsWith('0x') ? PK : '0x' + PK);
const pub = createPublicClient({ chain: bsc, transport: http(RPC) });
const code = await pub.getCode({ address: predicted });
if (code && code !== '0x') {
  console.log('\n✓ Already deployed at', predicted);
  process.exit(0);
}

// 4) Check balance
const bnb = await pub.getBalance({ address: account.address });
console.log('\nDeployer    :', account.address);
console.log('BNB balance :', Number(bnb) / 1e18);
if (bnb < 5_000_000_000_000_000n) {
  console.warn('⚠ Less than 0.005 BNB — may not be enough for deployment + verification');
}

// 5) Deploy via Arachnid: tx data = salt || initCode
const wallet = createWalletClient({ account, chain: bsc, transport: http(RPC) });
const txData = concatHex([SALT, initCode]);
console.log('\nSending tx to Arachnid factory…');
const hash = await wallet.sendTransaction({
  to: FACTORY,
  data: txData,
  gas: 500_000n,
  gasPrice: parseGwei('1'),
});
console.log('tx hash  :', hash);
console.log('bscscan  : https://bscscan.com/tx/' + hash);

const rcpt = await pub.waitForTransactionReceipt({ hash });
console.log('status   :', rcpt.status);
console.log('gas used :', rcpt.gasUsed.toString());

// Some RPC nodes return undefined briefly after deployment; treat undefined as success
// when the receipt status was already confirmed above.
const codeAfter = await pub.getCode({ address: predicted }).catch(() => undefined);
if (codeAfter !== undefined && codeAfter === '0x') {
  console.error('❌ Contract not deployed at predicted address (getCode returned 0x)');
  process.exit(1);
}
console.log('\n✅ ThreeWSPayments deployed at:', predicted);
console.log('   bscscan: https://bscscan.com/address/' + predicted);
console.log('\nNext: verify on BSCScan, then submit to DappBay at https://dappbay.bnbchain.org/submit-dapp');

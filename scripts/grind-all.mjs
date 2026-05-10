#!/usr/bin/env node
// Grinds vanity addresses for all three three.ws addresses:
//   1. EOA wallet        — prefix of leading zeros
//   2. ThreeWSFactory    — via Arachnid, prefix of leading zeros
//   3. ThreeWSPayments   — via ThreeWSFactory, prefix of leading zeros
//
// Usage:
//   node scripts/grind-all.mjs [--zeros=N] [--workers=N] [--factory=0x...] [--owner=0x...] [--usdc=0x...]
//
// Defaults:
//   --zeros=12
//   --workers=<all CPUs>
//   --factory=0x4e59b44847b379578588920cA78FbF26c0B4956C  (Arachnid, for factory grind)
//   --owner=0x4022de2d36c334e73c7a108805cea11c0564f402
//   --usdc=0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d     (BSC USDC)
//
// After step 2 completes, the found factory address is automatically used for step 3.
// Results are saved to grind-results.json in the current directory.

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { randomBytes, createHash } from 'node:crypto';
import { cpus } from 'node:os';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { keccak256 } from 'ethereum-cryptography/keccak.js';
import { hexToBytes, bytesToHex } from 'ethereum-cryptography/utils.js';

// ─── Worker thread ────────────────────────────────────────────────────────────
if (!isMainThread) {
  const { mode, prefixLower, factoryHex, initHashHex, privKeyMode } = workerData;

  if (privKeyMode) {
    // EOA wallet grind — generate random private keys, derive address
    // Uses Node crypto only (no secp256k1 in worker threads easily)
    // We approximate by using keccak of random bytes as address stand-in for prefix match,
    // then signal main thread to do full derivation. Actually: use a pure-JS secp256k1.
    const { secp256k1 } = await import('@noble/curves/secp256k1.js');
    const { keccak_256 } = await import('@noble/hashes/sha3.js');

    const privKey = new Uint8Array(32);
    let attempts = 0;

    while (true) {
      crypto.getRandomValues(privKey);
      let pub;
      try { pub = secp256k1.getPublicKey(privKey, false).slice(1); } catch { continue; }
      const addrBytes = keccak_256(pub).slice(12);
      const addrHex = bytesToHex(addrBytes);
      attempts++;

      if (attempts % 50_000 === 0) {
        parentPort.postMessage({ type: 'progress', attempts: 50_000 });
        attempts = 0;
      }

      if (addrHex.startsWith(prefixLower)) {
        parentPort.postMessage({
          type: 'found',
          address: addrHex,
          privateKey: bytesToHex(privKey),
          attempts,
        });
        break;
      }
    }
  } else {
    // CREATE2 grind
    const factoryBytes  = hexToBytes(factoryHex);
    const initHashBytes = hexToBytes(initHashHex);

    const buf = new Uint8Array(85);
    buf[0] = 0xff;
    buf.set(factoryBytes, 1);
    buf.set(initHashBytes, 53);

    let attempts = 0;
    while (true) {
      const salt = randomBytes(32);
      buf.set(salt, 21);
      const hash = keccak256(buf);
      const addrHex = bytesToHex(hash.slice(12));
      attempts++;

      if (attempts % 50_000 === 0) {
        parentPort.postMessage({ type: 'progress', attempts: 50_000 });
        attempts = 0;
      }

      if (addrHex.startsWith(prefixLower)) {
        parentPort.postMessage({ type: 'found', address: addrHex, salt: bytesToHex(salt), attempts });
        break;
      }
    }
  }
  process.exit(0);
}

// ─── Main thread ──────────────────────────────────────────────────────────────
import solc from 'solc';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const args      = process.argv.slice(2);
const getArg    = (name, def) => { const a = args.find(a => a.startsWith(`--${name}=`)); return a ? a.split('=')[1] : def; };
const zeros     = parseInt(getArg('zeros', '12'));
const numWorkers = parseInt(getArg('workers', String(cpus().length)));
const ownerAddr = getArg('owner', '0x4022de2d36c334e73c7a108805cea11c0564f402');
const usdcAddr  = getArg('usdc',  '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d');
const ARACHNID  = '4e59b44847b379578588920ca78fbf26c0b4956c';
const prefix    = '0'.repeat(zeros);

const RESULTS_FILE = resolve(root, 'grind-results.json');
const results = existsSync(RESULTS_FILE) ? JSON.parse(readFileSync(RESULTS_FILE, 'utf8')) : {};

console.log(`\n✦ three.ws vanity grinder`);
console.log(`  zeros   : ${zeros} (prefix: 0x${'0'.repeat(zeros)}...)`);
console.log(`  workers : ${numWorkers}`);
console.log(`  owner   : ${ownerAddr}`);
console.log(`  usdc    : ${usdcAddr}`);
console.log(`  ~attempts per grind: ${(16 ** zeros).toLocaleString()}\n`);

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
console.log('ok\n');

const factoryBytecode  = compiled.contracts['ThreeWSFactory.sol']['ThreeWSFactory'].evm.bytecode.object;
const paymentsBytecode = compiled.contracts['ThreeWSPayments.sol']['ThreeWSPayments'].evm.bytecode.object;

function keccakHex(hex) {
  return bytesToHex(keccak256(hexToBytes(hex.replace(/^0x/, ''))));
}

function encodeAddresses(...addrs) {
  return addrs.map(a => a.replace(/^0x/, '').toLowerCase().padStart(64, '0')).join('');
}

// Compute initcode hashes
const factoryInitHash   = keccakHex(factoryBytecode);
const paymentsInitCode  = paymentsBytecode + encodeAddresses(ownerAddr, usdcAddr);
const paymentsInitHash  = keccakHex(paymentsInitCode);

console.log(`factory  initcode hash: 0x${factoryInitHash}`);
console.log(`payments initcode hash: 0x${paymentsInitHash}\n`);

function grind(label, { privKeyMode = false, factoryHex, initHashHex }) {
  return new Promise((resolve) => {
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`grinding: ${label}`);
    console.log(`prefix  : 0x${prefix}...`);
    console.log(`${'─'.repeat(60)}`);

    const started = Date.now();
    let total = 0;
    let lastReport = Date.now();
    const workers = [];
    let done = false;

    for (let i = 0; i < numWorkers; i++) {
      const w = new Worker(new URL(import.meta.url), {
        workerData: { privKeyMode, prefixLower: prefix, factoryHex, initHashHex },
      });
      workers.push(w);

      w.on('message', ({ type, attempts, address, salt, privateKey }) => {
        if (done) return;
        total += attempts || 0;

        if (type === 'progress') {
          if (Date.now() - lastReport > 2000) {
            const rate = Math.round(total / ((Date.now() - started) / 1000));
            process.stdout.write(`\r  ${(total / 1e6).toFixed(1)}M attempts  ${rate.toLocaleString()}/s   `);
            lastReport = Date.now();
          }
          return;
        }

        if (type === 'found') {
          done = true;
          workers.forEach(w => { try { w.terminate(); } catch {} });
          const elapsed = ((Date.now() - started) / 1000).toFixed(1);
          console.log(`\n\n✅ ${label}`);
          console.log(`   address    : 0x${address}`);
          if (salt)       console.log(`   salt       : 0x${salt}`);
          if (privateKey) console.log(`   privateKey : 0x${privateKey}  ← SAVE THIS NOW`);
          console.log(`   attempts   : ${total.toLocaleString()} in ${elapsed}s`);
          resolve({ address: '0x' + address, salt: salt ? '0x' + salt : null, privateKey: privateKey ? '0x' + privateKey : null });
        }
      });

      w.on('error', e => { if (!done) console.error('worker error:', e); });
    }
  });
}

// ─── Step 1: EOA wallet ───────────────────────────────────────────────────────
if (results.wallet) {
  console.log(`\n⏭  wallet already ground: ${results.wallet.address} (skipping)`);
} else {
  const wallet = await grind('EOA wallet', { privKeyMode: true });
  results.wallet = wallet;
  writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
  console.log(`\n⚠️  SAVE YOUR PRIVATE KEY BEFORE CONTINUING`);
  console.log(`   Press Ctrl+C, save the key, then re-run to continue from step 2.`);
  await new Promise(r => setTimeout(r, 15_000)); // 15s pause to save
}

// ─── Step 2: ThreeWSFactory via Arachnid ─────────────────────────────────────
if (results.factory) {
  console.log(`\n⏭  factory already ground: ${results.factory.address} (skipping)`);
} else {
  const factory = await grind('ThreeWSFactory (via Arachnid)', {
    factoryHex:  ARACHNID,
    initHashHex: factoryInitHash,
  });
  results.factory = factory;
  writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
}

// ─── Step 3: ThreeWSPayments via ThreeWSFactory ───────────────────────────────
const factoryAddr = results.factory.address.replace(/^0x/, '').toLowerCase();

if (results.payments) {
  console.log(`\n⏭  payments already ground: ${results.payments.address} (skipping)`);
} else {
  const payments = await grind('ThreeWSPayments (via ThreeWSFactory)', {
    factoryHex:  factoryAddr,
    initHashHex: paymentsInitHash,
  });
  results.payments = payments;
  writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));
}

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n\n${'═'.repeat(60)}`);
console.log(`✦ GRIND COMPLETE — save grind-results.json`);
console.log(`${'═'.repeat(60)}`);
console.log(`wallet   : ${results.wallet?.address}`);
console.log(`factory  : ${results.factory?.address}`);
console.log(`payments : ${results.payments?.address}`);
console.log(`\nResults saved to: grind-results.json`);
console.log(`\nNext: node scripts/deploy-multichain.mjs`);
console.log(`  (set PAYMENTS_SALT and FACTORY_SALT from grind-results.json)`);

// CREATE2 salt grinder — multi-threaded, finds a salt that produces an address
// matching your target prefix from the Arachnid deterministic deployment proxy.
//
// Usage:
//   node scripts/create2-grind.mjs <initcodeHash> <prefix> [--workers=N]
//
// Example (find 0x333... address):
//   node scripts/create2-grind.mjs \
//     0x477604857d531158757a3f50a5a011c842e06ee1955161d9695e76a1304242ac \
//     333

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { randomBytes } from 'node:crypto';
import { cpus } from 'node:os';
import { keccak256 } from 'ethereum-cryptography/keccak.js';
import { hexToBytes, bytesToHex } from 'ethereum-cryptography/utils.js';

const FACTORY = '4e59b44847b379578588920ca78fbf26c0b4956c'; // Arachnid, lowercase no 0x

if (isMainThread) {
  const [initcodeHash, prefix, ...rest] = process.argv.slice(2);
  if (!initcodeHash || !prefix) {
    console.error('usage: node scripts/create2-grind.mjs <initcodeHash> <prefix> [--workers=N]');
    process.exit(1);
  }
  const flagWorkers = rest.find(a => a.startsWith('--workers='));
  const numWorkers = flagWorkers ? Number(flagWorkers.split('=')[1]) : cpus().length;
  const prefixLower = prefix.toLowerCase().replace(/^0x/, '');

  console.log(`\ngrinding CREATE2 salt for prefix "0x${prefixLower}"`);
  console.log(`factory  : 0x${FACTORY}`);
  console.log(`initcode : ${initcodeHash}`);
  console.log(`workers  : ${numWorkers}`);
  console.log(`expected : ~${(16 ** prefixLower.length).toLocaleString()} iterations\n`);

  const started = Date.now();
  let total = 0;
  let lastReport = Date.now();
  const workers = [];

  for (let i = 0; i < numWorkers; i++) {
    const w = new Worker(new URL(import.meta.url), {
      workerData: { initcodeHash, prefixLower, workerId: i },
    });
    workers.push(w);
    w.on('message', ({ type, salt, address, attempts }) => {
      total += attempts;
      if (type === 'progress') {
        if (Date.now() - lastReport > 2000) {
          const rate = Math.round(total / ((Date.now() - started) / 1000));
          process.stdout.write(`\r  ${(total/1e6).toFixed(1)}M attempts  ${rate.toLocaleString()}/s   `);
          lastReport = Date.now();
        }
        return;
      }
      if (type === 'found') {
        workers.forEach(w => w.terminate());
        const elapsed = ((Date.now() - started) / 1000).toFixed(2);
        console.log(`\n\n✦ found!`);
        console.log(`  address : 0x${address}`);
        console.log(`  salt    : 0x${salt}`);
        console.log(`  total   : ${total.toLocaleString()} attempts in ${elapsed}s`);
        console.log(`\nNext: node scripts/create2-deploy.mjs 0x${salt}`);
      }
    });
    w.on('error', e => console.error('worker error:', e));
  }
} else {
  // Worker thread
  const { initcodeHash, prefixLower } = workerData;
  const factoryBytes = hexToBytes(FACTORY);
  const initHashBytes = hexToBytes(initcodeHash.replace(/^0x/, ''));

  // pre-build the fixed buffer: 0xff ++ factory(20) ++ salt(32) ++ initHash(32) = 85 bytes
  const buf = new Uint8Array(85);
  buf[0] = 0xff;
  buf.set(factoryBytes, 1);           // bytes 1-20: factory
  // bytes 21-52: salt (filled per iteration)
  buf.set(initHashBytes, 53);         // bytes 53-84: initcode hash

  let attempts = 0;
  while (true) {
    // random 32-byte salt
    const salt = randomBytes(32);
    buf.set(salt, 21);

    const hash = keccak256(buf);
    const addrHex = bytesToHex(hash.slice(12)); // last 20 bytes = address

    attempts++;
    if (attempts % 50_000 === 0) {
      parentPort.postMessage({ type: 'progress', attempts: 50_000 });
      attempts = 0;
    }

    if (addrHex.startsWith(prefixLower)) {
      parentPort.postMessage({
        type: 'found',
        address: addrHex,
        salt: bytesToHex(salt),
        attempts,
      });
      break;
    }
  }
}

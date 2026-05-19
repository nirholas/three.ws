#!/usr/bin/env node
import { Wallet } from 'ethers';
import { writeFileSync, existsSync, readFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';

const prefix = (process.argv[2] || '333').toLowerCase().replace(/^0x/, '');
if (!/^[0-9a-f]+$/.test(prefix)) {
  console.error(`Invalid hex prefix: ${prefix}`);
  process.exit(1);
}

const target = '0x' + prefix;
const expected = Math.pow(16, prefix.length);
console.error(`Hunting for ${target}... ~${expected.toLocaleString()} avg attempts`);

const start = Date.now();
let attempts = 0;
let last = start;

while (true) {
  const w = Wallet.createRandom();
  attempts++;
  if (w.address.toLowerCase().startsWith(target)) {
    const secs = ((Date.now() - start) / 1000).toFixed(2);
    console.error(`Found in ${attempts.toLocaleString()} attempts (${secs}s)`);
    const out = {
      address: w.address,
      privateKey: w.privateKey,
      mnemonic: w.mnemonic?.phrase || null,
      prefix: target,
      generatedAt: new Date().toISOString(),
    };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    break;
  }
  if (Date.now() - last > 2000) {
    const rate = Math.round(attempts / ((Date.now() - start) / 1000));
    console.error(`  ${attempts.toLocaleString()} tried, ${rate.toLocaleString()}/s`);
    last = Date.now();
  }
}

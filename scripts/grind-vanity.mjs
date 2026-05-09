#!/usr/bin/env node
// Solana vanity address grinder (Node, parallel).
// Usage: node scripts/grind-vanity.mjs <prefix> [--ignore-case] [--workers=N] [--out=path]

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { Keypair } from '@solana/web3.js';

if (isMainThread) {
	const argv = process.argv.slice(2);
	const positional = argv.filter((a) => !a.startsWith('--'));
	const flags = Object.fromEntries(
		argv.filter((a) => a.startsWith('--')).map((a) => {
			const [k, v = 'true'] = a.replace(/^--/, '').split('=');
			return [k, v];
		}),
	);

	const prefix = positional[0];
	if (!prefix) {
		console.error('usage: node scripts/grind-vanity.mjs <prefix> [--ignore-case] [--workers=N] [--out=path]');
		process.exit(1);
	}
	const ignoreCase = flags['ignore-case'] === 'true' || flags.i === 'true';
	const workers   = Math.max(1, Number(flags.workers) || cpus().length);
	const outPath   = flags.out || `${prefix.toLowerCase()}-${Date.now()}.json`;

	const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;
	if (!BASE58.test(prefix)) {
		console.error(`error: "${prefix}" contains non-Base58 characters (avoid 0, O, I, l)`);
		process.exit(1);
	}

	const startedAt = Date.now();
	console.log(`grinding for prefix "${prefix}" (case-insensitive: ${ignoreCase}) on ${workers} workers…`);

	const pool = [];
	let totalAttempts = 0;
	let lastReport = Date.now();
	let done = false;

	const stopAll = () => {
		done = true;
		for (const w of pool) {
			try { w.terminate(); } catch {}
		}
	};

	const onMatch = ({ publicKey, secretKey, attempts }) => {
		if (done) return;
		stopAll();
		totalAttempts += attempts;
		const durationMs = Date.now() - startedAt;
		const rate = Math.round((totalAttempts / durationMs) * 1000);
		writeFileSync(outPath, JSON.stringify(Array.from(secretKey)));
		console.log('');
		console.log(`✦ found: ${publicKey}`);
		console.log(`  attempts: ${totalAttempts.toLocaleString()}`);
		console.log(`  duration: ${(durationMs / 1000).toFixed(2)}s`);
		console.log(`  rate:     ${rate.toLocaleString()}/s across ${workers} workers`);
		console.log(`  saved keypair → ${outPath}`);
		console.log('');
		console.log(`load with:  solana-keygen pubkey ${outPath}`);
		process.exit(0);
	};

	for (let i = 0; i < workers; i++) {
		const w = new Worker(new URL(import.meta.url), {
			workerData: { prefix, ignoreCase, workerId: i },
		});
		w.on('message', (msg) => {
			if (msg.type === 'match') return onMatch(msg);
			if (msg.type === 'progress') {
				totalAttempts += msg.delta;
				const now = Date.now();
				if (now - lastReport > 500) {
					const rate = Math.round((totalAttempts / (now - startedAt)) * 1000);
					process.stdout.write(`\r  ${totalAttempts.toLocaleString()} attempts · ${rate.toLocaleString()}/s   `);
					lastReport = now;
				}
			}
		});
		w.on('error', (err) => {
			console.error(`worker ${i} crashed:`, err);
			stopAll();
			process.exit(1);
		});
		pool.push(w);
	}
} else {
	const { prefix, ignoreCase } = workerData;
	const target = ignoreCase ? prefix.toLowerCase() : prefix;
	const len = prefix.length;
	let attempts = 0;
	const REPORT_EVERY = 2000;

	while (true) {
		const kp = Keypair.generate();
		attempts++;
		const addr = kp.publicKey.toBase58();
		const head = addr.slice(0, len);
		const match = ignoreCase ? head.toLowerCase() === target : head === target;
		if (match) {
			parentPort.postMessage({
				type: 'match',
				publicKey: addr,
				secretKey: Array.from(kp.secretKey),
				attempts,
			});
			break;
		}
		if (attempts % REPORT_EVERY === 0) {
			parentPort.postMessage({ type: 'progress', delta: REPORT_EVERY });
		}
	}
}

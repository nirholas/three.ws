#!/usr/bin/env node
/**
 * Ingest a gmgn.ai smart-wallet dump into src/kol/wallets.json.
 *
 * Usage:
 *   node scripts/ingest-gmgn.js path/to/gmgn-dump.json
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseGmgnSmartWallets } from '../src/kol/gmgn-parser.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WALLETS_PATH = path.resolve(HERE, '../src/kol/wallets.json');

async function loadWallets() {
	try {
		return JSON.parse(await readFile(WALLETS_PATH, 'utf8'));
	} catch {
		return [];
	}
}

async function main() {
	const [, , inputPath] = process.argv;
	if (!inputPath) {
		console.error('Usage: node scripts/ingest-gmgn.js <path/to/gmgn-dump.json>');
		process.exitCode = 1;
		return;
	}

	const raw = await readFile(path.resolve(inputPath), 'utf8');
	const parsed = parseGmgnSmartWallets(raw);

	const existing = await loadWallets();
	const byWallet = new Map(existing.map((w) => [w.wallet, w]));
	for (const entry of parsed) {
		byWallet.set(entry.wallet, entry);
	}
	const merged = [...byWallet.values()];

	await writeFile(WALLETS_PATH, JSON.stringify(merged, null, '\t') + '\n', 'utf8');
	console.log(`Imported ${parsed.length} wallets. Total: ${merged.length} in wallets.json`);
}

main().catch((e) => {
	console.error('FAILED:', e.message);
	process.exitCode = 1;
});

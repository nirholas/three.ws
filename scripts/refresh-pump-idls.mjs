#!/usr/bin/env node
// Refresh the vendored Pump program IDLs under contracts/idl/pump/.
//
// Source of truth: pump-fun/pump-public-docs (mirrored via nirholas/pumpkit).
// Run after Pump publishes a new IDL version, then commit the diff.
//
//   node scripts/refresh-pump-idls.mjs
//
// Exits non-zero if any download fails so it's safe to wire into CI.

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(HERE, '..', 'contracts', 'idl', 'pump');

const SOURCES = [
	{
		name: 'pump',
		urls: [
			'https://raw.githubusercontent.com/pump-fun/pump-public-docs/main/idl/pump.json',
			'https://raw.githubusercontent.com/nirholas/pumpkit/main/docs/protocol/pump-official/idl/pump.json',
		],
	},
	{
		name: 'pump_amm',
		urls: [
			'https://raw.githubusercontent.com/pump-fun/pump-public-docs/main/idl/pump_amm.json',
			'https://raw.githubusercontent.com/nirholas/pumpkit/main/docs/protocol/pump-official/idl/pump_amm.json',
		],
	},
	{
		name: 'pump_fees',
		urls: [
			'https://raw.githubusercontent.com/pump-fun/pump-public-docs/main/idl/pump_fees.json',
			'https://raw.githubusercontent.com/nirholas/pumpkit/main/docs/protocol/pump-official/idl/pump_fees.json',
		],
	},
];

mkdirSync(OUT_DIR, { recursive: true });

let failures = 0;
for (const { name, urls } of SOURCES) {
	let body = null;
	let usedUrl = null;
	for (const url of urls) {
		try {
			const resp = await fetch(url);
			if (!resp.ok) continue;
			const text = await resp.text();
			JSON.parse(text); // validate structure before writing
			body = text;
			usedUrl = url;
			break;
		} catch {
			// try next mirror
		}
	}
	if (!body) {
		console.error(`✗ ${name}: all sources failed`);
		failures++;
		continue;
	}
	const outPath = resolve(OUT_DIR, `${name}.json`);
	writeFileSync(outPath, body);
	console.log(`✓ ${name} ← ${usedUrl}`);
}

if (failures > 0) {
	console.error(`\nRefresh failed for ${failures} IDL(s).`);
	process.exit(1);
}
console.log('\nAll Pump IDLs refreshed.');

#!/usr/bin/env node
// Compile contracts/src/FixedSupplyToken.sol into the ABI + bytecode artifact the
// EVM launch path deploys (api/_lib/evm-leg/fixed-supply-token.json).
//
// Uses solc-js pinned to the compiler contracts/foundry.toml pins (0.8.24,
// optimizer 200 runs), loaded from the official soliditylang binaries, so no
// global solc or foundry install is needed. The artifact records the compiler and
// a hash of the source; `--check` fails when the committed artifact no longer
// matches the source, so the deployed bytecode can never drift from the reviewed
// contract (tests/evm-leg.test.js runs the same comparison offline).
//
//   node scripts/build-fixed-supply-token.mjs          write the artifact
//   node scripts/build-fixed-supply-token.mjs --check  verify it is current

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'contracts/src/FixedSupplyToken.sol');
const OZ = path.join(ROOT, 'contracts/lib/openzeppelin-contracts/');
const OUT = path.join(ROOT, 'api/_lib/evm-leg/fixed-supply-token.json');
const COMPILER = 'v0.8.24+commit.e11b9ed9';

const source = readFileSync(SOURCE, 'utf8');
const sourceHash = createHash('sha256').update(source).digest('hex');

if (process.argv.includes('--check')) {
	const current = JSON.parse(readFileSync(OUT, 'utf8'));
	if (current.sourceHash !== sourceHash) {
		console.error('fixed-supply-token artifact is stale: run node scripts/build-fixed-supply-token.mjs');
		process.exit(1);
	}
	console.log('fixed-supply-token artifact matches its source');
	process.exit(0);
}

function findImports(importPath) {
	if (!importPath.startsWith('@openzeppelin/')) return { error: `unresolved import ${importPath}` };
	try {
		return { contents: readFileSync(path.join(OZ, importPath.slice('@openzeppelin/'.length)), 'utf8') };
	} catch (e) {
		return { error: e.message };
	}
}

// The installed solc-js wrapper's own loadRemoteVersion points at a retired
// host, so fetch the pinned emscripten build from binaries.soliditylang.org,
// cache it outside the repo, and hand it to the wrapper.
async function loadCompiler() {
	const cacheDir = path.join(os.tmpdir(), 'three-ws-solc');
	const file = path.join(cacheDir, `soljson-${COMPILER}.js`);
	if (!existsSync(file)) {
		const res = await fetch(`https://binaries.soliditylang.org/bin/soljson-${COMPILER}.js`);
		if (!res.ok) throw new Error(`could not download solc ${COMPILER}: HTTP ${res.status}`);
		mkdirSync(cacheDir, { recursive: true });
		writeFileSync(file, Buffer.from(await res.arrayBuffer()));
	}
	const require = createRequire(import.meta.url);
	const wrapper = require('solc/wrapper');
	return wrapper(require(file));
}

const compiler = await loadCompiler();

const input = {
	language: 'Solidity',
	sources: { 'FixedSupplyToken.sol': { content: source } },
	settings: {
		optimizer: { enabled: true, runs: 200 },
		// Paris (no PUSH0) deploys on every EVM chain the leg targets, including
		// L2s that lag mainnet hard forks.
		evmVersion: 'paris',
		outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
	},
};

const output = JSON.parse(compiler.compile(JSON.stringify(input), { import: findImports }));
const errors = (output.errors || []).filter((e) => e.severity === 'error');
if (errors.length) {
	for (const e of errors) console.error(e.formattedMessage);
	process.exit(1);
}

const contract = output.contracts['FixedSupplyToken.sol'].FixedSupplyToken;
const artifact = {
	contractName: 'FixedSupplyToken',
	compiler: COMPILER,
	optimizer: { enabled: true, runs: 200 },
	evmVersion: 'paris',
	sourceHash,
	abi: contract.abi,
	bytecode: `0x${contract.evm.bytecode.object}`,
};
writeFileSync(OUT, `${JSON.stringify(artifact, null, '\t')}\n`);
console.log(`wrote ${path.relative(ROOT, OUT)} (${(artifact.bytecode.length - 2) / 2} bytes)`);

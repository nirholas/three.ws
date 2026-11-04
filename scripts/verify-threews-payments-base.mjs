#!/usr/bin/env node
// Verify the live ThreeWSPayments contract on Base (chain 8453) on Basescan.
//
// The contract is already deployed and bytecode-confirmed at
//   0x31B13cDe47431EfcC8616C8495204e6E6C2Ded34
// (see contracts/DEPLOYMENTS.md). This script submits the source for
// public verification via the Etherscan v2 multichain API and polls the GUID
// until Basescan reports success.
//
// Inputs are pinned to exactly what produced the on-chain bytecode — confirmed
// by reproducing the live BSC deploy's init-code hash byte-for-byte from the
// same source + settings:
//   - solc 0.8.35, optimizer enabled, runs 200
//   - constructor(address _owner, address _usdc)
//   - _owner = 0x4022de2D36C334E73C7a108805Cea11C0564f402 (deployer EOA)
//   - _usdc  = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 (Base USDC)
//
// Usage:
//   BASESCAN_API_KEY=<key> node scripts/verify-threews-payments-base.mjs
//   (ETHERSCAN_API_KEY also accepted — the v2 endpoint is multichain.)
//
// Without a key the script prints the full verification bundle (Standard JSON
// Input + ABI-encoded constructor args) so it can be pasted into the Basescan
// "Verify & Publish" UI manually.

import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeAbiParameters } from 'viem';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const ADDRESS = '0x31B13cDe47431EfcC8616C8495204e6E6C2Ded34';
const CHAIN_ID = 8453;
const OWNER = '0x4022de2D36C334E73C7a108805Cea11C0564f402';
const BASE_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const DEPLOYED_SOURCE_COMMIT = '3310379e1';
const COMPILER = 'v0.8.35+commit.47b9dedd';
const CONTRACT_NAME = 'contracts/ThreeWSPayments.sol:ThreeWSPayments';

const constructorArgs = encodeAbiParameters(
	[{ type: 'address' }, { type: 'address' }],
	[OWNER, BASE_USDC],
).slice(2);

// Standard JSON Input — the same settings that produced the deployed bytecode.
const standardJson = {
	language: 'Solidity',
	sources: {
		'contracts/ThreeWSPayments.sol': {
			// The exact source compiled for the live deploy: the file as of commit
			// 3310379e1 (2026-06-15). The working-tree file has changed since, so it
			// no longer compiles to the on-chain bytecode. Read from git, byte for byte.
			content: execFileSync('git', ['show', `${DEPLOYED_SOURCE_COMMIT}:contracts/ThreeWSPayments.sol`], { cwd: root, encoding: 'utf8' }),
		},
	},
	settings: {
		optimizer: { enabled: true, runs: 200 },
		outputSelection: { '*': { '*': ['abi', 'evm.bytecode', 'evm.deployedBytecode'] } },
	},
};

const apiKey = process.env.BASESCAN_API_KEY || process.env.ETHERSCAN_API_KEY || '';
const API = 'https://api.etherscan.io/v2/api';

async function submit() {
	const body = new URLSearchParams({
		chainid: String(CHAIN_ID),
		apikey: apiKey,
		module: 'contract',
		action: 'verifysourcecode',
		codeformat: 'solidity-standard-json-input',
		contractaddress: ADDRESS,
		contractname: CONTRACT_NAME,
		compilerversion: COMPILER,
		sourceCode: JSON.stringify(standardJson),
		constructorArguements: constructorArgs,
	});
	// Etherscan V2 reads chainid from the query string, even on POST.
	const res = await fetch(`${API}?chainid=${CHAIN_ID}`, { method: 'POST', body });
	const json = await res.json();
	if (json.status !== '1') throw new Error(`verify submit failed: ${json.result || json.message}`);
	return json.result; // GUID
}

async function poll(guid) {
	const url = `${API}?chainid=${CHAIN_ID}&module=contract&action=checkverifystatus&guid=${guid}&apikey=${apiKey}`;
	for (let i = 0; i < 20; i++) {
		await new Promise((r) => setTimeout(r, 5000));
		const json = await (await fetch(url)).json();
		const r = String(json.result || '');
		if (r.includes('Pending')) {
			process.stdout.write('.');
			continue;
		}
		return json;
	}
	throw new Error('verification still pending after 100s — check Basescan manually');
}

if (!apiKey) {
	console.log('No BASESCAN_API_KEY / ETHERSCAN_API_KEY set — printing the bundle for manual verification.\n');
	console.log('Address           :', ADDRESS, `(chain ${CHAIN_ID})`);
	console.log('Contract          :', CONTRACT_NAME);
	console.log('Compiler          :', COMPILER, '| optimizer: enabled, 200 runs');
	console.log('Constructor args  :', constructorArgs);
	console.log('\n--- Standard JSON Input ---');
	console.log(JSON.stringify(standardJson));
	process.exit(0);
}

console.log(`Submitting ThreeWSPayments @ ${ADDRESS} for verification on Base (chain ${CHAIN_ID})…`);
const guid = await submit();
console.log('GUID:', guid, '\nPolling status');
const result = await poll(guid);
if (String(result.result).toLowerCase().includes('verified') || result.status === '1') {
	console.log(`\n✅ Verified: https://basescan.org/address/${ADDRESS}#code`);
} else {
	console.error('\n❌', result.result || JSON.stringify(result));
	process.exit(1);
}

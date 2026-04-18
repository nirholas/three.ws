#!/usr/bin/env node
// Verifies that every address in DELEGATION_MANAGER_DEPLOYMENTS is a deployed contract.
// Calls eth_getCode via public RPC for each chain; exits non-zero if any returns '0x'.

import { DELEGATION_MANAGER_DEPLOYMENTS } from '../src/erc7710/abi.js';
import { CHAIN_META } from '../src/erc8004/chain-meta.js';

const FALLBACK_RPCS = {
	1: 'https://ethereum-rpc.publicnode.com',
	8453: 'https://mainnet.base.org',
	11155111: 'https://ethereum-sepolia-rpc.publicnode.com',
	84532: 'https://sepolia.base.org',
	421614: 'https://sepolia-rollup.arbitrum.io/rpc',
	11155420: 'https://sepolia.optimism.io',
};

async function getCode(rpcUrl, address) {
	const body = JSON.stringify({
		jsonrpc: '2.0',
		id: 1,
		method: 'eth_getCode',
		params: [address, 'latest'],
	});
	const res = await fetch(rpcUrl, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body,
	});
	const json = await res.json();
	if (json.error) throw new Error(json.error.message);
	return json.result;
}

let failed = false;

console.log('Checking DelegationManager deployments...\n');
console.log('chainId  | address                                    | bytecode len | status');
console.log('---------|--------------------------------------------|--------------|---------');

for (const [chainIdStr, address] of Object.entries(DELEGATION_MANAGER_DEPLOYMENTS)) {
	const chainId = Number(chainIdStr);
	const rpcUrl = CHAIN_META[chainId]?.rpcUrl ?? FALLBACK_RPCS[chainId];
	if (!rpcUrl) {
		console.log(`${String(chainId).padEnd(8)} | ${address} | n/a          | SKIP (no RPC)`);
		continue;
	}
	try {
		const code = await getCode(rpcUrl, address);
		const byteLen = (code.length - 2) / 2; // strip 0x, each byte = 2 hex chars
		const ok = code !== '0x' && byteLen > 0;
		if (!ok) failed = true;
		const status = ok ? 'OK' : 'FAIL (empty)';
		console.log(
			`${String(chainId).padEnd(8)} | ${address} | ${String(byteLen).padStart(12)} | ${status}`,
		);
	} catch (err) {
		failed = true;
		console.log(`${String(chainId).padEnd(8)} | ${address} | ERROR        | ${err.message}`);
	}
}

console.log('');
if (failed) {
	console.error('One or more addresses failed the bytecode check.');
	process.exit(1);
} else {
	console.log('All addresses verified — bytecode present on every listed chain.');
}

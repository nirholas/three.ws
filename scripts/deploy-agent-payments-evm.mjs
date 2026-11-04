// CREATE2 deploy of AgentPayments through ThreeWSFactory, one address on every
// chain. Default run is a read-only plan.
//
//   node scripts/deploy-agent-payments-evm.mjs
//       Prints the six-chain confirmation table. Signs and sends nothing.
//   node scripts/deploy-agent-payments-evm.mjs --chain 8453 --yes --confirm-mainnet
//       Broadcasts the deploy on Base. Needs DEPLOYER_PK. Spends real gas.
//   node scripts/deploy-agent-payments-evm.mjs --chain 8453 --rpc 8453=http://127.0.0.1:8545 --yes
//       Same code path against an anvil fork. A local RPC needs no --confirm-mainnet.
//
// Flags: --chain <id> (repeatable, default all six), --owner <address>
// (default AGENT_PAYMENTS_OWNER, else the existing deployer EOA; use the
// platform multisig in production), --rpc <id>=<url> (repeatable override).
// Requires `forge build` in contracts/ for the creation bytecode.

import { createWalletClient, defineChain, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
	CHAINS,
	DEFAULT_OWNER,
	FACTORY,
	assertOwner,
	buildInitCode,
	deployCalldata,
	isLocalEndpoint,
	loadCreationCode,
	planChain,
	renderTable,
} from './lib/agent-payments-deploy.mjs';


function flags(name) {
	const out = [];
	process.argv.forEach((a, i) => {
		if (a === name && process.argv[i + 1]) out.push(process.argv[i + 1]);
	});
	return out;
}
const has = (n) => process.argv.includes(n);

const only = flags('--chain').map(Number);
const overrides = Object.fromEntries(flags('--rpc').map((s) => s.split(/=(.*)/s).slice(0, 2)));
const owner = assertOwner(flags('--owner')[0] || process.env.AGENT_PAYMENTS_OWNER || DEFAULT_OWNER);
const chains = CHAINS.filter((c) => !only.length || only.includes(c.id));

async function publicUrls(id) {
	const { CHAIN_BY_ID } = await import('../api/_lib/erc8004-chains.js');
	return [overrides[id], process.env[`RPC_URL_${id}`], ...((CHAIN_BY_ID[id] && CHAIN_BY_ID[id].rpcUrls) || [])].filter(Boolean);
}

async function rpcWithFailover(urls, method, params) {
	let last;
	for (const url of urls) {
		try {
			const res = await fetch(url, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
				signal: AbortSignal.timeout(15_000),
			});
			const body = await res.json();
			if (body.error) throw new Error(body.error.message);
			return body.result;
		} catch (err) {
			last = err;
		}
	}
	throw last || new Error('no RPC endpoint');
}

const initCode = buildInitCode(loadCreationCode(), owner);
const planned = [];
for (const chain of chains) {
	const urls = await publicUrls(chain.id);
	planned.push({ chain, urls, row: await planChain({ chain, owner, initCode, rpc: (m, p) => rpcWithFailover(urls, m, p) }) });
}

console.log(`AgentPayments CREATE2 deploy via ThreeWSFactory ${FACTORY}`);
console.log(renderTable(planned.map((p) => p.row)));

if (!has('--yes')) {
	console.log('\nPlan only. Nothing was signed or sent. To broadcast: --chain <id> --yes --confirm-mainnet (needs DEPLOYER_PK).');
	process.exit(0);
}

if (!only.length) {
	console.error('Refusing to broadcast on all chains at once. Pick chains with --chain <id>.');
	process.exit(2);
}
const pk = process.env.DEPLOYER_PK;
if (!pk) {
	console.error('DEPLOYER_PK is not set.');
	process.exit(2);
}
const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`);
let failed = false;
for (const { chain, urls, row } of planned) {
	if (row.status !== 'ready') {
		console.error(`chain ${chain.id}: skipped (${row.status})`);
		failed = failed || row.status === 'error' || row.status === 'factory_missing';
		continue;
	}
	const target = urls[0];
	if (!isLocalEndpoint(target) && !has('--confirm-mainnet')) {
		console.error(`chain ${chain.id}: non-local RPC needs --confirm-mainnet. Not broadcasting.`);
		failed = true;
		continue;
	}
	const viemChain = defineChain({ id: chain.id, name: chain.name, nativeCurrency: { name: chain.native, symbol: chain.native, decimals: 18 }, rpcUrls: { default: { http: [target] } } });
	const wallet = createWalletClient({ account, chain: viemChain, transport: http(target) });
	const hash = await wallet.sendTransaction({ to: FACTORY, data: deployCalldata(initCode) });
	const receipt = await rpcWithFailover([target], 'eth_getTransactionReceipt', [hash]);
	console.log(`chain ${chain.id}: tx ${hash} deployed ${row.predicted} (status ${receipt?.status ?? 'pending'})`);
}
process.exit(failed ? 1 : 0);

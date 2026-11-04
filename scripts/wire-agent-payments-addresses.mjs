// Record deployed AgentPayments addresses in the SDK and the deployment ledger
// in one pass.
//
//   node scripts/wire-agent-payments-addresses.mjs --chain 8453=0x... [--chain 56=0x...]
//        [--owner 0x...] [--tx 8453=0x...]
//
// Updates agent-payments-sdk/src/evm/addresses.ts and the AgentPayments table in
// contracts/DEPLOYMENTS.md. Run `npm run build` in agent-payments-sdk/ afterwards.
// Only wire an address after the deploy transaction is mined and `eth_getCode`
// shows code at it: the SDK treats any non-zero address as live.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWiring, wireAddressesTs, wireDeploymentsMd } from './lib/agent-payments-wire.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function flags(name) {
	const out = [];
	process.argv.forEach((a, i) => {
		if (a === name && process.argv[i + 1]) out.push(process.argv[i + 1]);
	});
	return out;
}

const wiring = parseWiring(flags('--chain'));
if (!Object.keys(wiring).length) {
	console.error('usage: --chain <id>=<address> (repeatable) [--owner <address>] [--tx <id>=<hash>]');
	process.exit(2);
}
const owner = flags('--owner')[0];
const txs = Object.fromEntries(flags('--tx').map((s) => s.split('=')));
const explorers = { 1: 'https://etherscan.io', 8453: 'https://basescan.org', 42161: 'https://arbiscan.io', 137: 'https://polygonscan.com', 56: 'https://bscscan.com', 43114: 'https://snowtrace.io' };
const details = Object.fromEntries(
	Object.keys(wiring).map((id) => [id, { owner, tx: txs[id] ? `[${txs[id].slice(0, 10)}...](${explorers[id]}/tx/${txs[id]})` : undefined }]),
);

const tsPath = join(root, 'agent-payments-sdk', 'src', 'evm', 'addresses.ts');
writeFileSync(tsPath, wireAddressesTs(readFileSync(tsPath, 'utf8'), wiring));
const mdPath = join(root, 'contracts', 'DEPLOYMENTS.md');
writeFileSync(mdPath, wireDeploymentsMd(readFileSync(mdPath, 'utf8'), wiring, details));
console.log(`Wired ${Object.keys(wiring).join(', ')}. Now: cd agent-payments-sdk && npm run build && npm test`);

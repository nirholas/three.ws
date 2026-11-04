// Records the JSON-RPC responses planChain consumes from a local anvil fork,
// for tests/agent-payments-deploy-plan.test.js. Run against a fork started with
// `anvil --fork-url <bsc rpc> --port 18546`:
//   node scripts/record-agent-payments-plan-fixture.mjs --chain 56 --rpc http://127.0.0.1:18546 --out tests/fixtures/agent-payments-plan-bsc.json

import { writeFileSync } from 'node:fs';
import { CHAINS, buildInitCode, loadCreationCode, planChain } from './lib/agent-payments-deploy.mjs';

function flag(name) {
	const i = process.argv.indexOf(name);
	return i >= 0 ? process.argv[i + 1] : null;
}
const chain = CHAINS.find((c) => c.id === Number(flag('--chain')));
const url = flag('--rpc');
const out = flag('--out');
if (!chain || !url || !out) {
	console.error('usage: --chain <id> --rpc <local fork url> --out <file>');
	process.exit(2);
}
const owner = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266';
const recorded = [];
const rpc = async (method, params) => {
	const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
	const body = await res.json();
	if (body.error) throw new Error(body.error.message);
	recorded.push({ method, params, result: body.result });
	return body.result;
};
const row = await planChain({ chain, rpc, owner, initCode: buildInitCode(loadCreationCode(), owner) });
writeFileSync(out, `${JSON.stringify({ chain, owner, status: row.status, recorded }, null, 2)}\n`);
console.log(`recorded ${recorded.length} calls, status ${row.status}`);

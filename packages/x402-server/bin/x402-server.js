#!/usr/bin/env node
// x402-server CLI. `attack` fires hostile transactions at a facilitator you run
// and reports which it refused. Devnet or local facilitators only.

import { buildAttackCases, runAttacks, MAINNET_NETWORK_IDS } from '../src/facilitator/attacks.js';

const USAGE = `Usage: x402-server attack --facilitator <url> [--pay-to <address>] [--mint <address>]

Posts a suite of hostile payments to <url>/verify and <url>/settle and checks
each is refused. Reads the fee payer and network from GET <url>/.
Refuses to run against a mainnet facilitator. Exit code 1 if any case is accepted.`;

function flags(argv) {
	const out = {};
	for (let i = 0; i < argv.length; i++) {
		if (argv[i].startsWith('--')) out[argv[i].slice(2)] = argv[++i];
	}
	return out;
}

async function main() {
	const [cmd, ...rest] = process.argv.slice(2);
	if (cmd !== 'attack') {
		console.log(USAGE);
		process.exit(cmd ? 2 : 0);
	}
	const f = flags(rest);
	if (!f.facilitator) {
		console.error('missing --facilitator\n\n' + USAGE);
		process.exit(2);
	}
	const base = f.facilitator.replace(/\/+$/, '');
	let info;
	try {
		const res = await fetch(base + '/');
		info = await res.json();
	} catch (err) {
		console.error(`cannot read ${base}/ (${err.message}). Is the facilitator running?`);
		process.exit(2);
	}
	const feePayer = info.feePayer;
	const network = info.kinds?.[0]?.network;
	if (!feePayer || !network) {
		console.error('facilitator index did not report feePayer and network; cannot build attacks.');
		process.exit(2);
	}
	if (MAINNET_NETWORK_IDS.includes(network)) {
		console.error(`refusing: ${network} is mainnet. Run the suite against a devnet or local facilitator.`);
		process.exit(2);
	}
	const payTo = f['pay-to'] || info.payTo?.[0];
	const mint = f.mint || info.mints?.[0];
	if (!payTo || !mint) {
		console.error('pass --pay-to and --mint (the facilitator did not advertise them).');
		process.exit(2);
	}
	const cases = buildAttackCases({ network, feePayer, payTo, mint });
	const results = await runAttacks({ url: base, cases });
	let failed = 0;
	for (const r of results) {
		if (!r.pass) failed++;
		console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  [${r.endpoint}]  expected ${r.expect}  got ${r.got}`);
	}
	console.log(`\n${results.length - failed}/${results.length} attacks refused.`);
	process.exit(failed ? 1 : 0);
}

main().catch((e) => {
	console.error(e.message);
	process.exit(2);
});

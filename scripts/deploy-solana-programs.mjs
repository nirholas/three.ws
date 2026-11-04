#!/usr/bin/env node
// Deploys the four Anchor programs (skill_license, agent_invocation, knock_escrow,
// event_markets_stake) to a Solana cluster, or hands their upgrade authority to a
// multisig. Nothing executes without --yes; mainnet also needs --confirm-mainnet
// and an explicit --keypair. Runbook: docs/ops/solana-programs-mainnet.md.
//
//   node scripts/deploy-solana-programs.mjs --cluster devnet --yes
//   node scripts/deploy-solana-programs.mjs --cluster mainnet-beta --keypair .deploy/payer.json   (prints the table only)
//   node scripts/deploy-solana-programs.mjs set-upgrade-authority --cluster mainnet-beta --keypair K --new-authority <pubkey> --yes --confirm-mainnet

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlan, gate, parseArgs, parseDeclaredId, renderTable } from './lib/solana-program-deploy-plan.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(homedir(), '.local/share/solana/install/active_release/bin');
const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };

const kpFile = (dir, name) => path.join(root, dir, '.deploy', `${name}-program-keypair.json`);
const soFile = (dir, name) => path.join(root, dir, 'target/deploy', `${name}.so`);

const read = {
	declaredId: (dir) => {
		const f = path.join(root, dir, 'src/lib.rs');
		return existsSync(f) ? parseDeclaredId(readFileSync(f, 'utf8')) : null;
	},
	keypairPubkey: (dir, name) => {
		const f = kpFile(dir, name);
		if (!existsSync(f)) return null;
		const r = spawnSync('solana-keygen', ['pubkey', f], { env, encoding: 'utf8' });
		return r.status === 0 ? r.stdout.trim() : null;
	},
	soSize: (dir, name) => (existsSync(soFile(dir, name)) ? statSync(soFile(dir, name)).size : null),
};

function sh(args) {
	const r = spawnSync('solana', args, { env, stdio: 'inherit' });
	if (r.error?.code === 'ENOENT') {
		console.error('solana CLI not found. Install the Agave toolchain (see contracts/README.md).');
		process.exit(127);
	}
	if (r.status !== 0) process.exit(r.status || 1);
}

let args;
let plan;
try {
	args = parseArgs(process.argv.slice(2));
	plan = buildPlan(args, read);
} catch (e) {
	console.error(`error: ${e.message}`);
	process.exit(2);
}

console.log(renderTable(plan));
if (args.command === 'set-upgrade-authority') console.log(`\nnew upgrade authority: ${args.newAuthority}`);
const verdict = gate(plan, args);
if (!verdict.run) {
	console.log(`\n${verdict.reason}`);
	process.exit(0);
}

const common = ['--url', plan.url, ...(args.keypair ? ['--keypair', args.keypair] : [])];
for (const r of plan.rows) {
	console.log(`\n== ${args.command} ${r.name} (${r.id})`);
	if (args.command === 'deploy') {
		sh(['program', 'deploy', soFile(r.dir, r.name), '--program-id', kpFile(r.dir, r.name), '--max-len', String(r.maxLen), ...common]);
	} else {
		sh(['program', 'set-upgrade-authority', r.id, '--new-upgrade-authority', args.newAuthority, ...common]);
	}
}
console.log('\ndone. Record the ids, signatures and authority in contracts/SOLANA_DEPLOYMENTS.md.');

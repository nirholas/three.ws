#!/usr/bin/env node
// Builds contracts/event-markets-stake, boots solana-test-validator with the
// program loaded, runs the on-chain suite against it, and always stops the
// validator it started (by PID, never by pattern). Needs the Solana CLI
// (cargo-build-sbf, solana-test-validator) on PATH or in ~/.local/share/solana.
// Guide: contracts/event-markets-stake/README.md.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'contracts/event-markets-stake');
const solanaBin = path.join(homedir(), '.local/share/solana/install/active_release/bin');
const env = { ...process.env, PATH: `${solanaBin}:${process.env.PATH}` };
const PORT = Number(process.env.STAKE_VALIDATOR_PORT || 18899);

function run(cmd, args, opts = {}) {
	const r = spawnSync(cmd, args, { stdio: 'inherit', env, ...opts });
	if (r.error?.code === 'ENOENT') {
		console.error(`${cmd} is not installed or not on PATH. Install Rust and the Solana CLI (cargo-build-sbf, solana-test-validator) as described in contracts/event-markets-stake/README.md, then rerun.`);
		process.exit(127);
	}
	if (r.status !== 0) process.exit(r.status || 1);
}

if (!process.argv.includes('--skip-build')) run('cargo', ['build-sbf'], { cwd: dir });

const so = path.join(dir, 'target/deploy/event_markets_stake.so');
const idFile = path.join(dir, 'target/deploy/event_markets_stake-keypair.json');
if (!existsSync(so) || !existsSync(idFile)) {
	console.error('program artifacts missing; run without --skip-build');
	process.exit(1);
}
const programId = spawnSync('solana-keygen', ['pubkey', idFile], { env, encoding: 'utf8' }).stdout.trim();

const ledger = mkdtempSync(path.join(tmpdir(), 'em-stake-ledger-'));
// Every port is derived from PORT, gossip and the dynamic range included: the
// defaults (gossip 8000, dynamic 8000-10000) collide with any other validator on
// this machine, and the validator then panics on bind before RPC ever comes up.
const validator = spawn('solana-test-validator', [
	'--reset', '--quiet', '--ledger', ledger, '--rpc-port', String(PORT), '--faucet-port', String(PORT + 100),
	'--gossip-port', String(PORT + 101), '--dynamic-port-range', `${PORT + 200}-${PORT + 300}`,
	'--bpf-program', programId, so,
], { env, stdio: 'ignore' });

const rpc = `http://127.0.0.1:${PORT}`;
let exiting = false;
const stop = () => {
	if (exiting) return;
	exiting = true;
	validator.kill('SIGTERM');
	rmSync(ledger, { recursive: true, force: true });
};
process.on('SIGINT', () => { stop(); process.exit(130); });

async function ready() {
	for (let i = 0; i < 90; i++) {
		try {
			const r = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }) });
			if ((await r.json()).result === 'ok') return true;
		} catch { /* not up yet */ }
		await new Promise((r) => setTimeout(r, 1000));
	}
	return false;
}

if (!(await ready())) {
	const log = path.join(ledger, 'validator.log');
	const tail = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter((l) => /panic|error|in use/i.test(l)).slice(0, 5).join('\n') : '';
	stop();
	console.error(`validator did not become healthy on port ${PORT}${tail ? `:\n${tail}` : ''}\nSet STAKE_VALIDATOR_PORT to a free base port if another process holds this range.`);
	process.exit(1);
}

const t = spawnSync('npx', ['vitest', 'run', 'tests/event-markets-staking.chain.test.js'], {
	cwd: root, stdio: 'inherit', env: { ...env, STAKE_RPC_URL: rpc, EVENT_MARKETS_STAKE_PROGRAM_ID: programId },
});
stop();
process.exit(t.status ?? 1);

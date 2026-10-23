#!/usr/bin/env node
// Wallet rescue runbook: move everything out of a compromised wallet in one
// atomic Jito bundle. Dry run by default: builds the bundle, simulates every
// transaction, prints the plan, and sends nothing. Needs public keys only.
//
//   node scripts/rescue-wallet.mjs \
//     --compromised <pubkey> --destination <safe pubkey> --fee-payer <safe pubkey> \
//     [--rpc <url>] [--tip-sol 0.001] [--priority 100000] [--no-sol] [--json]
//
// --execute signs and sends. It needs RESCUE_COMPROMISED_SECRET and
// RESCUE_FEE_PAYER_SECRET (base58) in the environment, an interactive terminal,
// a passing simulation, and the destination address typed back to confirm.
// Runbook: docs/ops/wallet-rescue.md

import { createInterface } from 'node:readline/promises';
import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import bs58 from 'bs58';

import {
	buildRescuePlan,
	sendRescuePlan,
	signRescuePlan,
	simulateRescuePlan,
} from '../packages/avatar-agent-mcp/src/lib/atomic-rescue.js';
import { checkTipAccountDrift } from '../packages/avatar-agent-mcp/src/lib/jito-tip-accounts.js';

const bs58encode = bs58.default ? bs58.default.encode : bs58.encode;
const bs58decode = bs58.default ? bs58.default.decode : bs58.decode;

const FLAGS = new Set(['--execute', '--no-sol', '--json', '--help']);
const VALUES = new Set(['--compromised', '--destination', '--fee-payer', '--rpc', '--tip-sol', '--priority']);

function parseArgs(argv) {
	const out = {};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (FLAGS.has(a)) out[a.slice(2)] = true;
		else if (VALUES.has(a) && argv[i + 1] !== undefined) out[a.slice(2)] = argv[++i];
		else fail(`unknown or incomplete argument: ${a}`);
	}
	return out;
}

function fail(message) {
	console.error(`rescue-wallet: ${message}`);
	process.exit(1);
}

function pubkey(value, flag) {
	if (!value) fail(`${flag} is required (see --help)`);
	try {
		return new PublicKey(value);
	} catch {
		return fail(`${flag} is not a valid Solana address: ${value}`);
	}
}

function keypairFromEnv(name) {
	const raw = process.env[name]?.trim();
	if (!raw) fail(`${name} is not set`);
	const bytes = bs58decode(raw);
	if (bytes.length !== 64) fail(`${name} must be a base58 64-byte secret key`);
	return Keypair.fromSecretKey(bytes);
}

function printPlan(plan, sim, drift) {
	const s = plan.summary;
	const sol = (l) => `${(l / LAMPORTS_PER_SOL).toFixed(6)} SOL`;
	console.log('Wallet rescue plan (dry run)');
	console.log(`  compromised : ${s.compromised}`);
	console.log(`  destination : ${s.destination}`);
	console.log(`  fee payer   : ${s.feePayer} (pays fees, destination account rent, tip)`);
	console.log(`  tip         : ${sol(s.tipLamports)} to ${s.tipAccount}`);
	console.log(`  SOL return  : ${sol(s.solReturnLamports)}`);
	console.log(`  bundle      : ${s.txCount} transaction(s), ${s.txBytes.join(', ')} bytes`);
	s.tokenAccounts.forEach((accounts, i) => {
		const result = sim.results[i];
		const status = result.ok ? 'simulation ok' : `SIMULATION FAILED ${JSON.stringify(result.err)}`;
		console.log(`  tx ${i + 1}: ${accounts.length} token account(s), ${result.unitsConsumed ?? '?'} CU, ${status}`);
		for (const a of accounts) {
			console.log(`      ${a.program} ${a.mint} amount ${a.amount} (decimals ${a.decimals}) from ${a.address}`);
		}
		if (!result.ok && result.logs) for (const line of result.logs.slice(-6)) console.log(`      ${line}`);
	});
	for (const k of s.skipped) console.log(`  skipped ${k.address} (${k.mint}): ${k.reason}`);
	if (s.remaining > 0) {
		console.log(`  remaining   : ${s.remaining} token account(s) did not fit; run the rescue again after this bundle lands`);
	}
	console.log(`  tip accounts: ${drift.status}${drift.status === 'drift' ? ` (added ${drift.added.length}, removed ${drift.removed.length})` : ''}`);
	console.log(`  simulation  : ${sim.ok ? 'all transactions ok' : 'FAILED, do not execute'}`);
}

async function confirmInteractively(destination) {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		fail('--execute needs an interactive terminal; refusing to send from a pipe or CI');
	}
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	const answer = await rl.question(`This signs and sends real transactions. Type the destination address (${destination}) to confirm: `);
	rl.close();
	return answer.trim() === destination;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
	console.log('usage: node scripts/rescue-wallet.mjs --compromised <pk> --destination <pk> --fee-payer <pk> [--rpc <url>] [--tip-sol n] [--priority microLamports] [--no-sol] [--json] [--execute]');
	process.exit(0);
}

const compromised = pubkey(args.compromised, '--compromised');
const destination = pubkey(args.destination, '--destination');
const feePayer = pubkey(args['fee-payer'], '--fee-payer');
const connection = new Connection(args.rpc || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com', 'confirmed');

const plan = await buildRescuePlan({
	connection,
	compromised,
	destination,
	feePayer,
	...(args['tip-sol'] ? { tipSol: Number(args['tip-sol']) } : {}),
	...(args.priority ? { priorityMicroLamports: Number(args.priority) } : {}),
	returnSol: !args['no-sol'],
});
const [sim, drift] = await Promise.all([simulateRescuePlan(connection, plan), checkTipAccountDrift()]);

if (args.json) console.log(JSON.stringify({ summary: plan.summary, simulation: sim, tipAccounts: drift }, null, 2));
else printPlan(plan, sim, drift);

if (!args.execute) process.exit(sim.ok ? 0 : 2);

if (!sim.ok) fail('simulation failed; refusing to execute');
const compromisedKey = keypairFromEnv('RESCUE_COMPROMISED_SECRET');
const feePayerKey = keypairFromEnv('RESCUE_FEE_PAYER_SECRET');
if (!compromisedKey.publicKey.equals(compromised) || !feePayerKey.publicKey.equals(feePayer)) {
	fail('the secrets in the environment do not match --compromised / --fee-payer');
}
if (!(await confirmInteractively(destination.toBase58()))) fail('confirmation did not match; nothing was sent');

// The typed confirmation can outlast the blockhash, so rebuild and re-simulate
// against the current chain state right before signing.
const freshPlan = await buildRescuePlan({ connection, compromised, destination, feePayer, tipSol: Number(args['tip-sol'] ?? 0.001), ...(args.priority ? { priorityMicroLamports: Number(args.priority) } : {}), returnSol: !args['no-sol'] });
const freshSim = await simulateRescuePlan(connection, freshPlan);
if (!freshSim.ok) fail('the fresh simulation failed; nothing was sent');
signRescuePlan(freshPlan, { feePayer: feePayerKey, compromised: compromisedKey });
const result = await sendRescuePlan(connection, freshPlan, bs58encode);
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 3);

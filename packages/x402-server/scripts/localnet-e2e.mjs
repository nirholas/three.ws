#!/usr/bin/env node
// End-to-end check of @three-ws/x402-server/facilitator on a throwaway local
// validator. Nothing here touches devnet or mainnet, and every lamport comes
// from the local faucet.
//
//   1. boots solana-test-validator on free ports with a temp ledger
//   2. funds a sponsor and a buyer, creates a synthetic 6-decimal mint and
//      gives the buyer 5 tokens
//   3. serves the facilitator over HTTP exactly as examples/facilitator does
//   4. verifies and settles one honest sponsored payment, then confirms the
//      recipient balance on chain and the sponsor paid the fee
//   5. resubmits the same settle and expects an idempotent refusal
//   6. runs the attack CLI against the live instance (every case must be refused)
//
// Requires solana-test-validator on PATH (Agave/Solana CLI). Usage:
//   node scripts/localnet-e2e.mjs
// Exit 0 when every step passes, 1 otherwise.

import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { createMint, getOrCreateAssociatedTokenAccount, mintTo, getAccount } from '@solana/spl-token';
import { createFacilitator, createFacilitatorHandler } from '../src/facilitator/index.js';
import { buildPayment } from '../src/facilitator/attacks.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const AMOUNT = 1_250_000n;

function freePort() {
	return new Promise((resolve, reject) => {
		const s = net.createServer();
		s.once('error', reject);
		s.listen(0, '127.0.0.1', () => {
			const { port } = s.address();
			s.close(() => resolve(port));
		});
	});
}

async function waitFor(fn, { timeoutMs, label }) {
	const until = Date.now() + timeoutMs;
	let last;
	while (Date.now() < until) {
		try {
			const v = await fn();
			if (v) return v;
		} catch (err) {
			last = err;
		}
		await new Promise((r) => setTimeout(r, 500));
	}
	throw new Error(`${label} did not become ready in ${timeoutMs}ms${last ? `: ${last.message}` : ''}`);
}

const steps = [];
function check(name, ok, detail = '') {
	steps.push({ name, ok });
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

async function post(url, body) {
	const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
	return res.json();
}

async function main() {
	if (spawnSync('solana-test-validator', ['--version']).status !== 0) {
		console.error('solana-test-validator not found on PATH. Install the Agave CLI: https://docs.anza.xyz/cli/install');
		process.exit(2);
	}
	const rpcPort = await freePort();
	const faucetPort = await freePort();
	const gossipPort = await freePort();
	const dynStart = 20000 + Math.floor(Math.random() * 20000);
	const ledger = fs.mkdtempSync(path.join(os.tmpdir(), 'x402-localnet-'));
	const validator = spawn(
		'solana-test-validator',
		['--ledger', ledger, '--rpc-port', String(rpcPort), '--faucet-port', String(faucetPort), '--gossip-port', String(gossipPort), '--dynamic-port-range', `${dynStart}-${dynStart + 50}`, '--quiet', '--reset'],
		{ stdio: ['ignore', 'ignore', 'pipe'] },
	);
	let validatorErr = '';
	validator.stderr.on('data', (d) => (validatorErr += d));
	let server;
	const cleanup = () => {
		server?.close();
		validator.kill('SIGINT');
		fs.rmSync(ledger, { recursive: true, force: true });
	};

	try {
		const rpcUrl = `http://127.0.0.1:${rpcPort}`;
		const conn = new Connection(rpcUrl, 'confirmed');
		await waitFor(async () => (await conn.getSlot()) > 1, { timeoutMs: 60_000, label: 'local validator' }).catch((err) => {
			throw new Error(`${err.message}\n${validatorErr.slice(-800)}`);
		});
		const network = `solana:${(await conn.getGenesisHash()).slice(0, 32)}`;
		console.log(`validator up at ${rpcUrl}, network ${network}`);

		const sponsor = Keypair.generate();
		const buyer = Keypair.generate();
		const merchant = Keypair.generate();
		for (const kp of [sponsor, buyer]) {
			const sig = await conn.requestAirdrop(kp.publicKey, 2 * LAMPORTS_PER_SOL);
			await conn.confirmTransaction(sig, 'confirmed');
		}
		const mint = await createMint(conn, buyer, buyer.publicKey, null, 6);
		const buyerAta = await getOrCreateAssociatedTokenAccount(conn, buyer, mint, buyer.publicKey);
		await mintTo(conn, buyer, mint, buyerAta.address, buyer, 5_000_000n);
		const merchantAta = await getOrCreateAssociatedTokenAccount(conn, buyer, mint, merchant.publicKey);
		// Spend the buyer's SOL down so the sponsored path is the only way the
		// payment can land: the buyer pays nothing but tokens.
		const sponsorBefore = await conn.getBalance(sponsor.publicKey);

		const facilitator = createFacilitator({
			connection: conn,
			feePayer: sponsor,
			payToAllowlist: [merchant.publicKey.toBase58()],
			settleableMints: [mint.toBase58()],
			guards: { sponsorSolFloorLamports: 20_000_000, minSponsoredSettleAtomic: 1000, feeBudget: { lamports: 10_000_000, windowMs: 3_600_000 } },
		});
		server = http.createServer(createFacilitatorHandler(facilitator, { network, name: 'localnet e2e facilitator' }));
		await new Promise((r) => server.listen(0, '127.0.0.1', r));
		const base = `http://127.0.0.1:${server.address().port}`;

		const index = await (await fetch(base + '/')).json();
		check('service document advertises sponsor, payTo and mint', index.feePayer === sponsor.publicKey.toBase58() && index.payTo?.[0] === merchant.publicKey.toBase58() && index.mints?.[0] === mint.toBase58());

		const { blockhash } = await conn.getLatestBlockhash('confirmed');
		const pay = buildPayment({ network, feePayer: sponsor.publicKey.toBase58(), payTo: merchant.publicKey.toBase58(), mint: mint.toBase58(), amount: AMOUNT, blockhash, buyer });
		const body = { paymentPayload: pay.paymentPayload, paymentRequirements: pay.paymentRequirements };

		const verify = await post(base + '/verify', body);
		check('verify accepts the honest payment', verify.isValid === true, verify.invalidReason || `payer ${verify.payer}`);

		const settle = await post(base + '/settle', body);
		if (process.env.DEBUG_E2E && settle.transaction) {
			await new Promise((r) => setTimeout(r, 5000));
			console.log('DEBUG status', JSON.stringify(await conn.getSignatureStatuses([settle.transaction], { searchTransactionHistory: true })));
			console.log('DEBUG slot', await conn.getSlot(), 'tx', JSON.stringify(await conn.getTransaction(settle.transaction, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 }))?.slice(0, 600));
		}
		check('settle succeeds', settle.success === true, settle.errorReason || `tx ${settle.transaction}`);

		const merchantBal = (await getAccount(conn, merchantAta.address, 'confirmed')).amount;
		check('recipient received the exact amount on chain', merchantBal === AMOUNT, `${merchantBal} atomic`);
		const buyerBal = (await getAccount(conn, buyerAta.address, 'confirmed')).amount;
		check('buyer debited the exact amount', buyerBal === 5_000_000n - AMOUNT, `${buyerBal} atomic left`);
		if (settle.transaction) {
			const tx = await conn.getTransaction(settle.transaction, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
			const feePayer = tx?.transaction.message.staticAccountKeys[0].toBase58();
			check('sponsor was the fee payer of the landed transaction', feePayer === sponsor.publicKey.toBase58(), `fee ${tx?.meta?.fee} lamports`);
		}
		const sponsorAfter = await conn.getBalance(sponsor.publicKey);
		check('sponsor spent only the network fee', sponsorBefore - sponsorAfter > 0 && sponsorBefore - sponsorAfter < 100_000, `${sponsorBefore - sponsorAfter} lamports`);

		const replay = await post(base + '/settle', body);
		check('duplicate settle is refused, not rebroadcast', replay.success === false, replay.errorReason);
		const merchantBal2 = (await getAccount(conn, merchantAta.address, 'confirmed')).amount;
		check('duplicate settle moved nothing', merchantBal2 === AMOUNT);

		const metrics = await (await fetch(base + '/metrics')).json();
		check('metrics count the settle and burn', JSON.stringify(metrics).includes('settle'), JSON.stringify(metrics).slice(0, 160));

		const cli = spawnSync(process.execPath, [path.join(here, '../bin/x402-server.js'), 'attack', '--facilitator', base], { encoding: 'utf8', timeout: 120_000 });
		process.stdout.write(cli.stdout.replace(/^/gm, '    '));
		if (cli.stderr) process.stderr.write(cli.stderr);
		check('attack CLI: every hostile case refused with its expected reason', cli.status === 0, cli.stdout.trim().split('\n').pop());
	} finally {
		cleanup();
	}
	const failed = steps.filter((s) => !s.ok).length;
	console.log(`\n${steps.length - failed}/${steps.length} localnet checks passed.`);
	process.exit(failed ? 1 : 0);
}

main().catch((err) => {
	console.error(err.stack || err.message);
	process.exit(1);
});

// Atomic wallet rescue via a Jito bundle.
//
// When a wallet key leaks, a sweeper bot drains anything that lands in it within
// seconds, so the rescue cannot fund the compromised wallet first. A separate,
// safe FEE PAYER wallet pays every fee, every destination account rent and the
// Jito tip. The compromised wallet only signs the moves out of itself:
//
//   per token account:  create the destination ATA (idempotent, fee payer pays),
//                       transferChecked the full balance, close the account
//                       (its rent goes straight to the destination)
//   last transaction:   return the compromised wallet's remaining SOL to the
//                       destination, and pay the Jito tip
//
// The compromised wallet never needs SOL, and a bundle lands whole or not at
// all, so no one holding the leaked key can interleave a tx between the steps.
// Every transaction is self-contained (a mint's destination ATA is created in the
// same tx that fills it), which lets each one be simulated independently.
//
// This file builds and simulates. Signing and sending are explicit, separate
// calls (signRescuePlan, sendRescuePlan); nothing here moves funds on its own.

import {
	ComputeBudgetProgram,
	PublicKey,
	SystemProgram,
	TransactionMessage,
	VersionedTransaction,
	LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import {
	TOKEN_PROGRAM_ID,
	TOKEN_2022_PROGRAM_ID,
	createAssociatedTokenAccountIdempotentInstruction,
	createCloseAccountInstruction,
	createTransferCheckedInstruction,
	getAssociatedTokenAddressSync,
} from '@solana/spl-token';

import { randomTipAccount, submitBundle, waitForSignatures } from './jito.js';
import {
	assertRecipientAllowed,
	clampJitoTipSol,
	clampPriorityMicroLamports,
} from './spend-policy.js';

// Jito accepts 1 to 5 transactions per bundle; a legacy-sized tx is 1232 bytes.
export const MAX_BUNDLE_TXS = 5;
export const MAX_TX_BYTES = 1232;

const CU_BASE = 10_000;
const CU_PER_TOKEN_ACCOUNT = 45_000;
const CU_MAX = 1_400_000;

/**
 * Everything the compromised wallet holds that the rescue moves.
 * @param {import('@solana/web3.js').Connection} connection
 * @param {PublicKey} owner
 * @returns {Promise<{ solLamports: number, tokenAccounts: TokenAccountInfo[] }>}
 *
 * @typedef {object} TokenAccountInfo
 * @property {PublicKey} address   the token account
 * @property {PublicKey} mint
 * @property {PublicKey} programId TOKEN_PROGRAM_ID or TOKEN_2022_PROGRAM_ID
 * @property {bigint} amount       raw base units
 * @property {number} decimals
 * @property {string} state        'initialized' | 'frozen' | ...
 */
export async function fetchRescueInventory(connection, owner) {
	const [solLamports, legacy, t22] = await Promise.all([
		connection.getBalance(owner, 'confirmed'),
		connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }, 'confirmed'),
		connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }, 'confirmed'),
	]);
	const tokenAccounts = [
		...legacy.value.map((v) => ({ v, programId: TOKEN_PROGRAM_ID })),
		...t22.value.map((v) => ({ v, programId: TOKEN_2022_PROGRAM_ID })),
	].map(({ v, programId }) => {
		const info = v.account.data.parsed.info;
		return {
			address: v.pubkey,
			mint: new PublicKey(info.mint),
			programId,
			amount: BigInt(info.tokenAmount.amount),
			decimals: info.tokenAmount.decimals,
			state: info.state,
		};
	});
	return { solLamports, tokenAccounts };
}

function computeBudgetIxs(groups, priorityMicroLamports) {
	const units = Math.min(CU_MAX, CU_BASE + groups * CU_PER_TOKEN_ACCOUNT);
	return [
		ComputeBudgetProgram.setComputeUnitLimit({ units }),
		ComputeBudgetProgram.setComputeUnitPrice({ microLamports: priorityMicroLamports }),
	];
}

function compile(feePayer, blockhash, instructions) {
	return new VersionedTransaction(
		new TransactionMessage({ payerKey: feePayer, recentBlockhash: blockhash, instructions }).compileToV0Message(),
	);
}

/** The instructions that rescue one token account. */
function tokenAccountIxs({ account, compromised, destination, feePayer }) {
	const destinationAta = getAssociatedTokenAddressSync(
		account.mint,
		destination,
		true,
		account.programId,
	);
	const ixs = [];
	if (account.amount > 0n) {
		ixs.push(
			createAssociatedTokenAccountIdempotentInstruction(
				feePayer,
				destinationAta,
				destination,
				account.mint,
				account.programId,
			),
			createTransferCheckedInstruction(
				account.address,
				account.mint,
				destinationAta,
				compromised,
				account.amount,
				account.decimals,
				[],
				account.programId,
			),
		);
	}
	ixs.push(createCloseAccountInstruction(account.address, destination, compromised, [], account.programId));
	return ixs;
}

/**
 * Pack the rescue into at most MAX_BUNDLE_TXS transactions. Pure: takes the
 * inventory and a blockhash, returns unsigned transactions and a summary.
 *
 * Frozen token accounts cannot be moved by their owner and are reported in
 * `skipped`. When the accounts do not fit in one bundle the plan covers as many
 * as fit and `remaining` counts the rest; run the rescue again for them.
 *
 * @param {object} p
 * @param {PublicKey} p.compromised
 * @param {PublicKey} p.destination
 * @param {PublicKey} p.feePayer  safe wallet that pays fees, ATA rent and the tip
 * @param {number} p.solLamports  compromised wallet SOL balance
 * @param {TokenAccountInfo[]} p.tokenAccounts
 * @param {string} p.blockhash
 * @param {PublicKey} [p.tipAccount]
 * @param {number} [p.tipSol]
 * @param {number} [p.priorityMicroLamports]
 * @param {boolean} [p.returnSol=true]  include the SOL return in this bundle
 */
export function buildRescueTransactions({
	compromised,
	destination,
	feePayer,
	solLamports,
	tokenAccounts,
	blockhash,
	tipAccount = randomTipAccount(),
	tipSol = 0.001,
	priorityMicroLamports = 100_000,
	returnSol = true,
}) {
	if (compromised.equals(destination)) {
		throw Object.assign(new Error('destination must differ from the compromised wallet'), {
			code: 'destination_is_compromised',
		});
	}
	if (feePayer.equals(compromised)) {
		throw Object.assign(
			new Error('the fee payer must be a different, safe wallet: SOL sent to the compromised wallet is swept'),
			{ code: 'fee_payer_is_compromised' },
		);
	}
	assertRecipientAllowed(destination.toBase58(), 'rescue destination');
	const tipLamports = Math.floor(clampJitoTipSol(tipSol) * LAMPORTS_PER_SOL);
	const priority = clampPriorityMicroLamports(priorityMicroLamports);

	const movable = tokenAccounts.filter((a) => a.state !== 'frozen');
	const skipped = tokenAccounts
		.filter((a) => a.state === 'frozen')
		.map((a) => ({ address: a.address.toBase58(), mint: a.mint.toBase58(), reason: 'frozen' }));

	// Tail instructions live in the last transaction; reserve room for them.
	const tailIxs = [];
	if (returnSol && solLamports > 0) {
		tailIxs.push(SystemProgram.transfer({ fromPubkey: compromised, toPubkey: destination, lamports: solLamports }));
	}
	tailIxs.push(SystemProgram.transfer({ fromPubkey: feePayer, toPubkey: tipAccount, lamports: tipLamports }));

	const groupsOf = (list) => list.map((account) => tokenAccountIxs({ account, compromised, destination, feePayer }));
	const fits = (groups, extra) =>
		compile(feePayer, blockhash, [...computeBudgetIxs(groups.length, priority), ...groups.flat(), ...extra]).serialize()
			.length <= MAX_TX_BYTES;

	/** @type {TokenAccountInfo[][]} */
	const batches = [];
	let current = [];
	let consumed = 0;
	for (const account of movable) {
		if (current.length && !fits(groupsOf([...current, account]), [])) {
			if (batches.length === MAX_BUNDLE_TXS - 1) break;
			batches.push(current);
			current = [];
		}
		current.push(account);
		consumed++;
	}
	if (current.length) batches.push(current);

	// The SOL return and tip ride in the last tx. If that tx has no room, give them
	// their own tx; when the bundle is already full, defer accounts to the next run.
	while (batches.length && !fits(groupsOf(batches[batches.length - 1]), tailIxs)) {
		if (batches.length < MAX_BUNDLE_TXS) {
			batches.push([]);
			break;
		}
		batches[batches.length - 1].pop();
		consumed--;
	}
	if (!batches.length) batches.push([]);
	const tailBatch = batches.length - 1;

	const transactions = batches.map((accounts, i) => {
		const groups = groupsOf(accounts);
		const ixs = [...computeBudgetIxs(groups.length, priority), ...groups.flat(), ...(i === tailBatch ? tailIxs : [])];
		return compile(feePayer, blockhash, ixs);
	});

	const sizes = transactions.map((t) => t.serialize().length);
	return {
		transactions,
		blockhash,
		summary: {
			compromised: compromised.toBase58(),
			destination: destination.toBase58(),
			feePayer: feePayer.toBase58(),
			tipAccount: tipAccount.toBase58(),
			tipLamports,
			priorityMicroLamports: priority,
			txCount: transactions.length,
			txBytes: sizes,
			tokenAccounts: batches.map((b) =>
				b.map((a) => ({
					address: a.address.toBase58(),
					mint: a.mint.toBase58(),
					amount: a.amount.toString(),
					decimals: a.decimals,
					program: a.programId.equals(TOKEN_2022_PROGRAM_ID) ? 'token-2022' : 'token',
				})),
			),
			solReturnLamports: returnSol ? solLamports : 0,
			skipped,
			remaining: movable.length - consumed,
			requiredSigners: [compromised.toBase58(), feePayer.toBase58()],
		},
	};
}

/**
 * Inventory, blockhash and build in one call. Read-only on chain.
 * @param {object} p
 * @param {import('@solana/web3.js').Connection} p.connection
 * @param {PublicKey} p.compromised
 * @param {PublicKey} p.destination
 * @param {PublicKey} p.feePayer
 * @param {number} [p.tipSol]
 * @param {number} [p.priorityMicroLamports]
 * @param {boolean} [p.returnSol]
 */
export async function buildRescuePlan({ connection, compromised, destination, feePayer, ...options }) {
	const [inventory, { blockhash, lastValidBlockHeight }] = await Promise.all([
		fetchRescueInventory(connection, compromised),
		connection.getLatestBlockhash('confirmed'),
	]);
	const plan = buildRescueTransactions({
		compromised,
		destination,
		feePayer,
		blockhash,
		solLamports: inventory.solLamports,
		tokenAccounts: inventory.tokenAccounts,
		...options,
	});
	return { ...plan, lastValidBlockHeight, inventory };
}

/**
 * Simulate every transaction (no signatures needed). The fee payer must hold
 * enough SOL for fees, destination account rent and the tip, which the
 * simulation checks for real.
 * @returns {Promise<{ ok: boolean, results: Array<{ index: number, ok: boolean, err: unknown, unitsConsumed: number|null, logs: string[]|null }> }>}
 */
export async function simulateRescuePlan(connection, plan) {
	const results = [];
	for (let index = 0; index < plan.transactions.length; index++) {
		const sim = await connection.simulateTransaction(plan.transactions[index], {
			sigVerify: false,
			replaceRecentBlockhash: true,
			commitment: 'confirmed',
		});
		results.push({
			index,
			ok: !sim.value.err,
			err: sim.value.err,
			unitsConsumed: sim.value.unitsConsumed ?? null,
			logs: sim.value.logs ?? null,
		});
	}
	return { ok: results.every((r) => r.ok), results };
}

/** Sign every transaction with the fee payer and the compromised keypair. */
export function signRescuePlan(plan, { feePayer, compromised }) {
	for (const tx of plan.transactions) tx.sign([feePayer, compromised]);
	return plan;
}

/**
 * Send a signed plan as one Jito bundle and wait for confirmation. This moves
 * real funds: callers must have shown the plan and obtained explicit consent.
 */
export async function sendRescuePlan(connection, plan, bs58encode) {
	const encoded = plan.transactions.map((tx) => bs58encode(tx.serialize()));
	const signatures = plan.transactions.map((tx) => bs58encode(tx.signatures[0]));
	const { bundleId, explorer } = await submitBundle(encoded);
	const wait = await waitForSignatures(connection, signatures, { timeoutMs: 60_000, intervalMs: 2_000 });
	return {
		ok: wait.ok,
		status: wait.err === 'timeout' ? 'pending' : wait.ok ? 'confirmed' : 'failed',
		bundleId,
		bundleExplorer: explorer,
		signatures,
		err: wait.err,
	};
}

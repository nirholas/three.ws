// Owner-funded agent budgets enforced by the chain: the Solana Subscriptions
// and Allowances program (@solana/subscriptions, MIT, Solana Foundation).
//
// The owner keeps funds in their OWN token account and signs one transaction
// that creates a fixed-delegation allowance (mint, cap, expiry) naming the
// agent's custodial wallet as delegatee. The agent can then pull up to the
// remaining allowance and not a lamport more, and the owner can revoke at any
// time with one signature. The cap is enforced by the program, not by our
// database; this module only (a) builds the unsigned owner transactions with
// the official generated client, (b) reads live allowance state off chain, and
// (c) exposes the remaining allowance as a hard ceiling so a pull the program
// would reject is refused before a transaction is ever built.
//
// Nothing here signs for the owner. The agent-side pull is signed with the
// agent's own custodial key by the caller (api/agents/solana-allowance.js).

import { PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { address, createNoopSigner, createSolanaRpc } from '@solana/kit';
import {
	SUBSCRIPTIONS_PROGRAM_ADDRESS,
	UNKNOWN_INIT_ID,
	fetchMaybeSubscriptionAuthority,
	fetchMaybeFixedDelegation,
	fetchMaybeRecurringDelegation,
	findSubscriptionAuthorityPda,
	findFixedDelegationPda,
	findRecurringDelegationPda,
	getInitSubscriptionAuthorityOverlayInstructionAsync,
	getCreateFixedDelegationOverlayInstructionAsync,
	getCreateRecurringDelegationOverlayInstructionAsync,
	getRevokeDelegationOverlayInstruction,
	getTransferFixedOverlayInstructionAsync,
	getTransferRecurringOverlayInstructionAsync,
	getSubscriptionsErrorMessage,
} from '@solana/subscriptions';

export const ALLOWANCE_PROGRAM_ID = SUBSCRIPTIONS_PROGRAM_ADDRESS;

const SOLANA_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const U64_MAX = (1n << 64n) - 1n;

export class AllowanceError extends Error {
	constructor(code, message, extra = {}) {
		super(message);
		this.code = code;
		this.extra = extra;
	}
}

/** Recurring pulls (agent-to-agent subscriptions) ship behind a flag. */
export function recurringEnabled(env = process.env) {
	return env.ALLOWANCE_RECURRING_ENABLED === '1' || env.ALLOWANCE_RECURRING_ENABLED === 'true';
}

function assertAddress(value, name) {
	if (typeof value !== 'string' || !SOLANA_ADDRESS_RE.test(value)) {
		throw new AllowanceError('invalid_request', `${name} must be a base58 Solana address`);
	}
	try {
		new PublicKey(value);
	} catch {
		throw new AllowanceError('invalid_request', `${name} is not a valid Solana address`);
	}
	return value;
}

function toBigInt(value, name) {
	try {
		const n = typeof value === 'bigint' ? value : BigInt(String(value));
		if (n < 0n || n > U64_MAX) throw new Error('range');
		return n;
	} catch {
		throw new AllowanceError('invalid_request', `${name} must be a non-negative integer that fits in u64`);
	}
}

// Kit AccountRole: 0 readonly, 1 writable, 2 readonly signer, 3 writable signer.
export function kitInstructionToWeb3(ix) {
	return new TransactionInstruction({
		programId: new PublicKey(ix.programAddress),
		keys: (ix.accounts ?? []).map((a) => ({
			pubkey: new PublicKey(a.address),
			isSigner: a.role >= 2,
			isWritable: (a.role & 1) === 1,
		})),
		data: Buffer.from(ix.data ?? []),
	});
}

// The shared RPC pool is imported lazily so the pure ceiling math and the
// transaction builders stay loadable (and testable) with an injected connection.
async function connectionFor(network, connection) {
	if (connection) return connection;
	const { solanaConnection } = await import('./solana/connection.js');
	return solanaConnection({ network });
}

function kitRpc(conn) {
	return createSolanaRpc(conn.rpcEndpoint);
}

async function tokenProgramFor(connection, mint) {
	const info = await connection.getAccountInfo(new PublicKey(mint), 'confirmed');
	if (!info) throw new AllowanceError('mint_not_found', 'that token mint does not exist on this network');
	if (info.owner.equals(TOKEN_PROGRAM_ID)) return TOKEN_PROGRAM_ID;
	if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
	throw new AllowanceError('mint_unsupported', 'that account is not an SPL or Token-2022 mint');
}

function ownerAta(mint, owner, tokenProgram) {
	return getAssociatedTokenAddressSync(new PublicKey(mint), new PublicKey(owner), true, tokenProgram);
}

// ── pure ceiling math ─────────────────────────────────────────────────────────

/**
 * Remaining pullable amount of a recurring delegation right now. A period that
 * has fully elapsed resets the pulled counter, mirroring the program.
 */
export function recurringRemaining({ amountPerPeriod, amountPulledInPeriod, currentPeriodStartTs, periodLengthS }, nowTs) {
	const per = BigInt(amountPerPeriod);
	const start = BigInt(currentPeriodStartTs);
	const len = BigInt(periodLengthS);
	if (BigInt(nowTs) < start) return 0n;
	if (len > 0n && BigInt(nowTs) >= start + len) return per;
	const left = per - BigInt(amountPulledInPeriod);
	return left > 0n ? left : 0n;
}

/**
 * The hard ceiling. `remaining` is the live on-chain allowance; `ownerBalance`
 * is the owner's token balance (an allowance cannot move funds the owner does
 * not hold). A request above either, past expiry, or with no allowance at all
 * is refused here, before any transaction exists.
 */
export function checkAllowanceCeiling({ remaining, expiryTs = 0n, ownerBalance = null, amount, nowTs = Math.floor(Date.now() / 1000) }) {
	const want = BigInt(amount);
	if (want <= 0n) return { allow: false, code: 'invalid_amount', reason: 'pull amount must be greater than zero' };
	if (remaining == null) {
		return { allow: false, code: 'no_allowance', reason: 'no active on-chain allowance for this agent and token' };
	}
	const exp = BigInt(expiryTs ?? 0n);
	if (exp !== 0n && BigInt(nowTs) >= exp) {
		return { allow: false, code: 'allowance_expired', reason: 'the owner-funded allowance has expired' };
	}
	const left = BigInt(remaining);
	if (want > left) {
		return {
			allow: false,
			code: 'allowance_exceeded',
			reason: `requested ${want} exceeds the remaining on-chain allowance of ${left}`,
			detail: { remaining: left.toString(), requested: want.toString() },
		};
	}
	if (ownerBalance != null && want > BigInt(ownerBalance)) {
		return {
			allow: false,
			code: 'owner_balance_low',
			reason: `the owner's token account holds ${BigInt(ownerBalance)}, less than the requested ${want}`,
			detail: { ownerBalance: BigInt(ownerBalance).toString(), requested: want.toString() },
		};
	}
	return { allow: true, code: 'ok', reason: 'within the on-chain allowance', detail: { remaining: left.toString() } };
}

// ── unsigned owner transactions ───────────────────────────────────────────────

async function finalizeUnsigned(connection, feePayer, instructions) {
	const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
	const tx = new Transaction({ feePayer: new PublicKey(feePayer), blockhash, lastValidBlockHeight });
	tx.add(...instructions);
	const serialized = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
	return { transaction: serialized.toString('base64'), blockhash, lastValidBlockHeight };
}

/**
 * Build the owner's create-allowance transaction, unsigned. Adds the one-time
 * SubscriptionAuthority init for this mint when the owner has none yet.
 */
export async function prepareCreateAllowance({
	network = 'mainnet',
	owner,
	delegatee,
	mint,
	amount,
	expiryTs,
	nonce = BigInt(Date.now()),
	kind = 'fixed',
	periodLengthS,
	startTs = 0,
	connection = null,
	env = process.env,
}) {
	assertAddress(owner, 'owner');
	assertAddress(delegatee, 'delegatee');
	assertAddress(mint, 'mint');
	if (owner === delegatee) throw new AllowanceError('invalid_request', 'the agent wallet must differ from the owner wallet');
	if (kind !== 'fixed' && kind !== 'recurring') throw new AllowanceError('invalid_request', 'kind must be "fixed" or "recurring"');
	if (kind === 'recurring' && !recurringEnabled(env)) {
		throw new AllowanceError('feature_disabled', 'recurring allowances are not enabled on this deployment');
	}
	const cap = toBigInt(amount, 'amount');
	if (cap === 0n) throw new AllowanceError('invalid_request', 'amount must be greater than zero');
	const expiry = toBigInt(expiryTs ?? 0, 'expiryTs');
	const nowTs = BigInt(Math.floor(Date.now() / 1000));
	if (expiry !== 0n && expiry <= nowTs) throw new AllowanceError('invalid_request', 'expiryTs must be in the future');
	if (kind === 'recurring') {
		if (expiry === 0n) throw new AllowanceError('invalid_request', 'a recurring allowance needs an expiry');
		if (!periodLengthS || BigInt(periodLengthS) <= 0n) throw new AllowanceError('invalid_request', 'periodLengthS is required for a recurring allowance');
	}

	const conn = await connectionFor(network, connection);
	const rpc = kitRpc(conn);
	const tokenProgram = await tokenProgramFor(conn, mint);
	const userAta = ownerAta(mint, owner, tokenProgram);
	const ataInfo = await conn.getAccountInfo(userAta, 'confirmed');
	if (!ataInfo) {
		throw new AllowanceError('owner_token_account_missing', 'the owner wallet has no token account for this mint yet; fund it first');
	}

	const ownerSigner = createNoopSigner(address(owner));
	const [authorityPda] = await findSubscriptionAuthorityPda({ tokenMint: address(mint), user: address(owner) });
	const authority = await fetchMaybeSubscriptionAuthority(rpc, authorityPda);

	const instructions = [];
	let expectedInitId;
	if (!authority.exists) {
		instructions.push(
			await getInitSubscriptionAuthorityOverlayInstructionAsync({
				owner: ownerSigner,
				tokenMint: address(mint),
				tokenProgram: address(tokenProgram.toBase58()),
				userAta: address(userAta.toBase58()),
			}),
		);
		expectedInitId = UNKNOWN_INIT_ID;
	} else {
		expectedInitId = authority.data.initId;
	}

	const common = {
		delegator: ownerSigner,
		delegatee: address(delegatee),
		tokenMint: address(mint),
		nonce,
		expiryTs: expiry,
		expectedSubscriptionAuthorityInitId: expectedInitId,
	};
	let delegationPda;
	if (kind === 'fixed') {
		instructions.push(await getCreateFixedDelegationOverlayInstructionAsync({ ...common, amount: cap }));
		[delegationPda] = await findFixedDelegationPda({
			subscriptionAuthority: authorityPda,
			delegator: address(owner),
			delegatee: address(delegatee),
			nonce,
		});
	} else {
		instructions.push(
			await getCreateRecurringDelegationOverlayInstructionAsync({
				...common,
				amountPerPeriod: cap,
				periodLengthS: BigInt(periodLengthS),
				startTs: BigInt(startTs),
			}),
		);
		[delegationPda] = await findRecurringDelegationPda({
			subscriptionAuthority: authorityPda,
			delegator: address(owner),
			delegatee: address(delegatee),
			nonce,
		});
	}

	const built = await finalizeUnsigned(conn, owner, instructions.map(kitInstructionToWeb3));
	return {
		...built,
		network,
		kind,
		owner,
		delegatee,
		mint,
		tokenProgram: tokenProgram.toBase58(),
		ownerTokenAccount: userAta.toBase58(),
		amount: cap.toString(),
		expiryTs: Number(expiry),
		nonce: nonce.toString(),
		delegationPda: String(delegationPda),
		initializesAuthority: !authority.exists,
		programId: ALLOWANCE_PROGRAM_ID,
	};
}

/** Build the owner's one-click revoke transaction, unsigned. */
export async function prepareRevokeAllowance({ network = 'mainnet', owner, delegationPda, connection = null }) {
	assertAddress(owner, 'owner');
	assertAddress(delegationPda, 'delegationPda');
	const conn = await connectionFor(network, connection);
	const info = await conn.getAccountInfo(new PublicKey(delegationPda), 'confirmed');
	if (!info) throw new AllowanceError('allowance_not_found', 'that allowance no longer exists on chain (already revoked or closed)');
	const ix = getRevokeDelegationOverlayInstruction({
		authority: createNoopSigner(address(owner)),
		delegationAccount: address(delegationPda),
	});
	const built = await finalizeUnsigned(conn, owner, [kitInstructionToWeb3(ix)]);
	return { ...built, network, owner, delegationPda, programId: ALLOWANCE_PROGRAM_ID };
}

// ── live on-chain state ───────────────────────────────────────────────────────

/**
 * Read one allowance off chain by its delegation PDA. Returns null when the
 * account is gone (revoked or closed). `remaining` is the live pullable amount.
 */
export async function readAllowance({ network = 'mainnet', kind = 'fixed', delegationPda, connection = null, nowTs = Math.floor(Date.now() / 1000) }) {
	const conn = await connectionFor(network, connection);
	const rpc = kitRpc(conn);
	const fetcher = kind === 'recurring' ? fetchMaybeRecurringDelegation : fetchMaybeFixedDelegation;
	const acct = await fetcher(rpc, address(delegationPda));
	if (!acct.exists) return null;
	const d = acct.data;
	const mint = String(d.mint);
	const owner = String(d.header.delegator);
	const delegatee = String(d.header.delegatee);
	const expiryTs = Number(d.expiryTs);
	let remaining;
	let cap;
	if (kind === 'recurring') {
		remaining = recurringRemaining(d, nowTs);
		cap = d.amountPerPeriod;
	} else {
		remaining = d.amount;
		cap = null;
	}
	return {
		kind,
		delegationPda,
		owner,
		delegatee,
		mint,
		remaining: remaining.toString(),
		capOnChain: cap == null ? null : cap.toString(),
		expiryTs,
		expired: expiryTs !== 0 && nowTs >= expiryTs,
		periodLengthS: kind === 'recurring' ? Number(d.periodLengthS) : null,
	};
}

/** The owner's current balance of the mint (0n when the token account is absent). */
export async function readOwnerBalance({ network = 'mainnet', owner, mint, connection = null }) {
	const conn = await connectionFor(network, connection);
	const tokenProgram = await tokenProgramFor(conn, mint);
	const ata = ownerAta(mint, owner, tokenProgram);
	try {
		const bal = await conn.getTokenAccountBalance(ata, 'confirmed');
		return BigInt(bal.value.amount);
	} catch {
		return 0n;
	}
}

/**
 * Preflight for a pull: live allowance + owner balance run through the ceiling.
 * This is the function the spend guards and the pull endpoint both call.
 */
export async function checkAllowancePull({ network = 'mainnet', kind = 'fixed', delegationPda, amount, connection = null }) {
	const live = await readAllowance({ network, kind, delegationPda, connection });
	if (!live) {
		return { allow: false, code: 'no_allowance', reason: 'the allowance was revoked or no longer exists on chain', live: null };
	}
	const ownerBalance = await readOwnerBalance({ network, owner: live.owner, mint: live.mint, connection });
	const verdict = checkAllowanceCeiling({ remaining: live.remaining, expiryTs: live.expiryTs, ownerBalance, amount });
	return { ...verdict, live, ownerBalance: ownerBalance.toString() };
}

// ── agent-side pull ───────────────────────────────────────────────────────────

/**
 * Build the pull transaction signed by the agent's custodial keypair. Funds land
 * in the agent wallet's own token account (created idempotently if missing), so
 * everything the agent does next with them still passes the existing guards.
 * The caller must have run checkAllowancePull first; the program re-enforces
 * the same limits regardless.
 */
export async function buildSignedPull({ network = 'mainnet', kind = 'fixed', delegationPda, owner, mint, amount, agentKeypair, connection = null }) {
	const conn = await connectionFor(network, connection);
	const tokenProgram = await tokenProgramFor(conn, mint);
	const delegatorAta = ownerAta(mint, owner, tokenProgram);
	const receiverAta = ownerAta(mint, agentKeypair.publicKey.toBase58(), tokenProgram);

	const { createAssociatedTokenAccountIdempotentInstruction } = await import('@solana/spl-token');
	const instructions = [
		createAssociatedTokenAccountIdempotentInstruction(agentKeypair.publicKey, receiverAta, agentKeypair.publicKey, new PublicKey(mint), tokenProgram),
	];
	const input = {
		amount: toBigInt(amount, 'amount'),
		delegatee: createNoopSigner(address(agentKeypair.publicKey.toBase58())),
		delegationPda: address(delegationPda),
		delegator: address(owner),
		delegatorAta: address(delegatorAta.toBase58()),
		receiverAta: address(receiverAta.toBase58()),
		tokenMint: address(mint),
		tokenProgram: address(tokenProgram.toBase58()),
	};
	const kitIx = kind === 'recurring' ? await getTransferRecurringOverlayInstructionAsync(input) : await getTransferFixedOverlayInstructionAsync(input);
	instructions.push(kitInstructionToWeb3(kitIx));

	const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
	const tx = new Transaction({ feePayer: agentKeypair.publicKey, blockhash, lastValidBlockHeight });
	tx.add(...instructions);
	tx.sign(agentKeypair);
	return { tx, blockhash, lastValidBlockHeight, receiverAta: receiverAta.toBase58() };
}

/**
 * Translate a program rejection (simulation error plus logs, or a thrown RPC
 * error) into a message an owner can act on: the program's own text for its
 * custom errors (e.g. "Transfer amount exceeds delegation limit"), and a plain
 * explanation when the delegation account has been closed by a revoke.
 */
export function describeProgramFailure(err) {
	const msg = String(err?.message ?? err ?? '');
	if (msg.includes('InvalidAccountOwner')) {
		return 'the allowance account no longer exists on chain (revoked or closed)';
	}
	const hex = msg.match(/custom program error: 0x([0-9a-f]+)/i);
	const dec = msg.match(/"Custom":\s*(\d+)/);
	const code = hex ? parseInt(hex[1], 16) : dec ? Number(dec[1]) : null;
	if (code != null) {
		try {
			return getSubscriptionsErrorMessage(code);
		} catch {
			return `program error ${code}`;
		}
	}
	return msg.slice(0, 300);
}

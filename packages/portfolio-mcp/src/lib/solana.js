// Solana primitives: keypair load, live balance reads, and signed transfers.
//
// send_transfer signs LOCALLY with the agent's own key (SOLANA_SECRET_KEY, or a
// per-call `secret`). We never embed a default key. This mirrors the on-chain
// transfer the three.ws /api/portfolio/send route performs server-side, but here
// the agent holds its own signer instead of a custodial one.

import {
	Connection,
	Keypair,
	PublicKey,
	SystemProgram,
	Transaction,
	ComputeBudgetProgram,
	LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import bs58 from 'bs58';

// @solana/spl-token is loaded LAZILY. Its ESM build imports
// @solana/buffer-layout-utils through a subpath whose `.mjs` entry is absent in
// some installs, which throws at module-load time. Deferring the import to first
// use keeps this module — and therefore the whole MCP tool surface — loading
// cleanly; only the SPL-token code paths (token balances, SPL transfers) need it.
let _splTokenPromise = null;
function splToken() {
	if (!_splTokenPromise) _splTokenPromise = import('@solana/spl-token');
	return _splTokenPromise;
}

import { SOLANA_RPC_URL, SOLANA_DEFAULT_SECRET } from '../config.js';
import { assertSolWithinCap, clampPriorityMicroLamports } from './spend-policy.js';

const bs58decode = bs58.default ? bs58.default.decode : bs58.decode;

let _conn = null;
export function getConnection() {
	if (!_conn) _conn = new Connection(SOLANA_RPC_URL, 'confirmed');
	return _conn;
}

export function isValidPubkey(s) {
	try {
		new PublicKey(s);
		return true;
	} catch {
		return false;
	}
}

export function keypairFromSecret(secret) {
	const trimmed = String(secret || '').trim();
	if (!trimmed) {
		throw Object.assign(
			new Error(
				'Solana secret required. Pass `secret` (base58) in the tool call, or set SOLANA_SECRET_KEY ' +
					'in the MCP server environment.',
			),
			{ code: 'no_signer' },
		);
	}
	const bytes = bs58decode(trimmed);
	if (bytes.length !== 64) {
		throw Object.assign(new Error(`Solana secret must decode to 64 bytes (got ${bytes.length})`), {
			code: 'invalid_secret',
		});
	}
	return Keypair.fromSecretKey(bytes);
}

export function loadSigner(secret) {
	return keypairFromSecret(secret || SOLANA_DEFAULT_SECRET);
}

// Live native SOL balance for any pubkey.
export async function getBalanceSol(pubkeyStr) {
	const conn = getConnection();
	const lamports = await conn.getBalance(new PublicKey(pubkeyStr), 'confirmed');
	return { lamports, sol: lamports / LAMPORTS_PER_SOL };
}

// Live SPL token balances (classic SPL + Token-2022) for any pubkey. Only
// non-zero positions are returned.
export async function getTokenBalances(pubkeyStr) {
	const { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } = await splToken();
	const conn = getConnection();
	const owner = new PublicKey(pubkeyStr);
	const [legacy, t22] = await Promise.all([
		conn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }),
		conn.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }),
	]);
	const all = [...legacy.value, ...t22.value];
	return all
		.map((r) => {
			const info = r.account.data?.parsed?.info;
			if (!info) return null;
			const amount = info.tokenAmount;
			const isT22 = r.account.owner?.equals?.(TOKEN_2022_PROGRAM_ID) ?? false;
			return {
				mint: info.mint,
				account: r.pubkey.toBase58(),
				amount: amount?.amount,
				ui_amount: amount?.uiAmount,
				ui_amount_string: amount?.uiAmountString,
				decimals: amount?.decimals,
				program: isT22 ? 'token-2022' : 'spl-token',
			};
		})
		.filter(Boolean)
		.filter((t) => Number(t.ui_amount) > 0);
}

// Convert a human decimal amount string into base units without float rounding.
function parseAmountToBaseUnits(amountStr, decimals) {
	const [whole, frac = ''] = String(amountStr).split('.');
	const fracPadded = (frac + '0'.repeat(decimals)).slice(0, decimals);
	const combined = (whole + fracPadded).replace(/^0+/, '') || '0';
	return BigInt(combined);
}

// Which token program owns a mint — classic SPL or Token-2022. Token-2022 mints
// need their own program id on the transfer/ATA instructions.
async function resolveTokenProgram(conn, mintPk) {
	const { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } = await splToken();
	const info = await conn.getAccountInfo(mintPk);
	if (!info) {
		throw Object.assign(new Error(`mint ${mintPk.toBase58()} not found on-chain`), { code: 'mint_not_found' });
	}
	if (info.owner.equals(TOKEN_2022_PROGRAM_ID)) return TOKEN_2022_PROGRAM_ID;
	return TOKEN_PROGRAM_ID;
}

/**
 * Build, sign, and broadcast a transfer from the loaded signer.
 *
 * @param {{ secret?: string, to: string, amount: string, mint?: string|null,
 *           priorityMicroLamports?: number }} opts
 *   `mint` omitted / 'native' → SOL transfer (capped by MAX_SOL_PER_TX).
 *   `mint` = base58 SPL mint → SPL transfer (runtime-supplied; never hardcoded).
 * @returns {Promise<object>} signature + confirmation status + explorer link.
 */
export async function sendTransfer({ secret, to, amount, mint, priorityMicroLamports = 100000 }) {
	if (!isValidPubkey(to)) {
		throw Object.assign(new Error(`Destination is not a valid Solana pubkey: ${to}`), {
			code: 'invalid_destination',
		});
	}
	const isNative = !mint || mint === 'native';
	if (!isNative && !isValidPubkey(mint)) {
		throw Object.assign(new Error(`mint must be a base58 SPL mint or "native" (got ${mint})`), {
			code: 'invalid_mint',
		});
	}

	const signer = loadSigner(secret);
	const conn = getConnection();
	const recipientPk = new PublicKey(to);
	const microLamports = clampPriorityMicroLamports(priorityMicroLamports);

	const tx = new Transaction();
	tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports }));

	let decimals;
	let baseUnits;

	if (isNative) {
		const sol = Number(amount);
		assertSolWithinCap(sol, 'send_transfer (SOL)');
		const lamports = BigInt(Math.round(sol * LAMPORTS_PER_SOL));
		if (lamports <= 0n) {
			throw Object.assign(new Error(`amount must be a positive number of SOL (got ${amount})`), {
				code: 'invalid_amount',
			});
		}
		decimals = 9;
		baseUnits = lamports;
		tx.add(
			SystemProgram.transfer({
				fromPubkey: signer.publicKey,
				toPubkey: recipientPk,
				lamports,
			}),
		);
	} else {
		const {
			getMint,
			getAssociatedTokenAddress,
			getAccount,
			createAssociatedTokenAccountInstruction,
			createTransferCheckedInstruction,
		} = await splToken();
		const mintPk = new PublicKey(mint);
		const programId = await resolveTokenProgram(conn, mintPk);
		const mintInfo = await getMint(conn, mintPk, 'confirmed', programId);
		decimals = mintInfo.decimals;
		baseUnits = parseAmountToBaseUnits(amount, decimals);
		if (baseUnits <= 0n) {
			throw Object.assign(new Error(`amount must be a positive token amount (got ${amount})`), {
				code: 'invalid_amount',
			});
		}

		const senderAta = await getAssociatedTokenAddress(mintPk, signer.publicKey, false, programId);
		const recipientAta = await getAssociatedTokenAddress(mintPk, recipientPk, false, programId);

		// Sender must already hold the token. A missing/empty sender ATA is a clear
		// "you don't hold this" error, not a silent failed broadcast.
		try {
			const senderAcct = await getAccount(conn, senderAta, 'confirmed', programId);
			if (senderAcct.amount < baseUnits) {
				throw Object.assign(
					new Error(
						`insufficient token balance: have ${senderAcct.amount}, need ${baseUnits} base units of ${mint}`,
					),
					{ code: 'insufficient_balance' },
				);
			}
		} catch (e) {
			if (e.code === 'insufficient_balance') throw e;
			throw Object.assign(new Error(`signer holds no ${mint} (no token account)`), {
				code: 'insufficient_balance',
			});
		}

		// Create the recipient's ATA if it doesn't exist yet (payer = signer).
		const recipientAcct = await conn.getAccountInfo(recipientAta);
		if (!recipientAcct) {
			tx.add(
				createAssociatedTokenAccountInstruction(
					signer.publicKey,
					recipientAta,
					recipientPk,
					mintPk,
					programId,
				),
			);
		}
		tx.add(
			createTransferCheckedInstruction(
				senderAta,
				mintPk,
				recipientAta,
				signer.publicKey,
				baseUnits,
				decimals,
				[],
				programId,
			),
		);
	}

	const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash('confirmed');
	tx.feePayer = signer.publicKey;
	tx.recentBlockhash = blockhash;
	tx.sign(signer);

	const sig = await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 5 });

	// Confirmation can throw (block-height-exceeded) even though the tx may still
	// land. Distinguish "confirmed failure" from "unknown" so the caller does NOT
	// blindly retry and risk a double-spend.
	let conf;
	try {
		conf = await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
	} catch (waitErr) {
		throw Object.assign(
			new Error(
				`Transaction ${sig} was submitted but confirmation timed out (${waitErr?.message || waitErr}). ` +
					'It MAY still land — check the signature on Solscan before resending to avoid a double-spend.',
			),
			{ code: 'tx_unconfirmed', status: 'pending', signature: sig },
		);
	}
	if (conf?.value?.err) {
		throw Object.assign(new Error(`Transaction failed: ${JSON.stringify(conf.value.err)}`), {
			code: 'tx_failed',
			status: 'failed',
			signature: sig,
		});
	}

	return {
		status: 'confirmed',
		signature: sig,
		from: signer.publicKey.toBase58(),
		to,
		asset: isNative ? 'SOL' : mint,
		amount: String(amount),
		decimals,
		base_units: baseUnits.toString(),
		explorer: `https://solscan.io/tx/${sig}`,
	};
}

// Rent for a new associated token account (165 bytes), paid by the sender when
// the recipient has none yet. Read live when possible; this is the fallback.
const ATA_RENT_LAMPORTS_FALLBACK = 2_039_280;
const BASE_FEE_LAMPORTS = 5000;
const TRANSFER_COMPUTE_UNITS = 200_000;

/**
 * Preview a send_transfer without signing: the sender address, what it holds of
 * the asset, the exact base units that would move, whether the recipient needs
 * a new token account (and the rent that costs), the network fee, and every
 * rule that would refuse the transfer. Refusals are returned, never thrown.
 */
export async function previewTransfer({ secret, to, amount, mint, priorityMicroLamports = 100000 }, policy) {
	const blockers = [];
	if (!isValidPubkey(to)) blockers.push({ code: 'invalid_destination', message: `Not a valid Solana pubkey: ${to}` });
	else if (policy.allowlist && !policy.allowlist.has(to)) {
		blockers.push({ code: 'recipient_not_allowed', message: `${to} is not in RECIPIENT_ALLOWLIST.` });
	}
	const isNative = !mint || mint === 'native';
	if (!isNative && !isValidPubkey(mint)) {
		blockers.push({ code: 'invalid_mint', message: `mint must be a base58 SPL mint or "native" (got ${mint})` });
		return { from: null, to, blockers, would_execute: false };
	}

	const signer = loadSigner(secret);
	const from = signer.publicKey.toBase58();
	const conn = getConnection();
	const microLamports = clampPriorityMicroLamports(priorityMicroLamports);
	const feeLamports = BASE_FEE_LAMPORTS + Math.ceil((microLamports * TRANSFER_COMPUTE_UNITS) / 1_000_000);
	const solLamports = BigInt(await conn.getBalance(signer.publicKey, 'confirmed'));

	if (isNative) {
		const sol = Number(amount);
		const lamports = BigInt(Math.round(sol * LAMPORTS_PER_SOL));
		if (sol > policy.maxSolPerTx) {
			blockers.push({ code: 'over_spend_cap', message: `${sol} SOL exceeds the per-tx cap of ${policy.maxSolPerTx} SOL.` });
		}
		if (solLamports < lamports + BigInt(feeLamports)) {
			blockers.push({ code: 'insufficient_balance', message: `Sender holds ${Number(solLamports) / LAMPORTS_PER_SOL} SOL; this needs ${Number(lamports + BigInt(feeLamports)) / LAMPORTS_PER_SOL} SOL including the fee.` });
		}
		return {
			action: 'send_transfer',
			chain: 'solana-mainnet',
			asset: 'SOL',
			from,
			to,
			amount: String(amount),
			base_units: String(lamports),
			network_fee_sol: feeLamports / LAMPORTS_PER_SOL,
			sender_sol: Number(solLamports) / LAMPORTS_PER_SOL,
			sender_sol_after: Number(solLamports - lamports - BigInt(feeLamports)) / LAMPORTS_PER_SOL,
			would_execute: blockers.length === 0,
			blockers,
		};
	}

	const { getMint, getAssociatedTokenAddress, getAccount } = await splToken();
	const mintPk = new PublicKey(mint);
	const programId = await resolveTokenProgram(conn, mintPk);
	const mintInfo = await getMint(conn, mintPk, 'confirmed', programId);
	const baseUnits = parseAmountToBaseUnits(amount, mintInfo.decimals);
	const senderAta = await getAssociatedTokenAddress(mintPk, signer.publicKey, false, programId);
	let held = 0n;
	try {
		held = (await getAccount(conn, senderAta, 'confirmed', programId)).amount;
	} catch {
		held = 0n;
	}
	if (held < baseUnits) {
		blockers.push({ code: 'insufficient_balance', message: `Sender holds ${held} base units of ${mint}; this needs ${baseUnits}.` });
	}
	let ataRent = 0;
	if (isValidPubkey(to)) {
		const recipientAta = await getAssociatedTokenAddress(mintPk, new PublicKey(to), false, programId);
		if (!(await conn.getAccountInfo(recipientAta))) {
			ataRent = await conn.getMinimumBalanceForRentExemption(165).catch(() => ATA_RENT_LAMPORTS_FALLBACK);
		}
	}
	if (solLamports < BigInt(feeLamports + ataRent)) {
		blockers.push({ code: 'insufficient_sol_for_fees', message: `Sender needs ${(feeLamports + ataRent) / LAMPORTS_PER_SOL} SOL for fees and rent; holds ${Number(solLamports) / LAMPORTS_PER_SOL}.` });
	}
	return {
		action: 'send_transfer',
		chain: 'solana-mainnet',
		asset: mint,
		decimals: mintInfo.decimals,
		from,
		to,
		amount: String(amount),
		base_units: String(baseUnits),
		sender_token_base_units: String(held),
		creates_recipient_token_account: ataRent > 0,
		recipient_account_rent_sol: ataRent / LAMPORTS_PER_SOL,
		network_fee_sol: feeLamports / LAMPORTS_PER_SOL,
		sender_sol: Number(solLamports) / LAMPORTS_PER_SOL,
		would_execute: blockers.length === 0,
		blockers,
	};
}

// Pure Solana x402 "exact" transaction validation. No I/O except the optional
// blockhash probe, no environment reads, no module state: every policy value is an
// argument, so the same code runs the three.ws production rail and a self-hosted
// operator's facilitator. Extracted from the production self-facilitator.
//
// SECURITY: the fee payer co-signs the WHOLE transaction, so a facilitator that
// blind-signs whatever /settle receives lets anyone drain the sponsor. The gate
// below refuses to co-sign anything whose program set is not EXACTLY
// {ComputeBudget, memo, wallet guard assertions, optional ATA-create for the
// allowlisted recipient, one TransferChecked to an allowlisted payTo}.

import bs58 from 'bs58';
import { ed25519 } from '@noble/curves/ed25519.js';
import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import {
	getAssociatedTokenAddressSync,
	TOKEN_PROGRAM_ID,
	TOKEN_2022_PROGRAM_ID,
	ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';

import { defaultTokenPrograms, isSupportedTokenProgram } from './tokens.js';

export { bs58 };

const COMPUTE_BUDGET_PROGRAM_ID = new PublicKey(
	'ComputeBudget111111111111111111111111111111',
);
const SYSTEM_PROGRAM_ID = new PublicKey('11111111111111111111111111111111');
// SPL Memo, both live program ids. The reference x402 SVM client (@x402/svm,
// which our own buildSolanaExactPayload delegates to) attaches a memo to every
// `exact` payment it builds, so a facilitator that rejects memos cannot settle
// a payment built by the standard client at all. Memo writes to the transaction
// log and owns no accounts: it cannot move a lamport or a token, which is why it
// is skipped here the same way a ComputeBudget instruction is. Its compute cost
// still counts against the CU/fee ceiling enforced below.
const MEMO_PROGRAM_IDS = [
	new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr'),
	new PublicKey('Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo'),
];

// Lighthouse, the on-chain assertion program. Phantom's transaction protection
// injects one or more Lighthouse instructions into a transaction before the
// user signs it: they assert the buyer's balances end up where the wallet's
// simulation said they would, and revert the transaction otherwise. They move
// nothing, and the reference x402 SVM facilitator (@x402/svm) accepts them for
// the same reason. Refusing them locked every Phantom buyer with protection on
// out of the rail, which is Phantom's default. One constraint is ours alone:
// Lighthouse also has a memory-write instruction that charges a payer account
// for a PDA, so in sponsor mode a Lighthouse instruction may never name the
// sponsor's fee-payer account. Enforced below, once the mode is known.
const LIGHTHOUSE_PROGRAM_ID = new PublicKey('L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95');
// Phantom injects one or two. The ceiling keeps a hostile client from padding
// a sponsored transaction with compute it does not pay for.
const MAX_LIGHTHOUSE_INSTRUCTIONS = 3;

// SPL Token instruction tag for TransferChecked. Plain Transfer (3) is rejected -
// TransferChecked commits the mint + decimals, so we can trust the decoded mint.
const SPL_TRANSFER_CHECKED = 12;
// ComputeBudget instruction tags.
const CB_SET_UNIT_LIMIT = 2;
const CB_SET_UNIT_PRICE = 3;

// Rent an idempotent ATA-create locks on the sponsor for a NEW recipient token
// account (~0.00204 SOL). Reclaimable by closing the ATA. Bounded, one-time.
// A Token-2022 ATA carries the ImmutableOwner extension, so it is 170 bytes
// rather than 165 and its rent-exempt minimum is higher. Under-estimating it
// lets a settle clear the fee-floor gate and then die on chain for rent.
// Both figures are ceilings, priced at the 6960 lamports/byte-year rate. Mainnet
// charged less than that when last read (2026-09-20: 1,488,440 and 1,513,840),
// and an over-estimate only makes the floor gate stricter, never unsafe.
const ATA_RENT_LAMPORTS = 2_039_280;
const ATA_RENT_LAMPORTS_TOKEN_2022 = 2_074_080;
export const ataRentLamports = (tokenProgram) =>
	String(tokenProgram) === TOKEN_2022_PROGRAM_ID.toBase58()
		? ATA_RENT_LAMPORTS_TOKEN_2022
		: ATA_RENT_LAMPORTS;

// Fee-drain ceilings. A priority fee is paid by the SPONSOR, so cap it. An honest
// buyer uses far less (about 60 lamports); these sit well above that and bound any
// adversarial submission.
export const DEFAULT_POLICY = Object.freeze({
	maxCuLimit: 300_000,
	maxCuPriceMicroLamports: 100_000,
	maxPriorityLamports: 20_000,
});

function readU32LE(data, offset) {
	return (
		data[offset] |
		(data[offset + 1] << 8) |
		(data[offset + 2] << 16) |
		(data[offset + 3] << 24)
	) >>> 0;
}

function readU64LE(data, offset) {
	let v = 0n;
	for (let i = 7; i >= 0; i--) v = (v << 8n) | BigInt(data[offset + i]);
	return v;
}

// Decode + STRICTLY validate a buyer-signed ring payment transaction. Returns
// { ok:true, decoded } when it is a clean single-USDC-transfer to an allowlisted
// recipient with a bounded sponsor fee, or { ok:false, reason } otherwise. Never
// throws on adversarial input, a bad tx is a clean refusal, not a 5xx.
export function validateRingTransaction({
	txBase64,
	requirement,
	feePayerPubkey,
	allowlist,
	tokenProgramId,
	settleableMints = [],
	policy = DEFAULT_POLICY,
	tokenPrograms = defaultTokenPrograms(),
}) {
	const limits = { ...DEFAULT_POLICY, ...policy };
	let tx;
	try {
		tx = VersionedTransaction.deserialize(Buffer.from(txBase64, 'base64'));
	} catch (err) {
		return { ok: false, reason: `deserialize_failed:${err.message}` };
	}
	const msg = tx.message;

	// Address-table lookups would hide accounts we can't statically resolve.
	// The ring builder never uses them; reject to keep validation total.
	if (msg.addressTableLookups && msg.addressTableLookups.length > 0) {
		return { ok: false, reason: 'address_table_lookups_forbidden' };
	}

	const keys = msg.staticAccountKeys;
	if (!keys || keys.length === 0) return { ok: false, reason: 'no_account_keys' };

	// Every account index in a (possibly adversarial) compiled instruction must
	// resolve to a real static key. An out-of-range index would dereference
	// undefined and throw a TypeError, breaking the "never throws" contract this
	// facilitator's security model relies on, treat any bad index as a refusal.
	const idxInRange = (i) => Number.isInteger(i) && i >= 0 && i < keys.length;

	// Fee payer is always account index 0. Whether it must equal the configured
	// sponsor (sponsor mode) or may be the buyer itself (self-pay, 1 signature) is
	// decided AFTER we learn the transfer authority below.
	const feePayer = keys[0];

	const mint = new PublicKey(requirement.asset);
	const requiredAmount = BigInt(requirement.amount);
	const payTo = new PublicKey(requirement.payTo);

	if (!allowlist.has(payTo.toBase58())) {
		return { ok: false, reason: `pay_to_not_allowlisted:${payTo.toBase58()}` };
	}

	// The mint must be one the platform actually issues 402s for (USDC, plus
	// $THREE when configured). The requirement is caller-supplied: without
	// this pin a junk mint passes every check below, including the
	// sponsor-funded ATA create, so each call would burn sponsor ATA rent +
	// fees settling a worthless transfer, repeatable per fresh mint. Fail
	// closed when no settleable mint is configured at all.
	const settleable = Array.from(settleableMints || []).filter(Boolean);
	if (!settleable.includes(mint.toBase58())) {
		return { ok: false, reason: `mint_not_settleable:${mint.toBase58()}` };
	}

	// The program that owns the mint decides every ATA address below and is the
	// only token program this transaction may call. USDC is classic SPL Token and
	// $THREE is Token-2022. It is pinned from the mint, never read off the buyer's
	// instruction: a buyer who picks the program picks the ATA derivation too, and
	// could steer the sponsor into funding an account the mint's real program
	// will never credit.
	const tokenProgram =
		tokenProgramId || tokenPrograms.known(mint) || TOKEN_PROGRAM_ID;

	const expectedReceiverAta = getAssociatedTokenAddressSync(
		mint, payTo, false, tokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID,
	);

	let transferCount = 0;
	let payer = null;
	let transferAmount = 0n;
	let cuLimit = 200_000; // Solana default when unset
	let cuPrice = 0n;
	let ataCreatePresent = false;
	let lighthouseCount = 0;
	let lighthouseTouchesFeePayer = false;

	const ixs = msg.compiledInstructions;
	try {
	for (const ix of ixs) {
		if (!idxInRange(ix.programIdIndex)) {
			return { ok: false, reason: 'malformed_instruction' };
		}
		const programId = keys[ix.programIdIndex];
		const data = ix.data; // Uint8Array
		const accts = ix.accountKeyIndexes;

		if (programId.equals(SYSTEM_PROGRAM_ID)) {
			// A top-level System instruction could move the sponsor's SOL. Never allow.
			return { ok: false, reason: 'system_instruction_forbidden' };
		}

		if (programId.equals(COMPUTE_BUDGET_PROGRAM_ID)) {
			const tag = data[0];
			if (tag === CB_SET_UNIT_LIMIT) {
				cuLimit = readU32LE(data, 1);
			} else if (tag === CB_SET_UNIT_PRICE) {
				cuPrice = readU64LE(data, 1);
			}
			// Other compute-budget tags carry no fund movement; ignore.
			continue;
		}

		if (MEMO_PROGRAM_IDS.some((id) => programId.equals(id))) {
			// Carries no fund movement (see MEMO_PROGRAM_IDS). Skipped, not counted.
			continue;
		}

		if (programId.equals(LIGHTHOUSE_PROGRAM_ID)) {
			// Wallet-injected assertions (see LIGHTHOUSE_PROGRAM_ID). Carries no
			// fund movement of its own; whether it may name the fee payer depends
			// on the mode, decided after the loop.
			if (!accts.every(idxInRange)) return { ok: false, reason: 'malformed_instruction' };
			lighthouseCount += 1;
			if (lighthouseCount > MAX_LIGHTHOUSE_INSTRUCTIONS) {
				return { ok: false, reason: `too_many_guard_instructions:${lighthouseCount}` };
			}
			if (accts.includes(0)) lighthouseTouchesFeePayer = true;
			continue;
		}

		if (programId.equals(ASSOCIATED_TOKEN_PROGRAM_ID)) {
			// Only permit creating OUR recipient's ATA, funded by the sponsor.
			// Accounts: [funder, ata, owner, mint, systemProgram, tokenProgram].
			if (accts.length < 4 || !accts.slice(0, 4).every(idxInRange)) {
				return { ok: false, reason: 'malformed_instruction' };
			}
			const funder = keys[accts[0]];
			const ata = keys[accts[1]];
			const owner = keys[accts[2]];
			const ixMint = keys[accts[3]];
			if (!ata.equals(expectedReceiverAta)) {
				return { ok: false, reason: 'ata_create_wrong_account' };
			}
			if (!owner.equals(payTo)) return { ok: false, reason: 'ata_create_wrong_owner' };
			if (!ixMint.equals(mint)) return { ok: false, reason: 'ata_create_wrong_mint' };
			if (!funder.equals(feePayer)) return { ok: false, reason: 'ata_create_wrong_funder' };
			// Accounts 4 and 5 are the System and token programs. The ATA address
			// already commits to the token program, so a mismatch here can only
			// fail on chain, after the sponsor paid the fee. Refuse it up front.
			if (accts.length >= 6 && idxInRange(accts[5]) && !keys[accts[5]].equals(tokenProgram)) {
				return { ok: false, reason: 'ata_create_wrong_token_program' };
			}
			ataCreatePresent = true;
			continue;
		}

		if (isSupportedTokenProgram(programId)) {
			// A real token program, but not the one that owns this mint: the
			// transfer would revert on chain. Name it instead of settling it.
			if (!programId.equals(tokenProgram)) {
				return { ok: false, reason: `wrong_token_program:${programId.toBase58()}` };
			}
			// The ONLY value-moving instruction we permit: one TransferChecked of
			// the required amount from the buyer to OUR recipient ATA.
			// Accounts: [source, mint, destination, authority].
			if (data[0] !== SPL_TRANSFER_CHECKED) {
				return { ok: false, reason: `token_ix_not_transfer_checked:${data[0]}` };
			}
			transferCount += 1;
			if (transferCount > 1) return { ok: false, reason: 'multiple_transfers' };

			// Accounts: [source, mint, destination, authority].
			if (accts.length < 4 || !accts.slice(0, 4).every(idxInRange)) {
				return { ok: false, reason: 'malformed_instruction' };
			}
			const source = keys[accts[0]];
			const ixMint = keys[accts[1]];
			const dest = keys[accts[2]];
			const authority = keys[accts[3]];

			if (!ixMint.equals(mint)) return { ok: false, reason: 'transfer_wrong_mint' };
			if (!dest.equals(expectedReceiverAta)) {
				return { ok: false, reason: 'transfer_wrong_destination' };
			}
			// The buyer (authority) must own the source ATA and must be a signer.
			const expectedSource = getAssociatedTokenAddressSync(
				mint, authority, false, tokenProgram, ASSOCIATED_TOKEN_PROGRAM_ID,
			);
			if (!source.equals(expectedSource)) {
				return { ok: false, reason: 'transfer_source_not_authority_ata' };
			}
			// authority must be a required signer (index < numRequiredSignatures).
			const authIndex = accts[3];
			if (authIndex >= msg.header.numRequiredSignatures) {
				return { ok: false, reason: 'authority_not_signer' };
			}

			// TransferChecked data: [12, u64 amount, u8 decimals].
			transferAmount = readU64LE(data, 1);
			payer = authority.toBase58();
			continue;
		}

		// Any other program touching this transaction is disallowed.
		return { ok: false, reason: `program_not_allowed:${programId.toBase58()}` };
	}
	} catch (err) {
		// Totality backstop: any unexpected throw while decoding adversarial
		// instruction bytes becomes a clean refusal, never a 5xx.
		return { ok: false, reason: `decode_error:${err?.message || err}` };
	}

	if (transferCount !== 1) return { ok: false, reason: 'no_usdc_transfer' };
	if (payer == null) return { ok: false, reason: 'no_authority' };
	if (transferAmount < requiredAmount) {
		return {
			ok: false,
			reason: `amount_below_required:${transferAmount}<${requiredAmount}`,
		};
	}

	// Self-pay vs sponsor mode. Self-pay: the buyer pays its own SOL fee (fee payer
	// == the USDC authority) → 1 signature, no sponsor, cheapest. Sponsor mode: the
	// fee payer must be the configured sponsor. Either way the sponsor can never be
	// coerced into spending USDC: in sponsor mode fee payer ≠ authority (this
	// branch), and self-pay only lets the buyer spend its own funds.
	const selfPay = feePayer.toBase58() === payer;
	if (!selfPay) {
		if (!feePayerPubkey || feePayer.toBase58() !== feePayerPubkey) {
			return { ok: false, reason: `fee_payer_not_sponsor:${feePayer.toBase58()}` };
		}
		// The sponsor signs the whole message, so an instruction that names its
		// account could charge it. A buyer's wallet guards the buyer's accounts
		// and has no reason to reference ours.
		if (lighthouseTouchesFeePayer) {
			return { ok: false, reason: 'guard_instruction_references_sponsor' };
		}
	}

	// Bound the priority fee the fee-paying wallet will pay.
	if (cuLimit > limits.maxCuLimit) return { ok: false, reason: `cu_limit_too_high:${cuLimit}` };
	if (cuPrice > BigInt(limits.maxCuPriceMicroLamports)) {
		return { ok: false, reason: `cu_price_too_high:${cuPrice}` };
	}
	const priorityLamports = Number((cuPrice * BigInt(cuLimit)) / 1_000_000n);
	if (priorityLamports > limits.maxPriorityLamports) {
		return { ok: false, reason: `priority_fee_too_high:${priorityLamports}` };
	}

	const baseFee = 5000 * msg.header.numRequiredSignatures;
	const estFeeLamports =
		baseFee + priorityLamports + (ataCreatePresent ? ataRentLamports(tokenProgram.toBase58()) : 0);

	return {
		ok: true,
		decoded: {
			tx,
			payer,
			payTo: payTo.toBase58(),
			mint: mint.toBase58(),
			tokenProgram: tokenProgram.toBase58(),
			amountAtomic: Number(transferAmount),
			feePayer: feePayer.toBase58(),
			selfPay,
			estFeeLamports,
			ataCreatePresent,
		},
	};
}

// Check every buyer signature on a decoded ring transaction against its message.
//
// validateRingTransaction proves the authority is LISTED as a signer and the
// settleability simulation runs with sigVerify:false (the sponsor has not
// co-signed yet), so nothing on the verify path ever checked a signature. A
// transfer naming any funded wallet as authority, carrying garbage signatures,
// therefore verified as valid and the paid handler ran (a coin launch on the
// platform's SOL, a cosmetic grant and creator payout, a GPU job) before settle
// failed. In sponsor mode the fee-payer slot is skipped: the sponsor signs only
// at settle.
export function verifyBuyerSignatures({ tx, feePayer, selfPay }) {
	const msg = tx.message;
	const required = msg.header.numRequiredSignatures;
	let bytes;
	try {
		bytes = msg.serialize();
	} catch (err) {
		return { ok: false, reason: `message_unserializable:${err?.message || err}` };
	}
	for (let i = 0; i < required; i += 1) {
		const key = msg.staticAccountKeys[i];
		if (!key) return { ok: false, reason: 'missing_signer_key' };
		const b58 = key.toBase58();
		if (!selfPay && b58 === feePayer) continue;
		const sig = tx.signatures?.[i];
		if (!sig || sig.length !== 64 || sig.every((b) => b === 0)) {
			return { ok: false, reason: `missing_signature:${b58}` };
		}
		let ok = false;
		try {
			ok = ed25519.verify(sig, bytes, key.toBytes());
		} catch {
			ok = false;
		}
		if (!ok) return { ok: false, reason: `invalid_signature:${b58}` };
	}
	return { ok: true };
}

// Is the transaction's recent blockhash still live? Returns true, false, or null
// when the RPC cannot say. A node a few slots behind the buyer's may not know a
// brand-new hash yet, so a `false` is re-asked once after a short pause before it
// is believed. A dead or made-up blockhash can never land, and the settle path
// would otherwise answer it `pending`, which the resource server delivers on.
export async function blockhashIsLive(connection, blockhash, { recheckMs = 1500 } = {}) {
	if (typeof connection?.isBlockhashValid !== 'function' || !blockhash) return null;
	const ask = async () => {
		try {
			const r = await connection.isBlockhashValid(blockhash, { commitment: 'processed' });
			const v = r && typeof r === 'object' && 'value' in r ? r.value : r;
			return typeof v === 'boolean' ? v : null;
		} catch {
			return null;
		}
	};
	const first = await ask();
	if (first !== false) return first;
	if (recheckMs > 0) await new Promise((r) => setTimeout(r, recheckMs));
	return ask();
}

// Extract the base64 signed transaction from an x402 payment payload.
export function txBase64FromPayload(paymentPayload) {
	return (
		paymentPayload?.payload?.transaction ||
		paymentPayload?.transaction ||
		null
	);
}

/**
 * Is this simulation error the chain saying the FEE PAYER cannot afford the fee
 * without dropping below rent exemption?
 *
 * Account index 0 of a compiled Solana message is the fee payer, by definition,
 * so `InsufficientFundsForRent { account_index: 0 }` is never about the buyer's
 * token balance: it is the sponsor being too poor to sign. Both spellings the
 * RPCs use are matched, the structured `err` object and the human sentence that
 * reaches the sweep path inside a SendTransactionError message.
 * @param {unknown} simErr
 * @returns {boolean}
 */
export function isFeePayerRentFailure(simErr) {
	if (simErr == null) return false;
	if (typeof simErr === 'object') {
		return Number(/** @type {any} */ (simErr)?.InsufficientFundsForRent?.account_index) === 0;
	}
	const s = String(simErr);
	if (/InsufficientFundsForRent/.test(s)) return /"account_index"\s*:\s*0/.test(s);
	return /account \(0\) with insufficient funds for rent/i.test(s);
}

// Instructions for a signed SPL-Memo attestation ABOUT a subject address.
//
// Two requirements pull in opposite directions:
//
//   1. SPL Memo v2 treats every account passed to it as a required signer. A
//      read-only non-signer account fails the instruction with
//      MissingRequiredSignature (verified by mainnet simulation 2026-11-04),
//      so the subject cannot ride on the memo instruction itself.
//   2. The crawler (crawlAgentAttestations in ../solana-attestations.js) finds
//      attestations with getSignaturesForAddress(subject), which only returns
//      transactions whose message lists the subject among its account keys.
//
// The subject is therefore carried, read-only, on a ComputeBudget
// SetComputeUnitLimit instruction. The ComputeBudget program ignores extra
// accounts, the subject lands in the message's static account keys (so it is
// indexed), and the memo instruction lists only the attester, which signs.
// Memo v2 is expensive per byte: a 438-byte tradescore payload consumed
// 169,430 CU in mainnet simulation, close to the 200k per-instruction default,
// and a tournament podium can be longer. The limit is set at 400k for that
// headroom; with no priority fee, the limit does not change the fee.

import { ComputeBudgetProgram, PublicKey, TransactionInstruction } from '@solana/web3.js';

export const MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
export const ATTEST_COMPUTE_UNIT_LIMIT = 400_000;

/**
 * @param {object} p
 * @param {PublicKey} p.signer           The attester; must sign the transaction.
 * @param {string|PublicKey} p.subject   Address the attestation is about.
 * @param {string|Uint8Array} p.data     Memo body (UTF-8 JSON for every lane).
 * @returns {TransactionInstruction[]}   Add to the transaction in this order.
 */
export function attestationMemoInstructions({ signer, subject, data }) {
	const subjectKey = subject instanceof PublicKey ? subject : new PublicKey(subject);
	const carrier = ComputeBudgetProgram.setComputeUnitLimit({ units: ATTEST_COMPUTE_UNIT_LIMIT });
	if (!subjectKey.equals(signer)) {
		carrier.keys.push({ pubkey: subjectKey, isSigner: false, isWritable: false });
	}
	const memo = new TransactionInstruction({
		programId: MEMO_PROGRAM_ID,
		keys: [{ pubkey: signer, isSigner: true, isWritable: false }],
		data: Buffer.from(data),
	});
	return [carrier, memo];
}

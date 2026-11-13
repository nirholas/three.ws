// PumpFees FeeProgramGlobal reader.
//
// Every `claim_social_fee_pda` / `claim_social_fee_pda_v2` instruction is
// cosigned by the `social_claim_authority` stored in the program's single
// FeeProgramGlobal account (the IDL marks it `signer` with a `relations`
// constraint back to that account). The PumpFees program itself handles
// hundreds of transactions a second because every trade touches it, so one
// page of its signature history covers about a second. The social claim
// authority signs claims and nothing else, so paging or subscribing to it
// reaches back days per page.
//
// The key is read from chain at runtime rather than hardcoded so a rotation
// by the program authority is picked up on the next resolve.

import { PublicKey } from '@solana/web3.js';
import { PUMP_FEE_PROGRAM_ID } from './solana/programs.js';

const FEE_PROGRAM_GLOBAL_DISCRIMINATOR = Buffer.from([162, 165, 245, 49, 29, 37, 55, 242]);
// Account layout before the social claim authority: discriminator 8, bump 1, authority 32, disable_flags 1.
const SOCIAL_CLAIM_AUTHORITY_OFFSET = 8 + 1 + 32 + 1;
const CACHE_TTL_MS = 10 * 60_000;

export const FEE_PROGRAM_GLOBAL_PDA = PublicKey.findProgramAddressSync(
	[Buffer.from('fee-program-global')],
	new PublicKey(PUMP_FEE_PROGRAM_ID),
)[0];

/**
 * Decode `social_claim_authority` out of raw FeeProgramGlobal account data.
 * Returns null for data that is not a FeeProgramGlobal account.
 * @param {Uint8Array|null|undefined} data
 * @returns {PublicKey|null}
 */
export function decodeSocialClaimAuthority(data) {
	if (!data || data.length < SOCIAL_CLAIM_AUTHORITY_OFFSET + 32) return null;
	const buf = Buffer.from(data);
	if (!buf.subarray(0, 8).equals(FEE_PROGRAM_GLOBAL_DISCRIMINATOR)) return null;
	const key = new PublicKey(
		buf.subarray(SOCIAL_CLAIM_AUTHORITY_OFFSET, SOCIAL_CLAIM_AUTHORITY_OFFSET + 32),
	);
	return key.equals(PublicKey.default) ? null : key;
}

const cache = new WeakMap();

/**
 * The address to page or subscribe to for GitHub social-fee claims: the live
 * `social_claim_authority`, or the PumpFees program id when the global account
 * cannot be read (slower, but it still sees every claim it reaches). A
 * successful read is cached per connection for ten minutes; a failed one is
 * not cached, so the next call retries.
 * @param {{getAccountInfo: Function}} connection
 * @returns {Promise<{key: PublicKey, source: 'fee_program_global'|'program_id'}>}
 */
export async function resolveClaimHistoryKey(connection) {
	const hit = cache.get(connection);
	if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
	try {
		const info = await connection.getAccountInfo(FEE_PROGRAM_GLOBAL_PDA, 'confirmed');
		const key = decodeSocialClaimAuthority(info?.data);
		if (key) {
			const value = { key, source: 'fee_program_global' };
			cache.set(connection, { at: Date.now(), value });
			return value;
		}
		console.warn(
			'[pump-fee-global] FeeProgramGlobal missing or undecodable, paging the program id',
		);
	} catch (err) {
		console.warn(
			'[pump-fee-global] FeeProgramGlobal read failed, paging the program id:',
			err?.message || err,
		);
	}
	return { key: new PublicKey(PUMP_FEE_PROGRAM_ID), source: 'program_id' };
}

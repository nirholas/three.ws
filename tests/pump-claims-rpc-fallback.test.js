import { describe, it, expect } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';

import { fetchGithubClaimsFromRpc } from '../api/_lib/pump-claims.js';
import { PUMP_FEE_PROGRAM_ID } from '../api/_lib/solana/programs.js';

// The PumpFees program handles hundreds of transactions a second, so one page
// of its signatures covers about a second of history and the RPC fallback
// found no GitHub claims in any realistic window. Claims are cosigned by the
// FeeProgramGlobal's social_claim_authority, which signs nothing else; the
// fallback must page that key.

const SYNTHETIC_AUTHORITY = Keypair.generate().publicKey;

function syntheticFeeProgramGlobal() {
	const data = Buffer.alloc(8 + 1 + 32 + 1 + 32 + 8 + 256);
	Buffer.from([162, 165, 245, 49, 29, 37, 55, 242]).copy(data, 0);
	Keypair.generate().publicKey.toBuffer().copy(data, 9);
	SYNTHETIC_AUTHORITY.toBuffer().copy(data, 42);
	return data;
}

describe('fetchGithubClaimsFromRpc', () => {
	it('pages the social claim authority instead of the PumpFees program', async () => {
		const paged = [];
		const connection = {
			async getAccountInfo() {
				return {
					data: syntheticFeeProgramGlobal(),
					owner: new PublicKey(PUMP_FEE_PROGRAM_ID),
				};
			},
			async getSignaturesForAddress(address) {
				paged.push(address.toBase58());
				return [];
			},
		};
		const out = await fetchGithubClaimsFromRpc(Math.floor(Date.now() / 1000) - 86400, {
			connection,
		});
		expect(out).toEqual([]);
		expect(paged).toEqual([SYNTHETIC_AUTHORITY.toBase58()]);
	});
});

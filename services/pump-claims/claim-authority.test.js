import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, PublicKey } from '@solana/web3.js';

import { PUMP_FEE_PROGRAM_ID } from '../../api/_lib/solana/programs.js';
import { decodeSocialClaimAuthority } from '../../api/_lib/pump-fee-global.js';
import { backfill } from './backfill.js';
import { gapFill } from './index.js';
import { ClaimListener } from './listener.js';
import { SeenSignatures } from './dedupe.js';

// The PumpFees program sees hundreds of transactions a second (every trade
// touches it), so paging its signature history reaches back seconds, not
// days. Every claim_social_fee_pda (V1 and V2) is cosigned by the
// `social_claim_authority` stored in the FeeProgramGlobal account, which
// signs nothing else, so that key is the address worth paging. These tests
// pin that every history walk and the live subscription use it.

const SYNTHETIC_AUTHORITY = Keypair.generate().publicKey;

/** FeeProgramGlobal layout: disc(8) bump(1) authority(32) disable_flags(1) social_claim_authority(32) claim_rate_limit(8) reserved(256). */
function syntheticFeeProgramGlobal(socialClaimAuthority) {
	const data = Buffer.alloc(8 + 1 + 32 + 1 + 32 + 8 + 256);
	Buffer.from([162, 165, 245, 49, 29, 37, 55, 242]).copy(data, 0);
	data[8] = 255;
	Keypair.generate().publicKey.toBuffer().copy(data, 9);
	socialClaimAuthority.toBuffer().copy(data, 42);
	return data;
}

function fakeConnection({
	globalData = syntheticFeeProgramGlobal(SYNTHETIC_AUTHORITY),
	failGlobal = false,
} = {}) {
	const paged = [];
	return {
		paged,
		async getAccountInfo() {
			if (failGlobal) throw new Error('rpc down');
			return {
				data: globalData,
				owner: new PublicKey(PUMP_FEE_PROGRAM_ID),
				lamports: 1,
				executable: false,
			};
		},
		async getSignaturesForAddress(address) {
			paged.push(address.toBase58());
			return [];
		},
		async getParsedTransaction() {
			throw new Error('no signatures were returned, so no transaction should be fetched');
		},
	};
}

const fakeStore = { toRow: (c) => c, insertClaim: async () => true, countSince: async () => 0 };

describe('decodeSocialClaimAuthority', () => {
	test('reads the key at its FeeProgramGlobal offset', () => {
		assert.equal(
			decodeSocialClaimAuthority(syntheticFeeProgramGlobal(SYNTHETIC_AUTHORITY))?.toBase58(),
			SYNTHETIC_AUTHORITY.toBase58(),
		);
	});

	test('rejects data with another discriminator, short data, and an unset key', () => {
		const wrongDisc = syntheticFeeProgramGlobal(SYNTHETIC_AUTHORITY);
		wrongDisc[0] ^= 0xff;
		assert.equal(decodeSocialClaimAuthority(wrongDisc), null);
		assert.equal(decodeSocialClaimAuthority(Buffer.alloc(40)), null);
		assert.equal(
			decodeSocialClaimAuthority(syntheticFeeProgramGlobal(PublicKey.default)),
			null,
		);
		assert.equal(decodeSocialClaimAuthority(null), null);
	});
});

describe('history walks page the social claim authority', () => {
	test('backfill pages social_claim_authority, not the PumpFees program', async () => {
		const connection = fakeConnection();
		await backfill({ days: 7, connection, store: fakeStore });
		assert.deepEqual(connection.paged, [SYNTHETIC_AUTHORITY.toBase58()]);
	});

	test('gapFill pages social_claim_authority, not the PumpFees program', async () => {
		const connection = fakeConnection();
		await gapFill({ connection, seen: new SeenSignatures(), maybeProcess: async () => {} });
		assert.deepEqual(connection.paged, [SYNTHETIC_AUTHORITY.toBase58()]);
	});

	test('gapFill still runs against the program id when the global account cannot be read', async () => {
		const connection = fakeConnection({ failGlobal: true });
		await gapFill({ connection, seen: new SeenSignatures(), maybeProcess: async () => {} });
		assert.deepEqual(connection.paged, [PUMP_FEE_PROGRAM_ID]);
	});
});

describe('ClaimListener subscription filter', () => {
	test('subscribes with the mentions key it was given', () => {
		const calls = [];
		const listener = new ClaimListener({
			mentionKey: SYNTHETIC_AUTHORITY,
			logSubscriber: (key) => {
				calls.push(key.toBase58());
				return 1;
			},
		});
		listener.start(() => {});
		listener.stop();
		assert.deepEqual(calls, [SYNTHETIC_AUTHORITY.toBase58()]);
	});
});

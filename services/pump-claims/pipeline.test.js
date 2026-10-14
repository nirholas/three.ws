import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { decodeClaim, processLogEntry } from './pipeline.js';
import {
	socialClaimLogs,
	socialClaimWithDistributionsLogs,
	SYNTH,
} from '../../tests/_helpers/pump-log-fixtures.js';

const GITHUB_PLATFORM = 2;
const DISCORD_PLATFORM = 1;

function fakeConnection({ txLogs } = {}) {
	return {
		async getParsedTransaction() {
			return { meta: { logMessages: txLogs || [] } };
		},
		async getSignaturesForAddress() {
			return [];
		},
	};
}

let originalFetch;
before(() => {
	originalFetch = globalThis.fetch;
	globalThis.fetch = async (url) => {
		const u = String(url);
		if (u.includes('api.github.com/users?since=')) {
			return { ok: true, json: async () => [{ id: 42, login: 'octocat' }] };
		}
		if (u.includes('api.github.com/users/octocat')) {
			return { ok: true, json: async () => ({ login: 'octocat', created_at: '2015-01-01T00:00:00Z' }) };
		}
		if (u.includes('frontend-api-v3.pump.fun/coins-v2/')) {
			return {
				ok: true,
				json: async () => ({ creator: SYNTH.RECIPIENT, name: 'Test Coin', usd_market_cap: 50_000 }),
			};
		}
		return { ok: false, status: 404, json: async () => ({}) };
	};
});
after(() => {
	globalThis.fetch = originalFetch;
});

describe('decodeClaim', () => {
	test('returns null for an entry whose transaction errored', () => {
		assert.equal(decodeClaim({ signature: 'sig', logs: ['anything'], err: { InstructionError: [] } }), null);
	});

	test('returns null when the logs carry no claim_social_fee_pda instruction', () => {
		assert.equal(decodeClaim({ signature: 'sig', logs: ['Program log: Instruction: Trade'] }), null);
	});

	test('returns null for a non-GitHub social platform claim', () => {
		const logs = socialClaimLogs({
			userId: '42',
			platform: DISCORD_PLATFORM,
			socialFeePda: SYNTH.PDA_A,
			recipient: SYNTH.RECIPIENT,
			socialClaimAuthority: SYNTH.CLAIM_AUTHORITY,
			amountClaimed: 1_000_000,
			lifetimeClaimed: 1_000_000,
		});
		assert.equal(decodeClaim({ signature: 'sig', logs }), null);
	});

	test('decodes a GitHub claim', () => {
		const logs = socialClaimLogs({
			userId: '42',
			platform: GITHUB_PLATFORM,
			socialFeePda: SYNTH.PDA_A,
			recipient: SYNTH.RECIPIENT,
			socialClaimAuthority: SYNTH.CLAIM_AUTHORITY,
			amountClaimed: 1_000_000,
			lifetimeClaimed: 1_000_000,
		});
		const claim = decodeClaim({ signature: 'sig', logs });
		assert.ok(claim);
		assert.equal(claim.githubUserId, '42');
		assert.equal(claim.socialPlatform, GITHUB_PLATFORM);
		assert.equal(claim.recipient, SYNTH.RECIPIENT);
	});
});

describe('processLogEntry', () => {
	test('returns null when the transaction errored', async () => {
		const result = await processLogEntry(fakeConnection(), {
			signature: 'sig',
			logs: ['anything'],
			err: { InstructionError: [] },
		});
		assert.equal(result, null);
	});

	test('returns null for a non-claim entry', async () => {
		const result = await processLogEntry(fakeConnection(), {
			signature: 'sig',
			logs: ['Program log: Instruction: Trade'],
		});
		assert.equal(result, null);
	});

	test('attributes a GitHub claim to its coin via same-transaction evidence', async () => {
		const claimFields = {
			userId: '42',
			platform: GITHUB_PLATFORM,
			socialFeePda: SYNTH.PDA_A,
			recipient: SYNTH.RECIPIENT,
			socialClaimAuthority: SYNTH.CLAIM_AUTHORITY,
			amountClaimed: 1_000_000,
			lifetimeClaimed: 1_000_000,
		};
		const distribution = {
			mint: SYNTH.MINT_A,
			bondingCurve: SYNTH.BONDING_CURVE_A,
			sharingConfig: SYNTH.SHARING_CONFIG_A,
			admin: SYNTH.ADMIN,
			shareholders: [{ address: SYNTH.PDA_A, shareBps: 5000 }],
			distributed: 2_000_000,
		};
		const logs = socialClaimWithDistributionsLogs(claimFields, [distribution]);

		const claim = await processLogEntry(fakeConnection({ txLogs: logs }), { signature: 'sig123', logs });

		assert.ok(claim);
		assert.equal(claim.signature, 'sig123');
		assert.equal(claim.mint, SYNTH.MINT_A);
		assert.equal(claim.creator, SYNTH.RECIPIENT);
		assert.equal(claim.githubUserId, '42');
		assert.equal(claim.githubLogin, 'octocat');
		assert.ok(claim.attribution?.label);
		assert.equal(typeof claim.held, 'boolean');
	});

	test('a blockTime option is reflected on the returned claim', async () => {
		const claimFields = {
			userId: '42',
			platform: GITHUB_PLATFORM,
			socialFeePda: SYNTH.PDA_A,
			recipient: SYNTH.RECIPIENT,
			socialClaimAuthority: SYNTH.CLAIM_AUTHORITY,
			amountClaimed: 500_000,
			lifetimeClaimed: 500_000,
		};
		const logs = socialClaimLogs(claimFields);
		const claim = await processLogEntry(fakeConnection({ txLogs: [] }), { signature: 'sig456', logs }, { blockTime: 1_700_000_000 });
		assert.ok(claim);
		assert.equal(claim.ts, 1_700_000_000);
	});
});

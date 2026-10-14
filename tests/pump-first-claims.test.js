import { describe, it, expect } from 'vitest';
import { filterFirstClaims, buildClaimCard } from '../src/pump/first-claims.js';
import { parseSocialFeeClaim, parseTransactionDistributions } from '../api/_lib/pump-events.js';
import {
	evidenceForSocialFeePda,
	evidenceFromPdaHistory,
	classifyClaimAttribution,
	assessImpersonation,
	ATTRIBUTION_LABELS,
	NEW_ACCOUNT_DAYS,
	FRESH_REPO_DAYS,
	COPYCAT_MCAP_RATIO,
} from '../api/_lib/pump-claims-attribution.js';
import { socialClaimWithDistributionsLogs, distributionLogs, SYNTH } from './_helpers/pump-log-fixtures.js';

const sinceTs = 1000; // boundary: claims < 1000 are "prior"

function claim(creator, ts, overrides = {}) {
	return { creator, mint: `mint_${ts}`, signature: `sig_${ts}`, lamports: 1e9, ts, ...overrides };
}

describe('filterFirstClaims: dedupe rule', () => {
	it('includes a creator whose only claim is within the window', () => {
		const result = filterFirstClaims([claim('A', 1200)], sinceTs, 50);
		expect(result).toHaveLength(1);
		expect(result[0].creator).toBe('A');
	});

	it('excludes a creator with any prior claim before sinceTs', () => {
		const result = filterFirstClaims(
			[
				claim('B', 500),  // prior, before sinceTs
				claim('B', 1200), // within window
			],
			sinceTs,
			50,
		);
		expect(result).toHaveLength(0);
	});

	it('handles multiple creators, only includes first-timers', () => {
		const claims = [
			claim('A', 1200), // new
			claim('B', 800),  // prior
			claim('B', 1300), // B also has a later claim, but excluded by prior
			claim('C', 1400), // new
		];
		const result = filterFirstClaims(claims, sinceTs, 50);
		const creators = result.map((r) => r.creator).sort();
		expect(creators).toEqual(['A', 'C']);
	});

	it('returns items sorted newest first', () => {
		const claims = [claim('A', 1200), claim('C', 1400)];
		const result = filterFirstClaims(claims, sinceTs, 50);
		expect(result[0].ts).toBe(1400);
		expect(result[1].ts).toBe(1200);
	});

	it('respects the limit', () => {
		const claims = Array.from({ length: 10 }, (_, i) =>
			claim(`creator_${i}`, 1100 + i),
		);
		const result = filterFirstClaims(claims, sinceTs, 3);
		expect(result).toHaveLength(3);
	});

	it('returns the earliest claim per creator (the first-claim event)', () => {
		// Creator with two claims both within window, should surface the earlier one.
		const claims = [claim('D', 1300), claim('D', 1100)];
		const result = filterFirstClaims(claims, sinceTs, 50);
		expect(result).toHaveLength(1);
		expect(result[0].ts).toBe(1100);
	});

	it('returns empty array when all creators have prior claims', () => {
		const result = filterFirstClaims(
			[claim('X', 100), claim('Y', 200), claim('Z', 500)],
			sinceTs,
			50,
		);
		expect(result).toHaveLength(0);
	});

	it('returns empty array for empty input', () => {
		expect(filterFirstClaims([], sinceTs, 50)).toEqual([]);
	});

	it('claim at exactly sinceTs boundary is included (>= rule)', () => {
		const result = filterFirstClaims([claim('E', sinceTs)], sinceTs, 50);
		expect(result).toHaveLength(1);
	});

	it('claim one second before sinceTs is excluded', () => {
		const result = filterFirstClaims([claim('F', sinceTs - 1)], sinceTs, 50);
		expect(result).toHaveLength(0);
	});
});

// GitHub fee-claim attribution. Fixtures are recorded-transaction-shaped log
// lines decoded by the real @nirholas/pump-sdk via api/_lib/pump-events.js
// (see tests/_helpers/pump-log-fixtures.js), with synthetic accounts standing
// in for real pubkeys, per the $THREE-or-synthetic fixture rule.
describe('evidenceForSocialFeePda: same-transaction rule', () => {
	it('attributes a claim to the mint whose distribution paid the claimed PDA in the same tx', () => {
		const claimFields = {
			userId: '111',
			platform: 2,
			socialFeePda: SYNTH.PDA_A,
			recipient: SYNTH.RECIPIENT,
			socialClaimAuthority: SYNTH.CLAIM_AUTHORITY,
			amountClaimed: 50_000_000_000n,
			lifetimeClaimed: 50_000_000_000n,
		};
		const distribution = {
			mint: SYNTH.MINT_A,
			bondingCurve: SYNTH.BONDING_CURVE_A,
			sharingConfig: SYNTH.SHARING_CONFIG_A,
			admin: SYNTH.ADMIN,
			shareholders: [{ address: SYNTH.PDA_A, shareBps: 5000 }],
			distributed: 100_000_000_000n,
		};
		const logs = socialClaimWithDistributionsLogs(claimFields, [distribution]);
		const claimEvent = parseSocialFeeClaim(logs);
		const evidence = evidenceForSocialFeePda(parseTransactionDistributions(logs), claimEvent.socialFeePda);
		expect(evidence).toHaveLength(1);
		expect(evidence[0]).toMatchObject({ mint: SYNTH.MINT_A, source: 'same_transaction_distribution' });
	});

	it('finds nothing when no distribution in the transaction paid the claimed PDA', () => {
		const distribution = {
			mint: SYNTH.MINT_A,
			bondingCurve: SYNTH.BONDING_CURVE_A,
			sharingConfig: SYNTH.SHARING_CONFIG_A,
			admin: SYNTH.ADMIN,
			shareholders: [{ address: SYNTH.PDA_B, shareBps: 5000 }], // pays a different PDA
			distributed: 100_000_000_000n,
		};
		const logs = distributionLogs(distribution);
		const evidence = evidenceForSocialFeePda(parseTransactionDistributions(logs), SYNTH.PDA_A);
		expect(evidence).toHaveLength(0);
	});

	it('reports more than one candidate mint when the PDA is a shareholder in two distributions in one tx', () => {
		const claimFields = {
			userId: '111',
			platform: 2,
			socialFeePda: SYNTH.PDA_A,
			recipient: SYNTH.RECIPIENT,
			socialClaimAuthority: SYNTH.CLAIM_AUTHORITY,
			amountClaimed: 10_000_000_000n,
			lifetimeClaimed: 10_000_000_000n,
		};
		const distA = {
			mint: SYNTH.MINT_A,
			bondingCurve: SYNTH.BONDING_CURVE_A,
			sharingConfig: SYNTH.SHARING_CONFIG_A,
			admin: SYNTH.ADMIN,
			shareholders: [{ address: SYNTH.PDA_A, shareBps: 5000 }],
			distributed: 10_000_000_000n,
		};
		const distB = {
			mint: SYNTH.MINT_B,
			bondingCurve: SYNTH.BONDING_CURVE_B,
			sharingConfig: SYNTH.SHARING_CONFIG_B,
			admin: SYNTH.ADMIN,
			shareholders: [{ address: SYNTH.PDA_A, shareBps: 5000 }],
			distributed: 10_000_000_000n,
		};
		const logs = socialClaimWithDistributionsLogs(claimFields, [distA, distB]);
		const claimEvent = parseSocialFeeClaim(logs);
		const evidence = evidenceForSocialFeePda(parseTransactionDistributions(logs), claimEvent.socialFeePda);
		expect(evidence.map((e) => e.mint).sort()).toEqual([SYNTH.MINT_A, SYNTH.MINT_B].sort());
	});
});

describe('evidenceFromPdaHistory: the 90% fee-history rule', () => {
	const distributionTo = (mint, pda, raw) => ({
		mint,
		sharingConfig: SYNTH.SHARING_CONFIG_A,
		shareholders: [{ address: pda, shareBps: 10_000 }], // 100% share for simple raw-amount math
		distributedRaw: raw.toString(),
	});

	it('attributes when observed history covers the claim and one mint dominates at exactly 90%', () => {
		const claimedRaw = 100_000_000_000n;
		const distributions = [
			distributionTo(SYNTH.MINT_A, SYNTH.PDA_A, 90_000_000_000n),
			distributionTo(SYNTH.MINT_B, SYNTH.PDA_A, 10_000_000_000n),
		];
		const evidence = evidenceFromPdaHistory(distributions, SYNTH.PDA_A, claimedRaw, undefined);
		expect(evidence).toHaveLength(1);
		expect(evidence[0]).toMatchObject({ mint: SYNTH.MINT_A, source: 'pda_history_distribution' });
	});

	it('finds nothing when the dominant mint falls just under 90% of observed history', () => {
		const claimedRaw = 100_000_000_000n;
		const distributions = [
			distributionTo(SYNTH.MINT_A, SYNTH.PDA_A, 89_000_000_000n),
			distributionTo(SYNTH.MINT_B, SYNTH.PDA_A, 11_000_000_000n),
		];
		const evidence = evidenceFromPdaHistory(distributions, SYNTH.PDA_A, claimedRaw, undefined);
		expect(evidence).toHaveLength(0);
	});

	it('finds nothing when observed history covers less than 90% of the claimed amount, even if one mint is 100% of what was observed', () => {
		const claimedRaw = 100_000_000_000n;
		const distributions = [distributionTo(SYNTH.MINT_A, SYNTH.PDA_A, 50_000_000_000n)];
		const evidence = evidenceFromPdaHistory(distributions, SYNTH.PDA_A, claimedRaw, undefined);
		expect(evidence).toHaveLength(0);
	});

	it('ignores distributions in a different quote currency than the claim', () => {
		const claimedRaw = 100_000_000_000n;
		const distributions = [
			{ ...distributionTo(SYNTH.MINT_A, SYNTH.PDA_A, 95_000_000_000n), quoteMint: 'SomeOtherQuoteMint11111111111111111111111' },
		];
		const evidence = evidenceFromPdaHistory(distributions, SYNTH.PDA_A, claimedRaw, undefined);
		expect(evidence).toHaveLength(0);
	});
});

describe('classifyClaimAttribution: the seven labels', () => {
	const evidence = { source: 'same_transaction_distribution' };
	const historyEvidence = { source: 'pda_history_distribution' };

	it('transaction_attributed: same-transaction distribution evidence', () => {
		const result = classifyClaimAttribution({ evidence, candidateMintCount: 1 });
		expect(result.label).toBe(ATTRIBUTION_LABELS.TRANSACTION_ATTRIBUTED);
	});

	it('fee_history_attributed: pda-history distribution evidence', () => {
		const result = classifyClaimAttribution({ evidence: historyEvidence, candidateMintCount: 1 });
		expect(result.label).toBe(ATTRIBUTION_LABELS.FEE_HISTORY_ATTRIBUTED);
	});

	it('unresolved_pooled: no evidence, PDA shared by more than one coin', () => {
		const result = classifyClaimAttribution({ evidence: null, candidateMintCount: 2 });
		expect(result.label).toBe(ATTRIBUTION_LABELS.UNRESOLVED_POOLED);
	});

	it('verified_repository: claiming GitHub login matches the metadata repo owner', () => {
		const result = classifyClaimAttribution({
			evidence: null,
			candidateMintCount: 0,
			githubLogin: 'octocat',
			githubRepoOwner: 'octocat',
		});
		expect(result.label).toBe(ATTRIBUTION_LABELS.VERIFIED_REPOSITORY);
	});

	it('identity_mismatch: claiming GitHub login does not match the metadata repo owner', () => {
		const result = classifyClaimAttribution({
			evidence: null,
			candidateMintCount: 0,
			githubLogin: 'mallory',
			githubRepoOwner: 'octocat',
		});
		expect(result.label).toBe(ATTRIBUTION_LABELS.IDENTITY_MISMATCH);
	});

	it('verified_creator_wallet: claim recipient matches the token creator wallet', () => {
		const result = classifyClaimAttribution({
			evidence: null,
			candidateMintCount: 0,
			claimerWallet: SYNTH.RECIPIENT,
			tokenCreatorWallet: SYNTH.RECIPIENT,
		});
		expect(result.label).toBe(ATTRIBUTION_LABELS.VERIFIED_CREATOR_WALLET);
	});

	it('unverified: no evidence and nothing else resolves', () => {
		const result = classifyClaimAttribution({ evidence: null, candidateMintCount: 0 });
		expect(result.label).toBe(ATTRIBUTION_LABELS.UNVERIFIED);
	});

	it('every label carries a non-empty headline and explanation', () => {
		const cases = [
			{ evidence, candidateMintCount: 1 },
			{ evidence: historyEvidence, candidateMintCount: 1 },
			{ evidence: null, candidateMintCount: 2 },
			{ evidence: null, candidateMintCount: 0, githubLogin: 'a', githubRepoOwner: 'a' },
			{ evidence: null, candidateMintCount: 0, githubLogin: 'a', githubRepoOwner: 'b' },
			{ evidence: null, candidateMintCount: 0, claimerWallet: 'x', tokenCreatorWallet: 'x' },
			{ evidence: null, candidateMintCount: 0 },
		];
		const labels = new Set();
		for (const ctx of cases) {
			const result = classifyClaimAttribution(ctx);
			expect(result.headline.length).toBeGreaterThan(0);
			expect(result.explanation.length).toBeGreaterThan(0);
			labels.add(result.label);
		}
		expect(labels.size).toBe(7);
	});
});

describe('assessImpersonation: the impersonation hold', () => {
	const NOW = Date.now();
	const daysAgo = (days) => new Date(NOW - days * 86_400_000).toISOString();

	it('holds a new account claiming from a coin with a much larger same-name copycat', () => {
		const result = assessImpersonation(
			{
				githubUser: { createdAt: daysAgo(5) },
				tokenInfo: { usdMarketCap: 10_000 },
				sameNameTokens: [{ mint: SYNTH.MINT_B, usdMarketCap: 10_000 * (COPYCAT_MCAP_RATIO + 1) }],
			},
			NOW,
		);
		expect(result.suspected).toBe(true);
		expect(result.reasons.join(' ')).toMatch(/larger/);
	});

	it('holds a new account whose metadata repo was created right before the claim', () => {
		const result = assessImpersonation(
			{ githubUser: { createdAt: daysAgo(5) }, repoInfo: { createdAt: daysAgo(FRESH_REPO_DAYS - 1) } },
			NOW,
		);
		expect(result.suspected).toBe(true);
		expect(result.reasons.join(' ')).toMatch(/repo/);
	});

	it('does not hold a new account with no copycat coin and no fresh repo', () => {
		const result = assessImpersonation({ githubUser: { createdAt: daysAgo(5) } }, NOW);
		expect(result.suspected).toBe(false);
	});

	it('does not hold an account older than NEW_ACCOUNT_DAYS, even with a copycat coin', () => {
		const result = assessImpersonation(
			{
				githubUser: { createdAt: daysAgo(NEW_ACCOUNT_DAYS + 1) },
				tokenInfo: { usdMarketCap: 10_000 },
				sameNameTokens: [{ mint: SYNTH.MINT_B, usdMarketCap: 1_000_000 }],
			},
			NOW,
		);
		expect(result.suspected).toBe(false);
	});

	it('does not hold when the same-name coin is not large enough to count as a copycat', () => {
		const result = assessImpersonation(
			{
				githubUser: { createdAt: daysAgo(5) },
				tokenInfo: { usdMarketCap: 10_000 },
				sameNameTokens: [{ mint: SYNTH.MINT_B, usdMarketCap: 10_000 * COPYCAT_MCAP_RATIO }], // not strictly greater
			},
			NOW,
		);
		expect(result.suspected).toBe(false);
	});

	it('treats a GitHub account with no resolvable creation date as not new', () => {
		const result = assessImpersonation({ githubUser: null }, NOW);
		expect(result.suspected).toBe(false);
		expect(result.reasons).toEqual([]);
	});
});

describe('buildClaimCard: held vs attributed vs ordinary claim cards', () => {
	it('builds a held-for-review card when the claim was flagged for impersonation', () => {
		const card = buildClaimCard({
			creator: SYNTH.RECIPIENT,
			mint: SYNTH.MINT_A,
			githubUserId: '111',
			githubLogin: 'mallory',
			held: true,
			heldReasons: ['GitHub account 5d old'],
			attribution: { label: ATTRIBUTION_LABELS.UNVERIFIED, headline: 'x', explanation: 'y' },
		});
		expect(card.state).toBe('held');
		expect(card.title).toBe('Held for review');
		expect(card.heldReasons).toContain('GitHub account 5d old');
	});

	it('builds an attributed card for a non-held GitHub claim', () => {
		const card = buildClaimCard({
			creator: SYNTH.RECIPIENT,
			mint: SYNTH.MINT_A,
			githubUserId: '111',
			githubLogin: 'octocat',
			held: false,
			attribution: { label: ATTRIBUTION_LABELS.TRANSACTION_ATTRIBUTED, headline: 'TRANSACTION-ATTRIBUTED GITHUB FEE CLAIM', explanation: 'y' },
		});
		expect(card.state).toBe('attributed');
		expect(card.title).toBe('TRANSACTION-ATTRIBUTED GITHUB FEE CLAIM');
		expect(card.label).toBe(ATTRIBUTION_LABELS.TRANSACTION_ATTRIBUTED);
	});

	it('builds the ordinary celebratory card for a non-GitHub claim', () => {
		const card = buildClaimCard({ creator: SYNTH.RECIPIENT, mint: SYNTH.MINT_A });
		expect(card.state).toBe('claimed');
		expect(card.title).toBe('First creator fee claim');
	});
});

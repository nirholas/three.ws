// pump-claims-attribution.js
// --------------------------
// Which coin a GitHub social-fee-PDA withdrawal belongs to, and whether the
// claim should be held for review.
//
// A claim_social_fee_pda transaction pays a GitHub identity's fee PDA; it does
// not by itself name the coin, because one PDA can be a shareholder on more
// than one SharingConfig (a scam vector: paste the same PDA into a copycat
// coin's metadata). Two rules attribute a withdrawal to a specific mint, in
// order of strength:
//
//   1. same_transaction_distribution: the claim transaction itself carries a
//      DistributeCreatorFeesEvent that pays this exact PDA. Strongest -- the
//      payout and the attribution are in the same atomic transaction.
//   2. pda_history_distribution: no distribution rode along with this claim,
//      but the PDA's own transaction history since its previous claim shows
//      one coin paid at least 90% of what was withdrawn. Ported from the
//      owner's pumpfun-github-claims bot (src/claim-monitor.ts).
//
// A withdrawal that matches neither rule is NOT attributed to any coin: the
// claim is real (the GitHub identity really pulled fees out of the vault),
// but which coin paid them is unproven, so the feed must say so rather than
// guess from the highest-market-cap candidate.
//
// Impersonation is a separate, additive gate: even an attributed claim gets
// held for review when a brand-new GitHub account claims fees from a
// same-name copy of a much larger coin, or from a repo created right before
// the claim -- the signature of "register a lookalike account, push a repo,
// put it in a copycat coin's metadata, claim its delegated fees" (see
// `assessImpersonation`).

/** A distribution with no V2 quote_mint, or the system id, was paid in SOL. */
const WSOL_MINT = 'So11111111111111111111111111111111111111112';
const SOL_QUOTE_ALIASES = new Set([WSOL_MINT, '11111111111111111111111111111111']);

function sameQuote(a, b) {
	const norm = (m) => (!m || SOL_QUOTE_ALIASES.has(m) ? WSOL_MINT : m);
	return norm(a) === norm(b);
}

/**
 * Evidence from a distribution paid to this PDA inside the claim's own
 * transaction. One entry per mint that distributed to the PDA in this tx (a
 * transaction can carry more than one distribution when the PDA earns from
 * more than one coin and both get swept together).
 * @param {Array<{mint:string, sharingConfig:string, shareholders:Array<{address:string,shareBps:number}>, distributedRaw:string, quoteMint?:string}>} distributions
 * @param {string} socialFeePda
 * @returns {Array<{mint:string, sharingConfig:string, shareBps:number, distributedRaw:string, recipientAmountRaw:string, quoteMint?:string, source:'same_transaction_distribution'}>}
 */
export function evidenceForSocialFeePda(distributions, socialFeePda) {
	if (!socialFeePda) return [];
	const byMint = new Map();
	for (const distribution of distributions) {
		const shareholder = distribution.shareholders.find((s) => s.address === socialFeePda);
		if (!shareholder || shareholder.shareBps <= 0) continue;
		const distributedRaw = BigInt(distribution.distributedRaw);
		const recipientAmountRaw = (distributedRaw * BigInt(shareholder.shareBps)) / 10_000n;
		byMint.set(distribution.mint, {
			mint: distribution.mint,
			sharingConfig: distribution.sharingConfig,
			shareBps: shareholder.shareBps,
			distributedRaw: distributedRaw.toString(),
			recipientAmountRaw: recipientAmountRaw.toString(),
			quoteMint: distribution.quoteMint,
			source: 'same_transaction_distribution',
		});
	}
	return [...byMint.values()];
}

/** A distribution that pays this PDA must hold at least this share of the withdrawal. */
export const HISTORY_DOMINANT_SHARE_BPS = 9_000n;

/**
 * Attribute a withdrawal from the distributions that filled the PDA since its
 * previous claim. Only the claim's own quote currency counts. The result is a
 * single mint or nothing: the observed distributions must cover at least 90%
 * of the amount withdrawn (so history the lookback did not reach cannot hide a
 * different coin), and one mint must account for at least 90% of that.
 * @param {Array<{mint:string, sharingConfig:string, shareholders:Array<{address:string,shareBps:number}>, distributedRaw:string, quoteMint?:string}>} distributions
 * @param {string} socialFeePda
 * @param {bigint} claimedRaw
 * @param {string} [claimQuoteMint]
 */
export function evidenceFromPdaHistory(distributions, socialFeePda, claimedRaw, claimQuoteMint) {
	if (claimedRaw <= 0n) return [];
	const byMint = new Map();
	let total = 0n;
	for (const distribution of distributions) {
		if (!sameQuote(distribution.quoteMint, claimQuoteMint)) continue;
		const shareholder = distribution.shareholders.find((s) => s.address === socialFeePda);
		if (!shareholder || shareholder.shareBps <= 0) continue;
		const distributedRaw = BigInt(distribution.distributedRaw);
		const raw = (distributedRaw * BigInt(shareholder.shareBps)) / 10_000n;
		if (raw === 0n) continue;
		total += raw;
		const prev = byMint.get(distribution.mint);
		byMint.set(distribution.mint, { raw: (prev?.raw ?? 0n) + raw, last: distribution, bps: shareholder.shareBps });
	}
	if (total * 10_000n < claimedRaw * HISTORY_DOMINANT_SHARE_BPS) return [];
	const [top] = [...byMint.entries()].sort((a, b) => (b[1].raw > a[1].raw ? 1 : b[1].raw < a[1].raw ? -1 : 0));
	if (!top || top[1].raw * 10_000n < total * HISTORY_DOMINANT_SHARE_BPS) return [];
	const [mint, { raw, last, bps }] = top;
	return [
		{
			mint,
			sharingConfig: last.sharingConfig,
			shareBps: bps,
			distributedRaw: total.toString(),
			recipientAmountRaw: raw.toString(),
			quoteMint: last.quoteMint,
			source: 'pda_history_distribution',
		},
	];
}

// ============================================================================
// Attribution labels
// ============================================================================

export const ATTRIBUTION_LABELS = Object.freeze({
	TRANSACTION_ATTRIBUTED: 'transaction_attributed',
	FEE_HISTORY_ATTRIBUTED: 'fee_history_attributed',
	VERIFIED_REPOSITORY: 'verified_repository',
	VERIFIED_CREATOR_WALLET: 'verified_creator_wallet',
	IDENTITY_MISMATCH: 'identity_mismatch',
	UNRESOLVED_POOLED: 'unresolved_pooled',
	UNVERIFIED: 'unverified',
});

/**
 * Classify only the relationship a claim can actually prove. A successful
 * GitHub-PDA withdrawal proves a payment to a GitHub identity; it does not by
 * itself prove that identity created, owns, or endorses a particular coin.
 * @param {{
 *   evidence?: {source:'same_transaction_distribution'|'pda_history_distribution'}|null,
 *   candidateMintCount?: number,
 *   githubLogin?: string|null,
 *   githubRepoOwner?: string|null,
 *   claimerWallet?: string|null,
 *   tokenCreatorWallet?: string|null,
 * }} ctx
 */
export function classifyClaimAttribution(ctx) {
	const { evidence, candidateMintCount = 0, githubLogin, githubRepoOwner, claimerWallet, tokenCreatorWallet } = ctx;

	if (evidence) {
		if (evidence.source === 'pda_history_distribution') {
			return {
				label: ATTRIBUTION_LABELS.FEE_HISTORY_ATTRIBUTED,
				headline: 'FEE-HISTORY-ATTRIBUTED GITHUB FEE CLAIM',
				explanation:
					'This coin paid at least 90% of the fees withdrawn, in distributions to this exact GitHub fee account since its previous claim.',
			};
		}
		return {
			label: ATTRIBUTION_LABELS.TRANSACTION_ATTRIBUTED,
			headline: 'TRANSACTION-ATTRIBUTED GITHUB FEE CLAIM',
			explanation: 'This transaction distributed fees from this exact coin to the claimed GitHub fee account.',
		};
	}

	if (candidateMintCount > 1) {
		return {
			label: ATTRIBUTION_LABELS.UNRESOLVED_POOLED,
			headline: 'UNRESOLVED POOLED GITHUB FEE WITHDRAWAL',
			explanation: `One shared fee account is linked to ${candidateMintCount} coins. This withdrawal cannot be assigned to one CA.`,
		};
	}

	const claimer = githubLogin ? githubLogin.toLowerCase() : null;
	const owner = githubRepoOwner ? githubRepoOwner.toLowerCase() : null;
	if (claimer && owner && owner !== claimer) {
		return {
			label: ATTRIBUTION_LABELS.IDENTITY_MISMATCH,
			headline: 'IDENTITY MISMATCH, GITHUB FEE WITHDRAWAL',
			explanation: `The claiming GitHub account is not the owner linked in the token metadata (${owner}).`,
		};
	}
	if (claimer && owner && owner === claimer) {
		return {
			label: ATTRIBUTION_LABELS.VERIFIED_REPOSITORY,
			headline: 'VERIFIED GITHUB FEE CLAIM',
			explanation: 'The claiming GitHub identity matches the repository owner linked in the token metadata.',
		};
	}

	if (claimerWallet && tokenCreatorWallet && claimerWallet === tokenCreatorWallet) {
		return {
			label: ATTRIBUTION_LABELS.VERIFIED_CREATOR_WALLET,
			headline: 'CREATOR-WALLET GITHUB FEE CLAIM',
			explanation: 'The claim recipient matches the token creator wallet. No repository-owner match was established.',
		};
	}

	return {
		label: ATTRIBUTION_LABELS.UNVERIFIED,
		headline: 'UNVERIFIED GITHUB FEE WITHDRAWAL',
		explanation: 'A real fee withdrawal occurred, but it does not prove this GitHub user created or endorses the coin.',
	};
}

// ============================================================================
// Impersonation gate
// ============================================================================

/**
 * A repository-owner match is circular when the claimer controls both sides:
 * anyone can register a lookalike GitHub account, push a repo, put that repo
 * in a copycat coin's metadata, delegate the coin's fees to the account and
 * claim them. A young account alone is not suspicious, and neither is a
 * same-name coin; the combination is the scam's signature, so both must hold
 * before a claim is held.
 */
export const NEW_ACCOUNT_DAYS = 30;
/** A repo created this close to the claim was likely made for the coin. */
export const FRESH_REPO_DAYS = 7;
/** A same-name coin this many times larger marks this one as the copy. */
export const COPYCAT_MCAP_RATIO = 1.5;

const DAY_MS = 86_400_000;

function ageDays(iso, nowMs) {
	if (!iso) return null;
	const t = new Date(iso).getTime();
	return Number.isFinite(t) ? (nowMs - t) / DAY_MS : null;
}

/**
 * @param {{
 *   githubUser?: {createdAt?:string}|null,
 *   tokenInfo?: {usdMarketCap?:number}|null,
 *   sameNameTokens?: Array<{mint:string, usdMarketCap:number}>|null,
 *   repoInfo?: {createdAt?:string}|null,
 * }} input
 * @param {number} [nowMs]
 * @returns {{suspected: boolean, reasons: string[]}}
 */
export function assessImpersonation(input, nowMs = Date.now()) {
	const accountAge = ageDays(input.githubUser?.createdAt, nowMs);
	if (accountAge == null || accountAge >= NEW_ACCOUNT_DAYS) return { suspected: false, reasons: [] };

	const reasons = [`GitHub account ${Math.floor(accountAge)}d old`];
	const top = input.sameNameTokens?.[0];
	const copycat = Boolean(
		top && input.tokenInfo && top.usdMarketCap > input.tokenInfo.usdMarketCap * COPYCAT_MCAP_RATIO,
	);
	if (copycat) reasons.push(`same-name coin ${top.mint.slice(0, 6)} is larger ($${Math.round(top.usdMarketCap)})`);

	const repoAge = ageDays(input.repoInfo?.createdAt, nowMs);
	const freshRepo = repoAge != null && repoAge < FRESH_REPO_DAYS;
	if (freshRepo) reasons.push(`metadata repo ${Math.floor(repoAge)}d old`);

	return { suspected: copycat || freshRepo, reasons };
}

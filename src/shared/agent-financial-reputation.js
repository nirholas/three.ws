// Agent Financial Reputation — the pure, explainable scoring engine.
//
// In a world of autonomous money agents, trust is the scarce thing. This module
// turns an agent's REAL, already-settled financial behaviour into ONE explainable
// 0–100 credit score. It is the credit-bureau + proof-of-reserves primitive the
// agent economy needs: every point traces to a real, linkable on-chain or ledger
// event, never a follower count, never a vibe, never a fabricated number.
//
// This file is intentionally PURE (no I/O, no imports). The same function runs
// server-authoritatively in api/ (api/_lib/trust/wallet-reputation.js does the
// real DB + RPC reads and calls computeReputation here) and is unit-tested in
// tests/wallet-reputation.test.js. The score can therefore never be gamed
// client-side: the client only ever renders what the server computed.
//
// ── Design principles (read before touching the weights) ─────────────────────
//
//   1. Every input is a real, verifiable fact: the custody ledger
//      (agent_custody_events), the on-chain payment index (pump_agent_*),
//      realized trading P&L (agent_sniper_positions), signed Solana attestations,
//      the EVM ERC-8004 reputation registry, fork lineage, live reserves, and the
//      agent's own age. No invented numbers.
//
//   2. Costly, provable signals outweigh cheap ones. Real USD volume, wallet age,
//      tips from DISTINCT funded wallets, on-chain verification, and reserves that
//      actually cover obligations are weighted heavily. Anything a single actor can
//      manufacture for free — self-tips, wash-tips between an owner's own agents,
//      circular reciprocity, single-counterparty volume — is discounted IN the
//      computation, not flagged after the fact.
//
//   3. The formula is fully explainable. computeReputation() returns, for every
//      factor, the raw inputs, the points awarded, the max, and human-readable
//      detail. The transparency panel renders that breakdown verbatim.
//
//   4. A brand-new agent reads honestly as "new" — never a fake high or fake low.
//      Time and money are the two things you cannot fast-forward.
//
// ── The factors and their maxima (sum to 100) ────────────────────────────────
//
//   tenure       12  wallet/agent age (log-scaled) + recent activity cadence
//   volume       13  real settled USD that flowed through the wallet
//   tips         12  count of DISTINCT external funded wallets that tipped it
//   reliability  12  on-chain settlement success rate (only once there's volume)
//   generosity    8  tips/streams GIVEN to others (reciprocity), wash-excluded
//   conduct      12  trading conduct: realized P&L + win rate − dumping penalty
//   conviction   10  $THREE held (log-scaled value) + continuous holding duration
//   solvency      6  live reserves vs outstanding obligations (full mode only)
//   lineage       6  how many times the avatar was forked (others valued it)
//   identity      9  verified ERC-8004 identity + registry feedback + attestations
//
// v3 introduced the `conviction` pillar — holding the platform's only coin,
// $THREE, through time is a costly, fully on-chain commitment to three.ws. Its 10
// points were carved out of `volume` (18→13) and `identity` (14→9) rather than
// inflating the scale: on this platform, conviction in the native coin is at least
// as strong a trust signal as an external registry, and the score still sums to
// exactly 100 so the tier thresholds and every persisted history stay comparable.
//
// v4 adds hire fulfillment (signed attestations on every settled
// api/agents/a2a-hire call, api/_lib/trust/hire-attestations.js) as a SECOND,
// additive way to earn the `reliability` pillar's points, gated by a minimum
// sample so one lucky or unlucky hire can't swing it. It does not touch the
// pillar's max (12) or any other pillar, so the 100-point scale is unchanged.
//
// loadReputationInputs / getAgentReputation (server) do the real I/O.

export const REPUTATION_VERSION = 4;

// Factor definitions — label + max points. Order is the display order.
export const PILLARS = [
	{ key: 'tenure', label: 'Tenure & consistency', max: 12 },
	{ key: 'volume', label: 'Earnings & volume', max: 13 },
	{ key: 'tips', label: 'Tips from distinct wallets', max: 12 },
	{ key: 'reliability', label: 'Settlement reliability', max: 12 },
	{ key: 'generosity', label: 'Generosity & reciprocity', max: 8 },
	{ key: 'conduct', label: 'Trading conduct', max: 12 },
	{ key: 'conviction', label: '$THREE conviction', max: 10 },
	{ key: 'solvency', label: 'Solvency (reserves vs owed)', max: 6 },
	{ key: 'lineage', label: 'Fork lineage', max: 6 },
	{ key: 'identity', label: 'On-chain identity', max: 9 },
];

export const MAX_SCORE = PILLARS.reduce((s, p) => s + p.max, 0); // 100

// Tier ladder. Tiers reflect REAL thresholds, not just the raw score — `trusted`
// and above additionally require genuine counterparty diversity so age + identity
// alone can never manufacture trust.
export const TIERS = {
	new: { label: 'New', rank: 0, accent: '#9ca3af' },
	emerging: { label: 'Emerging', rank: 1, accent: '#c4b5fd' },
	established: { label: 'Established', rank: 2, accent: '#a78bfa' },
	trusted: { label: 'Trusted', rank: 3, accent: '#4ade80' },
	elite: { label: 'Elite', rank: 4, accent: '#fbbf24' },
};

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const round1 = (n) => Math.round(n * 10) / 10;
const log2 = (n) => Math.log(n) / Math.LN2;

/**
 * Pure scoring function. Takes a fully-resolved, real `inputs` object (no I/O)
 * and returns an explainable reputation result. Kept pure so the formula is
 * unit-testable and identical on server and client.
 *
 * @param {object} inputs
 * @param {number} inputs.ageDays            agent/wallet age in days
 * @param {number} inputs.activeDays90       distinct days with ledger activity in last 90d
 * @param {number} inputs.externalTipUsd     real USD tipped by NON-self, NON-owned wallets
 * @param {number} inputs.settledUsd         real USD that settled through the wallet (earnings)
 * @param {number} inputs.tipCount           total recorded tips
 * @param {number} inputs.distinctTippers    distinct EXTERNAL funded tipper wallets
 * @param {number} inputs.selfTipCount       tips whose sender == the wallet itself (ignored)
 * @param {number} inputs.washTipCount       tips from another agent owned by the SAME user (ignored)
 * @param {number} inputs.washTipUsd         USD of those wash-tips (excluded from volume)
 * @param {number} inputs.confirmedPayments  confirmed on-chain payments accepted
 * @param {number} inputs.failedPayments     failed on-chain payments
 * @param {number} inputs.distinctPayers     distinct confirmed payers
 * @param {number} inputs.distributionSuccess success rate of distribute/buyback runs (0..1)
 * @param {number} inputs.tipsGivenUsd       USD this wallet GAVE to non-owned agents
 * @param {number} inputs.tipsGivenCount     count of tips/streams it gave out
 * @param {number} inputs.reciprocalPairs    distinct counterparties it both tipped and was tipped by
 * @param {number} inputs.closedTrades       closed trading positions (real settlements)
 * @param {number} inputs.winningTrades      closed positions with positive realized P&L
 * @param {number} inputs.realizedPnlSol     net realized P&L in SOL across closed positions
 * @param {number} inputs.dumpEvents         detected dumps on its own coin's supporters
 * @param {number} inputs.threeUsd           live USD value of $THREE held by the wallet
 * @param {number} inputs.threeTokens        whole-token $THREE balance (price-independent gate)
 * @param {number} inputs.threeHoldDays      continuous days holding $THREE (resets on full exit)
 * @param {number} inputs.reserveUsd         live reserves USD (full mode only; 0 = unknown)
 * @param {number} inputs.obligationsUsd     outstanding obligations USD (active streams + pending)
 * @param {boolean} inputs.reservesKnown     whether live reserves were actually read
 * @param {number} inputs.forkCount          times this avatar was forked
 * @param {boolean} inputs.hasOnchainIdentity verified ERC-8004 identity present
 * @param {number} inputs.registryAverage    ERC-8004 reputation registry average (0..5 or 0..100)
 * @param {number} inputs.registryCount      ERC-8004 registry feedback count
 * @param {number} inputs.validationCount    signed Solana validation attestations
 * @param {number} inputs.feedbackCount      signed Solana feedback attestations
 * @param {boolean} inputs.hasSkillCollection on-chain skill-license collection minted
 * @param {?number} inputs.hireFulfillmentRate recency-weighted share of this agent's
 *   a2a-hires (as PROVIDER) attested 'delivered', null when there isn't enough sample yet
 * @param {number} inputs.hireFulfillmentSampleSize raw count of signed hire attestations
 * @param {number} inputs.hireFulfillmentMinSample minimum sample before the rate counts (default 5)
 * @returns {object} { version, score, max, tier, tierLabel, accent, isNew, pillars, discounted, totals }
 */
export function computeReputation(inputs = {}) {
	const i = normalizeInputs(inputs);
	const pillars = [];
	const discounted = [];

	// Counterparty concentration — the core anti-gaming guard. Real trust comes
	// from MANY distinct funded wallets choosing to pay/tip. If volume is high but
	// it all came from a single counterparty (a classic wash / self-deal pattern),
	// the money-weighted pillars are heavily discounted.
	const tipDiversity = i.distinctTippers;
	const concentrated = i.tipCount > 1 && tipDiversity <= 1;
	const diversityMultiplier = concentrated ? 0.35 : 1;

	// ── Tenure & consistency (max 12) ──────────────────────────────────────────
	// Age is the single most non-gameable signal: you cannot fast-forward time.
	const agePts = clamp(3.0 * Math.log10(i.ageDays + 1), 0, 8);
	const consistencyPts = clamp((i.activeDays90 / 30) * 4, 0, 4);
	pushPillar(pillars, 'tenure', agePts + consistencyPts, {
		detail:
			i.ageDays < 1
				? 'Brand-new wallet — no track record yet.'
				: `${fmtAge(i.ageDays)} old · active ${i.activeDays90} of the last 90 days.`,
		facts: { age_days: Math.round(i.ageDays), active_days_90: i.activeDays90 },
	});

	// ── Earnings & volume (max 18) ─────────────────────────────────────────────
	// Real USD that flowed through the wallet. Money moved is costly to fake.
	const rawVolume = i.settledUsd + i.externalTipUsd;
	const volumePtsRaw = clamp(4.4 * Math.log10(rawVolume + 1), 0, 13);
	const volumePts = volumePtsRaw * diversityMultiplier;
	pushPillar(pillars, 'volume', volumePts, {
		detail:
			rawVolume <= 0
				? 'No settled volume yet.'
				: `$${fmtUsd(rawVolume)} in real settled volume${concentrated ? ' (discounted — single counterparty)' : ''}.`,
		facts: { settled_usd: round1(i.settledUsd), tip_usd: round1(i.externalTipUsd) },
	});

	// ── Tips from distinct wallets (max 12) ────────────────────────────────────
	// Each DISTINCT funded tipper is a real Sybil cost. Self-tips and wash-tips
	// from the owner's other agents are excluded from the count below.
	const tipsPtsRaw = clamp(4.2 * log2(tipDiversity + 1), 0, 12);
	const tipsPts = tipsPtsRaw * diversityMultiplier;
	pushPillar(pillars, 'tips', tipsPts, {
		detail:
			tipDiversity === 0
				? 'No tips from external wallets yet.'
				: `${tipDiversity} distinct funded wallet${tipDiversity === 1 ? '' : 's'} tipped this agent.`,
		facts: { distinct_tippers: tipDiversity, total_tips: i.tipCount },
	});

	// ── Settlement reliability (max 12) ────────────────────────────────────────
	// Only meaningful once there's real settlement volume. A new agent honestly
	// scores 0 here rather than an unearned full mark.
	const settled = i.confirmedPayments + i.failedPayments;
	let paymentReliabilityPts = 0;
	let reliabilityDetail = 'No settled payments yet — reliability is unproven.';
	if (settled >= 5) {
		const successRate = i.confirmedPayments / settled;
		paymentReliabilityPts = successRate * 10 + clamp(i.distributionSuccess * 2, 0, 2);
		reliabilityDetail = `${(successRate * 100).toFixed(0)}% of ${settled} settlements succeeded${
			i.distributionSuccess > 0 ? `, ${(i.distributionSuccess * 100).toFixed(0)}% distribution success` : ''
		}.`;
	}

	// Hire fulfillment: a SECOND, additive way into this same pillar, earned
	// from signed attestations on this agent's own a2a-hires as PROVIDER
	// (api/_lib/trust/hire-attestations.js), recency-weighted and gated by a
	// minimum sample. pushPillar clamps the combined total to max 12 either
	// way, so an agent with strong generic payment reliability already near
	// the cap gets no extra credit, this fills in signal for agents whose
	// real settlement history is mostly a2a-hire deliveries.
	const hireSampleSize = i.hireFulfillmentSampleSize;
	const hireMinSample = i.hireFulfillmentMinSample;
	const hireMeetsMinimum = i.hireFulfillmentRate != null && hireSampleSize >= hireMinSample;
	const fulfillmentPts = hireMeetsMinimum ? clamp(i.hireFulfillmentRate * 3, 0, 3) : 0;
	if (hireMeetsMinimum) {
		reliabilityDetail += ` ${(i.hireFulfillmentRate * 100).toFixed(0)}% hire fulfillment over ${hireSampleSize} hire${hireSampleSize === 1 ? '' : 's'}.`;
	} else if (hireSampleSize > 0) {
		reliabilityDetail += ` ${hireSampleSize} hire${hireSampleSize === 1 ? '' : 's'} attested so far (needs ${hireMinSample} before fulfillment rate counts).`;
	}
	const reliabilityPts = paymentReliabilityPts + fulfillmentPts;
	pushPillar(pillars, 'reliability', reliabilityPts, {
		detail: reliabilityDetail,
		facts: {
			confirmed_payments: i.confirmedPayments,
			failed_payments: i.failedPayments,
			hire_fulfillment_rate: hireMeetsMinimum ? round1(i.hireFulfillmentRate * 100) : null,
			hire_fulfillment_sample_size: hireSampleSize,
		},
	});

	// ── Generosity & reciprocity (max 8) ───────────────────────────────────────
	// An agent that tips/streams to OTHER agents (wash-excluded) builds the
	// reciprocity that makes the whole economy liquid. Giving is costly and real.
	let generosityPts = 0;
	let generosityDetail = 'Has not tipped or streamed to other agents yet.';
	if (i.tipsGivenUsd > 0 || i.tipsGivenCount > 0) {
		const givenPts = clamp(2.6 * Math.log10(i.tipsGivenUsd + 1), 0, 6);
		// A genuine two-way relationship (it tipped wallets that also tipped it) is
		// the healthy signal; pure circular reciprocity is NOT rewarded — see below.
		const reciprocityPts = i.externalTipUsd > 0 && i.tipsGivenUsd > 0 ? clamp(i.reciprocalPairs * 0.8, 0, 2) : 0;
		generosityPts = clamp(givenPts + reciprocityPts, 0, 8);
		generosityDetail = `Gave $${fmtUsd(i.tipsGivenUsd)} across ${i.tipsGivenCount} tip${
			i.tipsGivenCount === 1 ? '' : 's'
		} to other agents${reciprocityPts > 0 ? `, ${i.reciprocalPairs} two-way relationship${i.reciprocalPairs === 1 ? '' : 's'}` : ''}.`;
	}
	pushPillar(pillars, 'generosity', generosityPts, {
		detail: generosityDetail,
		facts: { given_usd: round1(i.tipsGivenUsd), given_count: i.tipsGivenCount, reciprocal_pairs: i.reciprocalPairs },
	});

	// ── Trading conduct (max 12) ───────────────────────────────────────────────
	// Does it trade without rugging its supporters? Realized P&L from CLOSED
	// positions is a real on-chain settlement. We reward profitable, consistent
	// trading and PENALISE detected dumps on its own coin's holders. Needs a real
	// sample (≥3 closed trades) before it scores — no track record, no points.
	let conductPts = 0;
	let conductDetail = 'No closed trades yet — conduct is unproven.';
	if (i.closedTrades >= 3) {
		const winRate = i.winningTrades / i.closedTrades;
		const winRatePts = winRate * 6;
		const profitPts = i.realizedPnlSol > 0 ? clamp(2.5 * Math.log10(i.realizedPnlSol + 1), 0, 6) : 0;
		const dumpPenalty = i.dumpEvents * 3;
		conductPts = clamp(winRatePts + profitPts - dumpPenalty, 0, 12);
		conductDetail =
			`${(winRate * 100).toFixed(0)}% win rate over ${i.closedTrades} closed trades, ` +
			`${i.realizedPnlSol >= 0 ? '+' : ''}${round1(i.realizedPnlSol)} SOL realized` +
			(i.dumpEvents > 0 ? ` — penalised for ${i.dumpEvents} dump${i.dumpEvents === 1 ? '' : 's'} on supporters.` : '.');
	}
	pushPillar(pillars, 'conduct', conductPts, {
		detail: conductDetail,
		facts: {
			closed_trades: i.closedTrades,
			win_rate: i.closedTrades >= 3 ? round1(i.winningTrades / i.closedTrades) : null,
			realized_pnl_sol: round1(i.realizedPnlSol),
			dump_events: i.dumpEvents,
		},
	});

	// ── $THREE conviction (max 10) ─────────────────────────────────────────────
	// Holding the platform's ONLY coin — and holding it through time — is a costly,
	// fully on-chain commitment to three.ws that no follower count can fake. Value
	// is log-scaled so a whale can't buy the whole pillar in one transfer; duration
	// rewards genuine long-term holders and resets honestly the instant a wallet
	// fully exits its $THREE (the holder snapshot drops it, so held_since restarts).
	// A flash-hold — buy, snapshot, sell — earns near-zero duration and only the
	// log-scaled value of whatever was briefly held.
	const holdsThree = i.threeTokens > 0;
	const threeValuePts = clamp(2.4 * Math.log10(i.threeUsd + 1), 0, 6);
	const threeDurationPts = holdsThree ? clamp((i.threeHoldDays / 120) * 4, 0, 4) : 0;
	const convictionPts = clamp(threeValuePts + threeDurationPts, 0, 10);
	pushPillar(pillars, 'conviction', convictionPts, {
		detail: !holdsThree
			? 'Holds no $THREE yet — holding the platform coin builds long-term conviction.'
			: `Holds $${fmtUsd(i.threeUsd)} of $THREE${
					i.threeHoldDays >= 1 ? ` continuously for ${fmtAge(i.threeHoldDays)}` : ' (just started)'
			  }.`,
		facts: {
			three_usd: round1(i.threeUsd),
			three_hold_days: Math.round(i.threeHoldDays),
			three_tokens: Math.round(i.threeTokens),
		},
	});

	// ── Solvency (max 6) ───────────────────────────────────────────────────────
	// Can it cover what it owes? Live reserves measured against outstanding
	// obligations (active streams still committed + pending spends). Only computes
	// when reserves were actually read (full mode); otherwise honestly 0/unknown,
	// never fabricated.
	let solvencyPts = 0;
	let solvencyDetail = 'Reserves not measured in this view.';
	if (i.reservesKnown) {
		if (i.obligationsUsd > 0) {
			const coverage = i.reserveUsd / i.obligationsUsd;
			solvencyPts = clamp(coverage, 0, 1) * 6;
			solvencyDetail = `$${fmtUsd(i.reserveUsd)} reserves cover ${(clamp(coverage, 0, 9.99) * 100).toFixed(0)}% of $${fmtUsd(
				i.obligationsUsd,
			)} outstanding obligations.`;
		} else if (i.reserveUsd > 0) {
			// Solvent with nothing owed — real, but not stress-tested by obligations.
			solvencyPts = 3;
			solvencyDetail = `$${fmtUsd(i.reserveUsd)} in reserves, no outstanding obligations.`;
		} else {
			solvencyDetail = 'No reserves and no obligations yet.';
		}
	}
	pushPillar(pillars, 'solvency', solvencyPts, {
		detail: solvencyDetail,
		facts: { reserve_usd: round1(i.reserveUsd), obligations_usd: round1(i.obligationsUsd), measured: i.reservesKnown },
	});

	// ── Fork lineage (max 6) ───────────────────────────────────────────────────
	const lineagePts = clamp(2.6 * log2(i.forkCount + 1), 0, 6);
	pushPillar(pillars, 'lineage', lineagePts, {
		detail:
			i.forkCount === 0
				? 'Not forked yet.'
				: `Forked ${i.forkCount} time${i.forkCount === 1 ? '' : 's'} by other creators.`,
		facts: { fork_count: i.forkCount },
	});

	// ── On-chain identity & verification (max 9) ───────────────────────────────
	let identityPts = 0;
	const idBits = [];
	if (i.hasOnchainIdentity) {
		identityPts += 4;
		idBits.push('verified ERC-8004 identity');
	}
	if (i.registryCount > 0) {
		// Registry average may arrive on a 0–5 star scale or a 0–100 scale.
		const norm = i.registryAverage > 5 ? i.registryAverage / 100 : i.registryAverage / 5;
		const regPts = clamp(norm * 2 + clamp(log2(i.registryCount + 1), 0, 1.5), 0, 3.5);
		identityPts += regPts;
		idBits.push(`${i.registryCount} on-chain review${i.registryCount === 1 ? '' : 's'}`);
	}
	const attPts = clamp(i.validationCount * 1 + i.feedbackCount * 0.3, 0, 1.5);
	if (attPts > 0) {
		identityPts += attPts;
		idBits.push(`${i.validationCount + i.feedbackCount} signed attestation${i.validationCount + i.feedbackCount === 1 ? '' : 's'}`);
	}
	if (i.hasSkillCollection) {
		identityPts += 0.5;
		idBits.push('on-chain skill licenses');
	}
	identityPts = clamp(identityPts, 0, 9);
	pushPillar(pillars, 'identity', identityPts, {
		detail: idBits.length ? `Carries ${idBits.join(', ')}.` : 'No on-chain identity or attestations yet.',
		facts: { verified: i.hasOnchainIdentity, registry_count: i.registryCount, attestations: i.validationCount + i.feedbackCount },
	});

	// ── Anti-gaming transparency ───────────────────────────────────────────────
	// Surface what did NOT count so the score reads as credible.
	if (i.selfTipCount > 0) {
		discounted.push({
			kind: 'self_tips',
			label: `${i.selfTipCount} self-tip${i.selfTipCount === 1 ? '' : 's'} ignored`,
			detail: 'Tips sent from the wallet to itself carry no trust and are excluded from the score.',
		});
	}
	if (i.washTipCount > 0) {
		discounted.push({
			kind: 'wash_tips',
			label: `${i.washTipCount} wash-tip${i.washTipCount === 1 ? '' : 's'} ($${fmtUsd(i.washTipUsd)}) ignored`,
			detail:
				'Tips from another agent the same owner controls are self-dealing — they are excluded from volume, tippers, and generosity.',
		});
	}
	if (concentrated) {
		discounted.push({
			kind: 'concentration',
			label: 'Single-counterparty volume discounted',
			detail:
				'Most volume came from one wallet. Trust requires many distinct funded counterparties, so this volume is weighted down.',
		});
	}
	if (i.dumpEvents > 0) {
		discounted.push({
			kind: 'dump',
			label: `${i.dumpEvents} dump${i.dumpEvents === 1 ? '' : 's'} on supporters penalised`,
			detail: 'Selling a large position into its own coin shortly after launch rugs early supporters and lowers trading conduct.',
		});
	}

	const score = round1(clamp(pillars.reduce((s, p) => s + p.points, 0), 0, MAX_SCORE));

	// Real activity floor for the "new" verdict — independent of the raw score,
	// which is never exactly 0 once an agent has any age.
	const realActivity =
		i.tipCount +
		i.tipsGivenCount +
		i.confirmedPayments +
		i.closedTrades +
		i.forkCount +
		i.validationCount +
		i.feedbackCount +
		i.registryCount +
		(i.hasOnchainIdentity ? 1 : 0) +
		(holdsThree ? 1 : 0) +
		(rawVolume > 0 ? 1 : 0);
	const isNew = realActivity === 0;

	const tier = tierFor({ score, isNew, distinctTippers: tipDiversity, confirmedPayments: i.confirmedPayments });

	return {
		version: REPUTATION_VERSION,
		score,
		max: MAX_SCORE,
		tier,
		tierLabel: TIERS[tier].label,
		accent: TIERS[tier].accent,
		isNew,
		pillars,
		discounted,
		totals: {
			settled_usd: round1(rawVolume),
			distinct_tippers: tipDiversity,
			confirmed_payments: i.confirmedPayments,
			given_usd: round1(i.tipsGivenUsd),
			closed_trades: i.closedTrades,
			reserve_usd: i.reservesKnown ? round1(i.reserveUsd) : null,
			fork_count: i.forkCount,
			verified: i.hasOnchainIdentity,
			// $THREE conviction — surfaced in totals so the access layer (unlocks) and
			// the client can read holdings/duration without re-deriving them.
			three_usd: round1(i.threeUsd),
			three_hold_days: Math.round(i.threeHoldDays),
			holds_three: holdsThree,
		},
	};
}

/**
 * Tier from the real score + real counterparty thresholds. `trusted`/`elite`
 * require genuine counterparty diversity (≥3 distinct tippers OR ≥10 confirmed
 * payments) so that score earned purely from age + identity can never be sold as
 * peer trust.
 */
export function tierFor({ score, isNew, distinctTippers = 0, confirmedPayments = 0 }) {
	if (isNew) return 'new';
	const hasPeerTrust = distinctTippers >= 3 || confirmedPayments >= 10;
	if (score >= 75 && hasPeerTrust) return 'elite';
	if (score >= 55 && hasPeerTrust) return 'trusted';
	if (score >= 30) return 'established';
	return 'emerging';
}

function pushPillar(arr, key, points, extra) {
	const def = PILLARS.find((p) => p.key === key);
	arr.push({
		key,
		label: def.label,
		points: round1(clamp(points, 0, def.max)),
		max: def.max,
		...extra,
	});
}

function normalizeInputs(raw) {
	const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
	return {
		ageDays: Math.max(0, num(raw.ageDays)),
		activeDays90: Math.max(0, num(raw.activeDays90)),
		externalTipUsd: Math.max(0, num(raw.externalTipUsd)),
		settledUsd: Math.max(0, num(raw.settledUsd)),
		tipCount: Math.max(0, num(raw.tipCount)),
		distinctTippers: Math.max(0, num(raw.distinctTippers)),
		selfTipCount: Math.max(0, num(raw.selfTipCount)),
		washTipCount: Math.max(0, num(raw.washTipCount)),
		washTipUsd: Math.max(0, num(raw.washTipUsd)),
		confirmedPayments: Math.max(0, num(raw.confirmedPayments)),
		failedPayments: Math.max(0, num(raw.failedPayments)),
		distinctPayers: Math.max(0, num(raw.distinctPayers)),
		distributionSuccess: clamp(num(raw.distributionSuccess), 0, 1),
		tipsGivenUsd: Math.max(0, num(raw.tipsGivenUsd)),
		tipsGivenCount: Math.max(0, num(raw.tipsGivenCount)),
		reciprocalPairs: Math.max(0, num(raw.reciprocalPairs)),
		closedTrades: Math.max(0, num(raw.closedTrades)),
		winningTrades: Math.max(0, num(raw.winningTrades)),
		realizedPnlSol: num(raw.realizedPnlSol),
		dumpEvents: Math.max(0, num(raw.dumpEvents)),
		threeUsd: Math.max(0, num(raw.threeUsd)),
		threeTokens: Math.max(0, num(raw.threeTokens)),
		threeHoldDays: Math.max(0, num(raw.threeHoldDays)),
		reserveUsd: Math.max(0, num(raw.reserveUsd)),
		obligationsUsd: Math.max(0, num(raw.obligationsUsd)),
		reservesKnown: Boolean(raw.reservesKnown),
		forkCount: Math.max(0, num(raw.forkCount)),
		hasOnchainIdentity: Boolean(raw.hasOnchainIdentity),
		registryAverage: Math.max(0, num(raw.registryAverage)),
		registryCount: Math.max(0, num(raw.registryCount)),
		validationCount: Math.max(0, num(raw.validationCount)),
		feedbackCount: Math.max(0, num(raw.feedbackCount)),
		hasSkillCollection: Boolean(raw.hasSkillCollection),
		hireFulfillmentRate: Number.isFinite(Number(raw.hireFulfillmentRate))
			? clamp(Number(raw.hireFulfillmentRate), 0, 1)
			: null,
		hireFulfillmentSampleSize: Math.max(0, num(raw.hireFulfillmentSampleSize)),
		hireFulfillmentMinSample: raw.hireFulfillmentMinSample != null ? Math.max(1, num(raw.hireFulfillmentMinSample)) : 5,
	};
}

export function fmtAge(days) {
	if (days >= 365) return `${(days / 365).toFixed(1)}y`;
	if (days >= 30) return `${Math.round(days / 30)}mo`;
	if (days >= 1) return `${Math.round(days)}d`;
	return '<1d';
}
export function fmtUsd(n) {
	n = Number(n) || 0;
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
	return n.toFixed(n < 10 ? 2 : 0);
}

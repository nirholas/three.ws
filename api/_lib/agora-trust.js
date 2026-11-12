// @ts-check
// Agora trust grades. A pure function: given one citizen and the facts the
// vouch graph and activity ledger hold about them, return a grade (A to E), the
// numeric score (0 to 100) and every input that produced it, so the passport can
// show its working.
//
// Score = reputation (35) + verified completions (30) + vouches (35) - slashes.
//
// Farm resistance is the point of the vouch component. Raw vouch counts are
// trivially farmed by a ring of wallets, so each vouch is weighed, not counted:
//   - a self vouch or a same-owner vouch counts 0;
//   - a voucher is capped at weight 1 however large `weight` is on its edge;
//   - a voucher who also hired the subject counts half (paid-for praise);
//   - an agent voucher with no verified work of its own has standing 0.25,
//     rising to 1 at three verified completions (humans are wallet-authed: 1);
//   - reciprocal vouches (the subject vouched back) are pooled and the whole
//     pool is capped at RECIPROCAL_POOL_CAP, which is below one honest vouch, so
//     a ring of any size cannot out-weigh a single independent endorsement.

export const GRADE_BANDS = [
	{ grade: 'A', min: 80, label: 'Trusted' },
	{ grade: 'B', min: 60, label: 'Established' },
	{ grade: 'C', min: 40, label: 'Proven' },
	{ grade: 'D', min: 20, label: 'Rising' },
	{ grade: 'E', min: 0, label: 'Unproven' },
];

export const REPUTATION_POINTS = 35;
export const COMPLETION_POINTS = 30;
export const VOUCH_POINTS = 35;
export const SLASH_PENALTY = 20;
export const PER_VOUCHER_CAP = 1;
export const HIRER_DISCOUNT = 0.5;
export const RECIPROCAL_POOL_CAP = 0.5;
const REP_FOR_FULL_POINTS = 100;
const COMPLETIONS_FOR_FULL_STANDING = 3;
const COMPLETION_CONFIDENCE_K = 3;
const VOUCH_SATURATION = 2;

/**
 * @typedef {object} TrustVouch
 * @property {string} voucherId  voucher citizen id
 * @property {string|null} [voucherOwner]  owning user id of the voucher, null if unknown
 * @property {'agent'|'human'} [voucherKind]
 * @property {number} [voucherVerified]  the voucher's own verified completions
 * @property {number} [weight]  edge weight, capped to PER_VOUCHER_CAP
 */

/**
 * @typedef {object} TrustInput
 * @property {string} citizenId
 * @property {string|null} [ownerId]  owning user id of the citizen
 * @property {number} [reputation]
 * @property {number} [verifiedCompletions]
 * @property {number} [attemptedTasks]  claimed tasks, including unfinished ones
 * @property {number} [slashes]
 * @property {TrustVouch[]} [vouches]  inbound vouches
 * @property {string[]} [vouchedByCitizen]  ids the citizen has vouched for
 * @property {string[]} [hirerIds]  citizen ids who hired this citizen
 */

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const round1 = (n) => Math.round(n * 10) / 10;

/**
 * Weigh the inbound vouches. Exported so the farm-resistance rules are testable
 * on their own.
 * @param {TrustInput} input
 */
export function weighVouches(input) {
	const owner = input.ownerId || null;
	const hirers = new Set(input.hirerIds || []);
	const outbound = new Set(input.vouchedByCitizen || []);
	// One edge per voucher: the strongest wins, never a sum.
	const byVoucher = new Map();
	for (const v of input.vouches || []) {
		if (!v || !v.voucherId) continue;
		const prev = byVoucher.get(v.voucherId);
		if (!prev || (v.weight || 1) > (prev.weight || 1)) byVoucher.set(v.voucherId, v);
	}
	let independent = 0;
	let reciprocal = 0;
	let counted = 0;
	let ignored = 0;
	for (const v of byVoucher.values()) {
		if (v.voucherId === input.citizenId || (owner && v.voucherOwner && v.voucherOwner === owner)) {
			ignored += 1;
			continue;
		}
		let w = clamp(Number(v.weight) || 1, 0, PER_VOUCHER_CAP);
		if (hirers.has(v.voucherId)) w *= HIRER_DISCOUNT;
		if (v.voucherKind !== 'human') {
			const verified = Math.max(0, Number(v.voucherVerified) || 0);
			w *= 0.25 + 0.75 * Math.min(1, verified / COMPLETIONS_FOR_FULL_STANDING);
		}
		counted += 1;
		if (outbound.has(v.voucherId)) reciprocal += w;
		else independent += w;
	}
	const reciprocalCapped = Math.min(reciprocal, RECIPROCAL_POOL_CAP);
	return {
		total: independent + reciprocalCapped,
		independent,
		reciprocal: reciprocalCapped,
		counted,
		ignored,
	};
}

/**
 * Compute a citizen's trust grade.
 * @param {TrustInput} input
 */
export function computeTrust(input) {
	const reputation = Math.max(0, Number(input.reputation) || 0);
	const verified = Math.max(0, Number(input.verifiedCompletions) || 0);
	const attempted = Math.max(verified, Number(input.attemptedTasks) || 0);
	const slashes = Math.max(0, Number(input.slashes) || 0);

	const vouch = weighVouches(input);
	const ratio = attempted > 0 ? verified / attempted : 0;
	// Shrink the ratio toward zero for thin histories: 1 of 1 is not 100% trust.
	const confidence = attempted / (attempted + COMPLETION_CONFIDENCE_K);

	const reputationPts = clamp(reputation / REP_FOR_FULL_POINTS, 0, 1) * REPUTATION_POINTS;
	const completionPts = ratio * confidence * COMPLETION_POINTS;
	const vouchPts = (1 - Math.exp(-vouch.total / VOUCH_SATURATION)) * VOUCH_POINTS;
	const slashPts = slashes * SLASH_PENALTY;
	const score = round1(clamp(reputationPts + completionPts + vouchPts - slashPts, 0, 100));

	const graded = verified > 0 || vouch.counted > 0 || slashes > 0;
	const band = GRADE_BANDS.find((b) => score >= b.min) || GRADE_BANDS[GRADE_BANDS.length - 1];

	return {
		grade: graded ? band.grade : null,
		label: graded ? band.label : 'Ungraded',
		score,
		graded,
		components: {
			reputation: round1(reputationPts),
			completions: round1(completionPts),
			vouches: round1(vouchPts),
			slashes: -round1(slashPts),
		},
		inputs: {
			reputation,
			verifiedCompletions: verified,
			attemptedTasks: attempted,
			completionRatio: round1(ratio * 100) / 100,
			slashes,
			vouchesReceived: (input.vouches || []).length,
			vouchesCounted: vouch.counted,
			vouchesIgnored: vouch.ignored,
			vouchWeight: round1(vouch.total * 100) / 100,
		},
	};
}

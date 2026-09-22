// Worker verification levels for human tasks.
//
// A task names the minimum level a worker needs to accept it. Levels are
// derived from facts the platform already proved, never from a self-declared
// flag, and are recomputed at accept time:
//
//   0  account     signed in, with a Solana wallet linked by signature (SIWS).
//                  Every worker needs this: escrow pays that wallet.
//   1  verified    level 0 plus a verified email address.
//   2  trusted     level 1 plus a track record here: TRUSTED_MIN_PAID paid
//                  tasks and an average poster rating of TRUSTED_MIN_RATING.
//
// The default minimum scales with the bounty so a large payout is only
// claimable by someone with something to lose.

import { sql } from '../db.js';

export const LEVELS = Object.freeze([
	{ level: 0, id: 'account', label: 'Account', summary: 'Signed in with a linked Solana wallet.' },
	{ level: 1, id: 'verified', label: 'Verified', summary: 'Linked wallet and a verified email address.' },
	{ level: 2, id: 'trusted', label: 'Trusted', summary: 'Verified, with at least 3 paid tasks and a 4.0 average rating.' },
]);

export const TRUSTED_MIN_PAID = 3;
export const TRUSTED_MIN_RATING = 4.0;

// Bounty thresholds (USDC atomics) for the default minimum level.
const VERIFIED_FROM_ATOMICS = 25_000_000n;
const TRUSTED_FROM_ATOMICS = 100_000_000n;

/** The default minimum verification level for a bounty. */
export function defaultLevelForBounty(bountyAtomics) {
	const b = BigInt(String(bountyAtomics));
	if (b >= TRUSTED_FROM_ATOMICS) return 2;
	if (b >= VERIFIED_FROM_ATOMICS) return 1;
	return 0;
}

export function levelInfo(level) {
	return LEVELS[Math.max(0, Math.min(2, Number(level) || 0))];
}

/** Pure: the level a set of facts earns. */
export function computeLevel({ solanaWallets = 0, emailVerified = false, paidTasks = 0, avgRating = null }) {
	if (solanaWallets < 1) return -1;
	if (!emailVerified) return 0;
	if (paidTasks >= TRUSTED_MIN_PAID && avgRating != null && avgRating >= TRUSTED_MIN_RATING) return 2;
	return 1;
}

/** The facts behind a user's level, plus the level and their payout wallets. */
export async function workerStanding(userId) {
	const [user] = await sql`
		SELECT id, email_verified, display_name FROM users WHERE id = ${userId} AND deleted_at IS NULL
	`;
	if (!user) return null;
	const wallets = await sql`
		SELECT address, is_primary FROM user_wallets
		WHERE user_id = ${userId} AND chain_type = 'solana'
		ORDER BY is_primary DESC, created_at ASC
	`;
	const [track] = await sql`
		SELECT
			(SELECT count(*)::int FROM human_task_claims c JOIN human_tasks t ON t.id = c.task_id
			  WHERE c.worker_user_id = ${userId} AND t.status = 'paid' AND t.accepted_claim_id = c.id) AS paid,
			(SELECT avg(rating)::float FROM human_task_reviews WHERE subject_user_id = ${userId} AND reviewer_role = 'poster') AS avg_rating,
			(SELECT count(*)::int FROM human_task_reviews WHERE subject_user_id = ${userId} AND reviewer_role = 'poster') AS ratings
	`;
	const facts = {
		solanaWallets: wallets.length,
		emailVerified: Boolean(user.email_verified),
		paidTasks: track?.paid || 0,
		avgRating: track?.avg_rating ?? null,
	};
	const level = computeLevel(facts);
	return {
		level,
		level_label: level < 0 ? 'No linked wallet' : levelInfo(level).label,
		email_verified: facts.emailVerified,
		paid_tasks: facts.paidTasks,
		avg_rating: facts.avgRating != null ? Math.round(facts.avgRating * 100) / 100 : null,
		ratings: track?.ratings || 0,
		wallets: wallets.map((w) => ({ address: w.address, primary: Boolean(w.is_primary) })),
		next_step: nextStep(level, facts),
	};
}

function nextStep(level, facts) {
	if (level < 0) return { action: 'link_wallet', message: 'Link a Solana wallet to your account so escrow can pay you.' };
	if (level === 0) return { action: 'verify_email', message: 'Verify your email address to unlock Verified tasks.' };
	if (level === 1) {
		const need = Math.max(0, TRUSTED_MIN_PAID - facts.paidTasks);
		return {
			action: 'build_record',
			message: need > 0
				? `Complete ${need} more paid task${need === 1 ? '' : 's'} with a ${TRUSTED_MIN_RATING.toFixed(1)}+ average rating to reach Trusted.`
				: `Raise your average rating to ${TRUSTED_MIN_RATING.toFixed(1)} to reach Trusted.`,
		};
	}
	return null;
}

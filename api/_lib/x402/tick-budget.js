// Time budget for one x402-autonomous-loop tick. wrapCron answers 503
// cron_timeout at 120s, but the loop walks up to ~15 entries sequentially and
// one paid call is a probe + pay + optional challenge-refresh reprobe, each
// capped at 20s. A call started late in a slow tick (RPC lanes cooling, a forge
// call at 77s) therefore carried the whole tick past the budget and the
// scheduler logged a 5xx for work that was otherwise healthy.
//
// Stop STARTING calls once the cutoff passes; entries not reached stay ready
// and are picked up by the next tick (cooldowns are only set after a call).

/** Worst case for one entry: three 20s fetches (probe, pay, refresh reprobe). */
export const WORST_CASE_CALL_MS = 60_000;

/** Latest elapsed time at which a new call may still start (120s budget). */
export const TICK_START_CUTOFF_MS = 120_000 - WORST_CASE_CALL_MS;

/**
 * @param {number} startedAt ms epoch the tick began
 * @param {number} [now] ms epoch
 * @returns {boolean} true when no further entry may be started
 */
export function tickBudgetSpent(startedAt, now = Date.now()) {
	return now - startedAt >= TICK_START_CUTOFF_MS;
}

// A run() entry can outlive the tick that started it, and its cooldown is only
// written when it finishes, so the next minute's tick would otherwise start it
// again on top of itself (paid pipelines paying twice, Ring Reconciliation
// overlapping its own runs). The lease is the guard; it expires on its own so an
// instance killed mid-run cannot wedge an entry.
const ENTRY_RUN_PREFIX = 'x402:autonomous:running:';

/** Longest an entry stays claimed if its instance dies before releasing it. */
export const ENTRY_RUN_LEASE_S = 600;

/**
 * Claim an entry for this tick. Redis being absent or failing never stops the
 * ring: the cooldown path degrades the same way.
 * @param {any} redis
 * @param {{ id: string }} entry
 * @returns {Promise<boolean>} false only when another tick holds the entry
 */
export async function claimEntryRun(redis, entry) {
	if (!redis) return true;
	try {
		const claimed = await redis.set(`${ENTRY_RUN_PREFIX}${entry.id}`, '1', { nx: true, ex: ENTRY_RUN_LEASE_S });
		return claimed !== null;
	} catch {
		return true;
	}
}

/**
 * @param {any} redis
 * @param {{ id: string }} entry
 */
export async function releaseEntryRun(redis, entry) {
	if (!redis) return;
	try {
		await redis.del(`${ENTRY_RUN_PREFIX}${entry.id}`);
	} catch {
		// The lease expires on its own.
	}
}

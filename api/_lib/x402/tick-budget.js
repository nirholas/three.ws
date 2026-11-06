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

/**
 * May this account spend another home agent turn, and if not, what is refused.
 *
 * The chat lane is where an agent turn is actually spent, and `api/chat.js` is
 * a large file about routing models rather than about billing. This module
 * holds the entitlement half so it can be reasoned about, and tested, on its
 * own.
 *
 * The one rule that shapes everything here is commitment 1 from
 * `api/_lib/home/entitlements.js`: a limit never blocks a safety action. Over
 * quota, an agent asked to lock up, close a garage or a valve, or arm an alarm
 * still does it. Two things make that true rather than merely stated:
 *
 *   * the exemption is checked per call, not per round, so one refused call in
 *     a round cannot take a safe one down with it, and
 *   * read-only tools are never gated at all (see `isGatedHomeTool`).
 */

import { HOME_TOOLS_BY_NAME } from './tools.js';
import {
	assertWithinLimit,
	HomeQuotaError,
	isQuotaExempt,
	quotaPeriod,
	resolveHomeEntitlementsForUser,
} from './entitlements.js';
import { readUsage } from './usage.js';

/**
 * Which home tools a monthly turn quota may refuse.
 *
 * Read-only tools are never gated, and that is a deliberate product decision
 * rather than an oversight. Commitment 1 says a limit never blocks a safety
 * action, and in an agent lane that promise is only real if the agent can still
 * find the door: the model reads the house with `home_status` and then targets
 * the lock. Gate the read and the exemption survives in a unit test and nowhere
 * else, because the conversation a person is actually having ends one step
 * earlier. A read also spends nothing the turn had not already spent by the
 * time the model emitted the call.
 *
 * @param {string} name
 * @returns {boolean}
 */
export function isGatedHomeTool(name) {
	return HOME_TOOLS_BY_NAME[name]?.readOnly !== true;
}

/**
 * The shape `isQuotaExempt` reads, from a chat tool call.
 *
 * `home_call` carries the domain and the service on its input, which is exactly
 * what the safety classifier wants, so a lock, a close or an arm is recognised
 * with no live entity list and therefore in precisely the degraded states where
 * somebody most needs to lock up.
 *
 * @param {{ name: string, input?: object }} call
 * @returns {object}
 */
export function homeCallShape(call) {
	const input = call?.input || {};
	if (call?.name === 'home_call') {
		return { domain: input.domain, service: input.service, attributes: input.data || {} };
	}
	return { tool: call?.name, arguments: input, entities: [] };
}

/**
 * Resolve the account's agent-turn standing once, for a whole round.
 *
 * FAILS OPEN. An unreadable entitlement row or an unreachable usage counter
 * resolves to "allowed", never to "refused". Refusing a person access to their
 * own house because a billing read hiccuped is the failure this lane is least
 * willing to ship, and it is the same bias `usage.js` already takes on a cold
 * cache: a quota that errs must err toward serving the user.
 *
 * @param {string} userId
 * @param {object} [deps] injection seam for tests; production passes nothing
 * @returns {Promise<{ allowed: boolean, error: HomeQuotaError|null }>}
 */
export async function homeTurnGate(userId, deps = {}) {
	const resolve = deps.resolveHomeEntitlementsForUser || resolveHomeEntitlementsForUser;
	const read = deps.readUsage || readUsage;
	try {
		const [entitlements, used] = await Promise.all([resolve(userId), read(userId, 'agentTurns')]);
		assertWithinLimit({
			entitlements,
			dimension: 'agentTurns',
			used,
			resetAt: quotaPeriod().endIso,
		});
		return { allowed: true, error: null };
	} catch (err) {
		if (err instanceof HomeQuotaError) return { allowed: false, error: err };
		deps.onError?.(err);
		return { allowed: true, error: null };
	}
}

/**
 * Should this one call be refused, given the round's verdict?
 *
 * The safety exemption is consulted here and only here, so no call site can
 * apply a quota verdict without it.
 *
 * @param {{ allowed: boolean }} gate
 * @param {{ name: string, input?: object }} call
 * @returns {boolean}
 */
export function shouldRefuseHomeCall(gate, call) {
	if (gate?.allowed) return false;
	if (!isGatedHomeTool(call?.name)) return false;
	return !isQuotaExempt(homeCallShape(call));
}

/**
 * The refusal the model speaks. A tool result the agent can turn into a
 * sentence, never a bare error and never a 500.
 *
 * @param {HomeQuotaError} err
 * @returns {object}
 */
export function quotaRefusalResult(err) {
	return {
		ok: false,
		kind: 'error',
		code: 'quota_exceeded',
		text: err.message,
		structured: {
			error: 'quota_exceeded',
			dimension: err.dimension,
			limit: err.limit,
			used: err.used,
			resets_at: err.resetAt,
			upgrade: err.upgradePath,
		},
	};
}

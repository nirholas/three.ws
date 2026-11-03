/**
 * Abuse limits for forge-in-world submissions (POST /api/forge with a `world`).
 *
 * The free draft lane already has per-IP ceilings. In a shared world that is not
 * enough: a room full of players behind one NAT shares an IP, and a crowded room
 * can still queue a generation per player at once. So an in-world submit is also
 * held to:
 *
 *   player cooldown   one generation per FORGE_WORLD_PLAYER_COOLDOWN_S per player
 *                     (signed-in user when there is a session, else the forge
 *                     client id), and
 *   world slots       at most FORGE_WORLD_SLOTS admissions per world per
 *                     FORGE_WORLD_SLOT_WINDOW_S, the lifetime of one draft job, so
 *                     it bounds how many generations a world has in flight.
 *
 * The world cap is a windowed admission count rather than a live in-flight
 * counter: a job-completion hook would need shared state released from the poll
 * path, and a crashed client would strand its slot. The window expires on its own.
 *
 * A refusal carries `scope` ('player' | 'world') and the limiter's reset so the
 * client can say "wait N s" from the response. A world refusal hands the player's
 * cooldown hit back: being turned away must not start a cooldown.
 */

import { limits, refundLimit, FORGE_WORLD_PLAYER_BUCKET } from './rate-limit.js';

// World ids are produced by worldIdForCoin (mint plus tier); keep the charset tight.
const WORLD_ID_RE = /^[A-Za-z0-9:_.-]{1,120}$/;

/** @returns {string|null} the validated world id; '' when the request is not in-world; null when malformed */
export function parseWorldId(body) {
	if (body?.world === undefined || body?.world === null || body?.world === '') return '';
	return typeof body.world === 'string' && WORLD_ID_RE.test(body.world) ? body.world : null;
}

/**
 * @param {{worldId: string, playerKey: string}} args
 * @returns {Promise<{ok: true} | {ok: false, scope: 'player'|'world', result: object}>}
 */
export async function admitWorldForge({ worldId, playerKey }) {
	const player = await limits.forgeWorldPlayer(playerKey);
	if (!player.success) return { ok: false, scope: 'player', result: player };

	const slot = await limits.forgeWorldSlots(worldId);
	if (!slot.success) {
		await refundLimit(...FORGE_WORLD_PLAYER_BUCKET, playerKey).catch(() => {});
		return { ok: false, scope: 'world', result: slot };
	}
	return { ok: true };
}

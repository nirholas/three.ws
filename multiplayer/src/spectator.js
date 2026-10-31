// Spectator seats for the walk_world room (venue projector / director mode).
//
// A spectator is a socket that watches the room and nothing else: no Player on
// the schema (so nobody else is ever sent an avatar for it), no economy profile,
// no minigame or crowd bookkeeping, no persisted anything. It still takes a
// Colyseus client slot, so the number of seats is capped per room.
//
// The flag is a join option the client asks for. It cannot be abused for
// anything but watching, because a spectator's messages are dropped at the
// door (see guardSpectatorMessages) and the room never creates state for it.

export const MAX_SPECTATORS_PER_ROOM = 8;

/** True when a join option asks for a spectator seat. Strict: only boolean true. */
export function wantsSpectator(options) {
	return options?.spectator === true;
}

/** True when this client holds a spectator seat. */
export function isSpectator(client) {
	return client?.userData?.spectator === true;
}

/** How many of the given clients hold a spectator seat. */
export function countSpectators(clients) {
	let n = 0;
	for (const c of clients || []) if (isSpectator(c)) n++;
	return n;
}

/**
 * Decide a spectator join in onAuth. Returns the userData to merge when seated;
 * throws `spectator_limit` when the room's spectator seats are full.
 *
 * A reconnecting projector names the session it is replacing (`prevSession`). That
 * zombie socket would otherwise hold a seat until its ping times out, so a screen
 * on a flaky link could fill the room's seats with its own ghosts. Only another
 * spectator's id is honored: spectator ids are never sent to peers, so a player
 * cannot learn one to kick someone's screen.
 */
export function seatSpectator(clients, max = MAX_SPECTATORS_PER_ROOM, prevSession = null) {
	if (typeof prevSession === 'string' && prevSession) {
		for (const c of clients || []) {
			if (c.sessionId === prevSession && isSpectator(c)) {
				try { c.leave(1000); } catch { /* socket already gone */ }
				break;
			}
		}
	}
	let held = 0;
	for (const c of clients || []) if (isSpectator(c) && c.sessionId !== prevSession) held++;
	if (held >= max) throw new Error('spectator_limit');
	return { spectator: true };
}

/**
 * Wrap room.onMessage so every handler registered afterwards ignores spectators.
 * One choke point instead of a guard in every handler: a spectator can send
 * nothing the room acts on, including handlers other features add later.
 */
export function guardSpectatorMessages(room) {
	const register = room.onMessage.bind(room);
	room.onMessage = (type, handler) =>
		register(type, (client, ...rest) => {
			if (isSpectator(client)) return undefined;
			return handler(client, ...rest);
		});
}

/** Publish the spectator head-count on the room listing so /population can leave them out. */
export function publishSpectatorCount(room, leaving = null) {
	if (typeof room.setMetadata !== 'function') return;
	const spectators = countSpectators(Array.from(room.clients || []).filter((c) => c !== leaving));
	Promise.resolve(room.setMetadata({ spectators })).catch((err) => {
		console.warn('[walk_world] spectator count metadata failed:', err?.message || err);
	});
}

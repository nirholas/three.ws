// What a Forge generation is FOR. One list, used by the composer chips, the
// request validator, and the funnel report, so the three can never disagree on
// what a valid answer is.
//
// The ids are stored verbatim in forge_creations.destination, so they are a
// wire format: add to this list freely, but never rename or reuse an id.
//
// `play` is a real answer, not a missing one. Someone exploring has a different
// bar for "accepted" than someone shipping a game asset, and folding the two
// together is exactly what made the acceptance rate unreadable before.

export const FORGE_DESTINATIONS = Object.freeze([
	Object.freeze({ id: 'game', label: 'Game', hint: 'Unity, Unreal, Godot, a web game' }),
	Object.freeze({ id: 'web', label: 'Web', hint: 'A site, a product page, a 3D embed' }),
	Object.freeze({ id: 'avatar', label: 'Avatar', hint: 'A character to rig and animate' }),
	Object.freeze({ id: 'simulation', label: 'Simulation', hint: 'Robotics, physics, synthetic data' }),
	Object.freeze({ id: 'print', label: 'Print', hint: 'A physical 3D print' }),
	Object.freeze({ id: 'ar', label: 'AR', hint: 'Placing it in a real room' }),
	Object.freeze({ id: 'play', label: 'Just playing', hint: 'Exploring what it can do' }),
]);

const IDS = new Set(FORGE_DESTINATIONS.map((d) => d.id));

/**
 * Normalize a caller-supplied destination to a stored id, or null when it is
 * absent or not one of ours. Case and surrounding whitespace are forgiven so an
 * API caller sending "Game" is not silently dropped.
 * @param {unknown} value
 * @returns {string|null}
 */
export function validForgeDestination(value) {
	if (typeof value !== 'string') return null;
	const id = value.trim().toLowerCase();
	return IDS.has(id) ? id : null;
}

/** Display label for a stored id; the id itself when it is unknown to this build. */
export function forgeDestinationLabel(id) {
	return FORGE_DESTINATIONS.find((d) => d.id === id)?.label ?? String(id ?? '');
}

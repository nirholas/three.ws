// The campus map: where every place stands, what it opens, and how the player
// is spawned. Pure data so tests can check that every destination is a real
// desktop app or page and that nothing overlaps.

/** Walkable radius of the campus, in metres. */
export const CAMPUS_RADIUS = 46;

/** The visitor arrives at the gate, facing the office. */
export const SPAWN = { x: 0, z: 30, yaw: Math.PI };

/** Distance at which a place arms its prompt. */
export const PLACE_TRIGGER = 4.6;
/**
 * Distance at which a desk object arms its prompt. The monitor uses this full
 * reach because the desk's keep-out disc stops the player about 1.5 m short of
 * it; the phone and headset use SIDE_OBJECT_TRIGGER, so they only take the
 * prompt once the player has stepped round to their side of the desk and the
 * monitor never loses "Sit down" to a phone that happens to be a hair closer.
 */
export const OBJECT_TRIGGER = 2.2;
export const SIDE_OBJECT_TRIGGER = 1.2;

/**
 * Places. `kind` decides what interacting does:
 *   app     open that desktop app (and sit at the desk)
 *   mine    in-world gem mining, no desktop needed
 *   office  the home office (the desk objects live here)
 */
export const PLACES = [
	{
		id: 'office',
		kind: 'office',
		title: 'Your workstation',
		sub: 'Sit down to open the desktop',
		x: 0,
		z: 8,
		hue: 262,
		keepout: 0,
	},
	{
		id: 'exchange',
		kind: 'app',
		app: 'trenches',
		title: 'three.ws Exchange',
		sub: 'Live Solana launches, runners and smart money',
		x: -24,
		z: -6,
		hue: 128,
		keepout: 7.5,
	},
	{
		id: 'launchpad',
		kind: 'app',
		app: 'launcher',
		title: 'Launchpad',
		sub: 'Launch a coin on pump.fun',
		x: 24,
		z: -6,
		hue: 24,
		keepout: 5.5,
	},
	{
		id: 'mine',
		kind: 'mine',
		title: 'The Mine',
		sub: 'Hold E at a vein to dig for gems',
		x: 0,
		z: -30,
		hue: 262,
		keepout: 0,
	},
	{
		id: 'forge',
		kind: 'app',
		app: 'forge',
		title: 'The Forge',
		sub: 'Type a prompt, get a textured 3D model',
		x: -14,
		z: -24,
		hue: 24,
		keepout: 4.2,
	},
	{
		id: 'gallery',
		kind: 'app',
		app: 'gallery',
		title: 'Gallery',
		sub: 'Every public 3D avatar',
		x: 14,
		z: -24,
		hue: 180,
		keepout: 4.2,
	},
	{
		id: 'agents',
		kind: 'app',
		app: 'discover',
		title: 'Agent Plaza',
		sub: 'Browse every registered agent',
		x: -22,
		z: 16,
		hue: 200,
		keepout: 4.2,
	},
	{
		id: 'market',
		kind: 'app',
		app: 'marketplace',
		title: 'Marketplace',
		sub: 'Buy and sell agent skills',
		x: 22,
		z: 16,
		hue: 44,
		keepout: 4.2,
	},
];

/** Mining veins inside the mine. Ids must match api/_lib/world-gems.js NODES. */
export const VEINS = [
	{ id: 'vein-a', dx: -3.6, dz: -1.2 },
	{ id: 'vein-b', dx: -1.4, dz: -3.4 },
	{ id: 'vein-c', dx: 1.4, dz: -3.4 },
	{ id: 'vein-d', dx: 3.6, dz: -1.2 },
	{ id: 'vein-e', dx: 0, dz: -5.2 },
];

/** Objects on the desk, relative to the office origin. */
export const DESK_OBJECTS = [
	{ id: 'monitor', title: 'Sit down', sub: 'Open the desktop', dx: 0, dz: -0.65, trigger: OBJECT_TRIGGER },
	{ id: 'phone', title: 'Pick up the phone', sub: 'Pocket, your handheld agent console', dx: 0.78, dz: -0.42, trigger: SIDE_OBJECT_TRIGGER },
	{ id: 'headset', title: 'Put on the headset', sub: 'Enter the world in VR', dx: -0.8, dz: -0.42, trigger: SIDE_OBJECT_TRIGGER },
];

export function placeById(id) {
	return PLACES.find((p) => p.id === id) || null;
}

/** Squared planar distance helper shared by the proximity checks. */
export function dist2(ax, az, bx, bz) {
	const dx = ax - bx;
	const dz = az - bz;
	return dx * dx + dz * dz;
}

/**
 * The nearest interactable to the player: a desk object when inside the
 * office, otherwise the nearest place within its trigger distance.
 * @returns {{ type: 'object'|'place'|'vein', id: string, title: string, sub: string, d: number } | null}
 */
export function nearestInteractable(px, pz, { veinPositions = [] } = {}) {
	let best = null;
	const office = placeById('office');
	for (const o of DESK_OBJECTS) {
		const d = Math.sqrt(dist2(px, pz, office.x + o.dx, office.z + o.dz));
		if (d < o.trigger && (!best || d < best.d)) best = { type: 'object', id: o.id, title: o.title, sub: o.sub, d };
	}
	if (best) return best;
	for (const v of veinPositions) {
		const d = Math.sqrt(dist2(px, pz, v.x, v.z));
		if (d < OBJECT_TRIGGER + 0.4 && (!best || d < best.d)) best = { type: 'vein', id: v.id, title: 'Dig here', sub: 'Hold E to mine', d };
	}
	if (best) return best;
	for (const p of PLACES) {
		if (p.kind === 'office' || p.kind === 'mine') continue;
		const d = Math.sqrt(dist2(px, pz, p.x, p.z));
		if (d < PLACE_TRIGGER + p.keepout && (!best || d < best.d)) best = { type: 'place', id: p.id, title: `Enter ${p.title}`, sub: p.sub, d };
	}
	return best;
}

/** Yaw that turns a building's front toward the campus centre (the office). */
export function facingOf(place) {
	return Math.atan2(-place.x, -place.z);
}

/**
 * Where a player stands when arriving at (or stepping back out of) a place:
 * just outside its keep-out on the side that faces the campus centre, so the
 * building is in front of them and the office behind.
 */
export function standPointFor(place) {
	const a = facingOf(place);
	const r = (place.keepout || 0) + 2.4;
	return { x: place.x + Math.sin(a) * r, z: place.z + Math.cos(a) * r, yaw: a + Math.PI };
}

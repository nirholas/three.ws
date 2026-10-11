// Real objects for the campus: the furniture, lamps, plants and tools that
// make a room a room. Every model is a CC0 scan from the platform's own
// object library (the same CDN src/objects-library.js serves), measured once
// so this file can place them without loading anything. Pure data and
// placement maths; campus.js does the loading.
//
// Positions are room-local (see rooms.js: +z is the front/door side, +x the
// right hand side seen from the front) unless `world: true`. `anchor: 'floor'`
// drops the model's bounding box onto y; 'origin' keeps the file's own origin
// (ceiling lamps hang from theirs, the rock set is modelled part-buried).

import { CAMPUS_RADIUS, placeById } from './places.js';
import { roomById, roomToWorld } from './rooms.js';

export const LIBRARY_BASE = 'https://pub-2534e921bf9c4314addcd4d8a6e98b7b.r2.dev/objects/polyhaven/glb';
export const LIBRARY_LICENSE = 'CC0';

/** Payload budgets in bytes: a desktop on a decent line, and a phone. */
export const PROP_BUDGET = { desktop: 58 * 1048576, mobile: 16 * 1048576 };

/** Measured bounding boxes (metres) and compressed sizes of every model used. */
export const MODELS = {
	street_lamp_01: { bytes: 2471216, w: 0.7, h: 3.87, d: 0.39 },
	painted_wooden_bench: { bytes: 1988580, w: 1.16, h: 0.89, d: 0.5 },
	outdoor_table_chair_set_01: { bytes: 1239772, w: 0.74, h: 0.86, d: 1.72 },
	planter_box_01: { bytes: 2338392, w: 0.91, h: 0.42, d: 0.41 },
	shrub_02: { bytes: 1962912, w: 6.05, h: 1.7, d: 2.29 },
	grass_medium_02: { bytes: 797444, w: 1.31, h: 0.41, d: 0.43 },
	fern_02: { bytes: 1143468, w: 1.97, h: 0.43, d: 1.72 },
	quiver_tree_02: { bytes: 4546840, w: 0.87, h: 1.47, d: 0.88 },
	rock_moss_set_01: { bytes: 1932784, w: 8, h: 1.77, d: 6.95 },
	metal_office_desk: { bytes: 1600260, w: 2.0, h: 0.79, d: 0.95 },
	modern_arm_chair_01: { bytes: 2696080, w: 0.82, h: 1.02, d: 0.99 },
	classic_laptop: { bytes: 2180780, w: 0.65, h: 0.54, d: 0.49 },
	potted_plant_02: { bytes: 2632148, w: 0.7, h: 0.84, d: 0.66 },
	steel_frame_shelves_01: { bytes: 1596392, w: 10.97, h: 21.41, d: 5.02 },
	wall_clock: { bytes: 1560784, w: 0.32, h: 0.32, d: 0.06 },
	hanging_picture_frame_01: { bytes: 483412, w: 0.59, h: 0.84, d: 0.04 },
	hanging_picture_frame_02: { bytes: 693508, w: 0.75, h: 0.5, d: 0.04 },
	fancy_picture_frame_01: { bytes: 739640, w: 0.6, h: 0.46, d: 0.05 },
	modern_ceiling_lamp_01: { bytes: 433412, w: 0.4, h: 0.95, d: 0.4 },
	sofa_03: { bytes: 818108, w: 2.73, h: 1.12, d: 0.93 },
	sofa_02: { bytes: 425576, w: 1.81, h: 0.71, d: 0.82 },
	modern_coffee_table_01: { bytes: 1330320, w: 0.6, h: 0.39, d: 1.2 },
	side_table_01: { bytes: 504336, w: 0.55, h: 0.55, d: 0.45 },
	drawer_cabinet: { bytes: 1140032, w: 1.14, h: 1.88, d: 0.49 },
	dining_chair_02: { bytes: 920128, w: 0.43, h: 0.97, d: 0.58 },
	hanging_industrial_lamp: { bytes: 3241308, w: 0.55, h: 1.36, d: 0.55 },
	old_drill_press: { bytes: 2350984, w: 0.53, h: 1.05, d: 0.61 },
	wooden_crate_01: { bytes: 2274660, w: 0.83, h: 0.35, d: 0.41 },
	wooden_stool_01: { bytes: 960764, w: 0.43, h: 0.44, d: 0.43 },
	steel_frame_shelves_02: { bytes: 539296, w: 0.59, h: 2.14, d: 0.5 },
	CoffeeCart_01: { bytes: 1832980, w: 2.17, h: 1.72, d: 1.07 },
	standing_chalkboard_01: { bytes: 2615284, w: 0.92, h: 1.51, d: 0.76 },
	SchoolDesk_01: { bytes: 420696, w: 0.71, h: 0.88, d: 0.55 },
};

export function propUrl(model) {
	return `${LIBRARY_BASE}/${model}.glb`;
}

const PI = Math.PI;
const half = PI / 2;

/**
 * Where everything stands. `room` places in that room's frame; `place` in the
 * place's own frame (its front toward the campus centre); `world` in world
 * space. `solid` adds collision: a radius, or {w, d} for a box of that size.
 * `mobile: true` keeps the prop on phones.
 */
export const PROPS = [
	// Office: a real desk the built-in monitor and phone sit on, somewhere to sit and a shelf of things.
	{ model: 'metal_office_desk', room: 'office', x: 0, z: -0.5, yaw: 0, mobile: true },
	{ model: 'modern_arm_chair_01', room: 'office', x: 0, z: 0.6, yaw: PI, mobile: true },
	{ model: 'steel_frame_shelves_01', room: 'office', x: -3.2, z: -3.05, yaw: 0, scale: 0.1, solid: { w: 1.1, d: 0.5 } },
	{ model: 'drawer_cabinet', room: 'office', x: 3.2, z: -3.05, yaw: 0, solid: { w: 1.14, d: 0.5 } },
	{ model: 'wall_clock', room: 'office', x: 2.2, z: -3.3, y: 2.2, yaw: 0, anchor: 'origin' },
	{ model: 'hanging_picture_frame_01', room: 'office', x: -4.33, z: -1.4, y: 1.7, yaw: half, anchor: 'origin', mobile: true },
	{ model: 'sofa_03', room: 'office', x: -3.85, z: 1.0, yaw: half, solid: { w: 1, d: 2.8 }, mobile: true },
	{ model: 'modern_coffee_table_01', room: 'office', x: -2.9, z: 1.0, yaw: 0, solid: 0.5, mobile: true },
	{ model: 'classic_laptop', room: 'office', x: -2.9, z: 1.0, y: 0.39, yaw: -half },
	{ model: 'potted_plant_02', room: 'office', x: 3.7, z: 2.6, yaw: 0, solid: 0.4 },
	{ model: 'modern_ceiling_lamp_01', room: 'office', x: 0, z: 0.8, y: 1.8, anchor: 'origin', mobile: true },

	// Exchange: four trading desks, lamps over the floor, clocks for three markets.
	{ model: 'metal_office_desk', room: 'exchange', x: -3.4, z: -1.6, yaw: 0, solid: { w: 2, d: 1 }, mobile: true },
	{ model: 'metal_office_desk', room: 'exchange', x: 3.4, z: -1.6, yaw: 0, solid: { w: 2, d: 1 }, mobile: true },
	{ model: 'metal_office_desk', room: 'exchange', x: -3.4, z: 1.6, yaw: PI, solid: { w: 2, d: 1 } },
	{ model: 'metal_office_desk', room: 'exchange', x: 3.4, z: 1.6, yaw: PI, solid: { w: 2, d: 1 } },
	{ model: 'dining_chair_02', room: 'exchange', x: -3.4, z: -0.75, yaw: PI, mobile: true },
	{ model: 'dining_chair_02', room: 'exchange', x: 3.4, z: -0.75, yaw: PI, mobile: true },
	{ model: 'dining_chair_02', room: 'exchange', x: -3.4, z: 0.75, yaw: 0 },
	{ model: 'dining_chair_02', room: 'exchange', x: 3.4, z: 0.75, yaw: 0 },
	{ model: 'classic_laptop', room: 'exchange', x: -3.4, z: -1.6, y: 0.79, yaw: 0 },
	{ model: 'classic_laptop', room: 'exchange', x: 3.4, z: -1.6, y: 0.79, yaw: 0 },
	{ model: 'classic_laptop', room: 'exchange', x: -3.4, z: 1.6, y: 0.79, yaw: PI },
	{ model: 'classic_laptop', room: 'exchange', x: 3.4, z: 1.6, y: 0.79, yaw: PI },
	{ model: 'hanging_industrial_lamp', room: 'exchange', x: -3.4, z: 0, y: 5.2, anchor: 'origin' },
	{ model: 'hanging_industrial_lamp', room: 'exchange', x: 0, z: 0, y: 5.2, anchor: 'origin' },
	{ model: 'hanging_industrial_lamp', room: 'exchange', x: 3.4, z: 0, y: 5.2, anchor: 'origin' },
	{ model: 'wall_clock', room: 'exchange', x: -2.4, z: -4.3, y: 3.6, yaw: 0, anchor: 'origin' },
	{ model: 'wall_clock', room: 'exchange', x: 0, z: -4.3, y: 3.6, yaw: 0, anchor: 'origin' },
	{ model: 'wall_clock', room: 'exchange', x: 2.4, z: -4.3, y: 3.6, yaw: 0, anchor: 'origin' },
	{ model: 'potted_plant_02', room: 'exchange', x: -5.6, z: 3.6, yaw: 0, solid: 0.4 },
	{ model: 'potted_plant_02', room: 'exchange', x: 5.6, z: 3.6, yaw: 0, solid: 0.4 },

	// Launch pad: the control cabin's desk, and crates of parts by the pad.
	{ model: 'SchoolDesk_01', room: 'cabin', x: 0, z: -0.7, yaw: 0, mobile: true },
	{ model: 'classic_laptop', room: 'cabin', x: 0, z: -0.7, y: 0.74, yaw: 0 },
	{ model: 'dining_chair_02', room: 'cabin', x: 0, z: 0.1, yaw: PI },
	{ model: 'wooden_crate_01', place: 'launchpad', x: 3.2, z: 3.2, yaw: 0.4, solid: 0.5 },
	{ model: 'wooden_crate_01', place: 'launchpad', x: 3.6, z: 2.5, yaw: -0.3 },
	{ model: 'street_lamp_01', place: 'launchpad', x: -5.8, z: 5.6, yaw: 0, solid: 0.3, mobile: true },
	{ model: 'street_lamp_01', place: 'launchpad', x: 5.8, z: 5.6, yaw: 0, solid: 0.3, mobile: true },

	// Mine: crates by the portal, a lamp over the face, mossy rock at the hill's foot.
	{ model: 'wooden_crate_01', room: 'mine', x: -5.6, z: 3.2, yaw: 0.2, solid: 0.5 },
	{ model: 'wooden_crate_01', room: 'mine', x: -4.9, z: 3.5, yaw: -0.4 },
	{ model: 'hanging_industrial_lamp', room: 'mine', x: 0, z: -2, y: 4.5, anchor: 'origin' },
	{ model: 'hanging_industrial_lamp', room: 'mine', x: -4, z: 1, y: 4.5, anchor: 'origin' },
	{ model: 'hanging_industrial_lamp', room: 'mine', x: 4, z: 1, y: 4.5, anchor: 'origin' },
	{ model: 'rock_moss_set_01', place: 'mine', x: -11.5, z: 5, yaw: 0.6, anchor: 'origin' },
	{ model: 'rock_moss_set_01', place: 'mine', x: 11.5, z: 5, yaw: -2.4, anchor: 'origin' },

	// Forge: the drill press, shelves of parts, a stool and a lamp over the bench.
	{ model: 'old_drill_press', room: 'forge', x: -2.4, z: -2.2, yaw: 0, solid: 0.45 },
	{ model: 'steel_frame_shelves_02', room: 'forge', x: 2.8, z: -0.4, yaw: -half, solid: { w: 0.6, d: 2.2 } },
	{ model: 'wooden_crate_01', room: 'forge', x: 2.5, z: 1.8, yaw: 0.3, solid: 0.5 },
	{ model: 'wooden_stool_01', room: 'forge', x: -0.6, z: -1.3, yaw: 0.5 },
	{ model: 'hanging_industrial_lamp', room: 'forge', x: 0, z: -1, y: 3.4, anchor: 'origin' },

	// Gallery: frames go up through campus.hangArt; a bench to sit and look.
	{ model: 'sofa_02', room: 'gallery', x: 0, z: 0.3, yaw: PI, solid: { w: 1.9, d: 0.9 }, mobile: true },
	{ model: 'potted_plant_02', room: 'gallery', x: -2.6, z: 2.5, yaw: 0, solid: 0.4 },
	{ model: 'potted_plant_02', room: 'gallery', x: 2.6, z: 2.5, yaw: 0, solid: 0.4 },

	// Market: a coffee cart, the chalkboard menu, crates of stock and bistro tables outside.
	{ model: 'CoffeeCart_01', room: 'market', x: -2.6, z: -1.8, yaw: 0, solid: { w: 2.2, d: 1.1 } },
	{ model: 'standing_chalkboard_01', room: 'market', x: -0.9, z: -1.6, yaw: 0.3, solid: 0.5 },
	{ model: 'wooden_crate_01', room: 'market', x: 3.6, z: 2.6, yaw: 0.2, solid: 0.5 },
	{ model: 'wooden_crate_01', room: 'market', x: 4.1, z: 2.0, yaw: -0.5 },
	{ model: 'outdoor_table_chair_set_01', room: 'market', x: 1.4, z: 1.4, yaw: 0, solid: 0.9 },
	{ model: 'outdoor_table_chair_set_01', room: 'market', x: -2.4, z: 1.2, yaw: 0, solid: 0.9 },
	{ model: 'planter_box_01', place: 'market', x: -4.2, z: 5.2, yaw: 0, solid: 0.5 },
	{ model: 'planter_box_01', place: 'market', x: 4.2, z: 5.2, yaw: 0, solid: 0.5 },

	// Agent plaza: benches round the pergola, planters, lamps and a tree.
	{ model: 'painted_wooden_bench', room: 'plaza', x: -3.6, z: 0, yaw: half, solid: { w: 0.5, d: 1.2 }, mobile: true },
	{ model: 'painted_wooden_bench', room: 'plaza', x: 3.6, z: 0, yaw: -half, solid: { w: 0.5, d: 1.2 }, mobile: true },
	{ model: 'painted_wooden_bench', room: 'plaza', x: 0, z: -3.6, yaw: 0, solid: { w: 1.2, d: 0.5 } },
	{ model: 'planter_box_01', room: 'plaza', x: -3.6, z: -3.6, yaw: 0.8, solid: 0.5 },
	{ model: 'planter_box_01', room: 'plaza', x: 3.6, z: -3.6, yaw: -0.8, solid: 0.5 },
	{ model: 'street_lamp_01', room: 'plaza', x: -5.6, z: 3.4, yaw: 0, solid: 0.3, mobile: true },
	{ model: 'street_lamp_01', room: 'plaza', x: 5.6, z: 3.4, yaw: 0, solid: 0.3, mobile: true },
	{ model: 'quiver_tree_02', room: 'plaza', x: 0, z: -7.6, yaw: 0, scale: 3, solid: 0.6 },

	// Around the campus: lamps along the way in, benches by the paths, greenery.
	{ model: 'street_lamp_01', world: true, x: -3.2, z: 24, yaw: 0, solid: 0.3, mobile: true },
	{ model: 'street_lamp_01', world: true, x: 3.2, z: 18, yaw: 0, solid: 0.3, mobile: true },
	{ model: 'street_lamp_01', world: true, x: -7.6, z: 0.4, yaw: 0, solid: 0.3, mobile: true },
	{ model: 'street_lamp_01', world: true, x: 7.6, z: 0.4, yaw: 0, solid: 0.3, mobile: true },
	{ model: 'street_lamp_01', world: true, x: -9, z: -16, yaw: 0, solid: 0.3 },
	{ model: 'street_lamp_01', world: true, x: 9, z: -16, yaw: 0, solid: 0.3 },
	{ model: 'painted_wooden_bench', world: true, x: -6.2, z: 20, yaw: 1.2, solid: { w: 1.2, d: 0.5 }, mobile: true },
	{ model: 'painted_wooden_bench', world: true, x: 6.4, z: 13, yaw: -1.9, solid: { w: 1.2, d: 0.5 }, mobile: true },
	{ model: 'painted_wooden_bench', world: true, x: -8.2, z: -12.6, yaw: 0.6, solid: { w: 1.2, d: 0.5 } },
	{ model: 'painted_wooden_bench', world: true, x: 8.2, z: -12.6, yaw: -0.6, solid: { w: 1.2, d: 0.5 } },
	{ model: 'quiver_tree_02', world: true, x: -13, z: 6, yaw: 0.3, scale: 3, solid: 0.6 },
	{ model: 'quiver_tree_02', world: true, x: 13, z: 6, yaw: 2.1, scale: 3, solid: 0.6 },
	{ model: 'quiver_tree_02', world: true, x: -12, z: -14, yaw: 1.1, scale: 3.4, solid: 0.6 },
	{ model: 'quiver_tree_02', world: true, x: 12, z: -14, yaw: -0.7, scale: 3.2, solid: 0.6 },
	{ model: 'quiver_tree_02', world: true, x: -16, z: 28, yaw: 0, scale: 3.6, solid: 0.6 },
	{ model: 'quiver_tree_02', world: true, x: 16, z: 28, yaw: 0, scale: 3.3, solid: 0.6 },
	{ model: 'fern_02', world: true, x: -9, z: 9, yaw: 0.5 },
	{ model: 'fern_02', world: true, x: 9.2, z: 9.4, yaw: 2.2 },
	{ model: 'fern_02', world: true, x: -14, z: -15.6, yaw: 1.3 },
	{ model: 'grass_medium_02', world: true, x: -5.4, z: 14, yaw: 0.2 },
	{ model: 'grass_medium_02', world: true, x: 5.8, z: 22, yaw: 1.4 },
	{ model: 'grass_medium_02', world: true, x: -11, z: -3, yaw: 2.6 },
	{ model: 'grass_medium_02', world: true, x: 11.4, z: -2.2, yaw: 0.9 },
	{ model: 'grass_medium_02', world: true, x: -30, z: 4, yaw: 1.9 },
	{ model: 'grass_medium_02', world: true, x: 30, z: 3, yaw: 0.4 },
	{ model: 'rock_moss_set_01', world: true, x: -30, z: 30, yaw: 0.8, anchor: 'origin' },
	{ model: 'rock_moss_set_01', world: true, x: 30, z: 30, yaw: -1.9, anchor: 'origin' },
	{ model: 'planter_box_01', world: true, x: -2.2, z: 12.4, yaw: 0, solid: 0.5 },
	{ model: 'planter_box_01', world: true, x: 2.2, z: 12.4, yaw: 0, solid: 0.5 },
];

/** How many hedge bushes ring the campus and the radius they stand on. */
export const HEDGE = { model: 'shrub_02', radius: CAMPUS_RADIUS + 2.5, count: 44, gapAt: Math.PI / 2, gapWidth: 0.34 };

/** The hedge ring resolved to world placements, leaving the gate open behind the spawn. */
export function hedgePlacements() {
	const out = [];
	for (let i = 0; i < HEDGE.count; i++) {
		const a = (i / HEDGE.count) * Math.PI * 2;
		// The gate is on +z (atan2(x, z) = 0): leave it open.
		let gap = Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
		if (gap < HEDGE.gapWidth) continue;
		out.push({ model: HEDGE.model, url: propUrl(HEDGE.model), bytes: MODELS[HEDGE.model].bytes, x: Math.sin(a) * HEDGE.radius, z: Math.cos(a) * HEDGE.radius, yaw: a + Math.PI / 2, y: 0, anchor: 'floor', scale: 1, mobile: true, solid: null, world: true });
	}
	return out;
}

/**
 * Resolve every prop for a quality tier into world placements:
 * {model, url, x, y, z, yaw, scale, anchor, solid, mobile, place}.
 * @param {'desktop'|'mobile'} tier
 */
export function placeProps(tier = 'desktop') {
	const list = PROPS.filter((p) => tier !== 'mobile' || p.mobile).map(resolveProp);
	return list.concat(tier === 'mobile' ? hedgePlacements().filter((_, i) => i % 2 === 0) : hedgePlacements());
}

export function resolveProp(p) {
	const def = MODELS[p.model];
	if (!def) throw new Error(`unknown prop model ${p.model}`);
	let x = p.x;
	let z = p.z;
	let yaw = p.yaw || 0;
	let place = null;
	if (p.room) {
		const room = roomById(p.room);
		const w = roomToWorld(room, p.x, p.z);
		x = w.x;
		z = w.z;
		yaw = w.yaw + (p.yaw || 0);
		place = room.place;
	} else if (p.place) {
		place = placeById(p.place).id;
		const w = roomToWorld({ place }, p.x, p.z);
		x = w.x;
		z = w.z;
		yaw = w.yaw + (p.yaw || 0);
	}
	return { model: p.model, url: propUrl(p.model), x, y: p.y || 0, z, yaw, scale: p.scale || 1, anchor: p.anchor || 'floor', solid: p.solid ?? null, mobile: !!p.mobile, bytes: def.bytes, place };
}

/** Bytes a tier downloads: each model once, however many times it is placed. */
export function payloadBytes(tier = 'desktop') {
	const seen = new Set(placeProps(tier).map((p) => p.model));
	let total = 0;
	for (const m of seen) total += MODELS[m].bytes;
	return total;
}

/** Collision for the placed props (world space), for the player and the agents. */
export function propSolids(placements) {
	const out = [];
	for (const p of placements) {
		if (!p.solid) continue;
		if (typeof p.solid === 'number') out.push({ group: { position: { x: p.x, y: 0, z: p.z } }, keepout: p.solid * p.scale });
		else out.push({ obb: { x: p.x, z: p.z, yaw: p.yaw, hw: (p.solid.w * p.scale) / 2 + 0.3, hd: (p.solid.d * p.scale) / 2 + 0.3 } });
	}
	return out;
}

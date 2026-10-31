// Shot logic for the venue projector view (?director=1).
//
// Pure: no three.js, no DOM, no timers, so every rule here is unit-tested
// (tests/director-shots.test.js) and the render loop only has to evaluate a
// finished plan once per frame.
//
// The pieces:
//   - crowdClusters(players)      where people actually are right now
//   - buildCandidates(...)        landmarks + crowd clusters + the wide plaza
//   - chooseShot(...)             density-weighted pick that avoids repeats
//   - planShot(...)               turn a pick into a camera path that is checked
//                                 against the district's building boxes
//   - shotPose(plan, t)           the camera pose at progress t (0..1)
//   - pushOutOfBoxes(pos, boxes)  per-frame safety net for the camera position
//
// Coordinates are world metres, ground at y = 0, +Z toward the viewer at spawn.
// A bearing is an angle whose direction vector is (sin b, cos b) in XZ, the same
// convention as an Object3D's rotation.y facing.

export const MIN_SHOT_MS = 15_000;
export const MAX_SHOT_MS = 30_000;
/** Radius a player counts toward a landmark or cluster. */
export const OCCUPANCY_RADIUS_M = 14;
const CLUSTER_CELL_M = 10;
const CLUSTER_SEPARATION_M = 18;
const MAX_CLUSTERS = 3;
const CAMERA_MARGIN_M = 1.2;
const MIN_CAMERA_HEIGHT_M = 1.8;
const PATH_SAMPLES = 10;
const EPS = 0.01;
const WORLD_CLAMP_M = 196;
/** How many recent shots count against a repeat. */
const HISTORY_SPAN = 3;

export const KIND = { LANDMARK: 'landmark', CROWD: 'crowd', WIDE: 'wide' };
export const MOVE = { DOLLY: 'dolly', ORBIT: 'orbit', CRANE: 'crane', STATIC: 'static' };

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const lerp = (a, b, t) => a + (b - a) * t;
const dist2 = (ax, az, bx, bz) => (ax - bx) ** 2 + (az - bz) ** 2;
const dirOf = (bearing) => ({ x: Math.sin(bearing), z: Math.cos(bearing) });
const smooth = (t) => t * t * (3 - 2 * t);

/** Players in range of a point. */
export function countNear(players, x, z, radius = OCCUPANCY_RADIUS_M) {
	const r2 = radius * radius;
	let n = 0;
	for (const p of players) if (dist2(p.x, p.z, x, z) <= r2) n++;
	return n;
}

/**
 * Find where people are bunched up. Grid-bins the players, takes the busiest
 * cells that hold at least two people, and re-centres each on the weighted mean
 * of the players around it. Clusters closer than CLUSTER_SEPARATION_M merge into
 * the busier one, so one big crowd is one shot, not three overlapping ones.
 */
export function crowdClusters(players, { minSize = 2, max = MAX_CLUSTERS } = {}) {
	if (!players.length) return [];
	const cells = new Map();
	for (const p of players) {
		const key = `${Math.floor(p.x / CLUSTER_CELL_M)}:${Math.floor(p.z / CLUSTER_CELL_M)}`;
		cells.set(key, (cells.get(key) || 0) + 1);
	}
	const ranked = [...cells.entries()]
		.map(([key, count]) => {
			const [cx, cz] = key.split(':').map(Number);
			return { count, x: (cx + 0.5) * CLUSTER_CELL_M, z: (cz + 0.5) * CLUSTER_CELL_M };
		})
		.sort((a, b) => b.count - a.count || a.x - b.x || a.z - b.z);

	const out = [];
	for (const seed of ranked) {
		if (out.length >= max) break;
		if (out.some((c) => dist2(c.x, c.z, seed.x, seed.z) < CLUSTER_SEPARATION_M ** 2)) continue;
		const members = players.filter((p) => dist2(p.x, p.z, seed.x, seed.z) <= (CLUSTER_CELL_M * 1.5) ** 2);
		if (members.length < minSize) continue;
		let sx = 0, sz = 0;
		for (const m of members) { sx += m.x; sz += m.z; }
		const x = sx / members.length, z = sz / members.length;
		let spread = 0;
		for (const m of members) spread = Math.max(spread, Math.sqrt(dist2(m.x, m.z, x, z)));
		out.push({ x, z, count: members.length, spread });
	}
	return out;
}

/**
 * Every shot the director may take right now.
 * @param {object} input
 * @param {Array<{id:string,label?:string,x:number,y?:number,z:number,facing?:number,standoff?:number,height?:number,radius?:number,weight?:number}>} input.landmarks
 * @param {Array<{x:number,z:number}>} input.players
 */
export function buildCandidates({ landmarks = [], players = [] }) {
	const out = [];
	for (const l of landmarks) {
		out.push({
			id: l.id, kind: KIND.LANDMARK, label: l.label || l.id,
			x: l.x, y: l.y ?? 3, z: l.z,
			facing: Number.isFinite(l.facing) ? l.facing : null,
			standoff: l.standoff ?? 22, height: l.height ?? 5,
			radius: l.radius ?? OCCUPANCY_RADIUS_M, weight: l.weight ?? 1,
		});
	}
	crowdClusters(players).forEach((c, i) => {
		out.push({
			id: `crowd:${Math.round(c.x / CLUSTER_CELL_M)}:${Math.round(c.z / CLUSTER_CELL_M)}`,
			kind: KIND.CROWD, label: 'crowd', x: c.x, y: 1.4, z: c.z, facing: null,
			standoff: clamp(9 + c.spread * 1.6, 10, 26), height: 3.4,
			radius: Math.max(OCCUPANCY_RADIUS_M * 0.7, c.spread + 4), weight: 1, rank: i,
		});
	});
	out.push({
		id: 'plaza', kind: KIND.WIDE, label: 'plaza', x: 0, y: 2, z: 0, facing: null,
		standoff: 52, height: 22, radius: 60, weight: 1,
	});
	return out;
}

/** Weight of a candidate given who is where and what was shown recently. */
export function scoreCandidate(c, players, history = []) {
	const near = countNear(players, c.x, c.z, c.radius);
	let s;
	if (c.kind === KIND.CROWD) s = 3 + 2.2 * Math.sqrt(near);
	else if (c.kind === KIND.WIDE) s = 0.7 + 0.3 * Math.sqrt(players.length);
	else s = near > 0 ? 1.2 + 1.8 * Math.sqrt(near) : 0.35;
	s *= c.weight;
	// An empty landmark loses to anything with people in it; it only wins when
	// nobody is anywhere, so a quiet world still rotates through its sights.
	if (c.kind === KIND.LANDMARK && near === 0 && players.length > 0) s *= 0.4;
	for (let i = 0; i < Math.min(history.length, HISTORY_SPAN); i++) {
		if (sameSpot(history[i], c)) { s *= i === 0 ? 0.06 : 0.4; break; }
	}
	return { score: s, near };
}

function sameSpot(h, c) {
	if (!h) return false;
	if (h.id === c.id) return true;
	return h.kind === KIND.CROWD && c.kind === KIND.CROWD && dist2(h.x, h.z, c.x, c.z) < 14 * 14;
}

/**
 * Pick the next shot. Weighted random over score squared: busy places dominate
 * but a second-best still gets airtime, and the last shot is nearly excluded.
 * @param {object} input
 * @param {Array} input.candidates from buildCandidates
 * @param {Array<{x:number,z:number}>} input.players
 * @param {Array} [input.history] most recent first, entries {id, kind, x, z}
 * @param {() => number} [input.rng]
 */
export function chooseShot({ candidates, players, history = [], rng = Math.random }) {
	const scored = candidates.map((c) => ({ c, ...scoreCandidate(c, players, history) }));
	const weights = scored.map((s) => s.score * s.score);
	const total = weights.reduce((a, b) => a + b, 0);
	if (!(total > 0)) return scored[0]?.c || null;
	let r = rng() * total;
	for (let i = 0; i < scored.length; i++) {
		r -= weights[i];
		if (r <= 0) return scored[i].c;
	}
	return scored[scored.length - 1].c;
}

/** A random hold between MIN_SHOT_MS and MAX_SHOT_MS. */
export function pickDuration(rng = Math.random) {
	return Math.round(lerp(MIN_SHOT_MS, MAX_SHOT_MS, clamp(rng(), 0, 1)));
}

/**
 * Should the director cut away from a running shot before its time? A crowd shot
 * whose crowd has walked off is an empty corner; a landmark or the wide plaza is
 * still a valid frame without people.
 */
export function shouldCutEarly(plan, players) {
	if (!plan || plan.locked) return false;
	if (plan.kind !== KIND.CROWD) return false;
	return countNear(players, plan.target.x, plan.target.z, plan.radius) < 1;
}

// ---------------------------------------------------------------- clearance

/** Highest building top, used as the ceiling for the always-clear fallback shot. */
export function tallestTop(boxes) {
	let top = 0;
	for (const b of boxes) top = Math.max(top, b.position.y + b.halfExtents.y);
	return top;
}

function inFootprint(b, x, z, pad) {
	return Math.abs(x - b.position.x) <= b.halfExtents.x + pad && Math.abs(z - b.position.z) <= b.halfExtents.z + pad;
}

/** True when a camera at pos would sit inside (or too close to) a box. */
export function insideBox(pos, boxes, margin = CAMERA_MARGIN_M) {
	for (const b of boxes) {
		if (!inFootprint(b, pos.x, pos.z, margin)) continue;
		if (pos.y <= b.position.y + b.halfExtents.y + margin && pos.y >= b.position.y - b.halfExtents.y - margin) return true;
	}
	return false;
}

/** Slab test: does the segment a->b pass through the (padded) box? */
export function segmentHitsBox(a, b, box, pad = 0.4) {
	const min = { x: box.position.x - box.halfExtents.x - pad, y: box.position.y - box.halfExtents.y - pad, z: box.position.z - box.halfExtents.z - pad };
	const max = { x: box.position.x + box.halfExtents.x + pad, y: box.position.y + box.halfExtents.y + pad, z: box.position.z + box.halfExtents.z + pad };
	let t0 = 0, t1 = 1;
	for (const axis of ['x', 'y', 'z']) {
		const d = b[axis] - a[axis];
		if (Math.abs(d) < 1e-9) {
			if (a[axis] < min[axis] || a[axis] > max[axis]) return false;
			continue;
		}
		let ta = (min[axis] - a[axis]) / d, tb = (max[axis] - a[axis]) / d;
		if (ta > tb) [ta, tb] = [tb, ta];
		t0 = Math.max(t0, ta);
		t1 = Math.min(t1, tb);
		if (t0 > t1) return false;
	}
	return true;
}

/** True when the line of sight from the camera to the subject is blocked by a building. */
export function sightBlocked(pos, look, boxes) {
	for (const b of boxes) if (segmentHitsBox(pos, look, b)) return true;
	return false;
}

/**
 * Last line of defence, run every frame on the final camera position: if the
 * point is inside a building's footprint at camera height, slide it out through
 * the nearest face, and keep it above the ground and inside the world.
 */
export function pushOutOfBoxes(pos, boxes, margin = CAMERA_MARGIN_M) {
	const p = { x: clamp(pos.x, -WORLD_CLAMP_M, WORLD_CLAMP_M), y: Math.max(pos.y, MIN_CAMERA_HEIGHT_M), z: clamp(pos.z, -WORLD_CLAMP_M, WORLD_CLAMP_M) };
	for (let pass = 0; pass < 3; pass++) {
		let moved = false;
		for (const b of boxes) {
			if (!insideBox(p, [b], margin)) continue;
			const dxMin = p.x - (b.position.x - b.halfExtents.x - margin);
			const dxMax = b.position.x + b.halfExtents.x + margin - p.x;
			const dzMin = p.z - (b.position.z - b.halfExtents.z - margin);
			const dzMax = b.position.z + b.halfExtents.z + margin - p.z;
			const m = Math.min(dxMin, dxMax, dzMin, dzMax);
			if (m === dxMin) p.x = b.position.x - b.halfExtents.x - margin - EPS;
			else if (m === dxMax) p.x = b.position.x + b.halfExtents.x + margin + EPS;
			else if (m === dzMin) p.z = b.position.z - b.halfExtents.z - margin - EPS;
			else p.z = b.position.z + b.halfExtents.z + margin + EPS;
			moved = true;
		}
		if (!moved) break;
	}
	return p;
}

// --------------------------------------------------------------------- plans

function pose(plan, t) {
	const e = plan.move === MOVE.STATIC ? 0 : smooth(clamp(t, 0, 1));
	const b = lerp(plan.b0, plan.b1, e);
	const r = lerp(plan.r0, plan.r1, e);
	const d = dirOf(b);
	return {
		pos: { x: plan.target.x + d.x * r, y: lerp(plan.h0, plan.h1, e), z: plan.target.z + d.z * r },
		look: { x: plan.target.x, y: plan.target.y, z: plan.target.z },
	};
}

/** Camera position and look-at point at progress t (0..1) of a plan. */
export function shotPose(plan, t) {
	return pose(plan, t);
}

function pathClear(plan, boxes) {
	for (let i = 0; i <= PATH_SAMPLES; i++) {
		const { pos, look } = pose(plan, i / PATH_SAMPLES);
		if (Math.abs(pos.x) > WORLD_CLAMP_M || Math.abs(pos.z) > WORLD_CLAMP_M) return false;
		if (insideBox(pos, boxes)) return false;
		if (sightBlocked(pos, look, boxes)) return false;
	}
	return true;
}

function pickMove(c, rng, reducedMotion) {
	if (reducedMotion) return MOVE.STATIC;
	if (c.kind === KIND.WIDE) return MOVE.CRANE;
	if (c.kind === KIND.CROWD) return rng() < 0.6 ? MOVE.ORBIT : MOVE.DOLLY;
	return c.facing != null ? (rng() < 0.65 ? MOVE.DOLLY : MOVE.ORBIT) : MOVE.ORBIT;
}

function basePlan(c, move, bearing, rng) {
	const target = { x: c.x, y: c.y, z: c.z };
	const sweep = (rng() < 0.5 ? -1 : 1) * lerp(0.35, 0.7, rng()); // radians swept over the shot
	const plan = {
		id: c.id, kind: c.kind, label: c.label, move, target, radius: c.radius, locked: false,
		b0: bearing, b1: bearing, r0: c.standoff, r1: c.standoff, h0: c.height, h1: c.height,
	};
	if (move === MOVE.ORBIT) plan.b1 = bearing + sweep;
	if (move === MOVE.DOLLY) { plan.r0 = c.standoff * 1.35; plan.r1 = c.standoff * 0.85; plan.b1 = bearing + sweep * 0.12; }
	if (move === MOVE.CRANE) { plan.h0 = c.height * 0.7; plan.h1 = c.height * 1.25; plan.b1 = bearing + sweep * 0.5; }
	return plan;
}

/**
 * Turn a chosen candidate into a camera path that stays out of the buildings.
 * Tries the natural bearing first, then swings round the subject, then pulls in,
 * and finally falls back to a high crane above the tallest roof, which always
 * clears. The returned plan is guaranteed not to clip any of `boxes`.
 * @param {object} c candidate
 * @param {object} opts
 * @param {Array} opts.boxes district colliders ({position, halfExtents})
 * @param {() => number} [opts.rng]
 * @param {boolean} [opts.reducedMotion] hold the frame instead of moving
 * @param {number} [opts.durationMs]
 * @param {boolean} [opts.locked] a locked shot is not cut early
 */
export function planShot(c, { boxes = [], rng = Math.random, reducedMotion = false, durationMs, locked = false } = {}) {
	const move = pickMove(c, rng, reducedMotion);
	const natural = c.facing != null ? c.facing + (rng() - 0.5) * 0.7 : rng() * Math.PI * 2;
	const finish = (plan) => ({ ...plan, locked, durationMs: durationMs ?? pickDuration(rng) });

	for (const shrink of [1, 0.75, 0.55]) {
		for (const turn of [0, 0.7, -0.7, 1.4, -1.4, 2.1, -2.1, Math.PI]) {
			const plan = basePlan({ ...c, standoff: c.standoff * shrink }, move, natural + turn, rng);
			if (pathClear(plan, boxes)) return finish(plan);
		}
	}
	const ceiling = Math.min(tallestTop(boxes) + 4, 120);
	const plan = basePlan({ ...c, standoff: Math.max(c.standoff * 0.35, 8), height: Math.max(ceiling, c.height) }, reducedMotion ? MOVE.STATIC : MOVE.ORBIT, natural, rng);
	plan.h0 = plan.h1 = Math.max(ceiling, c.height);
	return finish(plan);
}

// ------------------------------------------------------------- group photo

/**
 * The shot the director holds for the group photo: the totem, with the whole
 * crowd in frame. The standoff grows with the crowd's spread so a big turnout
 * is not cropped. Locked, so nothing cuts away until the shutter has fired.
 * @param {Array} landmarks the same landmark list buildCandidates takes
 * @param {Array<{x:number,z:number}>} players
 */
export function photoCandidate(landmarks, players) {
	const totem = landmarks.find((l) => l.id === 'totem') || landmarks[0];
	if (!totem) return null;
	let spread = 0;
	for (const p of players) spread = Math.max(spread, Math.sqrt(dist2(p.x, p.z, totem.x, totem.z)));
	return {
		id: 'photo', kind: KIND.LANDMARK, label: 'group photo',
		x: totem.x, y: 3.2, z: totem.z, facing: Number.isFinite(totem.facing) ? totem.facing : 0,
		standoff: clamp(20 + spread * 0.9, 22, 48), height: 6.5, radius: 40, weight: 1,
	};
}

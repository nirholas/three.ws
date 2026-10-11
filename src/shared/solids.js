// Walkable-world collision: the one resolver every world's player and every
// NPC share. A solid is either a cylinder keep-out (`{ group: { position },
// keepout }`, the shape the docs plaza and the campus always used) or an
// oriented box (`{ obb: { x, z, yaw, hw, hd } }`): a wall, a counter, a sofa.
// Boxes carry their own padding in `hw`/`hd`, so a point body is enough.
// Pure math, no Three.js, so tests pin the behaviour.

/**
 * Push `pos` (mutated in place; any `{x, z}`) out of every solid it is inside.
 * @param {{x:number, z:number}} pos
 * @param {Array<object>} solids
 * @param {{ keepout?: number }} [o] default radius for cylinders that carry none
 */
export function resolveSolids(pos, solids, { keepout = 0 } = {}) {
	if (!solids) return pos;
	for (const s of solids) {
		if (s.obb) pushOutOfBox(pos, s.obb);
		else pushOutOfDisc(pos, s.group.position, s.keepout ?? keepout);
	}
	return pos;
}

function pushOutOfDisc(pos, c, r) {
	const dx = pos.x - c.x;
	const dz = pos.z - c.z;
	const d = Math.hypot(dx, dz);
	if (d > 0.001 && d < r) {
		const push = r / d;
		pos.x = c.x + dx * push;
		pos.z = c.z + dz * push;
	}
}

function pushOutOfBox(pos, b) {
	const sin = Math.sin(b.yaw);
	const cos = Math.cos(b.yaw);
	const dx = pos.x - b.x;
	const dz = pos.z - b.z;
	// Into the box's frame (inverse of a Y rotation by yaw).
	const lx = dx * cos - dz * sin;
	const lz = dx * sin + dz * cos;
	if (Math.abs(lx) >= b.hw || Math.abs(lz) >= b.hd) return;
	// Leave along the axis that needs the least travel.
	const px = b.hw - Math.abs(lx);
	const pz = b.hd - Math.abs(lz);
	let nx = lx;
	let nz = lz;
	if (px < pz) nx = Math.sign(lx || 1) * b.hw;
	else nz = Math.sign(lz || 1) * b.hd;
	pos.x = b.x + nx * cos + nz * sin;
	pos.z = b.z - nx * sin + nz * cos;
}

/** True when (x, z) is inside any solid, grown by `margin`. */
export function insideSolids(x, z, solids, margin = 0) {
	for (const s of solids || []) {
		if (s.obb) {
			const b = s.obb;
			const sin = Math.sin(b.yaw);
			const cos = Math.cos(b.yaw);
			const dx = x - b.x;
			const dz = z - b.z;
			if (Math.abs(dx * cos - dz * sin) < b.hw + margin && Math.abs(dx * sin + dz * cos) < b.hd + margin) return true;
		} else if (Math.hypot(x - s.group.position.x, z - s.group.position.z) < (s.keepout ?? 0) + margin) return true;
	}
	return false;
}

/**
 * An oriented box solid from a centre, a yaw and full extents, padded so a
 * body of radius `pad` never clips its faces.
 */
export function boxSolid(x, z, yaw, w, d, pad = 0.35) {
	return { obb: { x, z, yaw, hw: w / 2 + pad, hd: d / 2 + pad } };
}

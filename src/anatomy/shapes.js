// Anatomy geometry: one spec shape → a smooth fill mesh plus a technical
// line drawing of it.
//
// The look is an engineering illustration, not a triangle wireframe: surfaces
// of revolution are drawn with meridians and parallels, extrusions and gears
// with their real crease edges, sweeps with a centreline and section rings.
// Every builder works along +Y and orient() turns the result onto the spec's
// axis, so "axis": "x" means the same thing for every shape.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const FILL_SEGMENTS = 48;
const MERIDIANS = 12;
const CIRCLE_SEGMENTS = 48;
const TAU = Math.PI * 2;

function orient(geom, axis) {
	if (axis === 'x') geom.rotateZ(-Math.PI / 2);
	else if (axis === 'z') geom.rotateX(Math.PI / 2);
	return geom;
}

function orientPositions(positions, axis) {
	if (axis === 'y') return positions;
	const out = new Float32Array(positions.length);
	for (let i = 0; i < positions.length; i += 3) {
		const x = positions[i];
		const y = positions[i + 1];
		const z = positions[i + 2];
		if (axis === 'x') {
			out[i] = y;
			out[i + 1] = -x;
			out[i + 2] = z;
		} else {
			out[i] = x;
			out[i + 1] = -z;
			out[i + 2] = y;
		}
	}
	return out;
}

function edgePositions(geom, threshold = 20) {
	const edges = new THREE.EdgesGeometry(geom, threshold);
	const arr = Float32Array.from(edges.getAttribute('position').array);
	edges.dispose();
	return arr;
}

function circleSegments(out, r, y, segments = CIRCLE_SEGMENTS) {
	if (r < 1e-5) return;
	for (let i = 0; i < segments; i++) {
		const a0 = (i / segments) * TAU;
		const a1 = ((i + 1) / segments) * TAU;
		out.push(Math.cos(a0) * r, y, Math.sin(a0) * r, Math.cos(a1) * r, y, Math.sin(a1) * r);
	}
}

/**
 * Lines for a surface of revolution about +Y: a parallel (circle) at each
 * ring point and a meridian (the profile itself) at evenly spaced angles.
 * `profile` and `rings` are [radius, y] pairs.
 */
function revolutionLines(profile, rings = profile, meridians = MERIDIANS) {
	const out = [];
	for (const [r, y] of rings) circleSegments(out, r, y);
	for (let m = 0; m < meridians; m++) {
		const a = (m / meridians) * TAU;
		const c = Math.cos(a);
		const s = Math.sin(a);
		for (let i = 0; i < profile.length - 1; i++) {
			const [r0, y0] = profile[i];
			const [r1, y1] = profile[i + 1];
			out.push(c * r0, y0, s * r0, c * r1, y1, s * r1);
		}
	}
	return new Float32Array(out);
}

function lathe(profile, segments = FILL_SEGMENTS) {
	const pts = profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 0), y));
	return new THREE.LatheGeometry(pts, segments);
}

function arcProfile(radius, from, to, steps, cx = 0, cy = 0) {
	const out = [];
	for (let i = 0; i <= steps; i++) {
		const t = from + ((to - from) * i) / steps;
		out.push([cx + Math.cos(t) * radius, cy + Math.sin(t) * radius]);
	}
	return out;
}

function gearShape({ teeth, radius, toothDepth, bore }) {
	const shape = new THREE.Shape();
	const root = radius - toothDepth;
	const step = TAU / teeth;
	// Trapezoidal teeth: root land, flank up, tip land, flank down.
	for (let i = 0; i < teeth; i++) {
		const a = i * step;
		const pts = [
			[root, a],
			[root, a + step * 0.18],
			[radius, a + step * 0.32],
			[radius, a + step * 0.58],
			[root, a + step * 0.72],
		];
		for (const [j, [r, t]] of pts.entries()) {
			const x = Math.cos(t) * r;
			const y = Math.sin(t) * r;
			if (i === 0 && j === 0) shape.moveTo(x, y);
			else shape.lineTo(x, y);
		}
	}
	shape.closePath();
	if (bore > 0) {
		const hole = new THREE.Path();
		hole.absarc(0, 0, bore, 0, TAU, true);
		shape.holes.push(hole);
	}
	return shape;
}

// Extrude a 2D shape along +Y, centred on y = 0.
function extrudeY(shape, depth, curveSegments = 24) {
	const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments });
	g.translate(0, 0, -depth / 2);
	g.rotateX(-Math.PI / 2);
	return g;
}

function rotorGeometry(s) {
	const parts = [];
	const span = Math.max(s.radius - s.hubRadius, s.radius * 0.05);
	const spanSegs = 6;
	for (let b = 0; b < s.blades; b++) {
		const blade = new THREE.BoxGeometry(span, s.chord, s.thickness, spanSegs, 1, 1);
		blade.translate(s.hubRadius + span / 2 - s.radius * 0.01, 0, 0);
		const p = blade.getAttribute('position');
		const v = new THREE.Vector3();
		for (let i = 0; i < p.count; i++) {
			v.fromBufferAttribute(p, i);
			const t = (v.x - s.hubRadius) / span;
			const ang = THREE.MathUtils.degToRad(s.pitch - s.twist * (t - 0.5));
			const y = v.y * Math.cos(ang) - v.z * Math.sin(ang);
			const z = v.y * Math.sin(ang) + v.z * Math.cos(ang);
			// Blades taper slightly toward the tip.
			const taper = 1 - 0.25 * Math.max(0, t);
			p.setXYZ(i, v.x, y * taper, z);
		}
		blade.computeVertexNormals();
		blade.rotateY((b / s.blades) * TAU);
		parts.push(blade.toNonIndexed());
		blade.dispose();
	}
	const hubLen = Math.max(s.hubLength, s.chord * 1.1);
	const hub = new THREE.CylinderGeometry(s.hubRadius, s.hubRadius, hubLen, 32, 1).toNonIndexed();
	parts.push(hub);
	for (const g of parts) {
		if (g.getAttribute('uv')) g.deleteAttribute('uv');
	}
	const merged = mergeGeometries(parts, false);
	for (const g of parts) g.dispose();
	merged.computeVertexNormals();
	return { merged, hubLen };
}

function helixCurve(radius, turns, length) {
	const pts = [];
	const n = Math.max(24, Math.ceil(turns * 24));
	for (let i = 0; i <= n; i++) {
		const t = i / n;
		const a = t * turns * TAU;
		pts.push(new THREE.Vector3(Math.cos(a) * radius, -length / 2 + t * length, Math.sin(a) * radius));
	}
	return new THREE.CatmullRomCurve3(pts);
}

function sweepLines(curve, radius, rings = 8, samples = 64) {
	const out = [];
	const pts = curve.getSpacedPoints(samples);
	for (let i = 0; i < pts.length - 1; i++) out.push(pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z);
	const frames = curve.computeFrenetFrames(rings, false);
	for (let r = 0; r <= rings; r++) {
		const u = r / rings;
		const c = curve.getPointAt(u);
		const n = frames.normals[r];
		const b = frames.binormals[r];
		const seg = 20;
		for (let i = 0; i < seg; i++) {
			const a0 = (i / seg) * TAU;
			const a1 = ((i + 1) / seg) * TAU;
			const p0 = c.clone().addScaledVector(n, Math.cos(a0) * radius).addScaledVector(b, Math.sin(a0) * radius);
			const p1 = c.clone().addScaledVector(n, Math.cos(a1) * radius).addScaledVector(b, Math.sin(a1) * radius);
			out.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z);
		}
	}
	return new Float32Array(out);
}

/**
 * Build one shape. Returns { fill: BufferGeometry, lines: Float32Array } where
 * `lines` holds line-segment endpoint pairs (x0 y0 z0 x1 y1 z1 ...).
 */
export function buildShape(shape) {
	switch (shape.type) {
		case 'box': {
			const [w, h, d] = shape.size;
			const fill = shape.radius > 0 ? new RoundedBoxGeometry(w, h, d, 3, shape.radius) : new THREE.BoxGeometry(w, h, d);
			const plain = new THREE.BoxGeometry(w, h, d);
			const lines = edgePositions(plain, 10);
			plain.dispose();
			return { fill, lines };
		}
		case 'cylinder': {
			const { radiusTop: rt, radiusBottom: rb, length: l, open } = shape;
			const fill = orient(new THREE.CylinderGeometry(rt, rb, l, FILL_SEGMENTS, 1, open), shape.axis);
			const profile = [
				[rb, -l / 2],
				[rt, l / 2],
			];
			return { fill, lines: orientPositions(revolutionLines(profile), shape.axis) };
		}
		case 'cone': {
			const l = shape.length;
			const fill = orient(new THREE.ConeGeometry(shape.radius, l, FILL_SEGMENTS, 1), shape.axis);
			const profile = [
				[shape.radius, -l / 2],
				[0, l / 2],
			];
			return { fill, lines: orientPositions(revolutionLines(profile, [profile[0]]), shape.axis) };
		}
		case 'tube': {
			const { outerRadius: ro, innerRadius: ri, length: l } = shape;
			const profile = [
				[ri, -l / 2],
				[ro, -l / 2],
				[ro, l / 2],
				[ri, l / 2],
				[ri, -l / 2],
			];
			const fill = orient(lathe(profile), shape.axis);
			return { fill, lines: orientPositions(revolutionLines(profile, profile.slice(0, 4)), shape.axis) };
		}
		case 'sphere': {
			const r = shape.radius;
			const hemi = shape.hemisphere;
			const fill = orient(new THREE.SphereGeometry(r, FILL_SEGMENTS, 32, 0, TAU, 0, hemi ? Math.PI / 2 : Math.PI), shape.axis);
			const from = hemi ? 0 : -Math.PI / 2;
			const profile = arcProfile(r, from, Math.PI / 2, 24);
			const rings = arcProfile(r, from, Math.PI / 2, hemi ? 4 : 8).filter(([x]) => x > r * 0.05);
			// arcProfile yields [x, y] = [r cos t, r sin t]: x is the ring radius.
			return { fill, lines: orientPositions(revolutionLines(profile, rings), shape.axis) };
		}
		case 'capsule': {
			const { radius: r, length: l } = shape;
			const body = Math.max(l - 2 * r, 0);
			const fill = orient(new THREE.CapsuleGeometry(r, body, 12, FILL_SEGMENTS), shape.axis);
			const top = arcProfile(r, 0, Math.PI / 2, 10, 0, body / 2);
			const bottom = arcProfile(r, -Math.PI / 2, 0, 10, 0, -body / 2);
			const profile = [...bottom, ...top];
			const rings = [
				[r, -body / 2],
				[r, body / 2],
				[r * Math.cos(Math.PI / 4), body / 2 + r * Math.sin(Math.PI / 4)],
				[r * Math.cos(Math.PI / 4), -body / 2 - r * Math.sin(Math.PI / 4)],
			];
			return { fill, lines: orientPositions(revolutionLines(profile, rings), shape.axis) };
		}
		case 'torus': {
			const { radius: R, tube: t } = shape;
			const arc = THREE.MathUtils.degToRad(shape.arc);
			// TorusGeometry lies in XY around Z; turn it so its axis is +Y.
			const fill = new THREE.TorusGeometry(R, t, 24, 96, arc);
			fill.rotateX(Math.PI / 2);
			orient(fill, shape.axis);
			const out = [];
			const minor = 16;
			const majorLines = 8;
			const ringCount = Math.max(6, Math.round((24 * arc) / TAU));
			for (let k = 0; k <= ringCount; k++) {
				if (arc >= TAU - 1e-6 && k === ringCount) break;
				const a = (k / ringCount) * arc;
				for (let i = 0; i < minor; i++) {
					const b0 = (i / minor) * TAU;
					const b1 = ((i + 1) / minor) * TAU;
					const p = (b) => [(R + t * Math.cos(b)) * Math.cos(a), t * Math.sin(b), (R + t * Math.cos(b)) * Math.sin(a)];
					out.push(...p(b0), ...p(b1));
				}
			}
			for (let j = 0; j < majorLines; j++) {
				const b = (j / majorLines) * TAU;
				const r = R + t * Math.cos(b);
				const y = t * Math.sin(b);
				const seg = 64;
				for (let i = 0; i < seg; i++) {
					const a0 = (i / seg) * arc;
					const a1 = ((i + 1) / seg) * arc;
					out.push(Math.cos(a0) * r, y, Math.sin(a0) * r, Math.cos(a1) * r, y, Math.sin(a1) * r);
				}
			}
			return { fill, lines: orientPositions(new Float32Array(out), shape.axis) };
		}
		case 'gear': {
			const fill = orient(extrudeY(gearShape(shape), shape.thickness, 24), shape.axis);
			const lines = edgePositions(fill, 25);
			return { fill, lines };
		}
		case 'rotor': {
			const { merged } = rotorGeometry(shape);
			orient(merged, shape.axis);
			return { fill: merged, lines: edgePositions(merged, 28) };
		}
		case 'lathe': {
			const profile = shape.profile;
			const fill = orient(lathe(profile), shape.axis);
			return { fill, lines: orientPositions(revolutionLines(profile), shape.axis) };
		}
		case 'extrude': {
			const s = new THREE.Shape(shape.points.map(([u, v]) => new THREE.Vector2(u, v)));
			const g = new THREE.ExtrudeGeometry(s, { depth: shape.depth, bevelEnabled: false, curveSegments: 12 });
			g.translate(0, 0, -shape.depth / 2);
			if (shape.axis === 'y') g.rotateX(-Math.PI / 2);
			else if (shape.axis === 'x') g.rotateY(Math.PI / 2);
			return { fill: g, lines: edgePositions(g, 20) };
		}
		case 'spring': {
			const curve = helixCurve(shape.radius, shape.turns, shape.length);
			const tubular = Math.min(1600, Math.max(48, Math.ceil(shape.turns * 32)));
			const fill = orient(new THREE.TubeGeometry(curve, tubular, shape.wire, 8, false), shape.axis);
			const pts = curve.getSpacedPoints(tubular);
			const out = [];
			for (let i = 0; i < pts.length - 1; i++) out.push(pts[i].x, pts[i].y, pts[i].z, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z);
			return { fill, lines: orientPositions(new Float32Array(out), shape.axis) };
		}
		case 'pipe': {
			const curve = new THREE.CatmullRomCurve3(
				shape.path.map((p) => new THREE.Vector3(...p)),
				shape.closed,
				'centripetal',
			);
			const tubular = Math.min(400, Math.max(24, shape.path.length * 16));
			const fill = new THREE.TubeGeometry(curve, tubular, shape.radius, 12, shape.closed);
			return { fill, lines: sweepLines(curve, shape.radius, Math.min(24, shape.path.length * 3)) };
		}
		default: {
			const fill = new THREE.BoxGeometry(1, 1, 1);
			return { fill, lines: edgePositions(fill) };
		}
	}
}

// The campus: the real place the visitor walks through before (and around)
// the desktop. Daylight under a physical sky, grass and paving underfoot,
// buildings with walls, doors and windows you walk through, furniture and
// lamps scanned from the real world (props.js), and live data on the exchange
// board, the monitor and the mine supplied by the controller (index.js).
// Room specs live in rooms.js, surfaces in surfaces.js; this file turns them
// into meshes and keeps the contract index.js relies on.

import {
	BoxGeometry,
	CanvasTexture,
	CircleGeometry,
	Color,
	ConeGeometry,
	CylinderGeometry,
	DirectionalLight,
	DoubleSide,
	Fog,
	Group,
	HemisphereLight,
	MathUtils,
	Mesh,
	MeshBasicMaterial,
	MeshStandardMaterial,
	OctahedronGeometry,
	PerspectiveCamera,
	PlaneGeometry,
	PointLight,
	Raycaster,
	RingGeometry,
	SRGBColorSpace,
	Scene,
	Shape,
	ShapeGeometry,
	SphereGeometry,
	TextureLoader,
	TorusGeometry,
	Vector2,
	Vector3,
} from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { createRenderer } from '../../webgl-support.js';
import { applyCinematicDefaults, detectQualityTier, loadEnvironment } from '../../shared/cinematic-render.js';
import { disposeGltfLoader } from '../../loaders/gltf.js';
import { boxSolid } from '../../shared/solids.js';
import { log } from '../../shared/log.js';
import { CAMPUS_RADIUS, DESK_OBJECTS, PLACES, SPAWN, VEINS, placeById } from './places.js';
import { ROOMS, WALL, allRoomSolids, columnsOf, doorPoints, roomFrame, wallsOf } from './rooms.js';
import { placeProps, propSolids } from './props.js';
import { createPropLoader } from './prop-loader.js';
import { createSurfaces, tileBox, tilePlane } from './surfaces.js';
import { GEMS } from '../../../api/_lib/world-gems.js';

const HORIZON = 0xd3dfea;
const VIOLET = 0xc4b5fd;
const SUN_ELEVATION = 38;
const SUN_AZIMUTH = 150;
const GATE_Z = 38;
const QUALITY_PARAM = 'quality';

const hueColor = (hue, l = 0.62) => new Color().setHSL(hue / 360, 0.6, l);
const hex = (c) => `#${c.getHexString()}`;
const std = (o) => new MeshStandardMaterial({ roughness: 0.78, metalness: 0.12, ...o });
const glow = (color, intensity = 1) => new MeshBasicMaterial({ color: new Color(color).multiplyScalar(intensity), toneMapped: false });
const PI = Math.PI;

/* ------------------------------------------------------------- materials */

function sharedMaterials() {
	return {
		wood: std({ color: 0x7a5636, roughness: 0.7 }),
		darkWood: std({ color: 0x3e2a1c, roughness: 0.65 }),
		paint: std({ color: 0x3a3a3f, roughness: 0.5, metalness: 0.3 }),
		steel: std({ color: 0x8e9299, roughness: 0.35, metalness: 0.85 }),
		darkSteel: std({ color: 0x2d2f35, roughness: 0.45, metalness: 0.7 }),
		stone: std({ color: 0xd9d4c8, roughness: 0.8 }),
		white: std({ color: 0xf2f1ec, roughness: 0.6 }),
		glass: new MeshStandardMaterial({ color: 0xcfe4ff, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.32, side: DoubleSide, depthWrite: false }),
		canvasStripe: null,
	};
}

/** A physical sign board: painted panel, white lettering, violet rule. */
function signTexture(title, sub, accent = '#c4b5fd') {
	const canvas = document.createElement('canvas');
	canvas.width = 1024;
	canvas.height = 320;
	const g = canvas.getContext('2d');
	g.fillStyle = '#1b1b20';
	g.fillRect(0, 0, 1024, 320);
	g.fillStyle = accent;
	g.fillRect(64, 236, 896, 6);
	g.fillStyle = '#f5f5f7';
	g.textAlign = 'center';
	g.textBaseline = 'middle';
	g.font = '600 118px system-ui, -apple-system, "Segoe UI", sans-serif';
	g.fillText(title, 512, sub ? 120 : 160, 920);
	if (sub) {
		g.fillStyle = 'rgba(245,245,247,0.78)';
		g.font = '400 52px system-ui, -apple-system, "Segoe UI", sans-serif';
		g.fillText(sub, 512, 196, 920);
	}
	const tex = new CanvasTexture(canvas);
	tex.colorSpace = SRGBColorSpace;
	tex.anisotropy = 8;
	return tex;
}

function signBoard(title, sub, accent, w = 3.2) {
	const tex = signTexture(title, sub, accent);
	const board = new Mesh(new PlaneGeometry(w, w * 0.3125), new MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.3, roughness: 0.55 }));
	const back = new Mesh(new BoxGeometry(w + 0.08, w * 0.3125 + 0.08, 0.05), std({ color: 0x141418, roughness: 0.6 }));
	back.position.z = -0.03;
	const g = new Group();
	g.add(back, board);
	return g;
}

/** A sign on a post, for the places without a wall to hang one on. */
function signPost(title, sub, accent, mats) {
	const g = new Group();
	const post = new Mesh(new CylinderGeometry(0.04, 0.05, 2.6, 10), mats.paint);
	post.position.y = 1.3;
	const board = signBoard(title, sub, accent, 2.2);
	board.position.y = 2.3;
	g.add(post, board);
	return g;
}

/** Four strips of painted timber around an opening. */
function frameAround(w, h, depth, mat, t = 0.08) {
	const g = new Group();
	const side = new BoxGeometry(t, h + t * 2, depth);
	const top = new BoxGeometry(w + t * 2, t, depth);
	const l = new Mesh(side, mat);
	l.position.x = -w / 2 - t / 2;
	const r = new Mesh(side, mat);
	r.position.x = w / 2 + t / 2;
	const u = new Mesh(top, mat);
	u.position.y = h / 2 + t / 2;
	const d = new Mesh(top, mat);
	d.position.y = -h / 2 - t / 2;
	g.add(l, r, u, d);
	return g;
}

/* ---------------------------------------------------------- the shells */

const WALL_FRAMES = {
	front: (r) => ({ x: 0, z: r.d / 2, yaw: 0, inward: -1 }),
	back: (r) => ({ x: 0, z: -r.d / 2, yaw: 0, inward: 1 }),
	left: (r) => ({ x: -r.w / 2, z: 0, yaw: PI / 2, inward: 1 }),
	right: (r) => ({ x: r.w / 2, z: 0, yaw: PI / 2, inward: -1 }),
};

/**
 * Walls, floor, ceiling and roof of one room in its local frame. Returns the
 * group plus the meshes the camera must not pass through.
 */
function buildShell(room, surfaces, mats, { shadows }) {
	const g = new Group();
	const occluders = [];
	const wallMat = surfaces.material(room.wall);
	const wallTile = surfaces.metresPerTile(room.wall);
	const addShadow = (m, cast = true) => {
		m.castShadow = cast && shadows;
		m.receiveShadow = true;
		return m;
	};

	for (const wall of wallsOf(room)) {
		const frame = WALL_FRAMES[wall.side](room);
		const wg = new Group();
		wg.position.set(frame.x, 0, frame.z);
		wg.rotation.y = frame.yaw;
		for (const p of wall.pieces) {
			const hgt = p.y1 - p.y0;
			const geom = tileBox(new BoxGeometry(p.len, hgt, WALL), p.len, hgt, WALL, wallTile);
			const m = addShadow(new Mesh(geom, wallMat));
			m.position.set(wall.side === 'left' || wall.side === 'right' ? p.z : p.x, p.y0 + hgt / 2, 0);
			wg.add(m);
			occluders.push(m);
		}
		for (const o of wall.openings) {
			if (o.kind === 'window') {
				const pane = new Mesh(new PlaneGeometry(o.w, o.y1 - o.y0), mats.glass);
				pane.position.set(o.at, (o.y0 + o.y1) / 2, 0);
				const fr = frameAround(o.w, o.y1 - o.y0, WALL + 0.06, mats.paint);
				fr.position.copy(pane.position);
				const sill = new Mesh(new BoxGeometry(o.w + 0.3, 0.06, WALL + 0.2), mats.stone);
				sill.position.set(o.at, o.y0 - 0.03, 0);
				wg.add(pane, fr, sill);
			} else {
				const fr = frameAround(o.w, o.y1, WALL + 0.06, mats.darkWood, 0.1);
				fr.position.set(o.at, o.y1 / 2, 0);
				wg.add(fr);
				if (room.kind !== 'cave') {
					// The door stands open, swung inward on the left jamb.
					const pivot = new Group();
					pivot.position.set(o.at - o.w / 2, 0, 0);
					const leaf = addShadow(new Mesh(new BoxGeometry(o.w * 0.96, o.y1 * 0.985, 0.05), mats.darkWood));
					leaf.position.set((o.w * 0.96) / 2, (o.y1 * 0.985) / 2, 0);
					const handle = new Mesh(new CylinderGeometry(0.012, 0.012, 0.12, 8), mats.steel);
					handle.rotation.z = PI / 2;
					handle.position.set(o.w * 0.96 - 0.1, 1.0, -0.04);
					pivot.add(leaf, handle);
					pivot.rotation.y = -frame.inward * 1.72;
					wg.add(pivot);
				}
				const threshold = new Mesh(new BoxGeometry(o.w + 0.2, 0.02, WALL + 0.3), mats.stone);
				threshold.position.set(o.at, 0.03, 0);
				wg.add(threshold);
			}
		}
		g.add(wg);
	}

	// Floor and ceiling.
	const floorRole = room.floor === 'rock' ? 'rock' : `floor-${room.floor}`;
	const floor = new Mesh(tilePlane(new PlaneGeometry(room.w, room.d), room.w, room.d, surfaces.metresPerTile(floorRole)), surfaces.material(floorRole));
	floor.rotation.x = -PI / 2;
	floor.position.y = 0.025;
	floor.receiveShadow = true;
	g.add(floor);
	const ceilRole = room.kind === 'cave' ? 'rock' : 'wall';
	const ceiling = new Mesh(tilePlane(new PlaneGeometry(room.w, room.d), room.w, room.d, surfaces.metresPerTile(ceilRole)), surfaces.material(ceilRole));
	ceiling.rotation.x = PI / 2;
	ceiling.position.y = room.h - 0.02;
	g.add(ceiling);
	occluders.push(ceiling);

	// Roof.
	if (room.kind === 'room') {
		const roof = room.roof === 'flat' || room.skylight ? flatRoof(room, surfaces, mats, addShadow) : gableRoof(room, surfaces, mats, addShadow);
		g.add(roof);
		roof.traverse((m) => m.isMesh && occluders.push(m));
	}
	return { group: g, occluders };
}

export function gableRoof(room, surfaces, mats, addShadow) {
	const g = new Group();
	const pitch = MathUtils.degToRad(26);
	const over = 0.45;
	const half = room.d / 2 + over;
	const run = half / Math.cos(pitch);
	const rise = half * Math.tan(pitch);
	const roofMat = surfaces.material('roof');
	for (const s of [-1, 1]) {
		const slab = addShadow(new Mesh(tileBox(new BoxGeometry(room.w + over * 2, 0.16, run), room.w + over * 2, 0.16, run, surfaces.metresPerTile('roof')), roofMat));
		slab.position.set(0, room.h + rise / 2 + 0.06, (s * half) / 2);
		// +pitch for the +z slab and -pitch for the -z slab: each drops from the ridge to its own eave.
		slab.rotation.x = s * pitch;
		g.add(slab);
	}
	const ridge = new Mesh(new BoxGeometry(room.w + over * 2 + 0.1, 0.12, 0.3), mats.darkSteel);
	ridge.position.set(0, room.h + rise + 0.1, 0);
	g.add(ridge);
	// Gable ends close the triangle under each slope.
	const shape = new Shape();
	shape.moveTo(-room.d / 2, 0);
	shape.lineTo(room.d / 2, 0);
	shape.lineTo(0, rise);
	shape.closePath();
	for (const s of [-1, 1]) {
		const end = new Mesh(new ShapeGeometry(shape), new MeshStandardMaterial({ color: surfaces.material(room.wall).color, roughness: 0.85, side: DoubleSide }));
		end.rotation.y = PI / 2;
		end.position.set(s * (room.w / 2 - WALL / 2 - 0.01), room.h, 0);
		end.receiveShadow = true;
		g.add(end);
	}
	// Eaves boards.
	for (const s of [-1, 1]) {
		const fascia = new Mesh(new BoxGeometry(room.w + over * 2, 0.18, 0.05), mats.white);
		fascia.position.set(0, room.h - 0.02, s * (room.d / 2 + over));
		g.add(fascia);
	}
	return g;
}

function flatRoof(room, surfaces, mats, addShadow) {
	const g = new Group();
	const over = 0.3;
	const W = room.w + over * 2;
	const D = room.d + over * 2;
	const roofMat = surfaces.material('roof');
	const tile = surfaces.metresPerTile('roof');
	const y = room.h + 0.12;
	if (room.skylight) {
		const hole = 2.6;
		const side = (W - hole) / 2;
		const parts = [
			[-(hole / 2 + side / 2), 0, side, D],
			[hole / 2 + side / 2, 0, side, D],
			[0, -(hole / 2 + (D - hole) / 4), hole, (D - hole) / 2],
			[0, hole / 2 + (D - hole) / 4, hole, (D - hole) / 2],
		];
		for (const [x, z, w, d] of parts) {
			const m = addShadow(new Mesh(tileBox(new BoxGeometry(w, 0.24, d), w, 0.24, d, tile), roofMat));
			m.position.set(x, y, z);
			g.add(m);
		}
		const pane = new Mesh(new PlaneGeometry(hole, hole), mats.glass);
		pane.rotation.x = -PI / 2;
		pane.position.y = y + 0.1;
		const fr = frameAround(hole, hole, 0.1, mats.paint, 0.1);
		fr.rotation.x = -PI / 2;
		fr.position.y = y + 0.1;
		g.add(pane, fr);
	} else {
		const m = addShadow(new Mesh(tileBox(new BoxGeometry(W, 0.24, D), W, 0.24, D, tile), roofMat));
		m.position.y = y;
		g.add(m);
	}
	// Parapet.
	const lip = new Mesh(new BoxGeometry(W + 0.1, 0.2, 0.1), mats.stone);
	lip.position.set(0, y + 0.2, D / 2);
	const lip2 = lip.clone();
	lip2.position.z = -D / 2;
	const lip3 = new Mesh(new BoxGeometry(0.1, 0.2, D), mats.stone);
	lip3.position.set(W / 2, y + 0.2, 0);
	const lip4 = lip3.clone();
	lip4.position.x = -W / 2;
	g.add(lip, lip2, lip3, lip4);
	return g;
}

/** Hang a sign over the front door, on the outside face of the front wall. */
function doorSign(room, place, title = place.title, sub = place.sub) {
	const h = Math.min(0.8, room.h - room.door.h - 0.25);
	const sign = signBoard(title, sub, hex(hueColor(place.hue, 0.7)), h / 0.3125);
	sign.position.set(room.door.at, room.door.h + 0.15 + h / 2, room.d / 2 + WALL / 2 + 0.04);
	return sign;
}

/* ---------------------------------------------------------------- office */

function buildOffice(room, place, screenMaterial, surfaces, mats, opts) {
	const shell = buildShell(room, surfaces, mats, opts);
	const g = shell.group;
	const col = hueColor(place.hue);
	const TOP = 0.79; // the real desk's top (props.js: metal_office_desk)

	const brand = signBoard('three.ws', 'The 3D agent layer of the internet', hex(col), 3.6);
	brand.position.set(0, 2.25, -room.d / 2 + WALL / 2 + 0.04);
	g.add(brand);

	// Monitor: stand, bezel and the live screen plane.
	const mon = DESK_OBJECTS.find((o) => o.id === 'monitor');
	const stand = new Mesh(new CylinderGeometry(0.035, 0.05, 0.3, 10), mats.darkSteel);
	stand.position.set(mon.dx, TOP + 0.15, mon.dz);
	const foot = new Mesh(new CylinderGeometry(0.22, 0.24, 0.02, 20), mats.darkSteel);
	foot.position.set(mon.dx, TOP + 0.01, mon.dz);
	const bezel = new Mesh(new BoxGeometry(1.44, 0.84, 0.04), std({ color: 0x0b0b0e, roughness: 0.3, metalness: 0.4 }));
	bezel.position.set(mon.dx, 1.42, mon.dz);
	const screen = new Mesh(new PlaneGeometry(1.36, 0.765), screenMaterial);
	screen.position.set(mon.dx, 1.42, mon.dz + 0.021);
	screen.userData.hit = { type: 'object', id: 'monitor' };
	bezel.userData.hit = screen.userData.hit;
	g.add(stand, foot, bezel, screen);
	const screenLight = new PointLight(0x9d8cff, 0.6, 3, 2);
	screenLight.position.set(mon.dx, 1.5, mon.dz + 0.6);
	g.add(screenLight);

	// Keyboard and mouse.
	const kb = new Mesh(new BoxGeometry(0.44, 0.02, 0.15), std({ color: 0x1c1c21, roughness: 0.5 }));
	kb.position.set(0, TOP + 0.01, -0.12);
	const mouse = new Mesh(new SphereGeometry(0.035, 12, 8), std({ color: 0x1c1c21, roughness: 0.4 }));
	mouse.scale.set(1, 0.6, 1.5);
	mouse.position.set(0.34, TOP + 0.02, -0.12);
	g.add(kb, mouse);

	// Phone: a slab with a lit screen.
	const ph = DESK_OBJECTS.find((o) => o.id === 'phone');
	const phoneBody = new Mesh(new BoxGeometry(0.075, 0.012, 0.155), std({ color: 0x0c0c0f, roughness: 0.3, metalness: 0.6 }));
	phoneBody.position.set(ph.dx, TOP + 0.006, ph.dz);
	phoneBody.rotation.y = -0.35;
	phoneBody.userData.hit = { type: 'object', id: 'phone' };
	const phoneScreen = new Mesh(new PlaneGeometry(0.066, 0.142), glow(0x8b5cf6, 0.9));
	phoneScreen.rotation.x = -PI / 2;
	phoneScreen.rotation.z = -0.35;
	phoneScreen.position.set(ph.dx, TOP + 0.013, ph.dz);
	phoneScreen.userData.hit = phoneBody.userData.hit;
	g.add(phoneBody, phoneScreen);

	// Headset: a visor with a strap.
	const hs = DESK_OBJECTS.find((o) => o.id === 'headset');
	const visor = new Mesh(new BoxGeometry(0.22, 0.1, 0.11), std({ color: 0xe8e8ee, roughness: 0.35 }));
	visor.position.set(hs.dx, TOP + 0.06, hs.dz);
	visor.rotation.y = 0.4;
	visor.userData.hit = { type: 'object', id: 'headset' };
	const strap = new Mesh(new TorusGeometry(0.11, 0.012, 8, 24), std({ color: 0x2a2a30 }));
	strap.position.set(hs.dx - 0.02, TOP + 0.06, hs.dz - 0.07);
	strap.rotation.set(0, 0.4, 0);
	strap.userData.hit = visor.userData.hit;
	const lens = new Mesh(new PlaneGeometry(0.18, 0.06), glow(0x60a5fa, 0.8));
	lens.position.set(hs.dx + 0.04, TOP + 0.06, hs.dz + 0.057);
	lens.rotation.y = 0.4;
	lens.userData.hit = visor.userData.hit;
	g.add(visor, strap, lens);

	// Warm room light.
	const lamp = new PointLight(0xffe4c4, 0.9, 9, 2);
	lamp.position.set(0, room.h - 0.5, 0.8);
	g.add(lamp);

	const fr = roomFrame(room);
	g.position.set(fr.x, 0, fr.z);
	g.rotation.y = fr.yaw;
	return {
		group: g,
		occluders: shell.occluders,
		screen,
		sitFrom: new Vector3(place.x, 1.55, place.z + 1.9),
		sitTo: new Vector3(place.x + mon.dx, 1.42, place.z + mon.dz + 0.42),
		screenCentre: new Vector3(place.x + mon.dx, 1.42, place.z + mon.dz),
	};
}

/* -------------------------------------------------------------- exchange */

function buildExchange(room, place, tickerMaterial, surfaces, mats, opts) {
	const shell = buildShell({ ...room, roof: 'flat' }, surfaces, mats, opts);
	const g = shell.group;
	const occluders = shell.occluders;
	const hit = { type: 'place', id: place.id };
	g.add(doorSign(room, place));

	// Portico: columns, entablature, pediment and the ticker across the front.
	const stone = surfaces.material('floor-marble');
	for (const [x, z] of columnsOf(room)) {
		const c = new Mesh(new CylinderGeometry(0.36, 0.4, room.h, 18), stone);
		c.position.set(x, room.h / 2, z);
		c.castShadow = opts.shadows;
		c.receiveShadow = true;
		const cap = new Mesh(new BoxGeometry(1, 0.22, 1), mats.stone);
		cap.position.set(x, room.h - 0.11, z);
		const base = new Mesh(new BoxGeometry(1, 0.16, 1), mats.stone);
		base.position.set(x, 0.08, z);
		g.add(c, cap, base);
		occluders.push(c);
	}
	const porchDepth = 3;
	const porch = new Mesh(tileBox(new BoxGeometry(room.w + 0.6, 1.3, porchDepth), room.w + 0.6, 1.3, porchDepth, 3), mats.stone);
	porch.position.set(0, room.h + 0.65, room.d / 2 + porchDepth / 2);
	porch.castShadow = opts.shadows;
	g.add(porch);
	occluders.push(porch);
	const ped = new Mesh(new ConeGeometry(room.w / 2 + 0.5, 2.2, 4), mats.stone);
	ped.rotation.y = PI / 4;
	ped.scale.z = 0.24;
	ped.position.set(0, room.h + 1.3 + 1.1, room.d / 2 + porchDepth / 2);
	ped.castShadow = opts.shadows;
	g.add(ped);
	const patio = new Mesh(tilePlane(new PlaneGeometry(room.w + 0.6, porchDepth + 0.6), room.w + 0.6, porchDepth + 0.6, 3), stone);
	patio.rotation.x = -PI / 2;
	patio.position.set(0, 0.028, room.d / 2 + porchDepth / 2);
	patio.receiveShadow = true;
	g.add(patio);

	const board = new Mesh(new PlaneGeometry(13.4, 1.25), tickerMaterial);
	board.position.set(0, room.h + 0.65, room.d / 2 + porchDepth + 0.01);
	g.add(board);
	const board2 = new Mesh(new PlaneGeometry(11, 1.0), tickerMaterial);
	board2.position.set(0, room.h - 0.9, -room.d / 2 + WALL / 2 + 0.03);
	g.add(board2);

	// Trading floor: a raised dais and a brass rail where the quotes get shouted.
	const dais = new Mesh(new CylinderGeometry(1.6, 1.7, 0.18, 32), stone);
	dais.position.set(0, 0.09, -2.4);
	g.add(dais);
	const rail = new Mesh(new TorusGeometry(1.7, 0.03, 8, 48), std({ color: 0xc9a24a, roughness: 0.3, metalness: 0.9 }));
	rail.rotation.x = PI / 2;
	rail.position.set(0, 1.0, -2.4);
	g.add(rail);
	for (let i = 0; i < 6; i++) {
		const a = (i / 6) * PI * 2;
		const post = new Mesh(new CylinderGeometry(0.025, 0.025, 1, 8), std({ color: 0xc9a24a, roughness: 0.3, metalness: 0.9 }));
		post.position.set(Math.cos(a) * 1.7, 0.5, -2.4 + Math.sin(a) * 1.7);
		g.add(post);
	}

	for (const x of [-3.4, 3.4]) {
		const light = new PointLight(0xffe9d0, 0.9, 12, 2);
		light.position.set(x, room.h - 1.2, 0);
		g.add(light);
	}

	g.traverse((o) => { if (o.isMesh && o.material !== tickerMaterial && !o.userData.hit) o.userData.hit = hit; });
	const fr = roomFrame(room);
	g.position.set(fr.x, 0, fr.z);
	g.rotation.y = fr.yaw;
	return { group: g, occluders, localSolids: [{ x: 0, z: -2.4, keepout: 2.1 }] };
}

/* ------------------------------------------------------------- launchpad */

function buildLaunchpad(room, place, surfaces, mats, opts) {
	const g = new Group();
	const col = hueColor(place.hue);
	const hit = { type: 'place', id: place.id };
	const pad = new Mesh(tilePlane(new CircleGeometry(room.r, 48), room.r * 2, room.r * 2, surfaces.metresPerTile('floor-concrete')), surfaces.material('floor-concrete'));
	pad.rotation.x = -PI / 2;
	pad.position.y = 0.022;
	pad.receiveShadow = true;
	g.add(pad);
	const ring = new Mesh(new RingGeometry(4.2, 4.5, 64), std({ color: 0xf3c13a, roughness: 0.8 }));
	ring.rotation.x = -PI / 2;
	ring.position.y = 0.03;
	g.add(ring);
	const cross = new Mesh(new PlaneGeometry(0.3, 3), std({ color: 0xf3c13a, roughness: 0.8 }));
	cross.rotation.x = -PI / 2;
	cross.position.set(1.2, 0.03, 0);
	const cross2 = cross.clone();
	cross2.rotation.z = PI / 2;
	g.add(cross, cross2);

	// Rocket on its stand.
	const rocket = new Group();
	const hull = std({ color: 0xf4f4f6, roughness: 0.32, metalness: 0.3 });
	const trim = std({ color: 0xe8552b, roughness: 0.4, metalness: 0.2 });
	const body = new Mesh(new CylinderGeometry(0.9, 1.0, 6, 28), hull);
	body.position.y = 3.5;
	const band = new Mesh(new CylinderGeometry(0.905, 0.905, 0.5, 28), trim);
	band.position.y = 5.6;
	const band2 = new Mesh(new CylinderGeometry(0.98, 1.0, 0.4, 28), mats.darkSteel);
	band2.position.y = 0.7;
	const nose = new Mesh(new ConeGeometry(0.9, 2.2, 28), trim);
	nose.position.y = 7.6;
	rocket.add(body, band, band2, nose);
	for (let i = 0; i < 3; i++) {
		const fin = new Mesh(new BoxGeometry(0.1, 1.8, 1.3), trim);
		const a = (i / 3) * PI * 2;
		fin.position.set(Math.cos(a) * 1.3, 1.3, Math.sin(a) * 1.3);
		fin.rotation.y = -a;
		rocket.add(fin);
	}
	const porthole = new Mesh(new CylinderGeometry(0.3, 0.3, 0.05, 20), std({ color: 0x9cc8ff, roughness: 0.1, metalness: 0.3 }));
	porthole.rotation.x = PI / 2;
	porthole.position.set(0, 5.0, 0.98);
	rocket.add(porthole);
	for (let i = 0; i < 4; i++) {
		const a = (i / 4) * PI * 2 + PI / 4;
		const nozzle = new Mesh(new CylinderGeometry(0.22, 0.3, 0.5, 14, 1, true), new MeshStandardMaterial({ color: 0x55575c, roughness: 0.5, metalness: 0.8, side: DoubleSide }));
		nozzle.position.set(Math.cos(a) * 0.45, 0.25, Math.sin(a) * 0.45);
		rocket.add(nozzle);
	}
	const flame = new Mesh(new ConeGeometry(0.5, 1.2, 16, 1, true), glow(hueColor(place.hue, 0.7), 1.4));
	flame.rotation.x = PI;
	flame.position.y = -0.3;
	flame.material.transparent = true;
	flame.material.opacity = 0.55;
	flame.material.side = DoubleSide;
	rocket.add(flame);
	rocket.traverse((o) => { o.userData.hit = hit; if (o.isMesh) o.castShadow = opts.shadows; });
	rocket.position.set(1.2, 0.55, 0);
	g.add(rocket);
	const cradle = new Mesh(new CylinderGeometry(1.5, 1.7, 0.55, 8), mats.darkSteel);
	cradle.position.set(1.2, 0.27, 0);
	g.add(cradle);

	// Gantry tower.
	const tower = new Group();
	for (const [x, z] of [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) {
		const leg = new Mesh(new BoxGeometry(0.1, 8.5, 0.1), mats.steel);
		leg.position.set(x, 4.25, z);
		tower.add(leg);
	}
	for (const y of [2, 4, 6, 8]) {
		const ringBeam = new Mesh(new BoxGeometry(0.7, 0.08, 0.7), mats.steel);
		ringBeam.position.y = y;
		tower.add(ringBeam);
		const arm = new Mesh(new BoxGeometry(1.5, 0.1, 0.1), mats.steel);
		arm.position.set(-1.0, y + 0.2, 0);
		tower.add(arm);
	}
	tower.position.set(3.6, 0, 0);
	tower.traverse((o) => { o.userData.hit = hit; if (o.isMesh) o.castShadow = opts.shadows; });
	g.add(tower);
	const sign = signPost(place.title, place.sub, hex(col), mats);
	sign.position.set(-3.2, 0, 5.6);
	g.add(sign);
	const fr = roomFrame(room);
	g.position.set(fr.x, 0, fr.z);
	g.rotation.y = fr.yaw;
	return { group: g, rocket, flame, occluders: [body] };
}

/* ------------------------------------------------------------------ mine */

function buildMine(room, place, surfaces, mats, opts) {
	const shell = buildShell(room, surfaces, mats, opts);
	const g = shell.group;
	const occluders = shell.occluders;
	const rock = surfaces.material('rock');

	// The hill the cave is cut into.
	const hill = new Mesh(tilePlane(new SphereGeometry(1, 40, 24), 2 * PI * 13, PI * 6.5, surfaces.metresPerTile('rock')), rock);
	hill.scale.set(13.5, 6.8, 11);
	hill.position.set(0, 0, -4);
	hill.castShadow = opts.shadows;
	hill.receiveShadow = true;
	g.add(hill);
	occluders.push(hill);
	// Grass creeps over the top of the hill.
	const cap = new Mesh(tilePlane(new SphereGeometry(1, 32, 16, 0, PI * 2, 0, PI / 2.6), 60, 12, 3), surfaces.material('ground'));
	cap.scale.set(13.0, 6.9, 10.6);
	cap.position.set(0, 0.05, -4);
	g.add(cap);

	// Portal timbers.
	for (const x of [-1.85, 1.85]) {
		const post = new Mesh(new BoxGeometry(0.3, room.door.h, 0.35), mats.darkWood);
		post.position.set(x, room.door.h / 2, room.d / 2);
		post.castShadow = opts.shadows;
		g.add(post);
	}
	const lintel = new Mesh(new BoxGeometry(4.2, 0.32, 0.4), mats.darkWood);
	lintel.position.set(0, room.door.h + 0.16, room.d / 2);
	g.add(lintel);
	const sign = signBoard(place.title, place.sub, hex(hueColor(place.hue, 0.7)), 2.4);
	sign.position.set(0, room.door.h + 0.85, room.d / 2 + 0.25);
	g.add(sign);

	// Rails from the daylight to the face, a cart, timber props along the walls.
	const railLen = room.d / 2 + 3 + 4;
	for (const dx of [-0.38, 0.38]) {
		const rail = new Mesh(new BoxGeometry(0.06, 0.06, railLen), mats.darkSteel);
		rail.position.set(dx, 0.06, (room.d / 2 + 3 - 4) / 2);
		g.add(rail);
	}
	for (let z = -4; z < room.d / 2 + 3; z += 0.7) {
		const sleeper = new Mesh(new BoxGeometry(1.1, 0.06, 0.18), mats.darkWood);
		sleeper.position.set(0, 0.03, z);
		g.add(sleeper);
	}
	const cart = new Group();
	const tub = new Mesh(new BoxGeometry(0.95, 0.55, 1.25), std({ color: 0x4a4a52, metalness: 0.6, roughness: 0.5 }));
	tub.position.y = 0.5;
	cart.add(tub);
	for (const [x, z] of [[-0.45, -0.4], [0.45, -0.4], [-0.45, 0.4], [0.45, 0.4]]) {
		const wheel = new Mesh(new CylinderGeometry(0.16, 0.16, 0.08, 14), mats.darkSteel);
		wheel.rotation.z = PI / 2;
		wheel.position.set(x, 0.16, z);
		cart.add(wheel);
	}
	const ore = new Mesh(new SphereGeometry(0.45, 10, 8), rock);
	ore.scale.set(1, 0.5, 1.2);
	ore.position.y = 0.8;
	cart.add(ore);
	cart.position.set(0, 0, 3.6);
	cart.traverse((o) => { if (o.isMesh) o.castShadow = opts.shadows; });
	g.add(cart);
	for (const x of [-room.w / 2 + 0.6, room.w / 2 - 0.6]) {
		for (const z of [-3.5, 0, 3.5]) {
			const prop = new Mesh(new BoxGeometry(0.22, room.h - 0.1, 0.22), mats.darkWood);
			prop.position.set(x, (room.h - 0.1) / 2, z);
			g.add(prop);
		}
	}
	for (const x of [-room.w / 2 + 0.6, room.w / 2 - 0.6]) {
		const beam = new Mesh(new BoxGeometry(0.22, 0.22, room.d - 1), mats.darkWood);
		beam.position.set(x, room.h - 0.2, 0);
		g.add(beam);
	}

	// Veins: clusters of crystal, one per gem colour, lit from inside.
	const veins = [];
	const palette = GEMS.map((gm) => gm.hex);
	VEINS.forEach((v, i) => {
		const cluster = new Group();
		const colour = palette[(i + 1) % palette.length];
		const mat = new MeshStandardMaterial({ color: colour, emissive: colour, emissiveIntensity: 0.55, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.92 });
		for (let k = 0; k < 5; k++) {
			const s = 0.22 + Math.random() * 0.32;
			const crystal = new Mesh(new OctahedronGeometry(s, 0), mat);
			crystal.scale.y = 1.8 + Math.random();
			const a = (k / 5) * PI * 2 + i;
			crystal.position.set(Math.cos(a) * 0.35, s * 1.1, Math.sin(a) * 0.35);
			crystal.rotation.set(Math.random() * 0.5 - 0.25, a, Math.random() * 0.5 - 0.25);
			crystal.userData.hit = { type: 'vein', id: v.id };
			cluster.add(crystal);
		}
		const rubble = new Mesh(new SphereGeometry(0.75, 10, 7), rock);
		rubble.scale.set(1.2, 0.35, 1.2);
		rubble.position.y = -0.05;
		cluster.add(rubble);
		const light = new PointLight(colour, 0.6, 3.5, 2);
		light.position.y = 0.6;
		cluster.add(light);
		cluster.position.set(v.dx, 0, v.dz);
		g.add(cluster);
		veins.push({ id: v.id, group: cluster, material: mat, light, x: place.x + v.dx, z: place.z + v.dz, phase: i * 1.3 });
	});

	const fr = roomFrame(room);
	g.position.set(fr.x, 0, fr.z);
	g.rotation.y = fr.yaw;
	return { group: g, veins, occluders };
}

/* ----------------------------------------------------------------- forge */

function buildForge(room, place, surfaces, mats, opts) {
	const shell = buildShell(room, surfaces, mats, opts);
	const g = shell.group;
	const hit = { type: 'place', id: place.id };
	g.add(doorSign(room, place));
	const brick = surfaces.material('brick');

	// Furnace, its mouth and the chimney through the roof.
	const furnace = new Mesh(tileBox(new BoxGeometry(1.6, 2.2, 1.2), 1.6, 2.2, 1.2, 1.5), brick);
	furnace.position.set(1.9, 1.1, -2.2);
	furnace.castShadow = opts.shadows;
	const mouth = new Mesh(new PlaneGeometry(0.7, 0.5), glow(0xff7a2a, 1.8));
	mouth.position.set(1.9, 0.85, -1.59);
	const fire = new PointLight(0xff8a3c, 1.4, 6, 2);
	fire.position.set(1.9, 0.9, -1.2);
	const chimney = new Mesh(tileBox(new BoxGeometry(0.6, 3.4, 0.6), 0.6, 3.4, 0.6, 1.5), brick);
	chimney.position.set(1.9, room.h + 0.9, -2.2);
	chimney.castShadow = opts.shadows;
	g.add(furnace, mouth, fire, chimney);

	// Workbench with an anvil and a quench bucket.
	const bench = new Mesh(new BoxGeometry(2.0, 0.08, 0.7), mats.wood);
	bench.position.set(-0.5, 0.86, -2.35);
	for (const x of [-1.4, 0.4]) for (const z of [-2.65, -2.05]) {
		const leg = new Mesh(new BoxGeometry(0.08, 0.84, 0.08), mats.wood);
		leg.position.set(x, 0.42, z);
		g.add(leg);
	}
	const anvil = new Mesh(new BoxGeometry(0.55, 0.22, 0.2), mats.darkSteel);
	anvil.position.set(-0.9, 1.01, -2.35);
	const horn = new Mesh(new ConeGeometry(0.08, 0.3, 10), mats.darkSteel);
	horn.rotation.z = PI / 2;
	horn.position.set(-0.5, 1.03, -2.35);
	const bucket = new Mesh(new CylinderGeometry(0.2, 0.17, 0.4, 14, 1, true), new MeshStandardMaterial({ color: 0x555a62, metalness: 0.7, roughness: 0.5, side: DoubleSide }));
	bucket.position.set(0.6, 0.2, -1.6);
	g.add(bench, anvil, horn, bucket);
	g.traverse((o) => { if (o.isMesh && !o.userData.hit) o.userData.hit = hit; });

	const fr = roomFrame(room);
	g.position.set(fr.x, 0, fr.z);
	g.rotation.y = fr.yaw;
	return { group: g, occluders: shell.occluders, pulse: [mouth.material], localSolids: [{ box: [1.9, -2.2, 1.6, 1.2] }, { box: [-0.5, -2.35, 2.0, 0.7] }] };
}

/* --------------------------------------------------------------- gallery */

function buildGallery(room, place, surfaces, mats, opts) {
	const shell = buildShell(room, surfaces, mats, opts);
	const g = shell.group;
	const hit = { type: 'place', id: place.id };
	g.add(doorSign(room, place));
	const inset = WALL / 2 + 0.035;
	const spots = [
		{ x: -2.1, z: -room.d / 2 + inset, yaw: 0 },
		{ x: 0, z: -room.d / 2 + inset, yaw: 0 },
		{ x: 2.1, z: -room.d / 2 + inset, yaw: 0 },
		{ x: -room.w / 2 + inset, z: -1.6, yaw: PI / 2 },
		{ x: -room.w / 2 + inset, z: 0.8, yaw: PI / 2 },
		{ x: room.w / 2 - inset, z: -1.6, yaw: -PI / 2 },
		{ x: room.w / 2 - inset, z: 0.8, yaw: -PI / 2 },
	];
	const frames = spots.map((s) => {
		const holder = new Group();
		holder.position.set(s.x, 1.65, s.z);
		holder.rotation.y = s.yaw;
		const frame = new Mesh(new BoxGeometry(1.08, 1.08, 0.06), mats.darkWood);
		const art = new Mesh(new PlaneGeometry(0.92, 0.92), new MeshStandardMaterial({ color: 0xe9e6df, roughness: 0.7 }));
		art.position.z = 0.035;
		const plate = new Mesh(new PlaneGeometry(0.6, 0.12), new MeshStandardMaterial({ color: 0xd9d4c8, roughness: 0.5 }));
		plate.position.set(0, -0.7, 0.01);
		const spot = new PointLight(0xfff2dc, 0.35, 3, 2);
		spot.position.set(0, 1.1, 0.8);
		holder.add(frame, art, plate, spot);
		g.add(holder);
		return { art, plate };
	});
	g.traverse((o) => { if (o.isMesh && !o.userData.hit) o.userData.hit = hit; });
	const fr = roomFrame(room);
	g.position.set(fr.x, 0, fr.z);
	g.rotation.y = fr.yaw;
	return { group: g, occluders: shell.occluders, frames };
}

/* ----------------------------------------------------------- agent plaza */

function buildPlaza(room, place, surfaces, mats, opts) {
	const g = new Group();
	const col = hueColor(place.hue);
	const hit = { type: 'place', id: place.id };
	const paving = new Mesh(tilePlane(new CircleGeometry(room.r, 56), room.r * 2, room.r * 2, surfaces.metresPerTile('plaza')), surfaces.material('plaza'));
	paving.rotation.x = -PI / 2;
	paving.position.y = 0.022;
	paving.receiveShadow = true;
	g.add(paving);
	// Pergola.
	const r = room.pergola / 2;
	for (const [x, z] of [[-r, -r], [r, -r], [-r, r], [r, r]]) {
		const post = new Mesh(new BoxGeometry(0.22, 2.8, 0.22), mats.wood);
		post.position.set(x, 1.4, z);
		post.castShadow = opts.shadows;
		g.add(post);
	}
	for (const z of [-r, r]) {
		const beam = new Mesh(new BoxGeometry(room.pergola + 0.8, 0.16, 0.16), mats.wood);
		beam.position.set(0, 2.85, z);
		beam.castShadow = opts.shadows;
		g.add(beam);
	}
	for (let i = 0; i < 9; i++) {
		const slat = new Mesh(new BoxGeometry(0.08, 0.14, room.pergola + 0.8), mats.wood);
		slat.position.set(-r + (i / 8) * room.pergola, 3.0, 0);
		slat.castShadow = opts.shadows;
		g.add(slat);
	}
	// A small fountain in the middle: the plaza's centrepiece.
	const basin = new Mesh(new CylinderGeometry(1.0, 1.1, 0.45, 32, 1, true), new MeshStandardMaterial({ color: 0xd9d4c8, roughness: 0.8, side: DoubleSide }));
	basin.position.y = 0.225;
	const water = new Mesh(new CircleGeometry(0.98, 32), new MeshStandardMaterial({ color: 0x6fa3d8, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.85 }));
	water.rotation.x = -PI / 2;
	water.position.y = 0.38;
	const column = new Mesh(new CylinderGeometry(0.12, 0.16, 0.9, 12), mats.stone);
	column.position.y = 0.6;
	const bowl = new Mesh(new CylinderGeometry(0.4, 0.1, 0.2, 20, 1, true), new MeshStandardMaterial({ color: 0xd9d4c8, roughness: 0.8, side: DoubleSide }));
	bowl.position.y = 1.1;
	g.add(basin, water, column, bowl);
	const sign = signPost(place.title, place.sub, hex(col), mats);
	sign.position.set(2.4, 0, room.r - 0.6);
	g.add(sign);
	g.traverse((o) => { if (o.isMesh && !o.userData.hit) o.userData.hit = hit; });
	const fr = roomFrame(room);
	g.position.set(fr.x, 0, fr.z);
	g.rotation.y = fr.yaw;
	return { group: g, occluders: [], localSolids: [{ x: 0, z: 0, keepout: 1.4 }] };
}

/* ---------------------------------------------------------------- market */

function stripeTexture(a, b) {
	const canvas = document.createElement('canvas');
	canvas.width = 256;
	canvas.height = 64;
	const g = canvas.getContext('2d');
	for (let i = 0; i < 8; i++) {
		g.fillStyle = i % 2 ? a : b;
		g.fillRect(i * 32, 0, 32, 64);
	}
	const tex = new CanvasTexture(canvas);
	tex.colorSpace = SRGBColorSpace;
	return tex;
}

function buildMarket(room, place, surfaces, mats, opts) {
	const g = new Group();
	const col = hueColor(place.hue);
	const hit = { type: 'place', id: place.id };
	const floor = new Mesh(tilePlane(new PlaneGeometry(room.w + 1, room.d + 1), room.w + 1, room.d + 1, surfaces.metresPerTile('plaza')), surfaces.material('plaza'));
	floor.rotation.x = -PI / 2;
	floor.position.y = 0.022;
	floor.receiveShadow = true;
	g.add(floor);
	for (const [x, z] of room.posts) {
		const post = new Mesh(new CylinderGeometry(0.13, 0.15, room.h, 12), mats.wood);
		post.position.set(x, room.h / 2, z);
		post.castShadow = opts.shadows;
		g.add(post);
	}
	for (const z of [-3.2, 3.2]) {
		const beam = new Mesh(new BoxGeometry(room.w + 0.6, 0.18, 0.18), mats.wood);
		beam.position.set(0, room.h, z);
		g.add(beam);
	}
	const roof = gableRoof({ ...room, wall: 'wall' }, surfaces, mats, (m) => { m.castShadow = opts.shadows; m.receiveShadow = true; return m; });
	g.add(roof);
	const occluders = [];
	roof.traverse((m) => m.isMesh && occluders.push(m));

	// Stalls: timber counters under striped canvas.
	const stripes = [stripeTexture('#c93b3b', '#f4f1ea'), stripeTexture('#2d6cb5', '#f4f1ea')];
	const stalls = [{ x: 1.6, z: -2.0, yaw: 0 }, { x: 3.9, z: 0.2, yaw: -PI / 2 }];
	stalls.forEach((s, i) => {
		const st = new Group();
		const counter = new Mesh(new BoxGeometry(2.0, 0.95, 0.8), mats.wood);
		counter.position.y = 0.475;
		counter.castShadow = opts.shadows;
		const top = new Mesh(new BoxGeometry(2.1, 0.05, 0.9), mats.darkWood);
		top.position.y = 0.975;
		const canopy = new Mesh(new PlaneGeometry(2.4, 1.3), new MeshStandardMaterial({ map: stripes[i], roughness: 0.9, side: DoubleSide }));
		canopy.rotation.x = -PI / 2 + 0.35;
		canopy.position.set(0, 2.25, 0.25);
		for (const x of [-1.1, 1.1]) {
			const post = new Mesh(new CylinderGeometry(0.03, 0.03, 2.2, 8), mats.paint);
			post.position.set(x, 1.1, 0.75);
			st.add(post);
		}
		for (let k = 0; k < 3; k++) {
			const crate = new Mesh(new BoxGeometry(0.4, 0.22, 0.3), mats.wood);
			crate.position.set(-0.7 + k * 0.7, 1.11, 0.05);
			const fruit = new Mesh(new SphereGeometry(0.17, 10, 8), std({ color: [0xe25822, 0x6fbf3b, 0xf2c14e][k], roughness: 0.6 }));
			fruit.scale.y = 0.5;
			fruit.position.set(-0.7 + k * 0.7, 1.27, 0.05);
			st.add(crate, fruit);
		}
		st.add(counter, top, canopy);
		st.position.set(s.x, 0, s.z);
		st.rotation.y = s.yaw;
		g.add(st);
	});
	const sign = signPost(place.title, place.sub, hex(col), mats);
	sign.position.set(-4.8, 0, 3.0);
	g.add(sign);
	for (const x of [-2.2, 2.2]) {
		const light = new PointLight(0xffe9d0, 0.5, 8, 2);
		light.position.set(x, room.h - 0.6, 0);
		g.add(light);
	}
	g.traverse((o) => { if (o.isMesh && !o.userData.hit) o.userData.hit = hit; });
	const fr = roomFrame(room);
	g.position.set(fr.x, 0, fr.z);
	g.rotation.y = fr.yaw;
	return { group: g, occluders, localSolids: stalls.map((s) => ({ box: [s.x, s.z, 2.1, 0.9], yaw: s.yaw })) };
}

/* ---------------------------------------------------------- the grounds */

/** A path stops at a building's door, or at the edge of an open-air place. */
function pathEnd(place) {
	const room = ROOMS.find((r) => r.place === place.id);
	if (room?.door) return doorPoints(room, 0.3).outside;
	const office = placeById('office');
	const a = Math.atan2(place.x - office.x, place.z - office.z);
	const edge = room?.r ? room.r - 0.4 : room?.w ? Math.min(room.w, room.d) / 2 - 0.3 : 1;
	return { x: place.x - Math.sin(a) * edge, z: place.z - Math.cos(a) * edge };
}

function buildGrounds(surfaces, mats, { shadows }) {
	const g = new Group();
	const occluders = [];
	const ground = new Mesh(tilePlane(new CircleGeometry(210, 96), 420, 420, surfaces.metresPerTile('ground')), surfaces.material('ground'));
	ground.rotation.x = -PI / 2;
	ground.receiveShadow = true;
	ground.raycast = () => {};
	g.add(ground);

	// The plaza round the office and the paths out to every place.
	const office = placeById('office');
	const plaza = new Mesh(tilePlane(new CylinderGeometry(11, 11, 0.03, 64), 22, 22, surfaces.metresPerTile('plaza')), surfaces.material('plaza'));
	plaza.position.set(office.x, 0.015, office.z);
	plaza.receiveShadow = true;
	g.add(plaza);
	const kerb = new Mesh(new RingGeometry(11, 11.3, 64), mats.stone);
	kerb.rotation.x = -PI / 2;
	kerb.position.set(office.x, 0.018, office.z);
	g.add(kerb);
	const path = (ax, az, bx, bz, w) => {
		const dx = bx - ax;
		const dz = bz - az;
		const len = Math.hypot(dx, dz);
		const m = new Mesh(tileBox(new BoxGeometry(w, 0.03, len), w, 0.03, len, surfaces.metresPerTile('path')), surfaces.material('path'));
		m.position.set((ax + bx) / 2, 0.02, (az + bz) / 2);
		m.rotation.y = Math.atan2(dx, dz);
		m.receiveShadow = true;
		g.add(m);
	};
	path(0, CAMPUS_RADIUS - 2, 0, office.z + 3.5, 3.2);
	for (const p of PLACES) {
		if (p.id === 'office') continue;
		const a = Math.atan2(p.x - office.x, p.z - office.z);
		const end = pathEnd(p);
		path(office.x + Math.sin(a) * 10.5, office.z + Math.cos(a) * 10.5, end.x, end.z, 3);
	}

	// The gate: brick piers and the welcome board.
	for (const sx of [-3.2, 3.2]) {
		const pier = new Mesh(tileBox(new BoxGeometry(0.7, 2.8, 0.7), 0.7, 2.8, 0.7, surfaces.metresPerTile('brick')), surfaces.material('brick'));
		pier.position.set(sx, 1.4, GATE_Z);
		pier.castShadow = shadows;
		pier.receiveShadow = true;
		const cap = new Mesh(new BoxGeometry(0.9, 0.12, 0.9), mats.stone);
		cap.position.set(sx, 2.86, GATE_Z);
		const lampHead = new Mesh(new SphereGeometry(0.16, 12, 8), glow(0xfff1d6, 1.2));
		lampHead.position.set(sx, 3.1, GATE_Z);
		g.add(pier, cap, lampHead);
		occluders.push(pier);
	}
	const beam = new Mesh(new BoxGeometry(7.2, 0.14, 0.14), mats.darkSteel);
	beam.position.set(0, 3.9, GATE_Z);
	g.add(beam);
	const welcome = signBoard('Welcome to three.ws', 'The 3D agent layer of the internet', '#c4b5fd', 4.6);
	welcome.position.set(0, 3.1, GATE_Z);
	welcome.rotation.y = PI;
	g.add(welcome);
	const welcomeBack = signBoard('three.ws', 'Walk in. Meet the agents.', '#c4b5fd', 4.6);
	welcomeBack.position.set(0, 3.1, GATE_Z + 0.06);
	g.add(welcomeBack);
	// A low wall either side of the gate, in line with the hedge.
	for (const sx of [-1, 1]) {
		const wall = new Mesh(tileBox(new BoxGeometry(12, 1.1, 0.4), 12, 1.1, 0.4, surfaces.metresPerTile('brick')), surfaces.material('brick'));
		wall.position.set(sx * 9.6, 0.55, GATE_Z);
		wall.rotation.y = sx * 0.22;
		wall.castShadow = shadows;
		wall.receiveShadow = true;
		g.add(wall);
		occluders.push(wall);
	}

	// Far hills on the horizon, softened by the haze.
	let seed = 7;
	const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
	const hillMat = std({ color: 0x6f8c5a, roughness: 1 });
	for (let i = 0; i < 18; i++) {
		const a = (i / 18) * PI * 2 + rnd() * 0.2;
		const r = 150 + rnd() * 40;
		const hill = new Mesh(new SphereGeometry(1, 18, 10), hillMat);
		hill.scale.set(45 + rnd() * 40, 12 + rnd() * 16, 30 + rnd() * 20);
		hill.position.set(Math.sin(a) * r, -2, Math.cos(a) * r);
		hill.rotation.y = rnd() * PI;
		hill.raycast = () => {};
		g.add(hill);
	}
	return { group: g, occluders };
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ screenMaterial: import('three').Material, tickerMaterial: import('three').Material, reducedMotion?: boolean }} o
 */
export function createCampus(canvas, { screenMaterial, tickerMaterial, reducedMotion = false }) {
	const renderer = createRenderer(
		{ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' },
		{ fallback: canvas.parentElement },
	);
	// `?quality=high|medium|mobile` overrides the detected tier (support, QA, slow laptops).
	const asked = new URLSearchParams(location.search).get(QUALITY_PARAM);
	const tierName = asked === 'high' || asked === 'medium' || asked === 'mobile' ? asked : detectQualityTier({ gl: renderer.getContext() });
	const tier = applyCinematicDefaults(renderer, { tier: tierName, exposure: 0.92 });
	renderer.setSize(innerWidth, innerHeight, false);
	const shadows = !!tier.shadows;
	const opts = { shadows };

	const scene = new Scene();
	scene.background = new Color(HORIZON);
	scene.fog = new Fog(HORIZON, 70, 190);
	const camera = new PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 420);

	// Daylight: a physical sky, the sun, the sky's bounce, and the outdoor HDRI for reflections.
	const sky = new Sky();
	sky.scale.setScalar(400);
	sky.raycast = () => {};
	const su = sky.material.uniforms;
	su.turbidity.value = 2.6;
	su.rayleigh.value = 1.1;
	su.mieCoefficient.value = 0.004;
	su.mieDirectionalG.value = 0.8;
	const sunDir = new Vector3().setFromSphericalCoords(1, MathUtils.degToRad(90 - SUN_ELEVATION), MathUtils.degToRad(SUN_AZIMUTH));
	su.sunPosition.value.copy(sunDir);
	scene.add(sky);
	const sun = new DirectionalLight(0xfff0dc, 2.8);
	sun.position.copy(sunDir).multiplyScalar(70);
	sun.castShadow = shadows;
	if (shadows) {
		const size = tierName === 'high' ? 2048 : 1024;
		sun.shadow.mapSize.set(size, size);
		sun.shadow.camera.left = sun.shadow.camera.bottom = -28;
		sun.shadow.camera.right = sun.shadow.camera.top = 28;
		sun.shadow.camera.near = 5;
		sun.shadow.camera.far = 160;
		sun.shadow.bias = -0.0004;
		sun.shadow.normalBias = 0.04;
		sun.shadow.radius = 3;
		sun.shadow.blurSamples = 8;
	}
	scene.add(sun, sun.target);
	scene.add(new HemisphereLight(0xcfe0ff, 0x5f6e45, 0.65));
	scene.environmentIntensity = 0.55;
	loadEnvironment(renderer, scene, 'outdoor', { tier: tierName }).catch((err) => log.warn('world/campus', 'environment', err?.message || err));

	const surfaces = createSurfaces({ normals: tierName !== 'mobile', anisotropy: tierName === 'high' ? 8 : 4 });
	surfaces.ready.catch((err) => log.warn('world/campus', 'surfaces', err?.message || err));
	const mats = sharedMaterials();

	const grounds = buildGrounds(surfaces, mats, opts);
	scene.add(grounds.group);

	// Buildings.
	const room = (id) => ROOMS.find((r) => r.id === id);
	const office = buildOffice(room('office'), placeById('office'), screenMaterial, surfaces, mats, opts);
	const exchange = buildExchange(room('exchange'), placeById('exchange'), tickerMaterial, surfaces, mats, opts);
	const launchpad = buildLaunchpad(room('pad'), placeById('launchpad'), surfaces, mats, opts);
	const cabin = buildShell(room('cabin'), surfaces, mats, opts);
	cabin.group.add(doorSign(room('cabin'), placeById('launchpad'), 'Mission control', 'Launch desk'));
	const cabinLight = new PointLight(0xffe4c4, 0.6, 5, 2);
	cabinLight.position.set(0, room('cabin').h - 0.4, 0);
	cabin.group.add(cabinLight);
	cabin.group.traverse((o) => { if (o.isMesh) o.userData.hit = { type: 'place', id: 'launchpad' }; });
	{
		const fr = roomFrame(room('cabin'));
		cabin.group.position.set(fr.x, 0, fr.z);
		cabin.group.rotation.y = fr.yaw;
	}
	const mine = buildMine(room('mine'), placeById('mine'), surfaces, mats, opts);
	const forge = buildForge(room('forge'), placeById('forge'), surfaces, mats, opts);
	const gallery = buildGallery(room('gallery'), placeById('gallery'), surfaces, mats, opts);
	const plaza = buildPlaza(room('plaza'), placeById('agents'), surfaces, mats, opts);
	const market = buildMarket(room('market'), placeById('market'), surfaces, mats, opts);
	const buildings = [office, exchange, launchpad, cabin, mine, forge, gallery, plaza, market];
	for (const b of buildings) scene.add(b.group);
	const occluders = buildings.flatMap((b) => b.occluders).concat(grounds.occluders);

	// Solids: every wall (through its door), the furniture, the rocket and the
	// posts, the desk and the veins. Places themselves are walk-in now, so
	// their keep-out radii drive prompts and stand points, not collision.
	const solids = allRoomSolids();
	const o = placeById('office');
	solids.push({ group: { position: new Vector3(o.x, 0, o.z - 0.5) }, keepout: 1.35 });
	for (const v of mine.veins) solids.push({ group: { position: new Vector3(v.x, 0, v.z) }, keepout: 0.75 });
	const localSolid = (b, roomId) => {
		const fr = roomFrame(room(roomId));
		const sin = Math.sin(fr.yaw);
		const cos = Math.cos(fr.yaw);
		for (const s of b.localSolids || []) {
			if (s.box) {
				const [lx, lz, w, d] = s.box;
				solids.push(boxSolid(fr.x + lx * cos + lz * sin, fr.z - lx * sin + lz * cos, fr.yaw + (s.yaw || 0), w, d));
			} else solids.push({ group: { position: new Vector3(fr.x + s.x * cos + s.z * sin, 0, fr.z - s.x * sin + s.z * cos) }, keepout: s.keepout });
		}
	};
	localSolid(exchange, 'exchange');
	localSolid(forge, 'forge');
	localSolid(plaza, 'plaza');
	localSolid(market, 'market');
	const propTier = tierName === 'mobile' ? 'mobile' : 'desktop';
	const placements = placeProps(propTier);
	solids.push(...propSolids(placements));
	// Agents keep to the grounds: their stroll solids add each building's footprint.
	const strollSolids = solids.concat(ROOMS.filter((r) => r.w).map((r) => {
		const fr = roomFrame(r);
		return { group: { position: new Vector3(fr.x, 0, fr.z) }, keepout: Math.hypot(r.w, r.d) / 2 + 1 };
	}));

	// Props stream in from the object library once the first frame is up.
	const propHit = (p) => (p.place && p.place !== 'office' && p.place !== 'mine' ? { type: 'place', id: p.place } : null);
	const props = createPropLoader(renderer, scene, placements, { shadows, from: SPAWN, reducedMotion, hitFor: propHit });
	let propsStarted = false;

	// Highlight: the nearest interactable gets a soft ring under it.
	const halo = new Mesh(new RingGeometry(0.9, 1.1, 40), new MeshBasicMaterial({ color: VIOLET, transparent: true, opacity: 0.7, toneMapped: false }));
	halo.rotation.x = -PI / 2;
	halo.position.y = 0.035;
	halo.visible = false;
	halo.raycast = () => {};
	scene.add(halo);
	function highlight(target) {
		if (!target) {
			halo.visible = false;
			return;
		}
		halo.visible = true;
		let x = target.x;
		let z = target.z;
		let r = 1;
		if (target.type === 'object') {
			const ob = DESK_OBJECTS.find((d) => d.id === target.id);
			x = o.x + ob.dx;
			z = o.z + ob.dz;
			r = 0.45;
		} else if (target.type === 'vein') {
			const v = mine.veins.find((vv) => vv.id === target.id);
			x = v.x;
			z = v.z;
			r = 0.9;
		} else if (target.type === 'place') {
			// The ring sits in the doorway (or in the middle of an open-air place), not round the whole building.
			const p = placeById(target.id);
			const rm = ROOMS.find((rr) => rr.place === p.id);
			const door = rm?.door ? doorPoints(rm, 0.9).outside : null;
			x = door ? door.x : p.x;
			z = door ? door.z : p.z;
			r = door ? 1.1 : 1.6;
		} else if (target.type === 'agent') {
			r = 0.75;
		}
		halo.position.x = x;
		halo.position.z = z;
		halo.scale.setScalar(r);
	}

	// Tap-to-interact raycast against anything carrying userData.hit.
	const raycaster = new Raycaster();
	const ndc = new Vector2();
	function pick(clientX, clientY) {
		const rect = canvas.getBoundingClientRect();
		ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
		raycaster.setFromCamera(ndc, camera);
		const hits = raycaster.intersectObjects(scene.children, true);
		for (const h of hits) {
			let obj = h.object;
			while (obj && !obj.userData.hit) obj = obj.parent;
			if (obj?.userData.hit) return { ...obj.userData.hit, point: h.point };
		}
		return null;
	}

	// The gallery hangs real agents' portraits.
	const artLoader = new TextureLoader();
	artLoader.setCrossOrigin('anonymous');
	function hangArt(list) {
		gallery.frames.forEach((f, i) => {
			const item = list[i];
			if (!item?.url) return;
			artLoader.load(item.url, (tex) => {
				tex.colorSpace = SRGBColorSpace;
				tex.anisotropy = 4;
				f.art.material.map?.dispose();
				f.art.material.map = tex;
				f.art.material.color.set(0xffffff);
				f.art.material.needsUpdate = true;
			}, undefined, () => {});
			const plateTex = signTexture(item.name, '', '#c4b5fd');
			f.plate.material.map?.dispose();
			f.plate.material.map = plateTex;
			f.plate.material.color.set(0xffffff);
			f.plate.material.needsUpdate = true;
		});
	}

	let t = 0;
	const shadowAnchor = new Vector3();
	function tick(dt, playerPos) {
		if (!propsStarted) {
			propsStarted = true;
			props.start().then(() => log.info('world/campus', `${props.loaded} of ${props.models} prop models in, ${props.failed} failed`));
		}
		props.tick(dt);
		if (playerPos && shadows) {
			// The shadow frustum follows the visitor, snapped to whole metres so edges do not swim.
			shadowAnchor.set(Math.round(playerPos.x), 0, Math.round(playerPos.z));
			sun.target.position.copy(shadowAnchor);
			sun.position.copy(shadowAnchor).addScaledVector(sunDir, 70);
		}
		if (reducedMotion) return;
		t += dt;
		launchpad.rocket.position.y = 0.55 + Math.sin(t * 0.8) * 0.03;
		launchpad.flame.scale.set(1 + Math.sin(t * 17) * 0.12, 1 + Math.sin(t * 13) * 0.2, 1 + Math.cos(t * 15) * 0.12);
		for (const v of mine.veins) {
			const k = 0.45 + Math.sin(t * 1.6 + v.phase) * 0.2;
			v.material.emissiveIntensity = k;
			v.light.intensity = 0.4 + k;
		}
		for (const m of forge.pulse) m.color.setScalar(1.5 + Math.sin(t * 6) * 0.35).multiply(new Color(0xff7a2a));
		halo.material.opacity = 0.55 + Math.sin(t * 4) * 0.2;
	}

	function resize() {
		const w = innerWidth;
		const hgt = innerHeight;
		renderer.setSize(w, hgt, false);
		camera.aspect = w / hgt;
		camera.updateProjectionMatrix();
	}

	function dispose() {
		renderer.setAnimationLoop(null);
		props.dispose();
		scene.traverse((obj) => {
			obj.geometry?.dispose?.();
			const ms = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
			for (const mat of ms) {
				if (mat === screenMaterial || mat === tickerMaterial) continue;
				mat.map?.dispose?.();
				mat.emissiveMap?.dispose?.();
				mat.dispose?.();
			}
		});
		surfaces.dispose();
		scene.environment?.dispose?.();
		disposeGltfLoader(renderer);
		renderer.dispose();
	}

	return {
		renderer,
		scene,
		camera,
		solids,
		strollSolids,
		occluders,
		tier: tierName,
		veinPositions: mine.veins.map((v) => ({ id: v.id, x: v.x, z: v.z })),
		desk: office,
		highlight,
		pick,
		hangArt,
		tick,
		resize,
		dispose,
	};
}

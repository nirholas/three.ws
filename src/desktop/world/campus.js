// The campus: the 3D place the visitor walks through before (and around) the
// desktop. Low-poly, emissive, one hemisphere light and one directional light,
// so it holds 60fps on integrated GPUs. Every building here maps to a real
// surface in places.js; the exchange board, the monitor and the mine show live
// data supplied by the controller (index.js).

import {
	BoxGeometry,
	CircleGeometry,
	Color,
	ConeGeometry,
	CylinderGeometry,
	DirectionalLight,
	Fog,
	Group,
	HemisphereLight,
	Mesh,
	MeshBasicMaterial,
	MeshStandardMaterial,
	OctahedronGeometry,
	PerspectiveCamera,
	PlaneGeometry,
	PointLight,
	Raycaster,
	RingGeometry,
	Scene,
	TorusGeometry,
	Vector2,
	Vector3,
	CanvasTexture,
	SRGBColorSpace,
	DoubleSide,
	ACESFilmicToneMapping,
} from 'three';
import { createRenderer } from '../../webgl-support.js';
import { makeLabelSprite, makeSkyDome, makeStars } from '../../docs-world/world.js';
import { CAMPUS_RADIUS, DESK_OBJECTS, PLACES, VEINS, facingOf as facing, placeById } from './places.js';
import { GEMS } from '../../../api/_lib/world-gems.js';

const BG = 0x050505;
const VIOLET = 0xc4b5fd;

const hueColor = (hue, l = 0.62) => new Color().setHSL(hue / 360, 0.6, l);
const hex = (c) => `#${c.getHexString()}`;

const std = (o) => new MeshStandardMaterial({ roughness: 0.78, metalness: 0.12, ...o });
const glow = (color, intensity = 1) => new MeshBasicMaterial({ color: new Color(color).multiplyScalar(intensity), toneMapped: false });

function groundTexture() {
	const size = 2048;
	const canvas = document.createElement('canvas');
	canvas.width = size;
	canvas.height = size;
	const g = canvas.getContext('2d');
	const c = size / 2;
	const px = (m) => (m / CAMPUS_RADIUS) * c; // metres to pixels

	const base = g.createRadialGradient(c, c, 0, c, c, c);
	base.addColorStop(0, '#0d0d12');
	base.addColorStop(0.6, '#08080b');
	base.addColorStop(1, '#050505');
	g.fillStyle = base;
	g.fillRect(0, 0, size, size);

	// Hairline grid, the classic site's background motif.
	g.strokeStyle = 'rgba(255,255,255,0.045)';
	g.lineWidth = 1.5;
	for (let m = -CAMPUS_RADIUS; m <= CAMPUS_RADIUS; m += 2) {
		g.beginPath();
		g.moveTo(c + px(m), 0);
		g.lineTo(c + px(m), size);
		g.stroke();
		g.beginPath();
		g.moveTo(0, c + px(m));
		g.lineTo(size, c + px(m));
		g.stroke();
	}

	// Paths from the gate (spawn) to the office and from the office to every place.
	const office = placeById('office');
	const path = (ax, az, bx, bz, w, a) => {
		g.strokeStyle = `rgba(196,181,253,${a})`;
		g.lineWidth = px(w);
		g.lineCap = 'round';
		g.beginPath();
		g.moveTo(c + px(ax), c + px(az));
		g.lineTo(c + px(bx), c + px(bz));
		g.stroke();
	};
	path(0, CAMPUS_RADIUS - 4, office.x, office.z + 4, 3.2, 0.16);
	for (const p of PLACES) {
		if (p.id === 'office') continue;
		path(office.x, office.z, p.x, p.z, 2.2, 0.1);
	}
	// Plaza ring around the office.
	g.strokeStyle = 'rgba(196,181,253,0.14)';
	g.lineWidth = px(0.5);
	g.beginPath();
	g.arc(c + px(office.x), c + px(office.z), px(7), 0, Math.PI * 2);
	g.stroke();

	const tex = new CanvasTexture(canvas);
	tex.colorSpace = SRGBColorSpace;
	tex.anisotropy = 8;
	return tex;
}

function lamp(x, z, hue = 262) {
	const g = new Group();
	const post = new Mesh(new CylinderGeometry(0.05, 0.07, 3.2, 8), std({ color: 0x1a1a1f, metalness: 0.5 }));
	post.position.y = 1.6;
	const head = new Mesh(new BoxGeometry(0.5, 0.12, 0.5), glow(hueColor(hue, 0.7), 1.4));
	head.position.y = 3.2;
	g.add(post, head);
	g.position.set(x, 0, z);
	return g;
}

/* ---------------------------------------------------------------- office */

function buildOffice(place, screenMaterial) {
	const g = new Group();
	const col = hueColor(place.hue);

	// Floor slab and a back wall carrying the wordmark: the "room" is open so
	// the camera can orbit freely.
	const slab = new Mesh(new BoxGeometry(9, 0.18, 7), std({ color: 0x0f0f14, roughness: 0.6 }));
	slab.position.y = 0.09;
	g.add(slab);
	const rim = new Mesh(new RingGeometry(5.3, 5.42, 64), glow(col, 0.6));
	rim.rotation.x = -Math.PI / 2;
	rim.position.y = 0.02;
	g.add(rim);

	const wall = new Mesh(new BoxGeometry(9, 4.2, 0.25), std({ color: 0x0a0a0d }));
	wall.position.set(0, 2.1, -3.4);
	g.add(wall);
	const brand = makeLabelSprite('three.ws', 'The 3D agent layer of the internet', hex(col), 1.1);
	brand.position.set(0, 3.2, -3.1);
	g.add(brand);
	// A thin violet strip at the wall foot reads as the site's hairline motif.
	const strip = new Mesh(new BoxGeometry(9, 0.04, 0.02), glow(col, 1.2));
	strip.position.set(0, 0.2, -3.26);
	g.add(strip);

	// Desk.
	const top = new Mesh(new BoxGeometry(2.6, 0.06, 1.1), std({ color: 0x15151a, roughness: 0.4, metalness: 0.3 }));
	top.position.set(0, 0.76, -0.5);
	g.add(top);
	for (const sx of [-1.15, 1.15]) {
		const leg = new Mesh(new BoxGeometry(0.08, 0.74, 0.9), std({ color: 0x111115 }));
		leg.position.set(sx, 0.37, -0.5);
		g.add(leg);
	}

	// Monitor: stand, bezel and the live screen plane.
	const mon = DESK_OBJECTS.find((o) => o.id === 'monitor');
	const stand = new Mesh(new CylinderGeometry(0.035, 0.05, 0.22, 10), std({ color: 0x1c1c22, metalness: 0.5 }));
	stand.position.set(mon.dx, 0.9, mon.dz);
	const foot = new Mesh(new CylinderGeometry(0.22, 0.24, 0.02, 20), std({ color: 0x1c1c22, metalness: 0.5 }));
	foot.position.set(mon.dx, 0.8, mon.dz);
	const bezel = new Mesh(new BoxGeometry(1.44, 0.84, 0.04), std({ color: 0x0b0b0e, roughness: 0.3, metalness: 0.4 }));
	bezel.position.set(mon.dx, 1.42, mon.dz);
	const screen = new Mesh(new PlaneGeometry(1.36, 0.765), screenMaterial);
	screen.position.set(mon.dx, 1.42, mon.dz + 0.021);
	screen.userData.hit = { type: 'object', id: 'monitor' };
	bezel.userData.hit = screen.userData.hit;
	g.add(stand, foot, bezel, screen);
	const screenLight = new PointLight(0x9d8cff, 0.9, 4, 2);
	screenLight.position.set(mon.dx, 1.5, mon.dz + 0.6);
	g.add(screenLight);

	// Keyboard.
	const kb = new Mesh(new BoxGeometry(0.62, 0.025, 0.2), std({ color: 0x18181d, roughness: 0.5 }));
	kb.position.set(0, 0.8, -0.1);
	g.add(kb);

	// Phone: a slab with a lit screen.
	const ph = DESK_OBJECTS.find((o) => o.id === 'phone');
	const phoneBody = new Mesh(new BoxGeometry(0.075, 0.012, 0.155), std({ color: 0x0c0c0f, roughness: 0.3, metalness: 0.6 }));
	phoneBody.position.set(ph.dx, 0.8, ph.dz);
	phoneBody.rotation.y = -0.35;
	phoneBody.userData.hit = { type: 'object', id: 'phone' };
	const phoneScreen = new Mesh(new PlaneGeometry(0.066, 0.142), glow(0x8b5cf6, 0.9));
	phoneScreen.rotation.x = -Math.PI / 2;
	phoneScreen.rotation.z = -0.35;
	phoneScreen.position.set(ph.dx, 0.807, ph.dz);
	phoneScreen.userData.hit = phoneBody.userData.hit;
	g.add(phoneBody, phoneScreen);

	// Headset: a visor ring with a strap.
	const hs = DESK_OBJECTS.find((o) => o.id === 'headset');
	const visor = new Mesh(new BoxGeometry(0.22, 0.1, 0.11), std({ color: 0xe8e8ee, roughness: 0.35 }));
	visor.position.set(hs.dx, 0.85, hs.dz);
	visor.rotation.y = 0.4;
	visor.userData.hit = { type: 'object', id: 'headset' };
	const strap = new Mesh(new TorusGeometry(0.11, 0.012, 8, 24), std({ color: 0x2a2a30 }));
	strap.position.set(hs.dx - 0.02, 0.85, hs.dz - 0.07);
	strap.rotation.set(0, 0.4, 0);
	strap.userData.hit = visor.userData.hit;
	const lens = new Mesh(new PlaneGeometry(0.18, 0.06), glow(0x60a5fa, 0.8));
	lens.position.set(hs.dx + 0.04, 0.85, hs.dz + 0.057);
	lens.rotation.y = 0.4;
	lens.userData.hit = visor.userData.hit;
	g.add(visor, strap, lens);

	// Chair, facing the desk.
	const seat = new Mesh(new BoxGeometry(0.56, 0.08, 0.56), std({ color: 0x1a1a20, roughness: 0.6 }));
	seat.position.set(0, 0.48, 0.55);
	const back = new Mesh(new BoxGeometry(0.56, 0.7, 0.08), std({ color: 0x1a1a20, roughness: 0.6 }));
	back.position.set(0, 0.87, 0.83);
	const post = new Mesh(new CylinderGeometry(0.03, 0.03, 0.44, 8), std({ color: 0x2b2b33, metalness: 0.6 }));
	post.position.set(0, 0.22, 0.55);
	const base = new Mesh(new CylinderGeometry(0.3, 0.3, 0.03, 12), std({ color: 0x2b2b33, metalness: 0.6 }));
	base.position.set(0, 0.015, 0.55);
	g.add(seat, back, post, base);

	g.position.set(place.x, 0, place.z);
	return {
		group: g,
		screen,
		// Where the camera goes when the visitor sits down, in world space.
		sitFrom: new Vector3(place.x, 1.55, place.z + 1.9),
		sitTo: new Vector3(place.x + mon.dx, 1.42, place.z + mon.dz + 0.42),
		screenCentre: new Vector3(place.x + mon.dx, 1.42, place.z + mon.dz),
	};
}

/* -------------------------------------------------------------- exchange */

function buildExchange(place, tickerMaterial) {
	const g = new Group();
	const col = hueColor(place.hue);
	const stone = std({ color: 0x1b1b21, roughness: 0.9 });

	// Steps.
	for (let i = 0; i < 3; i++) {
		const s = new Mesh(new BoxGeometry(14 - i * 0.6, 0.22, 2.2 - i * 0.5), stone);
		s.position.set(0, 0.11 + i * 0.22, 4.6 - i * 0.3);
		g.add(s);
	}
	// Podium and hall.
	const podium = new Mesh(new BoxGeometry(14, 0.7, 8), stone);
	podium.position.set(0, 0.35, 0);
	g.add(podium);
	const hall = new Mesh(new BoxGeometry(12.4, 6, 6), std({ color: 0x0d0d11 }));
	hall.position.set(0, 3.7, -0.8);
	hall.userData.hit = { type: 'place', id: place.id };
	g.add(hall);
	// Six columns.
	for (let i = 0; i < 6; i++) {
		const x = -5.5 + i * 2.2;
		const c = new Mesh(new CylinderGeometry(0.42, 0.46, 6.2, 14), std({ color: 0x26262e, roughness: 0.7 }));
		c.position.set(x, 3.8, 2.6);
		c.userData.hit = hall.userData.hit;
		g.add(c);
		const cap = new Mesh(new BoxGeometry(1.1, 0.3, 1.1), stone);
		cap.position.set(x, 6.95, 2.6);
		g.add(cap);
	}
	// Entablature and pediment.
	const beam = new Mesh(new BoxGeometry(14, 0.9, 1.6), stone);
	beam.position.set(0, 7.5, 2.6);
	g.add(beam);
	const ped = new Mesh(new ConeGeometry(7.6, 2.4, 4), stone);
	ped.rotation.y = Math.PI / 4;
	ped.scale.z = 0.22;
	ped.position.set(0, 9.1, 2.6);
	g.add(ped);
	// The board: a live ticker across the front of the entablature, and a
	// taller board above the hall for the second line of sight.
	const board = new Mesh(new PlaneGeometry(13.4, 1.25), tickerMaterial);
	board.position.set(0, 7.5, 3.42);
	g.add(board);
	const board2 = new Mesh(new PlaneGeometry(11, 1.0), tickerMaterial);
	board2.position.set(0, 6.0, 2.22);
	g.add(board2);
	// Door glow.
	const door = new Mesh(new PlaneGeometry(2.4, 4.2), glow(col, 0.55));
	door.position.set(0, 2.8, 2.22);
	door.userData.hit = hall.userData.hit;
	g.add(door);
	const sign = makeLabelSprite(place.title, place.sub, hex(col), 1.25);
	sign.position.set(0, 11.6, 2.4);
	g.add(sign);

	g.position.set(place.x, 0, place.z);
	g.rotation.y = facing(place);
	return g;
}

/* ------------------------------------------------------------- launchpad */

function buildLaunchpad(place) {
	const g = new Group();
	const col = hueColor(place.hue);
	const pad = new Mesh(new CylinderGeometry(5.2, 5.4, 0.5, 32), std({ color: 0x15151a }));
	pad.position.y = 0.25;
	pad.userData.hit = { type: 'place', id: place.id };
	g.add(pad);
	const ring = new Mesh(new RingGeometry(4.3, 4.6, 48), glow(col, 0.8));
	ring.rotation.x = -Math.PI / 2;
	ring.position.y = 0.51;
	g.add(ring);
	// Rocket.
	const rocket = new Group();
	const body = new Mesh(new CylinderGeometry(0.9, 1.0, 6, 20), std({ color: 0xe9e9f0, roughness: 0.35, metalness: 0.25 }));
	body.position.y = 3.5;
	const nose = new Mesh(new ConeGeometry(0.9, 2.2, 20), std({ color: hueColor(place.hue, 0.55), roughness: 0.4 }));
	nose.position.y = 7.6;
	rocket.add(body, nose);
	for (let i = 0; i < 3; i++) {
		const fin = new Mesh(new BoxGeometry(0.12, 1.8, 1.4), std({ color: hueColor(place.hue, 0.55) }));
		const a = (i / 3) * Math.PI * 2;
		fin.position.set(Math.cos(a) * 1.25, 1.2, Math.sin(a) * 1.25);
		fin.rotation.y = -a;
		rocket.add(fin);
	}
	const porthole = new Mesh(new CylinderGeometry(0.3, 0.3, 0.05, 16), glow(0x60a5fa, 1));
	porthole.rotation.x = Math.PI / 2;
	porthole.position.set(0, 5.2, 0.98);
	rocket.add(porthole);
	const flame = new Mesh(new ConeGeometry(0.75, 1.8, 16, 1, true), glow(hueColor(place.hue, 0.7), 1.6));
	flame.rotation.x = Math.PI;
	flame.position.y = -0.4;
	flame.material.transparent = true;
	flame.material.opacity = 0.85;
	flame.material.side = DoubleSide;
	rocket.add(flame);
	rocket.traverse((o) => (o.userData.hit = pad.userData.hit));
	rocket.position.y = 0.5;
	g.add(rocket);
	// Gantry.
	const gantry = new Mesh(new BoxGeometry(0.3, 7.5, 0.3), std({ color: 0x2a2a30, metalness: 0.5 }));
	gantry.position.set(2.2, 4.25, 0);
	g.add(gantry);
	for (const y of [3, 5, 7]) {
		const arm = new Mesh(new BoxGeometry(1.4, 0.12, 0.12), std({ color: 0x2a2a30, metalness: 0.5 }));
		arm.position.set(1.5, y, 0);
		g.add(arm);
	}
	const sign = makeLabelSprite(place.title, place.sub, hex(col), 1.1);
	sign.position.set(0, 10.6, 0);
	g.add(sign);
	g.position.set(place.x, 0, place.z);
	return { group: g, rocket, flame };
}

/* ------------------------------------------------------------------ mine */

function buildMine(place) {
	const g = new Group();
	const col = hueColor(place.hue);
	const rock = std({ color: 0x14141a, roughness: 1 });

	// Cave: two shoulders, a lintel, a dark back wall and a dim interior floor.
	const left = new Mesh(new BoxGeometry(3.2, 6.5, 4), rock);
	left.position.set(-5.2, 3.25, -3);
	const right = left.clone();
	right.position.x = 5.2;
	const lintel = new Mesh(new BoxGeometry(13.6, 2.2, 4), rock);
	lintel.position.set(0, 6.4, -3);
	const back = new Mesh(new BoxGeometry(13.6, 7.5, 1), rock);
	back.position.set(0, 3.75, -7);
	const floor = new Mesh(new CircleGeometry(7.2, 40), std({ color: 0x0a0a0d, roughness: 1 }));
	floor.rotation.x = -Math.PI / 2;
	floor.position.y = 0.01;
	g.add(left, right, lintel, back, floor);
	// Rails and a cart.
	for (const dx of [-0.35, 0.35]) {
		const rail = new Mesh(new BoxGeometry(0.06, 0.05, 12), std({ color: 0x3a3a44, metalness: 0.7 }));
		rail.position.set(dx, 0.04, 1);
		g.add(rail);
	}
	const cart = new Mesh(new BoxGeometry(0.9, 0.5, 1.2), std({ color: 0x24242b, metalness: 0.4 }));
	cart.position.set(0, 0.45, 4.6);
	g.add(cart);

	// Veins: clusters of octahedra, one per gem colour, lit from inside.
	const veins = [];
	const palette = GEMS.map((gm) => gm.hex);
	VEINS.forEach((v, i) => {
		const cluster = new Group();
		const colour = palette[(i + 1) % palette.length];
		const mat = new MeshStandardMaterial({ color: colour, emissive: colour, emissiveIntensity: 0.55, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.92 });
		for (let k = 0; k < 5; k++) {
			const s = 0.22 + Math.random() * 0.32;
			const crystal = new Mesh(new OctahedronGeometry(s, 0), mat);
			crystal.scale.y = 1.8 + Math.random();
			const a = (k / 5) * Math.PI * 2 + i;
			crystal.position.set(Math.cos(a) * 0.35, s * 1.1, Math.sin(a) * 0.35);
			crystal.rotation.set(Math.random() * 0.5 - 0.25, a, Math.random() * 0.5 - 0.25);
			crystal.userData.hit = { type: 'vein', id: v.id };
			cluster.add(crystal);
		}
		const light = new PointLight(colour, 0.6, 3.5, 2);
		light.position.y = 0.6;
		cluster.add(light);
		cluster.position.set(v.dx, 0, v.dz);
		g.add(cluster);
		veins.push({ id: v.id, group: cluster, material: mat, light, x: place.x + v.dx, z: place.z + v.dz, phase: i * 1.3 });
	});
	const sign = makeLabelSprite(place.title, place.sub, hex(col), 1.1);
	sign.position.set(0, 9, -1);
	g.add(sign);
	g.position.set(place.x, 0, place.z);
	return { group: g, veins };
}

/* ------------------------------------------------------- small pavilions */

function buildForge(place) {
	const g = new Group();
	const col = hueColor(place.hue);
	const base = new Mesh(new CylinderGeometry(3.6, 3.8, 0.4, 24), std({ color: 0x15151a }));
	base.position.y = 0.2;
	base.userData.hit = { type: 'place', id: place.id };
	const anvil = new Mesh(new BoxGeometry(2.4, 1.3, 1.1), std({ color: 0x23232a, metalness: 0.7, roughness: 0.35 }));
	anvil.position.y = 1.05;
	anvil.userData.hit = base.userData.hit;
	const hot = new Mesh(new BoxGeometry(2.4, 0.08, 1.1), glow(col, 1.6));
	hot.position.y = 1.74;
	const chimney = new Mesh(new CylinderGeometry(0.5, 0.7, 5.5, 12), std({ color: 0x1b1b21 }));
	chimney.position.set(-1.6, 3.1, -1.2);
	const ember = new Mesh(new CylinderGeometry(0.48, 0.48, 0.1, 12), glow(col, 1.2));
	ember.position.set(-1.6, 5.9, -1.2);
	g.add(base, anvil, hot, chimney, ember);
	const sign = makeLabelSprite(place.title, place.sub, hex(col));
	sign.position.set(0, 7.4, 0);
	g.add(sign);
	g.position.set(place.x, 0, place.z);
	g.rotation.y = facing(place);
	return { group: g, pulse: [hot.material, ember.material] };
}

function buildGallery(place) {
	const g = new Group();
	const col = hueColor(place.hue);
	const base = new Mesh(new CylinderGeometry(3.6, 3.8, 0.4, 24), std({ color: 0x15151a }));
	base.position.y = 0.2;
	base.userData.hit = { type: 'place', id: place.id };
	g.add(base);
	const frames = [];
	for (let i = 0; i < 4; i++) {
		const a = (i / 4) * Math.PI * 2;
		const ped = new Mesh(new BoxGeometry(0.5, 1.1, 0.5), std({ color: 0x1b1b21 }));
		ped.position.set(Math.cos(a) * 2.2, 0.95, Math.sin(a) * 2.2);
		const frame = new Mesh(new BoxGeometry(1.2, 1.6, 0.08), std({ color: 0x0b0b0e, metalness: 0.4 }));
		frame.position.set(Math.cos(a) * 2.2, 2.5, Math.sin(a) * 2.2);
		frame.rotation.y = -a + Math.PI / 2;
		const art = new Mesh(new PlaneGeometry(1.0, 1.4), glow(hueColor(place.hue + i * 40, 0.6), 0.7));
		art.position.set(0, 0, 0.05);
		frame.add(art);
		frame.userData.hit = base.userData.hit;
		art.userData.hit = base.userData.hit;
		g.add(ped, frame);
		frames.push(frame);
	}
	const sign = makeLabelSprite(place.title, place.sub, hex(col));
	sign.position.set(0, 5.6, 0);
	g.add(sign);
	g.position.set(place.x, 0, place.z);
	g.rotation.y = facing(place);
	return { group: g, frames };
}

function buildPlaza(place) {
	const g = new Group();
	const col = hueColor(place.hue);
	const base = new Mesh(new CylinderGeometry(3.6, 3.8, 0.4, 24), std({ color: 0x15151a }));
	base.position.y = 0.2;
	base.userData.hit = { type: 'place', id: place.id };
	g.add(base);
	// The plaza is a stage, not a diorama: the real agents (agents.js) stand
	// around it, so nothing abstract is built here to stand in for them.
	const beacon = new Mesh(new CylinderGeometry(0.1, 0.1, 4.5, 8), glow(col, 1.2));
	beacon.position.y = 2.6;
	g.add(beacon);
	const sign = makeLabelSprite(place.title, place.sub, hex(col));
	sign.position.set(0, 6.2, 0);
	g.add(sign);
	g.position.set(place.x, 0, place.z);
	g.rotation.y = facing(place);
	return { group: g };
}

function buildMarket(place) {
	const g = new Group();
	const col = hueColor(place.hue);
	const base = new Mesh(new CylinderGeometry(3.6, 3.8, 0.4, 24), std({ color: 0x15151a }));
	base.position.y = 0.2;
	base.userData.hit = { type: 'place', id: place.id };
	g.add(base);
	for (let i = 0; i < 3; i++) {
		const a = (i / 3) * Math.PI * 2 + 0.5;
		const stall = new Group();
		const counter = new Mesh(new BoxGeometry(2, 0.9, 0.8), std({ color: 0x1b1b21 }));
		counter.position.y = 0.85;
		const canopy = new Mesh(new BoxGeometry(2.3, 0.08, 1.4), std({ color: hueColor(place.hue + i * 25, 0.5) }));
		canopy.position.set(0, 2.5, 0.1);
		const light = new Mesh(new BoxGeometry(1.9, 0.05, 0.05), glow(col, 1.2));
		light.position.set(0, 2.44, 0.6);
		for (const sx of [-1.05, 1.05]) {
			const post = new Mesh(new CylinderGeometry(0.04, 0.04, 2.5, 8), std({ color: 0x2a2a30 }));
			post.position.set(sx, 1.25, 0.6);
			stall.add(post);
		}
		stall.add(counter, canopy, light);
		stall.position.set(Math.cos(a) * 2.1, 0.4, Math.sin(a) * 2.1);
		stall.rotation.y = -a - Math.PI / 2;
		stall.traverse((o) => (o.userData.hit = base.userData.hit));
		g.add(stall);
	}
	const sign = makeLabelSprite(place.title, place.sub, hex(col));
	sign.position.set(0, 5.6, 0);
	g.add(sign);
	g.position.set(place.x, 0, place.z);
	g.rotation.y = facing(place);
	return { group: g };
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
	renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
	renderer.setSize(innerWidth, innerHeight, false);
	renderer.toneMapping = ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.05;

	const scene = new Scene();
	scene.background = new Color(BG);
	scene.fog = new Fog(BG, 42, 120);
	const camera = new PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 400);

	scene.add(new HemisphereLight(0xa39bd0, 0x14121c, 1.25));
	const sun = new DirectionalLight(0xdcd6ff, 1.1);
	sun.position.set(18, 30, 12);
	scene.add(sun);
	scene.add(makeSkyDome(), makeStars(560));

	// Ground.
	const groundTex = groundTexture();
	const ground = new Mesh(new CircleGeometry(CAMPUS_RADIUS + 14, 96), new MeshStandardMaterial({ map: groundTex, roughness: 0.95, metalness: 0 }));
	ground.rotation.x = -Math.PI / 2;
	ground.receiveShadow = false;
	scene.add(ground);
	// Edge glow where the walkable disc ends.
	const edge = new Mesh(new RingGeometry(CAMPUS_RADIUS - 0.1, CAMPUS_RADIUS + 0.25, 128), glow(VIOLET, 0.5));
	edge.rotation.x = -Math.PI / 2;
	edge.position.y = 0.015;
	scene.add(edge);

	// Lamps along the gate path and around the plaza.
	for (const z of [26, 20, 14]) scene.add(lamp(-2.2, z), lamp(2.2, z));
	for (let i = 0; i < 8; i++) {
		const a = (i / 8) * Math.PI * 2;
		scene.add(lamp(Math.cos(a) * 9, 8 + Math.sin(a) * 9));
	}

	// Gate pylons at the spawn.
	for (const sx of [-3.2, 3.2]) {
		const pylon = new Mesh(new BoxGeometry(0.5, 5.5, 0.5), std({ color: 0x0f0f14 }));
		pylon.position.set(sx, 2.75, 33);
		const tip = new Mesh(new BoxGeometry(0.5, 0.1, 0.5), glow(VIOLET, 1.2));
		tip.position.set(sx, 5.55, 33);
		scene.add(pylon, tip);
	}
	const gateSign = makeLabelSprite('Welcome to three.ws', 'The 3D agent layer of the internet', '#c4b5fd', 1.1);
	gateSign.position.set(0, 6.4, 33);
	scene.add(gateSign);

	// Buildings.
	const office = buildOffice(placeById('office'), screenMaterial);
	const exchange = buildExchange(placeById('exchange'), tickerMaterial);
	const launchpad = buildLaunchpad(placeById('launchpad'));
	const mine = buildMine(placeById('mine'));
	const forge = buildForge(placeById('forge'));
	const gallery = buildGallery(placeById('gallery'));
	const plaza = buildPlaza(placeById('agents'));
	const market = buildMarket(placeById('market'));
	scene.add(office.group, exchange, launchpad.group, mine.group, forge.group, gallery.group, plaza.group, market.group);

	// Keep-out volumes for the player (same shape player.update expects).
	const solids = PLACES.filter((p) => p.keepout > 0).map((p) => ({ group: { position: new Vector3(p.x, 0, p.z) }, keepout: p.keepout }));
	// The desk itself: a small disc so the avatar never walks through the table.
	const o = placeById('office');
	solids.push({ group: { position: new Vector3(o.x, 0, o.z - 0.5) }, keepout: 1.35 });
	// Mine shoulders.
	const m = placeById('mine');
	solids.push({ group: { position: new Vector3(m.x - 5.2, 0, m.z - 3) }, keepout: 2.6 }, { group: { position: new Vector3(m.x + 5.2, 0, m.z - 3) }, keepout: 2.6 });
	for (const v of mine.veins) solids.push({ group: { position: new Vector3(v.x, 0, v.z) }, keepout: 0.75 });

	// Highlight: the nearest interactable gets a soft ring under it (an agent's
	// ring follows the agent, so the caller passes its current x/z).
	const halo = new Mesh(new RingGeometry(0.9, 1.1, 40), new MeshBasicMaterial({ color: VIOLET, transparent: true, opacity: 0.7, toneMapped: false }));
	halo.rotation.x = -Math.PI / 2;
	halo.position.y = 0.03;
	halo.visible = false;
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
			const p = placeById(target.id);
			x = p.x;
			z = p.z;
			r = p.keepout + 0.6;
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

	let t = 0;
	function tick(dt) {
		if (reducedMotion) return;
		t += dt;
		launchpad.rocket.position.y = 0.5 + Math.sin(t * 0.8) * 0.06;
		launchpad.flame.scale.set(1 + Math.sin(t * 17) * 0.12, 1 + Math.sin(t * 13) * 0.2, 1 + Math.cos(t * 15) * 0.12);
		for (const v of mine.veins) {
			const k = 0.45 + Math.sin(t * 1.6 + v.phase) * 0.2;
			v.material.emissiveIntensity = k;
			v.light.intensity = 0.4 + k;
		}
		for (const f of gallery.frames) f.rotation.y += dt * 0.25;
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
		scene.traverse((obj) => {
			obj.geometry?.dispose?.();
			const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
			for (const mat of mats) {
				if (mat === screenMaterial || mat === tickerMaterial) continue;
				mat.map?.dispose?.();
				mat.dispose?.();
			}
		});
		groundTex.dispose();
		renderer.dispose();
	}

	return {
		renderer,
		scene,
		camera,
		solids,
		veinPositions: mine.veins.map((v) => ({ id: v.id, x: v.x, z: v.z })),
		desk: office,
		highlight,
		pick,
		tick,
		resize,
		dispose,
	};
}

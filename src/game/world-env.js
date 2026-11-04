// World environment, a distinct, living biome for every coin community.
//
// The lobby/landing stays monochrome by design, but the moment a player drops
// into a world it should feel alive AND feel like *this* community's place.
// Two coins should never share a skin. We hash the coin's mint into a stable
// seed, pick one of several biome archetypes from it (meadow, desert, tundra,
// volcanic, alien, tropical), then jitter that biome's palette and scatter its
// vegetation from the same seed, so a given coin always renders the same world,
// and a thousand coins render a thousand recognisably different ones.
//
// Colour does the heavy lifting here, the monochrome restraint is the lobby's
// job, not the world's. Everything decorative sits OUTSIDE the playRadius circle
// so it frames the space without ever blocking a player. Geometry is low-poly
// and shared/cloned, so the whole environment is cheap enough to run alongside
// the avatars and their shadows. The scene file creates it once per community
// and ticks update(dt).

import {
	Color, Fog, Group, Vector3, MathUtils, DoubleSide, SRGBColorSpace,
	HemisphereLight, DirectionalLight, AmbientLight,
	Mesh, MeshStandardMaterial, MeshBasicMaterial,
	CircleGeometry, RingGeometry, CylinderGeometry, ConeGeometry, IcosahedronGeometry,
	BoxGeometry, TorusGeometry,
	GridHelper, CanvasTexture,
} from 'three';
import { createStaticBatcher, disposeInstanced } from './static-batch.js';
import { log } from '../shared/log.js';
import { seedFromString, biomeForSeed, biomeById } from './world-biomes.js';

// Re-exported so existing importers keep one entry point for the world.
export { seedFromString, biomeForSeed, biomeById };

// A seeded LCG so a community's treeline/hill/prop layout is identical on every
// load (stable demos, no first-frame reshuffle) without touching Math.random.
function rng(seed) {
	let s = seed >>> 0;
	return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff; };
}

// A vertical gradient backdrop, rendered as the scene background so it's immune
// to fog and never rotates with the orbit camera, a clean graded sky per biome.
function gradientSky(top, mid, horizon) {
	const c = document.createElement('canvas');
	c.width = 4; c.height = 256;
	const x = c.getContext('2d');
	const g = x.createLinearGradient(0, 0, 0, 256);
	g.addColorStop(0, top);
	g.addColorStop(0.55, mid);
	g.addColorStop(1, horizon);
	x.fillStyle = g; x.fillRect(0, 0, 4, 256);
	const tex = new CanvasTexture(c);
	tex.colorSpace = SRGBColorSpace;
	return tex;
}

// Per-coin hue jitter: nudge a base hex around the colour wheel + lightness so
// two communities sharing a biome still feel distinct. Natural biomes get a
// gentle shift; the accent ring gets a wider one so it clearly differs per coin.
function jitter(hex, rand, hueAmt = 0.06, litAmt = 0.06) {
	return new Color(hex).offsetHSL((rand() - 0.5) * 2 * hueAmt, 0, (rand() - 0.5) * 2 * litAmt);
}

// --- Flora builders --------------------------------------------------------
// Each returns a Group positioned at origin; the caller scatters/scales it. They
// share geometry/material passed in so a whole treeline is a handful of buffers.

function makeConifer(g, mats, rand, snow = false) {
	const trunk = new Mesh(g.trunk, mats.trunk);
	trunk.position.y = 1.2; trunk.castShadow = true;
	const tree = new Group(); tree.add(trunk);
	const tiers = rand() > 0.5 ? 3 : 2;
	for (let t = 0; t < tiers; t++) {
		const leaf = new Mesh(g.leaf, rand() > 0.5 ? mats.leafA : mats.leafB);
		leaf.position.y = 2.6 + t * 1.4;
		leaf.scale.setScalar(1 - t * 0.22);
		leaf.castShadow = true;
		tree.add(leaf);
	}
	if (snow) tree.scale.y *= 1.05;
	return tree;
}

function makeCactus(g, mats, rand) {
	const cactus = new Group();
	const body = new Mesh(g.cactus, mats.leafA);
	body.position.y = 1.6; body.castShadow = true;
	cactus.add(body);
	const arms = rand() > 0.4 ? 2 : 1;
	for (let i = 0; i < arms; i++) {
		const arm = new Mesh(g.cactusArm, rand() > 0.5 ? mats.leafA : mats.leafB);
		const side = i === 0 ? 1 : -1;
		arm.position.set(side * 0.62, 1.6 + rand() * 0.7, 0);
		arm.rotation.z = side * 0.5;
		arm.castShadow = true;
		cactus.add(arm);
	}
	return cactus;
}

function makeDeadtree(g, mats, rand) {
	const tree = new Group();
	const trunk = new Mesh(g.deadTrunk, mats.trunk);
	trunk.position.y = 1.7; trunk.castShadow = true;
	tree.add(trunk);
	const branches = 2 + Math.floor(rand() * 3);
	for (let i = 0; i < branches; i++) {
		const b = new Mesh(g.branch, mats.trunk);
		b.position.y = 1.8 + rand() * 1.4;
		b.rotation.z = (rand() - 0.5) * 1.6;
		b.rotation.y = rand() * Math.PI * 2;
		b.castShadow = true;
		tree.add(b);
	}
	return tree;
}

function makeCrystal(g, mats, rand) {
	const cluster = new Group();
	const shards = 1 + Math.floor(rand() * 3);
	for (let i = 0; i < shards; i++) {
		const shard = new Mesh(g.crystal, rand() > 0.5 ? mats.leafA : mats.leafB);
		const h = 2.4 + rand() * 3.4;
		shard.scale.set(0.5 + rand() * 0.5, h, 0.5 + rand() * 0.5);
		shard.position.set((rand() - 0.5) * 1.6, h * 0.5, (rand() - 0.5) * 1.6);
		shard.rotation.y = rand() * Math.PI;
		shard.castShadow = true;
		cluster.add(shard);
	}
	return cluster;
}

function makePalm(g, mats, rand) {
	const palm = new Group();
	const lean = (rand() - 0.5) * 0.4;
	const trunk = new Mesh(g.palmTrunk, mats.trunk);
	trunk.position.y = 2.6; trunk.rotation.z = lean; trunk.castShadow = true;
	palm.add(trunk);
	const crown = new Group();
	crown.position.set(Math.sin(lean) * -5.2, 5.2, 0);
	const fronds = 6 + Math.floor(rand() * 3);
	for (let i = 0; i < fronds; i++) {
		const frond = new Mesh(g.frond, rand() > 0.5 ? mats.leafA : mats.leafB);
		frond.rotation.y = (i / fronds) * Math.PI * 2;
		frond.rotation.z = 0.9;
		frond.position.y = 0.1;
		frond.castShadow = true;
		crown.add(frond);
	}
	palm.add(crown);
	return palm;
}

// Frontier scrub: a low cluster of dusty sage mounds, with the odd tall saguaro
// rising out of it. Reuses the cactus body so the band reads as high-desert.
function makeSagebrush(g, mats, rand) {
	const clump = new Group();
	const mounds = 2 + Math.floor(rand() * 3);
	for (let i = 0; i < mounds; i++) {
		const bush = new Mesh(g.bush, rand() > 0.5 ? mats.leafA : mats.leafB);
		const s = 0.5 + rand() * 0.7;
		bush.scale.set(s, s * (0.5 + rand() * 0.3), s);
		bush.position.set((rand() - 0.5) * 1.8, s * 0.32, (rand() - 0.5) * 1.8);
		bush.castShadow = true;
		clump.add(bush);
	}
	// ~1 in 4 clumps anchors a saguaro for a recognisable western silhouette.
	if (rand() > 0.74) {
		const body = new Mesh(g.cactus, mats.leafB);
		body.position.y = 1.6; body.castShadow = true;
		clump.add(body);
		const arm = new Mesh(g.cactusArm, mats.leafB);
		arm.position.set(0.6, 1.9, 0); arm.rotation.z = 0.5; arm.castShadow = true;
		clump.add(arm);
	}
	return clump;
}

// --- Frontier town ---------------------------------------------------------
// A painted board sign for a storefront's false front. Unlit so the lettering
// stays legible at dusk; weathered cream serif on dark stained wood.
function frontierSignTexture(label) {
	const c = document.createElement('canvas');
	c.width = 256; c.height = 80;
	const x = c.getContext('2d');
	x.fillStyle = '#2b1d12'; x.fillRect(0, 0, 256, 80);
	x.strokeStyle = '#5a3f27'; x.lineWidth = 6; x.strokeRect(4, 4, 248, 72);
	x.fillStyle = '#e9d9b6';
	x.textAlign = 'center'; x.textBaseline = 'middle';
	let size = 38;
	do { x.font = `700 ${size}px Georgia, "Times New Roman", serif`; size -= 2; }
	while (x.measureText(label).width > 224 && size > 16);
	x.fillText(label, 128, 44);
	const tex = new CanvasTexture(c);
	tex.colorSpace = SRGBColorSpace;
	return tex;
}

// One false-front storefront, facade on its local +Z so the ring can rotate it
// to face the square. Body + tall flat false front + porch awning on posts +
// door, glass, and a painted sign. Geometry/material are shared (a unit box and
// unit post scaled per part), so a whole street is a handful of buffers.
function makeStorefront(geo, mats, rand, label) {
	const g = new Group();
	const w = 5 + rand() * 3.5, d = 4 + rand() * 2, h = 3 + rand() * 1.4;
	const wood = mats.wood[Math.floor(rand() * mats.wood.length)];

	const body = new Mesh(geo.box, wood);
	body.scale.set(w, h, d); body.position.y = h / 2;
	body.castShadow = true; body.receiveShadow = true; g.add(body);

	// Tall flat false front that hides the roof and carries the sign.
	const ffH = h * (0.5 + rand() * 0.25);
	const ff = new Mesh(geo.box, wood);
	ff.scale.set(w, ffH, 0.3); ff.position.set(0, h + ffH / 2, d / 2 - 0.15);
	ff.castShadow = true; g.add(ff);

	// Shallow shed roof sloping back, just peeking past the false front.
	const roof = new Mesh(geo.box, mats.roof);
	roof.scale.set(w + 0.4, 0.2, d + 0.4); roof.position.set(0, h + 0.05, -0.15);
	roof.rotation.x = -0.07; roof.castShadow = true; g.add(roof);

	// Porch awning over the boardwalk, on two posts.
	const porchD = 1.7;
	const awn = new Mesh(geo.box, mats.roof);
	awn.scale.set(w, 0.16, porchD); awn.position.set(0, h * 0.74, d / 2 + porchD / 2);
	awn.rotation.x = 0.13; awn.castShadow = true; g.add(awn);
	for (const sx of [-1, 1]) {
		const post = new Mesh(geo.post, mats.beam);
		post.scale.set(1, h * 0.74, 1);
		post.position.set(sx * (w / 2 - 0.45), h * 0.37, d / 2 + porchD - 0.25);
		post.castShadow = true; g.add(post);
	}

	// Door + two windows. The saloon glows warm; everyone else has dark glass.
	const door = new Mesh(geo.box, mats.door);
	door.scale.set(1.1, h * 0.62, 0.12); door.position.set(0, h * 0.31, d / 2 + 0.07); g.add(door);
	const winMat = label === 'SALOON' ? mats.litWindow : mats.glass;
	for (const sx of [-1, 1]) {
		const win = new Mesh(geo.box, winMat);
		win.scale.set(1.2, 1.0, 0.12); win.position.set(sx * (w * 0.27), h * 0.6, d / 2 + 0.07); g.add(win);
	}

	// Painted sign across the false front.
	const sign = new Mesh(geo.box, new MeshBasicMaterial({ map: frontierSignTexture(label) }));
	sign.scale.set(Math.min(w * 0.92, 4.8), Math.min(ffH * 0.62, 1.5), 0.14);
	sign.position.set(0, h + ffH * 0.5, d / 2 + 0.02); g.add(sign);

	return g;
}

// A timber water tower: a banded tank on four braced legs under a conic cap,
// the tallest thing on the skyline and the town's signature silhouette.
function makeWaterTower(geo, mats) {
	const g = new Group();
	const legH = 7;
	for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
		const leg = new Mesh(geo.post, mats.beam);
		leg.scale.set(1.1, legH, 1.1);
		leg.position.set(sx * 1.7, legH / 2, sz * 1.7);
		leg.rotation.x = sz * 0.06; leg.rotation.z = -sx * 0.06;
		leg.castShadow = true; g.add(leg);
	}
	// Cross brace.
	const brace = new Mesh(geo.box, mats.beam);
	brace.scale.set(4.6, 0.2, 0.2); brace.position.y = legH * 0.5; g.add(brace);
	const tank = new Mesh(geo.tank, mats.wood[0]);
	tank.position.y = legH + 1.7; tank.castShadow = true; g.add(tank);
	const cap = new Mesh(geo.cap, mats.roof);
	cap.position.y = legH + 3.7; cap.castShadow = true; g.add(cap);
	return g;
}

// Scatter props: barrels, crates, wagon wheels, hitching rails, water troughs,
// the small clutter that turns an empty lot into a lived-in town.
function makeProp(kind, geo, mats, rand) {
	const g = new Group();
	if (kind === 'barrel') {
		const b = new Mesh(geo.barrel, mats.wood[1]);
		b.position.y = 0.5; b.castShadow = true; g.add(b);
	} else if (kind === 'crate') {
		const c = new Mesh(geo.box, mats.crate);
		const s = 0.7 + rand() * 0.4; c.scale.setScalar(s); c.position.y = s / 2;
		c.rotation.y = rand() * Math.PI; c.castShadow = true; g.add(c);
	} else if (kind === 'wheel') {
		const w = new Mesh(geo.wheel, mats.beam);
		w.position.y = 0.55; w.rotation.x = Math.PI / 2; w.rotation.z = (rand() - 0.5) * 0.4;
		w.castShadow = true; g.add(w);
		for (let i = 0; i < 4; i++) {
			const spoke = new Mesh(geo.box, mats.beam);
			spoke.scale.set(0.07, 0.07, 1); spoke.position.y = 0.55;
			spoke.rotation.x = Math.PI / 2; spoke.rotation.y = (i / 4) * Math.PI;
			g.add(spoke);
		}
	} else if (kind === 'hitch') {
		for (const sx of [-1, 1]) {
			const post = new Mesh(geo.post, mats.beam);
			post.scale.set(0.8, 1.1, 0.8); post.position.set(sx * 1.1, 0.55, 0);
			post.castShadow = true; g.add(post);
		}
		const rail = new Mesh(geo.box, mats.beam);
		rail.scale.set(2.6, 0.16, 0.16); rail.position.y = 1.0; g.add(rail);
	} else if (kind === 'trough') {
		const t = new Mesh(geo.box, mats.wood[2]);
		t.scale.set(2.2, 0.6, 0.8); t.position.y = 0.3; t.castShadow = true; g.add(t);
		const water = new Mesh(geo.box, mats.water);
		water.scale.set(2.0, 0.05, 0.6); water.position.y = 0.56; g.add(water);
	}
	return g;
}

// Build the whole frontier town: a ring of storefronts facing the square, a
// water tower, scattered props, and a couple of tumbleweeds that the caller
// animates. Everything sits OUTSIDE playRadius so it frames the plaza without
// ever blocking a player.
//
// The static dressing goes into `batch` (one InstancedMesh per shared
// geometry+material instead of ~330 individual boxes and posts); only the
// tumbleweeds, which move every frame, are added to `root` directly.
function buildFrontierTown(root, rand, playRadius, batch) {
	const between = (a, b) => a + (b - a) * rand();
	const mats = {
		wood: [
			new MeshStandardMaterial({ color: 0x6e5238, roughness: 1, metalness: 0 }),
			new MeshStandardMaterial({ color: 0x8a5a3c, roughness: 1, metalness: 0 }),
			new MeshStandardMaterial({ color: 0x9a7a4e, roughness: 1, metalness: 0 }),
			new MeshStandardMaterial({ color: 0x8a3b2e, roughness: 1, metalness: 0 }), // barn red
			new MeshStandardMaterial({ color: 0x4d6b66, roughness: 1, metalness: 0 }), // faded teal
		],
		beam: new MeshStandardMaterial({ color: 0x4a3624, roughness: 1, metalness: 0 }),
		roof: new MeshStandardMaterial({ color: 0x3a2c1e, roughness: 1, metalness: 0 }),
		door: new MeshStandardMaterial({ color: 0x2a1d12, roughness: 0.9, metalness: 0 }),
		crate: new MeshStandardMaterial({ color: 0xa8824a, roughness: 1, metalness: 0 }),
		glass: new MeshStandardMaterial({ color: 0x1a1612, roughness: 0.4, metalness: 0.1 }),
		litWindow: new MeshBasicMaterial({ color: 0xffb15a }),
		water: new MeshStandardMaterial({ color: 0x3a5a64, roughness: 0.3, metalness: 0.1 }),
	};
	const geo = {
		box: new BoxGeometry(1, 1, 1),
		post: new CylinderGeometry(0.16, 0.18, 1, 8),
		barrel: new CylinderGeometry(0.5, 0.42, 1, 12),
		wheel: new TorusGeometry(0.5, 0.09, 6, 16),
		tank: new CylinderGeometry(2.4, 2.4, 3.4, 18),
		cap: new ConeGeometry(2.9, 1.8, 18),
		bush: new IcosahedronGeometry(1, 0),
		cactus: new CylinderGeometry(0.5, 0.6, 3.2, 8),
		cactusArm: new CylinderGeometry(0.26, 0.3, 1.6, 7),
	};

	// Storefronts around the square. A seeded, shuffled name list keeps every
	// town's row of shops stable per coin but never in the same order twice.
	const NAMES = [
		'SALOON', 'GENERAL STORE', 'SHERIFF', 'BANK', 'HOTEL', 'LIVERY',
		'ASSAY OFFICE', 'BARBER', 'GAZETTE', 'TELEGRAPH', 'GUNSMITH', 'TRADING POST',
		'LAND OFFICE', 'STABLES', 'JAIL', 'POST OFFICE',
	];
	const names = NAMES.slice();
	for (let i = names.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		[names[i], names[j]] = [names[j], names[i]];
	}
	const COUNT = 13;
	for (let i = 0; i < COUNT; i++) {
		// Even spread with a little jitter, leaving a clear gap at the spawn-facing
		// south (the open road into town) so the entrance never walls a player in.
		const a = (i / COUNT) * Math.PI * 2 + between(-0.06, 0.06) + 0.24;
		const R = playRadius + 5.5 + between(0, 3);
		const shop = makeStorefront(geo, mats, rand, names[i % names.length]);
		shop.position.set(Math.cos(a) * R, 0, Math.sin(a) * R);
		shop.rotation.y = Math.atan2(-Math.cos(a), -Math.sin(a)); // facade faces the square
		batch.add(shop);
	}

	// Water tower off one corner of the square.
	const ta = 0.9;
	const tower = makeWaterTower(geo, mats);
	tower.position.set(Math.cos(ta) * (playRadius + 14), 0, Math.sin(ta) * (playRadius + 14));
	batch.add(tower);

	// Clutter scattered through the band between the boundary and the storefronts.
	const KINDS = ['barrel', 'crate', 'wheel', 'hitch', 'trough', 'barrel', 'crate'];
	for (let i = 0; i < 26; i++) {
		const a = rand() * Math.PI * 2;
		const R = playRadius + between(2.5, 12);
		const prop = makeProp(KINDS[Math.floor(rand() * KINDS.length)], geo, mats, rand);
		prop.position.set(Math.cos(a) * R, 0, Math.sin(a) * R);
		prop.rotation.y = rand() * Math.PI * 2;
		batch.add(prop);
	}

	// A couple of tumbleweeds drifting the mesa band beyond the town, pure life.
	// Returned to the caller so they roll on the same animator clock as the world.
	const tumbleMat = new MeshStandardMaterial({ color: 0x8a6e44, roughness: 1, metalness: 0, flatShading: true, wireframe: true });
	const tumbleGeo = new IcosahedronGeometry(0.9, 1);
	const tumbles = [];
	for (let i = 0; i < 2; i++) {
		const tw = new Mesh(tumbleGeo, tumbleMat);
		tw.castShadow = true;
		root.add(tw);
		tumbles.push({ mesh: tw, phase: i * 0.5, lane: playRadius + 16 + i * 6, speed: 6 + i * 1.5 });
	}
	return tumbles;
}

export function createWorldEnvironment(scene, renderer, playRadius = 58, opts = {}) {
	const seed = (typeof opts.seed === 'number' ? opts.seed : seedFromString(opts.mint)) >>> 0;
	// A curated world can pin its archetype by id; everyone else draws theirs from
	// the mint seed. The per-coin palette jitter below still runs off the seed, so
	// even a pinned biome keeps a touch of this coin's own colour.
	const biome = (opts.biome && biomeById(opts.biome)) || biomeForSeed(seed);
	const root = new Group();
	scene.add(root);
	const rand = rng(seed || 0x3d3d3d);
	const between = (a, b) => a + (b - a) * rand();
	const animators = [];

	// --- Sky + atmosphere --------------------------------------------------
	scene.fog = new Fog(new Color(biome.fog), biome.fogNear, biome.fogFar);
	// Swap the graded sky backdrop and retint the fog. Exposed via setSky() so the
	// day/night cycle can move the whole atmosphere across the day; the previous
	// texture is disposed so a long session doesn't leak canvases.
	function applySky(top, mid, horizon, fogColor) {
		// Transparent embed: never paint a sky backdrop so the host page shows
		// through the canvas. The day/night cycle still calls this to retint fog,
		// which we keep; only the opaque background is suppressed.
		if (opts.transparent) {
			scene.background?.dispose?.();
			scene.background = null;
			if (fogColor && scene.fog) scene.fog.color.set(fogColor);
			return;
		}
		const tex = gradientSky(top, mid, horizon);
		scene.background?.dispose?.();
		scene.background = tex;
		if (fogColor && scene.fog) scene.fog.color.set(fogColor);
	}
	applySky(biome.sky[0], biome.sky[1], biome.sky[2]);

	// --- Lighting ----------------------------------------------------------
	// One key sun (casts the long shadows), a sky/ground hemisphere fill, and a
	// touch of ambient so shadowed geometry never goes muddy. All biome-tuned.
	const hemi = new HemisphereLight(biome.hemi[0], biome.hemi[1], biome.hemi[2]);
	const ambient = new AmbientLight(0xffffff, biome.ambient);
	root.add(hemi);
	root.add(ambient);

	const sun = new Vector3();
	sun.setFromSphericalCoords(1, MathUtils.degToRad(90 - biome.sun.elevation), MathUtils.degToRad(biome.sun.azimuth));
	const sunLight = new DirectionalLight(biome.sun.color, biome.sun.intensity);
	sunLight.position.copy(sun).multiplyScalar(120);
	sunLight.castShadow = true;
	sunLight.shadow.mapSize.set(2048, 2048);
	const sc = sunLight.shadow.camera;
	sc.left = -70; sc.right = 70; sc.top = 70; sc.bottom = -70; sc.near = 1; sc.far = 400;
	sunLight.shadow.bias = -0.0004;
	root.add(sunLight, sunLight.target);

	// --- Palette (per-coin jitter over the biome base) ---------------------
	const cGround = jitter(biome.ground, rand);
	const cPlaza = jitter(biome.plaza, rand, 0.04, 0.04);
	const cHill = jitter(biome.hill, rand);
	const cRing = jitter(biome.ring, rand, 0.12, 0.04);

	// --- Ground ------------------------------------------------------------
	const field = new Mesh(new CircleGeometry(400, 64),
		new MeshStandardMaterial({ color: cGround, roughness: 1, metalness: 0 }));
	field.rotation.x = -Math.PI / 2; field.receiveShadow = true;
	root.add(field);

	const plaza = new Mesh(new CircleGeometry(playRadius, 64),
		new MeshStandardMaterial({ color: cPlaza, roughness: 1, metalness: 0 }));
	plaza.rotation.x = -Math.PI / 2; plaza.position.y = 0.01; plaza.receiveShadow = true;
	root.add(plaza);

	// Faint paving grid over the plaza, a sense of scale that the haze fades.
	const grid = new GridHelper(playRadius * 2, 30, biome.grid, biome.grid);
	grid.position.y = 0.02;
	grid.material.transparent = true;
	grid.material.opacity = 0.18;
	grid.material.depthWrite = false;
	root.add(grid);

	// Glowing boundary hairline, the bright accent ring around the plaza, the
	// most per-coin-distinct colour in the scene.
	const ring = new Mesh(new RingGeometry(playRadius - 0.12, playRadius + 0.12, 128),
		new MeshBasicMaterial({ color: cRing, transparent: true, opacity: 0.55, side: DoubleSide }));
	ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03;
	root.add(ring);

	// --- Distant hills -----------------------------------------------------
	// A ring of broad, low mounds beyond the flora gives the horizon depth,
	// hazing into the biome's sky seam.
	//
	// Hills, flora and town dressing are all static, all built from a handful of
	// shared geometry+material pairs, and all go through the batcher below: the
	// scene ends up with one InstancedMesh per pair instead of several hundred
	// individually-submitted meshes (each of which also cost a second submission
	// in the sun's shadow pass).
	const batch = createStaticBatcher();
	const hillGeo = new IcosahedronGeometry(1, 1);
	const hillMat = new MeshStandardMaterial({ color: cHill, roughness: 1, metalness: 0, flatShading: true });
	for (let i = 0; i < 14; i++) {
		const ang = (i / 14) * Math.PI * 2 + between(-0.12, 0.12);
		const dist = between(150, 210);
		const h = new Mesh(hillGeo, hillMat);
		const w = between(45, 80), tall = between(14, 30);
		h.scale.set(w, tall, w);
		h.position.set(Math.cos(ang) * dist, tall * 0.18 - tall, Math.sin(ang) * dist);
		batch.add(h);
	}

	// --- Flora -------------------------------------------------------------
	// Shared geometry + materials; one builder per biome scatters them in a band
	// just outside the play circle. Two leaf tones per biome give natural variety.
	const cLeafA = jitter(biome.leafA, rand, 0.05, 0.05);
	const cLeafB = jitter(biome.leafB, rand, 0.05, 0.05);
	const neon = biome.flora === 'crystal';
	const mats = {
		trunk: new MeshStandardMaterial({ color: jitter(biome.trunk, rand, 0.03, 0.04), roughness: 1, metalness: 0 }),
		leafA: new MeshStandardMaterial({ color: cLeafA, roughness: neon ? 0.3 : 1, metalness: 0, flatShading: true, emissive: neon ? cLeafA : 0x000000, emissiveIntensity: neon ? 0.6 : 0 }),
		leafB: new MeshStandardMaterial({ color: cLeafB, roughness: neon ? 0.3 : 1, metalness: 0, flatShading: true, emissive: neon ? cLeafB : 0x000000, emissiveIntensity: neon ? 0.6 : 0 }),
	};
	const geo = {
		trunk: new CylinderGeometry(0.22, 0.34, 2.4, 6),
		leaf: new ConeGeometry(1.5, 3.2, 7),
		cactus: new CylinderGeometry(0.5, 0.6, 3.2, 8),
		cactusArm: new CylinderGeometry(0.26, 0.3, 1.6, 7),
		deadTrunk: new CylinderGeometry(0.18, 0.3, 3.4, 6),
		branch: new CylinderGeometry(0.08, 0.14, 1.6, 5),
		crystal: new ConeGeometry(0.6, 1, 5),
		palmTrunk: new CylinderGeometry(0.22, 0.36, 5.2, 7),
		frond: new ConeGeometry(0.5, 3.4, 4),
		bush: new IcosahedronGeometry(1, 0),
	};
	const builder = {
		conifer: makeConifer, snowpine: (g, m, r) => makeConifer(g, m, r, true),
		cactus: makeCactus, deadtree: makeDeadtree, crystal: makeCrystal, palm: makePalm,
		sagebrush: makeSagebrush,
	}[biome.flora] || makeConifer;

	for (let i = 0; i < biome.density; i++) {
		const ang = rand() * Math.PI * 2;
		const dist = between(playRadius + 6, playRadius + 60);
		const s = between(0.8, 1.7);
		const plant = builder(geo, mats, rand);
		plant.position.set(Math.cos(ang) * dist, 0, Math.sin(ang) * dist);
		plant.scale.multiplyScalar(s);
		plant.rotation.y = rand() * Math.PI * 2;
		batch.add(plant);
	}
	// Alien crystals breathe with a faint emissive shimmer, biome-specific life.
	// The pulse is written on the shared leaf materials, so every batched shard
	// picks it up without the animator touching a single mesh.
	if (neon && biome.density > 0) {
		animators.push((t) => {
			const k = 0.45 + Math.sin(t * 0.8) * 0.25;
			mats.leafA.emissiveIntensity = 0.4 + k * 0.4;
			mats.leafB.emissiveIntensity = 0.4 + (1 - k) * 0.4;
		});
	}

	// --- Town dressing -----------------------------------------------------
	// Biomes that flag a `town` get built structures ringing the square. The
	// frontier town's tumbleweeds roll on the shared animator clock, looping a
	// long chord through the mesa band and spinning as they go.
	if (biome.town === 'frontier') {
		const tumbles = buildFrontierTown(root, rand, playRadius, batch);
		const SPAN = 90; // length of the roll before it loops back
		animators.push((t, dt) => {
			for (const tw of tumbles) {
				const travel = ((t * tw.speed) + tw.phase * SPAN) % SPAN;
				tw.mesh.position.set(travel - SPAN / 2, 0.9, tw.lane);
				tw.mesh.rotation.z -= dt * tw.speed * 0.9; // roll matches its drift
				tw.mesh.rotation.x += dt * 0.6;
			}
		});
	}

	// Everything static has been collected by now: emit the instanced batches.
	// The counts are worth a line in the console because they are the single
	// number that predicts frame cost in a crowded plaza.
	const batchStats = batch.flush(root);
	log.info(
		`[world-env] ${biome.id} dressing: ${batchStats.meshes} meshes batched into ${batchStats.batches} draws`,
	);

	// --- Live-market reactivity --------------------------------------------
	// The boundary ring is the world's heartbeat: a slow breathing pulse is the
	// baseline, but a trade can kick it to a colour (green on a buy, red on a
	// sell) that decays back to the per-coin accent, so the arena visibly
	// flinches with the on-chain tape. The market-reactor drives flashRing().
	const baseRing = cRing.clone();
	const flashColor = new Color();
	let flash = 0; // 0..1, decays each frame
	animators.push((t, dt) => {
		flash = Math.max(0, flash - dt * 1.7); // ~0.6s to settle
		ring.material.opacity = 0.48 + Math.sin(t * 1.1) * 0.1 + flash * 0.5;
		ring.material.color.copy(baseRing).lerp(flashColor, flash);
	});

	// Mood is the slow weather: the rolling % change pushes the world between a
	// storm (fog closes in, the key dims) and euphoria (fog opens out, the sun
	// flares). We lerp toward the target so a jumpy feed reads as a tide, not a
	// strobe. Baselines are captured so every community settles back to its own.
	// Daytime baselines the market mood multiplies. The day/night cycle drives
	// these through setBaseSun/setBaseFog so the time of day sets the base and the
	// trade tape's mood still flexes it on top, the two compose instead of fighting.
	const base = { sun: biome.sun.intensity, fogNear: biome.fogNear, fogFar: biome.fogFar };
	let mood = 0, moodTarget = 0; // -1 storm … +1 euphoric
	animators.push((t, dt) => {
		mood += (moodTarget - mood) * Math.min(1, dt * 0.6);
		scene.fog.near = base.fogNear * (1 + mood * 0.18);
		scene.fog.far = base.fogFar * (1 + mood * 0.28);
		sunLight.intensity = base.sun * (1 + mood * 0.22);
	});

	let t = 0;
	return {
		biome,
		seed,
		// Handles the day/night cycle writes through (createDayNightCycle reads
		// these). `sun` is the unit direction vector the sunLight position derives
		// from; the cycle re-aims and re-colours it across the day.
		lights: { sunLight, sun, hemi, ambient },
		// Replace the graded sky + fog tint (used by the day/night cycle).
		setSky(top, mid, horizon, fogColor) { applySky(top, mid, horizon, fogColor); },
		// Set the daytime base the market mood multiplies (see `base` above).
		setBaseSun(v) { base.sun = v; },
		setBaseFog(near, far) { base.fogNear = near; base.fogFar = far; },
		// Kick the boundary ring to a colour. strength 0..1 sets the flash
		// intensity; it decays back to the coin's accent within ~0.6s.
		flashRing(color, strength = 0.6) {
			const s = Math.max(0, Math.min(1, strength));
			if (s <= flash) return; // don't let a small trade stomp a bigger one mid-decay
			flash = s;
			flashColor.set(color);
		},
		// Set the weather target from a signed intensity (−1 storm … +1 euphoric).
		setMood(target) {
			moodTarget = Math.max(-1, Math.min(1, target || 0));
		},
		update(dt) {
			t += dt;
			for (const a of animators) a(t, dt);
		},
		dispose() {
			scene.remove(root);
			scene.background?.dispose?.();
			scene.background = null;
			scene.fog = null;
			// Instanced batches hold a per-instance attribute of their own on top
			// of the shared geometry, so they need dispose() as well as the
			// geometry/material sweep below.
			disposeInstanced(root);
			// The sun is a DirectionalLight, not a Mesh, so the traverse below skips
			// it, and its 2048x2048 shadow depth target is one of the largest GPU
			// allocations in the world. Free it explicitly, or every coin-world switch
			// strands another full-size shadow map in VRAM.
			sunLight.shadow?.map?.dispose?.();
			sunLight.dispose?.();
			root.traverse((n) => {
				if (n.isMesh || n.isLine) {
					n.geometry?.dispose?.();
					const ms = Array.isArray(n.material) ? n.material : [n.material];
					for (const m of ms) m?.dispose?.();
				}
			});
		},
	};
}

// Tests for the /club bouncer (src/club-bouncer.js): where he stands relative
// to the door, that the player can't walk through him, and that he acts out
// each `club:door-state` beat the cover gate emits.
//
// Builds a synthetic canonical rig + an in-memory idle clip (no GLB, no fetch,
// no WebGL), mirroring animation-playonce.test.js. vitest runs under
// `environment: 'node'`, so `window` is a bare EventTarget with a viewport and
// the speech bubble is a minimal classList/textContent stand-in.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	AnimationClip,
	Bone,
	BoxGeometry,
	Float32BufferAttribute,
	Group,
	Mesh,
	MeshBasicMaterial,
	Object3D,
	PerspectiveCamera,
	QuaternionKeyframeTrack,
	Raycaster,
	Scene,
	Skeleton,
	SkinnedMesh,
	Uint16BufferAttribute,
	Vector3,
	VectorKeyframeTrack,
} from 'three';
import { ClubBouncer, BOUNCER_RADIUS } from '../src/club-bouncer.js';

const RIG_BONES = ['Hips', 'Spine', 'Chest', 'Neck', 'Head', 'LeftArm', 'RightArm', 'LeftUpLeg'];

function makeRig(boneNames = RIG_BONES) {
	const root = new Object3D();
	const bones = boneNames.map((name) => {
		const b = new Bone();
		b.name = name;
		return b;
	});
	for (let i = 1; i < bones.length; i++) bones[i - 1].add(bones[i]);
	// A real skinned body (every vertex on the hips) so the bouncer can measure
	// and scale it the way it does a loaded GLB.
	const body = new BoxGeometry(0.5, 1.8, 0.3);
	body.translate(0, 0.9, 0);
	const verts = body.attributes.position.count;
	body.setAttribute('skinIndex', new Uint16BufferAttribute(new Uint16Array(verts * 4), 4));
	const weights = new Float32Array(verts * 4);
	for (let i = 0; i < verts; i++) weights[i * 4] = 1;
	body.setAttribute('skinWeight', new Float32BufferAttribute(weights, 4));
	const mesh = new SkinnedMesh(body, new MeshBasicMaterial());
	mesh.add(bones[0]);
	mesh.bind(new Skeleton(bones));
	root.add(mesh);
	return root;
}

function idleClipJson() {
	const tracks = [
		new QuaternionKeyframeTrack('Hips.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
		new QuaternionKeyframeTrack('Spine.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
		new QuaternionKeyframeTrack('LeftArm.quaternion', [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]),
		new VectorKeyframeTrack('Hips.position', [0, 1], [0, 1, 0, 0, 1, 0]),
	];
	return AnimationClip.toJSON(new AnimationClip('idle', 1, tracks));
}

function makeBubble() {
	const classes = new Set();
	const line = { textContent: '' };
	return {
		line,
		style: {},
		classList: {
			add: (c) => classes.add(c),
			remove: (c) => classes.delete(c),
			contains: (c) => classes.has(c),
			toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)),
		},
		querySelector: () => line,
	};
}

// A flat alley floor, optionally with a wall close on one side of the door.
function makeAlley({ wallAtX = null, steps = false } = {}) {
	const env = new Group();
	const floor = new Mesh(new BoxGeometry(40, 0.2, 40), new MeshBasicMaterial());
	floor.position.y = -0.1;
	env.add(floor);
	if (wallAtX != null) {
		const wall = new Mesh(new BoxGeometry(0.2, 6, 40), new MeshBasicMaterial());
		wall.position.set(wallAtX, 3, 0);
		env.add(wall);
	}
	if (steps) {
		// A door up a flight of steps, with a plinth running along the wall.
		const stairs = new Mesh(new BoxGeometry(2.6, 0.8, 1.4), new MeshBasicMaterial());
		stairs.position.set(0, 0.4, 0.7);
		const plinth = new Mesh(new BoxGeometry(40, 0.5, 0.6), new MeshBasicMaterial());
		plinth.position.set(0, 0.25, 0.3);
		env.add(stairs, plinth);
	}
	env.updateMatrixWorld(true);
	return env;
}

// The door sits at the origin; the alley (and the player) lie toward +Z.
const PATH = { dir: new Vector3(0, 0, 1), door: new Vector3(0, 0, 0.35), spawn: new Vector3(0, 0, 4.5) };
const DOOR_ANCHOR = { size: new Vector3(1.4, 2.4, 0.2) };

function doorState(detail) {
	window.dispatchEvent(new CustomEvent('club:door-state', { detail }));
}

describe('ClubBouncer', () => {
	let scene, bubble, camera, bouncer;

	beforeEach(() => {
		vi.stubGlobal('window', Object.assign(new EventTarget(), { innerWidth: 1440, innerHeight: 860 }));
		scene = new Scene();
		bubble = makeBubble();
		camera = new PerspectiveCamera(55, 1440 / 860, 0.08, 200);
		camera.position.set(0, 1.6, 8);
		camera.lookAt(0, 1.2, 0);
		camera.updateMatrixWorld(true);
		bouncer = new ClubBouncer({ scene, model: makeRig(), manifest: [], idleClipJson: idleClipJson(), bubbleEl: bubble });
	});

	afterEach(() => {
		bouncer.dispose();
		vi.unstubAllGlobals();
	});

	it('stands beside the doorway, off the wall, facing down the alley', async () => {
		expect(await bouncer.mount({ envRoot: makeAlley(), path: PATH, doorAnchor: DOOR_ANCHOR })).toBe(true);
		expect(bouncer.mounted).toBe(true);
		expect(bouncer.group.visible).toBe(true);
		// Clear of the door opening (half its width) with room to walk past him.
		expect(Math.abs(bouncer.position.x)).toBeGreaterThan(DOOR_ANCHOR.size.x / 2 + BOUNCER_RADIUS * 0.5);
		// On the alley side of the door plane, not inside the wall.
		expect(bouncer.position.z).toBeGreaterThan(PATH.door.z);
		expect(bouncer.position.y).toBeCloseTo(0, 5);
		// Facing the approaching player (+Z).
		expect(bouncer.group.rotation.y).toBeCloseTo(0, 5);
	});

	it('posts on the pavement at the foot of the steps, never on or inside them', async () => {
		await bouncer.mount({ envRoot: makeAlley({ steps: true }), path: PATH, doorAnchor: DOOR_ANCHOR });
		expect(bouncer.position.y).toBeCloseTo(0, 5); // the level the player walks, not the stair top
		expect(bouncer.position.z).toBeGreaterThan(0.6 + 0.4); // clear of the plinth face
		// A body's width from the stair block on every side.
		const dx = Math.max(0, Math.abs(bouncer.position.x) - 1.3);
		const dz = Math.max(0, bouncer.position.z - 1.4);
		expect(Math.hypot(dx, dz)).toBeGreaterThanOrEqual(0.4);
	});

	it('takes the roomier side of the door', async () => {
		await bouncer.mount({ envRoot: makeAlley({ wallAtX: 2.2 }), path: PATH, doorAnchor: DOOR_ANCHOR });
		expect(bouncer.position.x).toBeLessThan(0);
	});

	it('never posts a rig the clip library cannot drive', async () => {
		const prop = new ClubBouncer({ scene, model: new Object3D(), manifest: [], idleClipJson: idleClipJson(), bubbleEl: makeBubble() });
		expect(await prop.mount({ envRoot: makeAlley(), path: PATH, doorAnchor: DOOR_ANCHOR })).toBe(false);
		expect(prop.mounted).toBe(false);
		expect(prop.group.visible).toBe(false);
		prop.dispose();
	});

	it('holds his ground when the player walks into him, and says so once', async () => {
		await bouncer.mount({ envRoot: makeAlley(), path: PATH, doorAnchor: DOOR_ANCHOR });
		const player = bouncer.position.clone().add(new Vector3(0.1, 0, 0.1));
		expect(bouncer.resolveCollision(player, 10_000)).toBe(true);
		expect(Math.hypot(player.x - bouncer.position.x, player.z - bouncer.position.z)).toBeCloseTo(BOUNCER_RADIUS, 5);
		expect(bubble.line.textContent).toMatch(/Easy/);

		bubble.line.textContent = '';
		player.copy(bouncer.position).add(new Vector3(0.1, 0, 0));
		bouncer.resolveCollision(player, 11_000); // within the cooldown: pushes, stays quiet
		expect(bubble.line.textContent).toBe('');

		const clear = bouncer.position.clone().add(new Vector3(2, 0, 0));
		expect(bouncer.resolveCollision(clear, 20_000)).toBe(false);
	});

	it('calls the cover once as you come down the alley, then again at the door', async () => {
		await bouncer.mount({ envRoot: makeAlley(), path: PATH, doorAnchor: DOOR_ANCHOR });
		bouncer.update(0.016, new Vector3(0, 0, 20), camera, { nearDoor: false });
		expect(bubble.classList.contains('is-visible')).toBe(false);

		bouncer.update(0.016, new Vector3(0, 0, 5), camera, { nearDoor: false });
		expect(bubble.line.textContent).toMatch(/penny/);

		bubble.line.textContent = '';
		bouncer.update(0.016, new Vector3(0, 0, 4), camera, { nearDoor: false });
		expect(bubble.line.textContent).toBe(''); // noticed already

		bouncer.update(0.016, new Vector3(0, 0, 1.5), camera, { nearDoor: true });
		expect(bubble.line.textContent).toMatch(/One cent/);
	});

	it('acts out the cover flow the gate announces', async () => {
		await bouncer.mount({ envRoot: makeAlley(), path: PATH, doorAnchor: DOOR_ANCHOR });

		doorState({ state: 'checking' });
		expect(bubble.line.textContent).toMatch(/Reading your wallet/);
		bouncer.explain(); // busy with the list: no small talk
		expect(bubble.line.textContent).toMatch(/Reading your wallet/);

		doorState({ state: 'admitted', tier: 'vip' });
		expect(bubble.line.textContent).toMatch(/boss/);
		doorState({ state: 'admitted', tier: 'regular' });
		expect(bubble.line.textContent).toMatch(/again/);
		doorState({ state: 'admitted', tier: 'new' });
		expect(bubble.line.textContent).toMatch(/First night/);

		doorState({ state: 'denied', reason: 'Wallet is on the ban list.' });
		expect(bubble.line.textContent).toBe('Wallet is on the ban list. Not tonight.');

		// A failed or cancelled pay drops back to the queue: he is approachable again.
		doorState({ state: 'queue' });
		bouncer.explain();
		expect(bubble.line.textContent).toMatch(/x402/);
	});

	it('watches the player without ever over-rotating his head', async () => {
		await bouncer.mount({ envRoot: makeAlley(), path: PATH, doorAnchor: DOOR_ANCHOR });
		// Player directly behind him: far outside what a neck can do.
		const behind = bouncer.position.clone().add(new Vector3(0, 0, -6));
		for (let i = 0; i < 240; i++) bouncer.update(1 / 60, behind, camera, { nearDoor: false });
		const settled = bouncer.headBone.quaternion.clone();
		expect(2 * Math.acos(Math.min(1, Math.abs(settled.w)))).toBeLessThan(1.2);
		// The look-at is re-derived each frame, never stacked onto the last one.
		for (let i = 0; i < 240; i++) bouncer.update(1 / 60, behind, camera, { nearDoor: false });
		expect(bouncer.headBone.quaternion.angleTo(settled)).toBeLessThan(1e-3);
	});

	it('is clickable while posted and stands down once the cover is paid', async () => {
		await bouncer.mount({ envRoot: makeAlley(), path: PATH, doorAnchor: DOOR_ANCHOR });
		const hitbox = new Mesh(new BoxGeometry(0.6, 1.9, 0.4), new MeshBasicMaterial());
		hitbox.position.y = 0.95;
		bouncer.group.add(hitbox);
		bouncer.group.updateMatrixWorld(true);
		const ray = new Raycaster(new Vector3(bouncer.position.x, 1, 10), new Vector3(0, 0, -1));
		expect(bouncer.hitTest(ray)).toBe(true);

		bouncer.say('anything', 0);
		bouncer.unmount();
		expect(bouncer.hitTest(ray)).toBe(false);
		expect(bubble.classList.contains('is-visible')).toBe(false);
		expect(scene.children.includes(bouncer.group)).toBe(false);

		bubble.line.textContent = '';
		doorState({ state: 'checking' }); // off duty: ignores the gate
		expect(bubble.line.textContent).toBe('');
	});
});

// /club bouncer: the doorman standing beside the alley door.
//
// The cover card (src/club-gate.js) has always said "the bouncer checks your
// wallet on-chain"; this module puts him in the scene. He is a real rigged
// avatar (a bundled humanoid GLB, tinted into a black suit and shades) planted
// beside the modelled door in the alley (src/club-entrance.js), a head taller
// than you. He watches you walk up (head + shoulders track the player), calls
// the cover as you approach, and acts out every beat of the x402 cover flow,
// driven by the `club:door-state` events the gate emits:
//
//   queue    → tells you the price            checking → looks down at the list
//   admitted → nods you through (by tier)     denied   → shakes his head
//
// Click or tap him and he explains how the club works, one line at a time, so
// a first-time visitor learns the loop (cover, then tips put a dancer on the
// pole) without leaving the alley. Walk into him and he holds his ground.
//
// Speech renders in a DOM bubble (#club-bouncer-bubble, an aria-live region)
// projected over his head each frame. Any load failure degrades to no bouncer:
// the door, the cover card and the walk-in all work without him.

import { Box3, Group, Quaternion, Raycaster, Vector3 } from 'three';
import { AnimationManager } from './animation-manager.js';
import { log } from './shared/log.js';

export const BOUNCER_AVATAR_URL = '/avatars/realistic-male.glb';

const BOUNCER_HEIGHT = 1.98; // the player is 1.75; he should loom
const SUIT_TINT = 0x16161c;  // multiplies the outfit textures down to a black suit
const SUIT_MESH = /outfit|footwear/i;

// Stance: how far out from the door's centre line he stands, and how far off
// the wall. Wide enough that he never blocks the doorway you walk into.
const SIDE_CLEARANCE = 0.75;
const WALL_STANDOFF = 0.6;
const MAX_STANDOFF = 4.2;     // how far out he will look for level ground (past any steps)
const LEVEL_TOLERANCE = 0.3;  // a kerb up from the walking level is fine; a stair flight is not
const BODY_CLEARANCE = 0.42;
const CLEARANCE_RAYS = 16;     // fine enough that a stair corner can't slip between two rays
// The player can't walk through him.
export const BOUNCER_RADIUS = 0.62;

const NOTICE_RANGE = 7.5;  // first line as you come down the alley
const HEAD_YAW_LIMIT = 1.05;
const HEAD_PITCH_LIMIT = 0.32;
const BODY_YAW_LIMIT = 0.7;
const BODY_SHARE = 0.4;    // fraction of the turn the shoulders take; the head takes the rest

// One-shots + the "reading the list" loop, in preference order. Anything the
// rig can't play is skipped; he simply holds his idle stance for that beat.
const CLIP_IDLE = 'idle';
const CLIP_CHECKING = 'lookdown';
const CLIPS_ADMIT = ['nod', 'xbot-agree'];
const CLIPS_DENY = ['xbot-head-shake'];
const REACTION_CLIPS = [CLIP_CHECKING, ...CLIPS_ADMIT, ...CLIPS_DENY];

const LINES = {
	notice: "Cover's a penny tonight. Step up to the door.",
	atDoor: 'One cent, in USDC or $THREE. Wallet out when you are ready.',
	queue: 'One cent gets you in for the whole night.',
	leftLine: 'Door stays here. Come back when you are ready.',
	checking: 'Hold still. Reading your wallet on-chain.',
	admittedNew: 'First night? You are good. Enjoy yourself.',
	admittedRegular: 'Good to see you again. Head on in.',
	admittedVip: 'Back again, boss. Go right through.',
	denied: 'Not tonight.',
	bump: 'Easy. The door is right there.',
};
// Tap-to-talk: how the club works, in the order a newcomer needs it.
const EXPLAINERS = [
	'Cover is one cent, in USDC or $THREE, paid over x402 on Solana. It settles before the rope drops.',
	'One cover lasts the night on this device. Reload and you walk straight in.',
	'Inside there are three poles. A tenth of a cent tips a dancer, and the tip is what starts the routine.',
	'I read the paying wallet on-chain: the ban list, and how many nights you have been here.',
	'Regulars get remembered. Come back enough and you walk in as a VIP.',
];

const UP = new Vector3(0, 1, 0);
const DOWN = new Vector3(0, -1, 0);
const _v = new Vector3();
const _head = new Vector3();
const _right = new Vector3();
const _q = new Quaternion();
const _pq = new Quaternion();
const _pqInv = new Quaternion();
const _box = new Box3();

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function wrapAngle(a) {
	a %= Math.PI * 2;
	if (a > Math.PI) a -= Math.PI * 2;
	if (a < -Math.PI) a += Math.PI * 2;
	return a;
}

// Scale the rig to `height` and put its feet on the group's origin. A model
// with no measurable bounds is left as authored rather than scaled to nothing.
function standAtHeight(model, height) {
	_box.setFromObject(model, true);
	const tall = _box.max.y - _box.min.y;
	if (Number.isFinite(tall) && tall > 0) model.scale.multiplyScalar(height / tall);
	_box.setFromObject(model, true);
	if (Number.isFinite(_box.min.y)) model.position.y -= _box.min.y;
}

export class ClubBouncer {
	/**
	 * @param {object} opts
	 * @param {import('three').Scene} opts.scene
	 * @param {import('three').Object3D} opts.model        the loaded bouncer GLB scene
	 * @param {Array} opts.manifest                        animation manifest (name→url defs)
	 * @param {object|null} opts.idleClipJson              pre-fetched idle clip (shared with the player)
	 * @param {HTMLElement|null} opts.bubbleEl             the speech bubble element
	 * @param {boolean} [opts.reducedMotion]
	 */
	constructor({ scene, model, manifest, idleClipJson, bubbleEl, reducedMotion = false }) {
		this.scene = scene;
		this.model = model;
		this.bubbleEl = bubbleEl || null;
		this.bubbleText = this.bubbleEl?.querySelector('.club-bouncer-line') || null;
		this.reducedMotion = reducedMotion;

		this.group = new Group();
		this.group.name = 'club-bouncer';
		this.group.visible = false;
		this.group.add(model);

		this._dressForTheDoor(model);
		standAtHeight(model, BOUNCER_HEIGHT);

		this.anim = new AnimationManager();
		this.anim.attach(model, { avatarUrl: BOUNCER_AVATAR_URL });
		this.drivable = this.anim.supportsCanonicalClips();
		const defs = (Array.isArray(manifest) ? manifest : []).filter((d) => REACTION_CLIPS.includes(d?.name));
		this.anim.setAnimationDefs([{ name: CLIP_IDLE, url: '/animations/clips/idle.json', loop: true }, ...defs]);
		if (idleClipJson) this.anim.injectClip(CLIP_IDLE, idleClipJson, { loop: true });

		this.headBone = null;
		model.traverse((n) => {
			if (!this.headBone && n.isBone && /(^|[:_])head$/i.test(n.name || '')) this.headBone = n;
		});
		this._headBase = new Quaternion();
		this._headBaseValid = false;
		this._headYaw = 0;
		this._headPitch = 0;

		this.mounted = false;
		this.baseYaw = 0;
		this.position = this.group.position;
		this._state = 'idle'; // idle | checking | admitted | denied
		this._noticed = false;
		this._wasNearDoor = false;
		this._explainIndex = 0;
		this._bubbleTimer = 0;
		this._lastBump = 0;
		this._raycaster = new Raycaster();

		this._onDoorState = (e) => this._react(e?.detail || {});
		window.addEventListener('club:door-state', this._onDoorState);
	}

	// Outfit + shoes go black (the colour multiplies the garment textures), the
	// glasses the rig already wears read as shades. Materials are cloned first so
	// a crowd member sharing this GLB through another loader is never recoloured.
	_dressForTheDoor(model) {
		model.traverse((n) => {
			if (!n.isMesh) return;
			n.castShadow = false;
			n.frustumCulled = false; // skinned bounds lag the pose; he is always near the door anyway
			if (!SUIT_MESH.test(n.name || '')) return;
			const dress = (m) => {
				const c = m.clone();
				c.color.setHex(SUIT_TINT);
				if ('roughness' in c) c.roughness = Math.min(1, (c.roughness ?? 0.8) * 0.9);
				return c;
			};
			n.material = Array.isArray(n.material) ? n.material.map(dress) : dress(n.material);
		});
	}

	/**
	 * Plant him beside the door, on the ground the player actually walks. The
	 * modelled door can sit up a flight of steps with a plinth along the wall, so
	 * rather than trust a fixed offset he walks the line out from the doorway
	 * until he finds a spot that is level with the alley floor and clear of
	 * geometry at shin and chest height. Of the two sides he takes the one that
	 * posts him closer to the door, and the roomier one on a tie.
	 *
	 * @param {object} ctx
	 * @param {import('three').Object3D} ctx.envRoot
	 * @param {{dir:import('three').Vector3, door:import('three').Vector3, spawn:import('three').Vector3}} ctx.path
	 * @param {{size:import('three').Vector3}|null} ctx.doorAnchor
	 */
	async mount({ envRoot, path, doorAnchor }) {
		if (!this.drivable) return false; // never stand a T-pose at the door
		const dir = path.dir;
		const perp = new Vector3(dir.z, 0, -dir.x);
		const doorWidth = doorAnchor
			? Math.abs(dir.z) * doorAnchor.size.x + Math.abs(dir.x) * doorAnchor.size.z
			: 1.5;
		const lateral = Math.max(doorWidth / 2, SIDE_CLEARANCE) + 0.55;
		const searchStart = performance.now();
		const groundY = this._floorAt(envRoot, path.spawn.x, path.spawn.z) ?? 0;

		const posts = [1, -1]
			.map((side) => this._findPost(envRoot, path.door, dir, perp, side * lateral, groundY))
			.filter(Boolean)
			.sort((a, b) => (Math.abs(a.standoff - b.standoff) > 0.25 ? a.standoff - b.standoff : b.room - a.room));
		// No clear, level spot on either side (a door boxed in by props): stand at
		// the wall offset on whatever floor is there rather than not show up.
		const fallback = path.door.clone().addScaledVector(perp, lateral).addScaledVector(dir, WALL_STANDOFF);
		const spot = posts[0] || { p: fallback, floor: this._floorAt(envRoot, fallback.x, fallback.z) ?? groundY };

		log.info('[club-bouncer] posted', posts[0] ? `${posts[0].standoff.toFixed(1)}m off the door` : 'at the wall (no clear level spot)', `in ${Math.round(performance.now() - searchStart)}ms`);

		this.group.position.set(spot.p.x, spot.floor, spot.p.z);
		this.baseYaw = Math.atan2(dir.x, dir.z);
		this.group.rotation.y = this.baseYaw;
		this.scene.add(this.group);

		const playing = await this.anim.play(CLIP_IDLE);
		if (!playing) {
			this.scene.remove(this.group);
			return false;
		}
		this.group.visible = true;
		this.mounted = true;
		return true;
	}

	// Walk out from the wall along one side of the doorway and return the first
	// spot that is level with the alley floor and has room for a body.
	_findPost(envRoot, door, dir, perp, lateral, groundY) {
		for (let standoff = WALL_STANDOFF; standoff <= MAX_STANDOFF; standoff += 0.2) {
			const p = door.clone().addScaledVector(perp, lateral).addScaledVector(dir, standoff);
			const floor = this._floorAt(envRoot, p.x, p.z);
			if (floor == null || Math.abs(floor - groundY) > LEVEL_TOLERANCE) continue;
			if (!this._bodyClear(envRoot, p, floor)) continue;
			return { p, floor, standoff, room: this._openRoom(envRoot, p, perp, Math.sign(lateral)) };
		}
		return null;
	}

	// Nothing solid within a body's width at shin or chest height. The venue's
	// materials are double-sided, so a point inside a solid fails this too.
	_bodyClear(envRoot, p, floor) {
		for (const h of [0.15, 0.95]) {
			for (let i = 0; i < CLEARANCE_RAYS; i++) {
				const a = (i / CLEARANCE_RAYS) * Math.PI * 2;
				this._raycaster.set(_v.set(p.x, floor + h, p.z), _right.set(Math.sin(a), 0, Math.cos(a)));
				this._raycaster.far = BODY_CLEARANCE;
				if (this._raycaster.intersectObject(envRoot, true).length) return false;
			}
		}
		return true;
	}

	_floorAt(envRoot, x, z) {
		this._raycaster.set(_v.set(x, 1.2, z), DOWN);
		this._raycaster.far = 1.6;
		const hit = this._raycaster.intersectObject(envRoot, true)[0];
		return hit ? Math.max(0, hit.point.y) : null;
	}

	// How far he could step sideways before hitting a wall: the roomier side of
	// the door is where a doorman would actually stand.
	_openRoom(envRoot, p, perp, side) {
		this._raycaster.set(_v.set(p.x, 1.0, p.z), perp.clone().multiplyScalar(side));
		this._raycaster.far = 6;
		const hit = this._raycaster.intersectObject(envRoot, true)[0];
		return hit ? hit.distance : 6;
	}

	/** The alley door no longer takes a cover (paid, venue swapped): stand down. */
	unmount() {
		if (!this.mounted) return;
		this.mounted = false;
		this.group.visible = false;
		this.scene.remove(this.group);
		this._hideBubble();
	}

	/**
	 * Per-frame: advance his clip, track the player with head + shoulders, fire
	 * proximity lines, and pin the speech bubble over his head.
	 *
	 * @param {number} dt
	 * @param {import('three').Vector3} playerPos
	 * @param {import('three').Camera} camera
	 * @param {{nearDoor:boolean, interactive:boolean}} ctx
	 */
	update(dt, playerPos, camera, { nearDoor = false, interactive = true } = {}) {
		if (!this.mounted) return;

		// Restore the clip-driven head pose before the mixer ticks, so the look-at
		// offset below never accumulates on a rig whose clip has no head track.
		if (this.headBone && this._headBaseValid) this.headBone.quaternion.copy(this._headBase);
		this.anim.update(dt);

		const dx = playerPos.x - this.group.position.x;
		const dz = playerPos.z - this.group.position.z;
		const dist = Math.hypot(dx, dz);
		this._track(dt, dx, dz, dist);

		if (interactive && this._state === 'idle') {
			if (!this._noticed && dist < NOTICE_RANGE) {
				this._noticed = true;
				this.say(LINES.notice, 4200);
			}
			if (nearDoor && !this._wasNearDoor) this.say(LINES.atDoor, 4200);
		}
		this._wasNearDoor = nearDoor;

		this._pinBubble(camera);
	}

	// Shoulders take part of the turn, the head the rest, both eased and clamped
	// so he reads as a man watching you, not a turret. While he reads the list
	// he looks at the list, not at you.
	_track(dt, dx, dz, dist) {
		const watching = this._state !== 'checking' && dist > 0.2;
		const toPlayer = watching ? wrapAngle(Math.atan2(dx, dz) - this.baseYaw) : 0;
		const ease = this.reducedMotion ? 1 : 1 - Math.exp(-5 * dt);

		const bodyTarget = clamp(toPlayer * BODY_SHARE, -BODY_YAW_LIMIT, BODY_YAW_LIMIT);
		const bodyYaw = wrapAngle(this.group.rotation.y - this.baseYaw);
		this.group.rotation.y = this.baseYaw + bodyYaw + (bodyTarget - bodyYaw) * ease;

		if (!this.headBone) return;
		const bodyNow = wrapAngle(this.group.rotation.y - this.baseYaw);
		const yawTarget = watching ? clamp(wrapAngle(toPlayer - bodyNow), -HEAD_YAW_LIMIT, HEAD_YAW_LIMIT) : 0;
		// He is taller than you, so meeting your eye means looking down a touch.
		const pitchTarget = watching
			? clamp(Math.atan2(BOUNCER_HEIGHT - 1.75, Math.max(dist, 0.6)), 0, HEAD_PITCH_LIMIT)
			: 0;
		this._headYaw += (yawTarget - this._headYaw) * ease;
		this._headPitch += (pitchTarget - this._headPitch) * ease;

		this._headBase.copy(this.headBone.quaternion);
		this._headBaseValid = true;
		if (Math.abs(this._headYaw) < 1e-3 && Math.abs(this._headPitch) < 1e-3) return;

		// Build the offset in world space (yaw about world up, pitch about his
		// right), then carry it into the head's parent space so it composes with
		// whatever the clip posed, on any rig's bone orientation convention.
		const facing = this.group.rotation.y + this._headYaw;
		_right.set(Math.cos(facing), 0, -Math.sin(facing));
		_q.setFromAxisAngle(_right, this._headPitch);
		_q.multiply(_pq.setFromAxisAngle(UP, this._headYaw));
		this.headBone.parent.getWorldQuaternion(_pq);
		_pqInv.copy(_pq).invert();
		this.headBone.quaternion.premultiply(_pq).premultiply(_q).premultiply(_pqInv);
	}

	// ── Cover flow ───────────────────────────────────────────────────────────
	_react({ state, tier, reason }) {
		if (!this.mounted) return;
		switch (state) {
			case 'queue':
				// Re-entering the queue from a failed/cancelled pay lands here too.
				if (this._state !== 'idle') this._settle();
				this.say(LINES.queue, 5200);
				break;
			case 'hidden':
				this._settle();
				this.say(LINES.leftLine, 3600);
				break;
			case 'checking':
				this._state = 'checking';
				this.say(LINES.checking, 0);
				if (this.anim.canPlay(CLIP_CHECKING)) this.anim.crossfadeTo(CLIP_CHECKING, 0.3).catch(() => {});
				break;
			case 'admitted':
				this._state = 'admitted';
				this.say(tier === 'vip' ? LINES.admittedVip : tier === 'regular' ? LINES.admittedRegular : LINES.admittedNew, 0);
				this._playFirst(CLIPS_ADMIT);
				break;
			case 'denied':
				this._state = 'denied';
				this.say(reason ? `${reason} ${LINES.denied}` : LINES.denied, 0);
				this._playFirst(CLIPS_DENY);
				break;
		}
	}

	_settle() {
		this._state = 'idle';
		this.anim.crossfadeTo(CLIP_IDLE, 0.35).catch(() => {});
	}

	_playFirst(names) {
		if (this.reducedMotion) { this.anim.crossfadeTo(CLIP_IDLE, 0.3).catch(() => {}); return; }
		const name = names.find((n) => this.anim.canPlay(n));
		if (name) this.anim.playOnce(name, { settleTo: CLIP_IDLE, fade: 0.25 }).catch(() => {});
		else this.anim.crossfadeTo(CLIP_IDLE, 0.3).catch(() => {});
	}

	// ── Interaction ──────────────────────────────────────────────────────────
	/** True when a pointer ray (already set on `raycaster`) lands on him. */
	hitTest(raycaster) {
		if (!this.mounted) return false;
		return raycaster.intersectObject(this.group, true).length > 0;
	}

	/** Tap-to-talk: the next "how the club works" line. */
	explain() {
		if (!this.mounted || this._state !== 'idle') return;
		this.say(EXPLAINERS[this._explainIndex % EXPLAINERS.length], 6200);
		this._explainIndex++;
	}

	/**
	 * Keep the player out of his body. Mutates `pos` (x/z) and returns true when
	 * it had to push; he says so, at most once every few seconds.
	 */
	resolveCollision(pos, now) {
		if (!this.mounted) return false;
		const dx = pos.x - this.group.position.x;
		const dz = pos.z - this.group.position.z;
		const d = Math.hypot(dx, dz);
		if (d >= BOUNCER_RADIUS) return false;
		const k = d > 1e-4 ? BOUNCER_RADIUS / d : 0;
		pos.x = this.group.position.x + (d > 1e-4 ? dx * k : BOUNCER_RADIUS);
		pos.z = this.group.position.z + dz * k;
		if (this._state === 'idle' && now - this._lastBump > 6000) {
			this._lastBump = now;
			this.say(LINES.bump, 2600);
		}
		return true;
	}

	// ── Speech bubble ────────────────────────────────────────────────────────
	/** Show a line over his head. `ms` of 0 holds it until the next line. */
	say(text, ms = 4000) {
		if (!this.bubbleEl || !this.bubbleText) return;
		if (this._bubbleTimer) { clearTimeout(this._bubbleTimer); this._bubbleTimer = 0; }
		this.bubbleText.textContent = text;
		this.bubbleEl.classList.add('is-visible');
		if (ms > 0) this._bubbleTimer = setTimeout(() => this._hideBubble(), ms);
	}

	/** Drop whatever he is saying (the walk-in is moving on). */
	hush() { this._hideBubble(); }

	_hideBubble() {
		if (this._bubbleTimer) { clearTimeout(this._bubbleTimer); this._bubbleTimer = 0; }
		this.bubbleEl?.classList.remove('is-visible');
	}

	_pinBubble(camera) {
		const el = this.bubbleEl;
		if (!el || !el.classList.contains('is-visible')) return;
		if (this.headBone) this.headBone.getWorldPosition(_head);
		else _head.copy(this.group.position).setY(this.group.position.y + BOUNCER_HEIGHT * 0.93);
		_head.y += 0.34;
		_v.copy(_head).project(camera);
		const behind = _v.z > 1 || _v.z < -1;
		el.classList.toggle('is-offscreen', behind);
		if (behind) return;
		// Keep the bubble on the glass even when he is at the edge of frame.
		const w = window.innerWidth, h = window.innerHeight;
		const half = Math.min(150, w / 2 - 12);
		const x = clamp((_v.x * 0.5 + 0.5) * w, half + 12, w - half - 12);
		const y = clamp((-_v.y * 0.5 + 0.5) * h, 96, h - 24);
		el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`;
	}

	dispose() {
		window.removeEventListener('club:door-state', this._onDoorState);
		this.unmount();
		try { this.anim.dispose?.(); } catch (err) { log.warn('[club-bouncer] anim dispose failed', err); }
		// He is off the scene graph by now, so the entrance's scene-wide dispose
		// never reaches him: release his GPU resources here.
		this.model.traverse((n) => {
			if (!n.isMesh) return;
			n.geometry?.dispose?.();
			for (const m of Array.isArray(n.material) ? n.material : [n.material]) {
				if (!m) continue;
				for (const k in m) { if (m[k]?.isTexture) m[k].dispose(); }
				m.dispose?.();
			}
		});
	}
}

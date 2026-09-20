// /club door line: the queue outside the club.
//
// The alley (src/club-entrance.js) used to be a quiet set with a few avatars
// scattered around it. This module turns it into the outside of a club on a busy
// night: a line of people waiting along the wall beside the door, held back by
// a velvet rope on brass stanchions, talking to each other in speech bubbles,
// with a neon sign over the doorway and a couple of people who started the
// night early: one swaying in the line, one staggering around the alley, one
// slumped against the wall.
//
// Three parts, split so the logic is testable without a GPU:
//
//   planDoorLine()  pure layout. Given the door, the approach axis and three
//                   probes (floor height, wall distance, line of sight) it
//                   returns where everyone stands, where the rope runs and
//                   where the drunk staggers. It reads the real geometry, so it
//                   works in any alley: the line hugs whichever side of the door
//                   has room, and bends down the alley when the wall runs out.
//   QueueChatter    pure conversation director. Deals scripted exchanges to
//                   neighbours in the line, solo mutters to the drunks, and
//                   reactions to what the player does (walking up to the door
//                   past everyone, brushing the line, getting let in).
//   ClubDoorLine    the scene side: probes the environment, builds the rope and
//                   sign, hands the slots to ClubCrowd (src/club-crowd.js) as a
//                   directed lineup, animates the drunks, and pins the DOM
//                   speech bubbles over heads every frame.
//
// The bodies are ordinary crowd members: real platform avatars retargeted onto
// the shared clip library. The clip library has no "drunk" animation, so the
// drunks are procedural: a slowed clip plus a lean about the feet built from
// incommensurate sines, and for the stagger a weaving walk along a short beat.
// Everything here is ambient. Any failure degrades to a quieter alley; the door,
// the cover card and the walk-in never depend on it.

import {
	CanvasTexture,
	CylinderGeometry,
	Group,
	Mesh,
	MeshBasicMaterial,
	MeshStandardMaterial,
	PlaneGeometry,
	QuadraticBezierCurve3,
	Raycaster,
	SphereGeometry,
	SRGBColorSpace,
	TubeGeometry,
	Vector3,
} from 'three';

// ── Layout constants (metres) ────────────────────────────────────────────────
// `along` runs sideways from the door's centre line, `out` runs from the wall
// face into the alley.
const HEAD_GAP = 2.4;   // the head of the line starts this far from the door: clear of the doorman
const STEP = 0.58;      // spacing along the wall; with the zig-zag below, neighbours sit ~0.85 apart
const ROW_NEAR = 0.5;   // wall-side row
const ROW_FAR = 1.1;    // alley-side row
const LEAN_OUT = 0.3;   // a leaner stands with their back on the brick
const ROPE_OUT = 1.72;  // the rope runs outside the far row
const BEND_STEP = 0.8;  // spacing once the line turns down the alley
const EDGE_MARGIN = 0.4; // floor must continue this far past a slot (no standing on a ledge)
const FLOOR_TOLERANCE = 0.3; // the line stays on one level: no slot up the door steps
const POST_SPACING = 1.5;
const POST_HEIGHT = 0.98;

// What people in a line do with their bodies while they wait.
const WAIT_CLIPS = ['av-waiting', 'av-idle-breath', 'av-chilling', 'av-listening-music', 'av-smoking', 'idle'];
const LEAN_CLIPS = ['av-leaning-wall', 'av-chilling', 'idle'];
const SWAY_CLIPS = ['av-listening-music', 'av-idle-breath', 'idle'];
const SLUMP_CLIPS = ['lookdown', 'av-idle-breath', 'idle'];
const STAGGER_CLIPS = ['walk'];
const TALK_GESTURES = ['shrug', 'nod', 'point'];

const SIGN_TEXT = 'POLE CLUB';

// ── Pure layout ──────────────────────────────────────────────────────────────

function lerpAngle(a, b, t) {
	let d = (b - a) % (Math.PI * 2);
	if (d > Math.PI) d -= Math.PI * 2;
	if (d < -Math.PI) d += Math.PI * 2;
	return a + d * t;
}

/**
 * Lay out the door line from real geometry probes.
 *
 * @param {object} o
 * @param {{x:number,z:number}} o.door   the spot just in front of the door
 * @param {{x:number,z:number}} o.dir    unit vector from the door out into the alley
 * @param {number} o.count               total bodies available (device budget)
 * @param {(x:number,z:number)=>number|null} o.floorAt  floor height, null over a void
 * @param {(x:number,z:number,dx:number,dz:number)=>number|null} o.wallDistance
 *        distance to the first surface at chest height along a direction
 * @param {(ax:number,az:number,bx:number,bz:number)=>boolean} o.clearBetween
 *        true when nothing solid sits between two floor points
 * @param {()=>number} [o.rng]
 * @returns {{side:number, wallOut:number, slots:Array<object>, posts:Array<{x:number,y:number,z:number}>, beat:object|null}}
 */
export function planDoorLine({ door, dir, count, floorAt, wallDistance, clearBetween, rng = Math.random }) {
	const perp = { x: dir.z, z: -dir.x };
	const at = (side, along, out) => ({
		x: door.x + perp.x * side * along + dir.x * out,
		z: door.z + perp.z * side * along + dir.z * out,
	});

	// Split the budget: a full night has a stagger and a slump besides the line.
	const total = Math.max(0, Math.floor(count) || 0);
	const wantStagger = total >= 5;
	const wantSlump = total >= 8;
	const lineTarget = total - (wantStagger ? 1 : 0) - (wantSlump ? 1 : 0);

	// Walk each side of the door outward and keep the side that fits more people.
	const sides = [1, -1].map((side) => walkSide(side));
	sides.sort((a, b) => b.line.length - a.line.length);
	const best = sides[0];
	const side = best.side;

	function walkSide(s) {
		// Where is the wall face, measured along `dir` from the door point? The
		// door itself is usually recessed, so probe beside it, not through it.
		const probe = at(s, HEAD_GAP, 1.5);
		const w = wallDistance(probe.x, probe.z, -dir.x, -dir.z);
		const wallOut = w == null || w > 4 ? 0 : 1.5 - w;

		const line = [];
		const head = at(s, HEAD_GAP, wallOut + ROW_NEAR);
		const refFloor = floorAt(head.x, head.z);
		if (refFloor == null) return { side: s, wallOut, line, bendAt: null };

		const standable = (p, prev) => {
			const y = floorAt(p.x, p.z);
			if (y == null || Math.abs(y - refFloor) > FLOOR_TOLERANCE) return null;
			if (prev && !clearBetween(prev.x, prev.z, p.x, p.z)) return null;
			return y;
		};

		// Along the wall, zig-zagging between the two rows so it reads as a crowd
		// two abreast rather than a row of fence posts.
		let prev = null;
		let lastAlong = HEAD_GAP;
		for (let k = 0; line.length < lineTarget; k++) {
			const along = HEAD_GAP + k * STEP;
			const near = k % 2 === 0;
			const p = at(s, along, wallOut + (near ? ROW_NEAR : ROW_FAR));
			const edge = at(s, along + EDGE_MARGIN, wallOut + ROW_FAR);
			const y = standable(p, prev);
			if (y == null || floorAt(edge.x, edge.z) == null) break;
			line.push({ ...p, y, along, near, bent: false });
			prev = p;
			lastAlong = along;
		}

		// Out of wall: the line turns the corner and carries on down the alley.
		let bendAt = null;
		if (line.length && line.length < lineTarget) {
			bendAt = lastAlong;
			for (let j = 1; line.length < lineTarget; j++) {
				const lateral = lastAlong - (j % 2 ? 0 : 0.34);
				const p = at(s, lateral, wallOut + ROW_FAR + j * BEND_STEP);
				const y = standable(p, prev);
				if (y == null) break;
				line.push({ ...p, y, along: lateral, near: false, bent: true });
				prev = p;
			}
		}
		return { side: s, wallOut, line, bendAt };
	}

	const { wallOut, line, bendAt } = best;
	const towardDoor = Math.atan2(-perp.x * side, -perp.z * side);
	const towardWall = Math.atan2(-dir.x, -dir.z);
	const outFromWall = Math.atan2(dir.x, dir.z);

	// Who is the drunk in the line: second from the back, where they hold nobody up.
	const swayIndex = line.length >= 4 ? line.length - 2 : -1;

	const slots = line.map((p, i) => {
		const base = p.bent ? towardWall : towardDoor;
		// Neighbours pair off (0-1, 2-3, ...) and half turn toward each other, the
		// way people do when they are mid-conversation in a queue.
		const partner = line[i % 2 === 0 ? i + 1 : i - 1];
		let yaw = base + (rng() - 0.5) * 0.4;
		if (partner) yaw = lerpAngle(yaw, Math.atan2(partner.x - p.x, partner.z - p.z), 0.42);

		const drunk = i === swayIndex ? 'sway' : null;
		// A few people in the wall row put their back on the brick.
		const lean = !drunk && p.near && !p.bent && i > 0 && i % 4 === 2;
		const spot = lean ? at(side, p.along, wallOut + LEAN_OUT) : p;
		return {
			role: 'line',
			order: i,
			x: spot.x,
			y: p.y,
			z: spot.z,
			yaw: lean ? outFromWall + (rng() - 0.5) * 0.3 : yaw,
			clips: drunk ? SWAY_CLIPS : lean ? LEAN_CLIPS : WAIT_CLIPS,
			timeScale: drunk ? 0.6 : 0.9 + rng() * 0.2,
			drunk,
		};
	});

	// The staggering drunk works a short beat in the open alley on the far side
	// of the door; the slumped one props up the wall over there.
	let beat = null;
	if (wantStagger && slots.length) {
		const a = at(-side, 1.9, wallOut + 2.5);
		let b = null;
		for (const reach of [4.1, 3.4, 2.9]) {
			const c = at(-side, reach, wallOut + 3.4);
			if (floorAt(c.x, c.z) != null && clearBetween(a.x, a.z, c.x, c.z)) { b = c; break; }
		}
		const ya = floorAt(a.x, a.z);
		if (b && ya != null) {
			beat = { a, b };
			slots.splice(Math.min(3, slots.length), 0, {
				role: 'stagger', x: a.x, y: ya, z: a.z,
				yaw: Math.atan2(b.x - a.x, b.z - a.z),
				clips: STAGGER_CLIPS, timeScale: 0.55, drunk: 'stagger',
			});
		}
	}
	if (wantSlump && slots.length) {
		const p = at(-side, 2.5, wallOut + 0.42);
		const y = floorAt(p.x, p.z);
		if (y != null && Math.abs(y - slots[0].y) <= FLOOR_TOLERANCE) {
			slots.push({
				role: 'slump', x: p.x, y, z: p.z,
				yaw: outFromWall + (rng() - 0.5) * 0.5,
				clips: SLUMP_CLIPS, timeScale: 0.5, drunk: 'slump',
			});
		}
	}

	// Rope: outside the far row from the head of the line to its tail, turning
	// the corner with the line when it bends.
	const posts = [];
	if (line.length) {
		const tailAlong = (bendAt ?? line[line.length - 1].along);
		const corners = [[HEAD_GAP - 0.55, wallOut + ROPE_OUT]];
		if (bendAt == null) {
			corners.push([tailAlong + 0.55, wallOut + ROPE_OUT]);
		} else {
			const last = line[line.length - 1];
			const lastOut = (last.x - door.x) * dir.x + (last.z - door.z) * dir.z;
			corners.push([bendAt - 0.85, wallOut + ROPE_OUT]);
			corners.push([bendAt - 0.85, lastOut + 0.5]);
		}
		for (let i = 0; i < corners.length; i++) {
			const [a0, o0] = corners[i];
			if (i === 0) { pushPost(a0, o0); continue; }
			const [ap, op] = corners[i - 1];
			const len = Math.hypot(a0 - ap, o0 - op);
			const n = Math.max(1, Math.ceil(len / POST_SPACING));
			for (let k = 1; k <= n; k++) pushPost(ap + ((a0 - ap) * k) / n, op + ((o0 - op) * k) / n);
		}
	}
	function pushPost(along, out) {
		const p = at(side, along, out);
		const y = floorAt(p.x, p.z);
		if (y != null) posts.push({ x: p.x, y, z: p.z });
	}

	return { side, wallOut, slots, posts, beat };
}

// ── Pure conversation director ───────────────────────────────────────────────

// Two people, next to each other in the line. `a` is nearer the door.
export const EXCHANGES = [
	[['a', 'How long have you been out here?'], ['b', 'Since the last block confirmed.']],
	[['a', 'The cover is one cent. One.'], ['b', 'And you still asked me to spot you.']],
	[['a', 'Is it true a tip puts a dancer on the pole?'], ['b', 'A tenth of a cent. Settles on Solana. I checked.']],
	[['a', 'Who is dancing tonight?'], ['b', 'Whoever gets tipped first. That is the whole point.']],
	[['a', 'I can hear the bass through the wall.'], ['b', 'Wait until that door opens.']],
	[['a', 'Think the bouncer remembers me?'], ['b', 'He reads your wallet. He remembers everything.']],
	[['a', 'I hold $THREE. Does that get me in faster?'], ['b', 'Gets you respect. The line is still the line.']],
	[['a', 'These shoes were a mistake.'], ['b', 'You say that every night.']],
	[['a', 'Save my spot? I need to find a bathroom.'], ['b', 'No.']],
	[['a', 'What even is x402?'], ['b', 'You pay, the door opens. No account, no forms.'], ['a', 'That is it?'], ['b', 'That is it.']],
	[['a', 'Is this the line for the club or the wallet drainer?'], ['b', 'Club. The drainer has a much nicer website.']],
	[['a', 'My pass from last night should still work.'], ['b', 'It lasts the night. It is tomorrow.']],
	[['a', 'I am only staying for one song.'], ['b', 'You said that at the last three poles.']],
	[['a', 'Do they take cash?'], ['b', 'They take USDC. Cash is for the dumpster.']],
	[['a', 'We have moved two steps in twenty minutes.'], ['b', 'Two steps closer than we were.']],
];

// A sober neighbour and the drunk swaying in the line beside them.
export const DRUNK_EXCHANGES = [
	[['sober', 'You good?'], ['drunk', 'Never better. *hic*']],
	[['drunk', 'Is thish the line for tacos?'], ['sober', 'It is the line for the club.'], ['drunk', 'Even better.']],
	[['drunk', 'I love you guys. All of you.'], ['sober', 'We met four minutes ago.']],
	[['sober', 'Maybe get some water first.'], ['drunk', 'Water is jusht beer with no ambition.']],
	[['drunk', 'Hold my shpot. I need to lie down.'], ['sober', 'You are standing in it.']],
];

export const SOLO = {
	sway: ['*hic*', 'I am fine. I am FINE.', 'Who keeps moving the wall?', 'One more song. Jusht one.'],
	stagger: [
		'I tipped a lamp post. No dancer came out.',
		'The ground is shpinning clockwise. Bullish.',
		'Where did I park my wallet?',
		'*hic* ...which way is the door?',
		'I am not lost. The alley is lost.',
	],
	slump: ['Just resting my eyes.', 'Tell the bouncer I am shober.', 'Five more minutes.', 'Zzz...'],
};

export const REACTIONS = {
	// The player walks straight up to the door, past everyone waiting.
	cut: [[['head', 'Hey! There is a line!'], ['second', 'Every night. Somebody with a wallet walks right up.']]],
	// The player drifts into the line itself.
	brush: ['Back of the line is that way.', 'Personal space. Ever heard of it?', 'Easy. We are all waiting here.'],
	staggerBump: ['Whoa. There are two of you.', 'Heyyy. You are my besht friend.', 'Shorry. The floor moved.'],
	admitted: [[['head', 'Unbelievable.'], ['second', 'It was one cent. We could have done that.']]],
};

const BRUSH_RANGE = 1.0;
const STAGGER_BUMP_RANGE = 1.5;
const REACTION_COOLDOWN = 11; // seconds between proximity reactions

export function lineDuration(text) {
	return Math.min(6, Math.max(2.2, 1.4 + text.length * 0.06));
}

// A deck that deals every card before it repeats one.
function makeDeck(items, rng) {
	let pile = [];
	return () => {
		if (!pile.length) {
			pile = items.slice();
			for (let i = pile.length - 1; i > 0; i--) {
				const j = Math.floor(rng() * (i + 1));
				[pile[i], pile[j]] = [pile[j], pile[i]];
			}
		}
		return pile.pop();
	};
}

export class QueueChatter {
	/**
	 * @param {object} o
	 * @param {(member:object, text:string, seconds:number)=>void} o.say
	 * @param {()=>number} [o.rng]
	 */
	constructor({ say, rng = Math.random }) {
		this.say = say;
		this.rng = rng;
		this.members = [];
		this.pending = [];   // [{ at, member, text, dur }] sorted by time
		this.clock = 0;
		this.busyUntil = 0;
		this.nextAmbientAt = 2.5;
		this.nextReactionAt = 0;
		this.cutSeen = false;
		this._decks = {
			exchange: makeDeck(EXCHANGES, rng),
			drunkExchange: makeDeck(DRUNK_EXCHANGES, rng),
			sway: makeDeck(SOLO.sway, rng),
			stagger: makeDeck(SOLO.stagger, rng),
			slump: makeDeck(SOLO.slump, rng),
			brush: makeDeck(REACTIONS.brush, rng),
			staggerBump: makeDeck(REACTIONS.staggerBump, rng),
		};
	}

	/** Register a member as they arrive: `{ role, order, drunk, position }`. */
	add(member) {
		this.members.push(member);
	}

	_line() {
		return this.members.filter((m) => m.role === 'line').sort((a, b) => a.order - b.order);
	}

	// Queue a scripted run of lines, one after another. `cast` maps a script's
	// speaker key to a member. Anything already queued is dropped: the newest
	// thing happening in the alley wins.
	_run(script, cast, startIn = 0) {
		this.pending = [];
		let at = Math.max(this.clock, this.busyUntil) + startIn;
		for (const [who, text] of script) {
			const member = cast[who];
			if (!member) continue;
			const dur = lineDuration(text);
			this.pending.push({ at, member, text, dur });
			at += dur + 0.35;
		}
		this.busyUntil = at;
		this.nextAmbientAt = at + 1.2 + this.rng() * 2.6;
	}

	_interrupt(script, cast) {
		this.busyUntil = this.clock; // talk over whatever was being said
		this._run(script, cast);
	}

	_scheduleAmbient(playerPos) {
		const line = this._line();
		const drunks = this.members.filter((m) => m.drunk && m.role !== 'line');
		const swayer = line.find((m) => m.drunk === 'sway');

		// Adjacent pairs, nearest the player first so the talk happens where they
		// are looking most of the time.
		const pairs = [];
		for (let i = 0; i + 1 < line.length; i++) {
			if (line[i + 1].order === line[i].order + 1) pairs.push([line[i], line[i + 1]]);
		}
		const dist = (m) => (playerPos ? Math.hypot(m.position.x - playerPos.x, m.position.z - playerPos.z) : 0);
		pairs.sort((p, q) => dist(p[0]) - dist(q[0]));

		const roll = this.rng();
		const soloists = swayer ? [...drunks, swayer] : drunks;
		if (soloists.length && (roll < 0.34 || !pairs.length)) {
			const who = soloists[Math.floor(this.rng() * soloists.length)];
			this._run([['solo', this._decks[who.drunk]()]], { solo: who });
			return;
		}
		if (!pairs.length) { this.nextAmbientAt = this.clock + 2; return; }

		const near = pairs.slice(0, Math.max(1, Math.ceil(pairs.length / 2)));
		const pool = this.rng() < 0.65 ? near : pairs;
		const [a, b] = pool[Math.floor(this.rng() * pool.length)];
		if (a.drunk || b.drunk) {
			this._run(this._decks.drunkExchange(), { drunk: a.drunk ? a : b, sober: a.drunk ? b : a });
		} else {
			this._run(this._decks.exchange(), { a, b });
		}
	}

	/**
	 * @param {number} dt
	 * @param {{playerPos?:{x:number,z:number}, nearDoor?:boolean, paid?:boolean}} ctx
	 */
	update(dt, { playerPos = null, nearDoor = false, paid = false } = {}) {
		this.clock += dt;

		if (playerPos && !paid) this._proximity(playerPos, nearDoor);

		while (this.pending.length && this.pending[0].at <= this.clock) {
			const u = this.pending.shift();
			this.say(u.member, u.text, u.dur);
		}
		if (!this.pending.length && this.clock >= this.nextAmbientAt && this.members.length) {
			this._scheduleAmbient(playerPos);
		}
	}

	_proximity(playerPos, nearDoor) {
		const line = this._line();
		if (nearDoor && !this.cutSeen && line.length) {
			this.cutSeen = true;
			this._interrupt(REACTIONS.cut[0], { head: line[0], second: line[1] });
			this.nextReactionAt = this.clock + REACTION_COOLDOWN;
			return;
		}
		if (this.clock < this.nextReactionAt) return;
		const within = (m, r) => Math.hypot(m.position.x - playerPos.x, m.position.z - playerPos.z) < r;
		const stagger = this.members.find((m) => m.role === 'stagger' && within(m, STAGGER_BUMP_RANGE));
		const brushed = stagger ? null : line.find((m) => within(m, BRUSH_RANGE));
		const who = stagger || brushed;
		if (!who) return;
		const text = stagger ? this._decks.staggerBump() : who.drunk ? this._decks.sway() : this._decks.brush();
		this._interrupt([['solo', text]], { solo: who });
		this.nextReactionAt = this.clock + REACTION_COOLDOWN;
	}

	/** The cover settled and the player is being waved through. */
	admitted() {
		const line = this._line();
		if (line.length) this._interrupt(REACTIONS.admitted[0], { head: line[0], second: line[1] });
	}
}

// ── Scene side ───────────────────────────────────────────────────────────────

const MAX_BUBBLES = 3;
const BUBBLE_RANGE = 17; // metres; past this a bubble is too small to read

const _head = new Vector3();
const _a = new Vector3();
const _b = new Vector3();

export class ClubDoorLine {
	/**
	 * @param {object} o
	 * @param {import('three').Scene} o.scene
	 * @param {import('./club-crowd.js').ClubCrowd} o.crowd  used for talk gestures
	 * @param {import('three').Object3D} o.envRoot           the mounted alley, for probes
	 * @param {{door:import('three').Vector3, dir:import('three').Vector3}} o.path
	 * @param {{center:import('three').Vector3, size:import('three').Vector3}|null} o.doorAnchor
	 * @param {number} o.count                               bodies the device can afford
	 * @param {HTMLElement|null} o.bubblesEl                 container for speech bubbles
	 * @param {boolean} [o.reducedMotion]
	 */
	constructor({ scene, crowd, envRoot, path, doorAnchor, count, bubblesEl, reducedMotion = false }) {
		this.scene = scene;
		this.crowd = crowd;
		this.envRoot = envRoot;
		this.bubblesEl = bubblesEl;
		this.reducedMotion = reducedMotion;
		this.members = [];
		this.bubbles = new Map(); // member → { el, until }
		this.time = 0;
		this._ray = new Raycaster();
		this._disposed = false;

		this.plan = planDoorLine({
			door: { x: path.door.x, z: path.door.z },
			dir: { x: path.dir.x, z: path.dir.z },
			count,
			floorAt: (x, z) => this._floorAt(x, z),
			wallDistance: (x, z, dx, dz) => this._cast(x, 1.0, z, dx, dz, 8),
			clearBetween: (ax, az, bx, bz) => {
				const len = Math.hypot(bx - ax, bz - az);
				if (len < 1e-3) return true;
				const hit = this._cast(ax, 0.9, az, (bx - ax) / len, (bz - az) / len, len + 0.3);
				return hit == null;
			},
		});

		this.chatter = new QueueChatter({ say: (m, text, dur) => this._say(m, text, dur) });

		this.props = new Group();
		this.props.name = 'club-door-line';
		if (this.plan.posts.length > 1) this.props.add(buildRope(this.plan.posts));
		const sign = this._buildSign(path, doorAnchor);
		if (sign) this.props.add(sign);
		scene.add(this.props);

		/** Hand this to ClubCrowd.mount() as `lineup`. */
		this.lineup = {
			slots: this.plan.slots,
			onMember: (inst, slot) => this._addMember(inst, slot),
		};
	}

	/** Bodies this line wants from the crowd budget. */
	get count() {
		return this.plan.slots.length;
	}

	_cast(x, y, z, dx, dz, far) {
		this._ray.set(_a.set(x, y, z), _b.set(dx, 0, dz).normalize());
		this._ray.far = far;
		const hit = this._ray.intersectObject(this.envRoot, true)[0];
		return hit ? hit.distance : null;
	}

	// Same floor band the player and the crowd sample: waist height down, so a
	// sculpture top or an awning is never mistaken for the ground.
	_floorAt(x, z) {
		this._ray.set(_a.set(x, 1.2, z), _b.set(0, -1, 0));
		this._ray.far = 1.6;
		const hit = this._ray.intersectObject(this.envRoot, true)[0];
		return hit ? Math.max(0, hit.point.y) : null;
	}

	// A neon sign on the brick over the doorway. Drawn once to a canvas; unlit and
	// not tone mapped, so the bloom pass makes it glow like the door frame below.
	_buildSign(path, doorAnchor) {
		if (typeof document === 'undefined') return null;
		const dir = path.dir;
		const topY = doorAnchor ? doorAnchor.center.y + doorAnchor.size.y / 2 : 2.7;
		const y = topY + 0.62;
		// Find the wall face above the door: cast back at the building from out in
		// the alley, at sign height.
		const from = _head.copy(path.door).addScaledVector(dir, 3);
		const d = this._cast(from.x, y, from.z, -dir.x, -dir.z, 8);
		if (d == null) return null; // nothing to hang it on

		const cv = document.createElement('canvas');
		cv.width = 1024;
		cv.height = 256;
		const ctx = cv.getContext('2d');
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.font = "italic 800 150px 'Inter', system-ui, sans-serif";
		ctx.lineJoin = 'round';
		// Three passes: a wide soft halo, the coloured tube, a hot white core.
		ctx.shadowColor = '#ff3bd6';
		ctx.shadowBlur = 46;
		ctx.strokeStyle = '#ff3bd6';
		ctx.lineWidth = 14;
		ctx.strokeText(SIGN_TEXT, 512, 132);
		ctx.shadowBlur = 16;
		ctx.lineWidth = 7;
		ctx.strokeStyle = '#ff8ae6';
		ctx.strokeText(SIGN_TEXT, 512, 132);
		ctx.shadowBlur = 0;
		ctx.lineWidth = 2.5;
		ctx.strokeStyle = '#fff4fd';
		ctx.strokeText(SIGN_TEXT, 512, 132);

		const map = new CanvasTexture(cv);
		map.colorSpace = SRGBColorSpace;
		const mat = new MeshBasicMaterial({ map, transparent: true, toneMapped: false, depthWrite: false });
		const mesh = new Mesh(new PlaneGeometry(2.9, 0.725), mat);
		mesh.position.copy(from).addScaledVector(dir, -(d - 0.07)).setY(y);
		mesh.rotation.y = Math.atan2(dir.x, dir.z);
		mesh.name = 'club-sign';
		this._signMat = mat;
		return mesh;
	}

	_addMember(inst, slot) {
		if (this._disposed) return;
		const member = {
			inst,
			role: slot.role,
			order: slot.order ?? -1,
			drunk: slot.drunk,
			position: inst.group.position, // live: the stagger moves
			baseYaw: slot.yaw,
			phase: Math.random() * Math.PI * 2,
			floorY: slot.y,
			floorTimer: 0,
			// stagger state
			u: 0,
			heading: 1,
			pause: 0,
			walking: true,
		};
		inst.group.rotation.order = 'YXZ'; // yaw first, then lean about the feet
		this.members.push(member);
		this.chatter.add(member);
	}

	_say(member, text, seconds) {
		if (!this.bubblesEl || this._disposed) return;
		let b = this.bubbles.get(member);
		if (!b) {
			if (this.bubbles.size >= MAX_BUBBLES) return; // the alley is loud enough
			const el = document.createElement('div');
			el.className = 'club-bubble';
			if (member.drunk) el.classList.add('is-drunk');
			const body = document.createElement('span');
			body.className = 'club-bubble-body';
			el.appendChild(body);
			this.bubblesEl.appendChild(el);
			b = { el, body, until: 0, lift: 0 };
			this.bubbles.set(member, b);
		}
		b.body.textContent = text;
		b.until = this.time + seconds;
		// Next frame, so the entry transition runs from the hidden state.
		requestAnimationFrame(() => b.el.classList.add('is-visible'));
		if (!member.drunk && !this.reducedMotion) this.crowd.gesture(member.inst, TALK_GESTURES);
	}

	/**
	 * Per frame: run the conversation, move the drunks, pin the bubbles.
	 *
	 * @param {number} dt
	 * @param {import('three').Vector3} playerPos
	 * @param {import('three').Camera} camera
	 * @param {{nearDoor?:boolean, paid?:boolean}} ctx
	 */
	update(dt, playerPos, camera, { nearDoor = false, paid = false } = {}) {
		if (this._disposed) return;
		this.time += dt;
		this.chatter.update(dt, { playerPos, nearDoor, paid });
		if (!this.reducedMotion) for (const m of this.members) this._moveDrunk(m, dt);
		this._pinBubbles(camera);
	}

	/** The cover settled: the line watches the player get waved through. */
	admitted() {
		this.chatter.admitted();
	}

	// Procedural drunkenness. The lean is a sum of sines whose periods never line
	// up, so it never reads as a loop; it pivots at the feet because the group
	// origin is the floor point.
	_moveDrunk(m, dt) {
		if (!m.drunk) return;
		const t = this.time + m.phase;
		const g = m.inst.group;
		if (m.drunk === 'sway' || m.drunk === 'slump') {
			const amp = m.drunk === 'sway' ? 1 : 0.55;
			g.rotation.z = (Math.sin(t * 0.83) * 0.07 + Math.sin(t * 0.31) * 0.035) * amp;
			g.rotation.x = (Math.sin(t * 0.57 + 1.3) * 0.045 + 0.02) * amp;
			g.rotation.y = m.baseYaw + Math.sin(t * 0.23) * 0.12 * amp;
			return;
		}
		const beat = this.plan.beat;
		if (m.drunk !== 'stagger' || !beat) return;

		if (m.pause > 0) {
			// Stopped at the end of the beat, swaying on the spot and finding the
			// way back round.
			m.pause -= dt;
			g.rotation.z = Math.sin(t * 0.9) * 0.09;
			g.rotation.x = 0.04 + Math.sin(t * 0.6) * 0.05;
			const back = Math.atan2((beat.b.x - beat.a.x) * m.heading, (beat.b.z - beat.a.z) * m.heading);
			g.rotation.y = lerpAngle(g.rotation.y, back, 1 - Math.exp(-1.4 * dt));
			if (m.pause <= 0) this._setStaggerClip(m, true);
			return;
		}

		const len = Math.hypot(beat.b.x - beat.a.x, beat.b.z - beat.a.z) || 1;
		// Lurching pace: never steady, sometimes nearly stopping.
		const speed = Math.max(0.08, 0.42 + Math.sin(t * 0.9) * 0.24 + Math.sin(t * 2.3) * 0.08);
		m.u += (m.heading * speed * dt) / len;
		if (m.u >= 1 || m.u <= 0) {
			m.u = Math.min(1, Math.max(0, m.u));
			m.heading *= -1;
			m.pause = 1.6 + Math.random() * 2.2;
			this._setStaggerClip(m, false);
		}
		const fx = (beat.b.x - beat.a.x) / len, fz = (beat.b.z - beat.a.z) / len;
		const weave = Math.sin(t * 1.15) * 0.3 + Math.sin(t * 0.47) * 0.16;
		const weaveRate = Math.cos(t * 1.15) * 0.345 + Math.cos(t * 0.47) * 0.075;
		const x = beat.a.x + (beat.b.x - beat.a.x) * m.u + fz * weave;
		const z = beat.a.z + (beat.b.z - beat.a.z) * m.u - fx * weave;

		// Step up and down kerbs like everyone else: resample the floor a few
		// times a second and ease onto it.
		m.floorTimer -= dt;
		if (m.floorTimer <= 0) {
			m.floorTimer = 0.16;
			const y = this._floorAt(x, z);
			if (y != null) m.floorY = y;
		}
		g.position.set(x, g.position.y + (m.floorY - g.position.y) * (1 - Math.exp(-10 * dt)), z);

		// Body follows the weave: heading swings with the sideways drift and the
		// torso leans into it, always a little too far forward.
		const travel = Math.atan2(fx * m.heading, fz * m.heading);
		const yawTarget = travel + Math.atan2(weaveRate, speed) * 0.6 * m.heading;
		g.rotation.y = lerpAngle(g.rotation.y, yawTarget, 1 - Math.exp(-5 * dt));
		g.rotation.z = -weaveRate * 0.32 + Math.sin(t * 2.1) * 0.03;
		g.rotation.x = 0.07 + Math.sin(t * 1.3) * 0.04;
		if (m.inst.base) m.inst.base.timeScale = 0.35 + speed * 0.75;
	}

	// Crossfade the stagger between its slowed walk and a standing sway.
	_setStaggerClip(m, walking) {
		const { inst } = m;
		if (!inst.mixer || !inst.base || m.walking === walking) return;
		m.walking = walking;
		const restClip = inst.clips.get('av-idle-breath') || inst.clips.get('idle');
		if (!restClip) return;
		const rest = inst.mixer.clipAction(restClip);
		const [from, to] = walking ? [rest, inst.base] : [inst.base, rest];
		to.reset();
		to.timeScale = walking ? 0.6 : 0.55;
		to.play();
		from.crossFadeTo(to, 0.45, false);
	}

	_pinBubbles(camera) {
		if (!this.bubbles.size) return;
		const w = window.innerWidth, h = window.innerHeight;
		const placed = [];
		for (const [member, b] of this.bubbles) {
			if (this.time >= b.until) {
				if (b.el.classList.contains('is-visible')) {
					b.el.classList.remove('is-visible');
					b.removeAt = this.time + 0.3; // let the exit transition finish
				} else if (this.time >= (b.removeAt || 0)) {
					b.el.remove();
					this.bubbles.delete(member);
				}
			}
			const g = member.inst.group;
			const headUp = member.inst.height * (member.drunk === 'slump' ? 0.98 : 1.06) + 0.12;
			_head.set(g.position.x, g.position.y + headUp, g.position.z);
			const dist = _head.distanceTo(camera.position);
			_head.project(camera);
			const hidden = _head.z > 1 || _head.z < -1 || dist > BUBBLE_RANGE;
			b.el.classList.toggle('is-offscreen', hidden);
			if (hidden) continue;

			const bw = b.el.offsetWidth || 160;
			let x = (_head.x * 0.5 + 0.5) * w;
			let y = (-_head.y * 0.5 + 0.5) * h;
			// Keep the whole bubble on screen, and lift it over a neighbour's so
			// two people talking at once never print on top of each other.
			x = Math.min(w - bw / 2 - 10, Math.max(bw / 2 + 10, x));
			for (const p of placed) {
				if (Math.abs(p.x - x) < (p.w + bw) / 2 && Math.abs(p.y - y) < p.h + 6) y = p.y - p.h - 8;
			}
			y = Math.max((b.el.offsetHeight || 40) + 10, y);
			placed.push({ x, y, w: bw, h: b.el.offsetHeight || 40 });
			const scale = Math.min(1, Math.max(0.74, 5.2 / dist));
			b.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%) scale(${scale.toFixed(3)})`;
		}
	}

	/** Fade the speech layer with the scene canvas as the alley dissolves. */
	setOpacity(k) {
		if (this.bubblesEl) this.bubblesEl.style.opacity = String(k);
	}

	dispose() {
		if (this._disposed) return;
		this._disposed = true;
		for (const b of this.bubbles.values()) b.el.remove();
		this.bubbles.clear();
		if (this.bubblesEl) this.bubblesEl.style.opacity = '';
		this.scene.remove(this.props);
		this.props.traverse((n) => {
			if (!n.isMesh) return;
			n.geometry?.dispose?.();
			n.material?.map?.dispose?.();
			n.material?.dispose?.();
		});
		this.members = [];
	}
}

// Brass stanchions joined by a sagging velvet rope. Two shared materials and a
// handful of small meshes: the whole run costs less than one crowd member.
function buildRope(posts) {
	const group = new Group();
	group.name = 'club-rope';
	const brass = new MeshStandardMaterial({ color: 0xd4a94e, metalness: 0.95, roughness: 0.28 });
	const velvet = new MeshStandardMaterial({ color: 0x9b0f33, roughness: 0.85, metalness: 0, emissive: 0x3a0512, emissiveIntensity: 0.6 });
	const pole = new CylinderGeometry(0.028, 0.028, POST_HEIGHT, 12);
	const foot = new CylinderGeometry(0.17, 0.19, 0.04, 20);
	const cap = new SphereGeometry(0.055, 14, 10);

	for (const p of posts) {
		const post = new Group();
		const shaft = new Mesh(pole, brass);
		shaft.position.y = POST_HEIGHT / 2;
		const base = new Mesh(foot, brass);
		base.position.y = 0.02;
		const top = new Mesh(cap, brass);
		top.position.y = POST_HEIGHT + 0.03;
		post.add(shaft, base, top);
		post.position.set(p.x, p.y, p.z);
		group.add(post);
	}
	for (let i = 0; i + 1 < posts.length; i++) {
		const a = posts[i], b = posts[i + 1];
		const hookA = new Vector3(a.x, a.y + POST_HEIGHT - 0.06, a.z);
		const hookB = new Vector3(b.x, b.y + POST_HEIGHT - 0.06, b.z);
		const mid = hookA.clone().add(hookB).multiplyScalar(0.5);
		mid.y -= 0.34; // the control point sits below the sag it produces
		const curve = new QuadraticBezierCurve3(hookA, mid, hookB);
		group.add(new Mesh(new TubeGeometry(curve, 14, 0.022, 8, false), velvet));
	}
	return group;
}

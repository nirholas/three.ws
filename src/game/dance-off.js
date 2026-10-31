// Dance-off rounds on the synced dance floor: the client side.
//
// The server (multiplayer/src/dance-off.js + dance-off-room.js) owns every phase,
// the vote tally and the reward. This module only renders what it is told:
//
//   - a HUD panel with the phase, a countdown that is derived from the server's
//     clock, and a chip per contestant (tap one to aim your votes at them)
//   - a floor ring under every contestant, a pulsing call-to-action ring on the
//     pad while the round is open, and a spotlight beam plus confetti for the winner
//   - the jumbotron winner card (name, votes, avatar snapshot) via paintScreen()
//   - the dance-tip confirmation card (recipient and amount, explicit confirm)
//
// Nothing here decides who won or whether a vote counted: the reaction bar sends
// a `target`, the server answers with an ack, and the HUD shows what it said.
//
// Wiring into the world is five one-line hooks in coincommunities.js (create,
// message, per-frame tick, beat/emote filters, jumbotron paint, dispose).

import {
	Group, Mesh, RingGeometry, CylinderGeometry, MeshBasicMaterial, DoubleSide, AdditiveBlending,
	PerspectiveCamera, WebGLRenderTarget, Vector3,
} from 'three';
import { ensureX402 } from '../shared/x402-loader.js';

const TIP_ENDPOINT = '/api/x402/dance-tip';
const TIP_ROUTINES = [
	['hiphop', 'Hip Hop'], ['rumba', 'Rumba'], ['thriller', 'Thriller'],
	['capoeira', 'Capoeira'], ['silly', 'Silly'],
];
const GOLD = 0xffce5c;
const CONFETTI_EVERY_MS = 650;
const CONFETTI_FOR_MS = 6000;
const SNAP_SIZE = 384;

const reducedMotion = () => {
	try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
};

function el(tag, props = {}, kids = []) {
	const n = document.createElement(tag);
	for (const [k, v] of Object.entries(props)) {
		if (k === 'class') n.className = v;
		else if (k === 'text') n.textContent = v;
		else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
		else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v === true ? '' : v);
	}
	for (const kid of [].concat(kids)) {
		if (kid != null && kid !== false) n.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
	}
	return n;
}

const mmss = (ms) => {
	const s = Math.max(0, Math.ceil(ms / 1000));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const shortAddr = (a) => (a && a.length > 14 ? `${a.slice(0, 6)}...${a.slice(-6)}` : a || '');

// Linear 0..255 to sRGB 0..255. A render target holds linear light; the screen
// would have encoded it on the way out, so the snapshot does it by hand.
const toSrgb = (u8) => {
	const c = u8 / 255;
	const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
	return Math.max(0, Math.min(255, Math.round(s * 255)));
};

const STYLE = `
#dof-hud {
	position: fixed; top: 12px; left: 50%; transform: translateX(-50%);
	z-index: 41; width: 276px; max-width: calc(100vw - 24px);
	background: var(--cc-panel, rgba(12,12,14,.92)); color: var(--cc-text, #f5f5f6);
	border: 1px solid var(--cc-edge, rgba(255,255,255,.12)); border-radius: var(--cc-radius, 4px);
	box-shadow: var(--cc-shadow, 0 12px 40px rgba(0,0,0,.6));
	backdrop-filter: blur(8px); padding: 10px 12px 11px; text-align: center;
	opacity: 0; transform: translate(-50%, -8px); pointer-events: none;
	transition: opacity .22s ease, transform .22s ease;
}
#dof-hud.dof-on { opacity: 1; transform: translate(-50%, 0); pointer-events: auto; }
body:has(#cc-king-hud) #dof-hud { top: 168px; }
.dof-head {
	display: flex; align-items: center; justify-content: center; gap: 7px;
	font-size: 10.5px; font-weight: 800; letter-spacing: .13em; text-transform: uppercase; color: #ffce5c;
}
.dof-live {
	font-size: 9px; letter-spacing: .1em; padding: 1px 5px; border-radius: 2px;
	background: #ffce5c; color: #120d00;
}
.dof-clock { margin: 4px 0 1px; font-size: 26px; font-weight: 800; font-variant-numeric: tabular-nums; letter-spacing: -.01em; }
.dof-clock.dof-low { color: #ff6b6b; animation: dof-low 1s ease-in-out infinite; }
@keyframes dof-low { 50% { opacity: .45; } }
.dof-phase { font-size: 12px; line-height: 1.35; color: var(--cc-dim, #b4b4ba); margin: 0 0 7px; }
.dof-list { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; text-align: left; }
.dof-chip {
	all: unset; box-sizing: border-box; width: 100%; cursor: pointer;
	display: grid; grid-template-columns: 18px 1fr auto; align-items: center; gap: 7px;
	padding: 6px 8px; border-radius: 3px; font-size: 12.5px;
	background: rgba(255,255,255,.04); border: 1px solid transparent;
	transition: background .15s ease, border-color .15s ease, transform .1s ease;
}
.dof-chip:hover { background: rgba(255,255,255,.09); }
.dof-chip:active { transform: scale(.985); }
.dof-chip:focus-visible { outline: 2px solid var(--cc-edge-hi, #fff); outline-offset: 1px; }
.dof-chip[aria-pressed="true"], .dof-chip.dof-aim { border-color: #ffce5c; background: rgba(255,206,92,.1); }
.dof-chip.dof-me .dof-name::after { content: ' (you)'; color: var(--cc-faint, #8c8c92); }
.dof-chip.dof-voted .dof-rank { color: #ffce5c; }
.dof-chip.dof-win { border-color: #ffce5c; background: rgba(255,206,92,.16); }
.dof-rank { font-variant-numeric: tabular-nums; color: var(--cc-faint, #8c8c92); text-align: center; }
.dof-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dof-votes { font-variant-numeric: tabular-nums; font-weight: 700; }
.dof-hint { margin: 7px 0 0; font-size: 11px; color: var(--cc-faint, #8c8c92); }
.dof-actions { display: flex; gap: 6px; margin-top: 8px; }
.dof-btn {
	all: unset; box-sizing: border-box; flex: 1; text-align: center; cursor: pointer;
	padding: 8px 10px; border-radius: 3px; font-size: 12.5px; font-weight: 700;
	background: rgba(255,255,255,.08); border: 1px solid var(--cc-edge, rgba(255,255,255,.12));
	transition: background .15s ease, transform .1s ease, border-color .15s ease;
}
.dof-btn:hover { background: rgba(255,255,255,.16); border-color: var(--cc-edge-hi, rgba(255,255,255,.55)); }
.dof-btn:active { transform: scale(.98); }
.dof-btn:focus-visible { outline: 2px solid var(--cc-edge-hi, #fff); outline-offset: 2px; }
.dof-btn[disabled] { opacity: .5; cursor: default; }
.dof-btn.dof-primary { background: #ffce5c; color: #120d00; border-color: #ffce5c; }
.dof-btn.dof-primary:hover { background: #ffdb85; }
.dof-champ { display: grid; grid-template-columns: 84px 1fr; gap: 10px; text-align: left; align-items: center; margin: 4px 0 2px; }
.dof-snap {
	width: 84px; height: 84px; border-radius: 3px; border: 2px solid #ffce5c; background: #1a1408;
	box-shadow: 0 0 18px rgba(255,206,92,.35); display: block;
}
.dof-champ-name { font-size: 17px; font-weight: 800; line-height: 1.15; overflow-wrap: anywhere; }
.dof-champ-sub { font-size: 11.5px; color: var(--cc-dim, #b4b4ba); margin-top: 3px; }
.dof-reward { font-size: 11.5px; color: #ffce5c; margin-top: 5px; }
.dof-announce { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }

.dof-tip-overlay {
	position: fixed; inset: 0; z-index: 90; display: grid; place-items: center; padding: 16px;
	background: rgba(0,0,0,.62); backdrop-filter: blur(3px); opacity: 0; transition: opacity .2s ease;
}
.dof-tip-overlay.dof-on { opacity: 1; }
.dof-tip {
	width: min(420px, 100%); background: var(--cc-panel-solid, #0c0c0c); color: var(--cc-text, #f5f5f6);
	border: 1px solid var(--cc-edge-hi, rgba(255,255,255,.55)); border-radius: var(--cc-radius, 4px);
	box-shadow: 0 18px 60px rgba(0,0,0,.75); padding: 18px;
	transform: translateY(10px); transition: transform .2s ease;
}
.dof-tip-overlay.dof-on .dof-tip { transform: none; }
.dof-tip h2 { margin: 0 0 4px; font-size: 17px; }
.dof-tip p { margin: 0 0 12px; font-size: 12.5px; color: var(--cc-dim, #b4b4ba); line-height: 1.45; }
.dof-tip dl { margin: 0 0 12px; display: grid; grid-template-columns: auto 1fr; gap: 7px 14px; font-size: 13px; }
.dof-tip dt { color: var(--cc-faint, #8c8c92); }
.dof-tip dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.dof-tip dd code { font-size: 12px; }
.dof-tip dd.dof-amt { font-weight: 800; font-size: 15px; }
.dof-tip label { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 13px; margin-bottom: 12px; }
.dof-tip select {
	background: #15151a; color: inherit; border: 1px solid var(--cc-edge, rgba(255,255,255,.12));
	border-radius: 3px; padding: 6px 8px; font: inherit;
}
.dof-tip select:focus-visible { outline: 2px solid var(--cc-edge-hi, #fff); outline-offset: 1px; }
.dof-skel { height: 15px; border-radius: 3px; background: linear-gradient(90deg, rgba(255,255,255,.05), rgba(255,255,255,.14), rgba(255,255,255,.05)); background-size: 200% 100%; animation: dof-sh 1.1s linear infinite; }
@keyframes dof-sh { to { background-position: -200% 0; } }
.dof-err { color: #ff8a8a; font-size: 12.5px; margin: 0 0 12px; }
.dof-ok { color: #8ef0b0; font-size: 12.5px; margin: 0 0 12px; }
@media (prefers-reduced-motion: reduce) {
	#dof-hud, .dof-tip-overlay, .dof-tip, .dof-chip, .dof-btn { transition: none; }
	.dof-clock.dof-low, .dof-skel { animation: none; }
}
`;

export class DanceOffClient {
	/**
	 * @param {object} host the world, injected so this file owns no scene state
	 * @param {Group} host.world             where the floor decorations live
	 * @param {object} host.scene            for the avatar snapshot render
	 * @param {object} host.renderer         for the avatar snapshot render
	 * @param {{x:number,z:number,r:number}} host.floor
	 * @param {() => string} host.localId
	 * @param {() => boolean} host.isOnFloor
	 * @param {(id:string) => ({pos:Vector3,height:number,rig:object}|null)} host.playerInfo
	 * @param {(pos:Vector3,height:number) => ({nx:number,ny:number,visible:boolean}|null)} host.project
	 * @param {(pos:Vector3,height:number) => void} host.confetti
	 * @param {() => void} host.sendStart
	 * @param {(msg:string,kind?:string) => void} host.toast
	 * @param {() => void} host.redrawScreen  repaint the jumbotron (it calls paintScreen)
	 * @param {(hidden:boolean) => void} host.hideScreenArt
	 */
	constructor(host) {
		this.host = host;
		this.snap = null;
		this.skew = 0;
		this.pinned = '';
		this.myVote = '';
		this.chosenClip = '';
		this.notice = '';
		this.noticeUntil = 0;
		this.reward = null;
		this.winnerAt = 0;
		this.lastConfettiAt = 0;
		this.snapshot = null;
		this.rings = new Map();
		this.t = 0;
		this._lastClock = '';
		this._tip = null;

		this._buildStyle();
		this._buildHud();
		this._buildFloorFx();
	}

	// ----------------------------------------------------------------- queries

	/** Is the local player one of this round's dancers right now? */
	isContestant() {
		const s = this.snap;
		return !!s && s.phase === 'performing' && s.contestants.some((c) => c.id === this.host.localId());
	}

	/** The clip a contestant dances on a floor beat: their own pick, else the beat's. */
	clipFor(beatClip) {
		return this.isContestant() && this.chosenClip ? this.chosenClip : beatClip;
	}

	/** The emote wheel chose a clip. Remembered so the next beat keeps it. */
	noteEmote(name) {
		if (this.isContestant()) this.chosenClip = String(name || '');
	}

	/**
	 * Who the reaction bar votes for: the contestant pinned in the HUD, else the one
	 * nearest the centre of the screen. null when no round is performing or there is
	 * nobody to aim at (a plain reaction, confetti only).
	 */
	aim() {
		const s = this.snap;
		if (!s || s.phase !== 'performing') return null;
		const me = this.host.localId();
		const others = s.contestants.filter((c) => c.id !== me);
		if (!others.length) return null;
		if (this.pinned && others.some((c) => c.id === this.pinned)) return this.pinned;
		let best = null;
		let bestD = Infinity;
		for (const c of others) {
			const info = this.host.playerInfo(c.id);
			const p = info && this.host.project(info.pos, info.height);
			if (!p || !p.visible) continue;
			const d = Math.hypot(p.nx, p.ny);
			if (d < bestD) { bestD = d; best = c.id; }
		}
		return best || others[0].id;
	}

	// ----------------------------------------------------------------- network

	handle(msg) {
		if (!msg) return;
		if (msg.kind === 'state') this._onState(msg);
		else if (msg.kind === 'ack') this._onAck(msg);
		else if (msg.kind === 'reward') this._onReward(msg);
	}

	_onState(s) {
		const prev = this.snap;
		this.snap = s;
		this.skew = (s.now || Date.now()) - Date.now();
		if (!prev || prev.roundId !== s.roundId) {
			this.pinned = '';
			this.myVote = '';
			this.chosenClip = '';
			this.reward = null;
		}
		if (s.event === 'start') { this.pinned = ''; this.myVote = ''; this.chosenClip = ''; }
		if (s.phase === 'winner' && (!prev || prev.phase !== 'winner' || s.event === 'winner')) this._beginWinner(s);
		if (prev && prev.phase === 'winner' && s.phase !== 'winner') this._endWinner();
		if (s.phase === 'idle' && s.notice && (s.event === 'dissolve' || s.event === 'idle')) {
			this.notice = s.notice;
			this.noticeUntil = Date.now() + 9000;
		}
		if (s.phase === 'performing' && this.isContestant() && s.event === 'start') {
			this.host.toast('You are in the dance-off. Pick a move from the emote wheel to show off.', 'info');
		}
		this._render();
	}

	_onAck(a) {
		if (a.start === false) {
			const why = {
				'need-two': 'A dance-off needs two dancers on the floor.',
				'too-soon': 'The floor needs a minute to cool down before the next round.',
				busy: 'A dance-off is already on.',
				'not-on-floor': 'Step onto the dance floor to start a dance-off.',
			}[a.reason] || 'Could not start a dance-off right now.';
			this.host.toast(why, 'warn');
			return;
		}
		if (a.counted) {
			this.myVote = a.target;
			const name = this.snap?.contestants.find((c) => c.id === a.target)?.name || 'that dancer';
			this.host.toast(`Vote counted for ${name}.`, 'success');
		} else if (a.reason === 'self') {
			this.host.toast('You cannot vote for yourself.', 'warn');
		} else if (a.reason === 'already-voted') {
			if (!this._toldVoted) this.host.toast('Your vote is locked in. More reactions are just confetti.', 'info');
			this._toldVoted = true;
		}
		this._render();
	}

	_onReward(r) {
		this.reward = r;
		this._render();
	}

	// ------------------------------------------------------------------ winner

	_beginWinner(s) {
		this.winnerAt = performance.now();
		this.lastConfettiAt = 0;
		this.snapshot = this._capture(s.winner?.id);
		this.host.hideScreenArt(true);
		this.host.redrawScreen();
		this._beam.visible = true;
	}

	_endWinner() {
		this.snapshot = null;
		this.winnerAt = 0;
		this._beam.visible = false;
		this.host.hideScreenArt(false);
		this.host.redrawScreen();
	}

	/**
	 * Paint the winner card over the jumbotron canvas. Called at the end of the
	 * host's _drawScreen with its 2D context; returns true when it took over.
	 */
	paintScreen(x) {
		const s = this.snap;
		const w = s?.phase === 'winner' ? s.winner : null;
		if (!w) return false;
		const g = x.createLinearGradient(0, 0, 0, 900);
		g.addColorStop(0, '#2a1d04'); g.addColorStop(1, '#0a0700');
		x.fillStyle = g; x.fillRect(0, 0, 1600, 900);
		x.strokeStyle = '#ffce5c'; x.lineWidth = 6; x.strokeRect(14, 14, 1572, 872);

		x.textAlign = 'left'; x.textBaseline = 'alphabetic';
		x.fillStyle = '#ffce5c';
		x.font = '800 54px Inter, system-ui, sans-serif';
		x.fillText('DANCE-OFF CHAMPION', 96, 140);

		const fx = 96, fy = 210, fs = 600;
		x.fillStyle = '#1a1408'; x.fillRect(fx, fy, fs, fs);
		if (this.snapshot) {
			x.drawImage(this.snapshot, fx, fy, fs, fs);
		} else {
			x.fillStyle = '#ffce5c';
			x.beginPath(); x.arc(fx + fs / 2, fy + fs / 2, 220, 0, Math.PI * 2); x.fill();
			x.fillStyle = '#120d00'; x.textAlign = 'center'; x.textBaseline = 'middle';
			x.font = '800 260px Inter, system-ui, sans-serif';
			x.fillText((w.name || '?').trim().charAt(0).toUpperCase() || '?', fx + fs / 2, fy + fs / 2 + 10);
			x.textAlign = 'left'; x.textBaseline = 'alphabetic';
		}
		x.strokeStyle = '#ffce5c'; x.lineWidth = 8; x.strokeRect(fx, fy, fs, fs);

		const colX = 770;
		const name = (w.name || 'A dancer').toUpperCase();
		let size = 120;
		x.fillStyle = '#fff6df';
		do { x.font = `800 ${size}px Inter, system-ui, sans-serif`; size -= 4; }
		while (x.measureText(name).width > 740 && size > 44);
		x.fillText(name, colX, 330);

		x.fillStyle = '#ffce5c';
		x.font = '800 96px Inter, system-ui, sans-serif';
		x.fillText(w.votes === 1 ? '1 VOTE' : `${w.votes} VOTES`, colX, 470);

		x.fillStyle = '#c9b58a';
		x.font = '600 44px Inter, system-ui, sans-serif';
		const field = s.standings.length;
		x.fillText(`Won the floor against ${field - 1} ${field - 1 === 1 ? 'dancer' : 'dancers'}`, colX, 560);
		x.fillText('Champion Spotlight unlocked', colX, 630);
		return true;
	}

	/** Render the winner's avatar into a small canvas. null when it cannot be done. */
	_capture(id) {
		try {
			const { renderer, scene } = this.host;
			const info = id && this.host.playerInfo(id);
			if (!renderer || !scene || !info?.rig) return null;
			const h = info.height || 1.7;
			const yaw = info.rig.rotation?.y || 0;
			const cam = new PerspectiveCamera(30, 1, 0.1, 120);
			const dist = Math.max(2.6, h * 2.1);
			cam.position.set(info.pos.x + Math.sin(yaw) * dist, info.pos.y + h * 0.62, info.pos.z + Math.cos(yaw) * dist);
			cam.lookAt(new Vector3(info.pos.x, info.pos.y + h * 0.58, info.pos.z));

			const rt = new WebGLRenderTarget(SNAP_SIZE, SNAP_SIZE);
			const prevTarget = renderer.getRenderTarget();
			const wasVisible = this._fx.visible;
			this._fx.visible = false;
			let px;
			try {
				renderer.setRenderTarget(rt);
				renderer.clear();
				renderer.render(scene, cam);
				px = new Uint8Array(SNAP_SIZE * SNAP_SIZE * 4);
				renderer.readRenderTargetPixels(rt, 0, 0, SNAP_SIZE, SNAP_SIZE, px);
			} finally {
				renderer.setRenderTarget(prevTarget);
				this._fx.visible = wasVisible;
				rt.dispose();
			}
			const canvas = document.createElement('canvas');
			canvas.width = SNAP_SIZE; canvas.height = SNAP_SIZE;
			const ctx = canvas.getContext('2d');
			const img = ctx.createImageData(SNAP_SIZE, SNAP_SIZE);
			for (let row = 0; row < SNAP_SIZE; row++) {
				const src = (SNAP_SIZE - 1 - row) * SNAP_SIZE * 4; // GL rows run bottom-up
				const dst = row * SNAP_SIZE * 4;
				for (let col = 0; col < SNAP_SIZE * 4; col += 4) {
					img.data[dst + col] = toSrgb(px[src + col]);
					img.data[dst + col + 1] = toSrgb(px[src + col + 1]);
					img.data[dst + col + 2] = toSrgb(px[src + col + 2]);
					img.data[dst + col + 3] = 255;
				}
			}
			ctx.putImageData(img, 0, 0);
			return canvas;
		} catch {
			return null; // the winner card falls back to a letter disc
		}
	}

	// ------------------------------------------------------------- floor effects

	_buildFloorFx() {
		this._fx = new Group();
		const { floor } = this.host;
		this._fx.position.set(floor.x, 0, floor.z);

		// Call-to-action ring on the pad's edge while the round is open.
		this._callMat = new MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0, depthWrite: false, side: DoubleSide, blending: AdditiveBlending });
		const call = new Mesh(new RingGeometry(floor.r - 0.25, floor.r + 0.1, 72), this._callMat);
		call.rotation.x = -Math.PI / 2;
		call.position.y = 0.05;
		this._fx.add(call);
		this._call = call;

		// Winner spotlight: an open additive cone from the sky onto the champion.
		this._beamMat = new MeshBasicMaterial({ color: 0xfff0c2, transparent: true, opacity: 0.22, depthWrite: false, side: DoubleSide, blending: AdditiveBlending });
		const beam = new Mesh(new CylinderGeometry(1.0, 1.9, 16, 32, 1, true), this._beamMat);
		beam.visible = false;
		this.host.world.add(beam);
		this._beam = beam;
		this.host.world.add(this._fx);
	}

	_ringFor(id) {
		let r = this.rings.get(id);
		if (!r) {
			const mat = new MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.7, depthWrite: false, side: DoubleSide });
			const mesh = new Mesh(new RingGeometry(0.55, 0.78, 40), mat);
			mesh.rotation.x = -Math.PI / 2;
			this.host.world.add(mesh);
			r = { mesh, mat };
			this.rings.set(id, r);
		}
		return r;
	}

	_dropRing(id) {
		const r = this.rings.get(id);
		if (!r) return;
		this.host.world.remove(r.mesh);
		r.mesh.geometry.dispose();
		r.mat.dispose();
		this.rings.delete(id);
	}

	/** Per-frame: ring follow, pulses, beam, winner confetti, countdown text. */
	tick(dt) {
		this.t += dt;
		const s = this.snap;
		const phase = s?.phase || 'idle';

		// Open round: the pad's edge breathes so the crowd sees where to go.
		this._callMat.opacity = phase === 'joining' ? 0.35 + 0.3 * Math.sin(this.t * 5) : 0;

		// A ring under every live contestant (and the champion through the winner moment).
		const want = new Set();
		if (s && (phase === 'performing' || phase === 'tally')) for (const c of s.contestants) want.add(c.id);
		if (s && phase === 'winner' && s.winner) want.add(s.winner.id);
		for (const id of [...this.rings.keys()]) if (!want.has(id)) this._dropRing(id);
		const aimed = phase === 'performing' ? this.aim() : '';
		for (const id of want) {
			const info = this.host.playerInfo(id);
			if (!info) { this._dropRing(id); continue; }
			const r = this._ringFor(id);
			r.mesh.position.set(info.pos.x, 0.06, info.pos.z);
			const hot = id === aimed || (phase === 'winner');
			const pulse = 1 + 0.07 * Math.sin(this.t * 6 + id.length);
			r.mesh.scale.setScalar(hot ? pulse * 1.18 : pulse);
			r.mat.color.setHex(hot ? 0xfff0c2 : GOLD);
			r.mat.opacity = hot ? 0.95 : 0.6;
		}

		// Winner spotlight and confetti.
		if (phase === 'winner' && s.winner) {
			const info = this.host.playerInfo(s.winner.id);
			if (info) {
				this._beam.position.set(info.pos.x, 8, info.pos.z);
				this._beamMat.opacity = 0.18 + 0.06 * Math.sin(this.t * 3);
				const sinceWin = performance.now() - this.winnerAt;
				const every = reducedMotion() ? 1e9 : CONFETTI_EVERY_MS;
				if (sinceWin < CONFETTI_FOR_MS && performance.now() - this.lastConfettiAt >= every) {
					this.lastConfettiAt = performance.now();
					this.host.confetti(info.pos, info.height);
				} else if (!this.lastConfettiAt) {
					this.lastConfettiAt = performance.now();
					this.host.confetti(info.pos, info.height);
				}
			}
		}

		this._tickClock();
	}

	// --------------------------------------------------------------------- HUD

	_buildStyle() {
		if (document.getElementById('dof-style')) return;
		const style = el('style', { id: 'dof-style' });
		style.textContent = STYLE;
		document.head.appendChild(style);
	}

	_buildHud() {
		this.title = el('span', { text: 'Dance-off' });
		this.liveTag = el('span', { class: 'dof-live', text: 'LIVE EVENT', hidden: true });
		this.clock = el('div', { class: 'dof-clock', text: '' });
		this.phaseText = el('p', { class: 'dof-phase', text: '' });
		this.list = el('ul', { class: 'dof-list', 'aria-label': 'Contestants' });
		this.champ = el('div', { class: 'dof-champ', hidden: true });
		this.hint = el('p', { class: 'dof-hint', text: '' });
		this.actions = el('div', { class: 'dof-actions' });
		this.announce = el('div', { class: 'dof-announce', 'aria-live': 'polite', role: 'status' });
		this.hud = el('section', { id: 'dof-hud', 'aria-label': 'Dance-off' }, [
			el('div', { class: 'dof-head' }, [this.title, this.liveTag]),
			this.clock, this.phaseText, this.champ, this.list, this.hint, this.actions, this.announce,
		]);
		document.body.appendChild(this.hud);
	}

	_now() { return Date.now() + this.skew; }

	_tickClock() {
		const s = this.snap;
		if (!s) return;
		let text = '';
		let ends = 0;
		if (s.phase === 'joining' || s.phase === 'performing' || s.phase === 'tally') ends = s.endsAt;
		else if (s.phase === 'idle' && s.live && s.nextAt) ends = s.nextAt;
		if (ends) text = mmss(ends - this._now());
		if (s.phase === 'idle' && this.notice && Date.now() > this.noticeUntil) { this.notice = ''; this._render(); return; }
		if (text === this._lastClock) return;
		this._lastClock = text;
		this.clock.textContent = text;
		this.clock.classList.toggle('dof-low', s.phase === 'performing' && ends - this._now() <= 10_000);
	}

	/** The local player stepped on or off the pad: the Start action follows. */
	refresh() { this._render(); }

	_chip(c, rank, opts) {
		const me = this.host.localId();
		const aimed = this.aim() === c.id;
		const btn = el('button', {
			type: 'button',
			class: 'dof-chip' + (c.id === me ? ' dof-me' : '') + (this.myVote === c.id ? ' dof-voted' : '') +
				(aimed && !this.pinned ? ' dof-aim' : '') + (opts.win ? ' dof-win' : ''),
			'aria-pressed': this.pinned === c.id ? 'true' : 'false',
			'aria-label': `${c.name}, ${c.votes} ${c.votes === 1 ? 'vote' : 'votes'}${this.myVote === c.id ? ', your vote' : ''}`,
			title: opts.pin ? 'Aim your reactions at this dancer' : '',
		}, [
			el('span', { class: 'dof-rank', text: this.myVote === c.id ? '✓' : String(rank) }),
			el('span', { class: 'dof-name', text: c.name }),
			el('span', { class: 'dof-votes', text: String(c.votes) }),
		]);
		if (opts.pin && c.id !== me) {
			btn.addEventListener('click', () => {
				this.pinned = this.pinned === c.id ? '' : c.id;
				this._render();
			});
		} else {
			btn.disabled = !opts.pin;
			if (c.id === me) btn.setAttribute('aria-disabled', 'true');
		}
		return el('li', {}, [btn]);
	}

	_render() {
		const s = this.snap;
		const onFloor = this.host.isOnFloor();
		this.list.textContent = '';
		this.actions.textContent = '';
		this.champ.hidden = true;
		this.champ.textContent = '';
		this.hint.textContent = '';
		this._lastClock = '';

		let show = false;
		let announce = '';
		if (!s) {
			this.hud.classList.remove('dof-on');
			return;
		}
		this.liveTag.hidden = !s.live;

		if (s.phase === 'joining') {
			show = true;
			this.title.textContent = `Dance-off, round ${s.roundId}`;
			this.phaseText.textContent = onFloor
				? 'You are on the floor. Stay on the pad to compete.'
				: 'A dance-off is starting. Walk onto the glowing dance floor to join.';
			announce = 'A dance-off is starting. Step onto the dance floor to join.';
		} else if (s.phase === 'performing') {
			show = true;
			this.title.textContent = 'Dance-off, vote now';
			const iAm = this.isContestant();
			this.phaseText.textContent = iAm
				? 'Dance! Pick moves from the emote wheel. The crowd is voting.'
				: 'Send a reaction to vote. Tap a dancer to aim at them.';
			s.contestants.forEach((c, i) => this.list.appendChild(this._chip(c, i + 1, { pin: !iAm || c.id !== this.host.localId() })));
			this.hint.textContent = this.myVote ? 'Your vote is locked in.' : (iAm ? 'You cannot vote for yourself.' : 'One counted vote per round.');
			announce = 'The dance-off has started. Vote with the reaction bar.';
		} else if (s.phase === 'tally') {
			show = true;
			this.title.textContent = 'Dance-off, counting';
			this.phaseText.textContent = 'Votes are in.';
			s.standings.forEach((c, i) => this.list.appendChild(this._chip(c, i + 1, { pin: false })));
		} else if (s.phase === 'winner' && s.winner) {
			show = true;
			this.title.textContent = 'Dance-off champion';
			this.phaseText.textContent = '';
			this._renderChampion(s);
			s.standings.slice(0, 4).forEach((c, i) => this.list.appendChild(this._chip(c, i + 1, { pin: false, win: c.id === s.winner.id })));
			this.actions.appendChild(el('button', {
				class: 'dof-btn dof-primary', type: 'button', text: 'Tip the floor',
				onclick: () => this.openTip(s.winner),
			}));
			announce = `${s.winner.name} won the dance-off with ${s.winner.votes} votes.`;
		} else {
			// idle
			const live = s.live;
			if (this.notice && Date.now() <= this.noticeUntil) {
				show = true;
				this.title.textContent = 'Dance-off';
				this.phaseText.textContent = this.notice;
			} else if (live) {
				show = true;
				this.title.textContent = 'Next dance-off';
				this.phaseText.textContent = 'Warm up on the dance floor. Rounds run all through the event.';
			} else if (onFloor) {
				show = true;
				this.title.textContent = 'Dance-off';
				this.phaseText.textContent = 'Two dancers on the floor can start a round.';
			}
			if (onFloor && show) {
				this.actions.appendChild(el('button', {
					class: 'dof-btn dof-primary', type: 'button', text: 'Start a dance-off',
					onclick: () => this.host.sendStart(),
				}));
			}
		}
		this.hud.classList.toggle('dof-on', show);
		if (announce && announce !== this._lastAnnounce) this.announce.textContent = announce;
		this._lastAnnounce = announce;
	}

	_renderChampion(s) {
		const w = s.winner;
		const snap = el('canvas', { class: 'dof-snap', width: 168, height: 168, 'aria-label': `${w.name}, dance-off champion` });
		const x = snap.getContext('2d');
		if (this.snapshot) x.drawImage(this.snapshot, 0, 0, 168, 168);
		else {
			x.fillStyle = '#ffce5c'; x.fillRect(0, 0, 168, 168);
			x.fillStyle = '#120d00'; x.textAlign = 'center'; x.textBaseline = 'middle';
			x.font = '800 96px system-ui, sans-serif';
			x.fillText((w.name || '?').trim().charAt(0).toUpperCase() || '?', 84, 90);
		}
		const isMe = w.id === this.host.localId();
		const reward = this.reward;
		const rewardText = isMe
			? (reward ? (reward.first ? 'Champion Spotlight added to your wardrobe.' : 'Champion Spotlight is already in your wardrobe.') : 'Granting your Champion Spotlight...')
			: '';
		this.champ.hidden = false;
		this.champ.append(snap, el('div', {}, [
			el('div', { class: 'dof-champ-name', text: w.name }),
			el('div', { class: 'dof-champ-sub', text: `${w.votes} ${w.votes === 1 ? 'vote' : 'votes'} from the crowd` }),
			rewardText ? el('div', { class: 'dof-reward', text: rewardText }) : null,
		]));
	}

	// --------------------------------------------------------------------- tip

	/**
	 * The dance-tip confirmation. This is an x402 spend, so nothing is paid until the
	 * person presses the confirm button on a card that states the recipient, the
	 * network and the amount read from the endpoint's own payment challenge. The
	 * confirm button then opens the standard checkout, which asks for the wallet's
	 * approval again.
	 */
	openTip(winner) {
		this.closeTip();
		const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		const routine = el('select', { id: 'dof-tip-routine', 'aria-label': 'Routine' },
			TIP_ROUTINES.map(([v, l]) => el('option', { value: v, text: l })));
		const body = el('div', {});
		const confirmBtn = el('button', { class: 'dof-btn dof-primary', type: 'button', text: 'Confirm and pay', disabled: true });
		const cancelBtn = el('button', { class: 'dof-btn', type: 'button', text: 'Cancel', onclick: () => this.closeTip() });
		const titleId = 'dof-tip-title';
		const card = el('div', { class: 'dof-tip', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId }, [
			el('h2', { id: titleId, text: 'Tip the floor' }),
			el('p', { text: `Book a dancer routine on the three.ws club stage in honor of ${winner.name}. This is a real payment and nothing is sent until you confirm.` }),
			el('label', {}, [el('span', { text: 'Routine' }), routine]),
			body,
			el('div', { class: 'dof-actions' }, [cancelBtn, confirmBtn]),
		]);
		const overlay = el('div', { class: 'dof-tip-overlay' }, [card]);
		overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) this.closeTip(); });
		const onKey = (e) => {
			if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.closeTip(); }
			else if (e.key === 'Tab') {
				const f = [...card.querySelectorAll('button:not([disabled]), select')];
				if (!f.length) return;
				const first = f[0], last = f[f.length - 1];
				if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
				else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
			}
		};
		document.addEventListener('keydown', onKey, true);
		document.body.appendChild(overlay);
		this._tip = { overlay, onKey, opener, challenge: null, busy: false };
		requestAnimationFrame(() => { overlay.classList.add('dof-on'); cancelBtn.focus(); });

		const load = async () => {
			const tip = this._tip;
			if (!tip) return;
			tip.challenge = null;
			confirmBtn.disabled = true;
			confirmBtn.textContent = 'Confirm and pay';
			body.textContent = '';
			body.append(el('div', { class: 'dof-skel', style: 'margin-bottom:8px' }), el('div', { class: 'dof-skel', style: 'margin-bottom:8px;width:70%' }));
			try {
				const ch = await this._fetchChallenge(routine.value);
				if (this._tip !== tip) return;
				tip.challenge = ch;
				body.textContent = '';
				body.append(el('dl', {}, [
					el('dt', { text: 'Recipient' }),
					el('dd', {}, [el('div', { text: 'three.ws club stage' }), el('code', { title: ch.payTo, text: shortAddr(ch.payTo) })]),
					el('dt', { text: 'Network' }), el('dd', { text: ch.networkLabel }),
					el('dt', { text: 'Amount' }), el('dd', { class: 'dof-amt', text: `${ch.amountText} ${ch.symbol}` }),
					el('dt', { text: 'Pays for' }), el('dd', { text: 'One dancer routine on the club stage. It does not go to the winner.' }),
				]));
				confirmBtn.textContent = `Confirm and pay ${ch.amountText} ${ch.symbol}`;
				confirmBtn.disabled = false;
				confirmBtn.focus();
			} catch (err) {
				if (this._tip !== tip) return;
				body.textContent = '';
				body.append(
					el('p', { class: 'dof-err', role: 'alert', text: `Could not read the price from the server: ${err.message}` }),
					el('button', { class: 'dof-btn', type: 'button', text: 'Try again', onclick: load }),
				);
			}
		};
		routine.addEventListener('change', load);
		confirmBtn.addEventListener('click', async () => {
			const tip = this._tip;
			if (!tip || !tip.challenge || tip.busy) return;
			tip.busy = true;
			confirmBtn.disabled = true;
			confirmBtn.textContent = 'Opening checkout...';
			try {
				const X402 = await ensureX402();
				const out = await X402.pay({
					endpoint: `${TIP_ENDPOINT}?dancer=1&dance=${encodeURIComponent(routine.value)}`,
					method: 'GET',
					merchant: 'three.ws club stage',
					action: 'Tip the floor',
				});
				if (!out || !out.ok) throw new Error((out && out.error) || 'Payment did not complete.');
				body.textContent = '';
				body.append(el('p', { class: 'dof-ok', role: 'status', text: 'Tip settled. Your routine is booked on the club stage.' }));
				confirmBtn.hidden = true;
				cancelBtn.textContent = 'Done';
				this.host.toast('Tip sent to the club stage.', 'success');
			} catch (err) {
				const msg = String(err?.message || err || '');
				const cancelled = err?.code === 'cancelled' || /cancel|reject|denied|closed/i.test(msg);
				body.append(el('p', { class: cancelled ? 'dof-hint' : 'dof-err', role: 'alert', text: cancelled ? 'Payment cancelled. Nothing was charged.' : `Payment failed: ${msg}` }));
				confirmBtn.disabled = false;
				confirmBtn.textContent = `Confirm and pay ${tip.challenge.amountText} ${tip.challenge.symbol}`;
			} finally {
				tip.busy = false;
			}
		});
		load();
	}

	/** Read the endpoint's free, unpaid payment challenge for the recipient and price. */
	async _fetchChallenge(dance) {
		let res;
		try {
			res = await fetch(`${TIP_ENDPOINT}?dancer=1&dance=${encodeURIComponent(dance)}`, { headers: { accept: 'application/json' } });
		} catch {
			throw new Error('network error. Check your connection.');
		}
		if (res.status !== 402) throw new Error(`the tip service answered ${res.status}.`);
		let json;
		try { json = await res.json(); } catch { throw new Error('the payment challenge was unreadable.'); }
		const accepts = Array.isArray(json?.accepts) ? json.accepts : [];
		const sol = accepts.find((a) => String(a.network || '').startsWith('solana') && a.payTo);
		const a = sol || accepts.find((x) => x.payTo);
		if (!a) throw new Error('the payment challenge named no recipient.');
		const decimals = Number(a.extra?.decimals ?? 6);
		const atomics = Number(a.amount ?? a.maxAmountRequired);
		if (!Number.isFinite(atomics) || atomics <= 0) throw new Error('the payment challenge named no amount.');
		const value = atomics / 10 ** decimals;
		return {
			payTo: String(a.payTo),
			network: String(a.network || ''),
			networkLabel: String(a.network || '').startsWith('solana') ? 'Solana' : String(a.network || 'unknown'),
			symbol: String(a.extra?.name || 'USDC'),
			amountText: value.toFixed(Math.min(6, Math.max(2, decimals))).replace(/0+$/, '').replace(/\.$/, '.0'),
		};
	}

	closeTip() {
		const t = this._tip;
		if (!t) return;
		document.removeEventListener('keydown', t.onKey, true);
		t.overlay.classList.remove('dof-on');
		setTimeout(() => t.overlay.remove(), 200);
		this._tip = null;
		try { t.opener?.focus?.({ preventScroll: true }); } catch { /* opener left the page */ }
	}

	// ----------------------------------------------------------------- teardown

	dispose() {
		this.closeTip();
		for (const id of [...this.rings.keys()]) this._dropRing(id);
		for (const m of [this._beam, this._call]) {
			m.geometry.dispose();
			m.material.dispose();
		}
		this.host.world.remove(this._beam);
		this.host.world.remove(this._fx);
		if (this.winnerAt) { this.host.hideScreenArt(false); this.winnerAt = 0; }
		this.hud.remove();
		this.snap = null;
	}
}

// The forge hologram: what stands in the world while a forged prop is being
// generated, so the player places first and waits second.
//
// It is a local scene object (never sent to the room, so it costs no build
// budget) plus a small DOM card pinned above it. Three looks, all driven by the
// real job state in coincommunities.js (_forgeProp), never by a timer:
//
//   generating   cyan wireframe shell with a scan line rising through it and the
//                lane's live status line on the card, plus a Cancel button
//   landing      the model is ready and its placement is with the room: same
//                look, no buttons (there is nothing left to cancel)
//   error        red shell, static, with the reason and Retry / Dismiss
//   materialize  a short flash-and-fade as the real model lands on the spot
//
// Reduced motion: no pulse, no scan sweep, and the materialize step is instant.

import {
	Group, Mesh, BoxGeometry, EdgesGeometry, LineSegments, LineBasicMaterial, MeshBasicMaterial,
	PlaneGeometry, RingGeometry, DoubleSide, AdditiveBlending, Vector3,
} from 'three';
import { prefersReducedMotion } from './a11y.js';

const HOLO = 0x5ad7ff;
const HOLO_ERR = 0xff5a5a;
const FOOT = 0.6;
const HEIGHT = 1.5;
const MATERIALIZE_S = 0.7;

export class ForgeHologram {
	/**
	 * @param {import('three').Scene} scene
	 * @param {{onCancel?: () => void, onRetry?: () => void, onDismiss?: () => void}} handlers
	 */
	constructor(scene, handlers = {}) {
		this.scene = scene;
		this.h = handlers;
		this.state = 'generating';
		this._t = 0;
		this._fade = null;
		this._v = new Vector3();

		this.group = new Group();
		this.group.name = 'forge-hologram';
		this.group.visible = false;
		this._fill = new MeshBasicMaterial({ color: HOLO, transparent: true, opacity: 0.12, depthWrite: false, blending: AdditiveBlending });
		this._line = new LineBasicMaterial({ color: HOLO, transparent: true, opacity: 0.9, depthWrite: false });
		this._scanMat = new MeshBasicMaterial({ color: HOLO, transparent: true, opacity: 0.45, side: DoubleSide, depthWrite: false, blending: AdditiveBlending });
		this._geos = [];
		const box = this._geo(new BoxGeometry(FOOT * 2, HEIGHT, FOOT * 2));
		const shell = new Mesh(box, this._fill);
		shell.position.y = HEIGHT / 2;
		const edges = new LineSegments(this._geo(new EdgesGeometry(box)), this._line);
		edges.position.y = HEIGHT / 2;
		this._scan = new Mesh(this._geo(new PlaneGeometry(FOOT * 2.1, FOOT * 2.1)), this._scanMat);
		this._scan.rotation.x = -Math.PI / 2;
		const ring = new Mesh(this._geo(new RingGeometry(FOOT * 1.25, FOOT * 1.45, 48)), this._scanMat);
		ring.rotation.x = -Math.PI / 2;
		ring.position.y = 0.02;
		this.group.add(shell, edges, this._scan, ring);
		scene.add(this.group);

		this._buildCard();
	}

	_geo(g) { this._geos.push(g); return g; }

	_buildCard() {
		const card = document.createElement('div');
		card.className = 'cc-holo-card';
		card.setAttribute('role', 'group');
		card.hidden = true;
		const title = document.createElement('div');
		title.className = 'cc-holo-title';
		const status = document.createElement('div');
		status.className = 'cc-holo-status';
		status.setAttribute('aria-live', 'polite');
		const actions = document.createElement('div');
		actions.className = 'cc-holo-actions';
		const button = (label, cls, fn) => {
			const b = document.createElement('button');
			b.type = 'button';
			b.className = `cc-holo-btn ${cls}`;
			b.textContent = label;
			// The card floats over the canvas: a click on it must never also count
			// as a build click on the world underneath.
			b.addEventListener('pointerdown', (e) => e.stopPropagation());
			b.addEventListener('click', (e) => { e.stopPropagation(); fn?.(); });
			return b;
		};
		this._cancelBtn = button('Cancel', 'cc-holo-cancel', () => this.h.onCancel?.());
		this._retryBtn = button('Retry', 'cc-holo-retry', () => this.h.onRetry?.());
		this._dismissBtn = button('Dismiss', 'cc-holo-dismiss', () => this.h.onDismiss?.());
		actions.append(this._cancelBtn, this._retryBtn, this._dismissBtn);
		card.append(title, status, actions);
		card.addEventListener('pointerdown', (e) => e.stopPropagation());
		document.body.appendChild(card);
		this.card = card;
		this._title = title;
		this._status = status;
		this._applyState();
	}

	/** Stand the hologram at a placement pose and show it. */
	place({ x, y, z, yaw = 0, scale = 1 }) {
		this.group.position.set(x, y, z);
		this.group.rotation.y = yaw;
		this.group.scale.setScalar(scale);
		this.group.visible = true;
		this.card.hidden = false;
	}

	get placed() { return this.group.visible; }

	setName(name) {
		this._title.textContent = name || 'Forged item';
		this.card.setAttribute('aria-label', `Forge hologram: ${name || 'forged item'}`);
	}

	setStatus(text) {
		if (this.state === 'error') return;
		this._status.textContent = text || 'Forging…';
	}

	/** Back to the generating look (a retry, or the first run). */
	setGenerating(text) {
		this.state = 'generating';
		this._applyState();
		this.setStatus(text);
	}

	/** The model is ready and is being placed: nothing left to cancel. */
	setLanding(text) {
		this.state = 'landing';
		this._applyState();
		this._status.textContent = text || 'Placing it in the world…';
	}

	/**
	 * Turn into the error marker.
	 * @param {string} message
	 * @param {{retryLabel?: string}} [opts]
	 */
	setError(message, { retryLabel = 'Retry' } = {}) {
		this.state = 'error';
		this._retryBtn.textContent = retryLabel;
		this._status.textContent = message;
		this._applyState();
		if (this.placed) this._retryBtn.focus({ preventScroll: true });
	}

	/** Play the landing flash, then remove the hologram. Resolves when gone. */
	materialize() {
		this.state = 'materialize';
		this._applyState();
		this.card.hidden = true;
		if (prefersReducedMotion() || !this.placed) { this.dispose(); return Promise.resolve(); }
		return new Promise((resolve) => { this._fade = { t: 0, base: this.group.scale.x, resolve }; });
	}

	_applyState() {
		const err = this.state === 'error';
		const hex = err ? HOLO_ERR : HOLO;
		this._fill.color.setHex(hex);
		this._line.color.setHex(hex);
		this._scanMat.color.setHex(hex);
		this._scan.visible = this.state === 'generating' || this.state === 'landing';
		this.card.classList.toggle('is-error', err);
		this._cancelBtn.hidden = this.state !== 'generating';
		this._retryBtn.hidden = !err;
		this._dismissBtn.hidden = !err;
	}

	/**
	 * Per frame: animate the shell and keep the card pinned above it.
	 * @param {number} dt seconds
	 * @param {import('three').Camera} camera
	 * @param {HTMLCanvasElement} canvas
	 */
	tick(dt, camera, canvas) {
		if (!this.group.visible) return;
		this._t += dt;
		if (this._fade) { this._tickFade(dt); return; }
		const calm = prefersReducedMotion();
		if ((this.state === 'generating' || this.state === 'landing') && !calm) {
			const phase = (this._t % 2.2) / 2.2;
			this._scan.position.y = phase * HEIGHT;
			this._fill.opacity = 0.1 + 0.06 * Math.sin(this._t * 3);
		} else {
			this._scan.position.y = HEIGHT * 0.5;
			this._fill.opacity = this.state === 'error' ? 0.18 : 0.12;
		}
		this._pinCard(camera, canvas);
	}

	_tickFade(dt) {
		const f = this._fade;
		f.t += dt;
		const k = Math.min(1, f.t / MATERIALIZE_S);
		// A quick swell then a fade: the shell "releases" the model it held.
		this.group.scale.setScalar(f.base * (1 + 0.18 * Math.sin(k * Math.PI)));
		this._fill.opacity = 0.45 * (1 - k);
		this._line.opacity = 0.9 * (1 - k);
		this._scanMat.opacity = 0.45 * (1 - k);
		if (k >= 1) {
			this._fade = null;
			this.dispose();
			f.resolve();
		}
	}

	_pinCard(camera, canvas) {
		if (!camera || !canvas) return;
		const p = this.group.position;
		const v = this._v.set(p.x, p.y + HEIGHT * this.group.scale.y + 0.35, p.z).project(camera);
		const behind = v.z > 1 || v.z < -1;
		this.card.hidden = behind;
		if (behind) return;
		const rect = canvas.getBoundingClientRect();
		const sx = rect.left + (v.x * 0.5 + 0.5) * rect.width;
		const sy = rect.top + (-v.y * 0.5 + 0.5) * rect.height;
		this.card.style.transform = `translate(${Math.round(sx)}px, ${Math.round(sy)}px) translate(-50%, -100%)`;
	}

	dispose() {
		if (this._disposed) return;
		this._disposed = true;
		this.scene.remove(this.group);
		for (const g of this._geos) g.dispose();
		this._fill.dispose();
		this._line.dispose();
		this._scanMat.dispose();
		this.card.remove();
	}
}

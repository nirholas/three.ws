// /club tip tags: tip a dancer from inside the room.
//
// Each dancer carries a floating tag over her head (name, the style she will
// dance, a Tip button) pinned to her in screen space every frame. Click the
// dancer herself, her pole, or her name and a tray of style chips opens on
// the tag. Pick a style, hit Tip, and the wallet opens. The sidebar pole cards
// stay as the full controls; the tag writes its style pick straight into the
// sidebar select, so the two surfaces never disagree about what she'll dance.
//
// While a dancer performs, her tag shows who she is dancing for and how long
// is left, read from the station each frame (no timers of its own).

import { Raycaster, Vector2, Vector3 } from 'three';
import { shortAddress } from './shared/address.js';

const TAG_LIFT = 0.42;       // metres above the dancer's head
const PICK_RADIUS = 0.62;    // how close to the pole axis a click must land
const PICK_TOP = 2.4;        // the clickable column: stage floor to just over her head
const CLICK_SLOP_PX = 6;     // more movement than this is an orbit drag, not a click
const CLICK_MAX_MS = 450;

const _v = new Vector3();
const _ray = new Raycaster();
const _ndc = new Vector2();

/**
 * Distance between a ray and a vertical segment (the pole column), plus the
 * ray parameter at the closest point. Pure, so picking is unit-testable.
 * @param {{origin:{x:number,y:number,z:number}, direction:{x:number,y:number,z:number}}} ray
 * @param {{x:number,z:number,y0:number,y1:number}} col
 * @returns {{dist:number, t:number}}
 */
export function rayToColumn(ray, col) {
	const o = ray.origin;
	const d = ray.direction;
	// Closest points between the ray o + t d and the segment p + s u, u = +Y.
	const wx = o.x - col.x;
	const wy = o.y - col.y0;
	const wz = o.z - col.z;
	const len = col.y1 - col.y0;
	const b = d.y;                 // d . u
	const dd = d.x * wx + d.y * wy + d.z * wz;
	const e = wy;                  // u . w
	const denom = 1 - b * b;       // |d| = |u| = 1
	let t = denom > 1e-6 ? (b * e - dd) / denom : 0;
	if (t < 0) t = 0;
	let s = e + b * t;
	if (s < 0) s = 0;
	else if (s > len) s = len;
	// Re-project t onto the clamped segment point.
	t = Math.max(0, (col.x - o.x) * d.x + (col.y0 + s - o.y) * d.y + (col.z - o.z) * d.z);
	const px = o.x + d.x * t - col.x;
	const py = o.y + d.y * t - (col.y0 + s);
	const pz = o.z + d.z * t - col.z;
	return { dist: Math.hypot(px, py, pz), t };
}

function escapeHtml(s) {
	return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function shortWallet(addr) { return shortAddress(addr, 4, 4, { empty: 'someone' }); }

export class ClubTipHud {
	/**
	 * @param {object} opts
	 * @param {HTMLElement} opts.layer      fixed overlay the tags live in
	 * @param {HTMLCanvasElement} opts.canvas
	 * @param {import('three').Camera} opts.camera
	 * @param {Array<{id:string,name:string,accent:string,station:object}>} opts.dancers
	 * @param {Array<{key:string,label:string}>} opts.dances
	 * @param {(id:string) => string} opts.getStyle
	 * @param {(id:string, key:string) => void} opts.setStyle
	 * @param {(id:string, key:string, button:HTMLButtonElement) => void} opts.onTip
	 * @param {(id:string) => void} [opts.onFocus]  a dancer was picked in the scene
	 */
	constructor({ layer, canvas, camera, dancers, dances, getStyle, setStyle, onTip, onFocus }) {
		this.layer = layer;
		this.canvas = canvas;
		this.camera = camera;
		this.dances = dances;
		this.getStyle = getStyle;
		this.setStyle = setStyle;
		this.onTip = onTip;
		this.onFocus = onFocus;
		this.enabled = false;
		this.hidden = false;
		this.openId = null;
		this.hoverId = null;
		/** @type {Map<string, {el:HTMLElement, tip:HTMLButtonElement, nameBtn:HTMLButtonElement, styleEl:HTMLElement, tray:HTMLElement, live:HTMLElement, station:object, x:number, y:number, shown:boolean, liveText:string, tipState:string}>} */
		this.tags = new Map();
		this.rect = null;
		// The canvas box moves when the window resizes or the side panel reflows;
		// every tag is placed relative to it.
		this._ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => this.measure()) : null;
		this._ro?.observe(canvas);
		this._onResize = () => this.measure();
		window.addEventListener('resize', this._onResize);

		for (const d of dancers) this._build(d);
		this.measure();
		this._bindScenePicking();
		this._onDocPointer = (e) => {
			if (!this.openId) return;
			const tag = this.tags.get(this.openId);
			if (tag && !tag.el.contains(e.target) && e.target !== this.canvas) this.close();
		};
		this._onKey = (e) => { if (e.key === 'Escape' && this.openId) this.close({ refocus: true }); };
		document.addEventListener('pointerdown', this._onDocPointer, true);
		document.addEventListener('keydown', this._onKey);
	}

	/** Tip buttons stay disabled until the payment widget is live. */
	setEnabled(on) {
		this.enabled = on;
		for (const tag of this.tags.values()) this._syncTip(tag, true);
	}

	/** Hide every tag (the alley still covers the stage, or a modal is up). */
	setHidden(hidden) {
		if (this.hidden === hidden) return;
		this.hidden = hidden;
		this.layer.classList.toggle('is-hidden', hidden);
		if (hidden) this.close();
		// A hidden layer measures every tag as zero wide; re-read them now that
		// they can be laid out, so edge clamping uses their real size.
		else this.measure();
	}

	/**
	 * Re-read the canvas box after a resize or layout change. The tag layer is
	 * laid exactly over the canvas and clips to it, so a tag can never slide
	 * over the side panel.
	 */
	measure() {
		const r = this.canvas.getBoundingClientRect();
		this.rect = r;
		const st = this.layer.style;
		st.left = `${r.left}px`;
		st.top = `${r.top}px`;
		st.width = `${r.width}px`;
		st.height = `${r.height}px`;
		for (const tag of this.tags.values()) this._measureTag(tag);
	}

	/** Keep a tag's style label in step when the sidebar select changes. */
	refreshStyle(id) {
		const tag = this.tags.get(id);
		if (!tag) return;
		const key = this.getStyle(id);
		tag.styleEl.textContent = this.dances.find((d) => d.key === key)?.label || key;
		for (const chip of tag.tray.querySelectorAll('.club-tag-chip')) {
			chip.setAttribute('aria-pressed', chip.dataset.dance === key ? 'true' : 'false');
		}
	}

	open(id) {
		if (this.openId && this.openId !== id) this.close();
		const tag = this.tags.get(id);
		if (!tag) return;
		this.openId = id;
		tag.el.classList.add('is-open');
		tag.tray.hidden = false;
		tag.nameBtn.setAttribute('aria-expanded', 'true');
		this.refreshStyle(id);
		this._measureTag(tag);
	}

	close({ refocus = false } = {}) {
		const tag = this.openId && this.tags.get(this.openId);
		this.openId = null;
		if (!tag) return;
		tag.el.classList.remove('is-open');
		tag.tray.hidden = true;
		tag.nameBtn.setAttribute('aria-expanded', 'false');
		this._measureTag(tag);
		if (refocus) tag.nameBtn.focus({ preventScroll: true });
	}

	/** Pin every tag over its dancer. Called once per rendered frame. */
	update() {
		if (this.hidden) return;
		const { rect } = this;
		for (const tag of this.tags.values()) {
			const rig = tag.station.rig;
			if (!rig) continue;
			rig.getWorldPosition(_v);
			_v.y += (tag.station.headHeight || 1.75) + TAG_LIFT;
			_v.project(this.camera);
			const onScreen = _v.z > -1 && _v.z < 1 && Math.abs(_v.x) < 1.02 && _v.y < 1.1 && _v.y > -1.02;
			if (onScreen !== tag.shown) {
				tag.shown = onScreen;
				tag.el.classList.toggle('is-offscreen', !onScreen);
				if (!onScreen && this.openId === tag.id) this.close();
			}
			if (onScreen) {
				// Layer-local coordinates, kept inside the canvas box so the whole
				// tag (open tray included) stays readable at the edges.
				const half = tag.w / 2 + 8;
				const x = Math.min(Math.max((_v.x * 0.5 + 0.5) * rect.width, half), rect.width - half);
				const y = Math.max((-_v.y * 0.5 + 0.5) * rect.height, tag.h + 8);
				// Sub-pixel jitter is invisible; skipping it spares a style write.
				if (Math.abs(x - tag.x) > 0.5 || Math.abs(y - tag.y) > 0.5) {
					tag.x = x;
					tag.y = y;
					tag.el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`;
				}
			}
			this._syncTip(tag);
		}
	}

	dispose() {
		document.removeEventListener('pointerdown', this._onDocPointer, true);
		document.removeEventListener('keydown', this._onKey);
		window.removeEventListener('resize', this._onResize);
		this._ro?.disconnect();
		this._unbindScene?.();
		for (const tag of this.tags.values()) tag.el.remove();
		this.tags.clear();
	}

	// ── internals ────────────────────────────────────────────────────────

	_build({ id, name, accent, station }) {
		const el = document.createElement('div');
		el.className = 'club-tag is-offscreen';
		el.dataset.pole = id;
		el.style.setProperty('--tag-accent', accent);
		const trayId = `club-tag-tray-${id}`;
		el.innerHTML = `
			<div class="club-tag-bar">
				<button type="button" class="club-tag-name" aria-expanded="false" aria-controls="${trayId}"
					aria-label="Choose ${escapeHtml(name)}'s dance">
					<span class="club-tag-who">${escapeHtml(name)}</span>
					<span class="club-tag-style"></span>
					<svg class="club-tag-caret" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
				</button>
				<button type="button" class="club-tag-tip" disabled aria-disabled="true">Tip $0.001</button>
			</div>
			<div class="club-tag-live" aria-live="polite"></div>
			<div class="club-tag-tray" id="${trayId}" role="group" aria-label="Dance style for ${escapeHtml(name)}" hidden>
				${this.dances.map((d) => `<button type="button" class="club-tag-chip" data-dance="${escapeHtml(d.key)}" aria-pressed="false">${escapeHtml(d.label)}</button>`).join('')}
			</div>
		`;
		this.layer.appendChild(el);
		const tag = {
			id,
			el,
			station,
			nameBtn: el.querySelector('.club-tag-name'),
			tip: el.querySelector('.club-tag-tip'),
			styleEl: el.querySelector('.club-tag-style'),
			tray: el.querySelector('.club-tag-tray'),
			live: el.querySelector('.club-tag-live'),
			// Far off-canvas, so the first on-screen frame always writes a position.
			x: -1e4,
			y: -1e4,
			shown: false,
			w: 160,
			h: 40,
			liveText: '',
			tipState: '',
		};
		this.tags.set(id, tag);
		this.refreshStyle(id);
		this._measureTag(tag);

		tag.nameBtn.addEventListener('click', () => {
			if (this.openId === id) this.close();
			else this.open(id);
		});
		tag.tray.addEventListener('click', (e) => {
			const chip = e.target.closest('.club-tag-chip');
			if (!chip) return;
			this.setStyle(id, chip.dataset.dance);
			this.refreshStyle(id);
			tag.tip.focus({ preventScroll: true });
		});
		tag.tip.addEventListener('click', () => {
			if (tag.tip.disabled) return;
			this.close();
			this.onTip(id, this.getStyle(id), tag.tip);
		});
		el.addEventListener('pointerenter', () => el.classList.add('is-hover'));
		el.addEventListener('pointerleave', () => el.classList.remove('is-hover'));
	}

	/** Cache a tag's box; read only when its content changes, never per frame. */
	_measureTag(tag) {
		const wasOff = tag.el.classList.contains('is-offscreen');
		if (wasOff) tag.el.classList.remove('is-offscreen');
		tag.w = tag.el.offsetWidth || tag.w;
		tag.h = tag.el.offsetHeight || tag.h;
		if (wasOff) tag.el.classList.add('is-offscreen');
	}

	/** Mirror the station's performance state onto the tag's button and caption. */
	_syncTip(tag, force = false) {
		const st = tag.station;
		const local = st.performing && st.activeTicket?.local;
		const pending = tag.tip.classList.contains('is-pending');
		let state;
		if (pending) state = 'pending';
		else if (!this.enabled) state = 'off';
		else if (local) state = 'local';
		else state = 'ready';
		if (force || state !== tag.tipState) {
			tag.tipState = state;
			const off = state === 'off' || state === 'local' || state === 'pending';
			tag.tip.disabled = off;
			tag.tip.setAttribute('aria-disabled', off ? 'true' : 'false');
			if (state === 'ready' || state === 'off') tag.tip.textContent = 'Tip $0.001';
			else if (state === 'local') tag.tip.textContent = 'Your dance';
		}
		let live = '';
		if (st.performing && st.activeTicket) {
			const left = Math.max(0, Math.ceil((st.activeUntil - Date.now()) / 1000));
			const who = st.activeTicket.local ? 'you' : shortWallet(st.activeTicket.payer);
			live = `${st.activeTicket.label || 'Dancing'} for ${who} · ${left}s`;
		}
		if (live !== tag.liveText) {
			tag.liveText = live;
			tag.live.textContent = live;
			const wasLive = tag.el.classList.contains('is-live');
			tag.el.classList.toggle('is-live', Boolean(live));
			if (wasLive !== Boolean(live)) this._measureTag(tag);
		}
	}

	/** Nearest dancer column under a screen point, or null. */
	_pick(clientX, clientY) {
		const { rect } = this;
		_ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
		_ray.setFromCamera(_ndc, this.camera);
		let best = null;
		let bestT = Infinity;
		for (const tag of this.tags.values()) {
			const rig = tag.station.rig;
			if (!rig) continue;
			rig.getWorldPosition(_v);
			const hit = rayToColumn(_ray.ray, { x: _v.x, z: _v.z, y0: 0, y1: PICK_TOP });
			if (hit.dist < PICK_RADIUS && hit.t < bestT) {
				bestT = hit.t;
				best = tag.id;
			}
		}
		return best;
	}

	_bindScenePicking() {
		const canvas = this.canvas;
		let down = null;
		let hoverRaf = 0;
		let lastMove = null;
		const onDown = (e) => {
			down = { x: e.clientX, y: e.clientY, t: performance.now(), id: e.pointerId };
		};
		const onUp = (e) => {
			if (!down || down.id !== e.pointerId) return;
			const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
			const quick = performance.now() - down.t < CLICK_MAX_MS;
			down = null;
			if (moved > CLICK_SLOP_PX || !quick || this.hidden) return;
			const id = this._pick(e.clientX, e.clientY);
			if (id) {
				this.open(id);
				this.onFocus?.(id);
			} else {
				this.close();
			}
		};
		const onMove = (e) => {
			if (e.buttons || e.pointerType !== 'mouse') return;
			lastMove = e;
			if (hoverRaf) return;
			hoverRaf = requestAnimationFrame(() => {
				hoverRaf = 0;
				if (!lastMove || this.hidden) return;
				const id = this._pick(lastMove.clientX, lastMove.clientY);
				if (id === this.hoverId) return;
				if (this.hoverId) this.tags.get(this.hoverId)?.el.classList.remove('is-hover');
				this.hoverId = id;
				if (id) this.tags.get(id)?.el.classList.add('is-hover');
				canvas.style.cursor = id ? 'pointer' : '';
			});
		};
		canvas.addEventListener('pointerdown', onDown);
		canvas.addEventListener('pointerup', onUp);
		canvas.addEventListener('pointermove', onMove);
		this._unbindScene = () => {
			canvas.removeEventListener('pointerdown', onDown);
			canvas.removeEventListener('pointerup', onUp);
			canvas.removeEventListener('pointermove', onMove);
			cancelAnimationFrame(hoverRaf);
		};
	}
}

// The signature wall: a permanent graffiti wall near spawn in the $THREE /play
// world where every visitor can leave a name and a line (docs/signature-wall.md).
//
// Sibling of wheel-station.js / war-portal.js: its own landmark, its own walk-up
// prompt (F), and the same discipline as the war portal's board, it fetches
// NOTHING until a player is within reading range, and stops animating when they
// leave. The texture is composited by signature-wall-canvas.js, the data comes
// from signature-wall-data.js, and writes go through POST /api/play/signature-wall.
//
// Overflow design: the canvas shows one page at a time, sized by density (8 big
// tiles up to 128 small ones), cycling slowly through every page by rank, with the
// newest page returning after every three older ones and the three newest names
// pinned in a strip at the top. Memory is flat: one page of "newest" plus a six
// page LRU, however large the wall grows.

import {
	Group, Mesh, BoxGeometry, PlaneGeometry, CylinderGeometry, MeshStandardMaterial,
	RingGeometry, MeshBasicMaterial, DoubleSide,
} from 'three';
import { makeScreenTexture, screenMaterial } from './screen-texture.js';
import { WallPainter } from './signature-wall-canvas.js';
import {
	SignatureWallData, WallClientError, rememberSigned, recallSigned,
} from './signature-wall-data.js';
import { assignSlots, diffSlots, pageCount, pageOrder, dwellMs, NEWEST_SHOWN } from './signature-wall-layout.js';
import './signature-wall.css';

// Near spawn (0,0), west of the totem path, clear of the plaza rod (12,12), the
// ponds, the wheel (0,22) and the totem (0,-12). The face looks east, toward spawn.
export const SIGNATURE_WALL = { x: -14, z: -2, width: 10, height: 5, faceYaw: Math.PI / 2 };
const SIGN_REACH = 8;          // metres from the wall centre to show the F prompt
const READ_RANGE = 46;         // metres: inside this the wall fetches and animates
const POLL_MS = 20_000;        // safety poll while awake (the room ping is the fast path)
const RELOAD_MS = 5 * 60_000;  // full reload, so moderation removals disappear
const SLOT_QUEUE_MAX = 6;

const REDUCED_MOTION = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function el(tag, props = {}, children = []) {
	const n = document.createElement(tag);
	for (const [k, v] of Object.entries(props)) {
		if (k === 'class') n.className = v;
		else if (k === 'text') n.textContent = v;
		else if (k === 'hidden') n.hidden = !!v;
		else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
		else if (v != null) n.setAttribute(k, v);
	}
	for (const c of [].concat(children)) if (c != null) n.append(c);
	return n;
}

export class SignatureWall {
	/**
	 * @param {object} opts
	 * @param {import('three').Scene} opts.scene
	 * @param {() => ({x:number,y:number,z:number})} opts.getPlayer local avatar pose
	 * @param {object} opts.net            CommunityNet (sigwall event + ping)
	 * @param {() => string} opts.getName   the player's current display name
	 * @param {() => string} opts.getPlayPass  the play pass when signed in, else ''
	 * @param {{toast:(msg:string, kind?:string)=>void}} [opts.ui]
	 * @param {typeof fetch} [opts.fetchImpl]
	 */
	constructor({ scene, getPlayer, net, getName, getPlayPass, ui, fetchImpl }) {
		this.scene = scene;
		this.getPlayer = getPlayer;
		this.net = net;
		this.getName = getName;
		this.getPlayPass = getPlayPass;
		this.ui = ui;
		this.data = new SignatureWallData({ fetchImpl });

		this._t = 0;
		this._near = false;
		this._awake = false;
		this._disposed = false;
		this._slots = [];
		this._page = 0;
		this._order = [0];
		this._orderIdx = 0;
		this._flipAt = 0;
		this._flipping = false;
		this._pollAt = 0;
		this._reloadAt = 0;
		this._panel = null;
		this._mine = recallSigned();

		this._painter = new WallPainter();
		this._tex = makeScreenTexture(this._painter.canvas);
		this._painter.onFrame = () => { this._tex.needsUpdate = true; };
		this._tex.needsUpdate = true;

		this._buildScene();
		this._buildPrompt();
		this._unsub = net?.on?.('sigwall', () => this._onPing());
	}

	// ── scene ────────────────────────────────────────────────────────────

	_buildScene() {
		const { x, z, width, height, faceYaw } = SIGNATURE_WALL;
		const g = new Group();
		g.position.set(x, 0, z);
		g.rotation.y = faceYaw;

		const stone = new MeshStandardMaterial({ color: 0x2b2e36, roughness: 0.92 });
		const trim = new MeshStandardMaterial({ color: 0x15171c, roughness: 0.7, metalness: 0.2 });
		const base = new Mesh(new BoxGeometry(width + 1.2, 0.5, 1.1), stone);
		base.position.y = 0.25;
		base.receiveShadow = true;
		g.add(base);
		const back = new Mesh(new BoxGeometry(width + 0.5, height + 0.5, 0.35), trim);
		back.position.set(0, 0.5 + height / 2, -0.2);
		back.castShadow = true;
		g.add(back);

		this._face = new Mesh(new PlaneGeometry(width, height), screenMaterial(this._tex, { side: DoubleSide }));
		this._face.position.set(0, 0.5 + height / 2, -0.01);
		g.add(this._face);

		// Two work lamps on arms, so the wall reads as lit at any hour.
		for (const sx of [-width * 0.32, width * 0.32]) {
			const arm = new Mesh(new CylinderGeometry(0.05, 0.05, 0.9, 8), trim);
			arm.rotation.x = Math.PI / 2;
			arm.position.set(sx, 0.5 + height + 0.35, 0.35);
			g.add(arm);
			const lamp = new Mesh(new BoxGeometry(0.9, 0.12, 0.25), new MeshBasicMaterial({ color: 0xfff3c4, toneMapped: false }));
			lamp.position.set(sx, 0.5 + height + 0.3, 0.8);
			g.add(lamp);
		}

		// Ground marker in front of the wall: brightens in range like the other landmarks.
		this._marker = new Mesh(
			new RingGeometry(1.4, 1.65, 40),
			new MeshBasicMaterial({ color: 0xffe14d, transparent: true, opacity: 0.2, side: DoubleSide }),
		);
		this._marker.rotation.x = -Math.PI / 2;
		this._marker.position.set(0, 0.05, 3.2);
		g.add(this._marker);

		this.scene.add(g);
		this._group = g;
	}

	_buildPrompt() {
		this.btn = el('button', {
			class: 'ps-action sw-action',
			hidden: true,
			type: 'button',
			'aria-label': 'Sign the $THREE wall',
			text: '✍ Sign the wall',
			onclick: () => this.interact(),
		});
		document.body.appendChild(this.btn);
	}

	// ── frame loop ────────────────────────────────────────────────────────

	tick(dt) {
		if (this._disposed) return;
		this._t += dt;
		const p = this.getPlayer?.();
		const dist = p ? Math.hypot(p.x - SIGNATURE_WALL.x, p.z - SIGNATURE_WALL.z) : Infinity;
		const near = dist <= SIGN_REACH;
		const awake = dist <= READ_RANGE;

		if (near !== this._near) {
			this._near = near;
			this.btn.hidden = !near || !!this._panel;
		}
		if (awake !== this._awake) {
			this._awake = awake;
			if (awake) this._wake();
		}
		const glow = 0.16 + Math.sin(this._t * 1.8) * 0.06;
		this._marker.material.opacity = near ? glow + 0.24 : glow;

		if (!this._awake) return;
		this._painter.update(performance.now());
		const now = Date.now();
		if (this.data.loaded) {
			if (now >= this._flipAt && !this._panel) this._flip();
			if (now >= this._pollAt) this._poll();
			if (now >= this._reloadAt) this._reload();
		}
	}

	// ── data wiring ───────────────────────────────────────────────────────

	async _wake() {
		try {
			if (!this.data.loaded) {
				await this.data.load();
				this._reloadAt = Date.now() + RELOAD_MS;
				this._rebuild(false);
			} else {
				await this._applyFresh(await this.data.refresh({ minGapMs: 0 }));
			}
			this._pollAt = Date.now() + POLL_MS;
		} catch (err) {
			console.warn('[signature-wall] load failed:', err?.message);
			this._pollAt = Date.now() + 5000; // retry soon, quietly
		}
	}

	_onPing() {
		if (!this._awake || !this.data.loaded) return;
		this._poll();
	}

	async _poll() {
		this._pollAt = Date.now() + POLL_MS;
		try {
			let fresh = await this.data.refresh();
			await this._applyFresh(fresh);
			while (this.data.more) {
				fresh = await this.data.refresh({ minGapMs: 0 });
				await this._applyFresh(fresh);
				if (!fresh.length) break;
			}
		} catch (err) {
			console.warn('[signature-wall] refresh failed:', err?.message);
		}
	}

	async _reload() {
		this._reloadAt = Date.now() + RELOAD_MS;
		try {
			await this.data.load();
			this._rebuild(true);
		} catch (err) {
			console.warn('[signature-wall] reload failed:', err?.message);
		}
	}

	_newest() { return this.data.recent.slice(0, NEWEST_SHOWN); }

	/** Rebuild the order and show the newest page. */
	_rebuild(fade) {
		const pages = pageCount(this.data.total);
		this._order = pageOrder(pages, Math.floor(Date.now() / 3_600_000));
		this._orderIdx = 0;
		this._showPage(0, this.data.recent.slice(0, this.data.pageSize), fade && !REDUCED_MOTION);
	}

	_showPage(page, sigs, fade) {
		const size = this.data.pageSize;
		this._page = page;
		this._slots = assignSlots(sigs, size);
		this._flipAt = Date.now() + dwellMs(page);
		this._painter.showPage({
			slots: this._slots, total: this.data.total, page,
			pages: pageCount(this.data.total), newest: this._newest(), fade,
		});
	}

	/** Land new signatures on the wall: one tile each, newest page, with a splash. */
	async _applyFresh(fresh) {
		if (!fresh?.length) {
			this._painter.touch({ total: this.data.total, pages: pageCount(this.data.total), newest: this._newest() });
			return;
		}
		const size = this.data.pageSize;
		if (this._page !== 0 || this._slots.length !== size) {
			// Off the newest page, or the density tier changed: jump to the newest
			// page so the new names get their moment.
			this._rebuild(true);
			return;
		}
		const next = assignSlots(this.data.recent.slice(0, size), size);
		const changed = diffSlots(this._slots, next);
		const newest = fresh[fresh.length - 1];
		const splashIdx = REDUCED_MOTION || fresh.length > SLOT_QUEUE_MAX ? -1 : next.findIndex((s) => s?.id === newest.id);
		this._slots = next;
		this._flipAt = Date.now() + dwellMs(0);
		this._painter.applyDiff({
			slots: next, total: this.data.total, pages: pageCount(this.data.total),
			newest: this._newest(), changed, splashIdx,
		});
	}

	async _flip() {
		if (this._flipping || this._order.length < 2) { this._flipAt = Date.now() + 4000; return; }
		this._flipping = true;
		try {
			const idx = (this._orderIdx + 1) % this._order.length;
			const page = this._order[idx];
			const sigs = await this.data.page(page);
			if (this._disposed) return;
			this._orderIdx = idx;
			this._showPage(page, sigs, !REDUCED_MOTION);
		} catch (err) {
			console.warn('[signature-wall] page flip failed:', err?.message);
			this._flipAt = Date.now() + 8000;
		} finally {
			this._flipping = false;
		}
	}

	// ── interaction ───────────────────────────────────────────────────────

	// SYNCHRONOUS like wheel-station.interact(): the F chain short-circuits on the
	// returned verdict, so it must answer "was I in range" immediately.
	interact() {
		if (!this._near) return false;
		if (!this._panel) this._openPanel();
		return true;
	}

	_openPanel() {
		const signedIn = !!this.getPlayPass?.();
		const prev = document.activeElement;
		const nameInput = el('input', {
			class: 'sw-input', id: 'sw-name', type: 'text', maxlength: '24', autocomplete: 'nickname',
			spellcheck: 'false', placeholder: 'Your name', value: this._prefill(),
		});
		const lineInput = el('textarea', {
			class: 'sw-input sw-line', id: 'sw-line', maxlength: '80', rows: '2',
			placeholder: 'Say something (optional)', spellcheck: 'true',
		});
		const count = el('span', { class: 'sw-count', 'aria-hidden': 'true', text: '0/80' });
		lineInput.addEventListener('input', () => { count.textContent = `${Array.from(lineInput.value).length}/80`; });
		const status = el('p', { class: 'sw-status', role: 'alert', 'aria-live': 'assertive', hidden: true });
		const submit = el('button', { class: 'sw-btn sw-primary', type: 'submit', text: 'Sign the wall' });
		const nudge = el('p', {
			class: 'sw-nudge',
			text: signedIn
				? 'You are signed in. Your signature is permanent and tied to your wallet (never shown).'
				: 'Signing as a guest: one signature per session. Sign in with your wallet to make it permanent.',
		});
		const form = el('form', { class: 'sw-form', novalidate: '' }, [
			el('label', { class: 'sw-label', for: 'sw-name', text: 'Name' }), nameInput,
			el('div', { class: 'sw-row' }, [el('label', { class: 'sw-label', for: 'sw-line', text: 'Line' }), count]), lineInput,
			status, nudge,
			el('div', { class: 'sw-actions' }, [
				el('button', { class: 'sw-btn', type: 'button', text: 'Cancel', onclick: () => this._closePanel() }),
				submit,
			]),
		]);
		const title = el('h2', { class: 'sw-title', id: 'sw-title', text: 'Sign the $THREE wall' });
		const sub = el('p', { class: 'sw-sub', text: `${this.data.total.toLocaleString('en-US')} names so far. Everyone in the world sees yours the moment you sign.` });
		const body = el('div', { class: 'sw-body' }, [title, sub, form]);
		const card = el('div', { class: 'sw-card', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sw-title' }, [body]);
		const root = el('div', { class: 'sw-root' }, [
			el('div', { class: 'sw-scrim', onclick: () => this._closePanel() }), card,
		]);
		document.body.appendChild(root);
		this.btn.hidden = true;

		const onKey = (e) => {
			if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this._closePanel(); return; }
			if (e.key !== 'Tab') return;
			const focusable = [...card.querySelectorAll('button:not([hidden]), input, textarea')].filter((n) => !n.disabled);
			if (!focusable.length) return;
			const first = focusable[0];
			const last = focusable[focusable.length - 1];
			if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
			else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
		};
		document.addEventListener('keydown', onKey, true);
		this._panel = { root, onKey, prev, body, status, submit, nameInput, lineInput };

		if (this._mine) this._showSigned(this._mine, false);

		form.addEventListener('submit', (e) => {
			e.preventDefault();
			this._submit();
		});
		requestAnimationFrame(() => { root.classList.add('is-open'); (this._mine ? card : nameInput).focus?.(); });
	}

	_prefill() {
		const raw = String(this.getName?.() || '').trim();
		return /^guest-[a-z0-9]{3,6}$/i.test(raw) ? '' : Array.from(raw).slice(0, 24).join('');
	}

	_setStatus(msg, kind = 'error') {
		const s = this._panel?.status;
		if (!s) return;
		s.hidden = !msg;
		s.textContent = msg || '';
		s.dataset.kind = kind;
	}

	async _submit(asGuest = false) {
		const p = this._panel;
		if (!p || p.busy) return;
		const name = p.nameInput.value.trim();
		if (!name) {
			this._setStatus('Add a name to sign the wall.');
			p.nameInput.focus();
			return;
		}
		p.busy = true;
		p.submit.disabled = true;
		p.submit.textContent = 'Signing...';
		this._setStatus('');
		try {
			const playPass = asGuest ? '' : (this.getPlayPass?.() || '');
			const res = await this.data.sign({ name, line: p.lineInput.value.trim(), playPass });
			this._mine = res.signature;
			rememberSigned(res.signature);
			this.net?.sendSigwallPing?.();
			if (this._panel === p) this._showSigned(res.signature, true);
			// Our own tile lands immediately with the splash; everyone else gets it from the ping.
			await this._applyFresh([res.signature]);
			this.ui?.toast?.(`You are signature No. ${res.signature.no} on the $THREE wall`, 'success');
		} catch (err) {
			this._onSignError(err);
		} finally {
			p.busy = false;
			if (p.submit.isConnected) { p.submit.disabled = false; p.submit.textContent = 'Sign the wall'; }
		}
	}

	_onSignError(err) {
		const code = err instanceof WallClientError ? err.code : 'sign_failed';
		if (code === 'already_signed') {
			const ex = err.existing;
			if (ex) { this._mine = ex; rememberSigned(ex); }
			this._showSigned(ex || { name: 'you', no: 0, id: '' }, false, err.message);
			return;
		}
		if (code === 'pass_invalid') {
			this._setStatus('Your sign-in expired. Sign in again to make it permanent, or sign as a guest now.');
			this._addGuestFallback();
			return;
		}
		if (code === 'rate_limited') {
			const wait = err.retryAfter ? ` Try again in ${err.retryAfter}s.` : '';
			this._setStatus(`Too many signatures from this connection.${wait}`);
			return;
		}
		this._setStatus(err.message || 'Could not sign the wall. Try again.');
	}

	_addGuestFallback() {
		const p = this._panel;
		if (!p || p.guestBtn) return;
		p.guestBtn = el('button', { class: 'sw-btn', type: 'button', text: 'Sign as guest', onclick: () => this._submit(true) });
		p.submit.before(p.guestBtn);
	}

	/** The done / already-signed state: say who you are on the wall, and offer to share. */
	_showSigned(sig, fresh, notice = '') {
		const p = this._panel;
		if (!p) return;
		const shareUrl = sig.id ? `${location.origin}/api/play/signature-wall-og?id=${encodeURIComponent(sig.id)}` : `${location.origin}/api/play/signature-wall-og`;
		const copy = el('button', { class: 'sw-btn', type: 'button', text: 'Copy share link' });
		copy.addEventListener('click', async () => {
			try {
				await navigator.clipboard.writeText(shareUrl);
				copy.textContent = 'Link copied';
			} catch {
				copy.textContent = 'Copy failed, select the link below';
				p.linkField.select();
			}
		});
		const text = sig.no ? `I signed the $THREE wall (signature No. ${sig.no}).` : 'I signed the $THREE wall.';
		const post = el('a', {
			class: 'sw-btn', target: '_blank', rel: 'noopener noreferrer', text: 'Post on X',
			href: `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(`${location.origin}/play`)}`,
		});
		p.linkField = el('input', { class: 'sw-input sw-link', readonly: '', value: shareUrl, 'aria-label': 'Share link' });
		const heading = fresh ? 'You are on the wall.' : (notice || 'You are already on the wall.');
		const msg = sig.no ? `${sig.name}, signature No. ${sig.no}. It stays here for good.` : 'It stays here for good.';
		p.body.replaceChildren(
			el('h2', { class: 'sw-title', id: 'sw-title', text: heading }),
			el('p', { class: 'sw-sub', text: msg }),
			p.linkField,
			el('div', { class: 'sw-actions' }, [copy, post, el('button', { class: 'sw-btn sw-primary', type: 'button', text: 'Close', onclick: () => this._closePanel() })]),
		);
		p.body.querySelector('.sw-primary')?.focus();
	}

	_closePanel() {
		const p = this._panel;
		if (!p) return;
		document.removeEventListener('keydown', p.onKey, true);
		p.root.classList.remove('is-open');
		p.root.remove();
		this._panel = null;
		this.btn.hidden = !this._near;
		try { p.prev?.focus?.(); } catch { /* element gone */ }
	}

	dispose() {
		this._disposed = true;
		this._closePanel();
		this._unsub?.();
		this.btn?.remove();
		if (this._group) {
			this.scene.remove(this._group);
			this._group.traverse((n) => {
				if (n.isMesh) {
					n.geometry?.dispose?.();
					const ms = Array.isArray(n.material) ? n.material : [n.material];
					ms.forEach((m) => m?.dispose?.());
				}
			});
			this._group = null;
		}
		this._tex?.dispose();
		this._painter?.dispose();
	}
}

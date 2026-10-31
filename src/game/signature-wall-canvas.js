// Signature wall painter: composites signatures as graffiti onto one canvas that
// signature-wall.js wraps in a CanvasTexture.
//
// Three layers keep redraws incremental (nothing redraws the whole wall per signature):
//   bg     concrete, painted once
//   layer  the current page's tiles; a new signature repaints ONE tile rect
//   frame  bg + header + newest strip + layer, blitted when something changed
// Page flips crossfade for ~600ms; the new-signature ink splash animates one tile.
// Nothing here runs unless the controller calls update(), which it only does while
// a player is within reading range of the wall.

import { makeScreenCanvas } from './screen-texture.js';
import {
	CANVAS_W, CANVAS_H, HEADER_H, NEWEST_H, MARGIN, NEWEST_SHOWN,
	tileRect, newestRect,
} from './signature-wall-layout.js';
import { styleFor, rng, LINE_FONT } from './signature-wall-style.js';

const INK_OUTLINE = 'rgba(0,0,0,0.55)';
const FADE_MS = 600;
const SPLASH_MS = 760;
const MIN_FRAME_MS = 33;
const PAINT_BUDGET_MS = 6;     // max tile painting per frame while a page builds behind its crossfade

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const ease = (t) => t * t * (3 - 2 * t);

function makeCanvas() {
	return makeScreenCanvas(CANVAS_W, CANVAS_H, 1);
}

export class WallPainter {
	constructor() {
		const frame = makeCanvas();
		this.canvas = frame.canvas;
		this._ctx = frame.ctx;
		const bg = makeCanvas();
		const layer = makeCanvas();
		const prev = makeCanvas();
		this._bg = bg.canvas;
		this._layer = layer.canvas;
		this._lctx = layer.ctx;
		this._prev = prev.canvas;
		this._pctx = prev.ctx;

		this._slots = [];
		this._tierTotal = 0;
		this._total = 0;
		this._page = 0;
		this._pages = 1;
		this._newest = [];
		this._fade = null;      // { start }
		this._queue = null;     // tile indexes still to paint for a page that is fading in
		this._splash = null;    // { idx, start }
		this._dirty = true;
		this._lastFrame = 0;
		this.onFrame = null;    // called after each blit so the texture can upload

		this._paintBackground(bg.ctx);
		this._compose(0);
	}

	// ── public ────────────────────────────────────────────────────────────

	/** Replace the whole page (initial load, tier change, page flip). */
	showPage({ slots, total, page, pages, newest, fade }) {
		if (fade) {
			this._pctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
			this._pctx.drawImage(this._layer, 0, 0);
			this._fade = { start: performance.now() };
		} else {
			this._fade = null;
		}
		this._slots = slots;
		this._tierTotal = total;
		this._total = total;
		this._page = page;
		this._pages = pages;
		this._newest = newest;
		this._splash = null;
		this._lctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
		if (fade) {
			// A dense page is 128 tiles: painting them in one go is a visible hitch.
			// The crossfade hides the build, so spread it across frames instead.
			this._queue = Array.from({ length: slots.length }, (_, i) => i);
		} else {
			this._queue = null;
			for (let i = 0; i < slots.length; i++) this._paintTile(i);
		}
		this._dirty = true;
	}

	/**
	 * Incremental update: only the tiles in `changed` repaint. `splashIdx` (one of
	 * them) animates the ink splash.
	 */
	applyDiff({ slots, total, pages, newest, changed, splashIdx = -1 }) {
		const prevFirstEmpty = this._slots.findIndex((x) => !x);
		this._slots = slots;
		this._total = total;
		this._pages = pages;
		this._newest = newest;
		// The "press F" hint lives on the first empty tile, which moves (and changes
		// wording at the first signature), so repaint where it was and where it is now.
		const repaint = new Set(changed);
		if (prevFirstEmpty >= 0) repaint.add(prevFirstEmpty);
		const nextFirstEmpty = slots.findIndex((x) => !x);
		if (nextFirstEmpty >= 0) repaint.add(nextFirstEmpty);
		for (const i of repaint) {
			if (i === splashIdx) continue;
			this._paintTile(i);
		}
		if (splashIdx >= 0) {
			if (this._splash && this._splash.idx !== splashIdx) this._paintTile(this._splash.idx);
			this._splash = { idx: splashIdx, start: performance.now() };
		}
		this._dirty = true;
	}

	/** Header/newest-strip-only change (a total moved without changing this page). */
	touch({ total, pages, newest }) {
		this._total = total;
		this._pages = pages;
		this._newest = newest;
		this._dirty = true;
	}

	/** Advance animations and blit when dirty. Returns true while still animating. */
	update(now = performance.now()) {
		let animating = false;
		if (this._queue) {
			const t0 = performance.now();
			do {
				const i = this._queue.shift();
				if (i === undefined) break;
				this._paintTile(i);
			} while (this._queue.length && performance.now() - t0 < PAINT_BUDGET_MS);
			if (!this._queue.length) this._queue = null;
			this._dirty = true;
			animating = true;
		}
		if (this._splash) {
			const t = (now - this._splash.start) / SPLASH_MS;
			this._paintTile(this._splash.idx, clamp(t, 0, 1));
			this._dirty = true;
			if (t >= 1) { this._paintTile(this._splash.idx); this._splash = null; } else animating = true;
		}
		let fadeT = 1;
		if (this._fade) {
			fadeT = clamp((now - this._fade.start) / FADE_MS, 0, 1);
			this._dirty = true;
			if (fadeT >= 1) this._fade = null; else animating = true;
		}
		if (this._dirty && now - this._lastFrame >= MIN_FRAME_MS) {
			this._lastFrame = now;
			this._compose(fadeT);
			this._dirty = false;
		}
		return animating || this._dirty;
	}

	dispose() {
		this._queue = null;
		for (const c of [this.canvas, this._bg, this._layer, this._prev]) { c.width = 1; c.height = 1; }
	}

	// ── compositing ───────────────────────────────────────────────────────

	_compose(fadeT) {
		const ctx = this._ctx;
		ctx.globalAlpha = 1;
		ctx.drawImage(this._bg, 0, 0);
		this._paintHeader(ctx);
		this._paintNewest(ctx);
		if (this._fade) {
			ctx.globalAlpha = 1 - ease(fadeT);
			ctx.drawImage(this._prev, 0, 0);
			ctx.globalAlpha = ease(fadeT);
			ctx.drawImage(this._layer, 0, 0);
			ctx.globalAlpha = 1;
		} else {
			ctx.drawImage(this._layer, 0, 0);
		}
		this.onFrame?.();
	}

	_paintBackground(ctx) {
		const g = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
		g.addColorStop(0, '#23262e');
		g.addColorStop(1, '#171a20');
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
		// Concrete block seams.
		ctx.strokeStyle = 'rgba(0,0,0,0.28)';
		ctx.lineWidth = 3;
		const bh = 86;
		for (let y = HEADER_H; y < CANVAS_H; y += bh) {
			ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CANVAS_W, y); ctx.stroke();
			const off = ((y - HEADER_H) / bh) % 2 ? 0 : 128;
			for (let x = off; x < CANVAS_W; x += 256) {
				ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y + bh); ctx.stroke();
			}
		}
		// Grain.
		const r = rng(0x5167);
		for (let i = 0; i < 9000; i++) {
			ctx.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.035)' : 'rgba(0,0,0,0.08)';
			ctx.fillRect(r() * CANVAS_W, r() * CANVAS_H, 2 + r() * 3, 2 + r() * 3);
		}
		// Vignette.
		const v = ctx.createRadialGradient(CANVAS_W / 2, CANVAS_H / 2, CANVAS_H * 0.35, CANVAS_W / 2, CANVAS_H / 2, CANVAS_W * 0.62);
		v.addColorStop(0, 'rgba(0,0,0,0)');
		v.addColorStop(1, 'rgba(0,0,0,0.45)');
		ctx.fillStyle = v;
		ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
	}

	_paintHeader(ctx) {
		ctx.fillStyle = '#0b0d12';
		ctx.fillRect(0, 0, CANVAS_W, HEADER_H);
		ctx.fillStyle = '#ffe14d';
		ctx.fillRect(0, HEADER_H - 6, CANVAS_W, 6);
		ctx.textBaseline = 'middle';
		ctx.textAlign = 'left';
		ctx.fillStyle = '#f4f4f0';
		ctx.font = '900 64px Impact, "Arial Black", sans-serif';
		ctx.fillText('THE $THREE WALL', MARGIN + 16, HEADER_H / 2 - 4);
		ctx.textAlign = 'right';
		ctx.fillStyle = '#ffe14d';
		ctx.font = '900 70px Impact, "Arial Black", sans-serif';
		const n = this._total.toLocaleString('en-US');
		ctx.fillText(`${n} SIGNED`, CANVAS_W - MARGIN - 16, HEADER_H / 2 - 4);
		if (this._pages > 1) {
			ctx.textAlign = 'center';
			ctx.fillStyle = 'rgba(244,244,240,0.6)';
			ctx.font = '700 30px "Trebuchet MS", Verdana, sans-serif';
			ctx.fillText(`PAGE ${this._page + 1} OF ${this._pages}`, CANVAS_W / 2 + 60, HEADER_H / 2 - 4);
		}
	}

	_paintNewest(ctx) {
		ctx.fillStyle = 'rgba(8,9,13,0.82)';
		ctx.fillRect(0, HEADER_H, CANVAS_W, NEWEST_H);
		ctx.fillStyle = 'rgba(255,225,77,0.25)';
		ctx.fillRect(0, HEADER_H + NEWEST_H - 3, CANVAS_W, 3);
		const shown = this._newest.slice(0, NEWEST_SHOWN);
		if (!shown.length) return;
		shown.forEach((sig, i) => {
			const rect = newestRect(i);
			ctx.save();
			ctx.beginPath();
			ctx.rect(rect.x, rect.y, rect.w, rect.h);
			ctx.clip();
			this._drawSignature(ctx, sig, { x: rect.x + 8, y: rect.y + 22, w: rect.w - 16, h: rect.h - 28 }, 1, i === 0 ? 1.0 : 0.92);
			ctx.restore();
			ctx.fillStyle = i === 0 ? '#ffe14d' : 'rgba(255,225,77,0.55)';
			ctx.font = '900 20px "Trebuchet MS", Verdana, sans-serif';
			ctx.textAlign = 'left';
			ctx.textBaseline = 'top';
			ctx.fillText(i === 0 ? 'NEWEST' : 'RECENT', rect.x + 12, rect.y + 6);
		});
	}

	// ── tiles ─────────────────────────────────────────────────────────────

	_paintTile(idx, splashT = 1) {
		const ctx = this._lctx;
		const rect = tileRect(idx, this._tierTotal);
		const sig = this._slots[idx];
		ctx.save();
		ctx.beginPath();
		ctx.rect(rect.x, rect.y, rect.w, rect.h);
		ctx.clip();
		ctx.clearRect(rect.x, rect.y, rect.w, rect.h);
		if (sig) {
			if (splashT < 1) this._paintSplash(ctx, sig, rect, splashT);
			const textAlpha = splashT < 1 ? ease(clamp((splashT - 0.3) / 0.7, 0, 1)) : 1;
			this._drawSignature(ctx, sig, { x: rect.x + 6, y: rect.y + 6, w: rect.w - 12, h: rect.h - 12 }, textAlpha, 1);
			if (splashT >= 1) this._paintSpeckles(ctx, sig, rect);
		} else {
			this._paintEmpty(ctx, idx, rect);
		}
		ctx.restore();
	}

	_paintEmpty(ctx, idx, rect) {
		const firstEmpty = this._slots.findIndex((s) => !s) === idx;
		ctx.strokeStyle = 'rgba(244,244,240,0.10)';
		ctx.lineWidth = 2;
		ctx.setLineDash([10, 10]);
		ctx.strokeRect(rect.x + 8, rect.y + 8, rect.w - 16, rect.h - 16);
		ctx.setLineDash([]);
		if (firstEmpty && rect.h > 70) {
			ctx.fillStyle = 'rgba(244,244,240,0.55)';
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			const size = clamp(rect.h * 0.14, 12, 34);
			ctx.font = `700 ${size}px "Trebuchet MS", Verdana, sans-serif`;
			const msg = this._total === 0 ? 'Be the first. Press F.' : 'Your name here. Press F.';
			ctx.fillText(msg, rect.x + rect.w / 2, rect.y + rect.h / 2, rect.w - 24);
		}
	}

	_paintSplash(ctx, sig, rect, t) {
		const st = styleFor(sig);
		const r = rng(st.splat);
		const cx = rect.x + rect.w / 2;
		const cy = rect.y + rect.h / 2;
		const maxR = Math.hypot(rect.w, rect.h) * 0.46;
		const e = 1 - (1 - t) * (1 - t);
		ctx.globalAlpha = 1 - t * 0.55;
		ctx.fillStyle = st.ink;
		ctx.beginPath();
		ctx.arc(cx, cy, maxR * 0.5 * e, 0, Math.PI * 2);
		ctx.fill();
		for (let i = 0; i < 18; i++) {
			const a = r() * Math.PI * 2;
			const d = (0.25 + r() * 0.75) * maxR * e;
			const rad = (3 + r() * 14) * (0.4 + e * 0.6);
			ctx.beginPath();
			ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, rad, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.globalAlpha = 1;
	}

	_paintSpeckles(ctx, sig, rect) {
		const st = styleFor(sig);
		const r = rng(st.splat ^ 0x9e37);
		ctx.fillStyle = st.ink;
		ctx.globalAlpha = 0.5;
		for (let i = 0; i < 7; i++) {
			ctx.beginPath();
			ctx.arc(rect.x + 8 + r() * (rect.w - 16), rect.y + 8 + r() * (rect.h - 16), 1 + r() * 2.6, 0, Math.PI * 2);
			ctx.fill();
		}
		ctx.globalAlpha = 1;
	}

	/** Draw one signature's name and line into `box`. */
	_drawSignature(ctx, sig, box, alpha, boost) {
		const st = styleFor(sig);
		const hasLine = !!sig.line;
		const nameH = box.h * (hasLine ? 0.58 : 0.8);
		const maxW = box.w * 0.92;
		const fontOf = (px) => `${st.font.weight} ${px}px ${st.font.stack}`;

		ctx.save();
		ctx.globalAlpha = alpha;
		ctx.translate(box.x + box.w / 2, box.y + box.h * (hasLine ? 0.38 : 0.5));
		ctx.rotate(st.rot);
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.lineJoin = 'round';

		const lines = this._fitName(ctx, sig.name, maxW, nameH, st, fontOf);
		const size = lines.size * st.scale * boost;
		ctx.font = fontOf(size);
		const lh = size * 1.02;
		const top = -((lines.text.length - 1) * lh) / 2;
		lines.text.forEach((text, i) => {
			const y = top + i * lh;
			ctx.lineWidth = Math.max(2, size * 0.14);
			ctx.strokeStyle = INK_OUTLINE;
			ctx.strokeText(text, 0, y, maxW);
			ctx.fillStyle = st.ink;
			ctx.shadowColor = st.ink;
			ctx.shadowBlur = size * 0.18;
			ctx.fillText(text, 0, y, maxW);
			ctx.shadowBlur = 0;
		});
		const blockBottom = top + (lines.text.length - 1) * lh + size * 0.55;
		if (size > 34) this._paintDrips(ctx, sig, st, maxW, blockBottom, size);
		if (st.underline && size > 20) {
			ctx.strokeStyle = st.ink2;
			ctx.lineWidth = Math.max(2, size * 0.07);
			ctx.lineCap = 'round';
			const w = Math.min(maxW * 0.8, size * 0.55 * Math.max(...lines.text.map((t) => t.length)));
			ctx.beginPath();
			ctx.moveTo(-w / 2, blockBottom + 2);
			ctx.quadraticCurveTo(0, blockBottom + size * 0.16, w / 2, blockBottom - 2);
			ctx.stroke();
		}
		ctx.restore();

		if (hasLine) {
			ctx.save();
			ctx.globalAlpha = alpha * 0.95;
			const lsize = clamp(box.h * 0.15, 11, 34) * Math.min(1.15, boost);
			ctx.font = `700 ${lsize}px ${LINE_FONT}`;
			ctx.translate(box.x + box.w / 2, box.y + box.h * 0.80);
			ctx.rotate(st.lineRot);
			ctx.textAlign = 'center';
			ctx.textBaseline = 'middle';
			const wrapped = this._wrap(ctx, sig.line, box.w * 0.94, box.h > 150 ? 3 : 2);
			const llh = lsize * 1.12;
			const ltop = -((wrapped.length - 1) * llh) / 2 - (wrapped.length > 1 ? lsize * 0.35 : 0);
			wrapped.forEach((t, i) => {
				ctx.lineWidth = Math.max(2, lsize * 0.2);
				ctx.strokeStyle = INK_OUTLINE;
				ctx.lineJoin = 'round';
				ctx.strokeText(t, 0, ltop + i * llh, box.w * 0.94);
				ctx.fillStyle = st.ink2;
				ctx.fillText(t, 0, ltop + i * llh, box.w * 0.94);
			});
			ctx.restore();
		}

		if (sig.verified) this._paintMark(ctx, box, st, alpha);
	}

	/** A small gold star: this signature belongs to a signed-in wallet and is permanent. */
	_paintMark(ctx, box, st, alpha) {
		const r = clamp(box.h * 0.07, 4, 11);
		const cx = box.x + box.w - r - 2;
		const cy = box.y + r + 2;
		ctx.save();
		ctx.globalAlpha = alpha * 0.9;
		ctx.fillStyle = '#ffe14d';
		ctx.beginPath();
		for (let i = 0; i < 10; i++) {
			const a = -Math.PI / 2 + (i * Math.PI) / 5;
			const rad = i % 2 ? r * 0.45 : r;
			const x = cx + Math.cos(a) * rad;
			const y = cy + Math.sin(a) * rad;
			if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
		}
		ctx.closePath();
		ctx.fill();
		ctx.restore();
	}

	_paintDrips(ctx, sig, st, maxW, y0, size) {
		const r = rng(st.splat ^ 0x51ed);
		const n = 1 + Math.floor(r() * 2);
		ctx.strokeStyle = st.ink;
		ctx.lineCap = 'round';
		ctx.globalAlpha *= 0.85;
		for (let i = 0; i < n; i++) {
			const x = (r() - 0.5) * maxW * 0.6;
			const len = size * (0.25 + r() * 0.35);
			ctx.lineWidth = Math.max(2, size * 0.05);
			ctx.beginPath();
			ctx.moveTo(x, y0 - size * 0.12);
			ctx.lineTo(x, y0 - size * 0.12 + len);
			ctx.stroke();
			ctx.beginPath();
			ctx.arc(x, y0 - size * 0.12 + len + ctx.lineWidth * 0.2, ctx.lineWidth * 0.9, 0, Math.PI * 2);
			ctx.fillStyle = st.ink;
			ctx.fill();
		}
	}

	/** Choose one or two lines for the name and the largest size that fits. */
	_fitName(ctx, name, maxW, maxH, st, fontOf) {
		const measure = (text) => {
			ctx.font = fontOf(100);
			return Math.max(1, ctx.measureText(text).width);
		};
		const cap = Math.min(maxH, 110);
		const one = { text: [name], size: Math.min(cap, (100 * maxW) / measure(name)) };
		const mid = name.length / 2;
		let cut = -1;
		for (let i = 0; i < name.length; i++) {
			if (name[i] === ' ' && (cut < 0 || Math.abs(i - mid) < Math.abs(cut - mid))) cut = i;
		}
		let best = one;
		if (cut > 0) {
			const a = name.slice(0, cut);
			const b = name.slice(cut + 1);
			const wide = Math.max(measure(a), measure(b));
			const size = Math.min(cap / 2 / 1.02, (100 * maxW) / wide);
			if (size > one.size * 1.15) best = { text: [a, b], size };
		}
		best.size = Math.max(9, best.size);
		return best;
	}

	/** Greedy word wrap to `maxLines`, ellipsising the tail. */
	_wrap(ctx, text, maxW, maxLines) {
		const words = text.split(' ');
		const lines = [];
		let cur = '';
		for (const w of words) {
			const test = cur ? `${cur} ${w}` : w;
			if (ctx.measureText(test).width <= maxW || !cur) cur = test;
			else { lines.push(cur); cur = w; }
		}
		if (cur) lines.push(cur);
		if (lines.length > maxLines) {
			const kept = lines.slice(0, maxLines);
			let last = kept[maxLines - 1];
			while (last.length > 1 && ctx.measureText(`${last}...`).width > maxW) last = last.slice(0, -1);
			kept[maxLines - 1] = `${last}...`;
			return kept;
		}
		return lines;
	}
}


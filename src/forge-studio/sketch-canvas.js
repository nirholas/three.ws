/**
 * Sketch Canvas - an in-browser freehand drawing modal for sketch → 3D.
 *
 * The Forge sketch pane previously only accepted an *uploaded photo* of a
 * drawing. This gives users a real drawing surface - mouse, touch, or stylus
 * - right in the browser, so "sketch → 3D" doesn't require a scanner, a
 * camera, or a piece of paper. The exported PNG is treated exactly like an
 * uploaded reference photo: it goes through the same `presignAndPut` upload
 * path and the same live image→3D reconstruction pipeline (forge.js decides
 * the engine - TRELLIS/Hunyuan today; TripoSG-scribble once that self-hosted
 * lane is configured). No new backend surface, no new generation path -
 * purely a new way to produce the reference image.
 *
 * Usage:
 *   import { openSketchCanvas } from './sketch-canvas.js';
 *   const file = await openSketchCanvas(); // File(image/png) | null (cancelled)
 *
 * Privacy: the drawing exists only in this in-memory <canvas> until the user
 * clicks "Use sketch" - nothing is uploaded, logged, or persisted while
 * drawing, and cancelling discards it with zero network activity.
 */

import { assessSketch, createUndoStack, sampleSource, toCanvasPoint } from './sketch-guard.js';

const CANVAS_SIZE = 768; // logical px - scaled by devicePixelRatio for crispness
const BRUSH_SIZES = [
	{ id: 'fine', label: 'Fine', width: 3 },
	{ id: 'medium', label: 'Medium', width: 6 },
	{ id: 'bold', label: 'Bold', width: 12 },
];

let _stylesInjected = false;

/**
 * Open the drawing modal. Resolves with a `File` (image/png, white
 * background, black strokes) once the user clicks "Use sketch", or `null` if
 * they cancel / close without drawing anything.
 * @returns {Promise<File|null>}
 */
export function openSketchCanvas() {
	return new Promise((resolve) => {
		const modal = new SketchCanvasModal((file) => resolve(file));
		modal.mount();
	});
}

class SketchCanvasModal {
	constructor(onDone) {
		this.onDone = onDone;
		this.root = null;
		this.canvas = null;
		this.ctx = null;
		this.brush = BRUSH_SIZES[1];
		this.drawing = false;
		this.hasStrokes = false;
		this.history = createUndoStack(20); // { image, hasStrokes } snapshots for undo
		this.last = null;
		this.opener = null;
	}

	mount() {
		injectStyles();
		this.opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		this.root = document.createElement('div');
		this.root.className = 'sk-root';
		this.root.innerHTML = `
			<div class="sk-backdrop"></div>
			<div class="sk-panel" role="dialog" aria-modal="true" aria-label="Draw a sketch">
				<div class="sk-header">
					<h2 class="sk-title">Draw your sketch</h2>
					<button type="button" class="sk-close" aria-label="Cancel and close">
						<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
					</button>
				</div>
				<p class="sk-hint">Draw a single object with a simple outline, with some space around it. Dark strokes on the light background work best. Prefer paper? Close this and upload a photo of your drawing instead.</p>
				<div class="sk-stage">
					<canvas class="sk-canvas" width="${CANVAS_SIZE}" height="${CANVAS_SIZE}" aria-label="Drawing surface - draw with mouse, touch, or stylus"></canvas>
					<p class="sk-empty-overlay" data-sk-empty>Start drawing here</p>
				</div>
				<p class="sk-notice" role="alert" data-sk-notice hidden></p>
				<div class="sk-toolbar">
					<div class="sk-brushes" role="group" aria-label="Brush size">
						${BRUSH_SIZES.map(
							(b) => `<button type="button" class="sk-brush" data-brush="${b.id}" aria-pressed="${b.id === this.brush.id}">${b.label}</button>`,
						).join('')}
					</div>
					<div class="sk-actions">
						<button type="button" class="sk-tool-btn" data-sk-undo disabled>Undo</button>
						<button type="button" class="sk-tool-btn" data-sk-clear disabled>Clear</button>
					</div>
				</div>
				<div class="sk-footer">
					<button type="button" class="sk-btn sk-btn-ghost" data-sk-cancel>Cancel</button>
					<button type="button" class="sk-btn sk-btn-primary" data-sk-done disabled>Use sketch</button>
				</div>
			</div>
		`;
		document.body.appendChild(this.root);
		requestAnimationFrame(() => {
			this.root.classList.add('sk-open');
			this.root.querySelector('.sk-brush[aria-pressed="true"]')?.focus();
		});

		this.canvas = this.root.querySelector('.sk-canvas');
		this._setupCanvas();
		this._wire();
	}

	_setupCanvas() {
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		this.canvas.width = CANVAS_SIZE * dpr;
		this.canvas.height = CANVAS_SIZE * dpr;
		this.canvas.style.width = `${CANVAS_SIZE}px`;
		this.canvas.style.height = `${CANVAS_SIZE}px`;
		const ctx = this.canvas.getContext('2d');
		ctx.scale(dpr, dpr);
		ctx.lineJoin = 'round';
		ctx.lineCap = 'round';
		ctx.strokeStyle = '#111318';
		ctx.lineWidth = this.brush.width;
		this.ctx = ctx;
		this._fillWhite();
	}

	_fillWhite() {
		this.ctx.save();
		this.ctx.fillStyle = '#ffffff';
		this.ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
		this.ctx.restore();
	}

	_wire() {
		const canvas = this.canvas;
		const pos = (e) =>
			toCanvasPoint(e.clientX, e.clientY, canvas.getBoundingClientRect(), CANVAS_SIZE);

		const start = (e) => {
			e.preventDefault();
			const at = pos(e);
			if (!at) return;
			canvas.setPointerCapture?.(e.pointerId);
			this._pushHistory();
			this._hideNotice();
			this.drawing = true;
			this.last = at;
			// A dot on tap-without-drag still counts as a stroke.
			this.ctx.beginPath();
			this.ctx.arc(this.last.x, this.last.y, this.brush.width / 2, 0, Math.PI * 2);
			this.ctx.fillStyle = this.ctx.strokeStyle;
			this.ctx.fill();
			this._markDirty();
		};
		const move = (e) => {
			if (!this.drawing) return;
			e.preventDefault();
			const p = pos(e);
			if (!p) return;
			this.ctx.beginPath();
			this.ctx.moveTo(this.last.x, this.last.y);
			this.ctx.lineTo(p.x, p.y);
			this.ctx.stroke();
			this.last = p;
		};
		const end = () => {
			this.drawing = false;
			this.last = null;
		};

		canvas.addEventListener('pointerdown', start);
		canvas.addEventListener('pointermove', move);
		canvas.addEventListener('pointerup', end);
		canvas.addEventListener('pointerleave', end);
		canvas.addEventListener('pointercancel', end);
		// Prevent the page from scrolling while drawing with touch.
		canvas.style.touchAction = 'none';

		this.root.querySelectorAll('.sk-brush').forEach((btn) => {
			btn.addEventListener('click', () => {
				const b = BRUSH_SIZES.find((x) => x.id === btn.dataset.brush);
				if (!b) return;
				this.brush = b;
				this.ctx.lineWidth = b.width;
				this.root.querySelectorAll('.sk-brush').forEach((el) => el.setAttribute('aria-pressed', String(el === btn)));
			});
		});

		this.root.querySelector('[data-sk-undo]').addEventListener('click', () => this._undo());
		this.root.querySelector('[data-sk-clear]').addEventListener('click', () => this._clear());
		this.root.querySelector('[data-sk-cancel]').addEventListener('click', () => this._close(null));
		this.root.querySelector('.sk-close').addEventListener('click', () => this._close(null));
		this.root.querySelector('.sk-backdrop').addEventListener('click', () => this._close(null));
		this.root.querySelector('[data-sk-done]').addEventListener('click', () => this._finish());

		this._escHandler = (e) => {
			if (e.key === 'Escape') {
				this._close(null);
				return;
			}
			if (e.key === 'Tab') this._trapTab(e);
		};
		document.addEventListener('keydown', this._escHandler);
	}

	_snapshot() {
		const dpr = Math.min(window.devicePixelRatio || 1, 2);
		try {
			return {
				image: this.ctx.getImageData(0, 0, CANVAS_SIZE * dpr, CANVAS_SIZE * dpr),
				hasStrokes: this.hasStrokes,
			};
		} catch {
			// getImageData can throw on a tainted canvas: never the case here
			// (no external images are drawn in), but fail safe rather than crash.
			return null;
		}
	}

	_pushHistory() {
		const snapshot = this._snapshot();
		if (snapshot) this.history.push(snapshot);
	}

	_undo() {
		const snapshot = this.history.pop();
		if (!snapshot) return;
		this.ctx.putImageData(snapshot.image, 0, 0);
		this.hasStrokes = snapshot.hasStrokes;
		this._hideNotice();
		this._syncButtons();
	}

	_clear() {
		this._pushHistory();
		this._fillWhite();
		this.hasStrokes = false;
		this._hideNotice();
		this._syncButtons();
	}

	_markDirty() {
		if (!this.hasStrokes) {
			this.hasStrokes = true;
			this._syncButtons();
		}
	}

	_syncButtons() {
		const empty = this.root.querySelector('[data-sk-empty]');
		if (empty) empty.classList.toggle('is-hidden', this.hasStrokes);
		this.root.querySelector('[data-sk-done]').disabled = !this.hasStrokes;
		this.root.querySelector('[data-sk-undo]').disabled = this.history.size === 0;
		this.root.querySelector('[data-sk-clear]').disabled = !this.hasStrokes;
	}

	async _finish() {
		if (!this.hasStrokes) return;
		// Read the drawing the way the worker will, before anything is uploaded: a
		// dot, or a canvas scribbled edge to edge, would cost a GPU slot and return
		// a blob. The panel stays open so the user can fix the drawing.
		const verdict = assessSketch(sampleSource(this.canvas));
		if (!verdict.ok && verdict.code !== 'unreadable') {
			this._showNotice(verdict.message);
			return;
		}
		const blob = await new Promise((resolve) => this.canvas.toBlob(resolve, 'image/png'));
		if (!blob) {
			this._showNotice('Your browser could not save the drawing. Try again, or upload a photo of it instead.');
			return;
		}
		const file = new File([blob], `sketch-${Date.now()}.png`, { type: 'image/png' });
		this._close(file);
	}

	_showNotice(message) {
		const el = this.root.querySelector('[data-sk-notice]');
		el.textContent = message;
		el.hidden = false;
	}

	_hideNotice() {
		const el = this.root.querySelector('[data-sk-notice]');
		if (el && !el.hidden) {
			el.hidden = true;
			el.textContent = '';
		}
	}

	_trapTab(e) {
		const focusable = [...this.root.querySelectorAll('button:not(:disabled)')];
		if (!focusable.length) return;
		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		const active = document.activeElement;
		if (e.shiftKey && (active === first || !this.root.contains(active))) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && (active === last || !this.root.contains(active))) {
			e.preventDefault();
			first.focus();
		}
	}

	_close(result) {
		document.removeEventListener('keydown', this._escHandler);
		this.root.classList.remove('sk-open');
		setTimeout(() => this.root?.remove(), 180);
		this.opener?.focus?.();
		this.onDone(result);
	}
}

function injectStyles() {
	if (_stylesInjected) return;
	_stylesInjected = true;
	const style = document.createElement('style');
	style.textContent = `
		.sk-root { position: fixed; inset: 0; z-index: 2000; opacity: 0; transition: opacity .18s ease; pointer-events: none; }
		.sk-root.sk-open { opacity: 1; pointer-events: auto; }
		.sk-backdrop { position: absolute; inset: 0; background: rgba(8, 10, 16, .68); backdrop-filter: blur(4px); }
		.sk-panel {
			position: relative; max-width: 560px; width: min(92vw, 560px);
			margin: 4vh auto; background: var(--surface, #16181f); color: var(--text, #f1f2f6);
			border: 1px solid var(--border, rgba(255,255,255,.1)); border-radius: 16px;
			padding: 20px; display: flex; flex-direction: column; gap: 12px;
			box-shadow: 0 24px 60px rgba(0,0,0,.45);
		}
		.sk-header { display: flex; align-items: center; justify-content: space-between; }
		.sk-title { font-size: 1.05rem; font-weight: 650; margin: 0; }
		.sk-close { background: transparent; border: none; color: inherit; opacity: .7; cursor: pointer; padding: 4px; border-radius: 8px; }
		.sk-close:hover { opacity: 1; background: rgba(255,255,255,.08); }
		.sk-hint { font-size: .84rem; opacity: .68; margin: 0; line-height: 1.4; }
		.sk-stage { position: relative; align-self: center; border-radius: 12px; overflow: hidden; border: 1px solid rgba(255,255,255,.14); touch-action: none; }
		.sk-canvas { display: block; max-width: 100%; height: auto; cursor: crosshair; background: #fff; }
		.sk-empty-overlay {
			position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
			color: rgba(20,20,26,.32); font-size: .95rem; pointer-events: none; margin: 0; font-weight: 600;
		}
		.sk-empty-overlay.is-hidden { display: none; }
		.sk-notice {
			margin: 0; padding: 10px 12px; border-radius: 10px; font-size: .84rem; line-height: 1.4;
			background: rgba(255, 176, 64, .12); border: 1px solid rgba(255, 176, 64, .45); color: inherit;
		}
		.sk-notice[hidden] { display: none; }
		.sk-brush:focus-visible, .sk-tool-btn:focus-visible, .sk-btn:focus-visible, .sk-close:focus-visible {
			outline: 2px solid var(--accent, #6c8cff); outline-offset: 2px;
		}
		.sk-brush:active, .sk-tool-btn:active:not(:disabled), .sk-btn:active:not(:disabled) { transform: translateY(1px); }
		.sk-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
		.sk-brushes, .sk-actions { display: flex; gap: 6px; }
		.sk-brush, .sk-tool-btn {
			background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12); color: inherit;
			border-radius: 8px; padding: 6px 12px; font-size: .8rem; cursor: pointer; transition: background .15s ease;
		}
		.sk-brush:hover, .sk-tool-btn:hover:not(:disabled) { background: rgba(255,255,255,.14); }
		.sk-brush[aria-pressed='true'] { background: var(--accent, #6c8cff); border-color: var(--accent, #6c8cff); color: #0b0d14; }
		.sk-tool-btn:disabled { opacity: .35; cursor: not-allowed; }
		.sk-footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 4px; }
		.sk-btn { border-radius: 10px; padding: 9px 18px; font-size: .88rem; font-weight: 600; cursor: pointer; border: 1px solid transparent; }
		.sk-btn-ghost { background: transparent; border-color: rgba(255,255,255,.16); color: inherit; }
		.sk-btn-ghost:hover { background: rgba(255,255,255,.08); }
		.sk-btn-primary { background: var(--accent, #6c8cff); color: #0b0d14; }
		.sk-btn-primary:hover:not(:disabled) { filter: brightness(1.08); }
		.sk-btn-primary:disabled { opacity: .4; cursor: not-allowed; }
		@media (max-width: 480px) {
			.sk-panel { margin: 2vh auto; padding: 14px; }
			.sk-stage { width: 100%; }
			.sk-canvas { width: 100% !important; height: auto !important; }
		}
	`;
	document.head.appendChild(style);
}

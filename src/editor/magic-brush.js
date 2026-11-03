/**
 * MagicBrush — local region retexturing.
 *
 * Paint a mask directly on the model surface, type a prompt (and/or pick a
 * colour), and only that region of the texture is repainted by SDXL inpainting —
 * the rest of the surface is preserved pixel-for-pixel and the seam is feathered
 * invisible. Passes compose: each Apply operates on the latest texture.
 *
 * Wiring (see editor/index.js):
 *   this.magicBrush = new MagicBrush(viewer, session, this);
 *   this.magicBrush.attach();              // adds the GUI toggle + key [B]
 *   this.magicBrush.rebuild();             // on every onContentChanged
 *
 * Surface selection → UV mask:
 *   We raycast the pointer onto the target mesh and stamp the hit's interpolated
 *   UV into an offscreen mask canvas. The mask is in the model's own UV layout
 *   (glTF convention: row 0 = top = v 0, flipY=false), so the worker can
 *   composite it straight onto the baseColour atlas with no remapping.
 */
import { Raycaster, Vector2, CanvasTexture, SRGBColorSpace } from 'three';
import { log } from '../shared/log.js';

const TEX = 1024; // mask + preview working resolution (UV space)
const POLL_MS = 2500;
const HIGHLIGHT = '#ff2da6';

let _styleInjected = false;
function injectStyles() {
	if (_styleInjected || typeof document === 'undefined') return;
	_styleInjected = true;
	const css = `
.mb-panel{position:absolute;right:16px;bottom:16px;z-index:30;width:300px;
  font:13px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#e8e8ec;
  background:rgba(18,18,22,.92);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,.1);
  border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.5);overflow:hidden;
  opacity:0;transform:translateY(8px);transition:opacity .18s ease,transform .18s ease}
.mb-panel.mb-open{opacity:1;transform:translateY(0)}
.mb-head{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid rgba(255,255,255,.08)}
.mb-head h3{margin:0;font-size:13px;font-weight:650;letter-spacing:.2px;flex:1}
.mb-dot{width:8px;height:8px;border-radius:50%;background:${HIGHLIGHT};box-shadow:0 0 8px ${HIGHLIGHT}}
.mb-x{all:unset;cursor:pointer;color:#9a9aa5;font-size:16px;line-height:1;padding:2px 4px;border-radius:6px}
.mb-x:hover{color:#fff;background:rgba(255,255,255,.08)}
.mb-x:focus-visible{outline:2px solid ${HIGHLIGHT};outline-offset:1px}
.mb-body{padding:14px;display:flex;flex-direction:column;gap:12px}
.mb-row{display:flex;flex-direction:column;gap:6px}
.mb-row label{font-size:11px;font-weight:600;color:#a8a8b4;text-transform:uppercase;letter-spacing:.4px}
.mb-hint{font-size:12px;color:#9a9aa5;margin:0}
.mb-slide{display:flex;align-items:center;gap:10px}
.mb-slide input[type=range]{flex:1;accent-color:${HIGHLIGHT}}
.mb-slide .mb-val{min-width:34px;text-align:right;font-variant-numeric:tabular-nums;color:#cfcfd6}
.mb-seg{display:flex;gap:6px}
.mb-seg button{flex:1;all:unset;text-align:center;cursor:pointer;padding:7px 0;border-radius:8px;
  background:rgba(255,255,255,.06);border:1px solid transparent;font-size:12px;font-weight:600;transition:background .12s}
.mb-seg button:hover{background:rgba(255,255,255,.12)}
.mb-seg button[aria-pressed=true]{background:${HIGHLIGHT};color:#fff;border-color:${HIGHLIGHT}}
.mb-seg button:focus-visible{outline:2px solid ${HIGHLIGHT};outline-offset:1px}
.mb-ta{width:100%;box-sizing:border-box;resize:vertical;min-height:54px;padding:8px 10px;border-radius:9px;
  background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);color:#fff;font:inherit}
.mb-ta:focus{outline:none;border-color:${HIGHLIGHT};box-shadow:0 0 0 3px rgba(255,45,166,.2)}
.mb-color{display:flex;align-items:center;gap:9px}
.mb-color input[type=color]{width:34px;height:30px;padding:0;border:1px solid rgba(255,255,255,.15);border-radius:8px;background:none;cursor:pointer}
.mb-color .mb-swap{all:unset;cursor:pointer;font-size:11px;color:#9a9aa5;text-decoration:underline}
.mb-color .mb-swap:hover{color:#fff}
.mb-actions{display:flex;gap:8px}
.mb-btn{all:unset;flex:1;text-align:center;cursor:pointer;padding:10px 0;border-radius:10px;font-weight:650;font-size:13px;transition:filter .12s,background .12s}
.mb-btn:focus-visible{outline:2px solid #fff;outline-offset:1px}
.mb-btn.mb-primary{background:linear-gradient(135deg,${HIGHLIGHT},#7a2dff);color:#fff}
.mb-btn.mb-primary:hover{filter:brightness(1.08)}
.mb-btn.mb-primary[disabled]{opacity:.45;cursor:not-allowed;filter:none}
.mb-btn.mb-ghost{flex:0 0 auto;padding:10px 14px;background:rgba(255,255,255,.07)}
.mb-btn.mb-ghost:hover{background:rgba(255,255,255,.13)}
.mb-status{display:flex;align-items:center;gap:9px;font-size:12px;padding:9px 11px;border-radius:9px;min-height:18px}
.mb-status.is-info{background:rgba(122,45,255,.16);color:#cbb8ff}
.mb-status.is-busy{background:rgba(255,255,255,.06);color:#cfcfd6}
.mb-status.is-ok{background:rgba(46,204,113,.16);color:#7be0a6}
.mb-status.is-err{background:rgba(231,76,60,.16);color:#ff9b8f}
.mb-spin{width:14px;height:14px;border-radius:50%;border:2px solid rgba(255,255,255,.25);border-top-color:#fff;animation:mb-spin .8s linear infinite;flex:0 0 auto}
@keyframes mb-spin{to{transform:rotate(360deg)}}
.mb-empty{padding:18px 16px;text-align:center;color:#a8a8b4}
.mb-empty strong{display:block;color:#e8e8ec;margin-bottom:6px;font-size:13px}
`;
	const el = document.createElement('style');
	el.id = 'mb-styles';
	el.textContent = css;
	document.head.appendChild(el);
}

export class MagicBrush {
	constructor(viewer, session, editor) {
		this.viewer = viewer;
		this.session = session;
		this.editor = editor;

		this.enabled = false;
		this.tool = 'paint'; // 'paint' | 'erase'
		this.brush = 64; // mask px radius
		this.prompt = '';
		this.color = null; // hex string or null
		this.quality = 1024; // texture_size
		this.strength = 0.85;

		this.busy = false;
		this.painted = false;
		this.status = null; // { kind, text }
		this.jobToken = null;
		this._pollTimer = null;

		// Target mesh + its material/map we paint against.
		this.targetMesh = null;
		this.targetMaterial = null;
		this._origMap = undefined;

		// Offscreen canvases.
		this.maskCanvas = null; // white discs on transparent (uploaded over black)
		this.tintCanvas = null; // mask recoloured to HIGHLIGHT for on-model preview
		this.baseCanvas = null; // current base atlas, drawn behind the tint
		this.previewCanvas = null; // base + tint → CanvasTexture on the model
		this.previewTexture = null;

		this.raycaster = new Raycaster();
		this.raycaster.firstHitOnly = true;
		this._ndc = new Vector2();
		this._lastUV = null;
		this._painting = false;
		this._recomposeQueued = false;

		this.panel = null;
		this._guiCtrl = null;

		this._onPointerDown = this._onPointerDown.bind(this);
		// A WebGPU device loss moves the viewer onto a fresh WebGL canvas
		// (Viewer._fallBackToWebGL), which carries the old canvas's styles.
		this._onCanvasReplaced = ({ detail }) => {
			detail.previous.removeEventListener('pointerdown', this._onPointerDown, true);
			detail.canvas.addEventListener('pointerdown', this._onPointerDown, true);
		};
		this._onPointerMove = this._onPointerMove.bind(this);
		this._onPointerUp = this._onPointerUp.bind(this);
		this._onKey = this._onKey.bind(this);
	}

	// ── lifecycle ──────────────────────────────────────────────────────────────

	attach() {
		injectStyles();
		if (this.viewer?.gui) {
			const folder = this.viewer.gui.__folders?.Editor || this.viewer.gui;
			this._guiCtrl = folder
				.add({ brush: () => this.toggle() }, 'brush')
				.name('🖌 magic brush [B]');
		}
		window.addEventListener('keydown', this._onKey);
	}

	rebuild() {
		// New content loaded — drop any in-flight state and re-acquire the target.
		this._stopPolling();
		this._teardownPreview();
		this.painted = false;
		this._lastUV = null;
		this.jobToken = null;
		this.busy = false;
		this.status = null;
		this._acquireTarget();
		this._initCanvases();
		if (this.enabled) {
			this._installPreview();
			this.render();
		}
	}

	toggle() {
		this.enabled ? this.disable() : this.enable();
	}

	enable() {
		if (this.enabled) return;
		this.enabled = true;
		injectStyles();
		this._acquireTarget();
		this._initCanvases();
		this._installPreview();
		const canvas = this.viewer?.renderer?.domElement;
		if (canvas) {
			// Capture phase so we intercept the pointer BEFORE OrbitControls'
			// own listener and can stop it from starting an orbit mid-stroke.
			canvas.addEventListener('pointerdown', this._onPointerDown, true);
			this.viewer.el?.addEventListener('viewer-canvas-replaced', this._onCanvasReplaced);
			this._prevTouchAction = canvas.style.touchAction;
			canvas.style.touchAction = 'none';
			if (this.targetMesh) canvas.style.cursor = 'crosshair';
		}
		this._mountPanel();
		this.render();
	}

	disable() {
		if (!this.enabled) return;
		this.enabled = false;
		this._stopPolling();
		this._endStroke();
		const canvas = this.viewer?.renderer?.domElement;
		if (canvas) {
			canvas.removeEventListener('pointerdown', this._onPointerDown, true);
			this.viewer.el?.removeEventListener('viewer-canvas-replaced', this._onCanvasReplaced);
			canvas.style.cursor = '';
			if (this._prevTouchAction !== undefined) canvas.style.touchAction = this._prevTouchAction;
		}
		this._teardownPreview();
		this._unmountPanel();
	}

	dispose() {
		this.disable();
		window.removeEventListener('keydown', this._onKey);
	}

	_onKey(e) {
		if (e.key !== 'b' && e.key !== 'B') return;
		const t = e.target;
		if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
		this.toggle();
	}

	// ── target + canvases ────────────────────────────────────────────────────────

	_acquireTarget() {
		this.targetMesh = null;
		this.targetMaterial = null;
		const content = this.viewer?.content;
		if (!content) return;
		const candidates = [];
		content.traverse((n) => {
			if (n.isMesh && n.geometry?.attributes?.uv) candidates.push(n);
		});
		if (!candidates.length) return;
		const matOf = (m) => (Array.isArray(m.material) ? m.material[0] : m.material);
		const hasMap = (m) => (matOf(m)?.map ? 1 : 0);
		const vcount = (m) => m.geometry.attributes.position?.count || 0;
		candidates.sort((a, b) => hasMap(b) - hasMap(a) || vcount(b) - vcount(a));
		this.targetMesh = candidates[0];
		this.targetMaterial = matOf(this.targetMesh);
	}

	_initCanvases() {
		if (!this.maskCanvas) {
			this.maskCanvas = document.createElement('canvas');
			this.tintCanvas = document.createElement('canvas');
			this.baseCanvas = document.createElement('canvas');
			this.previewCanvas = document.createElement('canvas');
			for (const c of [this.maskCanvas, this.tintCanvas, this.baseCanvas, this.previewCanvas]) {
				c.width = c.height = TEX;
			}
		}
		// Clear mask + redraw the base from the current target texture.
		this.maskCanvas.getContext('2d').clearRect(0, 0, TEX, TEX);
		this.tintCanvas.getContext('2d').clearRect(0, 0, TEX, TEX);
		this.painted = false;
		this._drawBase();
	}

	_drawBase() {
		const ctx = this.baseCanvas.getContext('2d');
		ctx.clearRect(0, 0, TEX, TEX);
		const img = this._origMapImage();
		if (img) {
			try {
				ctx.drawImage(img, 0, 0, TEX, TEX);
				return;
			} catch (e) {
				log.warn('[magic-brush] base texture not drawable:', e?.message);
			}
		}
		// No usable source texture — neutral base so the highlight still reads.
		ctx.fillStyle = '#7a7a7a';
		ctx.fillRect(0, 0, TEX, TEX);
	}

	_origMapImage() {
		const map = this.targetMaterial?.map;
		if (!map || !map.image) return null;
		const im = map.image;
		// Accept anything drawImage can consume.
		if (im instanceof HTMLImageElement || im instanceof HTMLCanvasElement) return im;
		if (typeof ImageBitmap !== 'undefined' && im instanceof ImageBitmap) return im;
		if (im.data && im.width && im.height) return null; // raw/compressed — not drawable
		return im.width && im.height ? im : null;
	}

	_installPreview() {
		if (!this.targetMaterial) return;
		if (this.previewTexture) return; // already installed
		this._origMap = this.targetMaterial.map ?? null;
		this.previewTexture = new CanvasTexture(this.previewCanvas);
		this.previewTexture.flipY = this._origMap ? this._origMap.flipY : false;
		this.previewTexture.colorSpace = this._origMap?.colorSpace || SRGBColorSpace;
		if (this._origMap) {
			this.previewTexture.wrapS = this._origMap.wrapS;
			this.previewTexture.wrapT = this._origMap.wrapT;
			this.previewTexture.channel = this._origMap.channel ?? 0;
		}
		this.targetMaterial.map = this.previewTexture;
		this.targetMaterial.needsUpdate = true;
		this._recompose();
	}

	_teardownPreview() {
		if (this.previewTexture && this.targetMaterial) {
			this.targetMaterial.map = this._origMap ?? null;
			this.targetMaterial.needsUpdate = true;
			this.viewer?.invalidate?.();
		}
		if (this.previewTexture) {
			this.previewTexture.dispose();
			this.previewTexture = null;
		}
		this._origMap = undefined;
	}

	// ── painting ─────────────────────────────────────────────────────────────────

	_hitUV(e) {
		const canvas = this.viewer?.renderer?.domElement;
		if (!canvas || !this.targetMesh) return null;
		const rect = canvas.getBoundingClientRect();
		this._ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
		this._ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
		this.raycaster.setFromCamera(this._ndc, this.viewer.activeCamera);
		const hits = this.raycaster.intersectObject(this.targetMesh, true);
		for (const h of hits) {
			if (h.uv) return { x: h.uv.x, y: h.uv.y };
		}
		return null;
	}

	_onPointerDown(e) {
		if (!this.enabled || this.busy) return;
		const uv = this._hitUV(e);
		if (!uv) return; // missed the mesh → let OrbitControls handle the drag
		// Hit the mesh: claim the gesture for painting and keep OrbitControls
		// (whose listener is on the same element, bubble phase) from seeing it.
		e.preventDefault();
		e.stopPropagation();
		e.stopImmediatePropagation();
		this._painting = true;
		if (this.viewer?.controls) this.viewer.controls.enabled = false;
		try {
			e.target.setPointerCapture?.(e.pointerId);
		} catch {
			/* not capturable — fine */
		}
		window.addEventListener('pointermove', this._onPointerMove);
		window.addEventListener('pointerup', this._onPointerUp);
		this._lastUV = null;
		this._stampUV(uv);
	}

	_onPointerMove(e) {
		if (!this._painting) return;
		const uv = this._hitUV(e);
		if (!uv) return;
		this._stampUV(uv);
	}

	_onPointerUp() {
		this._endStroke();
	}

	_endStroke() {
		if (!this._painting) {
			if (this.viewer?.controls) this.viewer.controls.enabled = true;
			return;
		}
		this._painting = false;
		this._lastUV = null;
		window.removeEventListener('pointermove', this._onPointerMove);
		window.removeEventListener('pointerup', this._onPointerUp);
		if (this.viewer?.controls) this.viewer.controls.enabled = true;
		this._syncApplyEnabled();
	}

	_stampUV(uv) {
		const x = uv.x * TEX;
		const y = uv.y * TEX; // glTF: v 0 = top row, no flip
		if (this._lastUV) {
			const dx = uv.x - this._lastUV.x;
			const dy = uv.y - this._lastUV.y;
			const dist = Math.hypot(dx, dy);
			// Interpolate within an island; skip the gap when a stroke jumps a UV seam.
			if (dist < 0.15) {
				const steps = Math.ceil((dist * TEX) / (this.brush * 0.5)) || 1;
				for (let i = 1; i <= steps; i++) {
					const t = i / steps;
					this._stampPx((this._lastUV.x + dx * t) * TEX, (this._lastUV.y + dy * t) * TEX);
				}
			} else {
				this._stampPx(x, y);
			}
		} else {
			this._stampPx(x, y);
		}
		this._lastUV = uv;
		this.painted = this.tool === 'paint' ? true : this.painted;
		this._queueRecompose();
	}

	_stampPx(x, y) {
		const ctx = this.maskCanvas.getContext('2d');
		ctx.save();
		if (this.tool === 'erase') {
			ctx.globalCompositeOperation = 'destination-out';
			ctx.fillStyle = 'rgba(0,0,0,1)';
		} else {
			ctx.globalCompositeOperation = 'source-over';
			ctx.fillStyle = '#ffffff';
		}
		ctx.beginPath();
		ctx.arc(x, y, this.brush, 0, Math.PI * 2);
		ctx.fill();
		// Texture wraps at the UV border — stamp the horizontal/vertical wrap so a
		// brush over a seam paints both sides.
		for (const ox of [-TEX, TEX]) {
			if (x + this.brush > TEX || x - this.brush < 0) {
				ctx.beginPath();
				ctx.arc(x + ox, y, this.brush, 0, Math.PI * 2);
				ctx.fill();
			}
		}
		ctx.restore();
	}

	_queueRecompose() {
		if (this._recomposeQueued) return;
		this._recomposeQueued = true;
		requestAnimationFrame(() => {
			this._recomposeQueued = false;
			this._recompose();
		});
	}

	_recompose() {
		// Rebuild the tinted mask, then base + tint → preview texture.
		const tctx = this.tintCanvas.getContext('2d');
		tctx.clearRect(0, 0, TEX, TEX);
		tctx.drawImage(this.maskCanvas, 0, 0);
		tctx.globalCompositeOperation = 'source-in';
		tctx.fillStyle = HIGHLIGHT;
		tctx.fillRect(0, 0, TEX, TEX);
		tctx.globalCompositeOperation = 'source-over';

		const pctx = this.previewCanvas.getContext('2d');
		pctx.clearRect(0, 0, TEX, TEX);
		pctx.drawImage(this.baseCanvas, 0, 0);
		pctx.globalAlpha = 0.55;
		pctx.drawImage(this.tintCanvas, 0, 0);
		pctx.globalAlpha = 1;

		if (this.previewTexture) this.previewTexture.needsUpdate = true;
		this.viewer?.invalidate?.();
	}

	_clearMask() {
		this.maskCanvas.getContext('2d').clearRect(0, 0, TEX, TEX);
		this.painted = false;
		this._recompose();
		this._syncApplyEnabled();
	}

	// ── apply / poll ──────────────────────────────────────────────────────────────

	_currentMeshUrl() {
		const u = this.session?.sourceURL;
		if (typeof u !== 'string') return null;
		if (!/^https:\/\//i.test(u)) return null; // blob:/file: can't be fetched server-side
		return u;
	}

	_exportMaskB64() {
		// Composite white-on-black (worker thresholds white = repaint).
		const out = document.createElement('canvas');
		out.width = out.height = TEX;
		const ctx = out.getContext('2d');
		ctx.fillStyle = '#000000';
		ctx.fillRect(0, 0, TEX, TEX);
		ctx.drawImage(this.maskCanvas, 0, 0);
		const data = out.toDataURL('image/png');
		return data.split(',')[1];
	}

	async _apply() {
		if (this.busy) return;
		if (!this.targetMesh) {
			this._setStatus('err', 'Load a textured model first.');
			return;
		}
		if (!this.painted) {
			this._setStatus('err', 'Paint a region on the model first.');
			return;
		}
		if (this.prompt.trim().length < 3 && !this.color) {
			this._setStatus('err', 'Describe the change, or pick a colour.');
			return;
		}
		const meshUrl = this._currentMeshUrl();
		if (!meshUrl) {
			this._setStatus(
				'err',
				'Magic Brush needs a model loaded from a URL. Open a saved model or paste a GLB link.',
			);
			return;
		}

		this.busy = true;
		this._setStatus('busy', 'Submitting region edit…');

		let token;
		try {
			const resp = await fetch('/api/studio/retexture-region', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({
					mesh_url: meshUrl,
					prompt: this.prompt.trim(),
					color: this.color || undefined,
					mask_b64: this._exportMaskB64(),
					texture_size: this.quality,
					strength: this.strength,
				}),
			});
			const body = await resp.json().catch(() => ({}));
			if (!resp.ok) {
				if (resp.status === 401) throw new Error('Sign in to use Magic Brush.');
				if (resp.status === 501) {
					throw new Error('Region retexture is not configured on this deployment yet.');
				}
				throw new Error(body.error_description || `Request failed (${resp.status})`);
			}
			token = body.job;
			this.jobToken = token;
		} catch (err) {
			this.busy = false;
			this._setStatus('err', err.message);
			return;
		}

		this._setStatus('busy', 'Painting the region… this usually takes ~1 minute.');
		this._poll(token);
	}

	_poll(token) {
		this._stopPolling();
		this._pollTimer = setInterval(async () => {
			try {
				const resp = await fetch(
					`/api/studio/retexture-region?job=${encodeURIComponent(token)}`,
					{ credentials: 'include' },
				);
				const body = await resp.json().catch(() => ({}));
				if (!resp.ok) throw new Error(body.error_description || `Status failed (${resp.status})`);

				if (body.status === 'done' && body.result_url) {
					this._stopPolling();
					await this._loadResult(body.result_url);
				} else if (body.status === 'failed') {
					this._stopPolling();
					this.busy = false;
					this._setStatus('err', body.error || 'Region edit failed.');
				}
				// queued / running → keep waiting.
			} catch (err) {
				this._stopPolling();
				this.busy = false;
				this._setStatus('err', err.message);
			}
		}, POLL_MS);
	}

	_stopPolling() {
		if (this._pollTimer) {
			clearInterval(this._pollTimer);
			this._pollTimer = null;
		}
	}

	async _loadResult(url) {
		this._setStatus('busy', 'Loading the updated model…');
		// Restore the real material before swapping content so we don't leave the
		// preview texture dangling, then reload + re-point the editor.
		this._teardownPreview();
		try {
			await this.viewer.load(url, '', new Map());
			const name = url.split('/').pop().split('?')[0] || 'model';
			// Re-points session.sourceURL to the result so the NEXT pass chains on
			// it, and rebuilds every editor panel (including this brush).
			this.editor.onContentChanged({ url, name });
			this.busy = false;
			this._setStatus('ok', 'Region updated. Paint again to keep editing.');
		} catch (err) {
			this.busy = false;
			this._setStatus('err', `Loaded edit but failed to display it: ${err.message}`);
		}
	}

	// ── panel UI ──────────────────────────────────────────────────────────────────

	_setStatus(kind, text) {
		this.status = { kind, text };
		this.render();
	}

	_syncApplyEnabled() {
		const btn = this.panel?.querySelector('.mb-apply');
		if (!btn) return;
		const ready =
			!!this.targetMesh &&
			this.painted &&
			(this.prompt.trim().length >= 3 || !!this.color) &&
			!this.busy;
		btn.disabled = !ready;
	}

	_mountPanel() {
		if (this.panel) return;
		const host = this.viewer?.el || document.body;
		if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
		this.panel = document.createElement('div');
		this.panel.className = 'mb-panel';
		host.appendChild(this.panel);
		this.render();
		requestAnimationFrame(() => this.panel?.classList.add('mb-open'));
	}

	_unmountPanel() {
		if (!this.panel) return;
		const p = this.panel;
		this.panel = null;
		p.classList.remove('mb-open');
		setTimeout(() => p.remove(), 200);
	}

	render() {
		if (!this.panel) return;
		const open = this.panel.classList.contains('mb-open');
		this.panel.innerHTML = '';
		this.panel.className = `mb-panel${open ? ' mb-open' : ''}`;

		const head = document.createElement('div');
		head.className = 'mb-head';
		head.innerHTML = `<span class="mb-dot"></span><h3>Magic Brush</h3>`;
		const x = document.createElement('button');
		x.className = 'mb-x';
		x.setAttribute('aria-label', 'Close magic brush');
		x.textContent = '✕';
		x.addEventListener('click', () => this.disable());
		head.appendChild(x);
		this.panel.appendChild(head);

		// Empty state: no paintable mesh.
		if (!this.targetMesh) {
			const empty = document.createElement('div');
			empty.className = 'mb-empty';
			empty.innerHTML = `<strong>No paintable surface</strong>
				Load a model with a UV-mapped texture, then reopen Magic Brush to repaint part of it.`;
			this.panel.appendChild(empty);
			return;
		}

		const body = document.createElement('div');
		body.className = 'mb-body';
		this.panel.appendChild(body);

		const hint = document.createElement('p');
		hint.className = 'mb-hint';
		hint.textContent =
			'Paint over the area to change, describe it, then Apply. Only that region is repainted.';
		body.appendChild(hint);

		// Tool segment: paint / erase.
		const toolRow = document.createElement('div');
		toolRow.className = 'mb-row';
		toolRow.innerHTML = `<label>Tool</label>`;
		const seg = document.createElement('div');
		seg.className = 'mb-seg';
		for (const t of ['paint', 'erase']) {
			const b = document.createElement('button');
			b.textContent = t === 'paint' ? '🖌 Paint' : '🩹 Erase';
			b.setAttribute('aria-pressed', String(this.tool === t));
			b.addEventListener('click', () => {
				this.tool = t;
				this.render();
			});
			seg.appendChild(b);
		}
		toolRow.appendChild(seg);
		body.appendChild(toolRow);

		// Brush size.
		const sizeRow = document.createElement('div');
		sizeRow.className = 'mb-row';
		sizeRow.innerHTML = `<label>Brush size</label>`;
		const slide = document.createElement('div');
		slide.className = 'mb-slide';
		const range = document.createElement('input');
		range.type = 'range';
		range.min = '8';
		range.max = '220';
		range.step = '2';
		range.value = String(this.brush);
		const val = document.createElement('span');
		val.className = 'mb-val';
		val.textContent = String(this.brush);
		range.addEventListener('input', () => {
			this.brush = Number(range.value);
			val.textContent = range.value;
		});
		slide.append(range, val);
		sizeRow.appendChild(slide);
		body.appendChild(sizeRow);

		// Prompt.
		const promptRow = document.createElement('div');
		promptRow.className = 'mb-row';
		promptRow.innerHTML = `<label>Describe the change</label>`;
		const ta = document.createElement('textarea');
		ta.className = 'mb-ta';
		ta.placeholder = 'e.g. weathered copper plate with green patina';
		ta.value = this.prompt;
		ta.addEventListener('input', () => {
			this.prompt = ta.value;
			this._syncApplyEnabled();
		});
		promptRow.appendChild(ta);
		body.appendChild(promptRow);

		// Colour (optional).
		const colorRow = document.createElement('div');
		colorRow.className = 'mb-row';
		colorRow.innerHTML = `<label>Target colour (optional)</label>`;
		const cwrap = document.createElement('div');
		cwrap.className = 'mb-color';
		const cinput = document.createElement('input');
		cinput.type = 'color';
		cinput.value = this.color || '#1e90ff';
		const cstate = document.createElement('span');
		cstate.style.flex = '1';
		cstate.style.color = '#9a9aa5';
		cstate.style.fontSize = '12px';
		cstate.textContent = this.color ? this.color : 'not used';
		cinput.addEventListener('input', () => {
			this.color = cinput.value;
			cstate.textContent = this.color;
			this._syncApplyEnabled();
		});
		const cclear = document.createElement('button');
		cclear.className = 'mb-swap';
		cclear.type = 'button';
		cclear.textContent = 'clear';
		cclear.addEventListener('click', () => {
			this.color = null;
			this.render();
		});
		cwrap.append(cinput, cstate, cclear);
		colorRow.appendChild(cwrap);
		body.appendChild(colorRow);

		// Status.
		if (this.status) {
			const s = document.createElement('div');
			s.className = `mb-status is-${this.status.kind}`;
			if (this.status.kind === 'busy') {
				const sp = document.createElement('span');
				sp.className = 'mb-spin';
				s.appendChild(sp);
			}
			const t = document.createElement('span');
			t.textContent = this.status.text;
			s.appendChild(t);
			body.appendChild(s);
		}

		// Actions.
		const actions = document.createElement('div');
		actions.className = 'mb-actions';
		const clearBtn = document.createElement('button');
		clearBtn.className = 'mb-btn mb-ghost';
		clearBtn.textContent = 'Clear';
		clearBtn.title = 'Clear the painted mask';
		clearBtn.disabled = this.busy;
		clearBtn.addEventListener('click', () => this._clearMask());
		const applyBtn = document.createElement('button');
		applyBtn.className = 'mb-btn mb-primary mb-apply';
		applyBtn.textContent = this.busy ? 'Working…' : 'Apply';
		applyBtn.addEventListener('click', () => this._apply());
		actions.append(clearBtn, applyBtn);
		body.appendChild(actions);

		this._syncApplyEnabled();
	}
}

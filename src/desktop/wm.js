// Window manager: real draggable, resizable, snappable windows that frame
// same-origin three.ws pages (or render a native shell panel). Geometry and
// persistence rules live in layout.js so they stay unit-tested.

import {
	MAX_WINDOWS,
	clampRect,
	cascadeRect,
	cleanTitle,
	isInternalPath,
	layoutZoneRect,
	resizeRect,
	snapLayoutsFor,
	snapRect,
	snapZone,
	workArea,
} from './layout.js';
import { icon } from './icons.js';

const HANDLES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

// Motion: Fluent's standard curves. Accelerate out of view, decelerate in.
const EASE_OUT = 'cubic-bezier(0.1, 0.9, 0.2, 1)';
const EASE_IN = 'cubic-bezier(0.7, 0, 1, 0.5)';
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createWM({ layer, getMetrics, renderNative, onChange, notify, getTaskRect }) {
	const wins = new Map(); // app id -> window record
	let zTop = 10;
	let opened = 0;
	let focusedId = null;

	const snapGhost = document.createElement('div');
	snapGhost.className = 'win-snap';
	snapGhost.hidden = true;
	layer.append(snapGhost);

	/**
	 * FLIP a window from where it was drawn (`before`, a DOMRect) to where it
	 * is now, so maximize, restore and every snap glide instead of jumping.
	 */
	function morph(w, before) {
		if (!before || reducedMotion() || !w.el.animate) return;
		const after = w.el.getBoundingClientRect();
		if (!after.width || !after.height) return;
		const dx = before.left - after.left;
		const dy = before.top - after.top;
		const sx = before.width / after.width;
		const sy = before.height / after.height;
		if (Math.abs(dx) + Math.abs(dy) < 1 && Math.abs(sx - 1) + Math.abs(sy - 1) < 0.01) return;
		w.el.animate(
			[
				{ transformOrigin: '0 0', transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
				{ transformOrigin: '0 0', transform: 'none' },
			],
			{ duration: 240, easing: EASE_OUT },
		);
	}

	/**
	 * Fly a window into (or out of) its taskbar button: the Windows 11 minimize
	 * motion. Resolves when the motion ends or is skipped.
	 */
	function flyTask(w, out) {
		w.anim?.cancel();
		const t = getTaskRect?.(w.app.id);
		if (!t || reducedMotion() || !w.el.animate) return Promise.resolve(true);
		const r = w.el.getBoundingClientRect();
		if (!r.width) return Promise.resolve(true);
		const dx = t.left + t.width / 2 - (r.left + r.width / 2);
		const dy = t.top + t.height / 2 - (r.top + r.height / 2);
		const s = Math.max(0.06, Math.min(0.3, (t.width * 3) / r.width));
		const hidden = { transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: 0 };
		const shown = { transform: 'none', opacity: 1 };
		const a = w.el.animate(out ? [shown, hidden] : [hidden, shown], {
			duration: out ? 220 : 280,
			easing: out ? EASE_IN : EASE_OUT,
		});
		w.anim = a;
		return a.finished.then(
			() => {
				if (w.anim === a) w.anim = null;
				return true;
			},
			() => false,
		);
	}

	const isMobile = () => getMetrics().mobile;
	const area = () => {
		const m = getMetrics();
		return workArea(m.vw, m.vh, m.menuH, m.dockH);
	};

	function emit() {
		onChange({
			windows: [...wins.values()].map(publicView),
			focus: focusedId,
		});
	}

	const publicView = (w) => ({
		id: w.app.id,
		app: w.app,
		title: w.title,
		minimized: w.min,
		maximized: w.max,
		rect: { ...w.rect },
		path: w.path,
		z: w.z,
	});

	function applyRect(w) {
		const r = isMobile() || w.max ? area() : w.rect;
		const s = w.el.style;
		s.left = `${r.x}px`;
		s.top = `${r.y}px`;
		s.width = `${r.w}px`;
		s.height = `${r.h}px`;
		w.el.classList.toggle('is-max', isMobile() || w.max);
	}

	function focus(id) {
		const w = wins.get(id);
		if (!w) return;
		if (w.min) restore(id);
		wins.forEach((o) => o.el.classList.toggle('is-focused', o === w));
		w.z = ++zTop;
		w.el.style.zIndex = String(w.z);
		w.lastFocus = Date.now();
		focusedId = id;
		// Pointer events inside an iframe never reach the parent document, so
		// give the frame real keyboard focus once the window is on top.
		if (w.frame && document.activeElement !== w.frame && !w.suppressFrameFocus) {
			try {
				w.frame.focus({ preventScroll: true });
			} catch {
				/* a frame that is not yet attached cannot take focus */
			}
		}
		emit();
	}

	function pickNextFocus() {
		const open = [...wins.values()].filter((w) => !w.min).sort((a, b) => b.z - a.z);
		focusedId = open[0] ? open[0].app.id : null;
		wins.forEach((o) => o.el.classList.toggle('is-focused', o.app.id === focusedId));
	}

	function minimize(id) {
		const w = wins.get(id);
		if (!w || w.min) return;
		w.min = true;
		w.el.setAttribute('aria-hidden', 'true');
		w.el.inert = true;
		if (focusedId === id) pickNextFocus();
		emit();
		// The window stays drawn while it flies into its taskbar button; a
		// restore during the flight cancels it (and `finished` resolves false).
		flyTask(w, true).then((done) => {
			if (done && w.min) w.el.classList.add('is-min');
		});
	}

	function restore(id) {
		const w = wins.get(id);
		if (!w || !w.min) return;
		w.min = false;
		w.el.classList.remove('is-min');
		w.el.removeAttribute('aria-hidden');
		w.el.inert = false;
		flyTask(w, false);
	}

	function syncMaxBtn(w) {
		w.maxBtn.setAttribute('aria-label', w.max ? 'Restore window' : 'Maximize window');
		w.maxBtn.title = w.max ? 'Restore' : 'Maximize';
		w.maxBtn.innerHTML = icon(w.max ? 'restore' : 'maximize', 13);
	}

	function toggleMax(id) {
		const w = wins.get(id);
		if (!w) return;
		const before = w.el.getBoundingClientRect();
		w.max = !w.max;
		applyRect(w);
		syncMaxBtn(w);
		morph(w, before);
		emit();
	}

	/** Place a window at a rect (or maximize it), restoring it first if needed. */
	function place(id, rect, max = false) {
		const w = wins.get(id);
		if (!w) return;
		if (w.min) restore(id);
		const before = w.el.getBoundingClientRect();
		w.max = max;
		if (rect) w.rect = clampRect(rect, area());
		applyRect(w);
		syncMaxBtn(w);
		morph(w, before);
		focus(id);
	}

	/** Snap the focused window from the keyboard: left, right, up (maximize), down (restore, then minimize). */
	function snapKey(id, dir) {
		const w = wins.get(id);
		if (!w || isMobile()) return;
		const a = area();
		if (dir === 'up') return place(id, null, true);
		if (dir === 'down') {
			if (w.max) return place(id, w.rect, false);
			return minimize(id);
		}
		place(id, snapRect(dir, a));
	}

	function close(id) {
		const w = wins.get(id);
		if (!w) return;
		w.el.classList.add('is-closing');
		wins.delete(id);
		(w.cleanups || []).forEach((fn) => {
			try {
				fn();
			} catch {
				/* an app's teardown must never block closing its window */
			}
		});
		const done = () => w.el.remove();
		if (reducedMotion()) done();
		else {
			w.el.addEventListener('animationend', done, { once: true });
			setTimeout(done, 260);
		}
		if (focusedId === id) pickNextFocus();
		emit();
	}

	function evictIfFull() {
		if (wins.size < MAX_WINDOWS) return;
		const victim = [...wins.values()].sort((a, b) => (a.min === b.min ? a.lastFocus - b.lastFocus : a.min ? -1 : 1))[0];
		if (!victim) return;
		notify(`Closed ${victim.title} to keep the desktop responsive (${MAX_WINDOWS} windows max).`);
		close(victim.app.id);
	}

	function frameUrl(app, path) {
		return isInternalPath(path) ? path : app.href;
	}

	function buildWindow(app, opts) {
		const w = {
			app,
			title: app.title,
			path: app.native ? null : frameUrl(app, opts.path),
			min: false,
			max: !!opts.max,
			lastFocus: Date.now(),
			z: 0,
			rect: null,
			frame: null,
			arg: opts.arg,
			cleanups: [],
			onArg: null,
		};
		const el = document.createElement('section');
		el.className = 'win';
		el.dataset.app = app.id;
		el.style.setProperty('--hue', String(app.hue));
		el.setAttribute('role', 'dialog');
		el.setAttribute('aria-label', app.title);

		const bar = document.createElement('header');
		bar.className = 'win-bar';
		bar.innerHTML =
			`<div class="win-title"><span class="win-glyph">${icon(app.icon, 15)}</span><span class="win-name"></span></div>` +
			`<div class="win-tools"></div>` +
			`<div class="win-ctl">` +
			`<button type="button" class="win-btn win-min" aria-label="Minimize window" title="Minimize">${icon('minimize', 14)}</button>` +
			`<button type="button" class="win-btn win-maxbtn" aria-label="Maximize window" title="Maximize">${icon('maximize', 13)}</button>` +
			`<button type="button" class="win-btn win-close" aria-label="Close window" title="Close">${icon('close', 15)}</button>` +
			`</div>`;
		bar.querySelector('.win-name').textContent = app.title;
		const tools = bar.querySelector('.win-tools');
		w.maxBtn = bar.querySelector('.win-maxbtn');

		if (!app.native) {
			const reload = document.createElement('button');
			reload.type = 'button';
			reload.className = 'win-tool';
			reload.title = 'Reload';
			reload.setAttribute('aria-label', 'Reload');
			reload.innerHTML = icon('reload', 15);
			reload.addEventListener('click', () => reloadFrame(w));
			const ext = document.createElement('a');
			ext.className = 'win-tool';
			ext.title = 'Open in a browser tab';
			ext.setAttribute('aria-label', 'Open in a browser tab');
			ext.target = '_blank';
			ext.rel = 'noopener';
			ext.href = w.path;
			ext.innerHTML = icon('external', 15);
			w.extLink = ext;
			tools.append(reload, ext);
		}

		const body = document.createElement('div');
		body.className = 'win-body';
		el.append(bar, body);
		HANDLES.forEach((h) => {
			const g = document.createElement('div');
			g.className = `win-grip win-grip-${h}`;
			g.dataset.handle = h;
			el.append(g);
		});

		if (app.native) {
			renderNative(app, body, w);
		} else {
			const skeleton = document.createElement('div');
			skeleton.className = 'win-loading';
			skeleton.innerHTML = `<span class="win-loading-bar"></span><span class="win-loading-label">Opening ${escapeHtml(app.title)}</span>`;
			const frame = document.createElement('iframe');
			frame.className = 'win-frame';
			// The name is how a framed page knows it is inside the desktop and
			// drops its own site header (public/nav.js).
			frame.name = `tws-os:${app.id}`;
			frame.title = app.title;
			// `fullscreen` in the permissions policy replaces the legacy
			// `allowfullscreen` attribute; setting both makes Chrome warn.
			frame.allow = 'clipboard-read; clipboard-write; fullscreen; microphone; camera; xr-spatial-tracking; web-share';
			frame.addEventListener('load', () => onFrameLoad(w, skeleton));
			frame.src = w.path;
			w.frame = frame;
			w.skeleton = skeleton;
			body.append(frame, skeleton);
		}

		w.el = el;
		w.bar = bar;
		w.body = body;
		wireChrome(w);
		return w;
	}

	function reloadFrame(w) {
		if (!w.frame) return;
		w.skeleton.hidden = false;
		w.skeleton.classList.remove('is-error');
		try {
			w.frame.contentWindow.location.reload();
		} catch {
			w.frame.src = w.path;
		}
	}

	function onFrameLoad(w, skeleton) {
		skeleton.hidden = true;
		try {
			const doc = w.frame.contentDocument;
			const loc = w.frame.contentWindow.location;
			if (loc.origin !== location.origin) return;
			const next = loc.pathname + loc.search + loc.hash;
			if (isInternalPath(next) && next !== 'about:blank') {
				w.path = next;
				w.extLink.href = next;
			}
			const t = cleanTitle(doc.title, w.app.title);
			w.title = t;
			w.bar.querySelector('.win-name').textContent = t;
			w.el.setAttribute('aria-label', t);
			// Links inside a window that point at the desktop root would nest the
			// desktop inside itself; send those to the top frame.
			if (loc.pathname === '/' && doc.getElementById('os')) {
				w.frame.src = w.app.href;
			}
		} catch {
			/* cross-origin navigation: keep the app title */
		}
		emit();
	}

	function wireChrome(w) {
		const { el, bar } = w;
		const id = w.app.id;
		bar.querySelector('.win-close').addEventListener('click', () => close(id));
		bar.querySelector('.win-min').addEventListener('click', () => minimize(id));
		w.maxBtn.addEventListener('click', () => {
			hideFlyout(true);
			toggleMax(id);
		});
		// Hovering maximize offers the snap layouts, as on Windows 11.
		w.maxBtn.addEventListener('pointerenter', (e) => {
			if (e.pointerType === 'touch' || isMobile()) return;
			clearTimeout(fly.hideT);
			clearTimeout(fly.showT);
			fly.showT = setTimeout(() => showFlyout(id), 420);
		});
		w.maxBtn.addEventListener('pointerleave', () => {
			clearTimeout(fly.showT);
			hideFlyout();
		});
		bar.addEventListener('dblclick', (e) => {
			if (!e.target.closest('.win-ctl, .win-tools')) toggleMax(id);
		});
		el.addEventListener('pointerdown', () => focus(id), true);
		el.addEventListener('keydown', (e) => {
			if (e.key === 'Escape' && w.app.native) close(id);
		});

		bar.addEventListener('pointerdown', (e) => {
			if (e.button !== 0 || e.target.closest('.win-ctl, .win-tools') || isMobile()) return;
			startDrag(w, e);
		});
		el.querySelectorAll('.win-grip').forEach((g) =>
			g.addEventListener('pointerdown', (e) => {
				if (e.button !== 0 || w.max || isMobile()) return;
				startResize(w, g.dataset.handle, e);
			}),
		);
	}

	function startDrag(w, e) {
		const a = area();
		const wasMax = w.max;
		let origin = { ...w.rect };
		const px = e.clientX;
		const py = e.clientY;
		if (wasMax) {
			// Dragging a maximized window pulls it back to its restored size,
			// keeping the grab point proportional under the cursor.
			const ratio = (px - a.x) / a.w;
			origin = { ...w.rect, x: Math.round(px - w.rect.w * ratio), y: py - 16 };
			w.max = false;
			applyRect(w);
		}
		let zone = null;
		layer.classList.add('is-dragging');
		w.el.classList.add('is-moving');
		w.bar.setPointerCapture(e.pointerId);
		const move = (ev) => {
			const next = clampRect({ ...origin, x: origin.x + (ev.clientX - px), y: origin.y + (ev.clientY - py) }, a);
			w.rect = next;
			applyRect(w);
			zone = snapZone(ev.clientX, ev.clientY, a);
			const g = snapRect(zone, a);
			snapGhost.hidden = !g;
			if (g) Object.assign(snapGhost.style, { left: `${g.x}px`, top: `${g.y}px`, width: `${g.w}px`, height: `${g.h}px` });
		};
		const up = () => {
			w.bar.releasePointerCapture(e.pointerId);
			w.bar.removeEventListener('pointermove', move);
			w.bar.removeEventListener('pointerup', up);
			w.bar.removeEventListener('pointercancel', up);
			layer.classList.remove('is-dragging');
			w.el.classList.remove('is-moving');
			snapGhost.hidden = true;
			const before = zone ? w.el.getBoundingClientRect() : null;
			if (zone === 'max') {
				w.max = true;
			} else if (zone) {
				w.rect = snapRect(zone, a);
			}
			applyRect(w);
			syncMaxBtn(w);
			morph(w, before);
			emit();
		};
		w.bar.addEventListener('pointermove', move);
		w.bar.addEventListener('pointerup', up);
		w.bar.addEventListener('pointercancel', up);
	}

	function startResize(w, handle, e) {
		const a = area();
		const start = { ...w.rect };
		const px = e.clientX;
		const py = e.clientY;
		const grip = e.currentTarget;
		layer.classList.add('is-dragging');
		grip.setPointerCapture(e.pointerId);
		const move = (ev) => {
			w.rect = resizeRect(start, handle, ev.clientX - px, ev.clientY - py, a);
			applyRect(w);
		};
		const up = () => {
			grip.releasePointerCapture(e.pointerId);
			grip.removeEventListener('pointermove', move);
			grip.removeEventListener('pointerup', up);
			grip.removeEventListener('pointercancel', up);
			layer.classList.remove('is-dragging');
			emit();
		};
		grip.addEventListener('pointermove', move);
		grip.addEventListener('pointerup', up);
		grip.addEventListener('pointercancel', up);
	}

	// ---------- Snap layouts flyout and Snap assist ----------
	const fly = { el: null, id: null, showT: 0, hideT: 0 };

	function hideFlyout(now = false) {
		clearTimeout(fly.hideT);
		const go = () => {
			fly.el?.remove();
			fly.el = null;
			fly.id = null;
		};
		if (now) go();
		else fly.hideT = setTimeout(go, 260);
	}

	/** The layouts flyout under a window's maximize button (also Alt+Z for the focused window). */
	function showFlyout(id, viaKeyboard = false) {
		const w = wins.get(id);
		if (!w || isMobile()) return;
		hideFlyout(true);
		hideAssist();
		const a = area();
		const el = document.createElement('div');
		el.className = 'snap-fly';
		el.setAttribute('role', 'menu');
		el.setAttribute('aria-label', 'Snap layouts');
		snapLayoutsFor(a).forEach((l) => {
			const box = document.createElement('div');
			box.className = 'snap-lay';
			box.setAttribute('role', 'group');
			box.setAttribute('aria-label', l.label);
			l.zones.forEach(([fx, fy, fw, fh], i) => {
				const z = document.createElement('button');
				z.type = 'button';
				z.className = 'snap-zone';
				z.setAttribute('role', 'menuitem');
				z.setAttribute('aria-label', `${l.label}, zone ${i + 1} of ${l.zones.length}`);
				z.style.cssText = `left:${fx * 100}%;top:${fy * 100}%;width:${fw * 100}%;height:${fh * 100}%`;
				z.addEventListener('click', () => {
					hideFlyout(true);
					place(id, layoutZoneRect(l.id, i, a));
					showAssist(l.id, i, id);
				});
				box.append(z);
			});
			el.append(box);
		});
		el.addEventListener('pointerenter', () => clearTimeout(fly.hideT));
		el.addEventListener('pointerleave', () => hideFlyout());
		el.addEventListener('keydown', (e) => {
			if (e.key === 'Escape') {
				e.stopPropagation();
				hideFlyout(true);
				w.maxBtn.focus();
				return;
			}
			const all = [...el.querySelectorAll('.snap-zone')];
			const k = all.indexOf(document.activeElement);
			const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
			if (step && k >= 0) {
				e.preventDefault();
				all[(k + step + all.length) % all.length].focus();
			}
		});
		layer.append(el);
		const b = w.maxBtn.getBoundingClientRect();
		const host = layer.getBoundingClientRect();
		const r = el.getBoundingClientRect();
		const left = Math.max(8, Math.min(b.left + b.width / 2 - r.width / 2 - host.left, host.width - r.width - 8));
		const below = b.bottom - host.top + 6;
		const top = below + r.height > host.height - 8 ? Math.max(8, b.top - host.top - r.height - 6) : below;
		el.style.left = `${left}px`;
		el.style.top = `${top}px`;
		fly.el = el;
		fly.id = id;
		if (viaKeyboard) el.querySelector('.snap-zone')?.focus();
	}

	const assist = { el: null };

	function hideAssist() {
		assist.el?.remove();
		assist.el = null;
	}

	/**
	 * After a window lands in a layout zone, offer the other open windows for
	 * the zones that are still empty, one zone at a time, until the layout is
	 * full or the visitor dismisses it (Esc or a click on the backdrop).
	 */
	function showAssist(layoutId, usedZone, placedId) {
		hideAssist();
		const a = area();
		const layout = snapLayoutsFor(a).find((l) => l.id === layoutId);
		if (!layout) return;
		let free = layout.zones.map((_, i) => i).filter((i) => i !== usedZone);
		const placed = new Set([placedId]);
		const candidates = () =>
			[...wins.values()].filter((o) => !placed.has(o.app.id)).sort((x, y) => y.lastFocus - x.lastFocus);
		if (!free.length || !candidates().length) return;

		const el = document.createElement('div');
		el.className = 'snap-assist';
		el.setAttribute('role', 'dialog');
		el.setAttribute('aria-label', 'Snap assist: choose a window for the empty space');
		el.addEventListener('pointerdown', (e) => {
			if (e.target === el) hideAssist();
		});
		el.addEventListener('keydown', (e) => {
			if (e.key === 'Escape') {
				e.stopPropagation();
				hideAssist();
			}
		});
		el.style.zIndex = String(++zTop + 1);
		let active = free[0];

		function paint() {
			el.replaceChildren();
			const left = candidates();
			if (!free.length || !left.length) return hideAssist();
			if (!free.includes(active)) active = free[0];
			free.forEach((zi) => {
				const r = layoutZoneRect(layoutId, zi, a);
				const zone = document.createElement('div');
				zone.className = `snap-slot${zi === active ? ' is-active' : ''}`;
				Object.assign(zone.style, { left: `${r.x}px`, top: `${r.y - a.y}px`, width: `${r.w}px`, height: `${r.h}px` });
				if (zi !== active) {
					zone.addEventListener('pointerdown', (e) => {
						e.stopPropagation();
						active = zi;
						paint();
					});
					el.append(zone);
					return;
				}
				const list = document.createElement('div');
				list.className = 'snap-cands';
				left.forEach((o) => {
					const c = document.createElement('button');
					c.type = 'button';
					c.className = 'snap-cand';
					c.innerHTML = `<span class="app-tile sm" style="--hue:${o.app.hue}">${icon(o.app.icon, 17)}</span><span class="snap-cand-t"></span>`;
					c.querySelector('.snap-cand-t').textContent = o.title;
					c.title = `Snap ${o.title} here`;
					c.addEventListener('click', () => {
						placed.add(o.app.id);
						place(o.app.id, r);
						free = free.filter((x) => x !== zi);
						el.style.zIndex = String(++zTop + 1);
						paint();
					});
					list.append(c);
				});
				zone.append(list);
				el.append(zone);
			});
			el.querySelector('.snap-cand')?.focus({ preventScroll: true });
		}
		el.style.top = `${a.y}px`;
		layer.append(el);
		assist.el = el;
		paint();
	}

	function open(app, opts = {}) {
		const existing = wins.get(app.id);
		if (existing) {
			if (opts.path && !app.native && isInternalPath(opts.path) && opts.path !== existing.path) {
				existing.path = opts.path;
				existing.frame.src = opts.path;
				existing.extLink.href = opts.path;
			}
			if (opts.arg !== undefined) existing.onArg?.(opts.arg);
			focus(app.id);
			return existing;
		}
		evictIfFull();
		const w = buildWindow(app, opts);
		const a = area();
		w.rect = opts.rect ? clampRect(opts.rect, a) : cascadeRect(opened++, a, app.size);
		wins.set(app.id, w);
		applyRect(w);
		layer.append(w.el);
		if (opts.min) {
			w.min = true;
			w.el.classList.add('is-min');
			w.el.inert = true;
		}
		// Reduced motion skips the zoom-in outright, as close() skips its zoom-out:
		// even shortened to 0.01ms by CSS, the keyframe's first frame still paints
		// the window at 94% scale, 10px low.
		if (!opts.quiet && !reducedMotion()) {
			// Drop the class once the opening plays, or it replays on every restore from minimize.
			w.el.classList.add('is-opening');
			w.el.addEventListener('animationend', function done(e) {
				if (e.target !== w.el) return;
				w.el.classList.remove('is-opening');
				w.el.removeEventListener('animationend', done);
			});
		}
		w.suppressFrameFocus = !!opts.quiet;
		if (!opts.min && !opts.quiet) focus(app.id);
		else emit();
		return w;
	}

	function relayout() {
		hideFlyout(true);
		hideAssist();
		const a = area();
		wins.forEach((w) => {
			if (!w.max) w.rect = clampRect(w.rect, a);
			applyRect(w);
		});
	}

	function snapshot() {
		return {
			windows: [...wins.values()]
				.sort((x, y) => x.z - y.z)
				.map((w) => ({
					app: w.app.id,
					...w.rect,
					max: w.max,
					min: w.min,
					path: w.app.native ? null : w.path,
				})),
			focus: focusedId,
		};
	}

	function cycle(dir = 1) {
		const order = [...wins.values()].sort((a, b) => a.lastFocus - b.lastFocus);
		if (order.length < 2) return;
		const next = dir > 0 ? order[0] : order[order.length - 2];
		focus(next.app.id);
	}

	// A click inside an iframe moves document focus to the frame without any
	// pointer event reaching us, so follow focus to keep z-order truthful.
	window.addEventListener('blur', () => {
		setTimeout(() => {
			const a = document.activeElement;
			if (!a || a.tagName !== 'IFRAME') return;
			const owner = [...wins.values()].find((w) => w.frame === a);
			if (owner && owner.app.id !== focusedId) {
				owner.suppressFrameFocus = true;
				focus(owner.app.id);
				owner.suppressFrameFocus = false;
			}
		}, 0);
	});

	return {
		open,
		close,
		minimize,
		restore,
		focus,
		toggleMax,
		cycle,
		place,
		snapKey,
		snapLayouts: (id) => showFlyout(id, true),
		relayout,
		snapshot,
		reload: (id) => wins.has(id) && reloadFrame(wins.get(id)),
		has: (id) => wins.has(id),
		focused: () => focusedId,
		list: () => [...wins.values()].map(publicView),
		setTitle(id, title) {
			const w = wins.get(id);
			if (!w) return;
			w.title = String(title || w.app.title).slice(0, 80);
			w.el.querySelector('.win-name').textContent = w.title;
			w.el.setAttribute('aria-label', w.title);
			emit();
		},
		closeAll: () => [...wins.keys()].forEach(close),
	};
}

function escapeHtml(s) {
	return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

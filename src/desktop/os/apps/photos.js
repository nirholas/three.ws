// Photos: picture viewer and gallery over the virtual file system (../fs.js).
import './photos.css';
import * as fs from '../fs.js';

/* ---------- pure helpers (unit tested) ---------- */

export const isImageName = (name) => fs.kindOf(String(name)) === 'image';

/** Image files only, newest first (ties broken by name). */
export function newestFirst(nodes) {
	return nodes
		.filter((n) => n.type === 'file' && isImageName(n.name))
		.sort((a, b) => (b.mtime || 0) - (a.mtime || 0) || a.name.localeCompare(b.name, undefined, { numeric: true }));
}

/** Image files in natural name order, for the filmstrip. */
export function byName(nodes) {
	return nodes
		.filter((n) => n.type === 'file' && isImageName(n.name))
		.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
}

/** Step through `count` items, wrapping around. */
export const stepIndex = (i, dir, count) => (count ? (((i + dir) % count) + count) % count : -1);

export const MIN_ZOOM = 0.05;
export const MAX_ZOOM = 16;
export const clampZoom = (z) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));

/** Dimensions after a rotation in degrees (multiples of 90 swap width and height). */
export function rotatedSize(w, h, deg) {
	return Math.round(Math.abs(deg) / 90) % 2 ? { w: h, h: w } : { w, h };
}

/** Scale that fits the whole picture in the box. Never enlarges past 100%. */
export function fitScale(imgW, imgH, boxW, boxH, deg = 0) {
	const r = rotatedSize(imgW, imgH, deg);
	if (!r.w || !r.h || boxW <= 0 || boxH <= 0) return 1;
	return Math.min(1, boxW / r.w, boxH / r.h);
}

/** Keep at least part of the picture on screen while panning. */
export function clampPan(t, shownSize, boxSize, keep = 48) {
	const max = Math.max(0, (shownSize + boxSize) / 2 - keep);
	return Math.max(-max, Math.min(max, t));
}

/**
 * Zoom about a point. `cx`/`cy` are the cursor offsets from the box centre,
 * `v` is { s, x, y }. Returns the new { s, x, y } keeping the point fixed.
 */
export function zoomAt(v, factor, cx, cy) {
	const s = clampZoom(v.s * factor);
	const k = s / v.s;
	return { s, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k };
}

/** "3 of 12" label; empty when nothing is open. */
export const positionLabel = (i, n) => (i >= 0 && n > 0 ? `${i + 1} of ${n}` : '');

/* ---------- the app ---------- */

const GLYPHS = {
	'ph-left': '<path d="M15 5l-7 7 7 7"/>',
	'ph-right': '<path d="M9 5l7 7-7 7"/>',
	'ph-zin': '<circle cx="11" cy="11" r="7"/><path d="m16 16 5 5M11 8v6M8 11h6"/>',
	'ph-zout': '<circle cx="11" cy="11" r="7"/><path d="m16 16 5 5M8 11h6"/>',
	'ph-rotl': '<path d="M4 9a8 8 0 1 1-1 4"/><path d="M4 3v6h6"/>',
	'ph-rotr': '<path d="M20 9a8 8 0 1 0 1 4"/><path d="M20 3v6h-6"/>',
	'ph-fit': '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
	'ph-one': '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 10l2-1.5V15"/>',
	'ph-back': '<rect x="3" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.5"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.5"/><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.5"/>',
};

export function mount(host, ctx) {
	for (const [k, v] of Object.entries(GLYPHS)) ctx.registerGlyph(k, v);
	const { h, esc, icon } = ctx;
	const SLIDE_MS = 3500;

	const root = h('div', 'ph');
	host.append(root);
	let dead = false;
	const urls = new Map(); // path -> { mtime, url } for thumbnails
	let io = null;

	// viewer state
	const v = { path: null, siblings: [], url: null, nw: 0, nh: 0, s: 1, x: 0, y: 0, rot: 0, fit: true, failed: false };
	let slide = null;
	let stage = null;
	let imgEl = null;
	let ro = null;
	const err = (e) => ctx.toast(e?.message || 'Something went wrong');

	/* --- thumbnails --- */
	async function thumbUrl(node) {
		let t = urls.get(node.path);
		if (!t || t.mtime !== node.mtime) {
			if (t) URL.revokeObjectURL(t.url);
			const url = await fs.urlFor(node.path).catch(() => null);
			if (!url) return null;
			t = { mtime: node.mtime, url };
			urls.set(node.path, t);
		}
		return t.url;
	}
	function lazyThumbs(container, nodes) {
		io?.disconnect();
		const byPath = new Map(nodes.map((n) => [n.path, n]));
		io = new IntersectionObserver(
			(entries) => {
				for (const e of entries) {
					if (!e.isIntersecting) continue;
					io.unobserve(e.target);
					const node = byPath.get(e.target.dataset.path);
					if (!node) continue;
					thumbUrl(node).then((u) => {
						if (!u || dead || !e.target.isConnected) return;
						const img = new Image();
						img.alt = '';
						img.decoding = 'async';
						img.onload = () => e.target.replaceChildren(img);
						img.onerror = () => e.target.classList.add('broken');
						img.src = u;
					});
				}
			},
			{ rootMargin: '300px' },
		);
		for (const el of container.querySelectorAll('[data-path]')) io.observe(el);
	}

	/* --- gallery --- */
	async function showGallery() {
		stopSlide();
		leaveViewer();
		ctx.setTitle('Photos');
		root.className = 'ph ph-gallery';
		root.innerHTML = `<div class="ph-head"><h2>Photos</h2><span class="ph-sub" aria-live="polite"></span></div><div class="ph-grid" aria-busy="true">${'<i class="ph-sk"></i>'.repeat(12)}</div>`;
		let nodes = [];
		try {
			const [a, b] = await Promise.all([fs.walk('/Pictures'), fs.walk('/Downloads')]);
			nodes = newestFirst([...a, ...b]);
		} catch (e) {
			if (dead) return;
			root.querySelector('.ph-grid').outerHTML = `<div class="ph-empty err">${icon('close', 44)}<h3>Your pictures could not be loaded</h3><p>${esc(e?.message || 'Storage is unavailable.')}</p><div class="ph-empty-act"><button class="ph-pill primary" data-act="retry">Try again</button></div></div>`;
			return;
		}
		if (dead || v.path) return;
		const sub = root.querySelector('.ph-sub');
		if (!nodes.length) {
			root.querySelector('.ph-grid').outerHTML = `<div class="ph-empty">${icon('image', 44)}<h3>No pictures yet</h3><p>Take a photo with Camera, or upload pictures in File Explorer. Anything saved in Pictures or Downloads shows up here.</p><div class="ph-empty-act"><button class="ph-pill primary" data-act="camera">Open Camera</button><button class="ph-pill" data-act="explorer">Open File Explorer</button></div></div>`;
			sub.textContent = '';
			return;
		}
		sub.textContent = `${nodes.length} ${nodes.length === 1 ? 'picture' : 'pictures'}`;
		const grid = root.querySelector('.ph-grid');
		grid.removeAttribute('aria-busy');
		grid.innerHTML = nodes.map((n) => `<button class="ph-cell" data-path="${esc(n.path)}" title="${esc(n.name)}" aria-label="${esc(n.name)}"><span class="ph-cellimg" data-path="${esc(n.path)}"></span><span class="ph-cellname">${esc(n.name)}</span></button>`).join('');
		lazyThumbs(grid, nodes);
		grid.querySelector('.ph-cell')?.focus({ preventScroll: true });
	}

	/* --- viewer --- */
	function leaveViewer() {
		if (v.url) URL.revokeObjectURL(v.url);
		v.url = null;
		v.path = null;
		ro?.disconnect();
		ro = null;
		stage = imgEl = null;
	}

	async function openImage(path) {
		const node = await fs.stat(path).catch(() => null);
		if (!node || node.type !== 'file' || !isImageName(node.name)) {
			ctx.toast(node ? `${node.name} is not a picture` : 'That picture no longer exists');
			return v.path ? null : showGallery();
		}
		const dir = fs.parentOf(path);
		v.siblings = byName(await fs.list(dir));
		leaveViewer();
		v.path = path;
		v.rot = 0;
		v.fit = true;
		v.failed = false;
		v.nw = v.nh = 0;
		ctx.setTitle(node.name);
		buildViewer(node);
		const url = await fs.urlFor(path);
		if (dead || v.path !== path) {
			if (url) URL.revokeObjectURL(url);
			return;
		}
		if (!url) return failView('This picture could not be read from storage.');
		v.url = url;
		imgEl.onload = () => {
			v.nw = imgEl.naturalWidth;
			v.nh = imgEl.naturalHeight;
			stage.classList.remove('loading');
			fitView();
			renderInfo();
		};
		imgEl.onerror = () => failView("This picture can't be displayed. The file may be damaged or in a format the browser does not support.");
		imgEl.src = url;
	}

	function failView(msg) {
		v.failed = true;
		if (!stage) return;
		stage.classList.remove('loading');
		stage.innerHTML = `<div class="ph-empty err">${icon('image', 44)}<h3>Can&rsquo;t show this picture</h3><p>${esc(msg)}</p></div>`;
		imgEl = null;
	}

	function buildViewer(node) {
		root.className = `ph ph-viewer${slide != null ? ' sliding' : ''}`;
		root.innerHTML = `
			<div class="ph-bar" role="toolbar" aria-label="Photo tools">
				<button class="ph-b" data-act="gallery" title="Back to gallery (Esc)" aria-label="Back to gallery">${icon('ph-back', 17)}</button>
				<div class="ph-title"><b></b><span></span></div>
				<span class="ph-grow"></span>
				<button class="ph-b" data-act="zout" title="Zoom out (-)" aria-label="Zoom out">${icon('ph-zout', 17)}</button>
				<button class="ph-zoom" data-act="fit" title="Fit to window (0)" aria-live="polite">100%</button>
				<button class="ph-b" data-act="zin" title="Zoom in (+)" aria-label="Zoom in">${icon('ph-zin', 17)}</button>
				<button class="ph-b" data-act="actual" title="Actual size (1)" aria-label="Actual size">${icon('ph-one', 17)}</button>
				<button class="ph-b" data-act="rotl" title="Rotate left (Shift+R)" aria-label="Rotate left">${icon('ph-rotl', 17)}</button>
				<button class="ph-b" data-act="rotr" title="Rotate right (R)" aria-label="Rotate right">${icon('ph-rotr', 17)}</button>
				<i class="ph-sep"></i>
				<button class="ph-b" data-act="slide" title="Slideshow (F5)" aria-label="Start slideshow" aria-pressed="false">${icon('play', 17)}</button>
				<button class="ph-b" data-act="paint" title="Edit in Paint" aria-label="Edit in Paint">${icon('paint', 17)}</button>
				<button class="ph-b" data-act="download" title="Download" aria-label="Download">${icon('download', 17)}</button>
				<button class="ph-b danger" data-act="delete" title="Delete (Del)" aria-label="Delete">${icon('trash', 17)}</button>
			</div>
			<div class="ph-stage loading" tabindex="0" aria-label="Picture"><img class="ph-img" alt="${esc(node.name)}" draggable="false" /><div class="ph-spin" aria-label="Loading picture"></div>
				<button class="ph-nav prev" data-act="prev" aria-label="Previous picture">${icon('ph-left', 24)}</button>
				<button class="ph-nav next" data-act="next" aria-label="Next picture">${icon('ph-right', 24)}</button>
			</div>
			<div class="ph-strip" role="listbox" aria-label="Pictures in this folder"></div>`;
		stage = root.querySelector('.ph-stage');
		imgEl = root.querySelector('.ph-img');
		ro = new ResizeObserver(() => v.fit && fitView());
		ro.observe(stage);
		attachPanZoom();
		renderStrip();
		renderInfo();
		stage.focus({ preventScroll: true });
	}

	function renderStrip() {
		const strip = root.querySelector('.ph-strip');
		if (!strip) return;
		strip.hidden = v.siblings.length < 2;
		strip.innerHTML = v.siblings.map((n) => `<button class="ph-th${n.path === v.path ? ' on' : ''}" role="option" aria-selected="${n.path === v.path}" data-open="${esc(n.path)}" title="${esc(n.name)}"><span class="ph-thimg" data-path="${esc(n.path)}"></span></button>`).join('');
		lazyThumbs(strip, v.siblings);
		strip.querySelector('.on')?.scrollIntoView({ inline: 'center', block: 'nearest' });
	}

	function renderInfo() {
		if (!v.path) return;
		const i = v.siblings.findIndex((n) => n.path === v.path);
		const dims = v.nw ? `${v.nw} × ${v.nh}` : '';
		root.querySelector('.ph-title b').textContent = fs.nameOf(v.path);
		root.querySelector('.ph-title span').textContent = [positionLabel(i, v.siblings.length), dims].filter(Boolean).join('   ');
		const multi = v.siblings.length > 1;
		root.querySelectorAll('.ph-nav').forEach((b) => (b.hidden = !multi));
		const z = root.querySelector('.ph-zoom');
		if (z) z.textContent = `${Math.round(v.s * 100)}%`;
	}

	function applyTransform() {
		if (!imgEl) return;
		const r = rotatedSize(v.nw, v.nh, v.rot);
		const box = stage.getBoundingClientRect();
		v.x = clampPan(v.x, r.w * v.s, box.width);
		v.y = clampPan(v.y, r.h * v.s, box.height);
		imgEl.style.transform = `translate(calc(-50% + ${v.x}px), calc(-50% + ${v.y}px)) rotate(${v.rot}deg) scale(${v.s})`;
		stage.classList.toggle('pannable', r.w * v.s > box.width || r.h * v.s > box.height);
		const z = root.querySelector('.ph-zoom');
		if (z) z.textContent = `${Math.round(v.s * 100)}%`;
	}
	function fitView() {
		if (!imgEl || !v.nw) return;
		const box = stage.getBoundingClientRect();
		v.s = fitScale(v.nw, v.nh, box.width, box.height, v.rot);
		v.x = v.y = 0;
		v.fit = true;
		applyTransform();
	}
	function zoomBy(factor, clientX, clientY) {
		if (!imgEl || !v.nw) return;
		const box = stage.getBoundingClientRect();
		const cx = clientX == null ? 0 : clientX - (box.left + box.width / 2);
		const cy = clientY == null ? 0 : clientY - (box.top + box.height / 2);
		Object.assign(v, zoomAt(v, factor, cx, cy));
		v.fit = false;
		applyTransform();
	}
	function actualSize() {
		if (!imgEl || !v.nw) return;
		v.s = 1;
		v.x = v.y = 0;
		v.fit = false;
		applyTransform();
	}
	function rotate(deg) {
		if (!imgEl || !v.nw) return;
		v.rot = (v.rot + deg + 360) % 360;
		imgEl.classList.add('turning');
		fitView();
	}

	function attachPanZoom() {
		let drag = null;
		stage.addEventListener('wheel', (e) => {
			if (!imgEl) return;
			e.preventDefault();
			zoomBy(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX, e.clientY);
		}, { passive: false });
		stage.addEventListener('pointerdown', (e) => {
			if (e.button !== 0 || e.target.closest('.ph-nav') || !imgEl) return;
			drag = { id: e.pointerId, px: e.clientX, py: e.clientY, x: v.x, y: v.y };
			stage.setPointerCapture(e.pointerId);
			stage.classList.add('dragging');
			imgEl.classList.remove('turning');
		});
		stage.addEventListener('pointermove', (e) => {
			if (!drag || drag.id !== e.pointerId) return;
			v.x = drag.x + e.clientX - drag.px;
			v.y = drag.y + e.clientY - drag.py;
			v.fit = false;
			applyTransform();
		});
		const end = (e) => {
			if (drag && drag.id === e.pointerId) {
				drag = null;
				stage.classList.remove('dragging');
			}
		};
		stage.addEventListener('pointerup', end);
		stage.addEventListener('pointercancel', end);
		stage.addEventListener('dblclick', (e) => {
			if (e.target.closest('.ph-nav') || !imgEl) return;
			const r = Math.abs(v.s - 1) < 0.01;
			if (r) fitView();
			else {
				const f = 1 / v.s;
				zoomBy(f, e.clientX, e.clientY);
			}
		});
	}

	/* --- navigation, slideshow, actions --- */
	function go(dir) {
		const i = v.siblings.findIndex((n) => n.path === v.path);
		const j = stepIndex(i, dir, v.siblings.length);
		if (j >= 0 && j !== i) openImage(v.siblings[j].path);
	}
	function startSlide() {
		if (v.siblings.length < 2) return ctx.toast('Add more pictures to this folder to run a slideshow');
		slide = setInterval(() => go(1), SLIDE_MS);
		root.classList.add('sliding');
		root.querySelector('[data-act="slide"]')?.setAttribute('aria-pressed', 'true');
		root.requestFullscreen?.().catch(() => {});
	}
	function stopSlide() {
		if (slide == null) return;
		clearInterval(slide);
		slide = null;
		root.classList.remove('sliding');
		root.querySelector('[data-act="slide"]')?.setAttribute('aria-pressed', 'false');
		if (document.fullscreenElement === root) document.exitFullscreen?.().catch(() => {});
	}

	async function removeCurrent() {
		const path = v.path;
		if (!path) return;
		const i = v.siblings.findIndex((n) => n.path === path);
		try {
			await fs.remove(path);
		} catch (e) {
			return err(e);
		}
		ctx.toast(`Moved ${fs.nameOf(path)} to the Recycle Bin`);
		const rest = v.siblings.filter((n) => n.path !== path);
		if (!rest.length) return showGallery();
		openImage(rest[Math.min(i, rest.length - 1)].path);
	}
	async function download() {
		if (!v.path) return;
		try {
			const f = await fs.read(v.path);
			if (!f) throw new Error('That picture no longer exists');
			const url = URL.createObjectURL(f.blob);
			const a = h('a');
			a.href = url;
			a.download = fs.nameOf(v.path);
			root.append(a);
			a.click();
			a.remove();
			setTimeout(() => URL.revokeObjectURL(url), 4000);
		} catch (e) {
			err(e);
		}
	}

	const actions = {
		gallery: showGallery,
		retry: showGallery,
		camera: () => ctx.launchId('camera'),
		explorer: () => ctx.launchId('files', { arg: '/Pictures' }),
		prev: () => go(-1),
		next: () => go(1),
		zin: () => zoomBy(1.25),
		zout: () => zoomBy(0.8),
		fit: fitView,
		actual: actualSize,
		rotl: () => rotate(-90),
		rotr: () => rotate(90),
		slide: () => (slide == null ? startSlide() : stopSlide()),
		paint: () => v.path && ctx.launchId('paint', { arg: v.path }),
		download,
		delete: removeCurrent,
	};

	root.addEventListener('click', (e) => {
		const a = e.target.closest('[data-act]');
		if (a) {
			if (a.dataset.act === 'next' || a.dataset.act === 'prev') stopSlide();
			return actions[a.dataset.act]?.();
		}
		if (slide != null && e.target.closest('.ph-stage')) return stopSlide();
		const o = e.target.closest('[data-open]');
		if (o) {
			stopSlide();
			return openImage(o.dataset.open);
		}
		const cell = e.target.closest('.ph-cell');
		if (cell) openImage(cell.dataset.path);
	});
	root.addEventListener('keydown', (e) => {
		if (!v.path) return;
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		const k = e.key;
		const hit = (fn) => (e.preventDefault(), fn());
		if (k === 'ArrowLeft') return hit(() => (stopSlide(), go(-1)));
		if (k === 'ArrowRight') return hit(() => (stopSlide(), go(1)));
		if (k === '+' || k === '=') return hit(() => zoomBy(1.25));
		if (k === '-' || k === '_') return hit(() => zoomBy(0.8));
		if (k === '0') return hit(fitView);
		if (k === '1') return hit(actualSize);
		if (k === 'r') return hit(() => rotate(90));
		if (k === 'R') return hit(() => rotate(-90));
		if (k === 'F5') return hit(actions.slide);
		if (k === 'Delete') return hit(removeCurrent);
		if (k === 'Home') return hit(() => v.siblings[0] && openImage(v.siblings[0].path));
		if (k === 'End') return hit(() => v.siblings.length && openImage(v.siblings[v.siblings.length - 1].path));
		if (k === 'Escape') return hit(() => (slide != null ? stopSlide() : showGallery()));
		const pan = { ArrowUp: [0, 60], ArrowDown: [0, -60] }[k];
		if (pan && !v.fit) hit(() => ((v.y += pan[1]), applyTransform()));
	});
	const onFs = () => {
		if (!document.fullscreenElement && slide != null) stopSlide();
	};
	document.addEventListener('fullscreenchange', onFs);

	/* --- live refresh --- */
	let refreshTimer = 0;
	const unsub = fs.subscribe(() => {
		clearTimeout(refreshTimer);
		refreshTimer = setTimeout(async () => {
			if (dead) return;
			if (!v.path) {
				if (root.classList.contains('ph-gallery')) showGallery();
				return;
			}
			const still = await fs.stat(v.path).catch(() => null);
			if (!still) {
				const rest = v.siblings.filter((n) => n.path !== v.path);
				return rest.length ? openImage(rest[0].path) : showGallery();
			}
			v.siblings = byName(await fs.list(fs.parentOf(v.path)));
			renderStrip();
			renderInfo();
		}, 120);
	});

	/* --- launch --- */
	async function applyArg(arg) {
		if (typeof arg === 'string' && arg) {
			const p = fs.normalize(arg);
			const node = await fs.stat(p).catch(() => null);
			if (node?.type === 'file') return openImage(p);
			if (!node) ctx.toast(`${arg} does not exist`);
		}
		return showGallery();
	}
	ctx.onArg(applyArg);
	applyArg(ctx.arg);

	return () => {
		dead = true;
		stopSlide();
		clearTimeout(refreshTimer);
		unsub();
		io?.disconnect();
		ro?.disconnect();
		document.removeEventListener('fullscreenchange', onFs);
		if (v.url) URL.revokeObjectURL(v.url);
		for (const t of urls.values()) URL.revokeObjectURL(t.url);
		urls.clear();
	};
}

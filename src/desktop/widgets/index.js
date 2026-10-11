// The desktop widgets: a board that slides up from the taskbar (widgets on the
// left, the live news desk on the right) and widgets pinned on the desktop
// itself, dragged on a snapping grid, resized, added from a gallery and
// removed in edit mode. Layouts persist per browser. The shell drives it
// through toggleWidgets, mountDesktopWidgets, editDesktopWidgets and
// addDesktopWidget; README.md lists what each takes.

import './widgets.css';
import { icon } from '../icons.js';
import { CATALOG, DEFAULT_LAYOUT, SIZES, STEP, catalogItem, cellAt, firstFit, fits, gridFor, pixelBox, relTime, settle } from './logic.js';
import { renderWidget, handleBrokenImages, WIDGET_ICONS } from './render.js';
import { refresh, subscribe } from './data.js';

const DESK_KEY = 'tws-widgets:desktop';
const BOARD_KEY = 'tws-widgets:board';
const BOARD_DEFAULT = [
	{ type: 'three', size: 'm' },
	{ type: 'weather', size: 'm' },
	{ type: 'clock', size: 's' },
	{ type: 'platform', size: 's' },
	{ type: 'agents', size: 'm' },
	{ type: 'launches', size: 'l' },
	{ type: 'calendar', size: 'l' },
];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const LOCALE = navigator.language || 'en-US';

function load(key, fallback) {
	try {
		const v = JSON.parse(localStorage.getItem(key) || 'null');
		if (Array.isArray(v)) return v;
	} catch {
		/* storage blocked or corrupt: start from the default */
	}
	return fallback.map((w) => ({ ...w }));
}
function save(key, list) {
	try {
		localStorage.setItem(key, JSON.stringify(list.map(({ id, type, size, col, row, data }) => ({ id, type, size, col, row, ...(data ? { data } : {}) }))));
	} catch {
		/* storage blocked: the layout lasts for this visit */
	}
}
const newId = () => `w${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ---------- small menu ----------

// Menus and the gallery mount inside the shell root so they inherit the .os theme tokens.
let osRoot = null;
const layerHost = () => (osRoot?.isConnected ? osRoot : document.body);
let openMenu = null;
function closeMenu() {
	openMenu?.remove();
	openMenu = null;
}
function menu(x, y, items, host = layerHost()) {
	closeMenu();
	const m = document.createElement('div');
	m.className = 'wgx-menu';
	m.setAttribute('role', 'menu');
	for (const it of items) {
		if (it === '-') {
			m.append(Object.assign(document.createElement('hr'), {}));
			continue;
		}
		const [label, ic, fn, on] = it;
		const b = document.createElement('button');
		b.type = 'button';
		b.setAttribute('role', 'menuitem');
		if (on) b.classList.add('on');
		b.innerHTML = `${icon(ic, 15)}<span>${esc(label)}</span>${on ? icon('check', 14) : ''}`;
		b.addEventListener('click', (e) => {
			e.stopPropagation();
			closeMenu();
			fn();
		});
		m.append(b);
	}
	host.append(m);
	const r = m.getBoundingClientRect();
	m.style.left = `${Math.max(8, Math.min(x, innerWidth - r.width - 8))}px`;
	m.style.top = `${Math.max(8, Math.min(y, innerHeight - r.height - 8))}px`;
	openMenu = m;
	m.querySelector('button')?.focus({ preventScroll: true });
	m.addEventListener('keydown', (e) => {
		const bs = [...m.querySelectorAll('button')];
		const i = bs.indexOf(document.activeElement);
		if (e.key === 'ArrowDown') bs[(i + 1) % bs.length].focus();
		else if (e.key === 'ArrowUp') bs[(i - 1 + bs.length) % bs.length].focus();
		else if (e.key === 'Escape') closeMenu();
		else return;
		e.preventDefault();
	});
}
addEventListener('pointerdown', (e) => openMenu && !openMenu.contains(e.target) && closeMenu(), true);
addEventListener('blur', closeMenu);

// ---------- one widget card ----------

/**
 * Build a widget card. `opts.menu(w)` returns the extra menu items for where
 * the card lives (desktop or board); `opts.onSave(w)` persists `w.data`.
 */
function card(w, ctx, opts) {
	const item = catalogItem(w.type);
	const el = document.createElement('section');
	el.className = `wgx t-${w.type} sz-${w.size}`;
	el.dataset.id = w.id;
	el.setAttribute('aria-label', `${item.title} widget`);
	const head = document.createElement('header');
	head.innerHTML =
		`<button type="button" class="wgx-title" ${item.app ? '' : 'disabled'} title="${item.app ? `Open ${esc(item.title)}` : esc(item.title)}">${icon(WIDGET_ICONS[w.type] || 'widgets', 14)}<b>${esc(item.title)}</b></button>` +
		`<button type="button" class="wgx-more" aria-label="${esc(item.title)} widget options" aria-haspopup="menu">${icon('more', 16)}</button>`;
	const body = document.createElement('div');
	body.className = 'wgx-body';
	el.append(head, body);
	handleBrokenImages(el);
	if (item.app) head.querySelector('.wgx-title').addEventListener('click', () => ctx.launchId(item.app));
	const items = () => [
		...item.sizes.map((s) => [SIZES[s].label, 'maximize', () => opts.resize(w, s), w.size === s]),
		'-',
		...(item.feeds.length ? [['Refresh', 'reload', () => item.feeds.forEach(refresh)]] : []),
		...(item.app ? [[`Open ${item.title}`, 'external', () => ctx.launchId(item.app)]] : []),
		...opts.menu(w),
	];
	const more = head.querySelector('.wgx-more');
	more.addEventListener('click', (e) => {
		e.stopPropagation();
		const r = more.getBoundingClientRect();
		menu(r.left, r.bottom + 4, items());
	});
	el.addEventListener('contextmenu', (e) => {
		if (e.target.closest('textarea, input')) return;
		e.preventDefault();
		e.stopPropagation();
		menu(e.clientX, e.clientY, items());
	});
	let cleanup = renderWidget(body, w, {
		launchId: ctx.launchId,
		toast: ctx.toast,
		save: (data) => {
			w.data = data;
			opts.onSave(w);
		},
	});
	el.dispose = () => {
		cleanup();
		cleanup = () => {};
	};
	return el;
}

// ---------- the Add widget gallery ----------

function gallery(ctx, onAdd, title = 'Add a widget') {
	const back = document.createElement('div');
	back.className = 'wgx-gallery-back';
	const dlg = document.createElement('div');
	dlg.className = 'wgx-gallery';
	dlg.setAttribute('role', 'dialog');
	dlg.setAttribute('aria-modal', 'true');
	dlg.setAttribute('aria-label', title);
	let pick = CATALOG[0];
	let size = pick.sizes[0];
	let preview = null;
	dlg.innerHTML =
		`<header><b>${esc(title)}</b><button type="button" class="wgx-btn icon" data-close aria-label="Close">${icon('close', 16)}</button></header>` +
		`<div class="wgx-gal-main"><ul class="wgx-gal-list" role="listbox" aria-label="Widgets">${CATALOG.map((c, i) => `<li><button type="button" role="option" data-i="${i}">${icon(WIDGET_ICONS[c.type], 18)}<span><b>${esc(c.title)}</b><small>${esc(c.desc)}</small></span></button></li>`).join('')}</ul>` +
		`<div class="wgx-gal-preview"><div class="wgx-gal-stage"></div><div class="wgx-gal-sizes" role="radiogroup" aria-label="Size"></div><button type="button" class="wgx-btn primary wgx-gal-add">${icon('pin', 15)}Add widget</button></div></div>`;
	back.append(dlg);
	layerHost().append(back);
	const stage = dlg.querySelector('.wgx-gal-stage');
	const sizes = dlg.querySelector('.wgx-gal-sizes');
	const paint = () => {
		dlg.querySelectorAll('[data-i]').forEach((b) => b.setAttribute('aria-selected', String(CATALOG[b.dataset.i] === pick)));
		sizes.innerHTML = pick.sizes.map((s) => `<button type="button" role="radio" aria-checked="${s === size}" data-s="${s}">${SIZES[s].label}</button>`).join('');
		sizes.querySelectorAll('[data-s]').forEach((b) =>
			b.addEventListener('click', () => {
				size = b.dataset.s;
				paint();
			}),
		);
		preview?.dispose();
		preview = card({ id: 'preview', type: pick.type, size }, ctx, { menu: () => [], resize: (_, s) => ((size = s), paint()), onSave: () => {} });
		preview.classList.add('preview');
		stage.replaceChildren(preview);
	};
	dlg.querySelectorAll('[data-i]').forEach((b) =>
		b.addEventListener('click', () => {
			pick = CATALOG[b.dataset.i];
			size = pick.sizes[0];
			paint();
		}),
	);
	const close = () => {
		preview?.dispose();
		back.remove();
		removeEventListener('keydown', onKey, true);
	};
	const onKey = (e) => {
		if (e.key === 'Escape') {
			e.stopPropagation();
			close();
		}
	};
	addEventListener('keydown', onKey, true);
	back.addEventListener('pointerdown', (e) => e.target === back && close());
	dlg.querySelector('[data-close]').addEventListener('click', close);
	dlg.querySelector('.wgx-gal-add').addEventListener('click', () => {
		if (onAdd({ type: pick.type, size }) !== false) close();
	});
	paint();
	dlg.querySelector('[data-i]').focus({ preventScroll: true });
}

// ---------- desktop widgets ----------

let desk = null;

export function mountDesktopWidgets(ctx) {
	desk?.destroy();
	osRoot = ctx.root || osRoot;
	const host = ctx.desktop || ctx.root;
	const insets = typeof ctx.insets === 'function' ? ctx.insets : () => ({ top: 12, right: 12, bottom: 84, left: 120 });
	const layer = document.createElement('div');
	layer.className = 'wgx-desk';
	layer.setAttribute('role', 'region');
	layer.setAttribute('aria-label', 'Desktop widgets');
	const bar = document.createElement('div');
	bar.className = 'wgx-editbar';
	bar.innerHTML = `<button type="button" class="wgx-btn primary" data-add>${icon('plus', 15)}Add widget</button><button type="button" class="wgx-btn" data-done>${icon('check', 15)}Done</button>`;
	const ghost = document.createElement('div');
	ghost.className = 'wgx-ghost';
	layer.append(ghost, bar);
	host.append(layer);

	let stored = load(DESK_KEY, DEFAULT_LAYOUT);
	let laid = [];
	let grid = { cols: 0, rows: 0 };
	const cards = new Map();

	const persist = () => save(DESK_KEY, stored);
	function place(el, w) {
		const b = pixelBox(w);
		el.style.right = `${b.right}px`;
		el.style.top = `${b.top}px`;
		el.style.width = `${b.width}px`;
		el.style.height = `${b.height}px`;
	}
	function frame() {
		const i = insets();
		layer.style.inset = `${i.top}px ${i.right}px ${i.bottom}px ${i.left}px`;
		const r = layer.getBoundingClientRect();
		grid = gridFor(r.width, r.height);
	}
	function render() {
		frame();
		laid = settle(stored, grid);
		// Settling gives every stored widget a stable id; keep those.
		stored = laid.map((w) => ({ ...w, hidden: undefined }));
		const live = new Set();
		for (const w of laid) {
			if (w.hidden) continue;
			live.add(w.id);
			let el = cards.get(w.id);
			if (el && (el.dataset.size !== w.size)) {
				el.dispose();
				el.remove();
				el = null;
			}
			if (!el) {
				el = card(w, ctx, {
					menu: (x) => [
						'-',
						['Edit widgets', 'edit', () => setEdit(true)],
						['Remove from desktop', 'close', () => remove(x.id)],
					],
					resize,
					onSave: (x) => {
						const s = stored.find((o) => o.id === x.id);
						if (s) s.data = x.data;
						persist();
					},
				});
				el.dataset.size = w.size;
				const x = document.createElement('button');
				x.type = 'button';
				x.className = 'wgx-x';
				x.setAttribute('aria-label', `Remove ${catalogItem(w.type).title}`);
				x.innerHTML = icon('close', 12);
				x.addEventListener('click', (e) => {
					e.stopPropagation();
					remove(w.id);
				});
				el.append(x);
				drag(el, w.id);
				cards.set(w.id, el);
				layer.insertBefore(el, ghost);
			}
			place(el, w);
		}
		for (const [id, el] of cards) {
			if (live.has(id)) continue;
			el.dispose();
			el.remove();
			cards.delete(id);
		}
		layer.classList.toggle('empty', !live.size);
	}
	function remove(id) {
		stored = stored.filter((w) => w.id !== id);
		persist();
		render();
	}
	function resize(w, size) {
		const s = stored.find((o) => o.id === w.id);
		if (!s || s.size === size) return;
		const others = laid.filter((o) => !o.hidden && o.id !== w.id);
		const next = { ...s, size };
		if (fits(next, s.col, s.row, others, grid)) s.size = size;
		else {
			const at = firstFit(next, others, grid);
			if (!at) return ctx.toast?.('No room for a bigger widget. Remove one or make one smaller.');
			Object.assign(s, { size }, at);
		}
		persist();
		render();
	}
	function add(spec) {
		const w = { id: newId(), ...spec };
		const at = firstFit(w, laid.filter((o) => !o.hidden), grid);
		if (!at) {
			ctx.toast?.('No room on the desktop. Remove a widget or make one smaller.');
			return false;
		}
		stored.push({ ...w, ...at });
		persist();
		render();
		cards.get(w.id)?.scrollIntoView?.({ block: 'nearest' });
		return true;
	}

	// Drag by the header, snapping to the grid; a drop on a taken cell springs back.
	function drag(el, id) {
		const head = el.querySelector('header');
		head.addEventListener('pointerdown', (e) => {
			if (e.button !== 0 || e.target.closest('.wgx-more')) return;
			const w = laid.find((o) => o.id === id);
			if (!w) return;
			const lr = layer.getBoundingClientRect();
			const er = el.getBoundingClientRect();
			const offX = e.clientX - er.left;
			const offY = e.clientY - er.top;
			let moved = false;
			let target = null;
			const onMove = (ev) => {
				if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 5) return;
				if (!moved) {
					moved = true;
					el.classList.add('dragging');
					head.setPointerCapture?.(e.pointerId);
				}
				const left = ev.clientX - offX - lr.left;
				const top = ev.clientY - offY - lr.top;
				el.style.right = `${lr.width - left - er.width}px`;
				el.style.top = `${top}px`;
				const cell = cellAt(lr.width - left - er.width, top);
				const ok = fits(w, cell.col, cell.row, laid.filter((o) => !o.hidden), grid);
				target = ok ? cell : null;
				ghost.classList.toggle('on', ok);
				if (ok) {
					const b = pixelBox({ ...w, ...cell });
					Object.assign(ghost.style, { right: `${b.right}px`, top: `${b.top}px`, width: `${b.width}px`, height: `${b.height}px` });
				}
			};
			const onUp = () => {
				removeEventListener('pointermove', onMove);
				removeEventListener('pointerup', onUp);
				removeEventListener('pointercancel', onUp);
				ghost.classList.remove('on');
				el.classList.remove('dragging');
				if (!moved) return;
				el.classList.add('was-dragged');
				setTimeout(() => el.classList.remove('was-dragged'), 0);
				const s = stored.find((o) => o.id === id);
				if (target && s) {
					Object.assign(s, target);
					persist();
				}
				render();
			};
			addEventListener('pointermove', onMove);
			addEventListener('pointerup', onUp);
			addEventListener('pointercancel', onUp);
		});
		// Suppress the title's "open app" click when the press was a drag.
		head.addEventListener('click', (e) => el.classList.contains('was-dragged') && e.stopPropagation(), true);
	}

	function setEdit(on) {
		layer.classList.toggle('editing', on);
		if (on) bar.querySelector('[data-add]').focus({ preventScroll: true });
	}
	bar.querySelector('[data-add]').addEventListener('click', () => gallery(ctx, add));
	bar.querySelector('[data-done]').addEventListener('click', () => setEdit(false));
	const onKey = (e) => e.key === 'Escape' && layer.classList.contains('editing') && !document.querySelector('.wgx-gallery') && setEdit(false);
	addEventListener('keydown', onKey);
	let raf = 0;
	const ro = new ResizeObserver(() => {
		cancelAnimationFrame(raf);
		raf = requestAnimationFrame(render);
	});
	ro.observe(host);
	render();

	desk = {
		edit: (on = !layer.classList.contains('editing')) => setEdit(on),
		add: (spec) => add(spec),
		openGallery: () => gallery(ctx, add),
		relayout: render,
		destroy() {
			ro.disconnect();
			removeEventListener('keydown', onKey);
			cards.forEach((el) => el.dispose());
			layer.remove();
			desk = null;
		},
	};
	return desk;
}

/** Toggle edit mode on the desktop widgets (desktop context menu "Edit widgets"). */
export function editDesktopWidgets(on) {
	desk?.edit(on);
}

/** Open the Add widget gallery for the desktop. */
export function addDesktopWidget() {
	if (!desk) return;
	desk.edit(true);
	desk.openGallery();
}

// ---------- the widgets board ----------

let board = null;

export function toggleWidgets(ctx) {
	if (board) {
		board.close();
		return false;
	}
	osRoot = ctx.root || osRoot;
	const anchor = ctx.anchor;
	const panel = document.createElement('div');
	panel.className = 'wgx-board';
	panel.setAttribute('role', 'dialog');
	panel.setAttribute('aria-label', 'Widgets');
	panel.innerHTML =
		`<div class="wgx-col wgx-col-w"><div class="wgx-bar"><span class="wgx-hello"><b></b><small></small></span><button type="button" class="wgx-btn icon" data-add title="Add a widget" aria-label="Add a widget">${icon('plus', 16)}</button></div><div class="wgx-grid"></div></div>` +
		`<div class="wgx-col wgx-col-n"><div class="wgx-bar"><span class="wgx-hello"><b>News</b><small>Headlines from the three.ws news desk, linked to each publisher</small></span><button type="button" class="wgx-btn icon" data-refresh title="Refresh news" aria-label="Refresh news">${icon('reload', 16)}</button></div><div class="wgx-feed" aria-live="polite"></div></div>`;
	(ctx.root || document.body).append(panel);
	handleBrokenImages(panel);

	const hello = panel.querySelector('.wgx-hello b');
	const sub = panel.querySelector('.wgx-hello small');
	const greet = () => {
		const d = new Date();
		const h = d.getHours();
		hello.textContent = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
		sub.textContent = `${d.toLocaleDateString(LOCALE, { weekday: 'long', month: 'long', day: 'numeric' })} · ${d.toLocaleTimeString(LOCALE, { hour: 'numeric', minute: '2-digit' })}`;
	};
	greet();
	const greetTimer = setInterval(greet, 15_000);

	// Position above the taskbar button, centred on screen like the shell's flyouts.
	const place = () => {
		const r = anchor?.getBoundingClientRect?.();
		const bottomGap = r ? Math.max(8, innerHeight - r.top + 10) : 84;
		panel.style.bottom = `${bottomGap}px`;
		panel.style.maxHeight = `${Math.max(320, innerHeight - bottomGap - 16)}px`;
	};
	place();
	addEventListener('resize', place);

	// Widgets column.
	const gridEl = panel.querySelector('.wgx-grid');
	let list = settle(load(BOARD_KEY, BOARD_DEFAULT), { cols: 99, rows: 99 }).map(({ hidden, col, row, ...w }) => w);
	const cards = [];
	const persist = () => save(BOARD_KEY, list);
	const paintGrid = () => {
		cards.splice(0).forEach((c) => c.dispose());
		gridEl.replaceChildren();
		if (!list.length) {
			gridEl.innerHTML = `<div class="wgx-empty big"><span>Your board is empty.</span><button type="button" class="wgx-btn primary">${icon('plus', 15)}Add a widget</button></div>`;
			gridEl.querySelector('button').addEventListener('click', openAdd);
			return;
		}
		for (const w of list) {
			const el = card(w, ctx, {
				menu: (x) => [
					'-',
					...(desk ? [['Pin to desktop', 'pin', () => desk.add({ type: x.type, size: x.size, ...(x.data ? { data: x.data } : {}) }) && ctx.toast?.(`${catalogItem(x.type).title} pinned to the desktop`)]] : []),
					['Move up', 'chevron', () => move(x.id, -1)],
					['Remove', 'close', () => {
						list = list.filter((o) => o.id !== x.id);
						persist();
						paintGrid();
					}],
				],
				resize: (x, s) => {
					x.size = s;
					persist();
					paintGrid();
				},
				onSave: persist,
			});
			cards.push(el);
			gridEl.append(el);
		}
	};
	const move = (id, d) => {
		const i = list.findIndex((o) => o.id === id);
		const j = i + d;
		if (i < 0 || j < 0 || j >= list.length) return;
		[list[i], list[j]] = [list[j], list[i]];
		persist();
		paintGrid();
	};
	const openAdd = () =>
		gallery(ctx, (spec) => {
			list.push({ id: newId(), ...spec });
			persist();
			paintGrid();
			gridEl.lastElementChild?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
		});
	panel.querySelector('[data-add]').addEventListener('click', openAdd);
	paintGrid();

	// News column.
	const feed = panel.querySelector('.wgx-feed');
	feed.innerHTML = `<div class="wgx-skel news" aria-hidden="true">${'<i></i>'.repeat(6)}</div>`;
	const unNews = subscribe('news', (s) => {
		if (s.data === undefined) {
			if (s.error) {
				feed.innerHTML = `<div class="wgx-off"><b>${icon('cloud', 18)} News is offline</b><span>${esc(s.error)}</span><button type="button" class="wgx-btn">Retry</button></div>`;
				feed.querySelector('button').addEventListener('click', () => refresh('news'));
			}
			return;
		}
		if (!s.data.length) {
			feed.innerHTML = '<div class="wgx-empty"><span>No headlines right now. Try again in a few minutes.</span></div>';
			return;
		}
		feed.innerHTML = s.data
			.map(
				(a, i) =>
					`<a class="wgx-story${i === 0 && a.image ? ' lead' : ''}" href="${esc(a.link)}" target="_blank" rel="noopener noreferrer">${a.image ? `<img src="${esc(a.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}<span><small>${esc(a.source)} · ${relTime(a.pub_date)}</small><b>${esc(a.title)}</b>${i < 3 && a.description ? `<em>${esc(a.description.slice(0, 160))}</em>` : ''}</span></a>`,
			)
			.join('');
	});
	panel.querySelector('[data-refresh]').addEventListener('click', () => refresh('news'));

	// Dismiss: outside press, Escape, or the taskbar button again.
	const onDown = (e) => {
		if (panel.contains(e.target) || anchor?.contains?.(e.target) || e.target.closest?.('.wgx-gallery-back, .wgx-menu')) return;
		close();
	};
	const onKey = (e) => {
		if (e.key !== 'Escape' || document.querySelector('.wgx-gallery') || openMenu) return;
		close();
		anchor?.focus?.();
	};
	setTimeout(() => {
		addEventListener('pointerdown', onDown, true);
		addEventListener('blur', onBlur);
	});
	// A press inside a framed page never reaches this document: the window blur is the signal.
	const onBlur = () => setTimeout(() => document.activeElement?.tagName === 'IFRAME' && close(), 0);
	addEventListener('keydown', onKey);
	anchor?.setAttribute?.('aria-expanded', 'true');
	requestAnimationFrame(() => panel.classList.add('in'));
	panel.querySelector('[data-add]').focus({ preventScroll: true });

	function close() {
		if (!board) return;
		board = null;
		clearInterval(greetTimer);
		unNews();
		cards.forEach((c) => c.dispose());
		removeEventListener('pointerdown', onDown, true);
		removeEventListener('blur', onBlur);
		removeEventListener('keydown', onKey);
		removeEventListener('resize', place);
		anchor?.setAttribute?.('aria-expanded', 'false');
		closeMenu();
		panel.classList.remove('in');
		panel.classList.add('out');
		setTimeout(() => panel.remove(), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180);
	}
	board = { close };
	return true;
}

/** Close the board if it is open (the shell calls this when another flyout opens). */
export function closeWidgets() {
	board?.close();
}

// Re-exported so the shell's search can list widgets by name.
export { CATALOG as WIDGET_CATALOG, STEP as WIDGET_STEP };

// The three.ws desktop shell: wallpaper, icons, taskbar, Start menu, widgets,
// calendar, context menu and the two native apps. Windows are owned by wm.js;
// pure rules live in layout.js.

import { ALL_APPS, APPS, CUSTOM_WALL, WALLPAPERS, appById } from './apps.js';
import { icon } from './icons.js';
import { createIconLayer } from './icon-layer.js';
import { createWM } from './wm.js';
import { createChrome } from './chrome/index.js';
import { formatClock, relTime } from './chrome/logic.js';
import { appForPath, mountOsApp } from './os/host.js';
import * as fs from './os/fs.js';
import {
	ACCENTS,
	DEFAULT_PREFS,
	EXPORT_KEYS,
	ICON_SIZES,
	STATE_VERSION,
	STYLES,
	cleanTitle,
	dockScale,
	formatBytes,
	initialsOf,
	isInternalPath,
	pageAppId,
	pagePathOf,
	parseSessionImport,
	rankItems,
	sanitizePrefs,
	sanitizeState,
	storageBytes,
} from './layout.js';

const NAV_DATA = '/nav-data.js';
const KEY = {
	state: 'tws:desktop',
	wall: 'tws:wall',
	view: 'tws:view',
	recent: 'tws:recent',
	welcomed: 'tws:welcomed',
	prefs: 'tws:prefs',
	icons: 'tws:icons',
	iconsV2: 'tws:icons-v2',
};
const THEME_KEY = 'twx_theme';
const WALL_IDS = [...WALLPAPERS.map((w) => w.id), CUSTOM_WALL];

// Large binary state (the custom wallpaper) does not belong in localStorage.
const idb = {
	open() {
		return new Promise((res, rej) => {
			const r = indexedDB.open('tws-desktop', 1);
			r.onupgradeneeded = () => r.result.createObjectStore('kv');
			r.onsuccess = () => res(r.result);
			r.onerror = () => rej(r.error);
		});
	},
	async get(k) {
		try {
			const db = await this.open();
			return await new Promise((res) => {
				const q = db.transaction('kv').objectStore('kv').get(k);
				q.onsuccess = () => res(q.result ?? null);
				q.onerror = () => res(null);
			});
		} catch {
			return null;
		}
	},
	async set(k, v) {
		const db = await this.open();
		await new Promise((res, rej) => {
			const t = db.transaction('kv', 'readwrite');
			t.objectStore('kv').put(v, k);
			t.oncomplete = res;
			t.onerror = () => rej(t.error);
		});
	},
	async del(k) {
		try {
			const db = await this.open();
			await new Promise((res) => {
				const t = db.transaction('kv', 'readwrite');
				t.objectStore('kv').delete(k);
				t.oncomplete = res;
				t.onerror = res;
			});
		} catch {
			/* nothing to delete */
		}
	},
};

/** Downscale an uploaded image so a wallpaper never costs more than a few hundred KB. */
async function shrinkImage(file, maxW = 2560) {
	const bmp = await createImageBitmap(file);
	const k = Math.min(1, maxW / bmp.width);
	const c = document.createElement('canvas');
	c.width = Math.round(bmp.width * k);
	c.height = Math.round(bmp.height * k);
	c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
	return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('encode'))), 'image/jpeg', 0.85));
}

const store = {
	get(k) {
		try {
			return localStorage.getItem(k);
		} catch {
			return null;
		}
	},
	set(k, v) {
		try {
			localStorage.setItem(k, v);
		} catch {
			/* private mode or quota: preferences simply do not persist */
		}
	},
	del(k) {
		try {
			localStorage.removeItem(k);
		} catch {
			/* nothing to remove */
		}
	},
};

const h = (tag, cls, html) => {
	const el = document.createElement(tag);
	if (cls) el.className = cls;
	if (html != null) el.innerHTML = html;
	return el;
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const tile = (app, size = 'sm', glyph = 18) =>
	`<span class="app-tile ${size}" style="--hue:${app.hue}">${icon(app.icon, glyph)}</span>`;

const DESK_PREFIX = 'fs:/Desktop/';
/** Desktop shortcuts into the file system, like a real computer's Computer and Trash. */
const SYSTEM_ICONS = {
	thispc: { id: 'thispc', title: 'Computer', hue: 210, icon: 'pc', desc: 'Your folders, files and storage', fsPath: '/', fsType: 'dir' },
	recycle: { id: 'recycle', title: 'Trash', hue: 195, icon: 'trash', desc: 'Deleted files, ready to restore or empty', fsPath: fs.TRASH, fsType: 'dir' },
};
const FILE_LOOK = {
	dir: { icon: 'folder', hue: 44 },
	text: { icon: 'note', hue: 205 },
	image: { icon: 'image', hue: 285 },
	audio: { icon: 'music', hue: 330 },
	video: { icon: 'video', hue: 8 },
	model: { icon: 'cube', hue: 262 },
	other: { icon: 'files', hue: 220 },
};

/** Build launchable "page apps" from the site's own navigation data. */
async function loadCatalog() {
	try {
		// public/ files are served as-is; a variable keeps vite from bundling it.
		const mod = await import(/* @vite-ignore */ NAV_DATA);
		const seen = new Set(APPS.map((a) => a.href));
		const out = [];
		const take = (it) => {
			if (!it || !isInternalPath(it.href) || seen.has(it.href.split('#')[0])) return;
			seen.add(it.href.split('#')[0]);
			const hue = [...it.href].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 360, 7);
			out.push({
				id: pageAppId(it.href),
				title: cleanTitle(it.title, it.href),
				href: it.href,
				hue,
				icon: 'grid',
				size: { w: 1040, h: 700 },
				desc: it.desc || '',
				keywords: [],
				page: true,
			});
		};
		for (const g of mod.NAV_GROUPS || []) {
			(g.items || []).forEach(take);
			(g.columns || []).forEach((c) => (c.items || []).forEach(take));
		}
		return out;
	} catch {
		return [];
	}
}

export async function createShell(root, opts = {}) {
	const catalog = await loadCatalog();
	const resolveApp = (id) => appById(id) || SYSTEM_ICONS[id] || fileApp(id) || catalog.find((a) => a.id === id) || pageFromId(id);
	// Files and folders saved on the Desktop show up as icons with `fs:<path>` ids.
	const deskFiles = new Map();
	function fileApp(id) {
		if (typeof id !== 'string' || !id.startsWith(DESK_PREFIX)) return null;
		const path = id.slice(3);
		const name = fs.nameOf(path);
		const node = deskFiles.get(path);
		const type = node?.type || (fs.extOf(name) ? 'file' : 'dir');
		const look = type === 'dir' ? FILE_LOOK.dir : FILE_LOOK[fs.kindOf(node?.mime || name)] || FILE_LOOK.other;
		const desc = node && type === 'file' ? `${name}\n${formatBytes(node.size)}, modified ${new Date(node.mtime).toLocaleString()}` : name;
		return { id, title: name, hue: look.hue, icon: look.icon, desc, fsPath: path, fsType: type };
	}
	function pageFromId(id) {
		const p = pagePathOf(id);
		if (!p) return null;
		return { id, title: cleanTitle(p.replace(/^\//, '').replace(/[-_/]/g, ' '), p), href: p, hue: 210, icon: 'grid', size: { w: 1040, h: 700 }, page: true };
	}
	const known = new Set(ALL_APPS.map((a) => a.id));

	root.classList.add('os');
	root.innerHTML = '';
	const wall = h('div', 'os-wall');
	const icons = h('nav', 'os-icons');
	icons.setAttribute('aria-label', 'Desktop');
	const layer = h('div', 'os-layer');
	const task = h('footer', 'os-task');
	// Desktop widgets sit above the icons and below every window.
	const widgetsHost = h('div', 'os-widgets-host');
	root.append(wall, icons, widgetsHost, layer, task);

	// ---------- preferences (the user profile and personalization) ----------
	const loadPrefs = () => {
		const raw = store.get(KEY.prefs);
		const p = sanitizePrefs(raw, WALL_IDS);
		if (!raw) {
			// Carry over choices made before the settings app existed.
			const w = store.get(KEY.wall);
			if (WALL_IDS.includes(w)) p.wall = w;
			p.mode = store.get(THEME_KEY) === 'light' ? 'light' : 'dark';
		}
		return p;
	};
	let prefs = loadPrefs();
	let wallUrl = '';
	const prefsListeners = new Set();
	const dark = matchMedia('(prefers-color-scheme: dark)');
	const effectiveTheme = () => (prefs.mode === 'auto' ? (dark.matches ? 'dark' : 'light') : prefs.mode);
	let deskIcons = null;
	// The bars the work area avoids for the current style. On a phone Aqua
	// falls back to the Fluent taskbar (no menu bar, no magnifying dock).
	const bars = () => {
		const st = STYLES[prefs.style] || STYLES.fluent;
		const small = innerWidth <= 720;
		// Phones get a docked 48px bar (no island, no menu bar, no magnifying dock).
		return small ? { menuH: 0, dockH: prefs.style === 'classic' ? st.dockH : 48 } : { menuH: st.menuH, dockH: st.dockH };
	};
	let shownStyle = null;

	async function applyWall() {
		if (prefs.wall === CUSTOM_WALL) {
			const blob = await idb.get(CUSTOM_WALL);
			if (blob) {
				if (wallUrl) URL.revokeObjectURL(wallUrl);
				wallUrl = URL.createObjectURL(blob);
				wall.style.backgroundImage = `url("${wallUrl}")`;
				wall.dataset.custom = '1';
				root.dataset.wall = CUSTOM_WALL;
				return;
			}
			prefs.wall = DEFAULT_PREFS.wall;
		}
		wall.style.backgroundImage = '';
		delete wall.dataset.custom;
		root.dataset.wall = prefs.wall;
	}
	function applyStyle() {
		const { menuH, dockH } = bars();
		root.dataset.style = prefs.style;
		root.style.setProperty('--menu-h', `${menuH}px`);
		root.style.setProperty('--task-h', `${dockH}px`);
		if (shownStyle === prefs.style) return;
		const first = shownStyle === null;
		shownStyle = prefs.style;
		if (first) return;
		wm.relayout();
		deskIcons?.reseat();
		renderTask();
	}
	function applyPrefs() {
		root.style.setProperty('--accent', prefs.accent);
		root.style.setProperty('--theme-2', prefs.accent);
		task.classList.toggle('left', prefs.taskbarAlign === 'left');
		applyStyle();
		const theme = effectiveTheme();
		document.documentElement.setAttribute('data-theme', theme);
		store.set(THEME_KEY, theme);
		root.querySelectorAll('.win-frame').forEach((f) => {
			try {
				f.contentDocument.documentElement.setAttribute('data-theme', theme);
			} catch {
				/* cross-origin frame */
			}
		});
		prefsListeners.forEach((fn) => fn(prefs));
	}
	function setPrefs(patch) {
		prefs = sanitizePrefs({ ...prefs, ...patch }, WALL_IDS);
		store.set(KEY.prefs, JSON.stringify(prefs));
		store.set(KEY.wall, prefs.wall === CUSTOM_WALL ? DEFAULT_PREFS.wall : prefs.wall);
		if ('wall' in patch) applyWall();
		if ('iconSize' in patch) deskIcons?.setSize(prefs.iconSize);
		applyPrefs();
	}
	dark.addEventListener?.('change', () => prefs.mode === 'auto' && applyPrefs());

	// ---------- system chrome (tray status, clock, quick settings, notifications, power, lock) ----------
	let account = null;
	const chrome = createChrome({
		root,
		store,
		prefs: () => prefs,
		setPrefs,
		onPrefs: (fn) => (prefsListeners.add(fn), () => prefsListeners.delete(fn)),
		openPop: (kind, el, trigger, onClose) => openPop(kind, el, trigger, onClose),
		closePops: () => closePops(),
		menu: (x, y, items, above) => menu(x, y, items, above),
		launchId: (id, o) => launchId(id, o),
		resolveApp: (id) => resolveApp(id),
		searchApps: (q) => (q ? rankItems(q, everything()) : everything()),
		openPath: (path) => openPath(path),
		get wm() {
			return wm;
		},
		save: () => save(),
		displayName: () => displayName(),
		account: () => account,
		tile,
		goClassic: () => goClassic(),
	});
	const toast = (msg) => chrome.toast(msg);
	const notify = (n) => chrome.notify(n);

	// ---------- recent ----------
	const recent = () => {
		try {
			const r = JSON.parse(store.get(KEY.recent) || '[]');
			return Array.isArray(r) ? r.filter((x) => typeof x === 'string') : [];
		} catch {
			return [];
		}
	};
	function pushRecent(id) {
		const next = [id, ...recent().filter((x) => x !== id)].slice(0, 8);
		store.set(KEY.recent, JSON.stringify(next));
	}

	// ---------- window manager ----------
	let running = [];
	let focusId = null;
	let saveTimer = 0;
	const wm = createWM({
		layer,
		getMetrics: () => ({ vw: innerWidth, vh: innerHeight, ...bars(), mobile: innerWidth <= 720 }),
		renderNative: (app, body, win) => renderNative(app, body, win),
		notify: toast,
		getTaskRect: (id) => {
			const b = mid.querySelector(`.os-tb.run[data-app="${CSS.escape(id)}"]`);
			const r = b?.getBoundingClientRect();
			return r && r.width ? r : null;
		},
		onChange: ({ windows, focus }) => {
			running = windows;
			focusId = focus;
			renderTask();
			clearTimeout(saveTimer);
			saveTimer = setTimeout(save, 300);
		},
	});
	function save() {
		store.set(KEY.state, JSON.stringify({ v: STATE_VERSION, ...wm.snapshot() }));
	}
	addEventListener('pagehide', save);

	function launch(app, o = {}) {
		if (!app) return;
		if (app.fsPath) return launch(resolveApp(appForPath(app.fsPath, app.fsType)), { ...o, arg: app.fsPath });
		closePops();
		if (app.id === 'settings' && o.section) {
			if (wm.has('settings') && settingsGo) settingsGo(o.section);
			else pendingSection = o.section;
		}
		pushRecent(app.id);
		wm.open(app, o);
	}
	const launchId = (id, o) => launch(resolveApp(id), o);
	/** Every launchable app: framed pages, Settings, All Apps, the native OS apps and the site catalog. */
	const everything = () => [...ALL_APPS.filter((a) => !a.native || a.os || a.id === 'settings' || a.id === 'apps'), ...catalog];
	/** Open a three.ws path in the app that owns it, or in a page window. */
	function openPath(path) {
		const app = everything().find((a) => a.href === path) || resolveApp(pageAppId(path));
		if (app) launch(app, app.href === path ? {} : { path });
	}

	// ---------- taskbar ----------
	const pinned = [...APPS, ...ALL_APPS.filter((a) => a.native)].filter((a) => a.dock);
	const btnStart = h('button', 'os-tb start', icon('logo', 24));
	btnStart.type = 'button';
	btnStart.setAttribute('aria-label', 'Start');
	btnStart.setAttribute('aria-haspopup', 'dialog');
	btnStart.setAttribute('aria-expanded', 'false');
	btnStart.title = 'Start';
	const btnWidgets = h('button', 'os-tb', icon('widgets', 22));
	btnWidgets.type = 'button';
	btnWidgets.setAttribute('aria-label', 'Widgets and your agent');
	btnWidgets.setAttribute('aria-expanded', 'false');
	btnWidgets.title = 'Widgets';
	const btnAssist = h('button', 'os-tb os-assist', icon('assistant', 21));
	btnAssist.type = 'button';
	btnAssist.setAttribute('aria-label', 'Assistant');
	btnAssist.setAttribute('aria-haspopup', 'dialog');
	btnAssist.setAttribute('aria-expanded', 'false');
	btnAssist.title = 'Assistant (Ctrl+Alt+C)';
	const btnSearch = h('button', 'os-tb hide-sm', icon('search', 20));
	btnSearch.type = 'button';
	btnSearch.setAttribute('aria-label', 'Search apps and pages');
	btnSearch.title = 'Search';

	const left = h('div', 'os-task-left');
	// Aqua's menu bar names the app in front, as macOS does. Hidden in other styles.
	const menuTitle = h('button', 'os-menu-app');
	menuTitle.type = 'button';
	menuTitle.addEventListener('click', (e) => {
		const id = focusId;
		const r = menuTitle.getBoundingClientRect();
		e.stopPropagation();
		if (!id) return toggleStart();
		const w = running.find((x) => x.id === id);
		menu(r.left, r.bottom + 4, [
			['Minimize', 'minimize', () => wm.minimize(id)],
			[w && w.maximized ? 'Restore' : 'Zoom', 'maximize', () => wm.toggleMax(id)],
			['Snap layouts', 'grid', () => wm.snapLayouts(id)],
			['Reload', 'reload', () => wm.reload(id)],
			'-',
			[`Quit ${w ? w.title : ''}`.trim(), 'close', () => wm.close(id)],
		]);
	});
	left.append(btnWidgets, btnAssist, menuTitle);
	const mid = h('div', 'os-task-mid');
	const right = h('div', 'os-task-right');
	task.append(left, mid, right);

	function renderTask() {
		mid.replaceChildren(btnStart, btnSearch);
		const byId = new Map(running.map((w) => [w.id, w]));
		const list = [...pinned];
		running.forEach((w) => {
			if (!list.some((a) => a.id === w.id)) list.push(w.app);
		});
		const front = running.find((x) => x.id === focusId && !x.minimized);
		menuTitle.textContent = front ? front.title : 'three.ws';
		menuTitle.title = front ? `${front.title} window menu` : 'three.ws';
		list.forEach((app) => {
			const w = byId.get(app.id);
			const b = h('button', `os-tb run${w ? ' open' : ''}${w && !w.minimized && focusId === app.id ? ' on' : ''}`, tile(app, 'xs', 15));
			if (w) {
				// Classic shows a labelled button per window; the other styles hide the label.
				const label = h('span', 'tb-label');
				label.textContent = w.title;
				b.append(label);
				b.addEventListener('pointerenter', (e) => e.pointerType !== 'touch' && peekSoon(app.id, b));
				b.addEventListener('pointerleave', peekLeave);
				b.addEventListener('focus', () => peekSoon(app.id, b));
				b.addEventListener('blur', peekLeave);
			}
			b.type = 'button';
			b.dataset.app = app.id;
			b.title = w ? w.title : app.title;
			b.setAttribute('aria-label', w ? `${w.title}, ${w.minimized ? 'minimized' : 'open'}` : `Open ${app.title}`);
			b.addEventListener('click', () => {
				peekHide(true);
				if (!w) return launch(app);
				if (w.minimized) wm.focus(app.id);
				else if (focusId === app.id) wm.minimize(app.id);
				else wm.focus(app.id);
			});
			b.addEventListener('contextmenu', (e) => {
				e.preventDefault();
				e.stopPropagation();
				menu(e.clientX, e.clientY, [
					w ? ['Close window', 'close', () => wm.close(app.id)] : ['Open', 'external', () => launch(app)],
				]);
			});
			mid.append(b);
		});
		if (peek.id && !byId.has(peek.id)) peekHide(true);
	}

	// ---------- taskbar peek ----------
	// Hover a running app for its window card (title, page, close), as on
	// Windows 11. Hovering the card is Aero Peek: every other
	// window fades so the one you are pointing at shows through.
	const peek = { el: null, id: null, showT: 0, hideT: 0 };
	function peekSoon(id, btn) {
		clearTimeout(peek.hideT);
		clearTimeout(peek.showT);
		if (pop) return;
		peek.showT = setTimeout(() => peekShow(id, btn), peek.el ? 60 : 400);
	}
	function peekLeave() {
		clearTimeout(peek.showT);
		clearTimeout(peek.hideT);
		peek.hideT = setTimeout(() => peekHide(), 220);
	}
	function peekHide(now = false) {
		clearTimeout(peek.showT);
		clearTimeout(peek.hideT);
		layer.classList.remove('is-peek');
		layer.querySelectorAll('.win.is-peeked').forEach((el) => el.classList.remove('is-peeked'));
		if (!peek.el) return;
		const el = peek.el;
		peek.el = null;
		peek.id = null;
		if (now) el.remove();
		else {
			el.classList.add('is-leaving');
			el.addEventListener('animationend', () => el.remove(), { once: true });
		}
	}
	function peekShow(id, btn) {
		const w = running.find((x) => x.id === id);
		if (!w || !btn.isConnected) return peekHide(true);
		const had = !!peek.el;
		peek.el?.remove();
		const el = h('div', `os-peek${had ? ' is-moving' : ''}`);
		el.setAttribute('role', 'tooltip');
		const where = w.app.native ? 'three.ws app' : w.path || w.app.href;
		el.innerHTML =
			`<div class="pk-head">${tile(w.app, 'xs', 14)}<b></b><button type="button" class="pk-x" aria-label="Close window" title="Close">${icon('close', 14)}</button></div>` +
			`<div class="pk-body" style="--hue:${w.app.hue}">${tile(w.app, '', 24)}<small></small><span class="pk-state"></span></div>`;
		el.querySelector('b').textContent = w.title;
		el.querySelector('small').textContent = where;
		el.querySelector('.pk-state').textContent = w.minimized ? 'Minimized' : w.maximized ? 'Maximized' : focusId === id ? 'In front' : 'Open';
		el.querySelector('.pk-x').addEventListener('click', (e) => {
			e.stopPropagation();
			peekHide(true);
			wm.close(id);
		});
		el.addEventListener('click', () => {
			peekHide(true);
			wm.focus(id);
		});
		el.addEventListener('pointerenter', () => {
			clearTimeout(peek.hideT);
			if (w.minimized) return;
			layer.classList.add('is-peek');
			layer.querySelector(`.win[data-app="${CSS.escape(id)}"]`)?.classList.add('is-peeked');
		});
		el.addEventListener('pointerleave', () => {
			layer.classList.remove('is-peek');
			layer.querySelectorAll('.win.is-peeked').forEach((x) => x.classList.remove('is-peeked'));
			peekLeave();
		});
		root.append(el);
		const b = btn.getBoundingClientRect();
		const r = el.getBoundingClientRect();
		const x = Math.max(8, Math.min(b.left + b.width / 2 - r.width / 2, innerWidth - r.width - 8));
		el.style.left = `${x}px`;
		if (prefs.style === 'aqua' || b.top > innerHeight / 2) el.style.bottom = `${innerHeight - b.top + 8}px`;
		else el.style.top = `${b.bottom + 8}px`;
		peek.el = el;
		peek.id = id;
	}

	// ---------- dock magnification (Aqua) ----------
	// Every dock item scales with its distance from the pointer (dockScale in
	// layout.js), then eases back when the pointer leaves the dock.
	let dockRaf = 0;
	let dockX = null;
	function paintDock() {
		dockRaf = 0;
		const items = mid.querySelectorAll('.os-tb');
		items.forEach((b) => {
			let s = 1;
			if (dockX != null) {
				const r = b.getBoundingClientRect();
				s = dockScale(dockX - (r.left + r.width / 2), 1.55, 140);
			}
			b.style.setProperty('--mag', s.toFixed(3));
		});
	}
	const dockOn = () => prefs.style === 'aqua' && innerWidth > 720 && !matchMedia('(prefers-reduced-motion: reduce)').matches;
	mid.addEventListener('pointermove', (e) => {
		if (e.pointerType === 'touch' || !dockOn()) return;
		dockX = e.clientX;
		if (!dockRaf) dockRaf = requestAnimationFrame(paintDock);
	});
	mid.addEventListener('pointerleave', () => {
		if (dockX == null) return;
		dockX = null;
		if (!dockRaf) dockRaf = requestAnimationFrame(paintDock);
	});

	// tray
	const tray = h('div', 'os-tray');
	const btnTheme = h('button', 'os-tb', '');
	btnTheme.type = 'button';
	const btnWorld = h('button', 'os-tb', icon('world', 20));
	btnWorld.type = 'button';
	btnWorld.title = 'Walk the campus';
	btnWorld.setAttribute('aria-label', 'Leave the desk and walk the three.ws campus as your avatar');
	btnWorld.hidden = true;
	const btnClassic = h('button', 'os-tb hide-sm', icon('classic', 20));
	btnClassic.type = 'button';
	btnClassic.title = 'Classic view';
	btnClassic.setAttribute('aria-label', 'Switch to the classic website');
	// The sliver at the far right edge, as on Windows: click to show the desktop, click again to bring everything back.
	const btnDesk = h('button', 'os-showdesk hide-sm');
	btnDesk.type = 'button';
	btnDesk.title = 'Show desktop';
	btnDesk.setAttribute('aria-label', 'Show desktop');
	btnDesk.addEventListener('click', () => showDesktop());
	tray.append(btnTheme, btnWorld, btnClassic, chrome.statusBtn, chrome.clockBtn);
	right.append(tray, btnDesk);
	let deskShown = null;
	function showDesktop() {
		closePops();
		const open = running.filter((w) => !w.minimized);
		if (open.length) {
			deskShown = open.map((w) => w.id);
			open.forEach((w) => wm.minimize(w.id));
		} else if (deskShown) {
			deskShown.filter((id) => wm.has(id)).forEach((id) => wm.focus(id));
			deskShown = null;
		}
	}

	const isLight = () => document.documentElement.getAttribute('data-theme') === 'light';
	function syncTheme() {
		btnTheme.innerHTML = icon(isLight() ? 'moon' : 'sun', 20);
		const next = isLight() ? 'dark' : 'light';
		btnTheme.title = `Switch to ${next} mode`;
		btnTheme.setAttribute('aria-label', `Switch to ${next} mode`);
	}
	btnTheme.addEventListener('click', () => setPrefs({ mode: isLight() ? 'dark' : 'light' }));
	new MutationObserver(syncTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
	syncTheme();

	btnClassic.addEventListener('click', goClassic);
	// The 3D campus is optional (no WebGL, or the visitor opted out): the
	// entry wires `onWorld` once the world exists, and every "walk" control
	// stays hidden until then.
	let onWorld = null;
	btnWorld.addEventListener('click', () => onWorld?.());
	function goWorld() {
		if (onWorld) onWorld();
		else toast('The 3D campus is not available in this browser.');
	}
	function goClassic() {
		save();
		store.set(KEY.view, 'classic');
		location.assign('/classic');
	}

	// Signed-in account: the server session is the source of truth.
	fetch('/api/auth/me', { credentials: 'include' })
		.then((r) => (r.ok ? r.json() : null))
		.then((data) => {
			const u = data && data.user;
			if (!u) return;
			account = u;
			userName = u.display_name || u.username || 'Account';
			paintUser();
		})
		.catch(() => {
			/* signed-out view is already correct */
		});
	let userName = '';
	let startUserEl = null;
	let startWorldEl = null;
	const displayName = () => userName || prefs.name || 'Guest';
	function paintUser() {
		if (!startUserEl) return;
		startUserEl.querySelector('span').textContent = displayName();
		chrome.paintAvatar(startUserEl.querySelector('.avatar'));
	}
	prefsListeners.add(paintUser);

	// ---------- popovers ----------
	let pop = null;
	function closePops() {
		if (pop) {
			pop.el.remove();
			pop.trigger?.setAttribute('aria-expanded', 'false');
			pop.onClose?.();
			pop = null;
		}
	}
	function openPop(kind, el, trigger, onClose) {
		const same = pop && pop.kind === kind;
		closePops();
		if (same) return false;
		peekHide(true);
		root.append(el);
		trigger?.setAttribute('aria-expanded', 'true');
		pop = { kind, el, trigger, onClose };
		return true;
	}
	addEventListener(
		'pointerdown',
		(e) => {
			if (!pop) return;
			if (pop.el.contains(e.target) || pop.trigger?.contains(e.target)) return;
			closePops();
		},
		true,
	);
	// A click inside an iframe never reaches us; the window blur is the signal.
	addEventListener('blur', () => {
		setTimeout(() => {
			if (pop && document.activeElement?.tagName === 'IFRAME') closePops();
		}, 0);
	});
	addEventListener('keydown', (e) => {
		if (e.key === 'Escape' && pop) {
			const t = pop.trigger;
			closePops();
			t?.focus();
		}
	});

	// ---------- Start menu ----------
	function toggleStart(query = '') {
		const el = h('div', 'os-pop start-menu');
		el.setAttribute('role', 'dialog');
		el.setAttribute('aria-label', 'Start');
		const user = h('button', 'sm-user', `<i class="avatar"></i><span></span>`);
		user.type = 'button';
		user.title = 'Your profile and account';
		startUserEl = user;
		paintUser();
		user.addEventListener('click', () => launchId('settings', { section: 'profile' }));
		const search = h('label', 'sm-search', `${icon('search', 18)}<input type="search" placeholder="Search apps, pages and files" aria-label="Search apps, pages and files" autocomplete="off" spellcheck="false">`);
		const input = search.querySelector('input');
		const head = h('div', 'sm-head');
		head.append(user, search);

		// Left: every app, A to Z. Right: folders, clock, pinned, recommended.
		const side = h('nav', 'sm-side');
		side.setAttribute('aria-label', 'All apps');
		const body = h('div', 'sm-body');
		const main = h('div', 'sm-main');
		main.append(side, body);

		const foot = h('div', 'sm-foot');
		const folders = h('div', 'sm-folders');
		[
			['Documents', 'files', '/Documents'],
			['Pictures', 'image', '/Pictures'],
			['Music', 'music', '/Music'],
			['Downloads', 'download', '/Downloads'],
		].forEach(([name, ic, path]) => {
			const b = h('button', 'sm-folder', icon(ic, 18));
			b.type = 'button';
			b.title = name;
			b.setAttribute('aria-label', `Open ${name}`);
			b.addEventListener('click', () => launchId('files', { arg: path }));
			folders.append(b);
		});
		const gear = h('button', 'sm-folder', icon('gear', 18));
		gear.type = 'button';
		gear.title = 'Settings';
		gear.setAttribute('aria-label', 'Settings');
		gear.addEventListener('click', () => launchId('settings'));
		folders.append(gear);
		const walk = h('button', 'sm-pwr sm-world', icon('world', 18));
		walk.type = 'button';
		walk.title = 'Walk the campus';
		walk.setAttribute('aria-label', 'Leave the desk and walk the three.ws campus as your avatar');
		walk.hidden = !onWorld;
		walk.addEventListener('click', () => {
			closePops();
			goWorld();
		});
		startWorldEl = walk;
		const classic = h('button', 'sm-pwr', icon('classic', 18));
		classic.type = 'button';
		classic.title = 'Classic view';
		classic.setAttribute('aria-label', 'Switch to the classic website');
		classic.addEventListener('click', goClassic);
		const pwr = h('button', 'sm-pwr sm-power', icon('power', 18));
		pwr.type = 'button';
		pwr.title = 'Power';
		pwr.setAttribute('aria-label', 'Power: lock, sign out, restart or shut down');
		pwr.setAttribute('aria-haspopup', 'menu');
		pwr.addEventListener('click', (e) => {
			e.stopPropagation();
			const r = pwr.getBoundingClientRect();
			chrome.powerMenu(r.right, r.top - 6, true);
		});
		const actions = h('div', 'sm-foot-actions');
		actions.append(walk, classic, pwr);
		foot.append(folders, actions);
		el.append(head, main, foot);

		let selectable = [];
		let sel = -1;
		const pick = (b, fn) => {
			b.type = 'button';
			b.addEventListener('click', fn);
			selectable.push(b);
			return b;
		};
		const row = (app) => pick(h('button', 'sm-row', `${tile(app, 'sm', 17)}<div><b>${esc(app.title)}</b><small>${esc(app.desc || app.href || '')}</small></div>`), () => launch(app));
		const appBtn = (app) => pick(h('button', 'sm-app', `${tile(app, '', 22)}<span>${esc(app.title)}</span>`), () => launch(app));
		const fileRow = (n) => {
			const look = n.type === 'dir' ? FILE_LOOK.dir : FILE_LOOK[fs.kindOf(n.mime || n.name)] || FILE_LOOK.other;
			const where = fs.parentOf(n.path).slice(1) || 'Home';
			return pick(h('button', 'sm-row', `${tile(look, 'sm', 17)}<div><b>${esc(n.name)}</b><small>${esc(where)} / ${esc(relTime(n.mtime))}</small></div>`), () => launch({ id: n.path, fsPath: n.path, fsType: n.type }));
		};

		const sorted = everything()
			.slice()
			.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
		function paintSide() {
			side.replaceChildren(h('div', 'sm-h', '<span>All apps</span>'));
			let letter = '';
			sorted.forEach((a) => {
				const L = /^[a-z]/i.test(a.title) ? a.title[0].toUpperCase() : '#';
				if (L !== letter) {
					letter = L;
					side.append(h('div', 'sm-letter', esc(L)));
				}
				const b = h('button', 'sm-side-app', `${tile(a, 'sm', 15)}<span>${esc(a.title)}</span>`);
				b.type = 'button';
				b.addEventListener('click', () => launch(a));
				side.append(b);
			});
		}

		const clock = h('div', 'sm-clock');
		let clockT = 0;
		const tickClock = () => {
			const d = new Date();
			const { time } = formatClock(d, { clock24: prefs.clock24 });
			clock.innerHTML = `<b>${esc(time)}</b><span>${esc(d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }))}</span>`;
			clockT = setTimeout(tickClock, 60_000 - (Date.now() % 60_000) + 20);
		};

		let showAll = false;
		let paintSeq = 0;
		async function paint() {
			const seq = ++paintSeq;
			selectable = [];
			sel = -1;
			body.replaceChildren();
			const q = input.value.trim();
			el.classList.toggle('searching', !!q);
			if (q) {
				const hits = rankItems(q, everything()).slice(0, 16);
				const list = h('div', 'sm-list one');
				if (hits.length) {
					body.append(h('div', 'sm-h', '<span>Best matches</span>'));
					hits.forEach((a) => list.append(row(a)));
					body.append(list);
				}
				const needle = q.toLowerCase();
				const files = (await fs.walk('/').catch(() => []))
					.filter((n) => !n.path.startsWith(`${fs.TRASH}/`) && n.name.toLowerCase().includes(needle))
					.sort((a, b) => b.mtime - a.mtime)
					.slice(0, 8);
				if (seq !== paintSeq) return;
				if (files.length) {
					body.append(h('div', 'sm-h', '<span>Files and folders</span>'));
					const fl = h('div', 'sm-list one');
					files.forEach((n) => fl.append(fileRow(n)));
					body.append(fl);
				}
				if (!hits.length && !files.length) body.append(h('div', 'sm-empty', `Nothing matches "${esc(q)}". Try an app like Forge, a folder like Documents, or press Ctrl+Alt+R to run a command.`));
				return;
			}
			body.append(clock);
			const hd = h('div', 'sm-h', `<span>${showAll ? 'All apps' : 'Pinned'}</span>`);
			const toggle = h('button', 'sm-more', showAll ? 'Back' : `All ${icon('chevron', 12)}`);
			toggle.type = 'button';
			toggle.addEventListener('click', () => {
				showAll = !showAll;
				paint();
			});
			hd.append(toggle);
			body.append(hd);
			if (showAll) {
				const list = h('div', 'sm-list');
				sorted.forEach((a) => list.append(row(a)));
				body.append(list);
				return;
			}
			const grid = h('div', 'sm-grid');
			const pins = [...APPS, ...['files', 'notepad', 'terminal', 'settings', 'apps'].map(appById)].filter(Boolean);
			pins.forEach((a) => grid.append(appBtn(a)));
			body.append(grid);
			const recHead = h('div', 'sm-h', '<span>Recommended</span>');
			const recList = h('div', 'sm-list');
			body.append(recHead, recList);
			const apps = recent().map(resolveApp).filter((a) => a && !a.fsPath).slice(0, 4);
			const files = await fs.recentFiles(4).catch(() => []);
			if (seq !== paintSeq) return;
			const items = [...files.map((n) => fileRow(n)), ...apps.map((a) => row(a))].slice(0, 6);
			if (items.length) items.forEach((b) => recList.append(b));
			else ['create', 'forge', 'notepad', 'discover'].map(appById).filter(Boolean).forEach((a) => recList.append(row(a)));
		}
		input.addEventListener('input', () => {
			showAll = false;
			paint();
		});
		input.addEventListener('keydown', (e) => {
			if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
				e.preventDefault();
				if (!selectable.length) return;
				sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + selectable.length) % selectable.length;
				selectable.forEach((s, i) => s.classList.toggle('is-sel', i === sel));
				selectable[sel].scrollIntoView({ block: 'nearest' });
			} else if (e.key === 'Enter') {
				e.preventDefault();
				selectable[sel >= 0 ? sel : 0]?.click();
			}
		});
		const opened = openPop('start', el, btnStart, () => {
			startUserEl = null;
			clearTimeout(clockT);
		});
		if (!opened) return;
		input.value = query;
		tickClock();
		paintSide();
		paint();
		input.focus({ preventScroll: true });
	}
	btnStart.addEventListener('click', () => toggleStart());
	btnSearch.addEventListener('click', () => toggleStart());

	// ---------- Widgets board, desktop widgets and the assistant ----------
	// Loaded on demand so the desktop paints before their data does.
	const widgetsMod = () => import('./widgets/index.js');
	const assistantMod = () => import('./assistant/index.js');
	const flyoutCtx = (anchor) => ({ root, anchor, launchId, toast, notify, prefs: () => prefs });
	const flyoutFailed = (what) => (err) => notify({ title: `${what} could not open`, body: err?.message || 'Check your connection and try again.' });
	btnWidgets.addEventListener('click', () => {
		closePops();
		assistantOpen && assistantMod().then((m) => m.closeAssistant());
		widgetsMod()
			.then((m) => m.toggleWidgets(flyoutCtx(btnWidgets)))
			.catch(flyoutFailed('Widgets'));
	});
	let assistantOpen = false;
	btnAssist.addEventListener('click', () => {
		closePops();
		widgetsMod().then((m) => m.closeWidgets());
		assistantMod()
			.then((m) => (assistantOpen = m.toggleAssistant(flyoutCtx(btnAssist))))
			.catch(flyoutFailed('The assistant'));
	});
	widgetsMod()
		.then((m) =>
			m.mountDesktopWidgets({
				root,
				desktop: widgetsHost,
				launchId,
				toast,
				insets: () => {
					const { menuH, dockH } = bars();
					return { top: menuH + 12, right: 12, bottom: dockH + 12, left: 120 };
				},
			}),
		)
		.catch(() => {
			/* the board is optional; the desktop works without it */
		});
	const editWidgets = () => widgetsMod().then((m) => m.editDesktopWidgets(true));
	const addWidget = () => widgetsMod().then((m) => m.addDesktopWidget());

	// ---------- context menu ----------
	/**
	 * Context menu. An item is '-' (separator) or [label, glyph, fn, sub?, hint?];
	 * `sub` (an item list) makes it open a submenu instead. `above` anchors the
	 * menu's bottom edge at y (menus opened from the taskbar).
	 */
	function menu(x, y, items, above = false) {
		closePops();
		const el = buildMenu(items, () => closePops());
		root.append(el);
		const r = el.getBoundingClientRect();
		el.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 4))}px`;
		const { menuH, dockH } = bars();
		const top = above ? y - r.height : y;
		el.style.top = `${Math.max(menuH + 4, Math.min(top, innerHeight - r.height - (above ? 4 : dockH + 4)))}px`;
		el.style.bottom = 'auto';
		pop = { kind: 'ctx', el, trigger: null };
		el.querySelector('button')?.focus();
	}
	function buildMenu(items, done, sub = false) {
		const el = h('div', `os-pop ctx${sub ? ' ctx-sub' : ''}`);
		el.setAttribute('role', 'menu');
		let child = null;
		const closeChild = () => {
			child?.remove();
			child = null;
			el.querySelectorAll('[aria-expanded="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
		};
		items.forEach((it) => {
			if (it === '-') return el.append(h('hr'));
			const [label, ic, fn, kids, hint] = it;
			const b = h('button', '', `${ic ? icon(ic, 16) : '<i class="ico" aria-hidden="true"></i>'}<span>${esc(label)}</span>${kids ? icon('chevron', 12) : hint ? `<kbd>${esc(hint)}</kbd>` : ''}`);
			b.type = 'button';
			b.setAttribute('role', 'menuitem');
			if (kids) {
				b.setAttribute('aria-haspopup', 'menu');
				b.setAttribute('aria-expanded', 'false');
				const open = () => {
					if (b.getAttribute('aria-expanded') === 'true') return;
					closeChild();
					b.setAttribute('aria-expanded', 'true');
					child = buildMenu(kids, done, true);
					el.append(child);
					const br = b.getBoundingClientRect();
					const er = el.getBoundingClientRect();
					const cr = child.getBoundingClientRect();
					const right = er.right + cr.width + 4 < innerWidth;
					child.style.left = right ? `${er.width - 4}px` : `${-cr.width + 4}px`;
					child.style.top = `${Math.min(br.top - er.top - 5, innerHeight - er.top - cr.height - 8)}px`;
					return child;
				};
				b.addEventListener('pointerenter', open);
				b.addEventListener('click', (e) => {
					e.stopPropagation();
					open()?.querySelector('button')?.focus();
				});
				b.addEventListener('keydown', (e) => {
					if (e.key === 'ArrowRight') {
						e.preventDefault();
						open()?.querySelector('button')?.focus();
					}
				});
			} else {
				b.addEventListener('pointerenter', closeChild);
				b.addEventListener('click', (e) => {
					e.stopPropagation();
					done();
					fn();
				});
			}
			el.append(b);
		});
		el.addEventListener('keydown', (e) => {
			const own = [...el.children].filter((c) => c.tagName === 'BUTTON');
			const i = own.indexOf(document.activeElement);
			if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
				if (i < 0) return;
				e.preventDefault();
				e.stopPropagation();
				own[(i + (e.key === 'ArrowDown' ? 1 : -1) + own.length) % own.length].focus();
			} else if (e.key === 'ArrowLeft' && sub) {
				e.preventDefault();
				e.stopPropagation();
				const parent = el.parentElement;
				parent?.querySelector('[aria-expanded="true"]')?.focus();
				el.remove();
				parent?.querySelectorAll('[aria-expanded="true"]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
			}
		});
		return el;
	}
	// ---------- desktop: context menu, files on the desktop ----------
	async function newOnDesktop(kind) {
		try {
			const name = await fs.uniqueName('/Desktop', kind === 'dir' ? 'New folder' : 'New text document.txt');
			const path = `/Desktop/${name}`;
			if (kind === 'dir') await fs.mkdir(path);
			else await fs.write(path, '', { mime: 'text/plain' });
			await syncDesk();
			renameFile(`fs:${path}`);
		} catch (err) {
			notify({ title: 'Could not create it', body: err?.message || String(err), app: 'files' });
		}
	}
	function renameFile(id) {
		const app = resolveApp(id);
		if (!app?.fsPath || !id.startsWith(DESK_PREFIX)) return;
		const body = h('div', 'run-body', '<label class="run-field"><span>Name:</span><input type="text" autocomplete="off" spellcheck="false" aria-label="New name"></label><p class="run-err" role="alert" hidden></p>');
		const input = body.querySelector('input');
		const err = body.querySelector('.run-err');
		input.value = app.title;
		const go = () => {
			const next = input.value.trim();
			if (!next || next === app.title) return true;
			fs.rename(app.fsPath, next)
				.then(() => {
					deskIcons.rename(id, `fs:/Desktop/${next}`);
					dlg.close();
				})
				.catch((e) => {
					err.textContent = e?.message || String(e);
					err.hidden = false;
				});
			return false;
		};
		const dlg = chrome.dialog({ title: 'Rename', glyph: 'edit', body, buttons: [['Rename', go, true], ['Cancel']] });
		const dot = app.fsType === 'file' ? app.title.lastIndexOf('.') : -1;
		input.setSelectionRange(0, dot > 0 ? dot : app.title.length);
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				if (go() !== false) dlg.close();
			}
		});
	}
	/** Send desktop files to the Trash. Returns true when every id was a file (handled). */
	function trashFiles(ids) {
		const files = ids.filter((id) => id.startsWith(DESK_PREFIX));
		if (!files.length) return false;
		Promise.all(files.map((id) => fs.remove(id.slice(3))))
			.then(() => {
				deskIcons.remove(files);
				toast(files.length > 1 ? `${files.length} items moved to the Trash` : `${resolveApp(files[0])?.title || 'Item'} moved to the Trash`);
			})
			.catch((e) => notify({ title: 'Could not delete', body: e?.message || String(e), app: 'files' }));
		const rest = ids.filter((id) => !id.startsWith(DESK_PREFIX));
		if (rest.length) deskIcons.remove(rest);
		return true;
	}
	async function syncDesk() {
		let nodes;
		try {
			nodes = await fs.list('/Desktop');
		} catch {
			return;
		}
		const changed = [];
		const live = new Set();
		for (const n of nodes) {
			const id = `fs:${n.path}`;
			live.add(id);
			const was = deskFiles.get(n.path);
			if (!was ? deskIcons.has(id) : was.type !== n.type || was.mime !== n.mime) changed.push(id);
			deskFiles.set(n.path, n);
		}
		for (const p of [...deskFiles.keys()]) if (!live.has(`fs:${p}`)) deskFiles.delete(p);
		const gone = deskIcons.ids().filter((id) => id.startsWith(DESK_PREFIX) && !live.has(id));
		if (gone.length) deskIcons.remove(gone);
		live.forEach((id) => deskIcons.has(id) || deskIcons.add(id));
		if (changed.length) deskIcons.refresh(changed);
	}
	fs.subscribe((paths) => paths.some((p) => p === '/Desktop' || p === '/') && syncDesk());

	function desktopMenu(x, y) {
		const size = prefs.iconSize;
		const mark = (on) => (on ? 'check' : '');
		menu(x, y, [
			[
				'View',
				'grid',
				null,
				[
					['Large icons', mark(size === 'large'), () => setPrefs({ iconSize: 'large' })],
					['Medium icons', mark(size === 'medium'), () => setPrefs({ iconSize: 'medium' })],
					['Small icons', mark(size === 'small'), () => setPrefs({ iconSize: 'small' })],
					'-',
					['Auto arrange icons', 'grid', () => deskIcons.arrange()],
					['Select all', 'check', () => deskIcons.selectAll(), null, 'Ctrl+A'],
				],
			],
			['Sort by', 'list', null, [['Name', 'list', () => deskIcons.sortByName()]]],
			['Refresh', 'reload', () => (syncDesk(), deskIcons.refresh())],
			'-',
			[
				'New',
				'plus',
				null,
				[
					['Folder', 'folder', () => newOnDesktop('dir')],
					['Text document', 'note', () => newOnDesktop('file')],
				],
			],
			['Edit widgets', 'widgets', editWidgets],
			['Add a widget', 'plus', addWidget],
			'-',
			['Open in Terminal', 'terminal', () => launchId('terminal', { arg: '/Desktop' })],
			['Open Desktop folder', 'files', () => launchId('files', { arg: '/Desktop' })],
			'-',
			['Run...', 'search', () => chrome.runDialog(), null, 'Ctrl+Alt+R'],
			['Display settings', 'desktop', () => launchId('settings', { section: 'personalize' })],
			['Personalize', 'paint', () => launchId('settings', { section: 'personalize' })],
			['About three.ws OS', 'logo', () => chrome.aboutDialog()],
			'-',
			['Walk the campus', 'world', goWorld],
			['Switch to classic view', 'classic', goClassic],
			['Close all windows', 'close', () => wm.closeAll()],
		]);
	}
	root.addEventListener('contextmenu', (e) => {
		if (e.target.closest('.win, .os-task, .os-pop, .os-dialog-wrap, .os-lockscreen, .os-power')) return;
		e.preventDefault();
		desktopMenu(e.clientX, e.clientY);
	});

	// ---------- desktop icons ----------
	const DEFAULT_ICONS = () => ['thispc', 'recycle', ...[...APPS, ...ALL_APPS.filter((a) => a.native)].filter((a) => a.desktop).map((a) => a.id)];
	deskIcons = createIconLayer({
		host: icons,
		resolve: resolveApp,
		// Desktop files are trusted until the folder is read, then syncDesk drops any that are gone.
		isKnown: (id) => (typeof id === 'string' && id.startsWith(DESK_PREFIX)) || !!resolveApp(id),
		defaults: DEFAULT_ICONS,
		load: () => {
			const raw = store.get(KEY.icons);
			if (raw == null) return null;
			try {
				return JSON.parse(raw);
			} catch {
				return null;
			}
		},
		save: (list) => store.set(KEY.icons, JSON.stringify(list)),
		launch,
		menu,
		size: prefs.iconSize,
		itemMenu: (ids, open) => {
			const files = ids.filter((id) => id.startsWith(DESK_PREFIX));
			const sys = ids.length === 1 && SYSTEM_ICONS[ids[0]];
			if (sys?.id === 'recycle')
				return [
					['Open', 'external', open],
					['Empty Trash', 'trash', () => fs.emptyTrash().then(() => toast('Trash emptied'))],
					'-',
					['Remove from desktop', 'close', () => deskIcons.remove(ids)],
				];
			if (!files.length) return null;
			const one = ids.length === 1 ? resolveApp(ids[0]) : null;
			return [
				['Open', 'external', open, null, 'Enter'],
				one?.fsType === 'file' && ['Open with Files', 'files', () => launchId('files', { arg: fs.parentOf(one.fsPath) })],
				one?.fsType === 'file' && fs.kindOf(one.title) === 'image' && ['Set as desktop background', 'image', () => setFileWallpaper(one.fsPath)],
				'-',
				one && ['Rename', 'edit', () => renameFile(one.id), null, 'F2'],
				['Delete', 'trash', () => trashFiles(ids), null, 'Del'],
			].filter(Boolean);
		},
		onDelete: trashFiles,
		onRename: renameFile,
	});
	icons.setAttribute('role', 'listbox');
	icons.setAttribute('aria-label', 'Desktop');
	icons.setAttribute('aria-multiselectable', 'true');
	deskIcons.init((app) => tile(app, '', 24));
	// People who set up their desktop before Computer and the Trash existed get them once.
	if (!store.get(KEY.iconsV2)) {
		['thispc', 'recycle'].forEach((id) => deskIcons.add(id));
		store.set(KEY.iconsV2, '1');
	}
	syncDesk();
	icons.addEventListener('pointerdown', (e) => {
		if (e.target === icons) closePops();
	});
	// Drop files from the real computer onto the desktop to keep them here.
	icons.addEventListener('dragover', (e) => {
		if (![...(e.dataTransfer?.types || [])].includes('Files')) return;
		e.preventDefault();
		e.dataTransfer.dropEffect = 'copy';
		icons.classList.add('drop');
	});
	icons.addEventListener('dragleave', (e) => e.target === icons && icons.classList.remove('drop'));
	icons.addEventListener('drop', async (e) => {
		const list = [...(e.dataTransfer?.files || [])];
		icons.classList.remove('drop');
		if (!list.length) return;
		e.preventDefault();
		let ok = 0;
		for (const f of list) {
			try {
				await fs.importFile(f, '/Desktop');
				ok++;
			} catch (err) {
				notify({ title: `Could not copy ${f.name}`, body: err?.message || String(err), app: 'files' });
			}
		}
		if (ok) toast(ok > 1 ? `${ok} files copied to the desktop` : `${list[0].name} copied to the desktop`);
	});
	async function setFileWallpaper(path) {
		const f = await fs.read(path);
		if (!f) return;
		await idb.set(CUSTOM_WALL, f.blob);
		setPrefs({ wall: CUSTOM_WALL });
		applyWall();
	}

	// ---------- keyboard ----------
	// System shortcuts. A browser keeps the Windows key and Ctrl+Alt+Del for itself,
	// so the desktop uses Ctrl+Alt plus a letter, like a remote desktop session does.
	const SYS_KEYS = {
		r: () => chrome.runDialog(),
		l: () => chrome.lock(),
		d: () => showDesktop(),
		a: () => chrome.toggleQuick(),
		n: () => chrome.toggleNotes(),
		t: () => launchId('terminal'),
		e: () => launchId('files'),
		i: () => launchId('settings'),
		m: () => launchId('taskmgr'),
		w: () => btnWidgets.click(),
		c: () => btnAssist.click(),
	};
	addEventListener('keydown', (e) => {
		const mod = e.metaKey || e.ctrlKey;
		const sys = e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey && SYS_KEYS[e.key.toLowerCase()];
		if (sys) {
			e.preventDefault();
			sys();
		} else if (e.ctrlKey && e.key === 'Escape') {
			e.preventDefault();
			toggleStart();
		} else if (mod && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			closePops();
			toggleStart();
		} else if (e.altKey && e.key === 'Tab') {
			e.preventDefault();
			wm.cycle(e.shiftKey ? -1 : 1);
		} else if (e.altKey && e.key.toLowerCase() === 'w' && wm.focused()) {
			e.preventDefault();
			wm.close(wm.focused());
		} else if (e.altKey && !mod && e.key.toLowerCase() === 'z' && wm.focused()) {
			e.preventDefault();
			wm.snapLayouts(wm.focused());
		} else if (e.ctrlKey && e.altKey && wm.focused()) {
			const dir = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' }[e.key];
			if (!dir) return;
			e.preventDefault();
			wm.snapKey(wm.focused(), dir);
		}
	});
	let resizeT = 0;
	addEventListener('resize', () => {
		applyStyle();
		wm.relayout();
		clearTimeout(resizeT);
		resizeT = setTimeout(() => deskIcons.reseat(), 120);
	});

	// ---------- native apps ----------
	const WALL_PREVIEW = {
		horizon: 'linear-gradient(180deg,transparent 63%,#c4b5fd 64%,transparent 65%),radial-gradient(60% 30% at 50% 64%,#8b5cf677,transparent 70%),linear-gradient(180deg,#04050a,#080a12 64%,#05060b)',
		bubbles: 'radial-gradient(circle 22px at 30% 35%,#c7b8ff99,transparent),radial-gradient(circle 30px at 70% 70%,#a6e9ff88,transparent),linear-gradient(140deg,#0c1238,#241052 50%,#071a3c)',
		three: 'radial-gradient(70% 60% at 50% 110%,#8b5cf6aa,transparent 70%),#050505',
		aurora: 'linear-gradient(215deg,#7a3fa8,#1f6fbf)',
		midnight: 'linear-gradient(180deg,#1d2b5a,#05060d)',
		solana: 'linear-gradient(135deg,#14f195,#9945ff)',
		ember: 'linear-gradient(135deg,#ff6a2c,#7a1f4a)',
		graphite: 'linear-gradient(160deg,#2a2d33,#0d0e11)',
	};
	let settingsGo = null;
	let pendingSection = null;

	function download(name, text, type = 'application/json') {
		const url = URL.createObjectURL(new Blob([text], { type }));
		const a = h('a');
		a.href = url;
		a.download = name;
		root.append(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(url), 2000);
	}
	function sessionExport() {
		const items = {};
		EXPORT_KEYS.forEach((k) => {
			const v = store.get(k);
			if (v != null) items[k] = v;
		});
		return JSON.stringify({ kind: 'three.ws-desktop-session', v: 1, exported: new Date().toISOString(), items }, null, 2);
	}
	function localEntries() {
		const out = [];
		try {
			for (let i = 0; i < localStorage.length; i++) {
				const k = localStorage.key(i);
				out.push([k, localStorage.getItem(k)]);
			}
		} catch {
			/* storage unavailable */
		}
		return out;
	}
	async function storageSummary() {
		const used = storageBytes(localEntries(), 'tws:');
		let quota = 0;
		let usage = 0;
		try {
			const est = await navigator.storage.estimate();
			quota = est.quota || 0;
			usage = est.usage || 0;
		} catch {
			/* estimate unsupported */
		}
		return { used, quota, usage };
	}
	function resetEverything() {
		wm.closeAll();
		[KEY.state, KEY.recent, KEY.prefs, KEY.icons, KEY.wall, KEY.welcomed, 'tws:notes'].forEach((k) => store.del(k));
		idb.del(CUSTOM_WALL);
		location.reload();
	}

	function setRow(title, sub, control) {
		const r = h('div', 'set-row', `<div><b>${esc(title)}</b><small>${esc(sub)}</small></div>`);
		r.append(control);
		return r;
	}
	function btn(label, fn, cls = 'os-btn') {
		const b = h('button', cls, label);
		b.type = 'button';
		b.addEventListener('click', fn);
		return b;
	}
	function seg(options, current, onPick) {
		const wrap = h('div', 'seg');
		wrap.setAttribute('role', 'group');
		options.forEach(([val, label]) => {
			const b = h('button', '', esc(label));
			b.type = 'button';
			b.setAttribute('aria-pressed', String(current === val));
			b.addEventListener('click', () => {
				onPick(val);
				wrap.querySelectorAll('button').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
			});
			wrap.append(b);
		});
		return wrap;
	}
	function toggle(on, onChange, label) {
		const t = h('button', 'set-switch');
		t.type = 'button';
		t.setAttribute('role', 'switch');
		t.setAttribute('aria-label', label);
		t.setAttribute('aria-checked', String(on));
		t.addEventListener('click', () => {
			const next = t.getAttribute('aria-checked') !== 'true';
			t.setAttribute('aria-checked', String(next));
			onChange(next);
		});
		return t;
	}

	function renderSettings(wrap) {
		wrap.classList.add('settings');
		const nav = h('nav', 'set-nav');
		nav.setAttribute('aria-label', 'Settings sections');
		const pane = h('div', 'set-pane');
		wrap.append(nav, pane);
		const sections = [
			['profile', 'user', 'Profile'],
			['personalize', 'image', 'Personalization'],
			['desktop', 'desktop', 'Desktop and taskbar'],
			['session', 'folder', 'Session and storage'],
		];
		let current = 'profile';
		const panes = { profile: paintProfile, personalize: paintPersonalize, desktop: paintDesktop, session: paintSession };
		sections.forEach(([id, ic, label]) => {
			const b = h('button', '', `${ic ? icon(ic, 16) : '<i class="ico" aria-hidden="true"></i>'}<span>${label}</span>`);
			b.type = 'button';
			b.dataset.section = id;
			b.addEventListener('click', () => go(id));
			nav.append(b);
		});
		function go(id) {
			if (!panes[id]) return;
			current = id;
			nav.querySelectorAll('button').forEach((b) => b.toggleAttribute('aria-current', false));
			const active = nav.querySelector(`[data-section="${id}"]`);
			active.setAttribute('aria-current', 'page');
			pane.replaceChildren();
			panes[id]();
			pane.scrollTop = 0;
		}
		settingsGo = go;

		function paintProfile() {
			pane.append(h('h2', '', 'Profile'), h('p', '', 'Your name and avatar are stored in this browser and shown on Start. Signing in to three.ws uses your account name instead.'));
			const top = h('div', 'set-profile');
			const av = h('i', 'avatar');
			const paintAv = () => {
				av.textContent = initialsOf(userName || prefs.name);
				av.style.setProperty('--hue', prefs.avatarHue);
			};
			paintAv();
			const col = h('div');
			col.style.flex = '1';
			const field = h('input', 'os-field');
			field.type = 'text';
			field.maxLength = 40;
			field.placeholder = 'Your name';
			field.setAttribute('aria-label', 'Your name');
			field.value = prefs.name;
			field.addEventListener('input', () => {
				setPrefs({ name: field.value });
				paintAv();
			});
			col.append(field);
			top.append(av, col);
			pane.append(top);
			pane.append(h('h3', '', 'Avatar colour'));
			const hue = h('input', 'os-range');
			hue.type = 'range';
			hue.min = '0';
			hue.max = '359';
			hue.value = String(prefs.avatarHue);
			hue.setAttribute('aria-label', 'Avatar colour');
			hue.addEventListener('input', () => {
				setPrefs({ avatarHue: Number(hue.value) });
				paintAv();
			});
			pane.append(hue);
			pane.append(h('h3', '', 'Account'));
			pane.append(
				setRow(
					account ? `Signed in as ${userName}` : 'Not signed in',
					account ? 'Your agents, wallets and usage live in the Console.' : 'Sign in to sync your agents and wallets across devices.',
					btn(account ? 'Open Console' : 'Sign in', () => launch(resolveApp(account ? 'console' : pageAppId('/login')))),
				),
			);
		}

		function paintPersonalize() {
			pane.append(h('h2', '', 'Personalization'));
			pane.append(h('h3', '', 'Style'));
			pane.append(h('p', '', 'The whole shell, not just the colours: windows, taskbar, menus and motion.'));
			const styles = h('div', 'styles');
			const STYLE_NOTES = {
				fluent: 'Mica windows, a centred taskbar and Snap layouts.',
				aqua: 'A menu bar on top, a magnifying dock and traffic-light controls.',
				classic: 'Bevelled 9x chrome with a labelled taskbar.',
			};
			Object.entries(STYLES).forEach(([id, st]) => {
				const b = h(
					'button',
					'style-opt',
					`<i class="style-prev" data-prev="${id}" aria-hidden="true"><s class="sp-win"><s class="sp-bar"></s></s><s class="sp-task"></s></i><b>${esc(st.label)}</b><small>${esc(STYLE_NOTES[id])}</small>`,
				);
				b.type = 'button';
				b.setAttribute('aria-pressed', String(prefs.style === id));
				b.addEventListener('click', () => {
					setPrefs({ style: id });
					styles.querySelectorAll('.style-opt').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
				});
				styles.append(b);
			});
			pane.append(styles);
			pane.append(h('h3', '', 'Theme'));
			pane.append(seg([['dark', 'Dark'], ['light', 'Light'], ['auto', 'Match system']], prefs.mode, (v) => setPrefs({ mode: v })));
			pane.append(h('h3', '', 'Accent colour'));
			const sw = h('div', 'swatches');
			ACCENTS.forEach((c) => {
				const b = h('button', 'swatch');
				b.type = 'button';
				b.style.setProperty('--c', c);
				b.setAttribute('aria-label', `Accent ${c}`);
				b.setAttribute('aria-pressed', String(prefs.accent === c));
				b.addEventListener('click', () => {
					setPrefs({ accent: c });
					sw.querySelectorAll('.swatch').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
				});
				sw.append(b);
			});
			pane.append(sw);
			pane.append(h('h3', '', 'Wallpaper'));
			const grid = h('div', 'walls');
			const opts = [...WALLPAPERS.map((w) => ({ id: w.id, label: w.label, bg: WALL_PREVIEW[w.id] }))];
			opts.forEach((w) => {
				const b = h('button', 'wall-opt', `<i style="background:${w.bg}"></i><span>${w.label}</span>`);
				b.type = 'button';
				b.dataset.wall = w.id;
				b.setAttribute('aria-pressed', String(prefs.wall === w.id));
				b.addEventListener('click', () => {
					setPrefs({ wall: w.id });
					grid.querySelectorAll('.wall-opt').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
				});
				grid.append(b);
			});
			const custom = h('button', 'wall-opt', `<i style="background:var(--hover-b);display:grid;place-items:center">${icon('image', 22)}</i><span>Your photo</span>`);
			custom.type = 'button';
			custom.setAttribute('aria-pressed', String(prefs.wall === CUSTOM_WALL));
			const file = h('input');
			file.type = 'file';
			file.accept = 'image/*';
			file.hidden = true;
			file.addEventListener('change', async () => {
				const f = file.files && file.files[0];
				if (!f) return;
				try {
					const blob = await shrinkImage(f);
					await idb.set(CUSTOM_WALL, blob);
					setPrefs({ wall: CUSTOM_WALL });
					grid.querySelectorAll('.wall-opt').forEach((o) => o.setAttribute('aria-pressed', String(o === custom)));
					toast('Wallpaper set.');
				} catch {
					toast('That image could not be used. Try a PNG or JPEG.');
				}
				file.value = '';
			});
			custom.addEventListener('click', () => file.click());
			grid.append(custom, file);
			pane.append(grid);
		}

		function paintDesktop() {
			pane.append(h('h2', '', 'Desktop and taskbar'));
			pane.append(h('h3', '', 'Desktop icons'));
			pane.append(
				setRow('Icon size', 'Applies to every icon on the desktop.', seg(Object.keys(ICON_SIZES).map((k) => [k, k[0].toUpperCase() + k.slice(1)]), prefs.iconSize, (v) => setPrefs({ iconSize: v }))),
				setRow('Arrange icons', 'Sort the desktop icons by name into a tidy grid.', btn('Sort by name', () => deskIcons.sortByName())),
				setRow('Restore default icons', 'Bring back every standard app on the desktop.', btn('Restore', () => {
					deskIcons.add && [...APPS, ...ALL_APPS.filter((a) => a.native)].filter((a) => a.desktop).forEach((a) => deskIcons.add(a.id));
					toast('Default icons restored.');
				})),
			);
			pane.append(h('h3', '', 'Taskbar'));
			pane.append(
				setRow('Alignment', 'Centre the Start button or keep it on the left.', seg([['center', 'Centre'], ['left', 'Left']], prefs.taskbarAlign, (v) => setPrefs({ taskbarAlign: v }))),
				setRow('24-hour clock', 'Show the time as 14:30 instead of 2:30 PM.', toggle(prefs.clock24, (v) => setPrefs({ clock24: v }), '24-hour clock')),
			);
			pane.append(h('h3', '', 'Arrival'));
			pane.append(
				setRow('Start in', 'Walk to your desk as your avatar, or land on the desktop at once. A shared link with ?app= always opens the desktop.', seg([['world', 'The campus'], ['desktop', 'The desktop']], prefs.startIn, (v) => setPrefs({ startIn: v }))),
				setRow('Startup chime', 'A short synthesised chime when you unlock. Nothing is downloaded.', toggle(prefs.sound, (v) => setPrefs({ sound: v }), 'Startup chime')),
				setRow('Walk the campus', 'Leave the desk and explore the exchange, the launchpad and the mine as your avatar.', btn('Walk', goWorld)),
			);
			pane.append(h('h3', '', 'View'));
			pane.append(setRow('Classic website', 'The original three.ws homepage. Your choice is remembered until you switch back.', btn('Open classic', goClassic)));
		}

		function paintSession() {
			pane.append(h('h2', '', 'Session and storage'), h('p', '', 'Like a real computer, your desktop remembers its open windows, icon layout, preferences and recent apps in this browser. Nothing here is sent to a server.'));
			const meter = h('div', '', '');
			const label = h('small', '', 'Calculating...');
			const bar = h('div', 'meter', '<i style="width:0%"></i>');
			meter.append(label, bar);
			storageSummary().then(({ used, quota, usage }) => {
				label.textContent = quota
					? `Desktop data: ${formatBytes(used)}. This site uses ${formatBytes(usage)} of ${formatBytes(quota)} available to the browser.`
					: `Desktop data: ${formatBytes(used)}.`;
				bar.firstChild.style.width = `${quota ? Math.max(1, Math.min(100, (usage / quota) * 100)) : 1}%`;
			});
			pane.append(meter);
			pane.append(h('h3', '', 'Back up and restore'));
			const file = h('input');
			file.type = 'file';
			file.accept = 'application/json,.json';
			file.hidden = true;
			file.addEventListener('change', async () => {
				const f = file.files && file.files[0];
				file.value = '';
				if (!f) return;
				const r = parseSessionImport(await f.text());
				if (!r.ok) return toast(r.error);
				Object.entries(r.items).forEach(([k, v]) => store.set(k, v));
				toast('Session restored. Reloading the desktop.');
				setTimeout(() => location.reload(), 600);
			});
			pane.append(
				setRow('Export session', 'Download your layout, windows and preferences as a file.', btn('Export', () => {
					save();
					download(`three-ws-desktop-${new Date().toISOString().slice(0, 10)}.json`, sessionExport());
				})),
				setRow('Import session', 'Restore a session you exported earlier, on this or another browser.', btn('Import', () => file.click())),
			);
			pane.append(file);
			pane.append(h('h3', '', 'Reset'));
			pane.append(
				setRow('Close all windows', 'Keep your preferences and icons, close every open window.', btn('Close all', () => {
					wm.closeAll();
					toast('All windows closed.');
				})),
				setRow('Reset the desktop', 'Forget windows, icons, preferences and your profile. Cannot be undone.', btn('Reset everything', () => {
					if (confirm('Reset the desktop? Your windows, icon layout, preferences and profile will be erased from this browser.')) resetEverything();
				}, 'os-btn danger')),
			);
		}
		go(pendingSection || 'profile');
		pendingSection = null;
	}

	function renderApps(wrap) {
		wrap.append(h('h2', '', 'All Apps'), h('p', '', 'Every three.ws app and page. Open one, or keep a shortcut on your desktop.'));
		const bar = h('div', 'apps-bar');
		const q = h('input', 'os-field');
		q.type = 'search';
		q.placeholder = 'Search apps and pages';
		q.setAttribute('aria-label', 'Search apps and pages');
		bar.append(q);
		const list = h('div', 'app-list');
		wrap.append(bar, list);
		const all = [...ALL_APPS.filter((a) => a.id !== 'welcome'), ...catalog];
		function paint() {
			const term = q.value.trim();
			const rows = term ? rankItems(term, all) : all;
			list.replaceChildren();
			if (!rows.length) {
				list.append(h('p', '', `Nothing matches "${esc(term)}".`));
				return;
			}
			rows.forEach((app) => {
				const r = h('div', 'app-row', `${tile(app, 'sm', 17)}<div><b>${esc(app.title)}</b><small>${esc(app.desc || app.href || '')}</small></div>`);
				const open = btn('Open', () => launch(app));
				const pin = btn(deskIcons.has(app.id) ? 'On desktop' : 'Add to desktop', () => {
					if (deskIcons.has(app.id)) {
						deskIcons.remove([app.id]);
						pin.textContent = 'Add to desktop';
					} else if (deskIcons.add(app.id)) {
						pin.textContent = 'On desktop';
					} else {
						toast('The desktop is full. Remove an icon first.');
					}
				});
				r.append(open, pin);
				list.append(r);
			});
		}
		q.addEventListener('input', paint);
		paint();
	}

	function renderNative(app, body, win) {
		if (app.os) {
			mountOsApp(app, body, win, {
				tile,
				toast,
				notify,
				launchId,
				wm,
				store,
				prefs: () => prefs,
				setPrefs,
				onPrefs: (fn) => (prefsListeners.add(fn), () => prefsListeners.delete(fn)),
			});
			return;
		}
		const wrap = h('div', 'native');
		body.append(wrap);
		if (app.id === 'settings') return renderSettings(wrap);
		if (app.id === 'apps') return renderApps(wrap);
		wrap.innerHTML = '<h2>Welcome to three.ws</h2><p>The 3D agent layer of the internet. Give your AI a body: make a living 3D agent from a selfie, forge models from a prompt, launch a coin, trade the trenches, and embed any of it on any site with one tag. This desktop is your workstation; every window is a real three.ws page.</p>';
		const steps = h('div', 'steps');
		[
			['create', 'Make your agent', 'Start from a selfie, a prompt or a model.'],
			['forge', 'Forge a 3D model', 'Type a prompt and get a textured GLB.'],
			['trenches', 'Trade the trenches', 'Live Solana launches, runners and smart money.'],
			['launcher', 'Launch a coin', 'Put a token on pump.fun from an agent or a prompt.'],
		].forEach(([id, t, s]) => {
			const a = appById(id);
			const b = h('button', 'step', `${tile(a, 'sm', 17)}<div><b>${t}</b><small>${s}</small></div>`);
			b.type = 'button';
			b.addEventListener('click', () => launch(a));
			steps.append(b);
		});
		wrap.append(steps);
		const walkRow = h('p', 'welcome-walk', '');
		const walkBtn = h('button', 'step step-wide', `${icon('world', 22)}<div><b>Walk the campus</b><small>Stand up from the desk and explore the exchange, the launchpad and the gem mine as your avatar. Sit back down at the monitor to return here.</small></div>`);
		walkBtn.type = 'button';
		walkBtn.hidden = !onWorld;
		walkBtn.addEventListener('click', goWorld);
		walkRow.append(walkBtn);
		wrap.append(walkRow);
		wrap.append(h('p', '', 'Drag on the desktop to select icons, right-click for options, and open Settings to make it yours. Press Ctrl+K to search everything.'));
	}

	// ---------- boot ----------
	renderTask();
	applyWall();
	applyPrefs();
	function restore() {
		const raw = store.get(KEY.state);
		const s = sanitizeState(raw, known);
		s.windows.forEach((w) => {
			const app = resolveApp(w.app);
			if (!app) return;
			wm.open(app, { rect: { x: w.x, y: w.y, w: w.w, h: w.h }, max: w.max, min: w.min, path: w.path, quiet: true });
		});
		if (s.focus && wm.has(s.focus)) wm.focus(s.focus);
		return s.windows.length;
	}
	return {
		wm,
		launch,
		launchId,
		restore,
		hasApp: (id) => !!resolveApp(id),
		welcomeIfFirst() {
			if (store.get(KEY.welcomed)) return;
			store.set(KEY.welcomed, '1');
			launchId('welcome');
		},
		toast,
		/** Post to the notification centre: { title, body, app }. */
		notify,
		lock: () => chrome.lock(),
		run: () => chrome.runDialog(),
		about: () => chrome.aboutDialog(),
		store,
		KEY,
		get prefs() {
			return prefs;
		},
		setPrefs,
		onPrefs(fn) {
			prefsListeners.add(fn);
			return () => prefsListeners.delete(fn);
		},
		displayName,
		/** Register the 3D campus. Every "walk" control appears once this is set. */
		set onWorld(fn) {
			onWorld = typeof fn === 'function' ? fn : null;
			btnWorld.hidden = !onWorld;
			if (startWorldEl) startWorldEl.hidden = !onWorld;
			root.querySelectorAll('.welcome-walk .step').forEach((b) => (b.hidden = !onWorld));
		},
		get onWorld() {
			return onWorld;
		},
	};
}

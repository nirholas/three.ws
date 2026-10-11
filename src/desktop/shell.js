// The three.ws desktop shell: wallpaper, icons, taskbar, Start menu, widgets,
// calendar, context menu and the two native apps. Windows are owned by wm.js;
// pure rules live in layout.js.

import { ALL_APPS, APPS, CUSTOM_WALL, WALLPAPERS, appById } from './apps.js';
import { icon } from './icons.js';
import { createIconLayer } from './icon-layer.js';
import { createWM } from './wm.js';
import {
	ACCENTS,
	DEFAULT_PREFS,
	EXPORT_KEYS,
	ICON_SIZES,
	STATE_VERSION,
	cleanTitle,
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

const TASK_H = 48;
const NAV_DATA = '/nav-data.js';
const KEY = {
	state: 'tws:desktop',
	wall: 'tws:wall',
	view: 'tws:view',
	recent: 'tws:recent',
	welcomed: 'tws:welcomed',
	prefs: 'tws:prefs',
	icons: 'tws:icons',
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
	const resolveApp = (id) => appById(id) || catalog.find((a) => a.id === id) || pageFromId(id);
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
	const toasts = h('div', 'os-toasts');
	toasts.setAttribute('role', 'status');
	toasts.setAttribute('aria-live', 'polite');
	root.append(wall, icons, layer, task, toasts);

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
	let tickClock = null;
	let deskIcons = null;

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
	function applyPrefs() {
		root.style.setProperty('--accent', prefs.accent);
		root.style.setProperty('--theme-2', prefs.accent);
		task.classList.toggle('left', prefs.taskbarAlign === 'left');
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
		tickClock?.();
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

	function toast(msg) {
		const t = h('div', 'os-toast');
		t.textContent = msg;
		toasts.append(t);
		setTimeout(() => t.remove(), 4200);
	}

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
		getMetrics: () => ({ vw: innerWidth, vh: innerHeight, menuH: 0, dockH: TASK_H, mobile: innerWidth <= 720 }),
		renderNative: (app, body) => renderNative(app, body),
		notify: toast,
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
		closePops();
		if (app.id === 'settings' && o.section) {
			if (wm.has('settings') && settingsGo) settingsGo(o.section);
			else pendingSection = o.section;
		}
		pushRecent(app.id);
		wm.open(app, o);
	}
	const launchId = (id, o) => launch(resolveApp(id), o);

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
	const btnSearch = h('button', 'os-tb hide-sm', icon('search', 20));
	btnSearch.type = 'button';
	btnSearch.setAttribute('aria-label', 'Search apps and pages');
	btnSearch.title = 'Search';

	const left = h('div', 'os-task-left');
	left.append(btnWidgets);
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
		list.forEach((app) => {
			const w = byId.get(app.id);
			const b = h('button', `os-tb run${w ? ' open' : ''}${w && !w.minimized && focusId === app.id ? ' on' : ''}`, tile(app, 'xs', 15));
			b.type = 'button';
			b.title = w ? w.title : app.title;
			b.setAttribute('aria-label', w ? `${w.title}, ${w.minimized ? 'minimized' : 'open'}` : `Open ${app.title}`);
			b.addEventListener('click', () => {
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
	}

	// tray
	const tray = h('div', 'os-tray');
	const btnTheme = h('button', 'os-tb', '');
	btnTheme.type = 'button';
	const btnClassic = h('button', 'os-tb hide-sm', icon('classic', 20));
	btnClassic.type = 'button';
	btnClassic.title = 'Classic view';
	btnClassic.setAttribute('aria-label', 'Switch to the classic website');
	const chip = h('a', 'os-chip', `${icon('user', 18)}<span>Sign in</span>`);
	chip.href = '/login';
	chip.title = 'Account';
	chip.addEventListener('click', (e) => {
		if (e.metaKey || e.ctrlKey) return;
		e.preventDefault();
		launch(resolveApp(chip.dataset.signedIn ? 'console' : pageAppId('/login')));
	});
	const clock = h('button', 'os-clock');
	clock.type = 'button';
	clock.setAttribute('aria-haspopup', 'dialog');
	clock.setAttribute('aria-expanded', 'false');
	tray.append(btnTheme, btnClassic, chip, clock);
	right.append(tray);

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
	function goClassic() {
		save();
		store.set(KEY.view, 'classic');
		location.assign('/classic');
	}

	tickClock = function () {
		const d = new Date();
		clock.innerHTML = `<span>${d.toLocaleTimeString([], { hour: prefs.clock24 ? '2-digit' : 'numeric', minute: '2-digit', hour12: !prefs.clock24 })}</span><span>${d.toLocaleDateString([], { month: 'numeric', day: 'numeric', year: 'numeric' })}</span>`;
		clock.setAttribute('aria-label', `${d.toLocaleString()}. Open calendar`);
	};
	tickClock();
	setInterval(tickClock, 15000);

	// auth chip (server session is the truth)
	fetch('/api/auth/me', { credentials: 'include' })
		.then((r) => (r.ok ? r.json() : null))
		.then((data) => {
			const u = data && data.user;
			if (!u) return;
			chip.dataset.signedIn = '1';
			chip.querySelector('span').textContent = u.display_name || u.username || 'Account';
			chip.title = 'Open your console';
			userName = u.display_name || u.username || 'Account';
			paintUser();
		})
		.catch(() => {
			/* signed-out view is already correct */
		});
	let userName = '';
	let startUserEl = null;
	const displayName = () => userName || prefs.name || 'Guest';
	function paintUser() {
		if (!startUserEl) return;
		startUserEl.querySelector('span').textContent = displayName();
		const av = startUserEl.querySelector('.avatar');
		av.textContent = initialsOf(userName || prefs.name);
		av.style.setProperty('--hue', prefs.avatarHue);
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
		const search = h('label', 'sm-search', `${icon('search', 18)}<input type="search" placeholder="Search apps and pages" aria-label="Search apps and pages" autocomplete="off" spellcheck="false">`);
		const input = search.querySelector('input');
		const body = h('div', 'sm-body');
		const foot = h('div', 'sm-foot');
		const user = h('button', 'sm-user', `<i class="avatar sm"></i><span></span>`);
		user.type = 'button';
		user.title = 'Your profile and settings';
		startUserEl = user;
		paintUser();
		user.addEventListener('click', () => launchId('settings', { section: 'profile' }));
		const pwr = h('button', 'sm-pwr', icon('classic', 20));
		pwr.type = 'button';
		pwr.title = 'Classic view';
		pwr.setAttribute('aria-label', 'Switch to the classic website');
		pwr.addEventListener('click', goClassic);
		foot.append(user, pwr);
		el.append(search, body, foot);

		let selectable = [];
		let sel = -1;
		const everything = () => [...ALL_APPS.filter((a) => !a.native || a.id === 'settings' || a.id === 'apps'), ...catalog];
		function row(app) {
			const r = h('button', 'sm-row', `${tile(app, 'sm', 17)}<div><b>${esc(app.title)}</b><small>${esc(app.desc || app.href || '')}</small></div>`);
			r.type = 'button';
			r.addEventListener('click', () => launch(app));
			selectable.push(r);
			return r;
		}
		function appBtn(app) {
			const b = h('button', 'sm-app', `${tile(app, '', 22)}<span>${esc(app.title)}</span>`);
			b.type = 'button';
			b.addEventListener('click', () => launch(app));
			selectable.push(b);
			return b;
		}
		let showAll = false;
		function paint() {
			selectable = [];
			sel = -1;
			body.replaceChildren();
			const q = input.value.trim();
			if (q) {
				const hits = rankItems(q, everything()).slice(0, 24);
				if (!hits.length) {
					body.append(h('div', 'sm-empty', `Nothing matches "${esc(q)}". Try an app name like Forge or Chat.`));
					return;
				}
				body.append(h('div', 'sm-h', '<span>Best matches</span>'));
				const list = h('div', 'sm-list one');
				hits.forEach((a) => list.append(row(a)));
				body.append(list);
				return;
			}
			const hd = h('div', 'sm-h', `<span>${showAll ? 'All apps' : 'Pinned'}</span>`);
			const toggle = h('button', '', showAll ? 'Back' : `All apps ${'›'}`);
			toggle.type = 'button';
			toggle.addEventListener('click', () => {
				showAll = !showAll;
				paint();
			});
			hd.append(toggle);
			body.append(hd);
			if (showAll) {
				const list = h('div', 'sm-list');
				everything().forEach((a) => list.append(row(a)));
				body.append(list);
				return;
			}
			const grid = h('div', 'sm-grid');
			[...APPS, ALL_APPS.find((a) => a.id === 'settings'), ALL_APPS.find((a) => a.id === 'apps')].forEach((a) => grid.append(appBtn(a)));
			body.append(grid);
			const rec = recent().map(resolveApp).filter(Boolean).slice(0, 6);
			body.append(h('div', 'sm-h', '<span>Recommended</span>'));
			if (rec.length) {
				const list = h('div', 'sm-list');
				rec.forEach((a) => list.append(row(a)));
				body.append(list);
			} else {
				const list = h('div', 'sm-list');
				['create', 'forge', 'discover', 'chat'].forEach((id) => list.append(row(appById(id))));
				body.append(list);
			}
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
				(selectable[sel >= 0 ? sel : 0])?.click();
			}
		});
		if (!openPop('start', el, btnStart, () => (startUserEl = null))) return;
		input.value = query;
		paint();
		input.focus({ preventScroll: true });
	}
	btnStart.addEventListener('click', () => toggleStart());
	btnSearch.addEventListener('click', () => toggleStart());

	// ---------- Widgets ----------
	let agentLoaded = false;
	btnWidgets.addEventListener('click', () => {
		const el = h('div', 'os-pop widgets');
		el.setAttribute('role', 'dialog');
		el.setAttribute('aria-label', 'Widgets');
		const agent = h('div', 'wg-card wg-agent');
		const stage = h('div', '', '');
		agent.append(stage);
		const info = h('div', '', '<h3>Your resident agent</h3><p>A living 3D agent, running on the same web component you can embed on any site.</p>');
		const acts = h('div', 'wg-actions');
		const talk = h('button', 'os-btn primary', `${icon('chat', 16)}Talk`);
		talk.type = 'button';
		talk.addEventListener('click', () => launchId('chat'));
		const make = h('button', 'os-btn', `${icon('sparkle', 16)}Make your own`);
		make.type = 'button';
		make.addEventListener('click', () => launchId('create'));
		acts.append(talk, make);
		info.append(acts);
		agent.append(info);

		const quick = h('div', 'wg-card');
		quick.append(h('h3', '', 'Jump in'));
		const q = h('div', 'wg-quick');
		['forge', 'discover', 'marketplace', 'pulse', 'trenches', 'tour'].forEach((id) => {
			const a = appById(id);
			const b = h('button', '', `${tile(a, 'sm', 17)}<span>${esc(a.title)}</span>`);
			b.type = 'button';
			b.addEventListener('click', () => launch(a));
			q.append(b);
		});
		quick.append(q);

		const about = h('div', 'wg-card', '<h3>three.ws</h3><p>The 3D agent layer of the internet. Every window here is a real three.ws page. Prefer the original site? Use the classic view in the taskbar.</p>');
		el.append(agent, quick, about);
		if (!openPop('widgets', el, btnWidgets)) return;
		mountAgent(stage);
	});
	function mountAgent(stage) {
		const mk = () => {
			const a = document.createElement('agent-3d');
			a.setAttribute('src', 'https://three.ws/avatars/michelle.glb');
			a.setAttribute('aria-label', 'Resident 3D agent');
			stage.replaceChildren(a);
		};
		if (agentLoaded || customElements.get('agent-3d')) return mk();
		agentLoaded = true;
		const s = document.createElement('script');
		s.type = 'module';
		s.src = 'https://three.ws/agent-3d/latest/agent-3d.js';
		s.onload = mk;
		s.onerror = () => {
			stage.innerHTML = '<p>The 3D agent could not load. Check your connection and reopen Widgets.</p>';
		};
		document.head.append(s);
	}

	// ---------- Calendar ----------
	clock.addEventListener('click', () => {
		let view = new Date();
		view.setDate(1);
		const el = h('div', 'os-pop calendar');
		el.setAttribute('role', 'dialog');
		el.setAttribute('aria-label', 'Calendar');
		function paint() {
			const today = new Date();
			const first = new Date(view.getFullYear(), view.getMonth(), 1);
			const start = new Date(first);
			start.setDate(1 - first.getDay());
			const cells = [];
			for (let i = 0; i < 42; i++) {
				const d = new Date(start);
				d.setDate(start.getDate() + i);
				const cls = [d.getMonth() !== view.getMonth() ? 'mute' : '', d.toDateString() === today.toDateString() ? 'today' : ''].join(' ');
				cells.push(`<b class="${cls}">${d.getDate()}</b>`);
			}
			const dow = ['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((d) => `<i>${d}</i>`).join('');
			el.innerHTML =
				`<div class="cal-head"><span>${view.toLocaleDateString([], { month: 'long', year: 'numeric' })}</span><span>` +
				`<button type="button" data-d="-1" aria-label="Previous month">${icon('chevron', 14).replace('<svg', '<svg style="transform:rotate(180deg)"')}</button>` +
				`<button type="button" data-d="1" aria-label="Next month">${icon('chevron', 14)}</button></span></div>` +
				`<div class="cal-grid">${dow}${cells.join('')}</div>`;
			el.querySelectorAll('[data-d]').forEach((b) =>
				b.addEventListener('click', () => {
					view = new Date(view.getFullYear(), view.getMonth() + Number(b.dataset.d), 1);
					paint();
				}),
			);
		}
		paint();
		openPop('calendar', el, clock);
	});

	// ---------- context menu ----------
	function menu(x, y, items) {
		closePops();
		const el = h('div', 'os-pop ctx');
		el.setAttribute('role', 'menu');
		items.forEach((it) => {
			if (it === '-') return el.append(h('hr'));
			const [label, ic, fn] = it;
			const b = h('button', '', `${icon(ic, 16)}<span>${esc(label)}</span>`);
			b.type = 'button';
			b.setAttribute('role', 'menuitem');
			b.addEventListener('click', () => {
				closePops();
				fn();
			});
			el.append(b);
		});
		root.append(el);
		const r = el.getBoundingClientRect();
		el.style.left = `${Math.max(4, Math.min(x, innerWidth - r.width - 4))}px`;
		el.style.top = `${Math.max(4, Math.min(y, innerHeight - r.height - TASK_H - 4))}px`;
		el.style.bottom = 'auto';
		pop = { kind: 'ctx', el, trigger: null };
		el.querySelector('button')?.focus();
	}
	root.addEventListener('contextmenu', (e) => {
		if (e.target.closest('.win, .os-task, .os-pop')) return;
		e.preventDefault();
		menu(e.clientX, e.clientY, [
			['Select all', 'grid', () => deskIcons.selectAll()],
			['Small icons', 'grid', () => setPrefs({ iconSize: 'small' })],
			['Medium icons', 'grid', () => setPrefs({ iconSize: 'medium' })],
			['Large icons', 'grid', () => setPrefs({ iconSize: 'large' })],
			['Sort by name', 'folder', () => deskIcons.sortByName()],
			['Auto arrange', 'folder', () => deskIcons.arrange()],
			['Refresh', 'reload', () => deskIcons.refresh()],
			'-',
			['All Apps', 'search', () => launchId('apps')],
			['Personalize', 'gear', () => launchId('settings', { section: 'personalize' })],
			['Open Start', 'logo', () => toggleStart()],
			'-',
			['Switch to classic view', 'classic', goClassic],
			['Close all windows', 'close', () => wm.closeAll()],
		]);
	});

	// ---------- desktop icons ----------
	deskIcons = createIconLayer({
		host: icons,
		resolve: resolveApp,
		isKnown: (id) => !!resolveApp(id),
		defaults: () => [...APPS, ...ALL_APPS.filter((a) => a.native)].filter((a) => a.desktop).map((a) => a.id),
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
	});
	icons.setAttribute('role', 'listbox');
	icons.setAttribute('aria-label', 'Desktop');
	icons.setAttribute('aria-multiselectable', 'true');
	deskIcons.init((app) => tile(app, '', 24));
	icons.addEventListener('pointerdown', (e) => {
		if (e.target === icons) closePops();
	});

	// ---------- keyboard ----------
	addEventListener('keydown', (e) => {
		const mod = e.metaKey || e.ctrlKey;
		if (mod && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			closePops();
			toggleStart();
		} else if (e.altKey && e.key === 'Tab') {
			e.preventDefault();
			wm.cycle(e.shiftKey ? -1 : 1);
		} else if (e.altKey && e.key.toLowerCase() === 'w' && wm.focused()) {
			e.preventDefault();
			wm.close(wm.focused());
		}
	});
	let resizeT = 0;
	addEventListener('resize', () => {
		wm.relayout();
		clearTimeout(resizeT);
		resizeT = setTimeout(() => deskIcons.reseat(), 120);
	});

	// ---------- native apps ----------
	const WALL_PREVIEW = {
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
			const b = h('button', '', `${icon(ic, 16)}<span>${label}</span>`);
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
					chip.dataset.signedIn ? `Signed in as ${userName}` : 'Not signed in',
					chip.dataset.signedIn ? 'Your agents, wallets and usage live in the Console.' : 'Sign in to sync your agents and wallets across devices.',
					btn(chip.dataset.signedIn ? 'Open Console' : 'Sign in', () => launch(resolveApp(chip.dataset.signedIn ? 'console' : pageAppId('/login')))),
				),
			);
		}

		function paintPersonalize() {
			pane.append(h('h2', '', 'Personalization'));
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

	function renderNative(app, body) {
		const wrap = h('div', 'native');
		body.append(wrap);
		if (app.id === 'settings') return renderSettings(wrap);
		if (app.id === 'apps') return renderApps(wrap);
		wrap.innerHTML = '<h2>Welcome to three.ws</h2><p>The 3D agent layer of the internet, now as a desktop. Every window is a real three.ws page: drag, resize, snap to an edge, or minimize to the taskbar.</p>';
		const steps = h('div', 'steps');
		[
			['create', 'Make your agent', 'Start from a selfie, a prompt or a model.'],
			['forge', 'Forge a 3D model', 'Type a prompt and get a textured GLB.'],
			['discover', 'Meet other agents', 'Browse every registered agent.'],
		].forEach(([id, t, s]) => {
			const a = appById(id);
			const b = h('button', 'step', `${tile(a, 'sm', 17)}<div><b>${t}</b><small>${s}</small></div>`);
			b.type = 'button';
			b.addEventListener('click', () => launch(a));
			steps.append(b);
		});
		wrap.append(steps);
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
		store,
		KEY,
	};
}

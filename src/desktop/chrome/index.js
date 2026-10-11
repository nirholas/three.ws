// The desktop's system chrome: tray status (network, volume, battery), the
// clock, quick settings, the notification centre with its calendar, toasts,
// the lock screen, power (lock, sign out, restart, shut down), and the Run
// and About dialogs. Every reading is live: the Battery API, the Network
// Information API, navigator.storage, navigator.userAgentData, the session.
// The shell owns popover stacking (openPop/closePops) and hands it in here.

import './chrome.css';
import { icon, registerGlyph } from '../icons.js';
import { formatBytes } from '../layout.js';
import { formatClock, batteryInfo, networkInfo, addNotification, sanitizeNotifications, relTime, parseRun, RUN_ALIASES } from './logic.js';

registerGlyph('mute', '<path d="M4 9h3.5L12 5v14l-4.5-4H4zM16 9.5l5 5M21 9.5l-5 5"/>');
registerGlyph('assistant', '<path d="M12 3.5c.6 3.6 2.4 5.4 6 6-3.6.6-5.4 2.4-6 6-.6-3.6-2.4-5.4-6-6 3.6-.6 5.4-2.4 6-6z"/><path d="M18.5 15.5c.3 1.7 1.1 2.5 2.5 2.8-1.4.3-2.2 1.1-2.5 2.7-.3-1.6-1.1-2.4-2.5-2.7 1.4-.3 2.2-1.1 2.5-2.8z"/>');

const NOTES_KEY = 'tws:notifications';
const OS_VERSION = '12.0';

const h = (tag, cls, html) => {
	const el = document.createElement(tag);
	if (cls) el.className = cls;
	if (html != null) el.innerHTML = html;
	return el;
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const button = (cls, html, label) => {
	const b = h('button', cls, html);
	b.type = 'button';
	if (label) {
		b.setAttribute('aria-label', label);
		b.title = label;
	}
	return b;
};
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Resolve after `el` finishes its CSS transition/animation (or at once with reduced motion). */
function settle(el) {
	if (reduced()) return Promise.resolve();
	return new Promise((res) => {
		el.addEventListener('transitionend', res, { once: true });
		el.addEventListener('animationend', res, { once: true });
	});
}

/** A soft two-note ping, synthesised so it works offline. Honours the volume slider. */
function ping(volume) {
	if (!(volume > 0)) return;
	try {
		const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
		if (!Ctx) return;
		const ctx = new Ctx();
		if (ctx.state === 'suspended') {
			ctx.close().catch(() => {});
			return;
		}
		const t = ctx.currentTime;
		const g = ctx.createGain();
		g.gain.value = 0.0001;
		g.connect(ctx.destination);
		const peak = 0.18 * (volume / 100);
		g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.02);
		g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
		[[880, 0], [1318.5, 0.09]].forEach(([f, dt]) => {
			const o = ctx.createOscillator();
			o.type = 'sine';
			o.frequency.value = f;
			o.connect(g);
			o.start(t + dt);
			o.stop(t + dt + 0.6);
		});
		setTimeout(() => ctx.close().catch(() => {}), 1200);
	} catch {
		/* audio unavailable */
	}
}

/**
 * @param {object} sh shell services: root, store, prefs(), setPrefs(patch), onPrefs(fn),
 *   openPop(kind, el, trigger, onClose), closePops(), menu(x, y, items), launchId(id, o),
 *   resolveApp(id), searchApps(q), wm, save(), displayName(), account(), tile(app,size,glyph),
 *   goClassic()
 */
export function createChrome(sh) {
	const { root, store } = sh;
	let notes = sanitizeNotifications(store.get(NOTES_KEY));
	const noteListeners = new Set();
	const saveNotes = () => {
		store.set(NOTES_KEY, JSON.stringify(notes));
		noteListeners.forEach((fn) => fn());
	};

	// ---------- screen overlays: brightness, night light, energy saver ----------
	const dim = h('div', 'os-dim');
	const night = h('div', 'os-night');
	dim.setAttribute('aria-hidden', 'true');
	night.setAttribute('aria-hidden', 'true');
	root.append(night, dim);
	function applyScreen(p) {
		dim.style.opacity = String(((100 - p.brightness) / 100) * 0.85);
		night.classList.toggle('on', p.nightLight);
		root.classList.toggle('os-saver', p.saver);
	}
	applyScreen(sh.prefs());
	sh.onPrefs(applyScreen);

	// ---------- toasts ----------
	const toasts = h('div', 'os-ntoasts');
	toasts.setAttribute('role', 'status');
	toasts.setAttribute('aria-live', 'polite');
	root.append(toasts);
	function toastCard({ title, body = '', app = '' }, ms = 5200) {
		const a = app ? sh.resolveApp(app) : null;
		const card = h('div', 'os-ntoast');
		card.innerHTML =
			`<div class="nt-head">${a ? sh.tile(a, 'xs', 12) : icon('logo', 14)}<span>${esc(a ? a.title : 'three.ws')}</span>` +
			`<button type="button" class="nt-x" aria-label="Dismiss">${icon('close', 12)}</button></div>` +
			`<b></b>${body ? '<p></p>' : ''}`;
		card.querySelector('b').textContent = title;
		if (body) card.querySelector('p').textContent = body;
		let timer = 0;
		const close = () => {
			clearTimeout(timer);
			if (!card.isConnected || card.classList.contains('out')) return;
			card.classList.add('out');
			settle(card).then(() => card.remove());
		};
		card.querySelector('.nt-x').addEventListener('click', (e) => {
			e.stopPropagation();
			close();
		});
		if (a) {
			card.classList.add('link');
			card.addEventListener('click', () => {
				close();
				sh.launchId(a.id);
			});
		}
		const arm = () => (timer = setTimeout(close, ms));
		card.addEventListener('pointerenter', () => clearTimeout(timer));
		card.addEventListener('pointerleave', arm);
		toasts.append(card);
		while (toasts.children.length > 4) toasts.firstElementChild.remove();
		arm();
	}
	/** Transient message (not kept in the notification centre). */
	function toast(msg) {
		toastCard({ title: String(msg) }, 4200);
	}
	/** A real notification: kept in the centre, toasted unless Do not disturb is on. */
	function notify(n) {
		const before = notes;
		notes = addNotification(notes, typeof n === 'string' ? { title: n } : n);
		if (notes === before) return;
		saveNotes();
		const p = sh.prefs();
		if (p.dnd) return;
		toastCard(notes[0]);
		if (p.sound) ping(p.volume);
	}

	// ---------- live system status ----------
	const status = { battery: null, net: null };
	const statusListeners = new Set();
	const emitStatus = () => statusListeners.forEach((fn) => fn(status));
	function readNet() {
		const c = navigator.connection;
		status.net = networkInfo({ online: navigator.onLine, type: c?.type, effectiveType: c?.effectiveType, downlink: c?.downlink, rtt: c?.rtt });
		emitStatus();
	}
	readNet();
	addEventListener('online', () => {
		readNet();
		notify({ title: 'Back online', body: status.net.detail });
	});
	addEventListener('offline', () => {
		readNet();
		notify({ title: 'You are offline', body: 'three.ws pages will load again when the connection returns. Your files are stored on this device.' });
	});
	navigator.connection?.addEventListener?.('change', readNet);
	let batteryRef = null;
	let warnedLow = false;
	if (navigator.getBattery) {
		navigator
			.getBattery()
			.then((b) => {
				batteryRef = b;
				const read = () => {
					status.battery = batteryInfo(b);
					if (status.battery && !status.battery.charging && status.battery.pct <= 15 && !warnedLow) {
						warnedLow = true;
						notify({ title: 'Battery low', body: `${status.battery.pct}% remaining. Plug in or turn on Energy saver in quick settings.` });
					}
					if (status.battery?.charging) warnedLow = false;
					emitStatus();
				};
				['levelchange', 'chargingchange', 'chargingtimechange', 'dischargingtimechange'].forEach((ev) => b.addEventListener(ev, read));
				read();
			})
			.catch(() => {
				/* no battery API on this device */
			});
	}

	// ---------- tray: status pill and clock ----------
	const statusBtn = button('os-tb os-status', '', 'Quick settings');
	statusBtn.setAttribute('aria-haspopup', 'dialog');
	statusBtn.setAttribute('aria-expanded', 'false');
	function paintStatus() {
		const p = sh.prefs();
		const net = status.net;
		const bat = status.battery;
		const vol = p.volume === 0 || !p.sound ? 'mute' : 'volume';
		statusBtn.innerHTML =
			`<span class="st-ico${net.online ? '' : ' off'}">${icon(net.online ? 'wifi' : 'plane', 16)}</span>` +
			`<span class="st-ico">${icon(vol === 'mute' ? 'mute' : 'volume', 16)}</span>` +
			(bat ? `<span class="st-bat ${bat.tier}${bat.charging ? ' chg' : ''}" style="--lvl:${bat.pct}%"><i></i></span>` : '');
		const parts = [net.online ? `${net.label}, ${net.detail}` : 'Offline', vol === 'mute' ? 'Sound off' : `Volume ${p.volume}%`];
		if (bat) parts.push(`Battery ${bat.pct}%, ${bat.label}`);
		statusBtn.title = parts.join('\n');
		statusBtn.setAttribute('aria-label', `Quick settings. ${parts.join('. ')}`);
	}
	statusListeners.add(paintStatus);
	sh.onPrefs(paintStatus);
	paintStatus();

	const clockBtn = button('os-clock', '');
	clockBtn.setAttribute('aria-haspopup', 'dialog');
	clockBtn.setAttribute('aria-expanded', 'false');
	function paintClock() {
		const p = sh.prefs();
		const d = new Date();
		const { time, date } = formatClock(d, { clock24: p.clock24 });
		const unread = notes.length;
		clockBtn.innerHTML = `<span class="ck-t"><b>${esc(time)}</b><small>${esc(date)}</small></span>${unread && !p.dnd ? `<span class="ck-n" aria-hidden="true">${unread > 9 ? '9+' : unread}</span>` : p.dnd ? `<span class="ck-dnd" aria-hidden="true">${icon('sleep', 14)}</span>` : ''}`;
		clockBtn.title = d.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
		clockBtn.setAttribute('aria-label', `${d.toLocaleString()}. ${unread} notifications. Open notifications and calendar`);
	}
	// Align ticks to the minute boundary so the time flips exactly when the minute does.
	let clockT = 0;
	(function tick() {
		paintClock();
		clockT = setTimeout(tick, 60000 - (Date.now() % 60000) + 5);
	})();
	noteListeners.add(paintClock);
	sh.onPrefs(paintClock);

	// ---------- quick settings ----------
	function slider(label, glyph, value, min, onInput) {
		const row = h('label', 'qs-slider', `${icon(glyph, 18)}<input type="range" min="${min}" max="100" step="1" aria-label="${esc(label)}"><output></output>`);
		const input = row.querySelector('input');
		const out = row.querySelector('output');
		input.value = String(value);
		const paint = () => {
			out.textContent = `${input.value}%`;
			input.style.setProperty('--fill', `${((input.value - min) / (100 - min)) * 100}%`);
		};
		input.addEventListener('input', () => {
			paint();
			onInput(Number(input.value));
		});
		paint();
		return row;
	}
	function toggleQuick() {
		const el = h('div', 'os-pop os-quick');
		el.setAttribute('role', 'dialog');
		el.setAttribute('aria-label', 'Quick settings');
		const grid = h('div', 'qs-grid');
		const tiles = [
			{ id: 'dark', label: 'Dark mode', glyph: 'moon', on: () => document.documentElement.getAttribute('data-theme') !== 'light', flip: (on) => sh.setPrefs({ mode: on ? 'light' : 'dark' }) },
			{ id: 'night', label: 'Night light', glyph: 'sun', on: () => sh.prefs().nightLight, flip: (on) => sh.setPrefs({ nightLight: !on }) },
			{ id: 'dnd', label: 'Do not disturb', glyph: 'sleep', on: () => sh.prefs().dnd, flip: (on) => sh.setPrefs({ dnd: !on }) },
			{ id: 'saver', label: 'Energy saver', glyph: 'battery', on: () => sh.prefs().saver, flip: (on) => sh.setPrefs({ saver: !on }) },
			{ id: 'sound', label: 'System sounds', glyph: 'volume', on: () => sh.prefs().sound, flip: (on) => sh.setPrefs({ sound: !on }) },
			{
				id: 'full',
				label: 'Full screen',
				glyph: 'fullscreen',
				on: () => !!document.fullscreenElement,
				flip: (on) => (on ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => toast('Full screen was blocked by the browser.')),
				hidden: !document.fullscreenEnabled,
			},
		];
		const tileEls = [];
		tiles
			.filter((t) => !t.hidden)
			.forEach((t) => {
				const b = button('qs-tile', `${icon(t.glyph, 18)}<span>${esc(t.label)}</span>`);
				b.setAttribute('aria-pressed', String(!!t.on()));
				b.addEventListener('click', () => {
					t.flip(!!t.on());
				});
				tileEls.push([b, t]);
				grid.append(b);
			});
		const sync = () => tileEls.forEach(([b, t]) => b.setAttribute('aria-pressed', String(!!t.on())));
		const offPrefs = sh.onPrefs(sync);
		const onFs = () => sync();
		document.addEventListener('fullscreenchange', onFs);

		const p = sh.prefs();
		const sliders = h('div', 'qs-sliders');
		sliders.append(
			slider('Brightness', 'sun', p.brightness, 30, (v) => sh.setPrefs({ brightness: v })),
			slider('Volume', 'volume', p.volume, 0, (v) => sh.setPrefs({ volume: v })),
		);

		const info = h('div', 'qs-info');
		function paintInfo() {
			const n = status.net;
			const b = status.battery;
			info.innerHTML =
				`<div class="qs-line">${icon(n.online ? 'wifi' : 'plane', 16)}<div><b>${esc(n.label)}</b><small>${esc(n.detail)}</small></div></div>` +
				(b ? `<div class="qs-line"><span class="st-bat ${b.tier}${b.charging ? ' chg' : ''}" style="--lvl:${b.pct}%"><i></i></span><div><b>${b.pct}%</b><small>${esc(b.label)}</small></div></div>` : '');
		}
		paintInfo();
		statusListeners.add(paintInfo);

		const foot = h('div', 'qs-foot');
		const user = button('qs-user', `<i class="avatar sm" style="--hue:${p.avatarHue}"></i><span>${esc(sh.displayName())}</span>`, 'Your account settings');
		user.addEventListener('click', () => sh.launchId('settings', { section: 'profile' }));
		const gear = button('qs-ico', icon('gear', 18), 'All settings');
		gear.addEventListener('click', () => sh.launchId('settings'));
		const pwr = button('qs-ico', icon('power', 18), 'Power');
		pwr.addEventListener('click', (e) => {
			const r = pwr.getBoundingClientRect();
			e.stopPropagation();
			powerMenu(r.left, r.top - 8, true);
		});
		const acts = h('div', 'qs-foot-acts');
		acts.append(gear, pwr);
		foot.append(user, acts);
		paintAvatar(user.querySelector('.avatar'));

		el.append(grid, sliders, info, foot);
		sh.openPop('quick', el, statusBtn, () => {
			offPrefs();
			statusListeners.delete(paintInfo);
			document.removeEventListener('fullscreenchange', onFs);
		});
	}
	statusBtn.addEventListener('click', toggleQuick);

	// ---------- notification centre + calendar ----------
	function toggleNotes() {
		const el = h('div', 'os-pop os-notes');
		el.setAttribute('role', 'dialog');
		el.setAttribute('aria-label', 'Notifications and calendar');
		const panel = h('section', 'nc-panel');
		const head = h('div', 'nc-head', '<b>Notifications</b>');
		const dndBtn = button('nc-dnd', '', '');
		const clear = button('nc-clear', 'Clear all', 'Clear all notifications');
		clear.addEventListener('click', () => {
			notes = [];
			saveNotes();
		});
		const paintDnd = () => {
			const on = sh.prefs().dnd;
			dndBtn.innerHTML = `${icon('sleep', 14)}<span>${on ? 'Do not disturb is on' : 'Do not disturb'}</span>`;
			dndBtn.setAttribute('aria-pressed', String(on));
		};
		dndBtn.addEventListener('click', () => sh.setPrefs({ dnd: !sh.prefs().dnd }));
		const headActs = h('div', 'nc-head-acts');
		headActs.append(dndBtn, clear);
		head.append(headActs);
		const list = h('div', 'nc-list');
		function paintList() {
			paintDnd();
			clear.hidden = !notes.length;
			list.replaceChildren();
			if (!notes.length) {
				list.append(h('div', 'nc-empty', `${icon('bell', 28)}<b>You're all caught up</b><small>Saved files, finished downloads, connection changes and app alerts land here.</small>`));
				return;
			}
			const now = Date.now();
			notes.forEach((n) => {
				const a = n.app ? sh.resolveApp(n.app) : null;
				const card = h('div', `nc-card${a ? ' link' : ''}`);
				card.innerHTML =
					`<div class="nt-head">${a ? sh.tile(a, 'xs', 12) : icon('logo', 14)}<span>${esc(a ? a.title : 'three.ws')}</span><time>${esc(relTime(n.at, now))}</time>` +
					`<button type="button" class="nt-x" aria-label="Dismiss notification">${icon('close', 12)}</button></div><b></b>${n.body ? '<p></p>' : ''}`;
				card.querySelector('b').textContent = n.title;
				if (n.body) card.querySelector('p').textContent = n.body;
				card.querySelector('.nt-x').addEventListener('click', (e) => {
					e.stopPropagation();
					notes = notes.filter((x) => x.id !== n.id);
					saveNotes();
				});
				if (a)
					card.addEventListener('click', () => {
						sh.closePops();
						sh.launchId(a.id);
					});
				list.append(card);
			});
		}
		panel.append(head, list);
		paintList();
		noteListeners.add(paintList);
		const offPrefs = sh.onPrefs(paintDnd);

		const cal = h('section', 'nc-cal');
		let view = new Date();
		view.setDate(1);
		function paintCal() {
			const today = new Date();
			const first = new Date(view.getFullYear(), view.getMonth(), 1);
			const start = new Date(first);
			start.setDate(1 - first.getDay());
			const cells = [];
			for (let i = 0; i < 42; i++) {
				const d = new Date(start);
				d.setDate(start.getDate() + i);
				const cls = [d.getMonth() !== view.getMonth() ? 'mute' : '', d.toDateString() === today.toDateString() ? 'today' : ''].join(' ').trim();
				cells.push(`<b class="${cls}"${cls.includes('today') ? ' aria-current="date"' : ''}>${d.getDate()}</b>`);
			}
			const dow = [...Array(7)].map((_, i) => `<i>${new Date(2024, 0, 7 + i).toLocaleDateString([], { weekday: 'narrow' })}</i>`).join('');
			cal.innerHTML =
				`<div class="cal-today"><b>${esc(today.toLocaleDateString([], { weekday: 'long' }))}</b><span>${esc(today.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' }))}</span></div>` +
				`<div class="cal-head"><span>${esc(view.toLocaleDateString([], { month: 'long', year: 'numeric' }))}</span><span>` +
				`<button type="button" data-d="0" aria-label="Back to this month">${icon('home', 13)}</button>` +
				`<button type="button" data-d="-1" aria-label="Previous month">${icon('chevron', 14).replace('<svg', '<svg style="transform:rotate(180deg)"')}</button>` +
				`<button type="button" data-d="1" aria-label="Next month">${icon('chevron', 14)}</button></span></div>` +
				`<div class="cal-grid" role="grid">${dow}${cells.join('')}</div>`;
			cal.querySelectorAll('[data-d]').forEach((b) =>
				b.addEventListener('click', () => {
					const d = Number(b.dataset.d);
					view = d ? new Date(view.getFullYear(), view.getMonth() + d, 1) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
					paintCal();
				}),
			);
		}
		paintCal();
		el.append(panel, cal);
		sh.openPop('notes', el, clockBtn, () => {
			noteListeners.delete(paintList);
			offPrefs();
		});
	}
	clockBtn.addEventListener('click', toggleNotes);

	// ---------- dialogs ----------
	function dialog({ title, glyph = 'logo', body, buttons = [], cls = '' }) {
		sh.closePops();
		root.querySelector('.os-dialog-wrap')?.remove();
		const wrap = h('div', 'os-dialog-wrap');
		const dlg = h('div', `os-dialog ${cls}`.trim());
		dlg.setAttribute('role', 'dialog');
		dlg.setAttribute('aria-modal', 'true');
		dlg.setAttribute('aria-label', title);
		dlg.innerHTML = `<div class="dlg-head">${icon(glyph, 18)}<b></b><button type="button" class="dlg-x" aria-label="Close">${icon('close', 14)}</button></div><div class="dlg-body"></div><div class="dlg-foot"></div>`;
		dlg.querySelector('b').textContent = title;
		const bodyEl = dlg.querySelector('.dlg-body');
		if (typeof body === 'string') bodyEl.innerHTML = body;
		else if (body) bodyEl.append(body);
		const prevFocus = document.activeElement;
		const close = () => {
			wrap.classList.add('out');
			removeEventListener('keydown', onKey, true);
			settle(wrap).then(() => wrap.remove());
			if (prevFocus?.isConnected) prevFocus.focus({ preventScroll: true });
		};
		const foot = dlg.querySelector('.dlg-foot');
		buttons.forEach(([label, fn, primary]) => {
			const b = button(`os-btn${primary ? ' primary' : ''}`, esc(label));
			b.addEventListener('click', () => {
				if (fn?.() === false) return;
				close();
			});
			foot.append(b);
		});
		dlg.querySelector('.dlg-x').addEventListener('click', close);
		function onKey(e) {
			if (e.key === 'Escape') {
				e.stopPropagation();
				close();
			}
		}
		addEventListener('keydown', onKey, true);
		wrap.addEventListener('pointerdown', (e) => e.target === wrap && close());
		wrap.append(dlg);
		root.append(wrap);
		(dlg.querySelector('input') || foot.querySelector('.primary') || dlg.querySelector('.dlg-x')).focus({ preventScroll: true });
		return { el: dlg, close };
	}

	function runDialog() {
		const body = h('div', 'run-body', `<p>Type the name of an app, a three.ws page, a folder or a website, and three.ws will open it for you.</p><label class="run-field"><span>Open:</span><input type="text" autocomplete="off" spellcheck="false" list="os-run-list" aria-label="Open"></label><datalist id="os-run-list"></datalist><p class="run-err" role="alert" hidden></p>`);
		const input = body.querySelector('input');
		const err = body.querySelector('.run-err');
		const listEl = body.querySelector('datalist');
		const history = (() => {
			try {
				const v = JSON.parse(store.get('tws:run') || '[]');
				return Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 12) : [];
			} catch {
				return [];
			}
		})();
		history.forEach((v) => listEl.append(Object.assign(document.createElement('option'), { value: v })));
		input.value = history[0] || '';
		const go = () => {
			const raw = input.value.trim();
			const r = parseRun(raw);
			let ok = true;
			if (r.kind === 'empty') ok = false;
			else if (r.kind === 'url') window.open(r.value, '_blank', 'noopener');
			else if (r.kind === 'file') sh.launchId('files', { arg: r.value });
			else if (r.kind === 'path') {
				const app = sh.searchApps('').find((a) => a.href === r.value);
				if (app) sh.launchId(app.id);
				else sh.openPath(r.value);
			} else {
				const alias = RUN_ALIASES[r.value];
				if (alias === 'about') aboutDialog();
				else if (alias && sh.resolveApp(alias)) sh.launchId(alias);
				else {
					const hit = sh.searchApps(r.value)[0];
					if (hit) sh.launchId(hit.id);
					else ok = false;
				}
			}
			if (!ok) {
				err.hidden = false;
				err.textContent = raw ? `three.ws cannot find "${raw}". Check the name, then try again.` : 'Type something to open.';
				input.select();
				return false;
			}
			store.set('tws:run', JSON.stringify([raw, ...history.filter((x) => x !== raw)].slice(0, 12)));
			return true;
		};
		const d = dialog({ title: 'Run', glyph: 'terminal', body, cls: 'run', buttons: [['OK', go, true], ['Cancel'], ['Browse...', () => (sh.launchId('files'), true)]] });
		input.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				if (go()) d.close();
			}
		});
		input.select();
	}

	async function aboutDialog() {
		const body = h('div', 'about-body');
		body.innerHTML = `<div class="about-hero">${icon('logo', 44)}<div><b>three.ws OS</b><span>Version ${OS_VERSION}</span></div></div><dl class="about-specs"></dl><p class="about-legal">three.ws OS runs in your browser. Your desktop, files and settings are stored on this device; three.ws pages and your account live on three.ws.</p>`;
		const specs = body.querySelector('dl');
		const row = (k, v) => v && specs.insertAdjacentHTML('beforeend', `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`);
		const ua = navigator.userAgentData;
		let browser = '';
		let platform = navigator.platform || '';
		try {
			if (ua?.getHighEntropyValues) {
				const v = await ua.getHighEntropyValues(['fullVersionList', 'platformVersion', 'architecture', 'model']);
				const b = (v.fullVersionList || []).find((x) => !/Not.?A.?Brand|Chromium/i.test(x.brand)) || (v.fullVersionList || [])[0];
				if (b) browser = `${b.brand} ${b.version}`;
				platform = [ua.platform, v.platformVersion, v.architecture].filter(Boolean).join(' ');
			}
		} catch {
			/* high entropy hints refused */
		}
		if (!browser) {
			const m = navigator.userAgent.match(/(Firefox|Edg|OPR|Chrome|Safari)\/([\d.]+)/);
			if (m) browser = `${{ Edg: 'Edge', OPR: 'Opera' }[m[1]] || m[1]} ${m[2]}`;
		}
		row('Device name', sh.displayName() === 'Guest' ? location.host : `${sh.displayName()}'s three.ws`);
		row('Browser', browser);
		row('Platform', platform);
		row('Processor', navigator.hardwareConcurrency ? `${navigator.hardwareConcurrency} logical cores` : '');
		row('Memory', navigator.deviceMemory ? `${navigator.deviceMemory} GB or more` : '');
		row('Display', `${screen.width} x ${screen.height} at ${devicePixelRatio}x, ${screen.colorDepth}-bit color`);
		try {
			const est = await navigator.storage.estimate();
			if (est.quota) row('Storage', `${formatBytes(est.usage || 0)} used of ${formatBytes(est.quota)}`);
		} catch {
			/* storage estimate unsupported */
		}
		row('Network', status.net.online ? `${status.net.label}, ${status.net.detail}` : 'Offline');
		if (status.battery) row('Battery', `${status.battery.pct}%, ${status.battery.label}`);
		row('Account', sh.account() ? sh.account().email || sh.displayName() : 'Not signed in');
		dialog({ title: 'About three.ws OS', glyph: 'logo', body, cls: 'about', buttons: [['Changelog', () => (sh.openPath('/changelog'), true)], ['OK', null, true]] });
	}

	// ---------- power ----------
	function powerMenu(x, y, above = false) {
		const items = [
			['Lock', 'lock', () => lock()],
			...(sh.account() ? [['Sign out', 'user', () => signOut()]] : [['Sign in', 'user', () => sh.openPath('/login')]]),
			'-',
			['Restart', 'restart', () => power('restart')],
			['Shut down', 'power', () => power('shutdown')],
		];
		sh.menu(x, y, items, above);
	}

	async function signOut() {
		try {
			const r = await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
			if (!r.ok) throw new Error(`HTTP ${r.status}`);
		} catch (e) {
			toast(`Could not sign out (${e.message}). Check your connection and try again.`);
			return;
		}
		await power('restart', 'Signing out');
	}

	/** Shut down closes every window and saves the session, then leaves a dark screen with a power button; restart does the same and reloads. */
	async function power(kind, label) {
		sh.closePops();
		const screen = h('div', `os-power ${kind}`);
		screen.setAttribute('role', 'alertdialog');
		screen.setAttribute('aria-live', 'assertive');
		const text = label || (kind === 'restart' ? 'Restarting' : 'Shutting down');
		screen.innerHTML = `<div class="pw-spin" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div><p>${esc(text)}</p>`;
		root.append(screen);
		await settle(screen);
		sh.save();
		const closing = sh.wm.list().length;
		sh.wm.closeAll();
		if (closing && !reduced()) await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
		if (kind === 'restart') {
			location.reload();
			return;
		}
		screen.classList.add('off');
		screen.innerHTML = '';
		const on = button('pw-on', icon('power', 30), 'Power on');
		on.addEventListener('click', () => location.reload());
		screen.append(on, h('p', 'pw-hint', 'three.ws OS is shut down. Press the power button to start it again.'));
		on.focus({ preventScroll: true });
	}

	// ---------- lock screen ----------
	let lockEl = null;
	function paintAvatar(av) {
		const a = sh.account();
		const p = sh.prefs();
		av.style.setProperty('--hue', String(p.avatarHue));
		if (a?.avatar_url && /^https?:\/\//.test(a.avatar_url)) {
			av.textContent = '';
			av.style.backgroundImage = `url("${a.avatar_url.replace(/"/g, '%22')}")`;
			av.classList.add('img');
		} else {
			av.textContent = (sh.displayName() || '?').trim().split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase();
		}
	}
	function lock() {
		if (lockEl) return;
		sh.closePops();
		sh.save();
		const el = h('div', 'os-lockscreen');
		el.setAttribute('role', 'dialog');
		el.setAttribute('aria-modal', 'true');
		el.setAttribute('aria-label', 'Locked');
		el.innerHTML =
			`<div class="ls-face"><time class="ls-time"></time><div class="ls-date"></div><p class="ls-hint">Press any key or click to unlock</p></div>` +
			`<div class="ls-sign"><i class="avatar ls-av"></i><b class="ls-name"></b><button type="button" class="ls-go">Sign in</button></div>` +
			`<div class="ls-corner ls-left"></div><div class="ls-corner ls-right"></div>`;
		const timeEl = el.querySelector('.ls-time');
		const dateEl = el.querySelector('.ls-date');
		const tickLock = () => {
			const d = new Date();
			timeEl.textContent = formatClock(d, { clock24: sh.prefs().clock24 }).time.replace(/\s?[AP]M$/i, '');
			timeEl.dateTime = d.toISOString();
			dateEl.textContent = d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
		};
		tickLock();
		const t = setInterval(tickLock, 1000);
		paintAvatar(el.querySelector('.ls-av'));
		el.querySelector('.ls-name').textContent = sh.displayName();
		const left = el.querySelector('.ls-left');
		const net = status.net;
		left.innerHTML = `<span class="ls-chip" title="${esc(net.online ? `${net.label}, ${net.detail}` : 'Offline')}">${icon(net.online ? 'wifi' : 'plane', 18)}</span>` + (status.battery ? `<span class="ls-chip" title="${esc(status.battery.label)}"><span class="st-bat ${status.battery.tier}${status.battery.charging ? ' chg' : ''}" style="--lvl:${status.battery.pct}%"><i></i></span>${status.battery.pct}%</span>` : '');
		const right = el.querySelector('.ls-right');
		const rs = button('ls-chip', icon('restart', 18), 'Restart');
		rs.addEventListener('click', (e) => (e.stopPropagation(), power('restart')));
		const sd = button('ls-chip', icon('power', 18), 'Shut down');
		sd.addEventListener('click', (e) => (e.stopPropagation(), power('shutdown')));
		right.append(rs, sd);
		const go = el.querySelector('.ls-go');
		const reveal = () => {
			if (el.classList.contains('sign')) return;
			el.classList.add('sign');
			go.focus({ preventScroll: true });
		};
		const unlock = () => {
			clearInterval(t);
			removeEventListener('keydown', onKey, true);
			el.classList.add('out');
			settle(el).then(() => el.remove());
			lockEl = null;
		};
		function onKey(e) {
			if (e.key === 'Tab') return;
			e.stopPropagation();
			if (!el.classList.contains('sign')) {
				e.preventDefault();
				reveal();
			} else if (e.key === 'Escape') {
				e.preventDefault();
				el.classList.remove('sign');
			}
		}
		go.addEventListener('click', (e) => {
			e.stopPropagation();
			unlock();
		});
		el.addEventListener('click', (e) => {
			if (!e.target.closest('button')) reveal();
		});
		addEventListener('keydown', onKey, true);
		root.append(el);
		lockEl = el;
		el.focus?.();
	}

	addEventListener('pagehide', () => clearTimeout(clockT));

	return {
		statusBtn,
		clockBtn,
		toast,
		notify,
		toggleQuick,
		toggleNotes,
		runDialog,
		aboutDialog,
		powerMenu,
		power,
		lock,
		dialog,
		paintAvatar,
		get notifications() {
			return notes.slice();
		},
		onNotifications(fn) {
			noteListeners.add(fn);
			return () => noteListeners.delete(fn);
		},
		get status() {
			return { ...status, battery: batteryRef ? status.battery : null };
		},
		onStatus(fn) {
			statusListeners.add(fn);
			return () => statusListeners.delete(fn);
		},
	};
}

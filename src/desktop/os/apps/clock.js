// Clock: world clocks, alarms, timers and a stopwatch.
//
// Alarms and timers are driven by a module-level engine (alarm-logic.js scheduler) that starts the
// first time Clock opens and keeps running after the window closes. It runs while the three.ws
// page is open; it cannot wake a closed tab. A ring plays a synthesized WebAudio tone, raises a
// notification and reopens Clock so it can be dismissed or snoozed.
import './clock.css';
import { DAYS, nextAlarmTime, repeatLabel, untilLabel, formatDuration, parseDuration, stopwatch, lapExtremes, zoneOffsetMinutes, offsetLabel, relativeOffset, isValidZone, isDaytime, subscribeTick, checkAlarms, checkTimers } from './alarm-logic.js';

const K = { zones: 'tws:clock:zones', alarms: 'tws:clock:alarms', timers: 'tws:clock:timers', sw: 'tws:clock:stopwatch', tab: 'tws:clock:tab' };
const SNOOZE_MS = 10 * 60 * 1000;
const PRESETS = [['1 min', 60], ['3 min', 180], ['5 min', 300], ['10 min', 600], ['15 min', 900], ['30 min', 1800], ['1 hour', 3600]];
const LOCAL = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

const uid = () => Math.random().toString(36).slice(2, 9);
const load = (store, k, d) => {
	try {
		const v = JSON.parse(store.get(k));
		return v ?? d;
	} catch {
		return d;
	}
};

// ---------------- engine (module level, outlives the window) ----------------

const engine = {
	ctx: null,
	alarms: [],
	timers: [],
	snoozes: [],
	ringing: [],
	lastNow: Date.now(),
	listeners: new Set(),
	audio: null,
	ringTimer: null,
	ringStop: null,
	started: false,
};

function persist() {
	engine.ctx.store.set(K.alarms, JSON.stringify(engine.alarms));
	engine.ctx.store.set(K.timers, JSON.stringify(engine.timers));
}
const changed = () => engine.listeners.forEach((fn) => fn());

function ensureAudio() {
	try {
		const AC = window.AudioContext || window.webkitAudioContext;
		if (!AC) return null;
		engine.audio ||= new AC();
		if (engine.audio.state === 'suspended') engine.audio.resume().catch(() => {});
		return engine.audio;
	} catch {
		return null;
	}
}

/** One ring cycle: four short beeps. */
function playRingCycle() {
	const ac = ensureAudio();
	if (!ac || ac.state !== 'running') return;
	const t0 = ac.currentTime + 0.02;
	for (let i = 0; i < 4; i++) {
		const t = t0 + i * 0.22;
		const osc = ac.createOscillator();
		const gain = ac.createGain();
		osc.type = 'sine';
		osc.frequency.value = i % 2 ? 988 : 784;
		gain.gain.setValueAtTime(0.0001, t);
		gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
		gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
		osc.connect(gain).connect(ac.destination);
		osc.start(t);
		osc.stop(t + 0.2);
	}
}

function startRinging() {
	if (engine.ringTimer) return;
	playRingCycle();
	engine.ringTimer = setInterval(playRingCycle, 1400);
	engine.ringStop = setTimeout(() => dismissAll(), 90_000);
}
function stopRinging() {
	clearInterval(engine.ringTimer);
	clearTimeout(engine.ringStop);
	engine.ringTimer = engine.ringStop = null;
}

function ring(kind, item) {
	const label = item.label || (kind === 'alarm' ? 'Alarm' : 'Timer');
	engine.ringing.push({ rid: uid(), kind, id: item.id, label, h: item.h, m: item.m });
	const when = kind === 'alarm' && item.h != null ? `${String(item.h).padStart(2, '0')}:${String(item.m).padStart(2, '0')}` : formatDuration(item.total || 0);
	engine.ctx.notify({ title: kind === 'alarm' ? `Alarm ${when}` : 'Timer finished', body: label, app: 'clock' });
	engine.ctx.toast(kind === 'alarm' ? `Alarm: ${label}` : `Timer done: ${label}`);
	startRinging();
	engine.ctx.launchId('clock');
	changed();
}
function dismiss(rid) {
	engine.ringing = engine.ringing.filter((r) => r.rid !== rid);
	if (!engine.ringing.length) stopRinging();
	changed();
}
function dismissAll() {
	engine.ringing = [];
	stopRinging();
	changed();
}
function snooze(rid) {
	const r = engine.ringing.find((x) => x.rid === rid);
	if (!r) return;
	engine.snoozes.push({ id: uid(), label: r.label, endsAt: Date.now() + SNOOZE_MS });
	engine.ctx.toast(`Snoozed for ${SNOOZE_MS / 60000} minutes`);
	dismiss(rid);
}

function onTick(now) {
	let dirty = false;
	const a = checkAlarms(engine.alarms, now, engine.lastNow);
	engine.lastNow = now;
	if (a.fired.length) {
		engine.alarms = a.alarms;
		dirty = true;
		a.fired.forEach((x) => ring('alarm', x));
	}
	const t = checkTimers(engine.timers, now);
	if (t.fired.length) {
		engine.timers = t.timers;
		dirty = true;
		t.fired.forEach((x) => ring('timer', x));
	}
	const due = engine.snoozes.filter((s) => s.endsAt <= now);
	if (due.length) {
		engine.snoozes = engine.snoozes.filter((s) => s.endsAt > now);
		due.forEach((s) => ring('alarm', { id: s.id, label: `${s.label} (snoozed)` }));
	}
	if (dirty) persist();
}

function startEngine(ctx) {
	if (engine.started) {
		engine.ctx = ctx;
		return;
	}
	engine.started = true;
	engine.ctx = ctx;
	engine.alarms = load(ctx.store, K.alarms, []).filter((a) => a && Number.isInteger(a.h) && Number.isInteger(a.m));
	engine.timers = load(ctx.store, K.timers, []).filter((t) => t && t.total > 0);
	engine.lastNow = Date.now();
	// Browsers only allow audio after a gesture, so unlock it on the first interaction anywhere.
	const unlock = () => {
		ensureAudio();
		document.removeEventListener('pointerdown', unlock, true);
		document.removeEventListener('keydown', unlock, true);
	};
	document.addEventListener('pointerdown', unlock, true);
	document.addEventListener('keydown', unlock, true);
	subscribeTick(onTick);
	onTick(Date.now());
}

// ---------------- svg helpers ----------------

const svg = (body, size = 16, extra = '') => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`;
const ICO = {
	play: svg('<path d="M7 4.5v15l12-7.5z" fill="currentColor"/>'),
	pause: svg('<path d="M8 5v14M16 5v14" stroke-width="3"/>'),
	reset: svg('<path d="M4 12a8 8 0 1 0 2.5-5.8M4 4v5h5"/>'),
	trash: svg('<path d="M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13"/>'),
	plus: svg('<path d="M12 5v14M5 12h14"/>'),
	flag: svg('<path d="M6 21V4M6 5h12l-2.5 4L18 13H6"/>'),
	sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>', 14),
	moon: svg('<path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z"/>', 14),
	edit: svg('<path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4"/>'),
	bell: svg('<path d="M6 17V11a6 6 0 0 1 12 0v6l1.5 2h-15zM10 21h4"/>', 40),
};

const hhmm = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
const fmtTime12 = (h, m) => {
	const p = h >= 12 ? 'PM' : 'AM';
	return { t: `${h % 12 || 12}:${String(m).padStart(2, '0')}`, p };
};
const cityOf = (z) => (z.split('/').pop() || z).replace(/_/g, ' ');

function analogSvg() {
	let ticks = '';
	for (let i = 0; i < 60; i++) {
		const a = (i * 6 * Math.PI) / 180;
		const r1 = i % 5 === 0 ? 40 : 44;
		ticks += `<line x1="${50 + Math.sin(a) * r1}" y1="${50 - Math.cos(a) * r1}" x2="${50 + Math.sin(a) * 47}" y2="${50 - Math.cos(a) * 47}" class="${i % 5 === 0 ? 'big' : ''}"/>`;
	}
	return `<svg viewBox="0 0 100 100" class="clk-face" role="img" aria-label="Analog clock"><circle cx="50" cy="50" r="49" class="rim"/>${ticks}<line class="hh" x1="50" y1="50" x2="50" y2="28"/><line class="mh" x1="50" y1="50" x2="50" y2="16"/><line class="sh" x1="50" y1="56" x2="50" y2="12"/><circle cx="50" cy="50" r="2.6" class="pin"/></svg>`;
}

// ---------------- app ----------------

export function mount(host, ctx) {
	startEngine(ctx);
	const { h, esc, store } = ctx;
	host.classList.add('napp-clock');
	host.innerHTML = '';
	const root = h('div', 'clk');
	const tabs = h('div', 'clk-tabs');
	tabs.setAttribute('role', 'tablist');
	const panel = h('div', 'clk-panel');
	panel.setAttribute('role', 'tabpanel');
	const ringBox = h('div', 'clk-ringbox');
	ringBox.setAttribute('role', 'alert');
	root.append(ringBox, tabs, panel);
	host.append(root);

	const TAB_DEFS = [['world', 'World clock'], ['alarms', 'Alarms'], ['timer', 'Timer'], ['stopwatch', 'Stopwatch']];
	let tab = store.get(K.tab);
	if (!TAB_DEFS.some(([id]) => id === tab)) tab = 'world';
	let zones = load(store, K.zones, null);
	if (!Array.isArray(zones)) zones = ['Europe/London', 'America/New_York', 'Asia/Tokyo'];
	zones = zones.filter((z) => typeof z === 'string' && isValidZone(z));
	let sw = { ...stopwatch.fresh(), ...load(store, K.sw, {}) };
	if (!Array.isArray(sw.laps)) sw.laps = [];
	let editing = null; // alarm id, 'new', or null
	let rafId = 0;
	const tickers = new Set();

	for (const [id, label] of TAB_DEFS) {
		const b = h('button', 'clk-tab', label);
		b.type = 'button';
		b.id = `clk-tab-${id}`;
		b.setAttribute('role', 'tab');
		b.addEventListener('click', () => setTab(id));
		b.addEventListener('keydown', (e) => {
			const i = TAB_DEFS.findIndex(([x]) => x === tab);
			if (e.key === 'ArrowRight') setTab(TAB_DEFS[(i + 1) % 4][0], true);
			else if (e.key === 'ArrowLeft') setTab(TAB_DEFS[(i + 3) % 4][0], true);
			else return;
			e.preventDefault();
		});
		tabs.append(b);
	}
	function setTab(id, focus) {
		tab = id;
		store.set(K.tab, id);
		editing = null;
		for (const b of tabs.children) {
			const on = b.id === `clk-tab-${id}`;
			b.classList.toggle('on', on);
			b.setAttribute('aria-selected', String(on));
			b.tabIndex = on ? 0 : -1;
			if (on && focus) b.focus();
		}
		panel.setAttribute('aria-labelledby', `clk-tab-${id}`);
		render();
	}

	function render() {
		tickers.clear();
		cancelAnimationFrame(rafId);
		panel.replaceChildren();
		({ world: renderWorld, alarms: renderAlarms, timer: renderTimers, stopwatch: renderStopwatch })[tab]();
	}

	// ---- ring banners (any tab) ----
	function renderRing() {
		ringBox.replaceChildren(
			...engine.ringing.map((r) => {
				const row = h('div', 'clk-ring');
				row.innerHTML = `<span class="ico">${ICO.bell}</span><div><b>${esc(r.label)}</b><small>${r.kind === 'alarm' ? 'Alarm' : 'Timer finished'}</small></div>`;
				const sn = h('button', 'clk-btn', 'Snooze 10 min');
				sn.type = 'button';
				if (r.kind === 'alarm') sn.addEventListener('click', () => snooze(r.rid));
				else sn.hidden = true;
				const ds = h('button', 'clk-btn primary', 'Dismiss');
				ds.type = 'button';
				ds.addEventListener('click', () => dismiss(r.rid));
				row.append(sn, ds);
				return row;
			}),
		);
		ringBox.classList.toggle('on', engine.ringing.length > 0);
	}

	// ---------------- world ----------------
	function renderWorld() {
		const wrap = h('div', 'clk-world');
		const top = h('div', 'clk-hero');
		top.innerHTML = `${analogSvg()}<div class="clk-hero-t"><div class="big" data-k="local-t"></div><div class="sub" data-k="local-d"></div><div class="sub dim">${esc(cityOf(LOCAL))} (${esc(LOCAL)})</div></div>`;
		const face = top.querySelector('.clk-face');
		const add = h('form', 'clk-add');
		add.autocomplete = 'off';
		const input = h('input', 'clk-input');
		input.placeholder = 'Add a city or time zone, like Tokyo';
		input.setAttribute('aria-label', 'Add a city or time zone');
		input.setAttribute('role', 'combobox');
		input.setAttribute('aria-expanded', 'false');
		const sug = h('ul', 'clk-sug');
		sug.setAttribute('role', 'listbox');
		sug.hidden = true;
		add.append(input, sug);
		let all = [];
		try {
			all = Intl.supportedValuesOf('timeZone');
		} catch {
			all = [];
		}
		if (!all.includes('UTC')) all.push('UTC');
		let hi = -1;
		let matches = [];
		const pick = (z) => {
			if (!isValidZone(z)) return ctx.toast(`"${z}" is not a known time zone`);
			if (z === LOCAL || zones.includes(z)) ctx.toast('That clock is already on the list');
			else {
				zones.push(z);
				store.set(K.zones, JSON.stringify(zones));
			}
			render();
		};
		const showSug = () => {
			const q = input.value.trim().toLowerCase().replace(/\s+/g, '_');
			matches = q ? all.filter((z) => z.toLowerCase().includes(q)).slice(0, 8) : [];
			hi = matches.length ? 0 : -1;
			sug.replaceChildren(
				...matches.map((z, i) => {
					const li = h('li', i === hi ? 'on' : '', `<b>${esc(cityOf(z))}</b><span>${esc(z)} &middot; ${esc(offsetLabel(zoneOffsetMinutes(z)))}</span>`);
					li.setAttribute('role', 'option');
					li.addEventListener('mousedown', (e) => {
						e.preventDefault();
						pick(z);
					});
					return li;
				}),
			);
			if (q && !matches.length) sug.append(h('li', 'none', 'No matching time zone. Try a city like Paris or a name like Asia/Tokyo.'));
			sug.hidden = !q;
			input.setAttribute('aria-expanded', String(!sug.hidden));
		};
		input.addEventListener('input', showSug);
		input.addEventListener('blur', () => (sug.hidden = true));
		input.addEventListener('focus', showSug);
		input.addEventListener('keydown', (e) => {
			if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
				if (!matches.length) return;
				hi = (hi + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
				[...sug.children].forEach((li, i) => li.classList.toggle('on', i === hi));
				e.preventDefault();
			} else if (e.key === 'Escape') sug.hidden = true;
		});
		add.addEventListener('submit', (e) => {
			e.preventDefault();
			const v = input.value.trim();
			if (hi >= 0 && matches[hi]) pick(matches[hi]);
			else if (v) pick(v);
		});
		const list = h('div', 'clk-zones');
		const rows = zones.map((z) => {
			const card = h('div', 'clk-zone');
			card.innerHTML = `<div class="l"><b>${esc(cityOf(z))}</b><small data-k="rel"></small></div><div class="r"><div class="t" data-k="t"></div><small data-k="d"></small></div><span class="dn" data-k="dn"></span>`;
			const rm = h('button', 'clk-x', ICO.trash);
			rm.type = 'button';
			rm.title = `Remove ${cityOf(z)}`;
			rm.setAttribute('aria-label', `Remove ${cityOf(z)}`);
			rm.addEventListener('click', () => {
				zones = zones.filter((x) => x !== z);
				store.set(K.zones, JSON.stringify(zones));
				render();
			});
			card.append(rm);
			list.append(card);
			return { z, card };
		});
		if (!rows.length) list.append(h('p', 'clk-empty', 'No other clocks yet. Add a city above to compare its time with yours.'));
		wrap.append(top, add, list);
		panel.append(wrap);
		const q = (el, k) => el.querySelector(`[data-k="${k}"]`);
		const update = () => {
			const now = new Date();
			q(top, 'local-t').textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
			q(top, 'local-d').textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
			const s = now.getSeconds() + now.getMilliseconds() / 1000;
			const m = now.getMinutes() + s / 60;
			const hr = (now.getHours() % 12) + m / 60;
			face.querySelector('.sh').setAttribute('transform', `rotate(${s * 6} 50 50)`);
			face.querySelector('.mh').setAttribute('transform', `rotate(${m * 6} 50 50)`);
			face.querySelector('.hh').setAttribute('transform', `rotate(${hr * 30} 50 50)`);
			const localOff = -now.getTimezoneOffset();
			for (const { z, card } of rows) {
				const off = zoneOffsetMinutes(z, now);
				q(card, 't').textContent = now.toLocaleTimeString([], { timeZone: z, hour: '2-digit', minute: '2-digit' });
				q(card, 'd').textContent = now.toLocaleDateString([], { timeZone: z, weekday: 'short', month: 'short', day: 'numeric' });
				q(card, 'rel').textContent = `${offsetLabel(off)} · ${relativeOffset(off, localOff)}`;
				const day = isDaytime(z, now);
				const dn = q(card, 'dn');
				dn.innerHTML = day ? ICO.sun : ICO.moon;
				dn.title = day ? 'Daytime' : 'Night';
				card.classList.toggle('night', !day);
			}
		};
		update();
		tickers.add(update);
	}

	// ---------------- alarms ----------------
	function renderAlarms() {
		const wrap = h('div', 'clk-alarms');
		const head = h('div', 'clk-head');
		const sorted = [...engine.alarms].sort((a, b) => a.h * 60 + a.m - (b.h * 60 + b.m));
		const nextUp = engine.alarms.map((a) => nextAlarmTime(a)).filter(Boolean).sort((a, b) => a - b)[0];
		head.innerHTML = `<div><h2>Alarms</h2><small>${nextUp ? `Next alarm ${untilLabel(nextUp)}` : 'No alarms are set'}</small></div>`;
		const addBtn = h('button', 'clk-btn primary', `${ICO.plus} New alarm`);
		addBtn.type = 'button';
		addBtn.addEventListener('click', () => {
			editing = 'new';
			render();
		});
		head.append(addBtn);
		wrap.append(head);
		if (editing) wrap.append(alarmForm());
		if (!sorted.length && !editing) {
			const e = h('div', 'clk-emptybox', `<div class="ico">${ICO.bell}</div><b>No alarms yet</b><p>Add an alarm and it will ring with a sound and a notification while three.ws is open, even after you close this window.</p>`);
			wrap.append(e);
		}
		const list = h('ul', 'clk-alist');
		for (const a of sorted) {
			const li = h('li', `clk-alarm${a.on ? '' : ' off'}`);
			const t = fmtTime12(a.h, a.m);
			const nt = a.on ? nextAlarmTime(a) : null;
			li.innerHTML = `<div class="tm"><span>${hhmm(a.h, a.m)}</span><small>${t.t} ${t.p}</small></div><div class="inf"><b>${esc(a.label || 'Alarm')}</b><small>${esc(repeatLabel(a.days))}${nt ? ` · ${untilLabel(nt)}` : ''}</small></div>`;
			const sw2 = h('button', `clk-switch${a.on ? ' on' : ''}`);
			sw2.type = 'button';
			sw2.setAttribute('role', 'switch');
			sw2.setAttribute('aria-checked', String(a.on));
			sw2.setAttribute('aria-label', `${a.label || 'Alarm'} at ${hhmm(a.h, a.m)}`);
			sw2.addEventListener('click', () => {
				a.on = !a.on;
				persist();
				render();
			});
			const ed = h('button', 'clk-x', ICO.edit);
			ed.type = 'button';
			ed.title = 'Edit';
			ed.setAttribute('aria-label', `Edit alarm ${hhmm(a.h, a.m)}`);
			ed.addEventListener('click', () => {
				editing = a.id;
				render();
			});
			const rm = h('button', 'clk-x', ICO.trash);
			rm.type = 'button';
			rm.title = 'Delete';
			rm.setAttribute('aria-label', `Delete alarm ${hhmm(a.h, a.m)}`);
			rm.addEventListener('click', () => {
				engine.alarms = engine.alarms.filter((x) => x.id !== a.id);
				persist();
				render();
			});
			li.append(sw2, ed, rm);
			list.append(li);
		}
		wrap.append(list);
		panel.append(wrap);
	}
	function alarmForm() {
		const cur = engine.alarms.find((a) => a.id === editing);
		const d = new Date(Date.now() + 3600_000);
		const a = cur ? { ...cur, days: [...cur.days] } : { id: uid(), on: true, h: d.getHours(), m: 0, days: [], label: '' };
		const form = h('form', 'clk-form');
		form.innerHTML = `<label>Time<input type="time" class="clk-input" required value="${hhmm(a.h, a.m)}"></label><label>Label<input type="text" class="clk-input" maxlength="60" placeholder="Alarm" value="${esc(a.label || '')}"></label><fieldset><legend>Repeat</legend><div class="days"></div></fieldset>`;
		const timeIn = form.querySelector('input[type=time]');
		const labelIn = form.querySelector('input[type=text]');
		const daysEl = form.querySelector('.days');
		DAYS.forEach((name, i) => {
			const b = h('button', `clk-day${a.days.includes(i) ? ' on' : ''}`, name[0]);
			b.type = 'button';
			b.title = name;
			b.setAttribute('aria-label', name);
			b.setAttribute('aria-pressed', String(a.days.includes(i)));
			b.addEventListener('click', () => {
				a.days = a.days.includes(i) ? a.days.filter((x) => x !== i) : [...a.days, i];
				b.classList.toggle('on');
				b.setAttribute('aria-pressed', String(a.days.includes(i)));
			});
			daysEl.append(b);
		});
		const row = h('div', 'clk-actions');
		const cancel = h('button', 'clk-btn', 'Cancel');
		cancel.type = 'button';
		cancel.addEventListener('click', () => {
			editing = null;
			render();
		});
		const save = h('button', 'clk-btn primary', 'Save');
		save.type = 'submit';
		row.append(cancel, save);
		form.append(row);
		form.addEventListener('submit', (e) => {
			e.preventDefault();
			const [hh, mm] = timeIn.value.split(':').map(Number);
			if (!Number.isInteger(hh) || !Number.isInteger(mm)) return ctx.toast('Pick a time for the alarm');
			Object.assign(a, { h: hh, m: mm, on: true, label: labelIn.value.trim() });
			if (cur) engine.alarms = engine.alarms.map((x) => (x.id === a.id ? a : x));
			else engine.alarms.push(a);
			ensureAudio();
			persist();
			editing = null;
			ctx.toast(`Alarm set ${untilLabel(nextAlarmTime(a))}`);
			render();
		});
		queueMicrotask(() => timeIn.focus());
		return form;
	}

	// ---------------- timers ----------------
	function renderTimers() {
		const wrap = h('div', 'clk-timers');
		const head = h('div', 'clk-head');
		head.innerHTML = '<div><h2>Timer</h2><small>Run several at once. They keep counting if you close this window.</small></div>';
		wrap.append(head);
		const form = h('form', 'clk-tform');
		const chips = h('div', 'clk-chips');
		const startTimer = (sec, label) => {
			ensureAudio();
			engine.timers.push({ id: uid(), label: label || '', total: sec * 1000, left: sec * 1000, endsAt: Date.now() + sec * 1000, done: false });
			persist();
			render();
		};
		for (const [l, s] of PRESETS) {
			const b = h('button', 'clk-chip', l);
			b.type = 'button';
			b.addEventListener('click', () => startTimer(s));
			chips.append(b);
		}
		const dur = h('input', 'clk-input');
		dur.placeholder = 'Custom: 90, 1:30 or 1h 5m';
		dur.setAttribute('aria-label', 'Custom duration');
		const lab = h('input', 'clk-input');
		lab.placeholder = 'Label (optional)';
		lab.maxLength = 60;
		lab.setAttribute('aria-label', 'Timer label');
		const go = h('button', 'clk-btn primary', `${ICO.play} Start`);
		go.type = 'submit';
		form.append(chips, dur, lab, go);
		form.addEventListener('submit', (e) => {
			e.preventDefault();
			const ms = parseDuration(dur.value);
			if (!ms || ms < 1000) {
				dur.setCustomValidity('Enter a duration like 90, 1:30 or 1h 5m');
				dur.reportValidity();
				dur.setCustomValidity('');
				return;
			}
			startTimer(ms / 1000, lab.value.trim());
		});
		wrap.append(form);
		if (!engine.timers.length) wrap.append(h('div', 'clk-emptybox', '<b>No timers running</b><p>Pick a preset or type a custom duration to start one.</p>'));
		const list = h('div', 'clk-tlist');
		const cards = engine.timers.map((t) => {
			const card = h('div', `clk-timer${t.done ? ' done' : ''}`);
			card.innerHTML = `<svg viewBox="0 0 44 44" class="ring" aria-hidden="true"><circle cx="22" cy="22" r="19" class="bg"/><circle cx="22" cy="22" r="19" class="fg" stroke-dasharray="119.4" data-k="arc"/></svg><div class="inf"><b>${esc(t.label || formatDuration(t.total))}</b><div class="left" data-k="left"></div></div>`;
			const toggle = h('button', 'clk-btn round', t.endsAt ? ICO.pause : ICO.play);
			toggle.type = 'button';
			toggle.setAttribute('aria-label', t.endsAt ? 'Pause timer' : 'Start timer');
			toggle.disabled = t.done;
			toggle.addEventListener('click', () => {
				if (t.endsAt) {
					t.left = Math.max(0, t.endsAt - Date.now());
					t.endsAt = null;
				} else t.endsAt = Date.now() + t.left;
				ensureAudio();
				persist();
				render();
			});
			const reset = h('button', 'clk-x', ICO.reset);
			reset.type = 'button';
			reset.title = 'Restart';
			reset.setAttribute('aria-label', 'Restart timer');
			reset.addEventListener('click', () => {
				Object.assign(t, { left: t.total, endsAt: null, done: false });
				persist();
				render();
			});
			const rm = h('button', 'clk-x', ICO.trash);
			rm.type = 'button';
			rm.title = 'Delete';
			rm.setAttribute('aria-label', 'Delete timer');
			rm.addEventListener('click', () => {
				engine.timers = engine.timers.filter((x) => x.id !== t.id);
				persist();
				render();
			});
			card.append(toggle, reset, rm);
			list.append(card);
			return { t, card };
		});
		wrap.append(list);
		panel.append(wrap);
		const update = () => {
			const now = Date.now();
			for (const { t, card } of cards) {
				const left = t.endsAt ? Math.max(0, t.endsAt - now) : t.left;
				card.querySelector('[data-k=left]').textContent = t.done ? 'Time is up' : formatDuration(Math.ceil(left / 1000) * 1000);
				card.querySelector('[data-k=arc]').setAttribute('stroke-dashoffset', String(119.4 * (1 - (t.done ? 0 : left / t.total))));
				card.classList.toggle('paused', !t.endsAt && !t.done);
			}
		};
		update();
		tickers.add(update);
	}

	// ---------------- stopwatch ----------------
	function renderStopwatch() {
		const wrap = h('div', 'clk-sw');
		const big = h('div', 'clk-swbig');
		big.setAttribute('role', 'timer');
		const btns = h('div', 'clk-actions center');
		const lapB = h('button', 'clk-btn', `${ICO.flag} Lap`);
		lapB.type = 'button';
		const mainB = h('button', 'clk-btn primary big');
		mainB.type = 'button';
		const rstB = h('button', 'clk-btn', `${ICO.reset} Reset`);
		rstB.type = 'button';
		btns.append(lapB, mainB, rstB);
		const listWrap = h('div', 'clk-laps');
		wrap.append(big, btns, listWrap);
		panel.append(wrap);
		const saveSw = () => store.set(K.sw, JSON.stringify(sw));
		const draw = () => {
			big.textContent = formatDuration(stopwatch.now(sw), true);
			mainB.innerHTML = sw.running ? `${ICO.pause} Pause` : `${ICO.play} ${sw.elapsed ? 'Resume' : 'Start'}`;
			lapB.disabled = !sw.running;
			rstB.disabled = !sw.running && !sw.elapsed;
		};
		const drawLaps = () => {
			listWrap.replaceChildren();
			if (!sw.laps.length) {
				listWrap.append(h('p', 'clk-empty', 'Start the stopwatch, then tap Lap to record split times.'));
				return;
			}
			const ex = lapExtremes(sw.laps);
			const ol = h('ol', 'clk-laplist');
			for (const l of [...sw.laps].reverse()) {
				const tag = l.n === ex.fastest ? ' fast' : l.n === ex.slowest ? ' slow' : '';
				ol.append(h('li', tag.trim(), `<span>Lap ${l.n}</span><b>${formatDuration(l.split, true)}</b><small>${formatDuration(l.total, true)}</small>`));
			}
			listWrap.append(ol);
		};
		const loop = () => {
			draw();
			if (sw.running) rafId = requestAnimationFrame(loop);
		};
		mainB.addEventListener('click', () => {
			sw = sw.running ? stopwatch.pause(sw) : stopwatch.start(sw);
			saveSw();
			loop();
		});
		lapB.addEventListener('click', () => {
			sw = stopwatch.lap(sw);
			saveSw();
			drawLaps();
		});
		rstB.addEventListener('click', () => {
			sw = stopwatch.fresh();
			saveSw();
			cancelAnimationFrame(rafId);
			draw();
			drawLaps();
		});
		draw();
		drawLaps();
		if (sw.running) loop();
	}

	// ---------------- wiring ----------------
	let lastAlarmView = '';
	const refresh = () => {
		renderRing();
		if (tab === 'alarms' && !editing) render();
		else if (tab === 'timer') render();
	};
	engine.listeners.add(refresh);
	const unTick = subscribeTick(() => {
		tickers.forEach((fn) => fn());
		if (tab === 'alarms' && !editing) {
			const key = engine.alarms.map((a) => a.on).join();
			if (key !== lastAlarmView) {
				lastAlarmView = key;
				render();
			}
		}
	});
	setTab(tab);
	renderRing();
	return () => {
		engine.listeners.delete(refresh);
		unTick();
		cancelAnimationFrame(rafId);
	};
}

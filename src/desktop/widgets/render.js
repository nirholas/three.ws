// One renderer per widget type. `renderWidget(body, w, api)` fills `body`
// (the card under its header) for widget `w` ({ type, size, data }) and
// returns a cleanup function. Every value comes from a feed in data.js or from
// the device itself; a feed that fails shows what went wrong and a Retry.

import { icon } from '../icons.js';
import { describeEvent } from '../../field/logic.js';
import { refresh, subscribe, searchPlaces, locate, setPlace, THREE_MINT } from './data.js';
import { fmtBytes, fmtCompact, fmtPct, fmtPrice, monthGrid, relTime, sparkPath, weatherInfo, weekStartFor } from './logic.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const LOCALE = navigator.language || 'en-US';
let uid = 0;

// ---------- shared states ----------

function skeleton(body, rows = 3) {
	body.innerHTML = `<div class="wgx-skel" aria-hidden="true">${'<i></i>'.repeat(rows)}</div>`;
	body.setAttribute('aria-busy', 'true');
}
function failed(body, msg, key) {
	body.removeAttribute('aria-busy');
	body.innerHTML = `<div class="wgx-off"><b>${icon('cloud', 18)} Offline</b><span>${esc(msg)}</span><button type="button" class="wgx-btn">Retry</button></div>`;
	body.querySelector('button').addEventListener('click', () => refresh(key));
}
/** Subscribe `paint(data)` to a feed with the skeleton, error and stale states handled. */
function bind(body, key, paint, rows) {
	let painted = false;
	return subscribe(key, (s) => {
		if (s.data === undefined) {
			if (s.error) failed(body, s.error, key);
			else if (!painted) skeleton(body, rows);
			return;
		}
		body.removeAttribute('aria-busy');
		paint(s.data);
		painted = true;
		body.closest('.wgx')?.classList.toggle('stale', !!s.error);
	});
}
const initial = (name) => esc(String(name || '?').trim().slice(0, 1).toUpperCase() || '?');
const thumb = (url, name, cls = 'wgx-av') =>
	url ? `<img class="${cls}" src="${esc(url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" data-ph="${initial(name)}">` : `<i class="${cls} ph">${initial(name)}</i>`;

/**
 * One capture-phase listener per widget host: a broken avatar becomes its
 * initial, a broken news photo is dropped.
 */
export function handleBrokenImages(host) {
	host.addEventListener(
		'error',
		(e) => {
			const img = e.target;
			if (!(img instanceof HTMLImageElement) || !host.contains(img)) return;
			if (img.dataset.ph == null) return img.remove();
			const i = document.createElement('i');
			i.className = `${img.className} ph`;
			i.textContent = img.dataset.ph;
			img.replaceWith(i);
		},
		true,
	);
}

// ---------- $THREE ----------

function three(body, w, api) {
	const id = `wgx-g${++uid}`;
	let token = null;
	let candles = null;
	body.classList.add('wgx-three');
	const paint = () => {
		if (!token) return;
		const up = Number(token.price_change_24h) >= 0;
		const closes = (candles || []).map((c) => c.c);
		const W = w.size === 's' ? 136 : 300;
		const H = w.size === 'l' ? 120 : w.size === 's' ? 40 : 58;
		const p = sparkPath(closes, W, H);
		const chart = p.line
			? `<svg class="wgx-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="$THREE price over the last 24 hours"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".35"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></linearGradient></defs><path d="${p.area}" fill="url(#${id})"/><path d="${p.line}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`
			: candles
				? '<p class="wgx-mute wgx-nochart">No trades in the last 24 hours to chart.</p>'
				: '<div class="wgx-skel"><i></i></div>';
		const facts =
			w.size === 's'
				? ''
				: `<dl class="wgx-facts"><div><dt>Mkt cap</dt><dd>${fmtCompact(token.market_cap, '$')}</dd></div><div><dt>Vol 24h</dt><dd>${fmtCompact(token.volume_24h, '$')}</dd></div><div><dt>Holders</dt><dd>${fmtCompact(token.holders)}</dd></div>${w.size === 'l' ? `<div><dt>Liquidity</dt><dd>${fmtCompact(token.liquidity, '$')}</dd></div>` : ''}</dl>`;
		const actions =
			w.size === 'l'
				? `<div class="wgx-row-btns"><button type="button" class="wgx-btn primary" data-act="trade">${icon('pulse', 15)}Open Trenches</button><button type="button" class="wgx-btn" data-act="copy">${icon('save', 15)}Copy address</button></div>`
				: '';
		body.innerHTML =
			`<div class="wgx-price"><b>${fmtPrice(token.price_usd)}</b><span class="wgx-chg ${up ? 'up' : 'down'}">${fmtPct(token.price_change_24h)}</span></div>` +
			`<div class="wgx-chart ${up ? 'up' : 'down'}">${chart}</div>${facts}${actions}`;
		body.querySelector('[data-act="trade"]')?.addEventListener('click', () => api.launchId('trenches'));
		body.querySelector('[data-act="copy"]')?.addEventListener('click', async () => {
			try {
				await navigator.clipboard.writeText(THREE_MINT);
				api.toast('$THREE contract address copied');
			} catch {
				api.toast(THREE_MINT);
			}
		});
	};
	const a = bind(body, 'token', (d) => {
		token = d;
		paint();
	});
	const b = subscribe('history', (s) => {
		if (s.data) {
			candles = s.data.candles;
			paint();
		}
	});
	return () => {
		a();
		b();
	};
}

// ---------- weather ----------

function weatherArt(kind, size = 64) {
	const g = `wgx-w${++uid}`;
	const sun = `<circle cx="26" cy="26" r="11" fill="url(#${g}s)"/><g stroke="#ffc94a" stroke-width="2.6" stroke-linecap="round">${[0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<path transform="rotate(${a} 26 26)" d="M26 6.5v4"/>`).join('')}</g>`;
	const moon = `<path d="M34 11a15 15 0 1 0 12 21A12 12 0 0 1 34 11z" fill="url(#${g}m)"/>`;
	const cloud = (x = 0, y = 0, op = 1) => `<path transform="translate(${x} ${y})" opacity="${op}" d="M20 50h26a10 10 0 0 0 1-20 14 14 0 0 0-27-3A11 11 0 0 0 20 50z" fill="url(#${g}c)"/>`;
	const defs = `<defs><radialGradient id="${g}s"><stop offset="0" stop-color="#ffe680"/><stop offset="1" stop-color="#ffab2e"/></radialGradient><linearGradient id="${g}m" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff4c2"/><stop offset="1" stop-color="#cdb6ff"/></linearGradient><linearGradient id="${g}c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#c9d6ec"/></linearGradient></defs>`;
	const drops = `<g stroke="#5fb4ff" stroke-width="2.6" stroke-linecap="round"><path d="M22 54l-2 6M31 54l-2 6M40 54l-2 6"/></g>`;
	const flakes = `<g fill="#e8f3ff"><circle cx="22" cy="57" r="2.2"/><circle cx="31" cy="60" r="2.2"/><circle cx="40" cy="57" r="2.2"/></g>`;
	const bolt = `<path d="M33 48l-7 10h6l-3 8 9-12h-6l3-6z" fill="#ffd43b"/>`;
	const body = {
		sun,
		moon,
		partly: `${sun}${cloud(6, 6)}`,
		'partly-night': `<g transform="translate(-4 -4)">${moon}</g>${cloud(6, 6)}`,
		cloud: `${cloud(-6, -4, 0.55)}${cloud(4, 2)}`,
		fog: `${cloud(0, -6, 0.8)}<g stroke="#dfe7f3" stroke-width="2.6" stroke-linecap="round"><path d="M12 50h36M16 57h30"/></g>`,
		rain: `${cloud(0, -6)}${drops}`,
		snow: `${cloud(0, -6)}${flakes}`,
		storm: `${cloud(0, -8)}${bolt}`,
	}[kind] || cloud();
	return `<svg class="wgx-wart" width="${size}" height="${size}" viewBox="0 0 64 64" aria-hidden="true">${defs}${body}</svg>`;
}

function placePicker(body, onDone) {
	body.innerHTML =
		`<div class="wgx-place"><div class="wgx-place-head">${weatherArt('partly', 34)}<div><b>Choose a city</b><p>Live forecasts from Open-Meteo.</p></div></div>` +
		`<div class="wgx-place-row"><input type="search" placeholder="Search a city" aria-label="Search a city" autocomplete="off"></div>` +
		`<ul role="listbox" aria-label="Cities"></ul>` +
		`<button type="button" class="wgx-place-here">${icon('compass', 16)}<span>Use my location</span></button>` +
		`<small class="wgx-mute" aria-live="polite"></small></div>`;
	const input = body.querySelector('input');
	const list = body.querySelector('ul');
	const here = body.querySelector('.wgx-place-here');
	const note = body.querySelector('small');
	let t = 0;
	let seq = 0;
	input.addEventListener('input', () => {
		clearTimeout(t);
		t = setTimeout(async () => {
			const my = ++seq;
			try {
				const hits = await searchPlaces(input.value);
				if (my !== seq) return;
				note.textContent = input.value.trim().length > 1 && !hits.length ? 'No city by that name.' : '';
				here.hidden = hits.length > 0;
				body.firstChild.classList.toggle('has-hits', hits.length > 0);
				list.replaceChildren(
					...hits.map((p) => {
						const li = document.createElement('li');
						li.innerHTML = `<button type="button" role="option"><b>${esc(p.name)}</b><span>${esc(p.region)}</span></button>`;
						li.firstChild.addEventListener('click', () => {
							setPlace(p);
							onDone();
						});
						return li;
					}),
				);
			} catch (e) {
				note.textContent = e.message;
			}
		}, 250);
	});
	here.addEventListener('click', async () => {
		note.textContent = 'Finding you...';
		try {
			setPlace(await locate());
			onDone();
		} catch (e) {
			note.textContent = e.message;
		}
	});
	setTimeout(() => input.focus({ preventScroll: true }), 30);
}

function weather(body, w, api) {
	let picking = false;
	let last = null;
	const card = () => body.closest('.wgx');
	const paint = (d) => {
		last = d;
		if (picking) return;
		if (!d.place || !d.current) {
			card()?.removeAttribute('data-sky');
			return placePicker(body, () => (picking = false));
		}
		const c = d.current;
		const info = weatherInfo(c.weather_code, !!c.is_day);
		card()?.setAttribute('data-sky', `${info.icon}${c.is_day ? '' : ' night'}`);
		const deg = (v) => `${Math.round(v)}°`;
		const today = d.days[0];
		const hours =
			w.size === 's'
				? ''
				: `<ol class="wgx-hours">${d.hours
						.slice(0, w.size === 'l' ? 6 : 5)
						.map((h) => `<li><small>${new Date(h.t).toLocaleTimeString(LOCALE, { hour: 'numeric' })}</small>${w.size === 'l' ? weatherArt(weatherInfo(h.code, h.day).icon, 26) : ''}<b>${deg(h.temp)}</b></li>`)
						.join('')}</ol>`;
		const days =
			w.size === 'l'
				? `<ol class="wgx-days">${d.days
						.slice(1, 5)
						.map((x) => `<li><span>${new Date(`${x.date}T12:00`).toLocaleDateString(LOCALE, { weekday: 'short' })}</span>${weatherArt(weatherInfo(x.code).icon, 22)}<b>${deg(x.hi)}</b><small>${deg(x.lo)}</small></li>`)
						.join('')}</ol>`
				: '';
		body.innerHTML =
			`<div class="wgx-wx-top"><div><button type="button" class="wgx-place-btn" title="Change city">${esc(d.place.name)}${icon('chevron', 12)}</button>` +
			`<div class="wgx-temp">${deg(c.temperature_2m)}<sup>${esc(d.unit.replace('°', ''))}</sup></div>` +
			`<div class="wgx-wx-label">${esc(info.label)}${today ? ` <span>${deg(today.hi)} / ${deg(today.lo)}${w.size === 'm' ? ` · Feels ${deg(c.apparent_temperature)}` : ''}</span>` : ''}</div></div>${weatherArt(info.icon, w.size === 's' ? 46 : 64)}</div>` +
			(w.size !== 'l' ? '' : `<div class="wgx-wx-meta"><span>Feels ${deg(c.apparent_temperature)}</span><span>Humidity ${Math.round(c.relative_humidity_2m)}%</span><span>Wind ${Math.round(c.wind_speed_10m)} ${esc(d.wind)}</span></div>`) +
			hours +
			days;
		body.querySelector('.wgx-place-btn').addEventListener('click', (e) => {
			e.stopPropagation();
			picking = true;
			card()?.removeAttribute('data-sky');
			placePicker(body, () => {
				picking = false;
			});
			const back = document.createElement('button');
			back.type = 'button';
			back.className = 'wgx-btn ghost wgx-place-cancel';
			back.textContent = 'Cancel';
			back.addEventListener('click', () => {
				picking = false;
				paint(last);
			});
			body.querySelector('.wgx-place').append(back);
		});
	};
	void api;
	return bind(body, 'weather', paint, 4);
}

// ---------- clock ----------

function clock(body, w) {
	const ticks = Array.from({ length: 12 }, (_, i) => `<path transform="rotate(${i * 30} 50 50)" d="M50 ${i % 3 ? 9 : 7}v${i % 3 ? 4 : 7}" />`).join('');
	body.classList.add('wgx-clock', `sz-${w.size}`);
	body.innerHTML =
		`<svg class="wgx-face" viewBox="0 0 100 100" role="img"><circle cx="50" cy="50" r="46" class="rim"/><g class="ticks">${ticks}</g>` +
		`<path class="hh" d="M50 50V28"/><path class="mh" d="M50 50V16"/><path class="sh" d="M50 58V12"/><circle cx="50" cy="50" r="3" class="hub"/></svg>` +
		`<div class="wgx-clock-txt"><b></b><span></span><small></small></div>`;
	const svg = body.querySelector('svg');
	const [hh, mh, sh] = ['.hh', '.mh', '.sh'].map((s) => body.querySelector(s));
	const b = body.querySelector('b');
	const span = body.querySelector('span');
	const small = body.querySelector('small');
	small.textContent = Intl.DateTimeFormat().resolvedOptions().timeZone.replace(/_/g, ' ');
	let timer = 0;
	const tick = () => {
		const d = new Date();
		const s = d.getSeconds();
		const m = d.getMinutes() + s / 60;
		const h = (d.getHours() % 12) + m / 60;
		hh.setAttribute('transform', `rotate(${h * 30} 50 50)`);
		mh.setAttribute('transform', `rotate(${m * 6} 50 50)`);
		sh.setAttribute('transform', `rotate(${s * 6} 50 50)`);
		b.textContent = d.toLocaleTimeString(LOCALE, { hour: 'numeric', minute: '2-digit' });
		span.textContent = d.toLocaleDateString(LOCALE, { weekday: 'long', month: 'long', day: 'numeric' });
		svg.setAttribute('aria-label', `The time is ${b.textContent}`);
		timer = setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
	};
	tick();
	return () => clearTimeout(timer);
}

// ---------- calendar ----------

function calendar(body, w) {
	let view = new Date();
	const ws = weekStartFor(LOCALE);
	body.classList.add('wgx-cal');
	let timer = 0;
	const paint = () => {
		const today = new Date();
		if (w.size === 'm') {
			const cells = monthGrid(today, ws, today);
			const at = cells.findIndex((c) => c.today);
			const week = cells.slice(at - (at % 7), at - (at % 7) + 7);
			body.innerHTML =
				`<div class="wgx-cal-today"><b>${today.getDate()}</b><span>${today.toLocaleDateString(LOCALE, { weekday: 'long' })}<small>${today.toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' })}</small></span></div>` +
				`<ol class="wgx-cal-week">${week.map((c) => `<li class="${c.today ? 'today' : ''}${c.inMonth ? '' : ' mute'}"><small>${new Date(c.y, c.m, c.d).toLocaleDateString(LOCALE, { weekday: 'narrow' })}</small><b>${c.d}</b></li>`).join('')}</ol>`;
		} else {
			const cells = monthGrid(view, ws, today);
			const dow = cells.slice(0, 7).map((c) => `<i>${new Date(c.y, c.m, c.d).toLocaleDateString(LOCALE, { weekday: 'narrow' })}</i>`).join('');
			body.innerHTML =
				`<div class="wgx-cal-head"><b>${view.toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' })}</b><span>` +
				`<button type="button" class="wgx-btn icon" data-d="-1" aria-label="Previous month"><span style="display:inline-flex;transform:rotate(180deg)">${icon('chevron', 14)}</span></button>` +
				`<button type="button" class="wgx-btn icon" data-d="1" aria-label="Next month">${icon('chevron', 14)}</button></span></div>` +
				`<div class="wgx-cal-grid">${dow}${cells.map((c) => `<b class="${c.today ? 'today' : ''}${c.inMonth ? '' : ' mute'}">${c.d}</b>`).join('')}</div>`;
			body.querySelectorAll('[data-d]').forEach((btn) =>
				btn.addEventListener('click', (e) => {
					e.stopPropagation();
					view = new Date(view.getFullYear(), view.getMonth() + Number(btn.dataset.d), 1);
					paint();
				}),
			);
		}
	};
	paint();
	// Repaint just after midnight so "today" moves on its own.
	const arm = () => {
		const n = new Date();
		timer = setTimeout(() => {
			view = new Date();
			paint();
			arm();
		}, new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 0, 0, 5) - n);
	};
	arm();
	return () => clearTimeout(timer);
}

// ---------- agents ----------

function agents(body, w, api) {
	return bind(body, 'agents', (list) => {
		if (!list.length) {
			body.innerHTML = `<div class="wgx-empty"><span>No public agents yet.</span><button type="button" class="wgx-btn primary">Create one</button></div>`;
			body.querySelector('button').addEventListener('click', () => api.launchId('create'));
			return;
		}
		const n = w.size === 'l' ? 6 : 4;
		const items = list.slice(0, n);
		body.innerHTML =
			w.size === 'l'
				? `<ul class="wgx-list">${items.map((a, i) => `<li><button type="button" data-i="${i}">${thumb(a.avatar_thumbnail, a.name)}<span><b>${esc(a.name)}</b><small>${esc(a.description || 'A new three.ws agent')}</small></span><time>${relTime(a.created_at)}</time></button></li>`).join('')}</ul>`
				: `<ul class="wgx-faces">${items.map((a, i) => `<li><button type="button" data-i="${i}" title="${esc(a.name)}">${thumb(a.avatar_thumbnail, a.name, 'wgx-fav')}<span>${esc(a.name)}</span></button></li>`).join('')}</ul>`;
		body.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => api.launchId(`page:${items[b.dataset.i].home_url || `/agents/${items[b.dataset.i].id}`}`)));
	});
}

// ---------- pulse ----------

function pulse(body, w) {
	return bind(
		body,
		'pulse',
		(events) => {
			if (!events.length) {
				body.innerHTML = '<div class="wgx-empty"><span>No agent wallet moves yet. They appear here the moment one lands.</span></div>';
				return;
			}
			const items = events.slice(0, w.size === 'l' ? 5 : 2);
			body.innerHTML = `<ul class="wgx-list">${items
				.map(
					(e) =>
						`<li><a href="${esc(e.explorer || '#')}" target="_blank" rel="noopener noreferrer">${thumb(e.agent?.avatar_thumbnail_url, e.agent?.name)}<span><b>${esc(describeEvent(e))}</b><small>${esc(e.kind)}${e.usd ? ` · $${Number(e.usd).toFixed(2)}` : ''}</small></span><time>${relTime(e.ts)}</time></a></li>`,
				)
				.join('')}</ul>`;
		},
		4,
	);
}

// ---------- launches ----------

function launches(body, w, api) {
	return bind(
		body,
		'launches',
		(list) => {
			if (!list.length) {
				body.innerHTML = `<div class="wgx-empty"><span>No agent launches yet.</span><button type="button" class="wgx-btn primary">Open the Launchpad</button></div>`;
				body.querySelector('button').addEventListener('click', () => api.launchId('launcher'));
				return;
			}
			const items = list.slice(0, w.size === 'l' ? 5 : 2);
			body.innerHTML = `<ul class="wgx-list">${items
				.map(
					(l, i) =>
						`<li><button type="button" data-i="${i}">${thumb(l.agent?.avatar_thumbnail_url, l.name)}<span><b>${esc(l.name)} <em>$${esc(String(l.symbol || '').toUpperCase())}</em></b><small>by ${esc(l.agent?.name || 'an agent')}</small></span><time>${relTime(l.created_at)}</time></button></li>`,
				)
				.join('')}</ul>`;
			body.querySelectorAll('[data-i]').forEach((b) => {
				const l = items[b.dataset.i];
				b.addEventListener('click', () => api.launchId(`page:${l.agent?.url || '/launches'}`));
			});
		},
		4,
	);
}

// ---------- platform ----------

function platform(body, w) {
	return bind(body, 'stats', (s) => {
		const rows = [
			['Agents', s.agents?.value, 'cube'],
			['Coins launched', s.launches?.value, 'rocket'],
			['Live strategies', s.active_strategies?.value, 'pulse'],
		].filter((r) => Number.isFinite(r[1]));
		body.innerHTML = `<ul class="wgx-stats ${w.size === 's' ? 'tight' : ''}">${rows.map(([k, v, ic]) => `<li>${icon(ic, 16)}<b>${Number(v).toLocaleString(LOCALE)}</b><span>${k}</span></li>`).join('')}</ul>`;
	});
}

// ---------- news ----------

function news(body, w) {
	return bind(
		body,
		'news',
		(list) => {
			if (!list.length) {
				body.innerHTML = '<div class="wgx-empty"><span>The news desk has nothing new right now.</span></div>';
				return;
			}
			const items = list.slice(0, w.size === 'l' ? 4 : 2);
			const lead = items[0];
			body.innerHTML =
				(w.size === 'l' && lead.image
					? `<a class="wgx-lead" href="${esc(lead.link)}" target="_blank" rel="noopener noreferrer"><img src="${esc(lead.image)}" alt="" loading="lazy" referrerpolicy="no-referrer"><span><b>${esc(lead.title)}</b><small>${esc(lead.source)} · ${relTime(lead.pub_date)}</small></span></a>`
					: '') +
				`<ul class="wgx-news">${items
					.slice(w.size === 'l' && lead.image ? 1 : 0)
					.map((a) => `<li><a href="${esc(a.link)}" target="_blank" rel="noopener noreferrer"><b>${esc(a.title)}</b><small>${esc(a.source)} · ${relTime(a.pub_date)}</small></a></li>`)
					.join('')}</ul>`;
		},
		4,
	);
}

// ---------- system ----------

function system(body, w) {
	body.classList.add('wgx-sys');
	let battery = null;
	let storage = null;
	let timer = 0;
	const conn = navigator.connection;
	const paint = () => {
		const rows = [];
		if (battery) {
			const pct = Math.round(battery.level * 100);
			rows.push(['battery', 'Battery', `${pct}%${battery.charging ? ', charging' : ''}`, pct]);
		}
		rows.push(['wifi', 'Network', navigator.onLine ? `Online${conn?.effectiveType ? `, ${conn.effectiveType.toUpperCase()}` : ''}${conn?.downlink ? `, ${conn.downlink} Mb/s` : ''}` : 'Offline', null]);
		if (storage?.quota) rows.push(['save', 'Site storage', `${fmtBytes(storage.usage)} of ${fmtBytes(storage.quota)}`, Math.max(1, Math.round((storage.usage / storage.quota) * 100))]);
		const mem = navigator.deviceMemory;
		rows.push(['cpu', 'Processor', `${navigator.hardwareConcurrency || '?'} threads${mem ? `, ${mem} GB+ memory` : ''}`, null]);
		const shown = w.size === 's' ? rows.slice(0, 2) : rows;
		body.innerHTML = `<ul class="wgx-sysl">${shown.map(([ic, k, v, pct]) => `<li>${icon(ic, 16)}<span><small>${k}</small><b>${esc(v)}</b>${pct != null ? `<i class="wgx-meter"><s style="width:${pct}%"></s></i>` : ''}</span></li>`).join('')}</ul>`;
	};
	const onNet = () => paint();
	addEventListener('online', onNet);
	addEventListener('offline', onNet);
	conn?.addEventListener?.('change', onNet);
	navigator.getBattery?.().then((b) => {
		battery = b;
		['levelchange', 'chargingchange'].forEach((ev) => b.addEventListener(ev, paint));
		paint();
	}).catch(() => {});
	const est = () =>
		navigator.storage?.estimate?.().then((s) => {
			storage = s;
			paint();
		}).catch(() => {});
	est();
	timer = setInterval(est, 30_000);
	paint();
	return () => {
		clearInterval(timer);
		removeEventListener('online', onNet);
		removeEventListener('offline', onNet);
		conn?.removeEventListener?.('change', onNet);
		battery && ['levelchange', 'chargingchange'].forEach((ev) => battery.removeEventListener(ev, paint));
	};
}

// ---------- note ----------

function note(body, w, api) {
	body.classList.add('wgx-note');
	const ta = document.createElement('textarea');
	ta.placeholder = 'Write a note...';
	ta.setAttribute('aria-label', 'Sticky note');
	ta.maxLength = 4000;
	ta.value = w.data?.text || '';
	let t = 0;
	ta.addEventListener('input', () => {
		clearTimeout(t);
		t = setTimeout(() => api.save({ text: ta.value }), 300);
	});
	ta.addEventListener('pointerdown', (e) => e.stopPropagation());
	body.replaceChildren(ta);
	return () => {
		clearTimeout(t);
		if ((w.data?.text || '') !== ta.value) api.save({ text: ta.value });
	};
}

const RENDER = { three, weather, clock, calendar, agents, pulse, launches, platform, news, system, note };

export function renderWidget(body, w, api) {
	const fn = RENDER[w.type];
	if (!fn) return () => {};
	return fn(body, w, api) || (() => {});
}

export const WIDGET_ICONS = { three: 'gem', weather: 'cloud', clock: 'clock', calendar: 'grid', agents: 'cube', pulse: 'pulse', launches: 'rocket', platform: 'radar', news: 'list', system: 'cpu', note: 'note' };

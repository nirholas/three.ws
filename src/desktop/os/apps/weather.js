// Weather: live Open-Meteo forecast with saved cities, geolocation, a C/F toggle and animated SVG icons.
import './weather.css';
import { fetchWeather, searchCity, describeWeather, loadPlaces, savePlaces, placeId, selectPlace, currentPlace, loadUnit, saveUnit, placeLabel } from './weather-data.js';
import { compass, uvLabel } from './weather-codes.js';

const SUN = '<g class="wx-spin"><circle cx="32" cy="32" r="11" fill="#ffc533"/><g stroke="#ffc533" stroke-width="3" stroke-linecap="round"><path d="M32 8v7M32 49v7M8 32h7M49 32h7M15 15l5 5M44 44l5 5M49 15l-5 5M20 44l-5 5"/></g></g>';
const MOON = '<path class="wx-bob" d="M42 40a16 16 0 0 1-18-24 16 16 0 1 0 18 24z" fill="#d9e1f2"/><g fill="#fff" class="wx-twinkle"><circle cx="46" cy="16" r="1.6"/><circle cx="52" cy="26" r="1.2"/></g>';
const CLOUD = (fill = '#cfd8e6', y = 0) => `<g class="wx-drift"><path d="M20 ${46 + y}a9 9 0 0 1 1-18 12 12 0 0 1 23 3 8 8 0 0 1 0 15z" fill="${fill}"/></g>`;
const DROPS = (n, color = '#4aa3ff') => Array.from({ length: n }, (_, i) => `<path class="wx-drop" style="animation-delay:${i * 0.25}s" d="M${24 + i * 9} 50l-2 6" stroke="${color}" stroke-width="3" stroke-linecap="round"/>`).join('');
const FLAKES = [0, 1, 2].map((i) => `<circle class="wx-flake" style="animation-delay:${i * 0.5}s" cx="${25 + i * 10}" cy="52" r="2.4" fill="#fff"/>`).join('');
const ICONS = {
	clear: (night) => (night ? MOON : SUN),
	partly: (night) => `<g transform="translate(-8 -8) scale(.8)">${night ? MOON : SUN}</g>${CLOUD('#e4eaf4', 2)}`,
	cloud: () => `<g transform="translate(4 -6) scale(.8)">${CLOUD('#9fb0c7')}</g>${CLOUD('#d3dbe8', 4)}`,
	fog: () => `${CLOUD('#c1cad8', -4)}<g class="wx-drift" stroke="#c1cad8" stroke-width="3" stroke-linecap="round"><path d="M16 50h32M22 57h24"/></g>`,
	drizzle: () => `${CLOUD('#aab8cc', -4)}${DROPS(3, '#8cc4ff')}`,
	rain: () => `${CLOUD('#8294ad', -4)}${DROPS(4)}`,
	snow: () => `${CLOUD('#b9c5d6', -4)}${FLAKES}`,
	storm: () => `${CLOUD('#5f6f86', -4)}<path class="wx-bolt" d="M34 42l-8 12h7l-3 9 11-14h-7l4-7z" fill="#ffd23f"/>`,
};
export const iconSvg = (kind, night, size = 48) => `<svg class="wx-ico" viewBox="0 0 64 64" width="${size}" height="${size}" role="img" aria-hidden="true">${(ICONS[kind] || ICONS.cloud)(night)}</svg>`;

const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
const hourFmt = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric' });
const timeFmt = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export function mount(host, ctx) {
	const { h, esc } = ctx;
	host.classList.add('napp-weather');
	host.innerHTML = '';
	let unit = loadUnit();
	let places = loadPlaces();
	let place = currentPlace();
	let ac = null;
	let disposed = false;
	let searchAc = null;

	const root = h('div', 'wx');
	const bar = h('div', 'wx-bar');
	const body = h('div', 'wx-body');
	root.append(bar, body);
	host.append(root);

	// ---- top bar ----
	const placeSel = h('select', 'wx-sel');
	placeSel.setAttribute('aria-label', 'Saved city');
	placeSel.addEventListener('change', () => {
		if (placeSel.value === '__add') {
			placeSel.value = place ? placeId(place) : '';
			return showSearch();
		}
		const p = places.find((x) => placeId(x) === placeSel.value);
		if (p) choose(p);
	});
	const addBtn = h('button', 'wx-btn', '+ Add city');
	addBtn.type = 'button';
	addBtn.addEventListener('click', () => showSearch());
	const rmBtn = h('button', 'wx-btn', 'Remove');
	rmBtn.type = 'button';
	rmBtn.title = 'Remove this city from your saved list';
	rmBtn.addEventListener('click', () => {
		if (!place) return;
		places = places.filter((p) => placeId(p) !== placeId(place));
		savePlaces(places);
		place = places[0] || null;
		selectPlace(place);
		syncBar();
		place ? load() : showWelcome();
	});
	const reload = h('button', 'wx-btn', 'Refresh');
	reload.type = 'button';
	reload.addEventListener('click', () => place && load());
	const seg = h('div', 'wx-seg');
	seg.setAttribute('role', 'group');
	seg.setAttribute('aria-label', 'Temperature unit');
	const segBtns = ['C', 'F'].map((u) => {
		const b = h('button', '', `°${u}`);
		b.type = 'button';
		b.setAttribute('aria-label', u === 'C' ? 'Celsius' : 'Fahrenheit');
		b.addEventListener('click', () => {
			if (unit === u) return;
			unit = u;
			saveUnit(u);
			syncBar();
			if (place) load();
		});
		return b;
	});
	seg.append(...segBtns);
	bar.append(placeSel, addBtn, rmBtn, h('span', 'wx-grow'), reload, seg);
	function syncBar() {
		placeSel.replaceChildren();
		for (const p of places) {
			const o = h('option', '', esc(placeLabel(p)));
			o.value = placeId(p);
			placeSel.append(o);
		}
		const add = h('option', '', 'Add a city...');
		add.value = '__add';
		placeSel.append(add);
		if (place) placeSel.value = placeId(place);
		const has = !!place && places.some((p) => placeId(p) === placeId(place));
		placeSel.hidden = !places.length;
		rmBtn.hidden = !has;
		reload.hidden = !place;
		segBtns.forEach((b, i) => {
			const on = ['C', 'F'][i] === unit;
			b.classList.toggle('on', on);
			b.setAttribute('aria-pressed', String(on));
		});
	}

	function choose(p) {
		place = p;
		if (!places.some((x) => placeId(x) === placeId(p))) {
			places = [...places, p];
			savePlaces(places);
		}
		selectPlace(p);
		syncBar();
		load();
	}

	// ---- states ----
	function showSkeleton() {
		body.innerHTML = `<div class="wx-skel" aria-busy="true" aria-label="Loading forecast"><div class="sk a"></div><div class="sk b"></div><div class="sk c"></div><div class="sk d"></div></div>`;
	}
	function showError(err) {
		const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
		body.innerHTML = `<div class="wx-state" role="alert">${iconSvg('cloud', false, 72)}<h2>${offline ? 'You are offline' : 'Weather is unavailable right now'}</h2><p>${offline ? 'Check your connection and try again. Cities you have already viewed are shown from your last update once they have loaded at least once.' : 'The forecast service did not respond. Your saved cities are safe.'}</p><p class="wx-detail">${esc(err?.message || '')}</p></div>`;
		const retry = h('button', 'wx-primary', 'Try again');
		retry.type = 'button';
		retry.addEventListener('click', () => (place ? load() : showWelcome()));
		body.querySelector('.wx-state').append(retry);
		retry.focus();
	}
	function showWelcome() {
		body.innerHTML = `<div class="wx-state">${iconSvg('partly', false, 88)}<h2>See the weather where you are</h2><p>Allow location access for a local forecast, or search for any city. Your location stays in this browser and is only sent to the forecast service as coordinates.</p><div class="wx-actions"></div></div>`;
		const acts = body.querySelector('.wx-actions');
		if (navigator.geolocation) {
			const loc = h('button', 'wx-primary', 'Use my location');
			loc.type = 'button';
			loc.addEventListener('click', locate);
			acts.append(loc);
		}
		const find = h('button', 'wx-secondary', 'Search for a city');
		find.type = 'button';
		find.addEventListener('click', () => showSearch());
		acts.append(find);
		acts.firstElementChild.focus();
	}
	function locate() {
		body.innerHTML = `<div class="wx-state"><div class="wx-spin-ring"></div><h2>Finding you...</h2><p>Choose Allow in your browser prompt.</p></div>`;
		navigator.geolocation.getCurrentPosition(
			(pos) => {
				if (disposed) return;
				const lat = Math.round(pos.coords.latitude * 100) / 100;
				const lon = Math.round(pos.coords.longitude * 100) / 100;
				choose({ name: 'My location', admin1: '', country: '', lat, lon, tz: '' });
			},
			(err) => {
				if (disposed) return;
				showSearch(err.code === 1 ? 'Location access was declined, so search for a city instead.' : 'Your location could not be determined. Search for a city instead.');
			},
			{ timeout: 12000, maximumAge: 600000 },
		);
	}
	function showSearch(note = '') {
		body.innerHTML = `<div class="wx-search"><h2>Add a city</h2>${note ? `<p class="wx-note">${esc(note)}</p>` : ''}<form class="wx-form" role="search"><input class="wx-in" type="search" placeholder="Search a city, e.g. Lisbon" aria-label="City name" autocomplete="off" maxlength="80"><button class="wx-primary" type="submit">Search</button></form><ul class="wx-results" aria-live="polite"></ul></div>`;
		const form = body.querySelector('form');
		const input = body.querySelector('input');
		const list = body.querySelector('.wx-results');
		input.focus();
		let timer = 0;
		const run = async () => {
			const q = input.value.trim();
			searchAc?.abort();
			if (q.length < 2) {
				list.innerHTML = '';
				return;
			}
			searchAc = new AbortController();
			list.innerHTML = '<li class="wx-hint">Searching...</li>';
			try {
				const res = await searchCity(q, { signal: searchAc.signal });
				if (!res.length) {
					list.innerHTML = `<li class="wx-hint">No city matches "${esc(q)}". Check the spelling or try a larger nearby city.</li>`;
					return;
				}
				list.replaceChildren(
					...res.map((r) => {
						const li = h('li');
						const b = h('button', 'wx-result', `<b>${esc(r.name)}</b><span>${esc([r.admin1, r.country].filter(Boolean).join(', '))}</span>`);
						b.type = 'button';
						b.addEventListener('click', () => choose(r));
						li.append(b);
						return li;
					}),
				);
			} catch (err) {
				if (err.name === 'AbortError') return;
				list.innerHTML = `<li class="wx-hint err">Search failed: ${esc(err.message)}. Check your connection and try again.</li>`;
			}
		};
		input.addEventListener('input', () => {
			clearTimeout(timer);
			timer = setTimeout(run, 280);
		});
		form.addEventListener('submit', (e) => {
			e.preventDefault();
			clearTimeout(timer);
			run();
		});
		if (place) {
			const back = h('button', 'wx-secondary', 'Back to forecast');
			back.type = 'button';
			back.addEventListener('click', () => load());
			body.querySelector('.wx-search').append(back);
		}
	}

	// ---- forecast ----
	async function load() {
		if (!place) return showWelcome();
		ac?.abort();
		ac = new AbortController();
		const mine = ac;
		const p = place;
		showSkeleton();
		ctx.setTitle(`${p.name} - Weather`);
		try {
			const d = await fetchWeather(p.lat, p.lon, unit, { signal: mine.signal });
			if (disposed || mine.signal.aborted) return;
			render(p, d);
		} catch (err) {
			if (err.name === 'AbortError' || disposed) return;
			showError(err);
		}
	}
	const tempOf = (v) => `${Math.round(v)}°`;
	function render(p, d) {
		const c = d.current;
		const w = describeWeather(c.code, c.isDay);
		const today = d.daily[0];
		const nowIdx = Math.max(0, d.hourly.findIndex((x) => x.time >= c.time.slice(0, 13)));
		const hours = d.hourly.slice(nowIdx, nowIdx + 24);
		const wind = d.units.wind;
		const rangeLo = Math.min(...d.daily.map((x) => x.min));
		const rangeHi = Math.max(...d.daily.map((x) => x.max));
		const span = Math.max(1, rangeHi - rangeLo);
		body.innerHTML = `
		<div class="wx-hero ${w.kind}${w.night ? ' night' : ''}">
			<div class="wx-hero-main">
				<div class="wx-place">${esc(placeLabel(p))}</div>
				<div class="wx-temp">${tempOf(c.temp)}<small>${unit}</small></div>
				<div class="wx-cond">${esc(w.label)}</div>
				<div class="wx-hl">H ${tempOf(today.max)} &nbsp; L ${tempOf(today.min)} &nbsp; Feels like ${tempOf(c.feels)}</div>
			</div>
			${iconSvg(w.kind, w.night, 120)}
		</div>
		${d.stale ? `<div class="wx-stale" role="status">You are offline. Showing the forecast from ${esc(new Date(d.fetchedAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' }))}.</div>` : `<div class="wx-updated">Updated ${esc(new Date(d.fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))}</div>`}
		<section aria-label="Hourly forecast"><h3>Next 24 hours</h3><div class="wx-hours" tabindex="0">${hours
			.map((x, i) => {
				const hw = describeWeather(x.code, x.isDay);
				return `<div class="wx-hour"><span>${i === 0 ? 'Now' : esc(hourFmt(x.time))}</span>${iconSvg(hw.kind, hw.night, 30)}<b>${tempOf(x.temp)}</b><em>${x.rain > 0 ? `${Math.round(x.rain)}%` : ''}</em></div>`;
			})
			.join('')}</div></section>
		<section aria-label="Seven day forecast"><h3>7-day forecast</h3><ul class="wx-days">${d.daily
			.map((x, i) => {
				const dw = describeWeather(x.code, true);
				const l = ((x.min - rangeLo) / span) * 100;
				const wd = Math.max(6, ((x.max - x.min) / span) * 100);
				return `<li><span class="day">${i === 0 ? 'Today' : esc(WEEKDAY.format(new Date(`${x.date}T12:00`)))}</span>${iconSvg(dw.kind, false, 28)}<span class="rain">${x.rain > 0 ? `${Math.round(x.rain)}%` : ''}</span><span class="lo">${tempOf(x.min)}</span><span class="bar"><i style="left:${l}%;width:${wd}%"></i></span><span class="hi">${tempOf(x.max)}</span></li>`;
			})
			.join('')}</ul></section>
		<section aria-label="Details"><h3>Details</h3><div class="wx-grid">
			<div class="wx-tile"><span>Wind</span><b>${Math.round(c.wind)} ${esc(wind)}</b><em>${esc(compass(c.windDir))}</em></div>
			<div class="wx-tile"><span>Humidity</span><b>${Math.round(c.humidity)}%</b><em>&nbsp;</em></div>
			<div class="wx-tile"><span>UV index</span><b>${Math.round(today.uv)}</b><em>${esc(uvLabel(today.uv))}</em></div>
			<div class="wx-tile"><span>Rain chance</span><b>${Math.round(today.rain)}%</b><em>${c.precip > 0 ? `${c.precip} mm now` : 'None now'}</em></div>
			<div class="wx-tile"><span>Sunrise</span><b>${esc(timeFmt(today.sunrise))}</b><em>&nbsp;</em></div>
			<div class="wx-tile"><span>Sunset</span><b>${esc(timeFmt(today.sunset))}</b><em>&nbsp;</em></div>
			<div class="wx-tile"><span>Pressure</span><b>${Math.round(c.pressure)} hPa</b><em>&nbsp;</em></div>
		</div></section>
		<p class="wx-credit">Data by Open-Meteo.com</p>`;
	}

	// ---- start ----
	syncBar();
	if (place) load();
	else showWelcome();

	return () => {
		disposed = true;
		ac?.abort();
		searchAc?.abort();
	};
}

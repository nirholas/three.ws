// Live sources for the widgets. Each feed is fetched once and shared by every
// widget that reads it (desktop and board alike), polled on its own cadence
// while anyone subscribes, paused while the tab is hidden, and refreshed the
// moment it comes back. A failed fetch keeps the last good data and reports
// the error, so a widget can show stale numbers with a note or an offline
// state with a retry. Nothing here invents a value.

import { tzCity, usesFahrenheit } from './logic.js';

export const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const PLACE_KEY = 'tws-widgets:place';

async function getJson(url, init) {
	const r = await fetch(url, { credentials: 'same-origin', headers: { accept: 'application/json' }, ...init });
	if (!r.ok) throw new Error(`${r.status === 429 ? 'Rate limited' : 'Unavailable'} (${r.status})`);
	return r.json();
}

// ---------- place (for weather) ----------

function readPlace() {
	try {
		const p = JSON.parse(localStorage.getItem(PLACE_KEY) || 'null');
		if (p && Number.isFinite(p.lat) && Number.isFinite(p.lon) && typeof p.name === 'string') return p;
	} catch {
		/* storage blocked or corrupt */
	}
	return null;
}

export function setPlace(place) {
	try {
		localStorage.setItem(PLACE_KEY, JSON.stringify(place));
	} catch {
		/* storage blocked: the place still applies for this visit */
	}
	memoPlace = place;
	refresh('weather');
}
let memoPlace = null;

/** Open-Meteo geocoding: city search for the weather widget. */
export async function searchPlaces(q) {
	const name = String(q || '').trim();
	if (name.length < 2) return [];
	const j = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=6&language=${encodeURIComponent((navigator.language || 'en').slice(0, 2))}&format=json`, { credentials: 'omit' });
	return (j.results || []).map((r) => ({ name: r.name, region: [r.admin1, r.country].filter(Boolean).join(', '), lat: r.latitude, lon: r.longitude }));
}

/** Ask the browser for the device position (prompts the visitor). */
export function locate() {
	return new Promise((resolve, reject) => {
		if (!navigator.geolocation) return reject(new Error('This browser cannot share a location.'));
		navigator.geolocation.getCurrentPosition(
			(p) => resolve({ name: 'Your location', region: '', lat: +p.coords.latitude.toFixed(3), lon: +p.coords.longitude.toFixed(3), device: true }),
			(e) => reject(new Error(e.code === 1 ? 'Location permission was denied.' : 'Your location is unavailable right now.')),
			{ timeout: 10000, maximumAge: 30 * 60 * 1000 },
		);
	});
}

/**
 * The weather place: the one the visitor chose, else the city named by their
 * time zone (geocoded, never guessed coordinates). Null when neither exists,
 * which the widget shows as "Choose a city".
 */
async function resolvePlace() {
	memoPlace ||= readPlace();
	if (memoPlace) return memoPlace;
	const city = tzCity(Intl.DateTimeFormat().resolvedOptions().timeZone);
	if (!city) return null;
	const [hit] = await searchPlaces(city);
	if (hit) memoPlace = { ...hit, fromZone: true };
	return memoPlace;
}

async function loadWeather() {
	const place = await resolvePlace();
	if (!place) return { place: null };
	const q = new URLSearchParams({
		latitude: String(place.lat),
		longitude: String(place.lon),
		current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,is_day,wind_speed_10m',
		hourly: 'temperature_2m,weather_code,is_day',
		daily: 'temperature_2m_max,temperature_2m_min,weather_code',
		forecast_days: '5',
		timezone: 'auto',
	});
	if (usesFahrenheit(navigator.language)) {
		q.set('temperature_unit', 'fahrenheit');
		q.set('wind_speed_unit', 'mph');
	}
	const j = await getJson(`https://api.open-meteo.com/v1/forecast?${q}`, { credentials: 'omit' });
	const now = Date.now();
	const hours = (j.hourly?.time || [])
		.map((t, i) => ({ t: Date.parse(`${t}${offsetSuffix(j.utc_offset_seconds)}`), temp: j.hourly.temperature_2m[i], code: j.hourly.weather_code[i], day: !!j.hourly.is_day[i] }))
		.filter((x) => x.t >= now - 3600_000)
		.slice(0, 6);
	const days = (j.daily?.time || []).map((t, i) => ({ date: t, hi: j.daily.temperature_2m_max[i], lo: j.daily.temperature_2m_min[i], code: j.daily.weather_code[i] }));
	return { place, current: j.current, hours, days, unit: j.current_units?.temperature_2m || '°C', wind: j.current_units?.wind_speed_10m || 'km/h' };
}
const offsetSuffix = (s) => {
	const n = Number(s) || 0;
	const sign = n < 0 ? '-' : '+';
	const a = Math.abs(n);
	return `${sign}${String(Math.floor(a / 3600)).padStart(2, '0')}:${String(Math.floor((a % 3600) / 60)).padStart(2, '0')}`;
};

// ---------- the feeds ----------

const SOURCES = {
	token: { ttl: 60_000, load: () => getJson('/api/three-token/stats').then((j) => j.token) },
	history: {
		ttl: 300_000,
		load: () => {
			const to = Math.floor(Date.now() / 1000);
			return getJson(`/api/pump/price-history?mint=${THREE_MINT}&interval=15m&from=${to - 86400}&to=${to}`).then((j) => ({ candles: j.data || [], stale: !!j.stale }));
		},
	},
	stats: { ttl: 60_000, load: () => getJson('/api/stats').then((j) => j.stats) },
	agents: { ttl: 120_000, load: () => getJson('/api/agents/public?sort=newest&limit=12').then((j) => j.agents || []) },
	pulse: { ttl: 15_000, load: () => getJson('/api/pulse?limit=12').then((j) => j.data?.events || []) },
	launches: { ttl: 120_000, load: () => getJson('/api/pump/launches?limit=8').then((j) => j.data?.launches || []) },
	news: { ttl: 300_000, load: () => getJson('/api/news/feed?limit=12&featured=1').then((j) => j.articles || []) },
	weather: { ttl: 15 * 60_000, load: loadWeather },
};

const state = new Map();
const entry = (key) => {
	let e = state.get(key);
	if (!e) {
		e = { data: undefined, error: null, at: 0, loading: false, subs: new Set(), timer: 0 };
		state.set(key, e);
	}
	return e;
};
const emit = (e) => e.subs.forEach((fn) => fn({ data: e.data, error: e.error, at: e.at, loading: e.loading }));

async function load(key) {
	const src = SOURCES[key];
	const e = entry(key);
	if (!src || e.loading) return;
	e.loading = true;
	emit(e);
	try {
		e.data = await src.load();
		e.error = null;
		e.at = Date.now();
	} catch (err) {
		e.error = err?.message || 'Unavailable';
	} finally {
		e.loading = false;
		emit(e);
		schedule(key);
	}
}

function schedule(key) {
	const e = entry(key);
	clearTimeout(e.timer);
	if (!e.subs.size || document.hidden) return;
	// A failing source backs off to twice its cadence so an outage is not hammered.
	const wait = SOURCES[key].ttl * (e.error ? 2 : 1);
	e.timer = setTimeout(() => load(key), wait);
}

/** Refetch now (the Retry button, a changed place). */
export function refresh(key) {
	return load(key);
}

/**
 * Subscribe to a feed. `fn` gets { data, error, at, loading } now and on every
 * change. Returns the unsubscribe function.
 */
export function subscribe(key, fn) {
	if (!SOURCES[key]) throw new Error(`Unknown widget feed: ${key}`);
	const e = entry(key);
	e.subs.add(fn);
	fn({ data: e.data, error: e.error, at: e.at, loading: e.loading });
	if (!e.at || Date.now() - e.at > SOURCES[key].ttl) load(key);
	else schedule(key);
	return () => {
		e.subs.delete(fn);
		if (!e.subs.size) clearTimeout(e.timer);
	};
}

document.addEventListener('visibilitychange', () => {
	if (document.hidden) return state.forEach((e) => clearTimeout(e.timer));
	for (const [key, e] of state) {
		if (!e.subs.size) continue;
		if (Date.now() - e.at > SOURCES[key].ttl) load(key);
		else schedule(key);
	}
});

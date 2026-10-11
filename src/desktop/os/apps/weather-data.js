// Open-Meteo data layer (no API key). Shared by the Weather app and the shell's Widgets board.
//   fetchWeather(lat, lon, unit)  -> normalised forecast, falling back to the last cached response offline
//   searchCity(query)             -> geocoding results
//   describeWeather(code, isDay)  -> { label, kind, night }
//   loadPlaces and savePlaces     -> saved cities in localStorage
//   currentPlace()                -> the selected saved city, or null

import { describe } from './weather-codes.js';

export { describe as describeWeather };

const PLACES_KEY = 'tws:weather:places';
const SELECTED_KEY = 'tws:weather:selected';
const CACHE_PREFIX = 'tws:weather:cache:';

const ls = {
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
			/* storage unavailable or full: the cache is a convenience */
		}
	},
};

export function loadPlaces() {
	try {
		const v = JSON.parse(ls.get(PLACES_KEY) || '[]');
		return Array.isArray(v) ? v.filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon)) : [];
	} catch {
		return [];
	}
}

export function savePlaces(places) {
	ls.set(PLACES_KEY, JSON.stringify(places));
}

export const placeId = (p) => `${p.lat.toFixed(2)},${p.lon.toFixed(2)}`;

export function selectPlace(p) {
	ls.set(SELECTED_KEY, p ? placeId(p) : '');
}

export function currentPlace() {
	const places = loadPlaces();
	if (!places.length) return null;
	const id = ls.get(SELECTED_KEY);
	return places.find((p) => placeId(p) === id) || places[0];
}

export function loadUnit() {
	return ls.get('tws:weather:unit') === 'F' ? 'F' : 'C';
}
export function saveUnit(u) {
	ls.set('tws:weather:unit', u === 'F' ? 'F' : 'C');
}

/** Geocoding search. Returns [{ name, admin1, country, lat, lon, tz }]. Throws on network failure. */
export async function searchCity(query, { signal } = {}) {
	const q = String(query).trim();
	if (q.length < 2) return [];
	const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=8&language=en&format=json`;
	const r = await fetch(url, { signal });
	if (!r.ok) throw new Error(`Search failed (HTTP ${r.status})`);
	const j = await r.json();
	return (j.results || []).map((x) => ({ name: x.name, admin1: x.admin1 || '', country: x.country || '', lat: x.latitude, lon: x.longitude, tz: x.timezone || '' }));
}

const cacheKey = (lat, lon, unit) => `${CACHE_PREFIX}${lat.toFixed(2)},${lon.toFixed(2)},${unit}`;

export function cachedWeather(lat, lon, unit) {
	try {
		const raw = ls.get(cacheKey(lat, lon, unit));
		return raw ? JSON.parse(raw) : null;
	} catch {
		return null;
	}
}

/**
 * Forecast for a point. `unit` is 'C' (km/h) or 'F' (mph). On network failure resolves with the last
 * cached response marked `{ stale: true }` when one exists, otherwise throws.
 */
export async function fetchWeather(lat, lon, unit = 'C', { signal } = {}) {
	const f = unit === 'F';
	const q = new URLSearchParams({
		latitude: String(lat),
		longitude: String(lon),
		current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m,wind_direction_10m,surface_pressure',
		hourly: 'temperature_2m,precipitation_probability,weather_code,is_day',
		daily: 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,uv_index_max,precipitation_probability_max,wind_speed_10m_max',
		timezone: 'auto',
		forecast_days: '7',
		temperature_unit: f ? 'fahrenheit' : 'celsius',
		wind_speed_unit: f ? 'mph' : 'kmh',
	});
	try {
		const r = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`, { signal });
		if (!r.ok) throw new Error(`Forecast failed (HTTP ${r.status})`);
		const data = normalise(await r.json(), unit);
		ls.set(cacheKey(lat, lon, unit), JSON.stringify(data));
		return data;
	} catch (err) {
		if (err?.name === 'AbortError') throw err;
		const hit = cachedWeather(lat, lon, unit);
		if (hit) return { ...hit, stale: true };
		throw err;
	}
}

/** Shape the raw API response into rows the UI can render directly. */
export function normalise(j, unit) {
	const c = j.current || {};
	const d = j.daily || {};
	const hh = j.hourly || {};
	const daily = (d.time || []).map((date, i) => ({
		date,
		code: d.weather_code[i],
		max: d.temperature_2m_max[i],
		min: d.temperature_2m_min[i],
		sunrise: d.sunrise[i],
		sunset: d.sunset[i],
		uv: d.uv_index_max[i],
		rain: d.precipitation_probability_max[i],
		wind: d.wind_speed_10m_max[i],
	}));
	// Hourly rows from the current hour onward, 24 of them.
	const curHour = (c.time || '').slice(0, 13);
	let start = (hh.time || []).findIndex((t) => t.slice(0, 13) >= curHour);
	if (start < 0) start = 0;
	const hourly = (hh.time || []).slice(start, start + 24).map((time, k) => ({
		time,
		temp: hh.temperature_2m[start + k],
		rain: hh.precipitation_probability[start + k],
		code: hh.weather_code[start + k],
		isDay: !!hh.is_day[start + k],
	}));
	return {
		unit,
		fetchedAt: Date.now(),
		tz: j.timezone,
		current: {
			time: c.time,
			temp: c.temperature_2m,
			feels: c.apparent_temperature,
			humidity: c.relative_humidity_2m,
			code: c.weather_code,
			isDay: !!c.is_day,
			precip: c.precipitation,
			wind: c.wind_speed_10m,
			windDir: c.wind_direction_10m,
			pressure: c.surface_pressure,
		},
		hourly,
		daily,
		units: { wind: unit === 'F' ? 'mph' : 'km/h', precip: 'mm' },
	};
}

export const placeLabel = (p) => [p.name, p.admin1 && p.admin1 !== p.name ? p.admin1 : '', p.country].filter(Boolean).slice(0, 2).join(', ');

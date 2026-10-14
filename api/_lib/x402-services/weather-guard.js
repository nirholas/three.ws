// Live weather + go/no-go activity verdicts over two keyless public sources:
// Open-Meteo (global, primary) and the US National Weather Service (fallback
// when Open-Meteo is unreachable, and the only source for active alerts).
// No API key, no fixture mode: every call hits the real upstream.
//
// Both upstreams are free and ask only for a polite, identifiable User-Agent
// (NWS actively 403s a request that omits one): see THREE_WS_UA below.

const THREE_WS_UA = 'three.ws/1.0 (+https://three.ws; support@three.ws)';
const TIMEOUT_MS = 10_000;

// WMO weather codes (shared by Open-Meteo's `current_weather`/`hourly.weathercode`).
// https://open-meteo.com/en/docs: "WMO Weather interpretation codes"
const WMO_CODES = {
	0: 'clear sky', 1: 'mainly clear', 2: 'partly cloudy', 3: 'overcast',
	45: 'fog', 48: 'depositing rime fog',
	51: 'light drizzle', 53: 'moderate drizzle', 55: 'dense drizzle',
	56: 'light freezing drizzle', 57: 'dense freezing drizzle',
	61: 'slight rain', 63: 'moderate rain', 65: 'heavy rain',
	66: 'light freezing rain', 67: 'heavy freezing rain',
	71: 'slight snow', 73: 'moderate snow', 75: 'heavy snow', 77: 'snow grains',
	80: 'slight rain showers', 81: 'moderate rain showers', 82: 'violent rain showers',
	85: 'slight snow showers', 86: 'heavy snow showers',
	95: 'thunderstorm', 96: 'thunderstorm with slight hail', 99: 'thunderstorm with heavy hail',
};

// Per-activity thresholds a verdict is checked against. Each threshold is the
// upper bound the activity still tolerates; crossing any one drops the
// verdict a notch (go -> caution -> no-go).
const ACTIVITY_PROFILES = {
	running: { maxWindKph: 35, maxPrecipProb: 60, badCodes: new Set([65, 67, 75, 82, 86, 95, 96, 99]) },
	cycling: { maxWindKph: 25, maxPrecipProb: 40, badCodes: new Set([61, 63, 65, 66, 67, 71, 73, 75, 80, 81, 82, 85, 86, 95, 96, 99]) },
	'outdoor-event': { maxWindKph: 30, maxPrecipProb: 30, badCodes: new Set([61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99]) },
	'drone-flight': { maxWindKph: 20, maxPrecipProb: 20, badCodes: new Set([45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99]) },
	photography: { maxWindKph: 40, maxPrecipProb: 50, badCodes: new Set([65, 67, 75, 95, 96, 99]) },
};

function upstreamError(message, status, code, cause) {
	const err = new Error(message);
	err.status = status;
	err.code = code;
	if (cause) err.cause = cause;
	return err;
}

async function fetchJson(url, { timeoutMs = TIMEOUT_MS } = {}) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(url, {
			headers: { accept: 'application/json', 'user-agent': THREE_WS_UA },
			signal: controller.signal,
		});
		const text = await res.text();
		let data;
		try {
			data = text ? JSON.parse(text) : null;
		} catch {
			data = null;
		}
		if (!res.ok) {
			throw upstreamError(
				`upstream returned ${res.status}`,
				res.status >= 500 ? 502 : res.status,
				res.status === 429 ? 'upstream_rate_limited' : 'upstream_error',
			);
		}
		return data;
	} catch (err) {
		clearTimeout(timer);
		if (err?.status) throw err;
		throw upstreamError('upstream is unreachable', 504, 'upstream_unreachable', err);
	} finally {
		clearTimeout(timer);
	}
}

function validateCoords(lat, lon) {
	const latNum = Number(lat);
	const lonNum = Number(lon);
	if (!Number.isFinite(latNum) || latNum < -90 || latNum > 90) {
		throw upstreamError('lat must be a number between -90 and 90', 400, 'bad_request');
	}
	if (!Number.isFinite(lonNum) || lonNum < -180 || lonNum > 180) {
		throw upstreamError('lon must be a number between -180 and 180', 400, 'bad_request');
	}
	return { lat: latNum, lon: lonNum };
}

function isInContinentalUsRoughly(lat, lon) {
	// NWS only covers the US + territories. A rough bounding check avoids
	// burning the fallback path on an upstream that would 404 anyway.
	return lat >= 18 && lat <= 72 && lon >= -180 && lon <= -65;
}

async function fromOpenMeteo(lat, lon) {
	const url = new URL('https://api.open-meteo.com/v1/forecast');
	url.searchParams.set('latitude', String(lat));
	url.searchParams.set('longitude', String(lon));
	url.searchParams.set('current_weather', 'true');
	url.searchParams.set('hourly', 'temperature_2m,precipitation_probability,windspeed_10m,weathercode');
	url.searchParams.set('forecast_days', '2');
	url.searchParams.set('timezone', 'auto');
	const data = await fetchJson(url);
	const hourly = data?.hourly;
	if (!hourly?.time) throw upstreamError('open-meteo returned no hourly series', 502, 'upstream_error');
	const nowIso = new Date().toISOString().slice(0, 13);
	const startIdx = Math.max(0, hourly.time.findIndex((t) => t.startsWith(nowIso)));
	const slice = (arr) => arr.slice(startIdx, startIdx + 24);
	return {
		source: 'open-meteo',
		timezone: data.timezone,
		current: {
			tempC: data.current_weather?.temperature ?? null,
			windKph: data.current_weather?.windspeed != null ? data.current_weather.windspeed : null,
			weatherCode: data.current_weather?.weathercode ?? null,
			conditions: WMO_CODES[data.current_weather?.weathercode] || 'unknown',
		},
		hourly: slice(hourly.time).map((t, i) => ({
			time: t,
			tempC: slice(hourly.temperature_2m)[i] ?? null,
			precipProbPct: slice(hourly.precipitation_probability)[i] ?? null,
			windKph: slice(hourly.windspeed_10m)[i] ?? null,
			weatherCode: slice(hourly.weathercode)[i] ?? null,
			conditions: WMO_CODES[slice(hourly.weathercode)[i]] || 'unknown',
		})),
	};
}

// NWS fallback: only reachable (and only useful) for US coordinates. Two hops
// are required by the API itself: /points resolves the forecast office +
// gridpoint, then that URL serves the actual forecast periods.
async function fromNws(lat, lon) {
	if (!isInContinentalUsRoughly(lat, lon)) {
		throw upstreamError('NWS has no coverage outside the US', 502, 'upstream_error');
	}
	const point = await fetchJson(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`);
	const forecastUrl = point?.properties?.forecastHourly;
	if (!forecastUrl) throw upstreamError('NWS returned no forecast grid for this point', 502, 'upstream_error');
	const forecast = await fetchJson(forecastUrl);
	const periods = Array.isArray(forecast?.properties?.periods) ? forecast.properties.periods : [];
	return {
		source: 'nws',
		timezone: point?.properties?.timeZone || null,
		current: periods[0]
			? {
				tempC: typeof periods[0].temperature === 'number'
					? (periods[0].temperatureUnit === 'F' ? (periods[0].temperature - 32) / 1.8 : periods[0].temperature)
					: null,
				windKph: periods[0].windSpeed ? parseFloat(periods[0].windSpeed) * 1.60934 : null,
				weatherCode: null,
				conditions: periods[0].shortForecast || 'unknown',
			}
			: null,
		hourly: periods.slice(0, 24).map((p) => ({
			time: p.startTime,
			tempC: typeof p.temperature === 'number'
				? (p.temperatureUnit === 'F' ? (p.temperature - 32) / 1.8 : p.temperature)
				: null,
			precipProbPct: p.probabilityOfPrecipitation?.value ?? null,
			windKph: p.windSpeed ? parseFloat(p.windSpeed) * 1.60934 : null,
			weatherCode: null,
			conditions: p.shortForecast || 'unknown',
		})),
	};
}

// Active NWS alerts for a point (watches/warnings). US-only; returns an empty
// list (not an error) outside NWS coverage, since this is an enrichment, not
// the primary payload.
async function nwsAlerts(lat, lon) {
	if (!isInContinentalUsRoughly(lat, lon)) return [];
	try {
		const data = await fetchJson(`https://api.weather.gov/alerts/active?point=${lat.toFixed(4)},${lon.toFixed(4)}`);
		return (data?.features || []).map((f) => ({
			event: f.properties?.event,
			severity: f.properties?.severity,
			headline: f.properties?.headline,
			expires: f.properties?.expires,
		}));
	} catch {
		return [];
	}
}

export async function forecast(lat, lon) {
	const coords = validateCoords(lat, lon);
	let base;
	let failedOver = false;
	try {
		base = await fromOpenMeteo(coords.lat, coords.lon);
	} catch (err) {
		if (!isInContinentalUsRoughly(coords.lat, coords.lon)) throw err;
		base = await fromNws(coords.lat, coords.lon);
		failedOver = true;
	}
	const alerts = await nwsAlerts(coords.lat, coords.lon);
	return { ...base, lat: coords.lat, lon: coords.lon, failedOver, alerts };
}

export async function decision(lat, lon, activity) {
	const profile = ACTIVITY_PROFILES[activity];
	if (!profile) {
		throw upstreamError(
			`unknown activity "${activity}": choose one of ${Object.keys(ACTIVITY_PROFILES).join(', ')}`,
			400,
			'bad_request',
		);
	}
	const data = await forecast(lat, lon);
	const window = data.hourly.slice(0, 6);
	const reasons = [];
	let verdict = 'go';
	const worsen = (to, reason) => {
		reasons.push(reason);
		if (to === 'no-go' || verdict === 'no-go') verdict = 'no-go';
		else if (to === 'caution') verdict = 'caution';
	};
	for (const hour of window) {
		if (profile.badCodes.has(hour.weatherCode)) {
			worsen('no-go', `${hour.conditions} expected at ${hour.time}`);
		}
		if (hour.windKph != null && hour.windKph > profile.maxWindKph) {
			worsen('caution', `wind ${hour.windKph.toFixed(0)} km/h exceeds ${profile.maxWindKph} km/h at ${hour.time}`);
		}
		if (hour.precipProbPct != null && hour.precipProbPct > profile.maxPrecipProb) {
			worsen('caution', `${hour.precipProbPct}% precipitation chance exceeds ${profile.maxPrecipProb}% at ${hour.time}`);
		}
	}
	if (data.alerts.some((a) => /warning/i.test(a.severity || '') || /extreme|severe/i.test(a.severity || ''))) {
		worsen('no-go', `active NWS alert: ${data.alerts[0].event}`);
	}
	return {
		activity,
		verdict,
		reasons: reasons.length ? reasons : ['no threshold exceeded in the next 6 hours'],
		source: data.source,
		failedOver: data.failedOver,
		window,
		alerts: data.alerts,
	};
}

export const WEATHER_GUARD_ACTIVITIES = Object.keys(ACTIVITY_PROFILES);

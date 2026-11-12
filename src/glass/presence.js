// Proof-of-presence and nearby polling for the /glass web app. Mirrors the phone
// flow in src/irl.js: mint a short-lived fix token from the current geolocation,
// send it as x-irl-fix, and re-mint once when the server answers fix_required.

import { distanceMetres, bearingTo } from './compass.js';

export const CELL_DECIMALS = 3; // ~110 m, the server's fix-token cell
export const SEND_DECIMALS = 4; // coordinates sent to the server

export class PresenceError extends Error {
	constructor(code, message) {
		super(message || code);
		this.name = 'PresenceError';
		this.code = code; // denied | unavailable | timeout | offline | rate_limited | server
	}
}

export function cellKey(lat, lng, decimals = CELL_DECIMALS) {
	return `${lat.toFixed(decimals)},${lng.toFixed(decimals)}`;
}

export function coarsen(n, decimals = SEND_DECIMALS) {
	const f = 10 ** decimals;
	return Math.round(n * f) / f;
}

// Fast while the wearer is moving, slow when standing still, slowest when hidden.
export function pollInterval({ speedMps = 0, hidden = false, empty = false } = {}) {
	if (hidden) return 60000;
	if (speedMps > 1.2) return 6000;
	return empty ? 20000 : 12000;
}

export function geolocationError(err) {
	if (err && err.code === 1) return new PresenceError('denied', 'Location permission was denied');
	if (err && err.code === 3) return new PresenceError('timeout', 'Location timed out');
	return new PresenceError('unavailable', 'Location is unavailable');
}

export function getPosition(geo = globalThis.navigator && globalThis.navigator.geolocation, opts = {}) {
	return new Promise((resolve, reject) => {
		if (!geo) return reject(new PresenceError('unavailable', 'Geolocation is not supported'));
		geo.getCurrentPosition(
			(p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, speed: p.coords.speed || 0 }),
			(e) => reject(geolocationError(e)),
			{ enableHighAccuracy: true, timeout: 12000, maximumAge: 5000, ...opts },
		);
	});
}

export function createPresence({ fetchImpl = globalThis.fetch && globalThis.fetch.bind(globalThis), now = () => Date.now() } = {}) {
	let token = null;
	let tokenCell = null;
	let tokenExpires = 0;
	let minting = null;

	async function mint(pos) {
		const cell = cellKey(pos.lat, pos.lng);
		if (token && tokenCell === cell && now() < tokenExpires - 15000) return token;
		if (minting && minting.cell === cell) return minting.promise;
		const promise = (async () => {
			let res;
			try {
				res = await fetchImpl('/api/irl/fix-token', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy }),
				});
			} catch {
				throw new PresenceError('offline', 'No connection');
			}
			if (res.status === 429) throw new PresenceError('rate_limited', 'Too many requests');
			if (!res.ok) throw new PresenceError('server', `Fix token failed (${res.status})`);
			const body = await res.json();
			token = body.token;
			tokenCell = cell;
			tokenExpires = now() + (body.expires_in || 180) * 1000;
			return token;
		})();
		minting = { cell, promise };
		try { return await promise; } finally { minting = null; }
	}

	async function nearby(pos, { radius = 60 } = {}) {
		const lat = coarsen(pos.lat);
		const lng = coarsen(pos.lng);
		const url = `/api/irl/pins?lat=${lat}&lng=${lng}&radius=${radius}`;
		for (let attempt = 0; attempt < 2; attempt++) {
			const t = await mint(pos);
			let res;
			try {
				res = await fetchImpl(url, { headers: { 'x-irl-fix': t } });
			} catch {
				throw new PresenceError('offline', 'No connection');
			}
			if (res.status === 401 && attempt === 0) { token = null; continue; }
			if (res.status === 429) throw new PresenceError('rate_limited', 'Too many requests');
			if (!res.ok) throw new PresenceError('server', `Nearby failed (${res.status})`);
			const body = await res.json();
			return (body.pins || []).map((p) => {
				const target = { lat: p.lat, lng: p.lng };
				return {
					...p,
					distance_m: distanceMetres({ lat, lng }, target),
					bearing: bearingTo({ lat, lng }, target),
				};
			}).sort((a, b) => a.distance_m - b.distance_m);
		}
		throw new PresenceError('server', 'Presence could not be proven');
	}

	return { mint, nearby, reset() { token = null; tokenCell = null; tokenExpires = 0; } };
}

// Human age of the last location fix for the scanning view ("just now", "42 s ago").
export function fixAgeLabel(fixedAtMs, nowMs = Date.now()) {
	if (!Number.isFinite(fixedAtMs)) return 'no fix yet';
	const s = Math.max(0, Math.round((nowMs - fixedAtMs) / 1000));
	if (s < 5) return 'just now';
	if (s < 90) return `${s} s ago`;
	return `${Math.round(s / 60)} min ago`;
}

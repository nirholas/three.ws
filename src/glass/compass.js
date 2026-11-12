// Heading and bearing math for the /glass arrow. Positive relative bearing means
// the target is to the user's right, matching arrowGlyph in src/irl/glasses/protocol.js.

const TAU = Math.PI * 2;

export function normalizeRad(rad) {
	let r = rad % TAU;
	if (r > Math.PI) r -= TAU;
	if (r <= -Math.PI) r += TAU;
	return r;
}

// Initial great-circle bearing from a to b, radians clockwise from true north.
export function bearingTo(from, to) {
	const p1 = (from.lat * Math.PI) / 180;
	const p2 = (to.lat * Math.PI) / 180;
	const dl = ((to.lng - from.lng) * Math.PI) / 180;
	const y = Math.sin(dl) * Math.cos(p2);
	const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
	return normalizeRad(Math.atan2(y, x));
}

export function distanceMetres(a, b) {
	const R = 6371008.8;
	const p1 = (a.lat * Math.PI) / 180;
	const p2 = (b.lat * Math.PI) / 180;
	const dp = p2 - p1;
	const dl = ((b.lng - a.lng) * Math.PI) / 180;
	const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
	return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function relativeBearing(headingRad, bearingRad) {
	return normalizeRad(bearingRad - headingRad);
}

// Heading in radians clockwise from north out of a deviceorientation event.
// iOS-style `webkitCompassHeading` is already clockwise degrees; the absolute
// alpha is counter-clockwise. Returns null when the event carries no compass.
export function headingFromEvent(e) {
	if (typeof e.webkitCompassHeading === 'number' && Number.isFinite(e.webkitCompassHeading)) {
		return normalizeRad((e.webkitCompassHeading * Math.PI) / 180);
	}
	if (e.absolute === true && typeof e.alpha === 'number' && Number.isFinite(e.alpha)) {
		return normalizeRad(((360 - e.alpha) * Math.PI) / 180);
	}
	return null;
}

// Circular exponential smoothing so the arrow does not jitter and does not spin
// the long way round at the +/-pi seam.
export function smoothHeading(prev, next, alpha = 0.25) {
	if (prev == null) return next;
	return normalizeRad(prev + alpha * normalizeRad(next - prev));
}

export function createCompass({ target = globalThis, onHeading, onState } = {}) {
	let heading = null;
	let state = 'idle';
	const setState = (s) => { if (s !== state) { state = s; if (onState) onState(s); } };
	const handler = (e) => {
		const h = headingFromEvent(e);
		if (h == null) { if (heading == null) setState('uncalibrated'); return; }
		heading = smoothHeading(heading, h);
		setState('live');
		if (onHeading) onHeading(heading);
	};
	return {
		get heading() { return heading; },
		get state() { return state; },
		// Must run from a user gesture (the first pinch): iOS gates orientation behind it.
		async start() {
			const DOE = target.DeviceOrientationEvent;
			if (!DOE) { setState('unsupported'); return state; }
			if (typeof DOE.requestPermission === 'function') {
				let res;
				try { res = await DOE.requestPermission(); } catch { res = 'denied'; }
				if (res !== 'granted') { setState('denied'); return state; }
			}
			setState('uncalibrated');
			target.addEventListener('deviceorientationabsolute', handler);
			target.addEventListener('deviceorientation', handler);
			return state;
		},
		stop() {
			target.removeEventListener('deviceorientationabsolute', handler);
			target.removeEventListener('deviceorientation', handler);
			setState('idle');
		},
	};
}

const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

// Heading ring label: compass point plus whole degrees, e.g. { point: 'NE', degrees: 45 }.
export function cardinal(headingRad) {
	const deg = (((headingRad * 180) / Math.PI) % 360 + 360) % 360;
	return { point: CARDINALS[Math.round(deg / 45) % 8], degrees: Math.round(deg) % 360 };
}

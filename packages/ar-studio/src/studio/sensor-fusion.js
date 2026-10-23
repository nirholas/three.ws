// Pure sensor-fusion helpers for the gyro world-lock camera.
//
// Why this exists
// ───────────────
// The world-lock camera is driven by `deviceorientation` (alpha/beta) and, on
// iOS, `webkitCompassHeading`. Real devices deliver `null`, `NaN`, uncalibrated,
// and discontinuous readings constantly: a magnetometer that walks into a
// magnetic dead-zone keeps reporting its LAST heading forever; a dropped frame
// arrives with `NaN` Euler angles; the compass bearing wraps 359°→1° as the user
// turns. A single bad value flowing untreated into `cameraYaw`/`cameraPitch`
// makes the avatar snap, spin, freeze, or vanish: the single worst reliability
// failure the AR experience can have.
//
// This module is the pure decision logic that keeps a bad reading from ever
// reaching the camera. No DOM, no Three.js, no sensors, no clock: plain numbers
// in, plain numbers out: so the studio wires it to the live event stream while
// the test suite verifies the math directly (mirrors ./camera-fov.js as a
// pure, unit-tested core).
//
// Coordinate conventions, shared with the studio's camera look:
//   cameraYaw (rad):   world Y-rotation; renderedBearing = −cameraYaw.
//   Compass bearing:   0-359° clockwise from true north (0 = N, 90 = E).
//   World yaw from a bearing:  yaw = −(deg · π/180)  (matches compassToYaw).

const DEG = Math.PI / 180;

// A heading older than this (ms) is treated as dead. iOS fires orientation
// events at ~60 Hz, so a gap this long means the magnetometer stopped updating
// (uncalibrated, or in a magnetic dead-zone): fall back to the relative gyro
// path rather than keep steering by a frozen bearing.
export const COMPASS_STALE_MS = 1500;

// Shortest-path angular interpolation (radians). Mirrors `lerpAngle` in
// the studio; kept here so the pure core has no dependency on the DOM
// bundle. Eases `from` toward `to` along the shortest arc, so crossing the
// 359°→1° compass boundary is a ~2° move, never a ~360° one.
export function shortestAngleLerp(from, to, t) {
	let diff = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
	if (diff < -Math.PI) diff += Math.PI * 2;
	return from + diff * t;
}

// A deviceorientation reading is usable only if BOTH Euler angles are real,
// finite numbers. `null`/`undefined`/`NaN`/`±Infinity` are all rejected so one
// bad frame can never poison the camera quaternion. Callers hold the last valid
// reading on a `false` here rather than substituting 0/90 (which would yank the
// view's yaw to page-north and slam the pitch to the horizon).
export function isFiniteReading(alpha, beta) {
	return Number.isFinite(alpha) && Number.isFinite(beta);
}

// True while the last good compass sample is recent enough to trust. `lastGoodAt`
// is the timestamp (same clock as `now`) of the last finite heading; a non-finite
// `lastGoodAt` (never seen a compass) is never fresh.
export function isCompassFresh(lastGoodAt, now, staleMs = COMPASS_STALE_MS) {
	return Number.isFinite(lastGoodAt) && now - lastGoodAt <= staleMs;
}

// The absolute (north-referenced) yaw path is only correct when a GPS world-anchor
// gives the scene an absolute origin AND a fresh compass bearing exists. Without
// GPS the avatar would jump off-frame to its compass bearing the instant it locks;
// without a fresh compass we are steering by a dead heading: both fall back to the
// relative gyro path.
export function shouldUseAbsoluteYaw({ gpsModeActive, compassHeading, compassFresh }) {
	return Boolean(gpsModeActive) && compassHeading !== null && compassHeading !== undefined && compassFresh;
}

// Resolve the target `cameraYaw` for one orientation frame.
//
//   absolute path: ease toward the true bearing along the shortest arc so the
//                   avatar stays planted on its real-world direction for every
//                   viewer, and a 359°→1° wrap never spins.
//   relative path: integrate alpha deltas from the lock baseline so the view
//                   rotates with the phone while the avatar holds its pinned spot.
//
// All inputs are finite by contract (the caller holds the last valid reading);
// the result is therefore always finite.
export function resolveLockYaw({
	useAbsolute,
	prevYaw,
	alpha,
	baseAlpha,
	baseYaw,
	compassHeading,
	absoluteSmooth = 0.4,
}) {
	if (useAbsolute) {
		const target = -compassHeading * DEG;
		return shortestAngleLerp(prevYaw, target, absoluteSmooth);
	}
	let dAlpha = alpha - baseAlpha;
	if (dAlpha > 180) dAlpha -= 360;
	if (dAlpha < -180) dAlpha += 360;
	return baseYaw + dAlpha * DEG;
}

// Clamp a pitch into the camera's range, guaranteeing a finite result. A `NaN`
// that slipped past upstream guards collapses to 0 (always inside the symmetric
// range) instead of propagating: `Math.max/min` would otherwise return `NaN`.
export function clampPitch(pitch, min, max) {
	const p = Number.isFinite(pitch) ? pitch : 0;
	return p < min ? min : p > max ? max : p;
}

// ── Screen-orientation frame correction (task-02) ───────────────────────────
// The pitch path integrates `beta` (front↔back tilt) on the assumption the phone
// is held PORTRAIT. Rotate to landscape and the physical "look up / look down" the
// user does no longer moves `beta`: it moves `gamma` (left↔right tilt), and the
// sign flips between the two landscape directions. Left uncorrected, tilting the
// phone up in landscape slides the avatar sideways instead of raising the view.
//
// `screen.orientation.angle` (0 | 90 | 180 | 270) tells us how the screen is
// rotated relative to its natural (portrait) frame. We fold it in to recover the
// PORTRAIT-EQUIVALENT pitch angle, so every downstream baseline/delta computation
// keeps working unchanged regardless of how the device is held.
//
//   angle   0 (portrait)            → +beta
//   angle  90 (landscape, ⟲ 90°)    → +gamma
//   angle 180 (portrait, upside-down)→ −beta
//   angle 270 (landscape, ⟳ 90°)    → −gamma
//
// Returns a finite number by contract when given finite beta/gamma; a non-finite
// component for the active axis collapses to 0 (horizon) rather than poisoning the
// camera.
export function screenPitchDeg(beta, gamma, screenAngle = 0) {
	const a = ((Math.round(Number(screenAngle) / 90) * 90) % 360 + 360) % 360;
	let v;
	switch (a) {
		case 90:  v = gamma; break;
		case 180: v = -beta; break;
		case 270: v = -gamma; break;
		default:  v = beta;  break; // 0 / unknown → portrait
	}
	return Number.isFinite(v) ? v : 0;
}

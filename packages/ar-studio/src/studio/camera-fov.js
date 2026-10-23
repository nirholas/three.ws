// Pure camera-FOV math for the AR camera passthrough.
//
// Why this exists
// ───────────────
// In AR the Three.js camera must share the REAL rear camera's field of view, or
// the avatar renders at the wrong scale: too small and it looks like a toy on the
// floor, too large and it clips through real objects. The phone exposes the video
// track's pixel dimensions (`track.getSettings()`), and rear cameras run at a
// roughly fixed ~72° DIAGONAL FOV, so we can recover the horizontal FOV from the
// sensor aspect and then the vertical FOV (what Three.js wants) from the VIEWPORT
// aspect: which is what actually fills the screen.
//
// This was inlined in enableAR() and only ran ONCE, so rotating portrait↔landscape
// left the avatar at the portrait scale. Extracted here as a pure function the
// resize/orientation path can re-run every time the viewport changes, and the test
// suite verifies the optics directly (mirrors ./sensor-fusion.js).
//
// No DOM, no Three.js: plain numbers in, a clamped vertical-FOV in degrees out.

// Typical rear-camera diagonal field of view in degrees. iOS/Android rear cameras
// cluster tightly around this; it is the one constant the device does not report.
export const DEFAULT_DIAG_FOV_DEG = 72;

// Three.js PerspectiveCamera.fov is sane between these. We clamp so a degenerate
// track dimension (0×0, 1×1) or an extreme aspect can never produce a NaN/∞ or a
// fish-eye/pinhole projection that detaches the avatar from the floor.
export const VFOV_MIN_DEG = 50;
export const VFOV_MAX_DEG = 90;

const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

/**
 * Vertical FOV (degrees) for the Three.js camera, derived from the rear-camera
 * sensor and the on-screen viewport.
 *
 * Steps: the sensor's diagonal FOV → its HORIZONTAL FOV (via the sensor aspect)
 * → the VERTICAL FOV that fills a viewport of `viewAspect`. Using the sensor
 * aspect for the first step and the viewport aspect for the second is what keeps
 * the scale correct as the viewport rotates while the camera sensor does not.
 *
 * Every input is defended: a non-finite or non-positive dimension/aspect falls
 * back to a sensible value, and the result is clamped to [VFOV_MIN, VFOV_MAX], so
 * this is always safe to call straight from a resize handler.
 *
 * @param {object} p
 * @param {number} p.trackWidth   video track pixel width  (sensor)
 * @param {number} p.trackHeight  video track pixel height (sensor)
 * @param {number} p.viewWidth    viewport CSS pixel width
 * @param {number} p.viewHeight   viewport CSS pixel height
 * @param {number} [p.diagFovDeg] sensor diagonal FOV (default ~72°)
 * @returns {number} vertical FOV in degrees, clamped
 */
export function deriveVerticalFovDeg({
	trackWidth,
	trackHeight,
	viewWidth,
	viewHeight,
	diagFovDeg = DEFAULT_DIAG_FOV_DEG,
}) {
	const tw = posOr(trackWidth, viewWidth);
	const th = posOr(trackHeight, viewHeight);
	const vw = posOr(viewWidth, tw);
	const vh = posOr(viewHeight, th);
	const diag = posOr(diagFovDeg, DEFAULT_DIAG_FOV_DEG);

	// Sensor diagonal → sensor horizontal FOV.
	const diagPx = Math.hypot(tw, th) || 1;
	const hFovRad = 2 * Math.atan((tw / diagPx) * Math.tan((diag * DEG) / 2));

	// Sensor horizontal FOV → viewport vertical FOV (viewport aspect drives this).
	const viewAspect = vw / vh;
	const vFovRad = 2 * Math.atan(Math.tan(hFovRad / 2) / (viewAspect || 1));
	const vFovDeg = vFovRad * RAD;

	if (!Number.isFinite(vFovDeg)) return VFOV_MIN_DEG;
	return Math.max(VFOV_MIN_DEG, Math.min(VFOV_MAX_DEG, vFovDeg));
}

function posOr(v, fallback) {
	const n = Number(v);
	return Number.isFinite(n) && n > 0 ? n : (Number(fallback) > 0 ? Number(fallback) : 1);
}

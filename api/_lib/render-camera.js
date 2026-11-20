// Camera fields for the public GLB renderer (/api/render/glb).
//
// Callers speak in turntable terms: `azimuth` (degrees around the model, 0 is
// dead front, positive turns the camera to the model's right), `elevation`
// (degrees above the horizon) and `fov` (vertical field of view). Both render
// lanes speak yaw/pitch/fov, so this maps one onto the other and validates the
// range, because the values are interpolated into the chromium render page.
//
// A field the caller leaves out stays out of the result. That is what keeps
// the default render byte-identical: every existing OG card and thumbnail URL
// carries no camera fields and must keep producing the PNG the CDN already
// holds.

export const ELEVATION_MIN = -80;
export const ELEVATION_MAX = 80;
export const FOV_MIN = 10;
export const FOV_MAX = 90;

function present(v) {
	return v !== undefined && v !== null && v !== '';
}

/** Wrap any finite angle into (-180, 180]. */
export function wrapAzimuth(deg) {
	let a = deg % 360;
	if (a > 180) a -= 360;
	if (a <= -180) a += 360;
	return a === 0 ? 0 : a;
}

/**
 * @param {{azimuth?:unknown, elevation?:unknown, fov?:unknown}} input
 * @returns {{camera:{yaw?:number,pitch?:number,fov?:number}} | {error:string}}
 */
export function parseRenderCamera(input = {}) {
	const camera = {};
	if (present(input.azimuth)) {
		const n = Number(input.azimuth);
		if (!Number.isFinite(n)) return { error: 'azimuth must be a number of degrees' };
		camera.yaw = wrapAzimuth(n);
	}
	if (present(input.elevation)) {
		const n = Number(input.elevation);
		if (!Number.isFinite(n) || n < ELEVATION_MIN || n > ELEVATION_MAX) {
			return { error: `elevation must be a number of degrees from ${ELEVATION_MIN} to ${ELEVATION_MAX}` };
		}
		camera.pitch = n;
	}
	if (present(input.fov)) {
		const n = Number(input.fov);
		if (!Number.isFinite(n) || n < FOV_MIN || n > FOV_MAX) {
			return { error: `fov must be a number of degrees from ${FOV_MIN} to ${FOV_MAX}` };
		}
		camera.fov = n;
	}
	return { camera };
}

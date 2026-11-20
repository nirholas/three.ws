// Camera framing for a model of any size: no three.js import, so Node tests it too.

/**
 * How far back a perspective camera must sit to see a box whole.
 * @param {{ x: number, y: number, z: number }} size  the model's bounding-box size
 * @param {number} fovDeg  the camera's vertical field of view in degrees
 * @param {number} aspect  viewport width / height
 * @param {number} [margin]  breathing room around the model (1.25 = 25%)
 */
export function fitDistance(size, fovDeg, aspect, margin = 1.25) {
	const vFov = (fovDeg * Math.PI) / 180;
	const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
	const radius = Math.max(Math.hypot(size.x, size.z) / 2, 1e-6);
	const byHeight = size.y / 2 / Math.tan(vFov / 2);
	const byWidth = radius / Math.tan(hFov / 2);
	return Math.max(byHeight, byWidth) * margin + radius;
}

/** A GLB URL the loader can fetch: https (or http on localhost), and nothing else. */
export function glbSource(raw, fallback) {
	const text = String(raw ?? '').trim();
	if (!text) return fallback;
	try {
		const url = new URL(text);
		const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
		if (url.protocol === 'https:' || (url.protocol === 'http:' && local)) return url.href;
	} catch {}
	return null;
}

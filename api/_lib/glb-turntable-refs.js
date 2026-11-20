// Multi-angle reference renders of one GLB.
//
// Hero clips (docs/hero-clips.md) hand Grok Imagine Video real pictures of the
// user's own model instead of a text description of it: one front render pinned
// as the first frame, plus (on the full model) the other angles as reference
// images. The same renders power the no-key fallback, where the page shows the
// angle strip next to the turntable the repo's own encoder builds.
//
// Every render goes through renderGlbToPng, so the CPU lane does the work and a
// chromium fallback covers anything it cannot draw. The CPU lane caches the
// parsed model, so angles after the first cost only a rasterization.

import { renderGlbToPng } from './render-glb.js';

export const DEFAULT_ANGLE_COUNT = 6;
export const MAX_ANGLE_COUNT = 14;
export const DEFAULT_REF_SIZE = 768;
export const REF_BACKGROUND = '#0f1115';

// A low orbit reads as a product shot: high enough to see the top surfaces,
// low enough that the silhouette stays the model's own. A second, higher ring
// only appears past eight angles, where one ring would start repeating views.
const LOW_RING_ELEVATION = 10;
const HIGH_RING_ELEVATION = 32;
const ONE_RING_MAX = 8;

function round(n) {
	return Math.round(n * 100) / 100;
}

function wrap(deg) {
	let a = deg % 360;
	if (a > 180) a -= 360;
	if (a <= -180) a += 360;
	return round(a) === 0 ? 0 : round(a);
}

function ring(count, elevation, offset = 0) {
	const step = 360 / count;
	return Array.from({ length: count }, (_, i) => ({ azimuth: wrap(offset + i * step), elevation }));
}

/**
 * The camera angles for `count` reference renders. Angle 0 is always dead front
 * at the low ring, because that one becomes the clip's first frame.
 *
 * @param {number} [count=6] 1 to 14
 * @returns {{azimuth:number, elevation:number}[]}
 */
export function planAngles(count = DEFAULT_ANGLE_COUNT) {
	const n = Number(count);
	if (!Number.isInteger(n) || n < 1 || n > MAX_ANGLE_COUNT) {
		throw Object.assign(new Error(`angle count must be an integer from 1 to ${MAX_ANGLE_COUNT}`), {
			status: 400,
			code: 'invalid_args',
		});
	}
	if (n <= ONE_RING_MAX) return ring(n, LOW_RING_ELEVATION);
	const low = Math.ceil(n / 2);
	const high = n - low;
	return [...ring(low, LOW_RING_ELEVATION), ...ring(high, HIGH_RING_ELEVATION, 180 / high)];
}

/**
 * Render `count` angles of one GLB.
 *
 * @param {object} opts
 * @param {string} opts.glbUrl public URL of the model (callers SSRF-check it first)
 * @param {number} [opts.count=6]
 * @param {number} [opts.size=768] square edge in pixels
 * @param {string} [opts.background='#0f1115'] hex colour or 'transparent'
 * @param {number} [opts.fov] vertical field of view; the renderer default when omitted
 * @returns {Promise<{refs:{azimuth:number,elevation:number,png:Buffer,width:number,height:number,ms:number}[], totalMs:number, msPerAngle:number}>}
 */
export async function renderTurntableRefs({
	glbUrl,
	count = DEFAULT_ANGLE_COUNT,
	size = DEFAULT_REF_SIZE,
	background = REF_BACKGROUND,
	fov,
} = {}) {
	if (!glbUrl || typeof glbUrl !== 'string') {
		throw Object.assign(new Error('glbUrl required'), { status: 400, code: 'invalid_args' });
	}
	const angles = planAngles(count);
	const started = Date.now();
	const refs = [];
	// Sequential on purpose: the CPU lane holds one parsed copy of the model and
	// one rasterizer, and parallel renders of the same GLB only contend for it.
	for (const { azimuth, elevation } of angles) {
		const t0 = Date.now();
		const png = await renderGlbToPng({
			glbUrl,
			width: size,
			height: size,
			background,
			yaw: azimuth,
			pitch: elevation,
			...(fov === undefined ? {} : { fov }),
		});
		refs.push({ azimuth, elevation, png, width: size, height: size, ms: Date.now() - t0 });
	}
	const totalMs = Date.now() - started;
	return { refs, totalMs, msPerAngle: Math.round(totalMs / refs.length) };
}

// The clip's first frame is wide, because image-to-video output always takes
// the aspect ratio of its first frame and a 16:9 clip is what plays inline in a
// feed. 1280x720 is the largest still xAI takes for video.
export const FIRST_FRAME_WIDTH = 1280;
export const FIRST_FRAME_HEIGHT = 720;
export const FIRST_FRAME_ANGLE = Object.freeze({ azimuth: 0, elevation: LOW_RING_ELEVATION });

/**
 * Render the front view at 16:9, the frame a hero clip opens on.
 * @returns {Promise<{png:Buffer, width:number, height:number, ms:number}>}
 */
export async function renderFirstFrame({
	glbUrl,
	width = FIRST_FRAME_WIDTH,
	height = FIRST_FRAME_HEIGHT,
	background = REF_BACKGROUND,
} = {}) {
	if (!glbUrl || typeof glbUrl !== 'string') {
		throw Object.assign(new Error('glbUrl required'), { status: 400, code: 'invalid_args' });
	}
	const t0 = Date.now();
	const png = await renderGlbToPng({
		glbUrl,
		width,
		height,
		background,
		yaw: FIRST_FRAME_ANGLE.azimuth,
		pitch: FIRST_FRAME_ANGLE.elevation,
	});
	return { png, width, height, ms: Date.now() - t0 };
}

/** A PNG buffer as a base64 data URI, the inline form xAI accepts for images. */
export function pngDataUri(png) {
	return `data:image/png;base64,${Buffer.from(png).toString('base64')}`;
}

/**
 * The public render URL for one angle, so a page can show the strip without a
 * second copy of the bytes: /api/render/glb is CDN-cached per query string.
 */
export function refRenderUrl({
	glbUrl,
	azimuth,
	elevation,
	size = DEFAULT_REF_SIZE,
	width = size,
	height = size,
	background = REF_BACKGROUND,
}) {
	const q = new URLSearchParams({
		glbUrl,
		width: String(width),
		height: String(height),
		background,
		azimuth: String(azimuth),
		elevation: String(elevation),
	});
	return `/api/render/glb?${q}`;
}

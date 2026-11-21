// Pure logic for the /pano-scene page: file classification, the 2:1 check, the
// staged progress model, and the camera maths. No DOM and no three.js here, so
// every rule is unit-tested (tests/pano-scene-page.test.js).

export const MAX_PHOTO_BYTES = 120 * 1024 * 1024;
export const ASPECT_TOLERANCE = 0.02;

/**
 * What a picked file is, or null when the page cannot use it.
 * @param {{ name: string, type: string }} file
 * @returns {{ kind: 'equirect_image' | 'insp', contentType: string } | null}
 */
export function classifyFile(file) {
	const name = String(file?.name || '');
	const type = String(file?.type || '').toLowerCase();
	if (/\.insp$/i.test(name)) return { kind: 'insp', contentType: 'application/octet-stream' };
	if (type === 'image/jpeg' || (!type && /\.jpe?g$/i.test(name))) return { kind: 'equirect_image', contentType: 'image/jpeg' };
	if (type === 'image/png' || (!type && /\.png$/i.test(name))) return { kind: 'equirect_image', contentType: 'image/png' };
	return null;
}

/**
 * A pasted link the page can hand to /api/pano-scene, or null. Only https is
 * accepted (the server refuses anything else); the source kind follows the
 * path, the same rule the server applies when source_kind is omitted.
 * @returns {{ kind: 'equirect_image' | 'insp', url: string } | null}
 */
export function classifyUrl(raw) {
	let parsed;
	try {
		parsed = new URL(String(raw ?? '').trim());
	} catch {
		return null;
	}
	if (parsed.protocol !== 'https:' || !parsed.hostname) return null;
	return { kind: /\.insp$/i.test(parsed.pathname) ? 'insp' : 'equirect_image', url: parsed.href };
}

/** An equirectangular photo is exactly twice as wide as it is tall. */
export function isEquirectSize(width, height) {
	if (!(width > 0) || !(height > 0)) return false;
	return Math.abs(width / height - 2) <= ASPECT_TOLERANCE * 2;
}

// The five steps the page shows. `stitch` only exists for a raw .insp.
const STEP_LABELS = {
	upload: 'Upload',
	stitch: 'Stitch',
	depth: 'Depth',
	mesh: 'Mesh',
	done: 'Done',
};

export function stepsFor(kind) {
	const keys = kind === 'insp' ? ['upload', 'stitch', 'depth', 'mesh', 'done'] : ['upload', 'depth', 'mesh', 'done'];
	return keys.map((key) => ({ key, label: STEP_LABELS[key] }));
}

/**
 * Per-step state from the API's `stage` (stitch | depth | mesh | save | done) or
 * the page's own `upload`. `save` is the tail of the mesh step.
 * @returns {Array<{ key: string, label: string, state: 'todo' | 'active' | 'done' }>}
 */
export function stepStates(kind, stage, status) {
	const steps = stepsFor(kind);
	const current = stage === 'save' ? 'mesh' : stage;
	const at = steps.findIndex((s) => s.key === current);
	return steps.map((s, i) => {
		let state = 'todo';
		if (status === 'succeeded' || (at >= 0 && i < at)) state = 'done';
		else if (i === at) state = 'active';
		return { ...s, state };
	});
}

/** One sentence under the progress bar, from the stage the API reports. */
export function stageCopy(stage, progress) {
	const pct = `${Math.round(Math.min(1, Math.max(0, progress || 0)) * 100)}%`;
	switch (stage) {
		case 'upload': return 'Uploading your photo';
		case 'stitch': return `Stitching the two lenses into one 360 photo (${pct})`;
		case 'depth': return `Estimating how far away everything is (${pct})`;
		case 'mesh': return `Building the 3D shell (${pct})`;
		case 'save': return `Saving your scene (${pct})`;
		default: return `Working (${pct})`;
	}
}

/** The visitor line for an API or worker error code. */
export function errorCopy(code, message) {
	switch (code) {
		case 'sign_in_required': return { title: 'Sign in to step inside a photo', body: message || 'A three.ws account is free.', signIn: true };
		case 'storage_unavailable': return { title: 'Uploads are paused for a moment', body: 'Our file storage is recovering, so uploads cannot finish right now. Paste a public https link to your 360 photo instead, or try again in a minute.', pasteLink: true };
		case 'upload_failed': return { title: 'The upload did not finish', body: `${message || 'The file could not reach our storage.'} Try again, or paste a public https link to the photo instead.`, pasteLink: true };
		case 'unconfigured': return { title: 'Not switched on yet', body: message || 'Photo-to-3D is not switched on yet on this server.' };
		case 'not_equirect': return { title: 'That is not a 360 photo', body: 'A 360 photo is exactly twice as wide as it is tall. Export it from your camera app as an equirectangular JPEG, or upload the raw .insp file.' };
		case 'too_large': return { title: 'That file is too large', body: `Photos up to ${Math.round(MAX_PHOTO_BYTES / 1024 / 1024)} MB work. Export a smaller JPEG from your camera app.` };
		case 'unsupported_type': return { title: 'That file type does not work here', body: 'Use a 360 photo as JPEG or PNG, or a raw .insp file.' };
		// The stitcher's refusals (workers/model-pano2splat/pano_stitch/errors.py)
		// are about the file itself, so running it again cannot help.
		case 'unsupported_camera': return { title: 'That camera is not supported for raw files', body: `${message || 'This camera model cannot be stitched here.'} Export a stitched 360 JPEG from your camera app or Insta360 Studio and upload that instead.`, permanent: true };
		case 'corrupt_input':
		case 'corrupt_trailer':
		case 'corrupt_calibration':
		case 'unreadable_input':
		case 'no_calibration':
		case 'unsupported_layout': return { title: 'This raw file could not be read', body: `${message || 'The .insp file is damaged or incomplete.'} Copy it from the camera again, or export a stitched 360 JPEG and upload that instead.`, permanent: true };
		default: return { title: 'Something went wrong', body: message || 'Try again in a minute.' };
	}
}

/**
 * Farthest the camera may drift from the centre, in metres. The shell is built
 * from depth seen at the centre, so leaving it far shows the holes behind
 * surfaces. A fraction of the median depth keeps the parallax honest.
 */
export function walkRadius(medianDepthM) {
	const d = Number(medianDepthM);
	const base = Number.isFinite(d) && d > 0 ? d : 3;
	return Math.min(1.5, Math.max(0.25, base * 0.3));
}

/**
 * A latitude/longitude sphere of `radius` metres that samples the equirect photo
 * in the depth worker's frame (workers/model-panodepth/shell_mesh.py
 * directions(): u = 0.5, v = 0.5 looks along -Z, u grows toward +X, v is
 * measured from the top). The worker drops shell faces that bridge a depth
 * jump; drawn behind the shell, this sphere shows the photo through those gaps
 * instead of the empty background, exactly from the centre and as distant
 * scenery once the camera steps off it.
 */
export function backdropGrid(cols, rows, radius) {
	const positions = new Float32Array((cols + 1) * (rows + 1) * 3);
	const uvs = new Float32Array((cols + 1) * (rows + 1) * 2);
	let p = 0;
	let t = 0;
	for (let r = 0; r <= rows; r++) {
		const v = r / rows;
		const pitch = (0.5 - v) * Math.PI;
		const cp = Math.cos(pitch);
		const sp = Math.sin(pitch);
		for (let c = 0; c <= cols; c++) {
			const u = c / cols;
			const yaw = (u - 0.5) * 2 * Math.PI;
			positions[p++] = radius * Math.sin(yaw) * cp;
			positions[p++] = radius * sp;
			positions[p++] = -radius * Math.cos(yaw) * cp;
			uvs[t++] = u;
			uvs[t++] = v;
		}
	}
	const indices = new Uint32Array(cols * rows * 6);
	let k = 0;
	for (let r = 0; r < rows; r++) {
		for (let c = 0; c < cols; c++) {
			const a = r * (cols + 1) + c;
			const b = a + cols + 1;
			indices[k++] = a;
			indices[k++] = b;
			indices[k++] = a + 1;
			indices[k++] = a + 1;
			indices[k++] = b;
			indices[k++] = b + 1;
		}
	}
	return { positions, uvs, indices };
}

/** Clamp a horizontal offset into the walk disc. */
export function clampOffset(x, z, radius) {
	const len = Math.hypot(x, z);
	if (len <= radius || len === 0) return { x, z };
	const k = radius / len;
	return { x: x * k, z: z * k };
}

/**
 * Camera quaternion from a DeviceOrientation reading (the W3C formula three.js
 * used in DeviceOrientationControls): YXZ Euler of (beta, alpha, -gamma), then a
 * -90 degree turn about X so the phone held upright looks at the horizon, then
 * the screen rotation. Angles are degrees; returns [x, y, z, w].
 */
export function deviceQuaternion(alphaDeg, betaDeg, gammaDeg, screenDeg = 0) {
	const rad = Math.PI / 180;
	const q = eulerYXZ(betaDeg * rad, (alphaDeg || 0) * rad, -(gammaDeg || 0) * rad);
	const qx = axisAngle(1, 0, 0, -Math.PI / 2);
	const qs = axisAngle(0, 0, 1, -(screenDeg || 0) * rad);
	return mul(mul(q, qx), qs);
}

function eulerYXZ(x, y, z) {
	// three.js Euler order 'YXZ'.
	const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
	const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
	return [
		s1 * c2 * c3 + c1 * s2 * s3,
		c1 * s2 * c3 - s1 * c2 * s3,
		c1 * c2 * s3 - s1 * s2 * c3,
		c1 * c2 * c3 + s1 * s2 * s3,
	];
}

function axisAngle(x, y, z, angle) {
	const s = Math.sin(angle / 2);
	return [x * s, y * s, z * s, Math.cos(angle / 2)];
}

function mul(a, b) {
	const [ax, ay, az, aw] = a;
	const [bx, by, bz, bw] = b;
	return [
		ax * bw + aw * bx + ay * bz - az * by,
		ay * bw + aw * by + az * bx - ax * bz,
		az * bw + aw * bz + ax * by - ay * bx,
		aw * bw - ax * bx - ay * by - az * bz,
	];
}

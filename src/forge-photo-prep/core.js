/**
 * Pure math for on-device photo preparation (no DOM, no ONNX): tensor layout,
 * mask analysis, square crop planning, quality metrics and the warnings they
 * raise, and the decision whether this device runs the pass at all.
 *
 * The browser worker (worker.js) and the measurement bench
 * (scripts/forge-photo-prep-bench.mjs) both call these functions, so the numbers
 * in docs/forge-photo-prep.md come from the same code the visitor runs.
 */

/** U²-Netp reads a 320 x 320 RGB image. */
export const MODEL_SIZE = 320;

const IMAGENET_MEAN = [0.485, 0.456, 0.406];
const IMAGENET_STD = [0.229, 0.224, 0.225];

/**
 * Every threshold in one place, calibrated on the ten-photo bench in
 * docs/forge-photo-prep.md. Measured there: subject sharpness 241 (the lemon) to
 * 12,122 on usable photos, 95 on the defocused scooter and 64 on the soft phone
 * shot of the mug; frame coverage 0.084
 * and up for real subjects, 0.041 for the scooter lost in a wide shot; the
 * second view in the two-teapot photo is 0.20 of the first, stray specks stay
 * near 0.
 */
export const THRESHOLDS = Object.freeze({
	/** Mask value (0..255) that counts as subject. */
	maskCutoff: 128,
	/** Extra margin around the subject, per side, as a share of its longer edge. */
	cropPadding: 0.08,
	/** Longest edge of the prepared image. TRELLIS.2 downsizes anything larger to 1024. */
	maxSide: 1024,
	/** Below this share of the frame there is nothing to reconstruct. */
	noSubjectCoverage: 0.002,
	/** Subject smaller than this share of the frame. */
	minCoverage: 0.05,
	/** Subject's longer edge in source pixels. */
	minSubjectPx: 256,
	/** Laplacian variance over subject pixels with the crop resampled to sharpnessSide. */
	minSharpness: 100,
	/** Mean subject luminance (0..255) below which the photo is too dark. */
	darkMean: 55,
	/** Share of subject pixels at or above 250 luminance. */
	maxClippedHigh: 0.25,
	/** A second blob at least this share of the largest counts as another subject. */
	secondSubjectRatio: 0.15,
	/** The mask box within this many model pixels of a border touches the edge. */
	edgeMarginPx: 1,
	/** Working scale for the sharpness measurement, close to the 518 px TRELLIS.2 conditions on. */
	sharpnessSide: 512,
	/** Devices reporting less memory than this (GB) skip the pass. */
	minDeviceMemoryGb: 1,
});

/** RGBA pixels (size x size) to the planar float tensor U²-Netp expects. */
export function buildInputTensor(rgba, size = MODEL_SIZE) {
	const px = size * size;
	if (rgba.length !== px * 4) throw new Error(`buildInputTensor: got ${rgba.length} bytes, expected ${px * 4}`);
	let max = 0;
	for (let i = 0; i < rgba.length; i++) {
		if ((i & 3) !== 3 && rgba[i] > max) max = rgba[i];
	}
	const scale = max || 1;
	const out = new Float32Array(3 * px);
	for (let i = 0; i < px; i++) {
		for (let c = 0; c < 3; c++) {
			out[c * px + i] = (rgba[i * 4 + c] / scale - IMAGENET_MEAN[c]) / IMAGENET_STD[c];
		}
	}
	return out;
}

/** Model output (any range) to a 0..255 mask, min-max stretched. */
export function normalizeMask(output) {
	let lo = Infinity;
	let hi = -Infinity;
	for (const v of output) {
		if (v < lo) lo = v;
		if (v > hi) hi = v;
	}
	const range = hi - lo;
	const mask = new Uint8Array(output.length);
	if (!(range > 0)) return mask;
	for (let i = 0; i < output.length; i++) mask[i] = Math.round(((output[i] - lo) / range) * 255);
	return mask;
}

/**
 * Subject box, coverage, connected blobs (4-connected, largest first) and
 * whether the subject touches a border, all in mask pixels.
 */
export function analyzeMask(mask, w, h, cutoff = THRESHOLDS.maskCutoff) {
	const labels = new Int32Array(w * h);
	const components = [];
	const stack = [];
	let minX = w;
	let minY = h;
	let maxX = -1;
	let maxY = -1;
	let on = 0;
	for (let start = 0; start < mask.length; start++) {
		if (mask[start] < cutoff || labels[start]) continue;
		const id = components.length + 1;
		let area = 0;
		labels[start] = id;
		stack.push(start);
		while (stack.length) {
			const i = stack.pop();
			area++;
			const x = i % w;
			const y = (i - x) / w;
			if (x < minX) minX = x;
			if (x > maxX) maxX = x;
			if (y < minY) minY = y;
			if (y > maxY) maxY = y;
			if (x > 0) visit(i - 1);
			if (x < w - 1) visit(i + 1);
			if (y > 0) visit(i - w);
			if (y < h - 1) visit(i + w);
		}
		components.push(area);
		on += area;

		function visit(j) {
			if (!labels[j] && mask[j] >= cutoff) {
				labels[j] = id;
				stack.push(j);
			}
		}
	}
	components.sort((a, b) => b - a);
	if (!on) return { box: null, coverage: 0, components, touchesEdge: false };
	const box = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
	const m = THRESHOLDS.edgeMarginPx;
	const touchesEdge = minX < m || minY < m || maxX > w - 1 - m || maxY > h - 1 - m;
	return { box, coverage: on / (w * h), components, touchesEdge };
}

/** A box in model space (size x size) to source image pixels, rounded outward. */
export function maskBoxToImage(box, size, imgW, imgH) {
	const sx = imgW / size;
	const sy = imgH / size;
	const x0 = Math.floor(box.x * sx);
	const y0 = Math.floor(box.y * sy);
	const x1 = Math.min(imgW, Math.ceil((box.x + box.w) * sx));
	const y1 = Math.min(imgH, Math.ceil((box.y + box.h) * sy));
	return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * The square region to cut from the source: the subject's longer edge plus
 * padding, centred on the subject, shifted to stay inside the photo whenever
 * the photo is big enough. sx/sy go negative (the area beyond the photo is
 * padding) only when the square is larger than the photo itself.
 */
export function squareCropPlan(box, imgW, imgH, { padding = THRESHOLDS.cropPadding, maxSide = THRESHOLDS.maxSide } = {}) {
	const side = Math.max(1, Math.round(Math.max(box.w, box.h) * (1 + 2 * padding)));
	const cx = box.x + box.w / 2;
	const cy = box.y + box.h / 2;
	const place = (center, extent) => {
		const start = Math.round(center - side / 2);
		if (side >= extent) return Math.round((extent - side) / 2);
		return Math.min(Math.max(start, 0), extent - side);
	};
	return { sx: place(cx, imgW), sy: place(cy, imgH), side, outSize: Math.min(side, maxSide) };
}

/**
 * Variance of the 4-neighbour Laplacian over grayscale pixels. With `weight`,
 * only pixels whose weight is at least the mask cutoff count, so a sharp
 * subject on a plain backdrop is not scored as blurry by its empty background.
 */
export function laplacianVariance(gray, w, h, weight = null) {
	let n = 0;
	let sum = 0;
	let sumSq = 0;
	for (let y = 1; y < h - 1; y++) {
		for (let x = 1; x < w - 1; x++) {
			const i = y * w + x;
			if (weight && weight[i] < THRESHOLDS.maskCutoff) continue;
			const v = gray[i - 1] + gray[i + 1] + gray[i - w] + gray[i + w] - 4 * gray[i];
			n++;
			sum += v;
			sumSq += v * v;
		}
	}
	if (!n) return 0;
	const mean = sum / n;
	return sumSq / n - mean * mean;
}

/** RGBA to Rec. 601 luma, one byte per pixel. */
export function toGray(rgba) {
	const out = new Uint8Array(rgba.length / 4);
	for (let i = 0; i < out.length; i++) {
		out[i] = Math.round(0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]);
	}
	return out;
}

/** Mean luminance and clipped shares over the subject pixels the mask selects. */
export function exposureStats(rgba, mask) {
	let n = 0;
	let sum = 0;
	let high = 0;
	let low = 0;
	for (let i = 0; i < mask.length; i++) {
		if (mask[i] < THRESHOLDS.maskCutoff) continue;
		const l = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
		n++;
		sum += l;
		if (l >= 250) high++;
		if (l <= 5) low++;
	}
	if (!n) return { mean: 0, clippedHigh: 0, clippedLow: 0 };
	return { mean: sum / n, clippedHigh: high / n, clippedLow: low / n };
}

const MESSAGES = {
	no_subject: 'No clear subject was found. Photograph one object against a plain background.',
	subject_small: 'The subject is small in the frame. Move closer so it fills more of the photo.',
	blurry: 'The photo looks blurry. Hold steady or tap to focus, then retake it.',
	too_dark: 'The subject is too dark. Add light or move somewhere brighter.',
	overexposed: 'Parts of the subject are blown out. Move out of direct light or lower the exposure.',
	multiple_subjects: 'More than one object is in the photo. Keep only the one you want in 3D.',
	cut_off: 'The subject touches the edge of the photo, so part of it may be missing. Step back a little.',
};

/** Warnings, most serious first, each with a code and a plain-language message. */
export function assessPhoto(m) {
	const out = [];
	const add = (code) => out.push({ code, message: MESSAGES[code] });
	if (!m.components.length || m.coverage < THRESHOLDS.noSubjectCoverage) {
		add('no_subject');
		return out;
	}
	if (m.coverage < THRESHOLDS.minCoverage || m.subjectPx < THRESHOLDS.minSubjectPx) add('subject_small');
	if (m.sharpness < THRESHOLDS.minSharpness) add('blurry');
	if (m.exposure.mean < THRESHOLDS.darkMean) add('too_dark');
	if (m.exposure.clippedHigh > THRESHOLDS.maxClippedHigh) add('overexposed');
	if (m.components.length > 1 && m.components[1] >= m.components[0] * THRESHOLDS.secondSubjectRatio) add('multiple_subjects');
	if (m.touchesEdge) add('cut_off');
	return out;
}

/**
 * Whether this device runs the on-device pass, and on which execution
 * provider. Anything missing means the photo flow continues exactly as before
 * with a one-line note carrying `reason`.
 */
export function decideOnDevice(caps) {
	const skip = (reason) => ({ run: false, provider: null, reason });
	if (!caps.worker) return skip('This browser cannot run background workers.');
	if (!caps.wasm) return skip('This browser has no WebAssembly.');
	if (!caps.offscreenCanvas) return skip('This browser cannot draw images off screen.');
	if (!caps.createImageBitmap) return skip('This browser cannot decode images in a worker.');
	if (typeof caps.deviceMemory === 'number' && caps.deviceMemory < THRESHOLDS.minDeviceMemoryGb) {
		return skip('This device reports too little memory for the photo check.');
	}
	return { run: true, provider: caps.webgpu ? 'webgpu' : 'wasm', reason: null };
}

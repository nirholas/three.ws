/**
 * Sketch guards and drawing maths, shared by the drawing modal
 * (sketch-canvas.js) and both Forge pages' sketch uploaders.
 *
 * The TripoSG scribble model is conditioned on dark strokes over a light
 * background and nothing else. A blank canvas, a single dot or a canvas smeared
 * edge to edge gives it nothing to build from: it still takes a GPU slot and
 * minutes of the user's time, and returns a blob. `assessSketch` reads the
 * pixels on the device and says so up front, in words that name what to draw.
 * `guardSketchFile` puts that check in front of the upload, so a refused sketch
 * never reaches storage or a generation request.
 *
 * Everything here is pure except `sampleSource` and `decodeSketchFile`, which need a browser.
 */

export const SKETCH_GUARD_CODES = Object.freeze({
	empty: 'empty',
	dot: 'dot',
	fullFrame: 'full_frame',
	unreadable: 'unreadable',
});

const MESSAGES = Object.freeze({
	empty: 'There is nothing to build from yet. Draw the outline of one object with dark strokes on the light background.',
	dot: 'That is just a dot. Draw the outline of one object, big enough to show its shape.',
	full_frame:
		'Your drawing fills the whole frame. Draw one object with some empty space around it, in dark lines on a light background.',
	unreadable: 'That image could not be read. Try drawing again, or upload a PNG, JPG or WebP.',
});

// Ink is a pixel this much darker than the paper. Contrast, not a fixed grey,
// so a photographed drawing on grey paper is judged against its own paper.
const MIN_CONTRAST = 45;
// Paper is the median tone. A median this dark means most of the frame is ink
// (a solid fill, a black image), however it got there.
const MIN_PAPER_LUMA = 110;
// Fewer ink pixels than this is noise (compression specks, a stray pixel).
const MIN_INK_FRACTION = 0.0003;
const MIN_INK_PIXELS = 6;
// The longest side of the inked area, as a share of the frame's longest side,
// under which the drawing is a dot rather than a shape.
const MIN_EXTENT = 0.06;
// More than this share of the frame inked is a scribble over the whole canvas.
const MAX_INK_FRACTION = 0.3;

// Long side the pixels are reduced to before they are read. Stroke widths scale
// with it, so the thresholds above are fractions, never pixel counts.
export const GUARD_MAX_SIDE = 256;

function refusal(code, stats) {
	return { ok: false, code, message: MESSAGES[code], stats };
}

/**
 * Judge a drawing from its pixels.
 * @param {{data: Uint8ClampedArray, width: number, height: number}} img RGBA, as canvas.getImageData returns.
 * @returns {{ok: true, stats: object} | {ok: false, code: string, message: string, stats?: object}}
 */
export function assessSketch(img) {
	const width = img?.width | 0;
	const height = img?.height | 0;
	const data = img?.data;
	if (!data || width < 1 || height < 1 || data.length < width * height * 4) {
		return refusal(SKETCH_GUARD_CODES.unreadable);
	}
	const total = width * height;

	// Tone of every pixel over white paper, so transparent PNGs read as blank
	// instead of black (the worker flattens alpha onto white the same way).
	const luma = new Uint8Array(total);
	const histogram = new Uint32Array(256);
	for (let i = 0; i < total; i++) {
		const o = i * 4;
		const a = data[o + 3] / 255;
		const tone = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
		const v = Math.round(tone * a + 255 * (1 - a));
		luma[i] = v;
		histogram[v]++;
	}

	let seen = 0;
	let paper = 255;
	for (let v = 0; v < 256; v++) {
		seen += histogram[v];
		if (seen * 2 >= total) {
			paper = v;
			break;
		}
	}
	if (paper < MIN_PAPER_LUMA) return refusal(SKETCH_GUARD_CODES.fullFrame, { paper });

	const cutoff = paper - MIN_CONTRAST;
	let ink = 0;
	let minX = width;
	let minY = height;
	let maxX = -1;
	let maxY = -1;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (luma[y * width + x] < cutoff) {
				ink++;
				if (x < minX) minX = x;
				if (x > maxX) maxX = x;
				if (y < minY) minY = y;
				if (y > maxY) maxY = y;
			}
		}
	}

	const inkFraction = ink / total;
	const side = Math.max(width, height);
	const extent = ink ? Math.max(maxX - minX + 1, maxY - minY + 1) / side : 0;
	const stats = { paper, ink, inkFraction, extent };

	if (ink < MIN_INK_PIXELS || inkFraction < MIN_INK_FRACTION) {
		return refusal(SKETCH_GUARD_CODES.empty, stats);
	}
	if (inkFraction > MAX_INK_FRACTION) return refusal(SKETCH_GUARD_CODES.fullFrame, stats);
	if (extent < MIN_EXTENT) return refusal(SKETCH_GUARD_CODES.dot, stats);
	return { ok: true, stats };
}

/**
 * Read any drawable source (an ImageBitmap, a canvas) into the small RGBA buffer
 * `assessSketch` reads, scaled so its long side is at most GUARD_MAX_SIDE.
 * Browser only.
 * @param {CanvasImageSource & {width: number, height: number}} source
 */
export function sampleSource(source) {
	const scale = Math.min(1, GUARD_MAX_SIDE / Math.max(source.width, source.height));
	const width = Math.max(1, Math.round(source.width * scale));
	const height = Math.max(1, Math.round(source.height * scale));
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	ctx.imageSmoothingQuality = 'high';
	ctx.drawImage(source, 0, 0, width, height);
	return ctx.getImageData(0, 0, width, height);
}

/**
 * Decode an image file for `assessSketch`. Browser only. Honours EXIF rotation
 * so a sideways phone photo is read as it is shown.
 * @param {Blob} file
 */
export async function decodeSketchFile(file) {
	const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
	try {
		return sampleSource(bitmap);
	} finally {
		bitmap.close?.();
	}
}

/**
 * Check a drawing before it is uploaded. `upload` is called only for a drawing
 * that passes, and its result is returned unchanged. A refusal is
 * `{ok: false, code, message}` and `upload` is never called.
 *
 * An image this browser cannot decode is not refused here: the uploader's own
 * type and size checks and the worker's decoder remain the authority on
 * formats, and a guard that blocks what it merely cannot read would turn a
 * browser limitation into a failed sketch.
 */
export async function guardSketchFile(file, upload, { decode = decodeSketchFile } = {}) {
	let verdict = null;
	try {
		verdict = assessSketch(await decode(file));
	} catch {
		verdict = null;
	}
	if (verdict && !verdict.ok && verdict.code !== SKETCH_GUARD_CODES.unreadable) {
		return { ok: false, code: verdict.code, message: verdict.message };
	}
	return upload(file);
}

/**
 * Map a pointer position to the drawing surface's own coordinates. The canvas
 * draws in `logicalSize` units but is shown at whatever CSS size fits the
 * screen (it shrinks on a phone), so the offset into the element must be scaled
 * or every stroke lands left of and above the finger.
 * @returns {{x: number, y: number} | null} null when the element has no layout size.
 */
export function toCanvasPoint(clientX, clientY, rect, logicalSize) {
	if (!rect || !(rect.width > 0) || !(rect.height > 0)) return null;
	return {
		x: ((clientX - rect.left) * logicalSize) / rect.width,
		y: ((clientY - rect.top) * logicalSize) / rect.height,
	};
}

/**
 * Bounded undo history. Each entry is the whole state to go back to, including
 * whether it held any ink, so undoing a Clear brings back both the picture and
 * the right to send it.
 */
export function createUndoStack(limit = 20) {
	const entries = [];
	return {
		push(entry) {
			entries.push(entry);
			if (entries.length > limit) entries.shift();
		},
		pop() {
			return entries.pop() ?? null;
		},
		get size() {
			return entries.length;
		},
	};
}

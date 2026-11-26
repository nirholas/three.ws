// Turn whatever photo a person dropped into something the Forge lane can read,
// on their device, before anything is uploaded.
//
// normalizeForgeImage(file) resolves to one of two shapes. When ok is true, file
// is what to upload (the SAME File object when the photo was already fine, so a
// photo that worked before reaches the lane byte for byte unchanged) and note
// says what was done, or is null. When ok is false, code and message carry a
// refusal written for the person.
//
// The decision comes from src/shared/forge-image-intake.js (shared with the
// page-level dropzone and the server-side link import). This module only does
// the convert step: decode upright, shrink to CONVERT_MAX_SIDE, re-encode as JPEG
// (or WebP when the image has transparency), and step down until it fits the
// upload cap. HEIC is decoded by the browser where it can (Safari) and by the
// vendored libheif WebAssembly build everywhere else (public/vendor/libheif/).
//
// The codec is injectable so the same conversion logic runs under Node in tests
// (tests/forge-image-normalize.test.js drives it with a sharp-backed codec).

import {
	planIntake,
	HEADER_BYTES,
	UPLOAD_MAX_BYTES,
	CONVERT_MAX_SIDE,
	MIN_SIDE,
	UPLOAD_MIME,
	ACCEPTED_FORMATS_TEXT,
	formatLabel,
	tooSmallMessage,
} from './forge-image-intake.js';

/** Vector art has no pixel size of its own; rasterize it this large. */
const SVG_RASTER_SIDE = 2048;
const JPEG_QUALITY = 0.92;
const STEP_DOWN = 0.75;
const MAX_ENCODE_ATTEMPTS = 6;

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

function renamed(name, mime) {
	const base = String(name || 'photo').replace(/\.[^./\\]{1,8}$/, '') || 'photo';
	return `${base}.${EXT[mime] || 'jpg'}`;
}

function makeFile(blob, name, type) {
	if (typeof File === 'function') return new File([blob], name, { type, lastModified: Date.now() });
	const out = new Blob([blob], { type });
	Object.defineProperty(out, 'name', { value: name });
	return out;
}

function decodeFailedMessage(format) {
	const label = formatLabel(format);
	return `This browser could not open this ${label}, so it may be damaged or use a variant Forge cannot read. Open it on your device and export or share it as JPG, then try again.`;
}

function describeChanges(plan, from, to) {
	const parts = [];
	if (plan.reasons.includes('format')) parts.push(`converted from ${formatLabel(plan.format)}`);
	if (plan.reasons.includes('animated')) parts.push('used the first frame of the animation');
	if (plan.reasons.includes('orientation')) parts.push('turned upright');
	if (from.width && (to.width !== from.width || to.height !== from.height)) {
		parts.push(`resized from ${from.width} x ${from.height} to ${to.width} x ${to.height}`);
	} else if (plan.reasons.includes('bytes')) {
		parts.push('compressed to fit the 8 MB upload limit');
	}
	if (!parts.length) return null;
	const text = parts.join(', ');
	return text.charAt(0).toUpperCase() + text.slice(1) + '.';
}

/**
 * @param {File|Blob} file
 * @param {{ codec?: object }} [opts]
 * @returns {Promise<{ok:true,file:File|Blob,changed:boolean,note:string|null,plan:object}
 *                  |{ok:false,code:string,message:string,plan:object}>}
 */
export async function normalizeForgeImage(file, { codec } = {}) {
	const header = new Uint8Array(await file.slice(0, HEADER_BYTES).arrayBuffer());
	const plan = planIntake({ header, size: file.size, type: file.type, name: file.name });
	if (plan.action === 'refuse') return { ok: false, code: plan.code, message: plan.message, plan };
	if (plan.action === 'pass') {
		if (file.type === plan.mime) return { ok: true, file, changed: false, note: null, plan };
		// Right bytes, wrong label (a JPEG saved as .png, or no type at all): the
		// bytes go up unchanged; only the content type is corrected so storage and
		// the lane are told the truth.
		return { ok: true, file: makeFile(file, renamed(file.name, plan.mime), plan.mime), changed: false, note: null, plan };
	}

	const c = codec || browserCodec();
	let decoded;
	try {
		decoded = await c.decode(file, { format: plan.format, width: plan.width, height: plan.height, maxSide: CONVERT_MAX_SIDE });
	} catch {
		return { ok: false, code: 'decode_failed', message: decodeFailedMessage(plan.format), plan };
	}
	try {
		const { width, height } = decoded;
		if (!width || !height) return { ok: false, code: 'decode_failed', message: decodeFailedMessage(plan.format), plan };
		if (Math.min(width, height) < MIN_SIDE) return { ok: false, code: 'too_small', message: tooSmallMessage(width, height), plan };

		const alpha = plan.format !== 'jpeg' && (await c.hasAlpha(decoded.handle));
		let w = width;
		let h = height;
		for (let attempt = 0; attempt < MAX_ENCODE_ATTEMPTS; attempt++) {
			const blob = await c.encode(decoded.handle, {
				width: w,
				height: h,
				type: alpha ? 'image/webp' : 'image/jpeg',
				quality: JPEG_QUALITY,
			});
			// A browser without WebP encoding hands back PNG; anything else it
			// returns is not something the lane reads.
			const mime = Object.values(UPLOAD_MIME).includes(blob.type) ? blob.type : null;
			if (!mime) break;
			if (blob.size <= UPLOAD_MAX_BYTES) {
				const from = { width: plan.width || width, height: plan.height || height };
				return {
					ok: true,
					file: makeFile(blob, renamed(file.name, mime), mime),
					changed: true,
					note: describeChanges(plan, from, { width: w, height: h }),
					plan,
				};
			}
			w = Math.max(1, Math.round(w * STEP_DOWN));
			h = Math.max(1, Math.round(h * STEP_DOWN));
		}
		return {
			ok: false,
			code: 'encode_failed',
			message: `This photo could not be shrunk to fit the 8 MB upload limit on this device. Export it as a JPG under 8 MB (${ACCEPTED_FORMATS_TEXT} all work) and try again.`,
			plan,
		};
	} catch {
		return { ok: false, code: 'decode_failed', message: decodeFailedMessage(plan.format), plan };
	} finally {
		try {
			c.release(decoded.handle);
		} catch {
			/* releasing a canvas or bitmap cannot meaningfully fail */
		}
	}
}

function fitInside(width, height, maxSide) {
	const scale = Math.min(1, maxSide / Math.max(width, height));
	return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

function newCanvas(width, height) {
	if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
	const el = document.createElement('canvas');
	el.width = width;
	el.height = height;
	return el;
}

function draw(source, width, height) {
	const canvas = newCanvas(width, height);
	const ctx = canvas.getContext('2d');
	ctx.imageSmoothingEnabled = true;
	ctx.imageSmoothingQuality = 'high';
	ctx.drawImage(source, 0, 0, width, height);
	return canvas;
}

let libheifReady = null;
function loadLibheif() {
	if (!libheifReady) {
		const url = '/vendor/libheif/libheif-bundle.mjs';
		libheifReady = import(/* @vite-ignore */ url).then((m) => m.default());
		libheifReady.catch(() => {
			libheifReady = null;
		});
	}
	return libheifReady;
}

async function decodeHeicWithLibheif(blob) {
	const lib = await loadLibheif();
	const decoder = new lib.HeifDecoder();
	const images = decoder.decode(new Uint8Array(await blob.arrayBuffer()));
	if (!images?.length) throw new Error('heic: no images');
	const primary = images.find((img) => img.is_primary?.()) || images[0];
	try {
		const width = primary.get_width();
		const height = primary.get_height();
		const imageData = new ImageData(width, height);
		await new Promise((resolve, reject) => {
			primary.display(imageData, (out) => (out ? resolve() : reject(new Error('heic: decode failed'))));
		});
		const canvas = newCanvas(width, height);
		canvas.getContext('2d').putImageData(imageData, 0, 0);
		return canvas;
	} finally {
		for (const img of images) img.free?.();
	}
}

async function decodeSvg(blob) {
	const url = URL.createObjectURL(blob);
	try {
		const img = new Image();
		img.decoding = 'async';
		img.src = url;
		await img.decode();
		const w = img.naturalWidth || SVG_RASTER_SIDE;
		const h = img.naturalHeight || SVG_RASTER_SIDE;
		const scale = SVG_RASTER_SIDE / Math.max(w, h);
		const size = { width: Math.round(w * scale), height: Math.round(h * scale) };
		// Vector art usually has no background; keep it transparent so the lane
		// sees the shape, not a white box.
		return draw(img, size.width, size.height);
	} finally {
		URL.revokeObjectURL(url);
	}
}

/** The real codec: createImageBitmap + canvas, libheif for HEIC the browser cannot open. */
export function browserCodec() {
	return {
		async decode(blob, { format, maxSide }) {
			let source;
			if (format === 'svg') {
				source = await decodeSvg(blob);
			} else {
				try {
					source = await createImageBitmap(blob, { imageOrientation: 'from-image' });
				} catch (err) {
					if (format !== 'heic') throw err;
					source = await decodeHeicWithLibheif(blob);
				}
			}
			const size = fitInside(source.width, source.height, maxSide);
			const canvas = size.width === source.width && size.height === source.height && !('close' in source) ? source : draw(source, size.width, size.height);
			if (canvas !== source) {
				if (typeof source.close === 'function') source.close();
				else source.width = 0;
			}
			return { width: size.width, height: size.height, handle: canvas };
		},
		async hasAlpha(canvas) {
			const ctx = canvas.getContext('2d');
			const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
			for (let i = 3; i < data.length; i += 4) if (data[i] < 250) return true;
			return false;
		},
		async encode(canvas, { width, height, type, quality }) {
			const target = width === canvas.width && height === canvas.height ? canvas : draw(canvas, width, height);
			try {
				if (typeof target.convertToBlob === 'function') return await target.convertToBlob({ type, quality });
				return await new Promise((resolve, reject) =>
					target.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas encode failed'))), type, quality),
				);
			} finally {
				if (target !== canvas) target.width = 0;
			}
		},
		release(canvas) {
			canvas.width = 0;
		},
	};
}

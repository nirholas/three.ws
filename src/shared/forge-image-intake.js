// Forge photo intake: decide, from a file's own bytes, whether a photo can go to
// the reconstruction lane untouched, needs converting first, or cannot be used.
//
// Pure and DOM-free: the page (src/shared/forge-image-normalize.js, both /forge
// and Forge Studio), the page-level drop and paste handler
// (src/shared/forge-dropzone.js) and the server-side image-link import
// (api/forge-upload.js) all apply this one rule, so the three routes into Forge
// cannot disagree about what a photo is.
//
// Why content and not the file name: the browser's File.type comes from the
// extension. A PDF renamed .jpg reported image/jpeg, uploaded, and failed on the
// GPU; a HEIC from an iPhone reported image/heic (or nothing at all on Windows)
// and was refused even though it is the most common photo format on earth.
//
// The lane (workers/model-trellis) decodes PNG, JPEG and WebP only, ignores EXIF
// orientation, and is sent whatever bytes the person uploaded. So:
//   pass     PNG/JPEG/WebP, still, upright, within the upload cap and a sane size:
//            the original bytes go up unchanged (a photo that worked before this
//            rule existed reaches the lane byte for byte as it did then).
//   convert  any other decodable image (HEIC, AVIF, GIF, BMP, TIFF, SVG), an
//            animation, a rotated phone JPEG, or one too large in bytes or pixels:
//            the browser decodes it upright, downsizes, and re-encodes it as JPEG
//            (or WebP when it has transparency).
//   refuse   empty, not an image, or too small to reconstruct, with a message
//            that says what the file is and which formats work.

/** Matches ANON_UPLOAD_LIMITS['forge/uploads/'] in api/_lib/anon-upload-limits.js. */
export const UPLOAD_MAX_BYTES = 8 * 1024 * 1024;
/** Largest file the page will try to read and shrink on the device. */
export const MAX_INPUT_BYTES = 100 * 1024 * 1024;
/** Longest edge sent untouched. Pillow on the worker warns past ~89 MP; 8192² is 67 MP. */
export const PASS_MAX_SIDE = 8192;
/** Longest edge of a converted image. The lane conditions on 518 px; 4096 keeps every detail. */
export const CONVERT_MAX_SIDE = 4096;
/** Below this on the shorter side there is nothing to reconstruct. */
export const MIN_SIDE = 64;
/** How many leading bytes the planner reads. */
export const HEADER_BYTES = 512 * 1024;

export const ACCEPTED_FORMATS_TEXT = 'JPG, PNG, WebP, HEIC, AVIF or GIF';

/** What the upload endpoint and the lane accept, by format. */
export const UPLOAD_MIME = Object.freeze({ jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' });

const FORMAT_MIME = Object.freeze({
	jpeg: 'image/jpeg',
	png: 'image/png',
	webp: 'image/webp',
	gif: 'image/gif',
	avif: 'image/avif',
	heic: 'image/heic',
	bmp: 'image/bmp',
	tiff: 'image/tiff',
	svg: 'image/svg+xml',
});

const FORMAT_LABEL = Object.freeze({
	jpeg: 'JPG',
	png: 'PNG',
	webp: 'WebP',
	gif: 'GIF',
	avif: 'AVIF',
	heic: 'HEIC',
	bmp: 'BMP',
	tiff: 'TIFF',
	svg: 'SVG',
});

export function formatLabel(format) {
	return FORMAT_LABEL[format] || 'image';
}

export function formatMime(format) {
	return FORMAT_MIME[format] || 'application/octet-stream';
}

const ascii = (b, start, len) => {
	let s = '';
	for (let i = start; i < start + len && i < b.length; i++) s += String.fromCharCode(b[i]);
	return s;
};
const u16be = (b, o) => (b[o] << 8) | b[o + 1];
const u16le = (b, o) => b[o] | (b[o + 1] << 8);
const u24le = (b, o) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
const u32be = (b, o) => ((b[o] << 24) >>> 0) + ((b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]);
const u32le = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16)) + ((b[o + 3] << 24) >>> 0);

const HEIF_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'hevm', 'hevs']);
const AVIF_BRANDS = new Set(['avif', 'avis']);
const VIDEO_BRANDS = new Set(['isom', 'iso2', 'iso4', 'iso5', 'iso6', 'mp41', 'mp42', 'avc1', 'qt  ', 'M4V ', 'M4A ', 'm4v ', '3gp4', '3gp5', '3gp6', '3g2a', 'dash', 'MSNV', 'f4v ']);

function textStart(b) {
	let i = 0;
	if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) i = 3;
	while (i < b.length && (b[i] === 0x20 || b[i] === 0x09 || b[i] === 0x0a || b[i] === 0x0d)) i++;
	return ascii(b, i, 1024).toLowerCase();
}

/**
 * Identify a file by its leading bytes.
 * Returns { format } for an image format we know, { notImage: 'a PDF document' }
 * for a recognizable non-image, or { format: null, notImage: null } when unknown.
 */
export function sniffImage(b) {
	if (!b || b.length < 4) return { format: null, notImage: null };
	if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { format: 'jpeg' };
	if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { format: 'png' };
	if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') return { format: 'webp' };
	if (ascii(b, 0, 4) === 'RIFF') return { format: null, notImage: ascii(b, 8, 4) === 'AVI ' ? 'a video' : 'an audio file' };
	if (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a') return { format: 'gif' };
	if (b[0] === 0x42 && b[1] === 0x4d && b.length > 26) return { format: 'bmp' };
	if ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 0x2a)) {
		return { format: 'tiff' };
	}
	if (ascii(b, 4, 4) === 'ftyp') {
		const size = Math.min(u32be(b, 0), b.length);
		const brands = [ascii(b, 8, 4)];
		for (let o = 16; o + 4 <= size; o += 4) brands.push(ascii(b, o, 4));
		if (brands.some((x) => AVIF_BRANDS.has(x))) return { format: 'avif' };
		if (brands.some((x) => HEIF_BRANDS.has(x))) return { format: 'heic' };
		if (brands[0] === 'mif1' || brands[0] === 'msf1') return { format: 'heic' };
		if (brands.some((x) => VIDEO_BRANDS.has(x))) return { format: null, notImage: 'a video' };
		return { format: null, notImage: null };
	}
	if (ascii(b, 0, 5) === '%PDF-') return { format: null, notImage: 'a PDF document' };
	if (b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07)) return { format: null, notImage: 'a ZIP archive' };
	if (ascii(b, 0, 4) === 'glTF') return { format: null, notImage: 'a 3D model (GLB)' };
	if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return { format: null, notImage: 'a video' };
	if (ascii(b, 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return { format: null, notImage: 'an audio file' };
	const text = textStart(b);
	if (text.startsWith('<svg') || (text.startsWith('<?xml') && text.includes('<svg'))) return { format: 'svg' };
	if (text.startsWith('<!doctype html') || text.startsWith('<html')) return { format: null, notImage: 'a web page' };
	return { format: null, notImage: null };
}

/** EXIF orientation (1..8) from a JPEG APP1 segment's TIFF block, or null. */
function exifOrientation(b, start, end) {
	if (ascii(b, start, 6) !== 'Exif\0\0') return null;
	const t = start + 6;
	const le = b[t] === 0x49 && b[t + 1] === 0x49;
	const r16 = (o) => (le ? u16le(b, o) : u16be(b, o));
	const r32 = (o) => (le ? u32le(b, o) : u32be(b, o));
	if (r16(t + 2) !== 42) return null;
	const ifd = t + r32(t + 4);
	if (ifd + 2 > end) return null;
	const count = r16(ifd);
	for (let i = 0; i < count; i++) {
		const e = ifd + 2 + i * 12;
		if (e + 12 > end) break;
		if (r16(e) === 0x0112) {
			const v = r16(e + 8);
			return v >= 1 && v <= 8 ? v : null;
		}
	}
	return null;
}

function jpegInfo(b) {
	const out = { width: null, height: null, orientation: null };
	let o = 2;
	while (o + 4 <= b.length) {
		if (b[o] !== 0xff) {
			o++;
			continue;
		}
		const marker = b[o + 1];
		if (marker === 0xff) {
			o++;
			continue;
		}
		if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
			o += 2;
			continue;
		}
		if (marker === 0xda || marker === 0xd9) break;
		const len = u16be(b, o + 2);
		if (len < 2) break;
		if (marker === 0xe1 && out.orientation == null) out.orientation = exifOrientation(b, o + 4, Math.min(b.length, o + 2 + len));
		const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
		if (isSof && o + 9 <= b.length) {
			out.height = u16be(b, o + 5);
			out.width = u16be(b, o + 7);
			break;
		}
		o += 2 + len;
	}
	return out;
}

function pngInfo(b) {
	const out = { width: b.length >= 24 ? u32be(b, 16) : null, height: b.length >= 24 ? u32be(b, 20) : null, animated: false };
	let o = 8;
	while (o + 8 <= b.length) {
		const len = u32be(b, o);
		const type = ascii(b, o + 4, 4);
		if (type === 'acTL') {
			out.animated = b.length >= o + 12 && u32be(b, o + 8) > 1;
			break;
		}
		if (type === 'IDAT' || type === 'IEND') break;
		o += 12 + len;
	}
	return out;
}

function webpInfo(b) {
	const out = { width: null, height: null, animated: false };
	const chunk = ascii(b, 12, 4);
	if (chunk === 'VP8 ' && b.length >= 30) {
		out.width = u16le(b, 26) & 0x3fff;
		out.height = u16le(b, 28) & 0x3fff;
	} else if (chunk === 'VP8L' && b.length >= 25) {
		const bits = u32le(b, 21);
		out.width = (bits & 0x3fff) + 1;
		out.height = ((bits >>> 14) & 0x3fff) + 1;
	} else if (chunk === 'VP8X' && b.length >= 30) {
		out.animated = (b[20] & 0x02) !== 0;
		out.width = u24le(b, 24) + 1;
		out.height = u24le(b, 27) + 1;
	}
	return out;
}

function gifInfo(b) {
	const out = { width: u16le(b, 6), height: u16le(b, 8), animated: false };
	let o = 13;
	if (b[10] & 0x80) o += 3 * (1 << ((b[10] & 0x07) + 1));
	let frames = 0;
	while (o < b.length) {
		const block = b[o];
		if (block === 0x3b) break;
		if (block === 0x21) {
			o += 2;
			while (o < b.length && b[o] !== 0) o += b[o] + 1;
			o++;
		} else if (block === 0x2c) {
			if (++frames > 1) {
				out.animated = true;
				break;
			}
			const packed = b[o + 9];
			o += 10;
			if (packed & 0x80) o += 3 * (1 << ((packed & 0x07) + 1));
			o++; // LZW minimum code size
			while (o < b.length && b[o] !== 0) o += b[o] + 1;
			o++;
		} else {
			break;
		}
	}
	return out;
}

function bmpInfo(b) {
	const h = u32le(b, 22) | 0;
	return { width: u32le(b, 18) | 0, height: Math.abs(h) };
}

// The primary image of a HEIF/AVIF is the largest `ispe` (thumbnails are smaller).
function heifInfo(b) {
	let width = null;
	let height = null;
	for (let i = 4; i + 16 <= b.length; i++) {
		if (b[i] === 0x69 && b[i + 1] === 0x73 && b[i + 2] === 0x70 && b[i + 3] === 0x65) {
			const w = u32be(b, i + 8);
			const h = u32be(b, i + 12);
			if (w > 0 && h > 0 && w <= 65535 && h <= 65535 && (!width || w * h > width * height)) {
				width = w;
				height = h;
			}
		}
	}
	return { width, height };
}

function svgInfo(b) {
	const text = ascii(b, 0, 4096);
	const tag = /<svg\b[^>]*>/i.exec(text)?.[0] || '';
	const num = (attr) => {
		const m = new RegExp(`\\b${attr}\\s*=\\s*["']\\s*([0-9.]+)(px)?\\s*["']`, 'i').exec(tag);
		return m ? Math.round(Number(m[1])) : null;
	};
	return { width: num('width'), height: num('height') };
}

/** Width, height, EXIF orientation and animation, as far as the header shows them. */
export function readImageInfo(b, format) {
	switch (format) {
		case 'jpeg':
			return { ...jpegInfo(b), animated: false };
		case 'png':
			return { ...pngInfo(b), orientation: null };
		case 'webp':
			return { ...webpInfo(b), orientation: null };
		case 'gif':
			return { ...gifInfo(b), orientation: null };
		case 'bmp':
			return { ...bmpInfo(b), orientation: null, animated: false };
		case 'heic':
		case 'avif':
			return { ...heifInfo(b), orientation: null, animated: false };
		case 'svg':
			return { ...svgInfo(b), orientation: null, animated: false };
		default:
			return { width: null, height: null, orientation: null, animated: false };
	}
}

const formatBytes = (n) => (n >= 1024 * 1024 ? `${Math.round(n / (1024 * 1024))} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** The refusal copy for a file that is not an image, shared with the URL import. */
export function notImageMessage(notImage) {
	return notImage
		? `That file is ${notImage}, not an image. Use a photo saved as ${ACCEPTED_FORMATS_TEXT}.`
		: `That file is not an image Forge can read. Use a photo saved as ${ACCEPTED_FORMATS_TEXT}.`;
}

export function tooSmallMessage(width, height) {
	return `This image is only ${width} x ${height} pixels, too small to build a model from. Use a photo at least ${MIN_SIDE} pixels on each side; 1024 or more works best.`;
}

/**
 * Decide what happens to one file.
 *
 *   planIntake({ header: Uint8Array (first HEADER_BYTES), size, type?, name? })
 *   → { action: 'pass'|'convert'|'refuse', format, mime, width, height,
 *       orientation, animated, reasons: [...], code?, message? }
 *
 * `reasons` (convert only): 'format' (not PNG/JPEG/WebP), 'animated',
 * 'orientation' (EXIF rotation the lane would ignore), 'bytes' (over the upload
 * cap), 'dimensions' (longer edge over PASS_MAX_SIDE, or unknown).
 */
export function planIntake({ header, size }) {
	const refuse = (code, message, extra = {}) => ({ action: 'refuse', code, message, reasons: [], ...extra });
	if (!size) {
		return refuse('empty', 'This file is empty (0 bytes), so there is no photo in it. Pick the photo again, or export a fresh copy.');
	}
	const sniff = sniffImage(header);
	if (!sniff.format) return refuse('not_image', notImageMessage(sniff.notImage));
	const format = sniff.format;
	if (size > MAX_INPUT_BYTES) {
		return refuse(
			'too_large',
			`This ${formatLabel(format)} is ${formatBytes(size)}, more than the ${formatBytes(MAX_INPUT_BYTES)} this page can prepare. Export a smaller copy (under 20 MB is plenty) and try again.`,
			{ format },
		);
	}
	const info = readImageInfo(header, format);
	const swap = info.orientation >= 5 && info.orientation <= 8;
	const width = swap ? info.height : info.width;
	const height = swap ? info.width : info.height;
	if (width && height && Math.min(width, height) < MIN_SIDE) {
		return refuse('too_small', tooSmallMessage(width, height), { format, width, height });
	}
	const reasons = [];
	if (!UPLOAD_MIME[format]) reasons.push('format');
	if (info.animated) reasons.push('animated');
	if (info.orientation && info.orientation !== 1) reasons.push('orientation');
	if (size > UPLOAD_MAX_BYTES) reasons.push('bytes');
	if (UPLOAD_MIME[format] && (!width || !height || Math.max(width, height) > PASS_MAX_SIDE)) reasons.push('dimensions');
	return {
		action: reasons.length ? 'convert' : 'pass',
		format,
		mime: formatMime(format),
		width: width || null,
		height: height || null,
		orientation: info.orientation || null,
		animated: Boolean(info.animated),
		reasons,
	};
}

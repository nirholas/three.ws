// Pure helpers for a user's own 360 photo used as a viewer environment.
//
// Nothing here touches three.js, the DOM or the network, so every rule (what
// counts as a 360 photo, how large a texture may be, which colour space a format
// decodes into, what `?env=` means) is unit-testable and shared by the viewer,
// `/splat` and the `<agent-3d>` element.

/** Largest equirect width decoded on desktop and on a phone or tablet. */
export const DESKTOP_MAX_WIDTH = 8192;
export const MOBILE_MAX_WIDTH = 4096;

/** Largest file the picker accepts. A 72 MP JPEG is about 25 MB; EXR can be far bigger. */
export const MAX_PANO_BYTES = 512 * 1024 * 1024;

/** Accepted containers, in the order the file picker lists them. */
export const PANO_ACCEPT = 'image/jpeg,image/png,image/webp,image/avif,.jpg,.jpeg,.png,.webp,.avif,.exr,.hdr';

export const PANO_MESSAGES = Object.freeze({
	notEquirect: "This isn't a 360 photo. Export an equirectangular 2:1 image from your camera app.",
	cors: "That image's host doesn't allow other sites to use it. Download it and drop the file here instead.",
	unsupported: 'That file type is not supported. Use a JPEG, PNG, WebP, AVIF, EXR or Radiance HDR image.',
	unreadable: 'That image could not be read. It may be corrupt or cut short. Export it again and retry.',
	tooLarge: 'That file is larger than 512 MB. Export a smaller 2:1 JPEG (8192 x 4096 is plenty) and retry.',
	badUrl: 'Enter a full https:// link to an equirectangular image.',
	http: 'That link is not reachable. Check the address and your connection, then retry.',
	decode: 'This browser could not decode that image. Try a JPEG export of the same photo.',
});

/** An error whose `code` selects one of {@link PANO_MESSAGES}. */
export class PanoError extends Error {
	constructor(code, message) {
		super(message || PANO_MESSAGES[code] || code);
		this.name = 'PanoError';
		this.code = code;
	}
}

const ascii = (bytes, at, text) => {
	for (let i = 0; i < text.length; i++) if (bytes[at + i] !== text.charCodeAt(i)) return false;
	return true;
};

/**
 * Identify an image container from its first bytes. Extensions lie (a camera app
 * renames, a CDN re-encodes), so the magic bytes win.
 * @param {Uint8Array} bytes at least the first 32 bytes of the file
 * @returns {'jpeg'|'png'|'webp'|'avif'|'exr'|'hdr'|null}
 */
export function sniffPanoFormat(bytes) {
	if (!bytes || bytes.length < 12) return null;
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
	if (bytes[0] === 0x89 && ascii(bytes, 1, 'PNG')) return 'png';
	if (ascii(bytes, 0, 'RIFF') && ascii(bytes, 8, 'WEBP')) return 'webp';
	if (ascii(bytes, 4, 'ftyp') && (ascii(bytes, 8, 'avif') || ascii(bytes, 8, 'avis'))) return 'avif';
	if (bytes[0] === 0x76 && bytes[1] === 0x2f && bytes[2] === 0x31 && bytes[3] === 0x01) return 'exr';
	if (ascii(bytes, 0, '#?RADIANCE') || ascii(bytes, 0, '#?RGBE')) return 'hdr';
	return null;
}

/**
 * Colour handling per format. LDR formats carry sRGB-encoded values and must be
 * tagged so three.js decodes them to linear on sampling. HDR and EXR already hold
 * linear radiance and must stay untouched.
 * @returns {{ colorSpace: 'srgb'|'srgb-linear', hdr: boolean }}
 */
export function colorSpaceForFormat(format) {
	if (format === 'exr' || format === 'hdr') return { colorSpace: 'srgb-linear', hdr: true };
	return { colorSpace: 'srgb', hdr: false };
}

const u16be = (b, i) => (b[i] << 8) | b[i + 1];
const u32be = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const u32le = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

function jpegSize(b) {
	let i = 2;
	while (i + 9 < b.length) {
		if (b[i] !== 0xff) { i++; continue; }
		const marker = b[i + 1];
		if (marker === 0xff) { i++; continue; }
		if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
		const len = u16be(b, i + 2);
		const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
		if (isSof) return { width: u16be(b, i + 7), height: u16be(b, i + 5) };
		i += 2 + len;
	}
	return null;
}

function webpSize(b) {
	const chunk = String.fromCharCode(b[12], b[13], b[14], b[15]);
	if (chunk === 'VP8X') {
		const w = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
		const h = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
		return { width: w, height: h };
	}
	if (chunk === 'VP8 ') {
		return { width: (b[26] | (b[27] << 8)) & 0x3fff, height: (b[28] | (b[29] << 8)) & 0x3fff };
	}
	if (chunk === 'VP8L' && b[20] === 0x2f) {
		const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
		return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
	}
	return null;
}

function avifSize(b) {
	for (let i = 0; i + 20 < b.length; i++) {
		if (ascii(b, i, 'ispe')) return { width: u32be(b, i + 8), height: u32be(b, i + 12) };
	}
	return null;
}

function hdrSize(b) {
	const head = String.fromCharCode(...b.subarray(0, Math.min(b.length, 512)));
	const m = head.match(/[-+]Y\s+(\d+)\s+[-+]X\s+(\d+)/);
	return m ? { width: Number(m[2]), height: Number(m[1]) } : null;
}

function exrSize(b) {
	let i = 8;
	const readName = () => {
		const start = i;
		while (i < b.length && b[i] !== 0) i++;
		const s = String.fromCharCode(...b.subarray(start, i));
		i++;
		return s;
	};
	while (i < b.length && b[i] !== 0) {
		const name = readName();
		readName();
		const size = u32le(b, i);
		i += 4;
		if (name === 'dataWindow' && size === 16) {
			const xmin = u32le(b, i) | 0;
			const ymin = u32le(b, i + 4) | 0;
			const xmax = u32le(b, i + 8) | 0;
			const ymax = u32le(b, i + 12) | 0;
			return { width: xmax - xmin + 1, height: ymax - ymin + 1 };
		}
		i += size;
	}
	return null;
}

/**
 * Pixel size of an image read from its header alone, so a 72 MP photo can be
 * rejected (or scheduled for a downscaled decode) without ever being decoded at
 * full size.
 * @param {Uint8Array} bytes the first 256 KB of the file is enough for every format
 * @returns {{ format: string, width: number, height: number } | null}
 */
export function readPanoHeader(bytes) {
	const format = sniffPanoFormat(bytes);
	if (!format) return null;
	let size = null;
	try {
		if (format === 'jpeg') size = jpegSize(bytes);
		else if (format === 'png') size = { width: u32be(bytes, 16), height: u32be(bytes, 20) };
		else if (format === 'webp') size = webpSize(bytes);
		else if (format === 'avif') size = avifSize(bytes);
		else if (format === 'hdr') size = hdrSize(bytes);
		else if (format === 'exr') size = exrSize(bytes);
	} catch {
		size = null;
	}
	if (!size || !(size.width > 0) || !(size.height > 0)) return null;
	return { format, ...size };
}

/** A 360 photo is equirectangular: exactly 2:1, give or take one pixel of rounding. */
export function isEquirectSize(width, height) {
	if (!(width > 0) || !(height > 0)) return false;
	return Math.abs(width / 2 - height) <= 1;
}

/**
 * Largest 2:1 size to decode a photo at: never above the GPU's texture limit,
 * never above 8192x4096 (desktop) or 4096x2048 (mobile), never an upscale.
 * @returns {{ width: number, height: number, scaled: boolean }}
 */
export function clampEquirectSize(srcWidth, srcHeight, { maxTextureSize = 4096, mobile = false } = {}) {
	const cap = Math.min(mobile ? MOBILE_MAX_WIDTH : DESKTOP_MAX_WIDTH, Math.floor(maxTextureSize) || MOBILE_MAX_WIDTH);
	let width = Math.min(Math.floor(srcWidth), cap);
	width -= width % 2;
	const height = width / 2;
	return { width, height, scaled: width < srcWidth };
}

/** Phones and tablets: touch-first devices get the smaller cap. */
export function isMobileDevice(env = globalThis) {
	try {
		const coarse = env.matchMedia?.('(pointer: coarse)')?.matches;
		const touch = (env.navigator?.maxTouchPoints || 0) > 0;
		const ua = /Android|iPhone|iPad|iPod|Mobile/i.test(env.navigator?.userAgent || '');
		return Boolean((coarse && touch) || ua);
	} catch {
		return false;
	}
}

/**
 * Meaning of an `?env=` value or an `<agent-3d environment="">` attribute.
 * A preset id or name selects a curated environment; an https URL names a 360
 * photo. Anything else (http, javascript:, data:) is rejected, never fetched.
 * @returns {{ kind: 'none' } | { kind: 'url', url: string } | { kind: 'preset', value: string } | { kind: 'invalid', reason: string }}
 */
export function parseEnvParam(value) {
	const raw = String(value ?? '').trim();
	if (!raw) return { kind: 'none' };
	if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
		let url;
		try {
			url = new URL(raw);
		} catch {
			return { kind: 'invalid', reason: PANO_MESSAGES.badUrl };
		}
		if (url.protocol !== 'https:') return { kind: 'invalid', reason: PANO_MESSAGES.badUrl };
		return { kind: 'url', url: url.href };
	}
	return { kind: 'preset', value: raw };
}

/** Defaults for the sliders and switches. */
export const PANO_DEFAULTS = Object.freeze({
	lighting: true,
	lightingIntensity: 1,
	rotation: 0,
	background: true,
	blur: 0,
	backgroundIntensity: 1,
	brighten: true,
	brightenStrength: 0.6,
	groundOffset: 0,
});

/** Slider ranges, shared by the panel markup and the setter that clamps. */
export const PANO_RANGES = Object.freeze({
	lightingIntensity: { min: 0, max: 3, step: 0.05 },
	rotation: { min: 0, max: 360, step: 1 },
	blur: { min: 0, max: 1, step: 0.01 },
	backgroundIntensity: { min: 0, max: 2, step: 0.05 },
	brightenStrength: { min: 0, max: 1, step: 0.05 },
	groundOffset: { min: -1, max: 1, step: 0.01 },
});

/** Clamp one setting to its range; booleans pass through. Returns undefined for unknown keys. */
export function normalizeSetting(key, value) {
	if (typeof PANO_DEFAULTS[key] === 'boolean') return Boolean(value);
	const range = PANO_RANGES[key];
	if (!range) return undefined;
	const n = Number(value);
	if (!Number.isFinite(n)) return PANO_DEFAULTS[key];
	return Math.min(range.max, Math.max(range.min, n));
}

/**
 * Strength 0..1 of the LDR highlight expansion to the multiplier applied to the
 * brightest pixels. A clipped sun (value 1.0) becomes `1 + gain` times brighter.
 */
export function brightenGain(strength) {
	return Math.min(1, Math.max(0, Number(strength) || 0)) * 24;
}

/** The storage key: one per page, so the viewer and /splat remember independently. */
export function panoStorageKey(pathname = '/') {
	return `three.ws:pano-env:${pathname.replace(/\/+$/, '') || '/'}`;
}

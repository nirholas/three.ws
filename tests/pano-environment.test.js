import { describe, it, expect } from 'vitest';
import {
	DESKTOP_MAX_WIDTH,
	MOBILE_MAX_WIDTH,
	PANO_MESSAGES,
	brightenGain,
	clampEquirectSize,
	colorSpaceForFormat,
	isEquirectSize,
	isMobileDevice,
	normalizeSetting,
	panoStorageKey,
	parseEnvParam,
	readPanoHeader,
	sniffPanoFormat,
} from '../src/viewer/pano-photo.js';

const pad = (arr, to = 64) => Uint8Array.from([...arr, ...new Array(Math.max(0, to - arr.length)).fill(0)]);
const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const text = (s) => [...s].map((c) => c.charCodeAt(0));

const jpeg = (w, h) => pad([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, (h >> 8) & 255, h & 255, (w >> 8) & 255, w & 255, 3]);
const png = (w, h) => pad([0x89, ...text('PNG'), 13, 10, 26, 10, 0, 0, 0, 13, ...text('IHDR'), ...be32(w), ...be32(h)]);
const hdr = (w, h) => pad([...text(`#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${h} +X ${w}\n`)], 128);
const exr = (w, h) =>
	pad(
		[
			0x76, 0x2f, 0x31, 0x01, 2, 0, 0, 0,
			...text('dataWindow'), 0, ...text('box2i'), 0, ...le32(16),
			...le32(0), ...le32(0), ...le32(w - 1), ...le32(h - 1),
			0,
		],
		96,
	);

describe('format sniffing and header size', () => {
	it('reads width and height from each container without decoding', () => {
		expect(readPanoHeader(jpeg(11968, 5984))).toMatchObject({ format: 'jpeg', width: 11968, height: 5984 });
		expect(readPanoHeader(png(8192, 4096))).toMatchObject({ format: 'png', width: 8192, height: 4096 });
		expect(readPanoHeader(hdr(4096, 2048))).toMatchObject({ format: 'hdr', width: 4096, height: 2048 });
		expect(readPanoHeader(exr(2048, 1024))).toMatchObject({ format: 'exr', width: 2048, height: 1024 });
	});

	it('rejects bytes that are not an image', () => {
		expect(sniffPanoFormat(pad(text('<html>not an image</html>')))).toBe(null);
		expect(readPanoHeader(new Uint8Array(4))).toBe(null);
	});
});

describe('2:1 validation', () => {
	it('accepts true equirectangular sizes, with a pixel of rounding slack', () => {
		expect(isEquirectSize(11968, 5984)).toBe(true);
		expect(isEquirectSize(6528, 3264)).toBe(true);
		expect(isEquirectSize(4097, 2048)).toBe(true);
	});

	it('rejects flat photos and panoramas that are not 360 by 180', () => {
		expect(isEquirectSize(4000, 3000)).toBe(false);
		expect(isEquirectSize(8000, 2000)).toBe(false);
		expect(isEquirectSize(0, 0)).toBe(false);
	});

	it('has the designed message for the rejection', () => {
		expect(PANO_MESSAGES.notEquirect).toBe("This isn't a 360 photo. Export an equirectangular 2:1 image from your camera app.");
	});
});

describe('decode size clamp', () => {
	it('caps a 72 MP photo at 8192 wide on desktop and 4096 on mobile', () => {
		expect(clampEquirectSize(11968, 5984, { maxTextureSize: 16384 })).toEqual({ width: DESKTOP_MAX_WIDTH, height: 4096, scaled: true });
		expect(clampEquirectSize(11968, 5984, { maxTextureSize: 16384, mobile: true })).toEqual({ width: MOBILE_MAX_WIDTH, height: 2048, scaled: true });
	});

	it('never exceeds the GPU texture limit', () => {
		expect(clampEquirectSize(11968, 5984, { maxTextureSize: 4096 }).width).toBe(4096);
		expect(clampEquirectSize(11968, 5984, { maxTextureSize: 2048 }).width).toBe(2048);
	});

	it('never upscales a small photo', () => {
		expect(clampEquirectSize(2048, 1024, { maxTextureSize: 16384 })).toEqual({ width: 2048, height: 1024, scaled: false });
	});

	it('always returns an even width at exactly 2:1', () => {
		const out = clampEquirectSize(6527, 3263, { maxTextureSize: 4096 });
		expect(out.width % 2).toBe(0);
		expect(out.height * 2).toBe(out.width);
	});

	it('detects touch-first devices', () => {
		expect(isMobileDevice({ matchMedia: () => ({ matches: true }), navigator: { maxTouchPoints: 5, userAgent: '' } })).toBe(true);
		expect(isMobileDevice({ matchMedia: () => ({ matches: false }), navigator: { maxTouchPoints: 0, userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' } })).toBe(false);
		expect(isMobileDevice({ navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' } })).toBe(true);
	});
});

describe('?env= and the environment attribute', () => {
	it('treats an https URL as a photo source', () => {
		expect(parseEnvParam('https://example.com/a b.jpg')).toEqual({ kind: 'url', url: 'https://example.com/a%20b.jpg' });
	});

	it('treats a bare word as a preset name', () => {
		expect(parseEnvParam('venice-sunset')).toEqual({ kind: 'preset', value: 'venice-sunset' });
	});

	it('is empty for blank values', () => {
		expect(parseEnvParam('')).toEqual({ kind: 'none' });
		expect(parseEnvParam(null)).toEqual({ kind: 'none' });
	});

	it('rejects non-https schemes and never lets them reach fetch', () => {
		for (const bad of ['http://example.com/a.jpg', 'javascript:alert(1)', 'data:image/png;base64,AAAA', 'file:///etc/passwd']) {
			expect(parseEnvParam(bad).kind).toBe('invalid');
		}
	});
});

describe('colour space per format', () => {
	it('decodes LDR formats as sRGB', () => {
		for (const f of ['jpeg', 'png', 'webp', 'avif']) expect(colorSpaceForFormat(f)).toEqual({ colorSpace: 'srgb', hdr: false });
	});

	it('keeps EXR and Radiance HDR linear', () => {
		for (const f of ['exr', 'hdr']) expect(colorSpaceForFormat(f)).toEqual({ colorSpace: 'srgb-linear', hdr: true });
	});
});

describe('settings', () => {
	it('clamps sliders to their ranges and passes switches through', () => {
		expect(normalizeSetting('rotation', 720)).toBe(360);
		expect(normalizeSetting('blur', -2)).toBe(0);
		expect(normalizeSetting('backgroundIntensity', 9)).toBe(2);
		expect(normalizeSetting('lighting', 0)).toBe(false);
		expect(normalizeSetting('nope', 1)).toBeUndefined();
	});

	it('falls back to the default for a non-number', () => {
		expect(normalizeSetting('blur', 'abc')).toBe(0);
	});

	it('maps strength to a bounded highlight gain', () => {
		expect(brightenGain(0)).toBe(0);
		expect(brightenGain(1)).toBe(24);
		expect(brightenGain(5)).toBe(24);
	});

	it('remembers one URL per page', () => {
		expect(panoStorageKey('/splat/')).toBe('three.ws:pano-env:/splat');
		expect(panoStorageKey('/app')).not.toBe(panoStorageKey('/splat'));
	});
});

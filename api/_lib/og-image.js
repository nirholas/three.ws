// Social-card renderer: JSX-shaped element tree → 1200x630 PNG, as a Web
// Response. Drop-in for the `ImageResponse` the OG routes used to take from
// @vercel/og.
//
// Why not @vercel/og: every 0.x release bundles satori < 0.33.5, which carries
// GHSA advisories, and the only release on a patched satori (1.0.3) bundles an
// emscripten loader that calls `require("fs")` from inside an ES module, so it
// throws "Dynamic require of fs is not supported" on our plain-Node ESM server.
// Rendering with satori (patched, a direct dependency) and sharp (already used
// by @vercel/og on Node, external in the API bundle) keeps the output identical
// in shape: same default size, same default font family, same emoji and
// non-Latin fallbacks, same headers.

import satori from 'satori';
import sharp from 'sharp';
import { readFileSync } from 'node:fs';

const DEFAULT_FONTS = [
	{
		name: 'geist',
		data: readFileSync(new URL('./fonts/Geist-Regular.ttf', import.meta.url)),
		weight: 400,
		style: 'normal',
	},
];

// Twemoji SVGs, the same set and version @vercel/og defaulted to.
const TWEMOJI_BASE = 'https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/svg/';

// satori's language codes → the Google Fonts family that covers them.
const LANGUAGE_FONTS = {
	'ja-JP': ['Noto+Sans+JP'],
	'ko-KR': ['Noto+Sans+KR'],
	'zh-CN': ['Noto+Sans+SC'],
	'zh-TW': ['Noto+Sans+TC'],
	'zh-HK': ['Noto+Sans+HK'],
	'th-TH': ['Noto+Sans+Thai'],
	'bn-IN': ['Noto+Sans+Bengali'],
	'ar-AR': ['Noto+Sans+Arabic'],
	'ta-IN': ['Noto+Sans+Tamil'],
	'ml-IN': ['Noto+Sans+Malayalam'],
	'he-IL': ['Noto+Sans+Hebrew'],
	'te-IN': ['Noto+Sans+Telugu'],
	devanagari: ['Noto+Sans+Devanagari'],
	kannada: ['Noto+Sans+Kannada'],
	symbol: ['Noto+Sans+Symbols', 'Noto+Sans+Symbols+2'],
	math: ['Noto+Sans+Math'],
	unknown: ['Noto+Sans'],
};

// Google Fonts serves TTF (which satori can parse) only to older user agents.
const TTF_USER_AGENT =
	'Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10_6_8; de-at) AppleWebKit/533.21.1 (KHTML, like Gecko) Version/5.0.5 Safari/533.21.1';

const FETCH_TIMEOUT_MS = 5000;

// Twemoji file names are the code points in hex joined by "-", with the
// variation selector dropped unless the sequence is a ZWJ composite.
export function twemojiCode(text) {
	const chars = text.includes('\u200d') ? text : text.replace(/\ufe0f/g, '');
	return [...chars].map((c) => c.codePointAt(0).toString(16)).join('-');
}

async function fetchOk(url, init) {
	const res = await fetch(url, { ...init, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
	if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
	return res;
}

async function loadEmoji(text) {
	const svg = await (await fetchOk(TWEMOJI_BASE + twemojiCode(text) + '.svg')).text();
	return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}

// One subset font per family, cut to exactly the glyphs this card needs.
async function loadGoogleFont(family, text) {
	const css = await (
		await fetchOk(`https://fonts.googleapis.com/css2?family=${family}&text=${encodeURIComponent(text)}`, {
			headers: { 'user-agent': TTF_USER_AGENT },
		})
	).text();
	const src = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/);
	if (!src) throw new Error(`no TTF source for ${family}`);
	return (await fetchOk(src[1])).arrayBuffer();
}

async function loadAsset(code, text) {
	if (code === 'emoji') return loadEmoji(text);
	const codes = code.split('|');
	const fonts = [];
	for (const lang of codes) {
		for (const family of LANGUAGE_FONTS[lang] || []) {
			fonts.push(
				loadGoogleFont(family, text).then((data) => ({
					name: `satori_${lang}_fallback_${family}`,
					data,
					weight: 400,
					style: 'normal',
					lang: lang === 'unknown' ? undefined : lang,
				})),
			);
		}
	}
	// A family Google cannot subset for this text simply does not join the
	// fallback chain; the glyph renders as tofu rather than failing the card.
	const settled = await Promise.allSettled(fonts);
	for (const r of settled) if (r.status === 'rejected') console.warn('[og-image] fallback font:', r.reason?.message);
	return settled.filter((r) => r.status === 'fulfilled').map((r) => r.value);
}

// Assets are immutable for a given (code, text), so they are cached for the
// life of the process; failed loads are evicted so the next render retries.
const assetCache = new Map();
function loadAdditionalAsset(code, text) {
	const key = code + '\u0000' + text;
	let pending = assetCache.get(key);
	if (!pending) {
		pending = loadAsset(code, text).catch((err) => {
			assetCache.delete(key);
			console.warn('[og-image] asset', code, err.message);
			return code === 'emoji' ? undefined : [];
		});
		assetCache.set(key, pending);
	}
	return pending;
}

export async function renderPng(element, options = {}) {
	const width = options.width ?? 1200;
	const height = options.height ?? 630;
	const svg = await satori(element, {
		width,
		height,
		debug: options.debug ?? false,
		fonts: options.fonts || DEFAULT_FONTS,
		loadAdditionalAsset,
	});
	return sharp(Buffer.from(svg)).resize(width).png().toBuffer();
}

export class ImageResponse extends Response {
	constructor(element, options = {}) {
		const body = new ReadableStream({
			async start(controller) {
				try {
					controller.enqueue(await renderPng(element, options));
					controller.close();
				} catch (err) {
					controller.error(err);
				}
			},
		});
		super(body, {
			headers: {
				'content-type': 'image/png',
				'cache-control':
					process.env.NODE_ENV === 'development'
						? 'no-cache, no-store'
						: 'public, immutable, no-transform, max-age=31536000',
				...options.headers,
			},
			status: options.status,
			statusText: options.statusText,
		});
	}
}

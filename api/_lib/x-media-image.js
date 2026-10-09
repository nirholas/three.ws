// Fetch one picture from X's media CDN for the mention bot's `image3d` intent.
//
// The URL comes out of a post, so it is untrusted data. Only X's photo CDN
// host is ever contacted, over https, with redirects refused (a redirect is a
// way to reach any other host), a hard timeout, a byte cap enforced while
// streaming, a Content-Type check and a magic-byte check. Anything else is a
// typed rejection the caller turns into a recorded skip or a designed reply.

import { looksLikeImageBytes } from './image-persist.js';

export const X_MEDIA_HOST = 'pbs.twimg.com';
export const X_MEDIA_MAX_BYTES = 5 * 1024 * 1024;
export const X_MEDIA_TIMEOUT_MS = 15_000;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png']);

export class XMediaError extends Error {
	/** @param {'not_cdn'|'too_large'|'bad_type'|'bad_bytes'|'timeout'|'fetch_failed'} code */
	constructor(code, message) {
		super(message);
		this.name = 'XMediaError';
		this.code = code;
	}
}

/**
 * The URL to request for a photo, or null when it is not an X photo CDN URL.
 * Photos are asked for at `name=large` (at most 2048 px, plenty for
 * reconstruction and far under the byte cap). PURE.
 */
export function xMediaUrl(raw) {
	let u;
	try {
		u = new URL(String(raw));
	} catch {
		return null;
	}
	if (u.protocol !== 'https:' || u.hostname !== X_MEDIA_HOST || u.port || u.username || u.password) return null;
	if (!u.pathname.startsWith('/media/')) return null;
	u.hash = '';
	u.searchParams.set('name', 'large');
	return u.toString();
}

/**
 * The 400x400 variant of an X profile picture, or null when the URL is not an
 * X profile picture on the photo CDN. The user expansion carries the 48 px
 * `_normal` size; the same file is served at `_400x400`. PURE.
 */
export function xProfileImageUrl(raw) {
	let u;
	try {
		u = new URL(String(raw));
	} catch {
		return null;
	}
	if (u.protocol !== 'https:' || u.hostname !== X_MEDIA_HOST || u.port || u.username || u.password) return null;
	if (!u.pathname.startsWith('/profile_images/')) return null;
	u.pathname = u.pathname.replace(/_(?:normal|bigger|mini)(\.[a-z]+)$/i, '_400x400$1');
	u.search = '';
	u.hash = '';
	return u.toString();
}

async function readCapped(res, maxBytes) {
	const declared = Number(res.headers.get('content-length'));
	if (Number.isFinite(declared) && declared > maxBytes) throw new XMediaError('too_large', 'the picture is over the size limit');
	const chunks = [];
	let total = 0;
	for await (const chunk of res.body) {
		total += chunk.length;
		if (total > maxBytes) throw new XMediaError('too_large', 'the picture is over the size limit');
		chunks.push(chunk);
	}
	return Buffer.concat(chunks, total);
}

/**
 * @param {string} rawUrl a media url taken from a post
 * @param {{ fetchImpl?: typeof fetch, maxBytes?: number, timeoutMs?: number, profile?: boolean }} [opts] `profile` fetches a profile picture instead of a post photo
 * @returns {Promise<{ bytes: Buffer, contentType: string, url: string }>}
 */
export async function fetchXImage(rawUrl, { fetchImpl = fetch, maxBytes = X_MEDIA_MAX_BYTES, timeoutMs = X_MEDIA_TIMEOUT_MS, profile = false } = {}) {
	const url = profile ? xProfileImageUrl(rawUrl) : xMediaUrl(rawUrl);
	if (!url) throw new XMediaError('not_cdn', 'the picture is not hosted on the X photo CDN');
	let res;
	try {
		res = await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'image/jpeg,image/png' } });
	} catch (err) {
		if (err?.name === 'TimeoutError' || err?.name === 'AbortError') throw new XMediaError('timeout', 'the picture took too long to download');
		throw new XMediaError('fetch_failed', `the picture could not be downloaded: ${err?.message || err}`);
	}
	if (!res.ok) throw new XMediaError('fetch_failed', `the media CDN answered ${res.status}`);
	const contentType = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
	if (!ALLOWED_TYPES.has(contentType)) throw new XMediaError('bad_type', `unsupported picture type: ${contentType || 'none'}`);
	let bytes;
	try {
		bytes = await readCapped(res, maxBytes);
	} catch (err) {
		if (err instanceof XMediaError) throw err;
		throw new XMediaError(err?.name === 'TimeoutError' ? 'timeout' : 'fetch_failed', 'the picture could not be read');
	}
	if (!looksLikeImageBytes(bytes)) throw new XMediaError('bad_bytes', 'the download is not a JPEG or PNG picture');
	return { bytes, contentType, url };
}

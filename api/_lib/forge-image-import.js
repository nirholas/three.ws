// Fetch a photo a person pasted as a link, for /forge and Forge Studio.
//
// The browser cannot read most image links itself (no CORS on other sites), so
// POST /api/forge-upload { source_url } fetches the link here and hands the
// bytes back to the page, which then prepares and uploads them exactly like a
// dropped file (src/shared/forge-image-normalize.js, then the presigned PUT).
// One path for every photo: nothing fetched here is stored or sent to a lane.
//
// Safety: every hop goes through the pinned SSRF guard (private, local and
// metadata addresses refused, DNS pinned, redirects re-checked), the body is
// capped mid-stream, and the response is only ever an image, judged by its
// bytes with the same rule the page uses (src/shared/forge-image-intake.js),
// served as an attachment with nosniff so it can never render as a page on
// our origin. A link to a web page follows that page's preview image
// (og:image, twitter:image, link rel=image_src) once, because "the product
// page URL" is what people actually copy.

import { fetchSafePublicUrlPinned, SsrfBlockedError, MaxBytesExceededError } from './ssrf-guard.js';
import { sniffImage, notImageMessage, ACCEPTED_FORMATS_TEXT } from '../../src/shared/forge-image-intake.js';

export const IMPORT_MAX_BYTES = 25 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;
const PAGE_SCAN_BYTES = 256 * 1024;
const USER_AGENT = 'three.ws-forge-import/1.0 (+https://three.ws/forge)';

export class ImageImportError extends Error {
	constructor(status, code, message) {
		super(message);
		this.status = status;
		this.code = code;
	}
}

const MESSAGES = {
	blocked: 'That link cannot be fetched: Forge only opens public http or https addresses. Save the image to your device and add it from there.',
	unreachable: 'Forge could not reach that link: the site did not answer in time or closed the connection. Save the image to your device and add it from there.',
	tooLarge: `That image is larger than the 25 MB Forge can fetch from a link. Save it to your device and add it from there; the page shrinks large photos for you.`,
	pageNoImage: `That link is a web page with no image Forge can find on it. Right-click the picture and choose "Copy image address", then paste that, or save the picture and add it (${ACCEPTED_FORMATS_TEXT}).`,
};

function parseHttpUrl(input) {
	if (typeof input !== 'string' || input.length > 4096) return null;
	try {
		const url = new URL(input.trim());
		return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
	} catch {
		return null;
	}
}

const decodeEntities = (s) =>
	s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');

/** The preview image a page declares, resolved against the page URL, or null. */
export function pagePreviewImage(html, pageUrl) {
	const tags = html.match(/<(meta|link)\b[^>]*>/gi) || [];
	const attr = (tag, name) => {
		const m = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag);
		return m ? decodeEntities(m[2] ?? m[3] ?? m[4] ?? '') : null;
	};
	const wanted = ['og:image:secure_url', 'og:image:url', 'og:image', 'twitter:image', 'twitter:image:src'];
	let best = null;
	let rank = Infinity;
	for (const tag of tags) {
		const key = (attr(tag, 'property') || attr(tag, 'name') || '').toLowerCase();
		const i = wanted.indexOf(key);
		if (i >= 0 && i < rank && attr(tag, 'content')) {
			best = attr(tag, 'content');
			rank = i;
		}
		if (!best && /^<link/i.test(tag) && (attr(tag, 'rel') || '').toLowerCase() === 'image_src' && attr(tag, 'href')) {
			best = attr(tag, 'href');
		}
	}
	if (!best) return null;
	try {
		const url = new URL(best, pageUrl);
		return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
	} catch {
		return null;
	}
}

async function fetchOnce(url) {
	let res;
	try {
		res = await fetchSafePublicUrlPinned(
			url,
			{
				headers: { accept: 'image/avif,image/webp,image/*,text/html;q=0.8,*/*;q=0.5', 'user-agent': USER_AGENT },
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			},
			{ allowHttp: true, maxBytes: IMPORT_MAX_BYTES },
		);
	} catch (err) {
		if (err instanceof SsrfBlockedError) throw new ImageImportError(400, 'url_blocked', MESSAGES.blocked);
		if (err instanceof MaxBytesExceededError) throw new ImageImportError(413, 'url_too_large', MESSAGES.tooLarge);
		throw new ImageImportError(502, 'url_unreachable', MESSAGES.unreachable);
	}
	if (!res.ok) {
		throw new ImageImportError(
			422,
			'url_unreachable',
			`That link did not return an image: the site answered ${res.status}${res.statusText ? ` (${res.statusText})` : ''}. Check the link opens in your browser, or save the image and add it from there.`,
		);
	}
	let bytes;
	try {
		bytes = new Uint8Array(await res.arrayBuffer());
	} catch {
		throw new ImageImportError(502, 'url_unreachable', MESSAGES.unreachable);
	}
	return { bytes, contentType: String(res.headers.get('content-type') || '').toLowerCase() };
}

/**
 * @param {string} sourceUrl
 * @returns {Promise<{ bytes: Uint8Array, format: string, url: string }>}
 * @throws {ImageImportError}
 */
export async function importImageFromUrl(sourceUrl) {
	const url = parseHttpUrl(sourceUrl);
	if (!url) throw new ImageImportError(400, 'url_blocked', MESSAGES.blocked);

	let target = url.href;
	let got = await fetchOnce(target);
	let sniff = sniffImage(got.bytes);

	if (!sniff.format && (sniff.notImage === 'a web page' || got.contentType.startsWith('text/html'))) {
		const html = new TextDecoder('utf-8', { fatal: false }).decode(got.bytes.subarray(0, PAGE_SCAN_BYTES));
		const preview = pagePreviewImage(html, target);
		if (!preview) throw new ImageImportError(415, 'url_not_image', MESSAGES.pageNoImage);
		target = preview;
		got = await fetchOnce(target);
		sniff = sniffImage(got.bytes);
	}
	if (!sniff.format) throw new ImageImportError(415, 'url_not_image', notImageMessage(sniff.notImage).replace(/^That file/, 'That link'));
	return { bytes: got.bytes, format: sniff.format, url: target };
}

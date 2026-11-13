// Display-sized image variants served by /cdn/.
//
// Bucket images are stored at whatever size their writer chose: 768 px avatar
// renders, multi-megabyte maker posters, 1200 px social cards. Grids paint them
// into 36 to 293 px boxes, so a card pays for pixels nobody sees. Rewriting the
// stored objects is not an option, because the same URLs feed print
// certificates, pptx export, social cards and third-party API consumers that
// need the original.
//
// So /cdn/ serves a derivative on request instead: `/cdn/_v/<width>/<key>` is
// the object at <key>, resized to fit <width> px and encoded as WebP, built once
// per source version and persisted in the bucket (api/cdn-object.js). The width
// travels in the path, not a query string, so the vercel.json rewrite carries it
// and every edge cache keys on it. Widths are a closed set so the derivative
// space stays bounded. This module is the one grammar both sides use.

export const VARIANT_WIDTHS = Object.freeze([128, 256, 512]);
export const VARIANT_PREFIX = '_v';

const RASTER_EXT = /\.(png|jpe?g|webp)$/i;

// `_v/512/thumb/abc.png` -> { width: 512, source: 'thumb/abc.png' }; anything
// else (wrong width, non-raster source, nested variant) -> null.
export function parseVariantKey(key) {
	const m = /^_v\/(\d+)\/(.+)$/.exec(String(key || ''));
	if (!m) return null;
	const width = Number(m[1]);
	const source = m[2];
	if (!VARIANT_WIDTHS.includes(width)) return null;
	if (!RASTER_EXT.test(source) || source.startsWith(`${VARIANT_PREFIX}/`)) return null;
	return { width, source };
}

// Where the derivative of one source version lives in the bucket. The source
// ETag is part of the key because thumbnails are re-rendered under the same key;
// a new render gets a new derivative instead of a stale one.
export function variantObjectKey(source, width, etag) {
	const version = String(etag || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 32) || 'v0';
	return `variants/${width}/${source}.${version}.webp`;
}

// Smallest allowed width that covers `cssPx` at device pixel ratio `dpr`.
export function variantWidthFor(cssPx, dpr = 2) {
	const need = Math.ceil(Number(cssPx) * Number(dpr || 1));
	return VARIANT_WIDTHS.find((w) => w >= need) || VARIANT_WIDTHS[VARIANT_WIDTHS.length - 1];
}

// Rewrite a first-party `/cdn/<key>` image URL to its display-sized variant.
// Absolute three.ws URLs, same-origin URLs and root-relative paths qualify;
// anything else (a remote host, a data: URI, a GLB, an existing variant, an
// already display-sized forge WebP thumbnail) is returned unchanged.
export function sizedImageUrl(url, cssPx, { dpr = 2, origin } = {}) {
	if (typeof url !== 'string' || !url) return url;
	const m = /^(https?:\/\/[^/]+)?\/cdn\/([^?#]+)$/.exec(url);
	if (!m) return url;
	const host = m[1];
	if (host) {
		const here = origin ?? (typeof location !== 'undefined' ? location.origin : '');
		if (host !== 'https://three.ws' && host !== here) return url;
	}
	const key = m[2];
	if (!RASTER_EXT.test(key) || key.startsWith(`${VARIANT_PREFIX}/`)) return url;
	if (/^forge\/thumb\/[^/]+\.webp$/.test(key)) return url;
	const width = variantWidthFor(cssPx, dpr);
	return `${host || ''}/cdn/${VARIANT_PREFIX}/${width}/${key}`;
}

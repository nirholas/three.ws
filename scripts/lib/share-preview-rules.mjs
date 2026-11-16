// Rule set for link previews on LinkedIn and Microsoft Teams (both unfurl the
// page's Open Graph tags). Pure: takes HTML text plus optional image facts and
// returns violations, each naming the exact offending tag.
//
// Sources: LinkedIn Post Inspector guidance (1200x627 image, 1.91:1, under
// 5 MB, JPG/PNG/GIF, absolute https URL, og:title/og:image required) and the
// Open Graph protocol (og:type, og:url, og:image dimensions).

export const LIMITS = Object.freeze({
	titleMax: 120,
	descriptionMax: 300,
	imageMinWidth: 1200,
	imageMinHeight: 627,
	imageMaxBytes: 5 * 1024 * 1024,
	ratioTarget: 1200 / 627,
	ratioTolerance: 0.12,
	imageTypes: ['image/png', 'image/jpeg', 'image/gif'],
});

function decode(s) {
	return String(s)
		.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

/** Every <meta> as {key, content}, key being its property or name attribute. */
export function readMeta(html) {
	const out = [];
	for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
		const tag = m[0];
		const key = /\b(?:property|name)=["']([^"']+)["']/i.exec(tag)?.[1];
		const content = /\bcontent=("([^"]*)"|'([^']*)')/i.exec(tag);
		if (key && content) out.push({ key: key.toLowerCase(), content: decode(content[2] ?? content[3] ?? '') });
	}
	return out;
}

export function readCanonical(html) {
	const tag = /<link\b[^>]*rel=["']canonical["'][^>]*>/i.exec(html)?.[0];
	const href = tag && /\bhref=["']([^"']*)["']/i.exec(tag)?.[1];
	return href ? decode(href) : null;
}

function isAbsoluteHttps(u) {
	try { return new URL(u).protocol === 'https:'; } catch { return false; }
}

/**
 * @param {string} html page HTML
 * @param {{ image?: { contentType?: string, bytes?: number, width?: number, height?: number, status?: number } }} [facts]
 * @returns {{ tag: string, problem: string }[]}
 */
export function checkPreview(html, facts = {}) {
	const meta = readMeta(html);
	const get = (k) => meta.find((m) => m.key === k)?.content;
	const v = [];
	const bad = (tag, problem) => v.push({ tag, problem });

	const title = get('og:title');
	if (!title) bad('og:title', 'missing');
	else if (title.length > LIMITS.titleMax) bad('og:title', `${title.length} chars, max ${LIMITS.titleMax}`);

	const desc = get('og:description');
	if (!desc) bad('og:description', 'missing');
	else if (desc.length > LIMITS.descriptionMax) bad('og:description', `${desc.length} chars, max ${LIMITS.descriptionMax}`);

	if (!get('og:type')) bad('og:type', 'missing');

	const ogUrl = get('og:url');
	if (!ogUrl) bad('og:url', 'missing');
	else if (!isAbsoluteHttps(ogUrl)) bad('og:url', `not an absolute https URL: ${ogUrl}`);

	const canonical = readCanonical(html);
	if (!canonical) bad('link[rel=canonical]', 'missing');
	else if (!isAbsoluteHttps(canonical)) bad('link[rel=canonical]', `not an absolute https URL: ${canonical}`);

	const img = get('og:image');
	if (!img) bad('og:image', 'missing');
	else if (!isAbsoluteHttps(img)) bad('og:image', `not an absolute https URL: ${img}`);

	const w = Number(get('og:image:width'));
	const h = Number(get('og:image:height'));
	if (!get('og:image:width')) bad('og:image:width', 'missing');
	if (!get('og:image:height')) bad('og:image:height', 'missing');
	if (w && h) {
		if (w < LIMITS.imageMinWidth || h < LIMITS.imageMinHeight) {
			bad('og:image:width', `declared ${w}x${h}, LinkedIn wants at least ${LIMITS.imageMinWidth}x${LIMITS.imageMinHeight}`);
		}
		if (Math.abs(w / h - LIMITS.ratioTarget) > LIMITS.ratioTolerance) {
			bad('og:image:height', `declared ratio ${(w / h).toFixed(2)}, LinkedIn crops outside ~1.91:1`);
		}
	}

	const card = get('twitter:card');
	if (!card) bad('twitter:card', 'missing');
	else if (card !== 'summary_large_image') bad('twitter:card', `is "${card}", expected summary_large_image`);
	const tImg = get('twitter:image');
	if (tImg && !isAbsoluteHttps(tImg)) bad('twitter:image', `not an absolute https URL: ${tImg}`);

	const f = facts.image;
	if (f) {
		if (f.status && f.status !== 200) bad('og:image', `fetch answered HTTP ${f.status}`);
		else {
			if (f.contentType && !LIMITS.imageTypes.includes(f.contentType.split(';')[0].trim().toLowerCase())) {
				bad('og:image', `content-type ${f.contentType} is not PNG, JPEG or GIF`);
			}
			if (f.bytes && f.bytes > LIMITS.imageMaxBytes) bad('og:image', `${f.bytes} bytes, max ${LIMITS.imageMaxBytes}`);
			if (f.width && f.height) {
				if (f.width < LIMITS.imageMinWidth || f.height < LIMITS.imageMinHeight) {
					bad('og:image', `actual image ${f.width}x${f.height}, LinkedIn wants at least ${LIMITS.imageMinWidth}x${LIMITS.imageMinHeight}`);
				}
				if (w && h && (f.width !== w || f.height !== h)) {
					bad('og:image:width', `declares ${w}x${h} but the image is ${f.width}x${f.height}`);
				}
			}
		}
	}
	return v;
}

/** Pixel size from the first bytes of a PNG or JPEG, else null. */
export function imageSize(buf) {
	if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) {
		return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
	}
	if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
		let i = 2;
		while (i + 9 < buf.length) {
			if (buf[i] !== 0xff) { i++; continue; }
			const marker = buf[i + 1];
			if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
				return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
			}
			i += 2 + buf.readUInt16BE(i + 2);
		}
	}
	return null;
}

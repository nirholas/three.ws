// PDF page rendering and text-layer reading in Node, for the NVIDIA PDF
// extraction pipeline (api/_lib/pdf-extract.js).
//
// pdf.js (the serverless build shipped by `unpdf`) parses the document and
// paints pages onto @napi-rs/canvas, a prebuilt Skia binding with no system
// dependencies, so this runs in the Cloud Run container as-is. pdf.js expects
// browser globals (Path2D, ImageData, DOMMatrix) and a canvas factory; both are
// provided from @napi-rs/canvas before unpdf loads.
//
// Coordinates: every box this module returns is normalised to 0..1 of the
// page, origin top-left, the same frame the NVIDIA CV models answer in.

import * as napi from '@napi-rs/canvas';

for (const name of ['Path2D', 'ImageData', 'DOMMatrix']) {
	if (!globalThis[name] && napi[name]) globalThis[name] = napi[name];
}

class NapiCanvasFactory {
	create(width, height) {
		const canvas = napi.createCanvas(Math.max(1, width | 0), Math.max(1, height | 0));
		return { canvas, context: canvas.getContext('2d') };
	}
	reset(pair, width, height) {
		pair.canvas.width = width;
		pair.canvas.height = height;
	}
	destroy(pair) {
		pair.canvas.width = 0;
		pair.canvas.height = 0;
		pair.canvas = null;
		pair.context = null;
	}
}

let unpdfModule;
async function unpdf() {
	unpdfModule ||= import('unpdf');
	return unpdfModule;
}

/** Open a PDF. The caller must `await closePdf(doc)` when done. */
export async function openPdf(bytes) {
	const { getDocumentProxy } = await unpdf();
	// pdf.js transfers the buffer it is given; hand it a private copy.
	const data = new Uint8Array(bytes.byteLength);
	data.set(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
	return getDocumentProxy(data, { CanvasFactory: NapiCanvasFactory, isEvalSupported: false });
}

/** Release a document opened with openPdf (worker, fonts, page caches). */
export async function closePdf(doc) {
	if (!doc) return;
	try {
		await doc.loadingTask.destroy();
	} catch (err) {
		console.warn('[pdf-render] close failed', err?.message);
	}
}

/**
 * Paint one page (1-based) to a JPEG.
 * @returns {Promise<{ bytes: Buffer, mime: 'image/jpeg', width: number, height: number }>}
 */
export async function renderPage(doc, pageNumber, { scale = 2, quality = 85 } = {}) {
	const page = await doc.getPage(pageNumber);
	try {
		const viewport = page.getViewport({ scale });
		const canvas = napi.createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
		const ctx = canvas.getContext('2d');
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(0, 0, canvas.width, canvas.height);
		await page.render({ canvasContext: ctx, viewport, canvas }).promise;
		const bytes = await canvas.encode('jpeg', quality);
		return { bytes, mime: 'image/jpeg', width: canvas.width, height: canvas.height };
	} finally {
		page.cleanup();
	}
}

/**
 * The page's text layer as positioned words, normalised 0..1 top-left. Empty
 * for a scanned page (an image with no text layer).
 * @returns {Promise<{ text: string, x0: number, y0: number, x1: number, y1: number }[]>}
 */
export async function pageWords(doc, pageNumber) {
	const page = await doc.getPage(pageNumber);
	try {
		const viewport = page.getViewport({ scale: 1 });
		const content = await page.getTextContent();
		const words = [];
		for (const item of content.items) {
			if (typeof item.str !== 'string' || !item.str.trim()) continue;
			const t = item.transform;
			const fontHeight = Math.hypot(t[2], t[3]) || item.height || 0;
			const [ax, ay] = viewport.convertToViewportPoint(t[4], t[5]);
			const [bx, by] = viewport.convertToViewportPoint(t[4] + item.width, t[5] + fontHeight);
			const left = Math.min(ax, bx) / viewport.width;
			const right = Math.max(ax, bx) / viewport.width;
			const top = Math.min(ay, by) / viewport.height;
			const bottom = Math.max(ay, by) / viewport.height;
			for (const w of splitWords(item.str, left, right)) words.push({ text: w.text, x0: w.x0, y0: top, x1: w.x1, y1: bottom });
		}
		return words;
	} finally {
		page.cleanup();
	}
}

// A text item is often a whole line. Split it into words with x extents
// interpolated by character position, so a line that crosses table columns
// lands its words in the right cells.
function splitWords(str, left, right) {
	const total = str.length || 1;
	const span = right - left;
	const out = [];
	const re = /\S+/g;
	let m;
	while ((m = re.exec(str))) {
		out.push({ text: m[0], x0: left + (span * m.index) / total, x1: left + (span * (m.index + m[0].length)) / total });
	}
	return out;
}

/** Plain text per page from the text layer, for the fallback extractor. */
export async function pdfPageTexts(bytes) {
	const { extractText } = await unpdf();
	const data = new Uint8Array(bytes.byteLength);
	data.set(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
	const { text } = await extractText(data, { mergePages: false });
	return Array.isArray(text) ? text : [String(text || '')];
}

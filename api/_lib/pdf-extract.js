// Layout-aware PDF page extraction with NVIDIA NeMo Retriever models.
//
// For one page: render it (pdf-render.js), find its elements with
// nemotron-page-elements-v3, then
//   tables  -> crop, nemotron-table-structure-v1 for the row/column grid,
//              words from the text layer (or nemotron-ocr-v2 on a scanned
//              page) placed into cells, emitted as a markdown table;
//   charts  -> crop, nemotron-graphic-elements-v1 for titles, axes, categories
//              and legend, then the Nemotron VL model reads the plotted values
//              grounded on those labels;
//   text    -> the text layer, or nemotron-ocr-v2 when the page is scanned.
// Captions ("Table 2: ...", "Figure 4: ...") are attached to their element and
// blocks come back in reading order. Words no detector box claimed are kept
// as text blocks, so nothing on the page is dropped.
//
// A failing CV call throws (the job falls back to text extraction for the
// document); a failing chart read degrades that chart to its labels.

import sharp from 'sharp';
import { renderPage, pageWords } from './pdf-render.js';
import { pageElements, tableStructure, graphicElements, ocr, readChart } from './nvidia-doc-extract.js';
import {
	wordsIn,
	toCrop,
	padBox,
	explodeLines,
	groupLines,
	textOf,
	proseOf,
	captionWords,
	containment,
	assembleTable,
	tableMarkdown,
	chartHints,
	captionIndex,
	trimAway,
	isCaption,
	readingOrder,
	looksScanned,
} from './pdf-layout.js';

const RENDER_SCALE = 3;
const MAX_IMAGE_BYTES = 1_200_000;
const TEXT_CLASSES = new Set(['title', 'paragraph', 'text', 'list', 'caption']);
const CHART_CLASSES = new Set(['chart', 'infographic']);
const MIN_CONFIDENCE = 0.3;
const MIN_TEXT_CONFIDENCE = 0.1;

const round = (n) => Math.round(n * 1000) / 1000;
const bboxOf = (b) => ({ x0: round(b.x0), y0: round(b.y0), x1: round(b.x1), y1: round(b.y1) });

async function fitImage(bytes) {
	if (bytes.length <= MAX_IMAGE_BYTES) return { bytes, mime: 'image/jpeg' };
	let width = 1800;
	let out = bytes;
	while (out.length > MAX_IMAGE_BYTES && width >= 900) {
		out = await sharp(bytes).resize({ width, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer();
		width -= 300;
	}
	return { bytes: out, mime: 'image/jpeg' };
}

async function crop(render, box) {
	const left = Math.floor(box.x0 * render.width);
	const top = Math.floor(box.y0 * render.height);
	const w = Math.max(8, Math.min(render.width - left, Math.ceil((box.x1 - box.x0) * render.width)));
	const h = Math.max(8, Math.min(render.height - top, Math.ceil((box.y1 - box.y0) * render.height)));
	const bytes = await sharp(render.bytes).extract({ left, top, width: w, height: h }).jpeg({ quality: 90 }).toBuffer();
	return fitImage(bytes);
}

async function tableBlock(render, box, pageWordsAll, scanned) {
	const area = padBox(box, 0.01);
	const image = await crop(render, area);
	const structurePromise = tableStructure(image);
	const words = scanned ? explodeLines(await ocr(image)) : toCrop(wordsIn(pageWordsAll, padBox(box, 0.003)), area);
	const structure = await structurePromise;
	const cells = assembleTable(structure, words);
	const markdown = cells ? tableMarkdown(cells) : '';
	const text = markdown || groupLines(words).map((l) => l.text).join('\n');
	return { type: 'table', bbox: bboxOf(box), text, markdown, cells: cells || null, method: scanned ? 'ocr' : 'text-layer' };
}

async function chartBlock(render, box, pageWordsAll, scanned) {
	const area = padBox(box, 0.01);
	const image = await crop(render, area);
	const graphicPromise = graphicElements(image);
	let words = scanned ? [] : toCrop(wordsIn(pageWordsAll, padBox(box, 0.003)), area);
	// Charts embedded as images carry no text layer even on born-digital pages.
	if (words.length < 3) words = explodeLines(await ocr(image));
	const graphic = await graphicPromise;
	const hints = chartHints(graphic, words);
	let readout = '';
	let readError = null;
	try {
		readout = await readChart(image, hints);
	} catch (err) {
		readError = err?.message || String(err);
		console.warn('[pdf-extract] chart read failed, keeping labels only:', readError);
	}
	const text = [hints, readout ? `Values read from the chart:\n${readout}` : ''].filter(Boolean).join('\n');
	return { type: 'chart', bbox: bboxOf(box), text, hints, readout, method: readout ? 'graphic-elements+vl' : 'graphic-elements', read_error: readError };
}

// Leftover words (not inside any detected element) grouped into paragraphs by
// vertical gaps, so text the detector missed still reaches the index.
function leftoverBlocks(words, claimed) {
	const free = words.filter((w) => !claimed.some((b) => wordsIn([w], b).length));
	if (!free.length) return [];
	const lines = groupLines(free);
	const groups = [];
	for (const line of lines) {
		const g = groups[groups.length - 1];
		if (g && line.y0 - g.y1 < 0.02 && Math.abs(line.x0 - g.x0) < 0.25) {
			g.lines.push(line);
			g.y1 = Math.max(g.y1, line.y1);
			g.x0 = Math.min(g.x0, line.x0);
			g.x1 = Math.max(g.x1, line.x1);
		} else groups.push({ lines: [line], x0: line.x0, x1: line.x1, y0: line.y0, y1: line.y1 });
	}
	return groups
		.map((g) => ({ type: 'text', bbox: bboxOf(g), text: g.lines.map((l) => l.text).join(' ').trim() }))
		.filter((b) => b.text.length >= 3);
}

/**
 * Extract one page (1-based) of an open document into layout blocks.
 * @returns {Promise<{ page: number, scanned: boolean, blocks: object[], timings: object }>}
 */
export async function extractPage(doc, pageNumber) {
	const t0 = Date.now();
	const [render, layerWords] = await Promise.all([renderPage(doc, pageNumber, { scale: RENDER_SCALE }), pageWords(doc, pageNumber)]);
	const pageImage = await fitImage(render.bytes);
	const tRender = Date.now();
	const scanned = looksScanned(layerWords);
	const [elements, ocrLines] = await Promise.all([pageElements(pageImage), scanned ? ocr(pageImage) : Promise.resolve(null)]);
	const words = scanned ? explodeLines(ocrLines) : layerWords;
	const tDetect = Date.now();

	const confident = (list, min = MIN_CONFIDENCE) => (list || []).filter((b) => b.confidence >= min);
	const furniture = confident(elements.header_footer, MIN_TEXT_CONFIDENCE);
	const textBoxes = Object.entries(elements)
		.filter(([cls]) => TEXT_CLASSES.has(cls))
		.flatMap(([cls, list]) => confident(list, MIN_TEXT_CONFIDENCE).map((b) => ({ ...b, cls, text: textOf(wordsIn(words, padBox(b, 0.003))) })))
		.filter((b) => b.text)
		// A title boxed inside a paragraph box ("Evaluation Differences." run-in
		// heading) is already part of that paragraph.
		.filter((b, _, all) => b.cls !== 'title' || isCaption(b.text) || !all.some((o) => o !== b && o.cls !== 'title' && containment(b, o) > 0.8));

	// Detectors often draw a table or chart box that includes its caption.
	// Attach the caption, then trim the visual box away from it so caption
	// words never land in table cells or chart labels.
	const usedCaptions = new Set();
	const captionWordSet = new Set();
	const attach = (box) => {
		const i = captionIndex(box, textBoxes.map((t, j) => (usedCaptions.has(j) ? { ...t, text: '' } : t)));
		if (i < 0) return { box, caption: null };
		usedCaptions.add(i);
		const full = captionWords(textBoxes[i], words);
		for (const w of full) captionWordSet.add(w);
		return { box: trimAway(box, textBoxes[i]), caption: textOf(full) || textBoxes[i].text };
	};
	const tables = confident(elements.table).map(attach);
	const charts = Object.entries(elements)
		.filter(([cls]) => CHART_CLASSES.has(cls))
		.flatMap(([, list]) => confident(list))
		.map(attach);

	// A table box over blank space (a detector false positive) reads as no
	// text at all; it is dropped rather than indexed and previewed as empty.
	// One with a caption is kept: the caption alone still says what is there.
	const visual = (
		await Promise.all([
			...tables.map((t) => tableBlock(render, t.box, words, scanned).then((b) => ({ ...b, caption: t.caption }))),
			...charts.map((c) => chartBlock(render, c.box, words, scanned).then((b) => ({ ...b, caption: c.caption }))),
		])
	).filter((b) => b.text.trim() || b.caption);
	const tVisual = Date.now();

	const visualAreas = [...tables, ...charts].map((v) => padBox(v.box, 0.004));
	const inVisual = (w) => visualAreas.some((a) => wordsIn([w], a).length);
	const proseWords = words.filter((w) => !inVisual(w) && !captionWordSet.has(w));
	const textBlocks = textBoxes
		.filter((b, i) => !usedCaptions.has(i) && !visualAreas.some((a) => cx(b) >= a.x0 && cx(b) <= a.x1 && cy(b) >= a.y0 && cy(b) <= a.y1))
		.map((b) => ({ type: b.cls === 'title' ? 'title' : 'text', bbox: bboxOf(b), text: proseOf(wordsIn(proseWords, padBox(b, 0.003))) }))
		.filter((b) => b.text);

	const claimed = [...visualAreas, ...textBoxes.map((b) => padBox(b, 0.003)), ...furniture.map((b) => padBox(b, 0.003))];
	const prose = [...textBlocks, ...leftoverBlocks(proseWords, claimed)];
	const ordered = readingOrder([...prose, ...visual].map((b) => ({ ...b, ...b.bbox }))).map(({ x0, y0, x1, y1, ...b }) => ({
		...b,
		page: pageNumber,
		method: b.method || (scanned ? 'ocr' : 'text-layer'),
	}));

	return {
		page: pageNumber,
		scanned,
		blocks: ordered,
		timings: { render_ms: tRender - t0, detect_ms: tDetect - tRender, visual_ms: tVisual - tDetect, total_ms: Date.now() - t0 },
	};
}

function cx(b) {
	return (b.x0 + b.x1) / 2;
}
function cy(b) {
	return (b.y0 + b.y1) / 2;
}

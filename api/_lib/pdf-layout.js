// Pure layout logic for the NVIDIA PDF extraction pipeline: turns detector
// boxes plus positioned words into tables, chart hints, captions and reading
// order. No I/O, so every rule here is unit-tested (tests/pdf-layout.test.js).
//
// Frames: boxes and words are {x0,y0,x1,y1} normalised to 0..1, origin
// top-left, either of the page or of a crop (toCrop converts page to crop).

const CAPTION_RE = /^(table|figure|fig\.|chart|exhibit)\s*[0-9ivx]+[a-z]?\s*[:.]/i;
const MERGE_OVERLAP = 0.6;

const cx = (b) => (b.x0 + b.x1) / 2;
const cy = (b) => (b.y0 + b.y1) / 2;
const width = (b) => Math.max(0, b.x1 - b.x0);
const height = (b) => Math.max(0, b.y1 - b.y0);

function overlap1d(a0, a1, b0, b1) {
	return Math.max(0, Math.min(a1, b1) - Math.max(a0, b0));
}

/** Words whose centre lies inside `box`. */
export function wordsIn(words, box) {
	return words.filter((w) => cx(w) >= box.x0 && cx(w) <= box.x1 && cy(w) >= box.y0 && cy(w) <= box.y1);
}

/** Re-express page-frame words in the frame of a crop `box` (also page-frame). */
export function toCrop(words, box) {
	const w = width(box) || 1;
	const h = height(box) || 1;
	return words.map((word) => ({
		...word,
		x0: (word.x0 - box.x0) / w,
		x1: (word.x1 - box.x0) / w,
		y0: (word.y0 - box.y0) / h,
		y1: (word.y1 - box.y0) / h,
	}));
}

/** Grow a box by `pad` on every side, clamped to the page. */
export function padBox(box, pad = 0.01) {
	return {
		x0: Math.max(0, box.x0 - pad),
		y0: Math.max(0, box.y0 - pad),
		x1: Math.min(1, box.x1 + pad),
		y1: Math.min(1, box.y1 + pad),
	};
}

/**
 * Split OCR lines into words with x extents interpolated by character offset.
 * OCR often returns one detection for text that crosses table columns
 * ("Mistral 7B 60.1% 81.3%"); splitting lets each token land in its cell.
 */
export function explodeLines(lines) {
	const out = [];
	for (const line of lines) {
		const text = String(line.text || '');
		const total = text.length || 1;
		const span = line.x1 - line.x0;
		const re = /\S+/g;
		let m;
		while ((m = re.exec(text))) {
			out.push({
				text: m[0],
				x0: line.x0 + (span * m.index) / total,
				x1: line.x0 + (span * (m.index + m[0].length)) / total,
				y0: line.y0,
				y1: line.y1,
			});
		}
	}
	return out;
}

/** Group words into visual lines (top to bottom, left to right). */
export function groupLines(words) {
	const sorted = [...words].sort((a, b) => cy(a) - cy(b) || a.x0 - b.x0);
	const lines = [];
	for (const w of sorted) {
		const line = lines[lines.length - 1];
		const h = height(w) || 0.01;
		if (line && Math.abs(cy(w) - line.cy) <= Math.max(h, line.h) * 0.5) {
			line.words.push(w);
			line.cy = (line.cy * (line.words.length - 1) + cy(w)) / line.words.length;
			line.h = Math.max(line.h, h);
		} else {
			lines.push({ words: [w], cy: cy(w), h });
		}
	}
	return lines.map((l) => {
		const ws = l.words.sort((a, b) => a.x0 - b.x0);
		return {
			text: joinWords(ws),
			x0: Math.min(...ws.map((w) => w.x0)),
			x1: Math.max(...ws.map((w) => w.x1)),
			y0: Math.min(...ws.map((w) => w.y0)),
			y1: Math.max(...ws.map((w) => w.y1)),
		};
	});
}

function joinWords(words) {
	return words
		.map((w) => w.text)
		.join(' ')
		.replace(/\s+([,.;:%)\]])/g, '$1')
		.replace(/([([])\s+/g, '$1')
		.trim();
}

/** Paragraph text for a region: lines joined, hyphenated line breaks repaired. */
export function textOf(words) {
	const lines = groupLines(words).map((l) => l.text);
	let out = '';
	for (const line of lines) {
		if (!out) out = line;
		else if (/[a-z]-$/.test(out) && /^[a-z]/.test(line)) out = out.slice(0, -1) + line;
		else out += ` ${line}`;
	}
	return out.trim();
}

/**
 * A vertical gutter splitting `words` into two columns: an empty x band at
 * least 1.2% of the page wide, in the middle half of the span, with several
 * lines of text on each side. Returns the gutter x or null.
 */
export function findGutter(words) {
	if (words.length < 10) return null;
	const minX = Math.min(...words.map((w) => w.x0));
	const maxX = Math.max(...words.map((w) => w.x1));
	const span = maxX - minX;
	if (span < 0.4) return null;
	const spans = words.map((w) => [w.x0, w.x1]).sort((a, b) => a[0] - b[0]);
	let reach = spans[0][1];
	let best = null;
	for (const [x0, x1] of spans.slice(1)) {
		if (x0 - reach >= 0.012) {
			const mid = (x0 + reach) / 2;
			const rel = (mid - minX) / span;
			if (rel > 0.25 && rel < 0.75 && (!best || x0 - reach > best.gap)) best = { x: mid, gap: x0 - reach };
		}
		reach = Math.max(reach, x1);
	}
	if (!best) return null;
	const lineCount = (ws) => new Set(ws.map((w) => Math.round(cy(w) * 200))).size;
	const left = words.filter((w) => cx(w) < best.x);
	const right = words.filter((w) => cx(w) >= best.x);
	return left.length >= 5 && right.length >= 5 && lineCount(left) >= 3 && lineCount(right) >= 3 ? best.x : null;
}

/** Prose text for a region, read column by column when it spans a gutter. */
export function proseOf(words) {
	const gutter = findGutter(words);
	if (gutter == null) return textOf(words);
	const left = proseOf(words.filter((w) => cx(w) < gutter));
	const right = proseOf(words.filter((w) => cx(w) >= gutter));
	return [left, right].filter(Boolean).join('\n\n');
}

/**
 * Extend a one-line caption box down through the lines that continue it in
 * the same column (detectors often box only the "Table 3: ..." first line).
 * Returns the words of the full caption.
 */
export function captionWords(captionBox, words) {
	const inColumn = words.filter((w) => w.x0 >= captionBox.x0 - 0.01 && w.x1 <= captionBox.x1 + 0.02 && cy(w) >= captionBox.y0);
	const lines = groupLines(inColumn);
	const taken = [];
	let bottom = captionBox.y1;
	let lineH = 0.012;
	for (const line of lines) {
		if (line.y1 <= captionBox.y1 + 0.002) {
			taken.push(line);
			lineH = Math.max(0.008, line.y1 - line.y0);
			continue;
		}
		if (line.y0 - bottom > lineH * 0.9) break;
		taken.push(line);
		bottom = line.y1;
	}
	const inTaken = (w) => taken.some((l) => cy(w) >= l.y0 && cy(w) <= l.y1 && w.x0 >= l.x0 - 0.001 && w.x1 <= l.x1 + 0.001);
	return inColumn.filter(inTaken);
}

/** Fraction of `inner`'s area that lies inside `outer`. */
export function containment(inner, outer) {
	const a = width(inner) * height(inner);
	if (!a) return 0;
	return (overlap1d(inner.x0, inner.x1, outer.x0, outer.x1) * overlap1d(inner.y0, inner.y1, outer.y0, outer.y1)) / a;
}

// Merge detector boxes that describe the same band (a row or a column found
// twice), keyed on the axis that matters.
function mergeBands(boxes, axis) {
	const lo = axis === 'y' ? 'y0' : 'x0';
	const hi = axis === 'y' ? 'y1' : 'x1';
	const sorted = [...boxes].filter((b) => b[hi] > b[lo]).sort((a, b) => a[lo] + a[hi] - (b[lo] + b[hi]));
	const out = [];
	for (const b of sorted) {
		const prev = out[out.length - 1];
		if (prev) {
			const ov = overlap1d(prev[lo], prev[hi], b[lo], b[hi]);
			if (ov >= MERGE_OVERLAP * Math.min(prev[hi] - prev[lo], b[hi] - b[lo])) {
				prev[lo] = Math.min(prev[lo], b[lo]);
				prev[hi] = Math.max(prev[hi], b[hi]);
				continue;
			}
		}
		out.push({ ...b });
	}
	return out;
}

function bandFor(bands, word, axis) {
	const lo = axis === 'y' ? 'y0' : 'x0';
	const hi = axis === 'y' ? 'y1' : 'x1';
	const c = (word[lo] + word[hi]) / 2;
	let best = -1;
	let bestScore = -Infinity;
	for (let i = 0; i < bands.length; i++) {
		const b = bands[i];
		const inside = c >= b[lo] && c <= b[hi];
		const ov = overlap1d(word[lo], word[hi], b[lo], b[hi]);
		const dist = inside ? 0 : Math.min(Math.abs(c - b[lo]), Math.abs(c - b[hi]));
		const score = (inside ? 1 : 0) * 10 + ov * 5 - dist * 20;
		if (score > bestScore) {
			bestScore = score;
			best = i;
		}
	}
	return best;
}

/**
 * Build a cell grid from table-structure boxes and the words inside the table
 * (both in the crop frame). Rows and columns with no text are dropped.
 * @returns {string[][] | null} null when the detector found no usable grid
 */
export function assembleTable({ row = [], column = [] }, words) {
	const rows = mergeBands(row, 'y');
	const cols = mergeBands(column, 'x');
	if (rows.length < 2 || cols.length < 1 || !words.length) return null;
	const grid = rows.map(() => cols.map(() => []));
	for (const w of words) {
		const r = bandFor(rows, w, 'y');
		const c = bandFor(cols, w, 'x');
		if (r >= 0 && c >= 0) grid[r][c].push(w);
	}
	let cells = grid.map((r) => r.map((ws) => textOf(ws)));
	cells = cells.filter((r) => r.some(Boolean));
	const keep = cols.map((_, c) => cells.some((r) => r[c]));
	cells = cells.map((r) => r.filter((_, c) => keep[c]));
	if (cells.length < 2 || !cells[0].length) return null;
	return cells;
}

const escCell = (s) => String(s || '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

/** A GitHub-style markdown table; the first row is the header. */
export function tableMarkdown(cells) {
	if (!cells?.length) return '';
	const cols = Math.max(...cells.map((r) => r.length));
	const norm = cells.map((r) => Array.from({ length: cols }, (_, i) => escCell(r[i])));
	const [head, ...body] = norm;
	return [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...body.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

/**
 * Label text found by graphic-elements, as grounding for the chart reader and
 * as a readable description on its own when the reader is unavailable.
 * `graphic` boxes and `words` share the crop frame.
 */
export function chartHints(graphic, words) {
	const pick = (cls) =>
		(graphic[cls] || [])
			.slice()
			.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0)
			.map((box) => textOf(wordsIn(words, padBox(box, 0.005))))
			.filter(Boolean);
	const uniq = (list) => [...new Set(list)];
	const title = uniq(pick('chart_title'));
	const xTitle = uniq(pick('x_title'));
	const yTitle = uniq(pick('y_title'));
	const xLabels = uniq(
		(graphic.xlabel || [])
			.slice()
			.sort((a, b) => a.x0 - b.x0)
			.map((box) => textOf(wordsIn(words, padBox(box, 0.005))))
			.filter(Boolean),
	);
	const legend = uniq(pick('legend_label'));
	const values = uniq(pick('value_label'));
	const marks = uniq(pick('mark_label'));
	const lines = [];
	if (title.length) lines.push(`Chart title: ${title.join(' / ')}`);
	if (xTitle.length) lines.push(`X axis: ${xTitle.join(' / ')}`);
	if (yTitle.length) lines.push(`Y axis: ${yTitle.join(' / ')}`);
	if (xLabels.length) lines.push(`Categories: ${xLabels.join(', ')}`);
	if (legend.length) lines.push(`Series: ${legend.join(', ')}`);
	if (values.length) lines.push(`Value labels: ${values.join(', ')}`);
	if (marks.length) lines.push(`Marked points: ${marks.join(', ')}`);
	return lines.join('\n');
}

/**
 * The caption nearest an element: a text block starting "Table 3:" or
 * "Figure 4." that overlaps it horizontally and sits within `maxGap` above or
 * below. Returns the caption block index or -1.
 */
export function captionIndex(element, blocks, { maxGap = 0.06 } = {}) {
	let best = -1;
	let bestGap = Infinity;
	blocks.forEach((b, i) => {
		if (!b.text || !CAPTION_RE.test(b.text)) return;
		if (overlap1d(element.x0, element.x1, b.x0, b.x1) < 0.3 * Math.min(width(element), width(b))) return;
		const gap = b.y0 >= element.y1 ? b.y0 - element.y1 : element.y0 >= b.y1 ? element.y0 - b.y1 : 0;
		if (gap <= maxGap && gap < bestGap) {
			bestGap = gap;
			best = i;
		}
	});
	return best;
}

/**
 * Shrink `box` so it no longer covers `caption` (a caption drawn inside a
 * table or chart box). Keeps the box unchanged when trimming would leave
 * almost nothing.
 */
export function trimAway(box, caption) {
	const out = { ...box };
	if (cy(caption) > cy(box)) out.y1 = Math.min(box.y1, caption.y0 - 0.002);
	else out.y0 = Math.max(box.y0, caption.y1 + 0.002);
	return out.y1 - out.y0 > 0.02 ? out : box;
}

export const isCaption = (text) => CAPTION_RE.test(String(text || ''));

/**
 * Sort blocks into reading order. Blocks wider than 55% of the page span both
 * columns and act as separators; between separators the left column is read
 * before the right one. Single-column pages reduce to top-to-bottom.
 */
export function readingOrder(blocks) {
	const wide = (b) => width(b) > 0.55;
	const sorted = [...blocks].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
	const out = [];
	let band = [];
	const flush = () => {
		const left = band.filter((b) => cx(b) < 0.5).sort((a, b) => a.y0 - b.y0);
		const right = band.filter((b) => cx(b) >= 0.5).sort((a, b) => a.y0 - b.y0);
		out.push(...left, ...right);
		band = [];
	};
	for (const b of sorted) {
		if (wide(b)) {
			flush();
			out.push(b);
		} else band.push(b);
	}
	flush();
	return out;
}

/** True when the text layer is too thin to trust (a scanned or image-only page). */
export function looksScanned(words) {
	const chars = words.reduce((n, w) => n + w.text.length, 0);
	return chars < 60;
}

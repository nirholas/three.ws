// Structure-aware chunking for agent knowledge documents.
//
// Input is the Markdown that workers/markitdown produces from an uploaded file.
// Each format has a natural retrieval unit, and the chunker keeps it whole:
//
//   pptx  one chunk per slide (MarkItDown's "<!-- Slide number: N -->" markers),
//         speaker notes included, never split unless a slide passes
//         MAX_UNIT_TOKENS.
//   xlsx  one chunk per sheet (MarkItDown's "## SheetName" + table). An
//         oversized sheet splits on row boundaries with its header row
//         repeated, so every chunk is still a readable table.
//   pdf   pages (form feeds in the text), split on paragraphs when long.
//   msg   the whole email as one unit, labelled with its subject.
//   docx  and anything else: sections on Markdown headings, each labelled with
//         its heading path ("Handbook > Returns policy"), long sections split on
//         paragraph then sentence boundaries, tiny sections folded into the next.
//
// Every chunk's content starts with its label line, so the embedding carries
// the context and the agent can cite where an answer came from.

import { estimateTokens } from './chunker.js';

export const TARGET_TOKENS = 450;
export const MAX_UNIT_TOKENS = 1500;
export const MIN_TOKENS = 40;

const CHARS_PER_TOKEN = 4;
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE_RE = /^\s*(```|~~~)/;
const TABLE_SEPARATOR_RE = /^\|(\s*:?-{3,}:?\s*\|)+\s*$/;

/**
 * Split a converted document into retrieval chunks.
 *
 * @param {string} markdown  MarkItDown output
 * @param {{ kind?: string, title?: string }} [opts]
 * @returns {{ heading: string, locator: string, content: string, chunk_index: number, token_count: number }[]}
 */
export function chunkDocument(markdown, { kind, title } = {}) {
	const text = normalize(markdown);
	if (!text) return [];

	let units;
	if (kind === 'pptx') units = slideUnits(text, title);
	else if (kind === 'xlsx') units = sheetUnits(text, title);
	else if (kind === 'pdf') units = pageUnits(text);
	else if (kind === 'msg') units = emailUnits(text);
	else units = sectionUnits(text, title);

	return units
		.filter((u) => u.content.trim())
		.map((u, i) => ({ ...u, chunk_index: i, token_count: estimateTokens(u.content) }));
}

function normalize(markdown) {
	return String(markdown || '')
		.replace(/\r\n?/g, '\n')
		.replace(/[ \t]+$/gm, '')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function unit(heading, locator, body) {
	const b = body.trim();
	return { heading, locator, content: heading ? `${heading}\n\n${b}` : b };
}

// One unit when it fits `limit`, otherwise paragraph-packed prose chunks.
function fitOrSplit(heading, locator, body, limit) {
	const whole = unit(heading, locator, body);
	if (estimateTokens(whole.content) <= limit) return [whole];
	return proseChunks(heading, locator, body);
}

function proseChunks(heading, locator, body) {
	const avail = Math.max(200, (TARGET_TOKENS - estimateTokens(heading) - 1) * CHARS_PER_TOKEN);
	const pieces = [];
	for (const p of body.split(/\n{2,}/)) {
		const t = p.trim();
		if (!t) continue;
		if (t.length <= avail) pieces.push(t);
		else pieces.push(...splitLong(t, avail));
	}
	return pack(pieces, avail, '\n\n').map((b) => unit(heading, locator, b));
}

function splitLong(text, max) {
	const out = [];
	for (const sentence of text.split(/(?<=[.!?])\s+/)) {
		if (sentence.length <= max) {
			out.push(sentence);
			continue;
		}
		let rest = sentence;
		while (rest.length > max) {
			let cut = rest.lastIndexOf(' ', max);
			if (cut < max * 0.5) cut = max;
			out.push(rest.slice(0, cut).trim());
			rest = rest.slice(cut).trim();
		}
		if (rest) out.push(rest);
	}
	return pack(out, max, ' ');
}

function pack(pieces, max, sep) {
	const out = [];
	let cur = '';
	for (const p of pieces) {
		if (!cur) cur = p;
		else if (cur.length + sep.length + p.length <= max) cur += sep + p;
		else {
			out.push(cur);
			cur = p;
		}
	}
	if (cur) out.push(cur);
	return out;
}

// Split on a full-line marker regex with one capture group; returns the
// preamble before the first marker plus [{ key, body }] for each marker.
function splitOnMarker(text, re) {
	const parts = text.split(re);
	const items = [];
	for (let i = 1; i < parts.length; i += 2) items.push({ key: parts[i].trim(), body: parts[i + 1] || '' });
	return { preamble: parts[0], items };
}

function slideUnits(text, title) {
	const { preamble, items } = splitOnMarker(text, /^<!-- Slide number: (\d+) -->[ \t]*$/m);
	if (!items.length) return sectionUnits(text, title);
	const units = preamble.trim() ? sectionUnits(preamble, title) : [];
	for (const { key, body } of items) {
		const slideTitle = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
		const locator = `Slide ${key}`;
		const heading = slideTitle ? `${locator}: ${slideTitle}` : locator;
		units.push(...fitOrSplit(heading, locator, body, MAX_UNIT_TOKENS));
	}
	return units;
}

function sheetUnits(text, title) {
	const { preamble, items } = splitOnMarker(text, /^## (.+)$/m);
	if (!items.length) return sectionUnits(text, title);
	const units = preamble.trim() ? sectionUnits(preamble, title) : [];
	for (const { key, body } of items) {
		const label = `Sheet: ${key}`;
		const whole = unit(label, label, body);
		if (estimateTokens(whole.content) <= MAX_UNIT_TOKENS) units.push(whole);
		else units.push(...tableChunks(label, body));
	}
	return units;
}

// Row-boundary split of an oversized sheet; the header row and its separator
// open every chunk so each one stays a self-describing table.
function tableChunks(label, body) {
	const lines = body.trim().split('\n');
	const h = lines.findIndex((l, i) => l.startsWith('|') && TABLE_SEPARATOR_RE.test(lines[i + 1] || ''));
	if (h < 0) return proseChunks(label, label, body);

	const header = `${lines[h]}\n${lines[h + 1]}`;
	const caption = lines.slice(0, h).join('\n').trim();
	const rows = lines.slice(h + 2).filter((l) => l.trim());
	const budget =
		(TARGET_TOKENS * 2 - estimateTokens(label) - estimateTokens(header) - 2) * CHARS_PER_TOKEN;
	const rowLimit = (MAX_UNIT_TOKENS - estimateTokens(label) - estimateTokens(header) - 2) * CHARS_PER_TOKEN;
	const safeRows = rows.map((r) => (r.length > rowLimit ? r.slice(0, rowLimit) : r));

	return pack(safeRows, budget, '\n').map((group, i) =>
		unit(label, label, `${i === 0 && caption ? `${caption}\n\n` : ''}${header}\n${group}`),
	);
}

function pageUnits(text) {
	const pages = text.split('\f');
	const units = [];
	pages.forEach((page, i) => {
		if (!page.trim()) return;
		const label = `Page ${i + 1}`;
		units.push(...fitOrSplit(label, label, page, TARGET_TOKENS));
	});
	return units;
}

function emailUnits(text) {
	const subject = text.match(/^\*\*Subject:\*\*\s*(.+)$/m)?.[1]?.trim();
	const label = subject ? `Email: ${subject}` : 'Email';
	const body = text.replace(/^# Email Message\s*\n/, '');
	return fitOrSplit(label, label, body, MAX_UNIT_TOKENS);
}

function sectionUnits(text, title) {
	const sections = [];
	const stack = [];
	let cur = { path: [], lines: [] };
	let inFence = false;

	for (const line of text.split('\n')) {
		if (FENCE_RE.test(line)) inFence = !inFence;
		const m = !inFence && line.match(HEADING_RE);
		if (!m) {
			cur.lines.push(line);
			continue;
		}
		sections.push(cur);
		const level = m[1].length;
		while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
		stack.push({ level, name: m[2] });
		cur = { path: stack.map((s) => s.name), lines: [] };
	}
	sections.push(cur);

	const filled = sections
		.map((s) => ({ path: s.path, body: s.lines.join('\n').trim() }))
		.filter((s) => s.body);

	// Fold a fragment into its neighbour so no chunk is a lone sentence.
	const merged = [];
	for (let i = 0; i < filled.length; i++) {
		const s = filled[i];
		const next = filled[i + 1];
		if (estimateTokens(s.body) < MIN_TOKENS && next) {
			next.body = `${s.body}\n\n${next.body}`;
			continue;
		}
		const prev = merged[merged.length - 1];
		if (estimateTokens(s.body) < MIN_TOKENS && prev) {
			prev.body = `${prev.body}\n\n${s.body}`;
			continue;
		}
		merged.push(s);
	}

	return merged.flatMap((s) => {
		const heading = s.path.join(' > ') || title || '';
		const locator = s.path[s.path.length - 1] || '';
		return fitOrSplit(heading, locator, s.body, TARGET_TOKENS);
	});
}

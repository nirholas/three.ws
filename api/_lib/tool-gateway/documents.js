// Document content types, shared by web_fetch and parse_document.
//
// web_fetch reads HTML and text. A binary document (PDF, Office, OpenDocument,
// RTF) decoded as UTF-8 is noise, so web_fetch uses this check to point the
// caller at parse_document instead of returning half-read bytes.

import { downloadPublic, decodeBase64Input } from './download.js';
import { GatewayError } from './errors.js';
import { geminiFilesAvailable, geminiReadFile, GEMINI_INLINE_MAX_BYTES } from './gemini.js';
import { cleanText, extractTables, htmlToText } from './html-text.js';

const DOCUMENT_TYPES = new Set([
	'application/pdf',
	'application/msword',
	'application/vnd.ms-excel',
	'application/vnd.ms-powerpoint',
	'application/rtf',
	'text/rtf',
]);

const DOCUMENT_PREFIXES = [
	'application/vnd.openxmlformats-officedocument.',
	'application/vnd.oasis.opendocument.',
];

/** True when a Content-Type header names a binary document rather than a page. */
export function isDocumentContentType(contentType) {
	const type = String(contentType || '').split(';')[0].trim().toLowerCase();
	if (!type) return false;
	return DOCUMENT_TYPES.has(type) || DOCUMENT_PREFIXES.some((p) => type.startsWith(p));
}

// ── parse_document ──────────────────────────────────────────────────────────
//
// PDF text comes from unpdf (pdf.js without a canvas), and a scanned PDF with no
// text layer is read by Gemini on Vertex AI. DOCX goes through mammoth to HTML
// so tables survive, spreadsheets through exceljs, HTML and plain text through
// the same extractor web_fetch uses. Billing is per page (a sheet, a PDF page,
// or 3000 characters of prose counts as one).

export const DOCUMENT_MAX_BYTES = 15 * 1024 * 1024;
const DEFAULT_MAX_CHARS = 50_000;
const CHARS_PER_PAGE = 3000;
const MAX_SHEET_ROWS = 500;

/** Sniff a document container from its first bytes, falling back to the name or type hint. */
export function sniffDocument(buf, hint = '') {
	if (!buf || buf.length < 4) return null;
	if (buf.toString('ascii', 0, 5) === '%PDF-') return 'pdf';
	const h = String(hint).toLowerCase();
	if (buf[0] === 0x50 && buf[1] === 0x4b) {
		if (/\.xlsx|spreadsheetml/.test(h)) return 'xlsx';
		if (/\.docx|wordprocessingml/.test(h)) return 'docx';
		const head = buf.subarray(0, Math.min(buf.length, 4096)).toString('latin1');
		if (head.includes('word/')) return 'docx';
		if (head.includes('xl/')) return 'xlsx';
		return buf.includes(Buffer.from('word/document.xml')) ? 'docx' : buf.includes(Buffer.from('xl/workbook.xml')) ? 'xlsx' : null;
	}
	const sample = buf.subarray(0, 2048).toString('utf8');
	if (sample.includes('\u0000')) return null;
	if (/^\s*<(!doctype|html)/i.test(sample) || /html/.test(h)) return 'html';
	if (/\.csv|text\/csv/.test(h)) return 'csv';
	return 'text';
}

function parseCsvLine(line) {
	const out = [];
	let cur = '';
	let quoted = false;
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (quoted) {
			if (c === '"' && line[i + 1] === '"') {
				cur += '"';
				i++;
			} else if (c === '"') quoted = false;
			else cur += c;
		} else if (c === '"') quoted = true;
		else if (c === ',') {
			out.push(cur);
			cur = '';
		} else cur += c;
	}
	out.push(cur);
	return out;
}

async function parsePdf(buf) {
	const { getDocumentProxy, extractText } = await import('unpdf');
	let pdf;
	try {
		pdf = await getDocumentProxy(new Uint8Array(buf));
	} catch (err) {
		throw new GatewayError(422, 'unreadable_document', `That PDF could not be opened: ${String(err?.message || err).slice(0, 160)}`);
	}
	const { totalPages, text } = await extractText(pdf, { mergePages: false });
	const pages = (Array.isArray(text) ? text : [text]).map((t) => cleanText(t));
	const chars = pages.reduce((n, p) => n + p.length, 0);
	if (chars >= 20 * Math.max(1, totalPages)) {
		return { text: pages.map((p, i) => `[page ${i + 1}]\n${p}`).join('\n\n'), pages: totalPages, tables: [], method: 'text-layer', provider: 'unpdf' };
	}
	if (!geminiFilesAvailable() || buf.length > GEMINI_INLINE_MAX_BYTES) {
		return { text: pages.join('\n\n'), pages: totalPages, tables: [], method: 'text-layer', provider: 'unpdf', note: 'This PDF has little or no text layer and OCR is unavailable for it.' };
	}
	const out = await geminiReadFile({
		data: buf,
		mimeType: 'application/pdf',
		instruction:
			'Transcribe every page of this scanned document verbatim, in reading order, as plain text. Separate pages with a line "[page N]". Render tables as rows with cells separated by " | ". Do not summarize or add commentary.',
		maxOutputTokens: 32_768,
		timeoutMs: 150_000,
	});
	return { text: out.text.trim(), pages: totalPages, tables: [], method: 'ocr', provider: 'vertex-gemini' };
}

async function parseDocx(buf) {
	const mammoth = (await import('mammoth')).default;
	let html;
	try {
		({ value: html } = await mammoth.convertToHtml({ buffer: buf }));
	} catch (err) {
		throw new GatewayError(422, 'unreadable_document', `That DOCX could not be opened: ${String(err?.message || err).slice(0, 160)}`);
	}
	const text = htmlToText(html);
	return { text, pages: Math.max(1, Math.ceil(text.length / CHARS_PER_PAGE)), tables: extractTables(html), method: 'docx', provider: 'mammoth' };
}

async function parseXlsx(buf) {
	const ExcelJS = (await import('exceljs')).default;
	const wb = new ExcelJS.Workbook();
	try {
		await wb.xlsx.load(buf);
	} catch (err) {
		throw new GatewayError(422, 'unreadable_document', `That spreadsheet could not be opened: ${String(err?.message || err).slice(0, 160)}`);
	}
	const tables = [];
	const lines = [];
	wb.eachSheet((sheet) => {
		const rows = [];
		sheet.eachRow({ includeEmpty: false }, (row, n) => {
			if (n > MAX_SHEET_ROWS) return;
			const cells = Array.isArray(row.values) ? row.values.slice(1) : [];
			rows.push(cells.map((c) => (c == null ? '' : typeof c === 'object' ? String(c.text ?? c.result ?? c.hyperlink ?? '') : String(c))));
		});
		tables.push({ sheet: sheet.name, rows });
		lines.push(`[sheet ${sheet.name}]`, ...rows.map((r) => r.join(' | ')));
	});
	return { text: lines.join('\n'), pages: Math.max(1, tables.length), tables, method: 'xlsx', provider: 'exceljs' };
}

/** Estimate for the up-front charge. A URL is charged one page and settled after. */
export function estimateParseDocument(args) {
	if (args?.document) {
		const b64 = String(args.document).replace(/^data:[^,]*,/, '');
		return Math.max(1, Math.ceil((b64.length * 0.75) / 100_000));
	}
	return 1;
}

/**
 * @param {{ url?: string, document?: string, filename?: string, max_chars?: number }} args
 */
export async function parseDocument(args) {
	let buf;
	let hint = String(args?.filename || '');
	if (args?.url) {
		const dl = await downloadPublic(String(args.url), { maxBytes: DOCUMENT_MAX_BYTES, accept: '*/*', timeoutMs: 30_000 });
		buf = dl.body;
		hint = `${hint} ${dl.contentType} ${String(args.url).split('?')[0]}`;
	} else if (args?.document) {
		buf = decodeBase64Input(args.document, { maxBytes: DOCUMENT_MAX_BYTES, field: 'document' });
	} else {
		throw new GatewayError(400, 'bad_request', 'Pass "url" (a public document) or "document" (base64).');
	}
	const maxChars = Math.min(Math.max(Number(args?.max_chars) || DEFAULT_MAX_CHARS, 500), 200_000);
	const kind = sniffDocument(buf, hint);
	if (!kind) throw new GatewayError(415, 'unsupported_media', 'parse_document reads PDF, DOCX, XLSX, CSV, HTML and plain text.');

	let doc;
	if (kind === 'pdf') doc = await parsePdf(buf);
	else if (kind === 'docx') doc = await parseDocx(buf);
	else if (kind === 'xlsx') doc = await parseXlsx(buf);
	else if (kind === 'html') {
		const raw = buf.toString('utf8');
		const text = htmlToText(raw);
		doc = { text, pages: Math.max(1, Math.ceil(text.length / CHARS_PER_PAGE)), tables: extractTables(raw), method: 'html', provider: 'direct' };
	} else if (kind === 'csv') {
		const rows = buf.toString('utf8').split(/\r?\n/).filter(Boolean).slice(0, MAX_SHEET_ROWS).map(parseCsvLine);
		doc = { text: rows.map((r) => r.join(' | ')).join('\n'), pages: 1, tables: [{ sheet: 'csv', rows }], method: 'csv', provider: 'direct' };
	} else {
		const text = cleanText(buf.toString('utf8'));
		doc = { text, pages: Math.max(1, Math.ceil(text.length / CHARS_PER_PAGE)), tables: [], method: 'text', provider: 'direct' };
	}

	const truncated = doc.text.length > maxChars;
	return {
		result: {
			format: kind,
			pages: doc.pages,
			method: doc.method,
			text: truncated ? doc.text.slice(0, maxChars) : doc.text,
			characters: doc.text.length,
			truncated,
			tables: doc.tables,
			...(doc.note ? { note: doc.note } : {}),
		},
		units: doc.pages,
		provider: doc.provider,
	};
}

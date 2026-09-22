// HTML to readable text, shared by web_fetch and parse_document.
//
// node-html-parser rather than jsdom: jsdom's ESM/CJS chain crashes at cold
// start on the deployed runtime (see api/_lib/text-extract.js), and this is
// plain DOM walking that needs none of it.

import { parse } from 'node-html-parser';

const MAX_LINKS = 60;

export function cleanText(s) {
	return s
		.replace(/\u00a0/g, ' ')
		.replace(/[ \t]+/g, ' ')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

const BLOCK_TAGS = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TR', 'BR', 'PRE', 'BLOCKQUOTE', 'TABLE', 'UL', 'OL', 'DD', 'DT', 'FIGCAPTION']);

// Walk the DOM and emit text with block boundaries as newlines and headings
// marked, so the model reads structure instead of one run-on line.
export function readableText(node) {
	const out = [];
	const walk = (n) => {
		if (n.nodeType === 3) {
			out.push(n.rawText ? n.text : '');
			return;
		}
		if (n.nodeType !== 1) return;
		const tag = n.tagName;
		const block = BLOCK_TAGS.has(tag);
		if (block) out.push('\n');
		if (/^H[1-6]$/.test(tag)) out.push('#'.repeat(Number(tag[1])) + ' ');
		if (tag === 'LI') out.push('- ');
		for (const c of n.childNodes) walk(c);
		if (block) out.push('\n');
	};
	walk(node);
	return cleanText(out.join(''));
}

/** Extract a readable view of an HTML document. */
export function extractReadable(html, baseUrl) {
	const root = parse(html, { comment: false, blockTextElements: { script: false, style: false, noscript: false, pre: true } });
	const meta = (sel) => root.querySelector(sel)?.getAttribute('content')?.trim() || null;
	const title = meta('meta[property="og:title"]') || root.querySelector('title')?.text?.trim() || null;
	const description = meta('meta[name="description"]') || meta('meta[property="og:description"]');
	const canonicalHref = root.querySelector('link[rel="canonical"]')?.getAttribute('href') || null;
	const lang = root.querySelector('html')?.getAttribute('lang') || null;

	const links = [];
	const seen = new Set();
	for (const a of root.querySelectorAll('a[href]')) {
		if (links.length >= MAX_LINKS) break;
		let href;
		try {
			href = new URL(a.getAttribute('href'), baseUrl).toString();
		} catch {
			continue;
		}
		if (!/^https?:/.test(href) || seen.has(href)) continue;
		seen.add(href);
		const text = cleanText(a.text || '').slice(0, 120);
		links.push({ text, url: href });
	}

	for (const sel of ['script', 'style', 'noscript', 'template', 'svg', 'iframe', 'nav', 'footer', 'header', 'aside', 'form', '[role="navigation"]', '[aria-hidden="true"]']) {
		for (const el of root.querySelectorAll(sel)) el.remove();
	}
	const main = root.querySelector('article') || root.querySelector('main') || root.querySelector('[role="main"]') || root.querySelector('body') || root;
	let canonical = null;
	if (canonicalHref) {
		try {
			canonical = new URL(canonicalHref, baseUrl).toString();
		} catch {
			canonical = null;
		}
	}
	return { title, description, canonical, lang, text: readableText(main), links };
}

/** Tables in an HTML fragment as arrays of rows of cell text. */
export function extractTables(html, { maxTables = 20, maxRows = 500 } = {}) {
	const root = parse(html);
	return root
		.querySelectorAll('table')
		.slice(0, maxTables)
		.map((t) =>
			t
				.querySelectorAll('tr')
				.slice(0, maxRows)
				.map((tr) => tr.querySelectorAll('th,td').map((c) => cleanText(c.text || ''))),
		)
		.filter((rows) => rows.length);
}

/** Readable text of an HTML fragment (no link or metadata extraction). */
export function htmlToText(html) {
	const root = parse(html, { comment: false, blockTextElements: { script: false, style: false, noscript: false, pre: true } });
	for (const el of root.querySelectorAll('script,style,noscript,template')) el.remove();
	return readableText(root);
}

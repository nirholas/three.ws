// web_search and web_fetch.
//
// web_search rides the platform's grounded search (api/_lib/web-search.js):
// Gemini on Vertex AI with the Google Search tool, billed to GCP credits, which
// returns a synthesized answer plus the pages it cited. When that rung is down
// the call falls through to DuckDuckGo's keyless instant-answer API so an
// agent still gets something real to work from, and the result says which
// lane answered.
//
// web_fetch downloads one public URL through the SSRF-safe, byte-capped
// downloader and turns the HTML into readable text: title, description,
// canonical URL, the main content with paragraph breaks kept, and the page's
// outbound links. Documents (PDF, DOCX, spreadsheets) are pointed at
// parse_document rather than being half-read here.

import { groundedSearch, webSearchAvailable } from '../web-search.js';
import { fetchUpstreamJson } from '../upstream-fetch.js';
import { downloadPublic } from './download.js';
import { GatewayError } from './errors.js';
import { isDocumentContentType } from './documents.js';
import { cleanText, extractReadable } from './html-text.js';

const FETCH_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_CHARS = 20_000;

async function duckDuckGo(query) {
	const d = await fetchUpstreamJson(
		`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
		{},
		{ name: 'duckduckgo:instant', timeoutMs: 8000, attempts: 2 },
	);
	const sources = [];
	if (d.AbstractURL) sources.push({ title: d.Heading || d.AbstractSource || d.AbstractURL, url: d.AbstractURL, domain: safeHost(d.AbstractURL) });
	for (const t of d.RelatedTopics || []) {
		if (t?.FirstURL && t?.Text) sources.push({ title: t.Text.slice(0, 160), url: t.FirstURL, domain: safeHost(t.FirstURL) });
		if (sources.length >= 8) break;
	}
	return { answer: d.AbstractText || '', sources, queries: [query] };
}

function safeHost(u) {
	try {
		return new URL(u).hostname;
	} catch {
		return null;
	}
}

/**
 * @param {{ query: string, max_results?: number }} args
 */
export async function webSearch(args) {
	const query = String(args.query || '').trim();
	if (!query) throw new GatewayError(400, 'bad_request', '"query" is required.');
	const maxSources = Math.min(Math.max(Number(args.max_results) || 8, 1), 10);

	let out = null;
	let provider = null;
	let upstreamError = null;
	if (webSearchAvailable()) {
		try {
			out = await groundedSearch(query, { maxSources });
			provider = 'vertex-google-search';
		} catch (err) {
			upstreamError = err;
			console.warn(`[tool-gateway] grounded search failed, falling back: ${err?.message || err}`);
		}
	}
	if (!out) {
		try {
			out = await duckDuckGo(query);
			provider = 'duckduckgo-instant';
		} catch (err) {
			throw new GatewayError(
				502,
				'search_unavailable',
				`Every search lane failed. Grounded search: ${upstreamError?.message || 'not configured'}; instant answers: ${err?.message || err}.`,
			);
		}
		if (!out.answer && !out.sources.length) {
			throw new GatewayError(502, 'search_unavailable', `No search lane returned results for "${query.slice(0, 80)}". Retry shortly.`);
		}
	}
	return {
		result: {
			query,
			answer: out.answer,
			sources: out.sources.slice(0, maxSources),
			queries_run: out.queries || [],
			provider,
			...(out.stale ? { stale: true, as_of: out.as_of } : {}),
		},
		units: 1,
		provider,
	};
}

/**
 * @param {{ url: string, max_chars?: number, include_links?: boolean }} args
 */
export async function webFetch(args) {
	const url = String(args.url || '').trim();
	if (!/^https?:\/\//i.test(url)) throw new GatewayError(400, 'bad_request', '"url" must be an http(s) URL.');
	const maxChars = Math.min(Math.max(Number(args.max_chars) || DEFAULT_MAX_CHARS, 500), 100_000);

	const { body, contentType } = await downloadPublic(url, {
		maxBytes: FETCH_MAX_BYTES,
		accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,application/json;q=0.8,*/*;q=0.5',
	});

	if (isDocumentContentType(contentType)) {
		return {
			result: {
				url,
				content_type: contentType,
				document: true,
				text: '',
				hint: 'This URL is a document. Call parse_document with this url to read its text and tables.',
			},
			units: 1,
			provider: 'direct',
		};
	}

	const raw = body.toString('utf8');
	let page;
	if (/html|xml/.test(contentType) || /^\s*<(!doctype|html)/i.test(raw)) {
		page = extractReadable(raw, url);
	} else if (/json/.test(contentType)) {
		page = { title: null, description: null, canonical: null, lang: null, text: raw, links: [] };
	} else if (/^text\//.test(contentType) || !contentType) {
		page = { title: null, description: null, canonical: null, lang: null, text: cleanText(raw), links: [] };
	} else {
		throw new GatewayError(415, 'unsupported_content', `web_fetch reads web pages and text; this URL returned ${contentType}.`);
	}

	const truncated = page.text.length > maxChars;
	return {
		result: {
			url,
			content_type: contentType || null,
			title: page.title,
			description: page.description,
			canonical: page.canonical,
			lang: page.lang,
			text: truncated ? page.text.slice(0, maxChars) : page.text,
			characters: page.text.length,
			truncated,
			...(args.include_links === false ? {} : { links: page.links }),
		},
		units: 1,
		provider: 'direct',
	};
}

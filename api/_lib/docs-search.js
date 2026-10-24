// Server-side documentation search for the MCP `search_docs` tool.
//
// One index, one ranking. The browser palette and the docs site search
// public/docs-search.js against public/docs-search-index.json, which
// scripts/build-docs-search-index.mjs writes from docs/**/*.md. This module loads
// that same artifact into that same engine, so an agent asking "how do I fund an
// agent wallet" gets exactly the sections a person typing it into the docs
// search gets.
//
// Where the index comes from, in order:
//   1. dist/docs-search-index.json  (the production build output)
//   2. public/docs-search-index.json (a dev checkout after `npm run build:docs-search`)
//   3. built in memory from docs/ with the same builder (a container whose build
//      step did not emit the file still answers, just with a one-time ~second
//      warm-up).
// The index is loaded once per process and shared by every request.
//
// The index stores headings and one line per document, not section text. A
// result's snippet is therefore read from the markdown file at query time, using
// the builder's own splitSections(), so the excerpt is the start of the section
// that matched rather than the top of the page.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DOCS_DIR = join(ROOT, 'docs');
const INDEX_FILES = [join(ROOT, 'dist', 'docs-search-index.json'), join(ROOT, 'public', 'docs-search-index.json')];

export const SNIPPET_CHARS = 280;
export const MAX_RESULTS = 10;

let enginePromise = null;
const sectionCache = new Map();

async function loadEngine() {
	await import('../../public/docs-search.js');
	const engine = globalThis.twsDocsSearch;
	for (const file of INDEX_FILES) {
		if (!existsSync(file)) continue;
		try {
			engine.load(JSON.parse(readFileSync(file, 'utf8')));
			return engine;
		} catch {
			// A half-written or corrupt file falls through to the next source.
		}
	}
	const { buildIndex } = await import('../../scripts/build-docs-search-index.mjs');
	engine.load(buildIndex(DOCS_DIR));
	return engine;
}

/** The ready engine, loaded once. A failed load is not remembered. */
export function getEngine() {
	if (!enginePromise) {
		enginePromise = loadEngine().catch((err) => {
			enginePromise = null;
			throw err;
		});
	}
	return enginePromise;
}

async function sectionsOf(slug) {
	if (sectionCache.has(slug)) return sectionCache.get(slug);
	const file = resolve(DOCS_DIR, `${slug}.md`);
	let parsed = null;
	// The slug comes from our own index, but a path check costs nothing.
	if (file.startsWith(DOCS_DIR + sep) && existsSync(file)) {
		const { splitSections } = await import('../../scripts/build-docs-search-index.mjs');
		parsed = splitSections(readFileSync(file, 'utf8'), slug).sections;
	}
	if (sectionCache.size > 400) sectionCache.clear();
	sectionCache.set(slug, parsed);
	return parsed;
}

function excerpt(text, max) {
	if (text.length <= max) return text;
	const cut = text.slice(0, max);
	const at = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(' '));
	return `${cut.slice(0, at > max * 0.6 ? at : max).trim()}...`;
}

/**
 * Search the documentation.
 *
 * @param {string} q raw question or keywords
 * @param {{ limit?: number, origin?: string }} [opts]
 * @returns {Promise<Array<{title,heading,url,snippet,doc}>>}
 */
export async function searchDocs(q, { limit = 5, origin = 'https://three.ws' } = {}) {
	const engine = await getEngine();
	const hits = engine.query(String(q), Math.min(Math.max(Number(limit) || 5, 1), MAX_RESULTS));
	const base = origin.replace(/\/$/, '');
	const out = [];
	for (const hit of hits) {
		const sections = await sectionsOf(hit.slug);
		const section = sections?.find((s) => s.anchor === hit.anchor);
		out.push({
			title: hit.heading ? `${hit.docTitle}: ${hit.heading}` : hit.docTitle,
			url: `${base}${hit.url}`,
			snippet: excerpt(section?.text || hit.snippet || '', SNIPPET_CHARS),
			doc: hit.slug,
		});
	}
	return out;
}

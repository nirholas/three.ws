// Crawler-visible bodies for the two shared shells whose content is fetched
// client-side: /tutorials/<slug> and /walkthroughs/<slug>.
//
// Both routes resolve to one shell (pages/tutorial.html, pages/walkthrough.html)
// whose body is empty markup the player fills after fetching its content. That
// is fine for a browser and bad for search: 76 pages built to answer questions
// people type into Google ("text to 3d", "embed a 3d avatar") shipped with no
// text in them. The tutorial shell was worse than empty, because its static
// fallback reads "Tutorial not found" and its <h1> is blank, so a crawler that
// did not run the fetch banked a not-found page under a real URL.
//
// server/seo-head.mjs already rewrites the <head> of these routes per path.
// This is the same idea for the body: render the content that the player would
// have fetched, straight into the shell. The players replace their root
// wholesale on load (article.innerHTML / root.innerHTML), so a visitor with JS
// sees no duplication and no flash of two versions, exactly the contract
// api/news/story-page.js uses for a story permalink.
//
// Content comes from the same files the player fetches (docs/tutorials/*.md,
// data/walkthroughs.json), so the rendered page cannot drift from the read one.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

// Rendered bodies are stable between deploys, so one parse per path per process
// is enough. null is cached too: an unknown slug must not re-read the disk on
// every crawl of a URL that will never resolve.
const cache = new Map();

const SLUG = /^[a-z0-9-]+$/;

function esc(s) {
	return String(s ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

// Anchored at the start of the document, deliberately: an unanchored /^#/m
// would match the first `# comment` line inside an early fenced code block and
// delete it from the rendered page.
const LEADING_H1 = /^\s*#\s+(.+?)[ \t]*(?:\r?\n|$)/;

/** Strip the leading `# Title` line, which the shell renders as its own <h1>. */
function splitTitle(md) {
	const m = md.match(LEADING_H1);
	if (!m) return { title: '', body: md };
	return { title: m[1].trim(), body: md.slice(m[0].length) };
}

/** First prose paragraph of a markdown body, for the hero blurb. */
function firstParagraph(md) {
	for (const block of md.split(/\n{2,}/)) {
		const t = block.trim();
		if (!t || t.startsWith('#') || t.startsWith('```') || t.startsWith('|') || t.startsWith('<')) continue;
		return t.replace(/\s+/g, ' ');
	}
	return '';
}

function renderMarkdown(md) {
	// Our own repo files: trusted input, so marked's default (no sanitizer) is
	// the right call, and the player renders the same source with the same lib.
	return marked.parse(md, { gfm: true, breaks: false, mangle: false, headerIds: true });
}

function tutorialBody(slug) {
	if (!SLUG.test(slug)) return null;
	let md;
	try {
		md = readFileSync(path.join(root, 'docs', 'tutorials', `${slug}.md`), 'utf8');
	} catch {
		return null; // no markdown: leave the shell alone and let the player 404 it
	}
	const { title, body } = splitTitle(md);
	if (!title) return null;
	return { title, blurb: firstParagraph(body), html: renderMarkdown(body) };
}

let walkthroughs = null;
function loadWalkthroughs() {
	if (walkthroughs) return walkthroughs;
	try {
		const raw = JSON.parse(readFileSync(path.join(root, 'data', 'walkthroughs.json'), 'utf8'));
		walkthroughs = new Map((raw.walkthroughs || []).map((w) => [w.slug, w]));
	} catch {
		walkthroughs = new Map();
	}
	return walkthroughs;
}

function walkthroughBody(slug) {
	if (!SLUG.test(slug)) return null;
	const w = loadWalkthroughs().get(slug);
	if (!w) return null;

	const steps = (w.steps || [])
		.map(
			(s, i) =>
				`<li><h2>${esc(s.title || `Step ${i + 1}`)}</h2>` +
				`<p>${esc(s.body || '')}</p>` +
				(s.tip ? `<p><em>${esc(s.tip)}</em></p>` : '') +
				(s.path ? `<p><a href="${esc(s.path)}">${esc(s.path)}</a></p>` : '') +
				`</li>`,
		)
		.join('\n');

	const related = (w.related || [])
		.map((r) => `<li><a href="${esc(r.href)}">${esc(r.label)}</a></li>`)
		.join('');

	return {
		title: w.title || slug,
		blurb: w.blurb || w.outcome || '',
		html:
			`<p>${esc(w.blurb || '')}</p>` +
			(w.outcome ? `<p><strong>What you end up with:</strong> ${esc(w.outcome)}</p>` : '') +
			(w.minutes ? `<p>${esc(String(w.minutes))} minute walkthrough${w.level ? `, ${esc(w.level)} level` : ''}.</p>` : '') +
			(steps ? `<ol>${steps}</ol>` : '') +
			(w.cta?.href ? `<p><a href="${esc(w.cta.href)}">${esc(w.cta.label || 'Start')}</a></p>` : '') +
			(related ? `<h2>Related</h2><ul>${related}</ul>` : ''),
	};
}

function injectTutorial(html, content) {
	return html
		.replace(/<div class="tdoc-hero" id="tdoc-hero" hidden>/, '<div class="tdoc-hero" id="tdoc-hero">')
		.replace(/<h1 id="tdoc-title">\s*<\/h1>/, `<h1 id="tdoc-title">${esc(content.title)}</h1>`)
		.replace(
			/<p class="tdoc-hero-blurb" id="tdoc-blurb">\s*<\/p>/,
			`<p class="tdoc-hero-blurb" id="tdoc-blurb">${esc(content.blurb)}</p>`,
		)
		.replace(
			/(<article class="tdoc-article" id="tdoc-article">)[\s\S]*?(<\/article>)/,
			(_m, open, close) => `${open}${content.html}${close}`,
		);
}

function injectWalkthrough(html, content) {
	return html.replace(
		/(<div id="wt-root" data-state="loading">)[\s\S]*?(<\/div>)/,
		(_m, open, close) => `${open}<h1>${esc(content.title)}</h1>${content.html}${close}`,
	);
}

/**
 * Render the crawler-visible body for a shared-shell content route.
 *
 * @param {string} pathname request path, before the dest rewrite
 * @param {string} html the shell HTML (head already rewritten by seo-head)
 * @returns {string|null} the shell with a real body, or null when the path is
 *   not one of these routes, the slug has no content, or nothing was injected
 */
export function renderCrawlerBody(pathname, html) {
	if (!pathname || !html) return null;
	const clean = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
	const m = clean.match(/^\/(tutorials|walkthroughs)\/([^/]+)$/);
	if (!m) return null;

	const key = `${m[1]}/${m[2]}`;
	if (!cache.has(key)) {
		try {
			cache.set(key, m[1] === 'tutorials' ? tutorialBody(m[2]) : walkthroughBody(m[2]));
		} catch (err) {
			console.error(`[crawler-body] ${clean} fell back to the shell:`, err.message);
			cache.set(key, null);
		}
	}
	const content = cache.get(key);
	if (!content) return null;

	const out = m[1] === 'tutorials' ? injectTutorial(html, content) : injectWalkthrough(html, content);
	// A shell that changed shape would silently start serving the empty body
	// again; saying so beats shipping a blank page that still returns 200.
	if (out === html) {
		console.error(`[crawler-body] ${clean}: shell markup did not match, body not injected`);
		return null;
	}
	return out;
}

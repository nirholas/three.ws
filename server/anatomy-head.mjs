// Per-design <head> for an Anatomy machine page (/anatomy/:id).
//
// /anatomy/:id serves the one static shell (pages/anatomy.html) for every
// design, and src/anatomy/page.js loads the machine client-side. Anything that
// reads the HTML without running that script (X's card crawler, Grok reading a
// link it was asked about, a chat unfurler) saw the generic "Anatomy" landing
// card, so a shared turbofan and a shared carburetor unfurled identically.
//
// This module rewrites the shell's head per request with the design's own
// title, description, canonical, Open Graph and Twitter tags, a
// summary_large_image card whose image is the design's own line drawing
// (api/anatomy-og.js), and a schema.org LearningResource node. Like
// server/creation-head.mjs it runs for every User-Agent, so the head a crawler
// reads is the head a visitor gets.
//
// It also gives the page the explanation itself in a form that needs no
// script: the guided tour and the named parts go into the LearningResource
// node (hasPart, about) and into one <noscript> outline at the top of <main>.
// The @grok bot browses a link it is asked about, and "how does it work, step
// by step?" cannot be answered from a part count. A browser that runs the page
// script never renders the outline; it draws the same tour in 3D.
//
// Safety rules: never fail a page (any miss or error returns null and the
// caller serves the untouched shell), never block on a slow lookup (one short
// timeout), bounded memory (small TTL cache, oldest evicted).

import { scriptJson, truncateChars } from '../api/_lib/safe-text.js';

const ORIGIN = 'https://three.ws';
const LOOKUP_TIMEOUT_MS = 2500;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 500;
const PATH_RE = /^\/anatomy\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i;

/** The design id a request path names, or null when it is not /anatomy/:id. */
export function anatomyIdFromPath(pathname) {
	const m = PATH_RE.exec(String(pathname || ''));
	return m ? m[1].toLowerCase() : null;
}

/** The card image for a design: a 1200x630 PNG of its isometric line drawing. */
export function anatomyOgImageUrl(id, origin = ORIGIN) {
	return `${origin}/api/anatomy-og?id=${encodeURIComponent(String(id).toLowerCase())}`;
}

function htmlEscape(s) {
	return String(s ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function clip(s, max) {
	const t = String(s || '').trim().replace(/\s+/g, ' ');
	if (t.length <= max) return t;
	const cut = truncateChars(t, max);
	const space = cut.lastIndexOf(' ');
	return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, '')}…`;
}

// Bounds on the script-free outline, so one oversized design cannot bloat the page.
const OUTLINE_MAX_STEPS = 24;
const OUTLINE_MAX_PARTS = 60;

/** The tour and parts a reader without scripts gets: clipped text, empty entries dropped. */
export function anatomyOutline(design) {
	const spec = design.spec || {};
	const list = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
	const steps = list(spec.steps, OUTLINE_MAX_STEPS)
		.map((s) => ({ title: clip(s?.title, 120), body: clip(s?.body, 600) }))
		.filter((s) => s.title);
	const parts = list(spec.parts, OUTLINE_MAX_PARTS)
		.map((p) => ({ name: clip(p?.name, 80), description: clip(p?.description, 280) }))
		.filter((p) => p.name);
	return { summary: clip(spec.summary, 600), steps, parts };
}

/** Everything the head needs, from one public design (GET /api/anatomy?id= shape). */
export function anatomyMeta(design, origin = ORIGIN) {
	const id = String(design.id).toLowerCase();
	const pageUrl = `${origin}/anatomy/${id}`;
	const name = clip(design.title || design.spec?.title || 'A machine', 90);
	const parts = Number(design.stats?.parts) || (Array.isArray(design.spec?.parts) ? design.spec.parts.length : 0);
	const steps = Number(design.stats?.steps) || (Array.isArray(design.spec?.steps) ? design.spec.steps.length : 0);
	const counts = [parts ? `${parts} labelled parts` : '', steps ? `a ${steps} step guided tour` : ''].filter(Boolean).join(' and ');
	const lead = design.subtitle ? `${clip(design.subtitle, 140)}. ` : '';
	const by = design.creatorUsername ? ` Built by @${design.creatorUsername}.` : '';
	const description = `${lead}How a ${name} works, as an interactive 3D cutaway${counts ? ` with ${counts}` : ''}: rotate it, cut it open and explode it on three.ws.${by}`;
	// Featured designs ship a card rendered from the live cutaway itself.
	const image = design.ogImage ? `${origin}${design.ogImage}` : anatomyOgImageUrl(id, origin);
	const outline = anatomyOutline(design);
	const imageAlt = design.ogImage ? `Rendered 3D cutaway of the ${name}, on three.ws Anatomy` : `Isometric line drawing of the ${name}, on three.ws Anatomy`;
	const jsonLd = {
		'@type': 'LearningResource',
		'@id': `${pageUrl}#design`,
		name,
		description,
		url: pageUrl,
		image,
		learningResourceType: 'Interactive 3D cutaway',
		educationalUse: 'Explanation of how a machine works',
		isAccessibleForFree: true,
		inLanguage: 'en',
		...(design.createdAt ? { dateCreated: design.createdAt } : {}),
		...(design.creatorUsername
			? { creator: { '@type': 'Person', name: design.creatorUsername, url: `${origin}/u/${encodeURIComponent(design.creatorUsername)}` } }
			: {}),
		isPartOf: { '@type': 'WebApplication', name: 'Anatomy', url: `${origin}/anatomy` },
		...(outline.summary ? { abstract: outline.summary } : {}),
		...(outline.steps.length
			? { hasPart: outline.steps.map((s, i) => ({ '@type': 'CreativeWork', position: i + 1, name: s.title, ...(s.body ? { text: s.body } : {}) })) }
			: {}),
		...(outline.parts.length
			? { about: outline.parts.map((p) => ({ '@type': 'Thing', name: p.name, ...(p.description ? { description: p.description } : {}) })) }
			: {}),
	};
	return { pageUrl, name, title: `${name} · How it works · three.ws Anatomy`, description, image, imageAlt, jsonLd, outline };
}

function setTag(head, re, tag, missing) {
	if (re.test(head)) return head.replace(re, () => tag);
	missing.push(tag);
	return head;
}

/** The outline as plain HTML for the <noscript> block, or '' when there is nothing to read. */
function outlineHtml(m) {
	const { summary, steps, parts } = m.outline;
	if (!steps.length && !parts.length) return '';
	const stepItems = steps.map((s) => `<li><strong>${htmlEscape(s.title)}.</strong>${s.body ? ` ${htmlEscape(s.body)}` : ''}</li>`);
	const partItems = parts.map((p) =>
		p.description ? `<li><strong>${htmlEscape(p.name)}:</strong> ${htmlEscape(p.description)}</li>` : `<li><strong>${htmlEscape(p.name)}</strong></li>`,
	);
	return [
		'<noscript>',
		'<article class="anp-outline">',
		`<h2>How a ${htmlEscape(m.name)} works</h2>`,
		`<p>${htmlEscape(summary || m.description)}</p>`,
		...(stepItems.length ? ['<h3>Guided tour</h3>', '<ol>', ...stepItems, '</ol>'] : []),
		...(partItems.length ? ['<h3>Parts</h3>', '<ul>', ...partItems, '</ul>'] : []),
		'</article>',
		'</noscript>',
	].join('\n');
}

const metaRe = (attr, key) => new RegExp(`<meta\\b[^>]*\\b${attr}=["']${key}["'][^>]*>`, 'i');

/**
 * Rewrite the anatomy shell for one design: its head, plus the script-free
 * outline at the top of <main>. Pure.
 *
 * @param {string} html     the anatomy.html shell
 * @param {object} design   public design record
 * @param {string} [origin]
 * @returns {string|null}   null when the shell has no <head>
 */
export function rewriteAnatomyHead(html, design, origin = ORIGIN) {
	const headMatch = /<head[^>]*>[\s\S]*?<\/head>/i.exec(html);
	if (!headMatch) return null;
	const m = anatomyMeta(design, origin);
	const t = htmlEscape(m.title);
	const d = htmlEscape(m.description);
	const url = htmlEscape(m.pageUrl);
	const img = htmlEscape(m.image);
	const alt = htmlEscape(m.imageAlt);
	const missing = [];
	let head = headMatch[0];

	head = setTag(head, /<title[^>]*>[\s\S]*?<\/title>/i, `<title>${t}</title>`, missing);
	head = setTag(head, metaRe('name', 'description'), `<meta name="description" content="${d}" />`, missing);
	head = setTag(head, /<link\b[^>]*rel=["']canonical["'][^>]*>/i, `<link rel="canonical" href="${url}" />`, missing);
	head = setTag(head, metaRe('property', 'og:type'), '<meta property="og:type" content="article" />', missing);
	head = setTag(head, metaRe('property', 'og:url'), `<meta property="og:url" content="${url}" />`, missing);
	head = setTag(head, metaRe('property', 'og:title'), `<meta property="og:title" content="${t}" />`, missing);
	head = setTag(head, metaRe('property', 'og:description'), `<meta property="og:description" content="${d}" />`, missing);
	head = setTag(head, metaRe('property', 'og:image'), `<meta property="og:image" content="${img}" />`, missing);
	head = setTag(head, metaRe('property', 'og:image:width'), '<meta property="og:image:width" content="1200" />', missing);
	head = setTag(head, metaRe('property', 'og:image:height'), '<meta property="og:image:height" content="630" />', missing);
	head = setTag(head, metaRe('property', 'og:image:alt'), `<meta property="og:image:alt" content="${alt}" />`, missing);
	head = setTag(head, metaRe('name', 'twitter:card'), '<meta name="twitter:card" content="summary_large_image" />', missing);
	head = setTag(head, metaRe('name', 'twitter:title'), `<meta name="twitter:title" content="${t}" />`, missing);
	head = setTag(head, metaRe('name', 'twitter:description'), `<meta name="twitter:description" content="${d}" />`, missing);
	head = setTag(head, metaRe('name', 'twitter:image'), `<meta name="twitter:image" content="${img}" />`, missing);
	head = setTag(head, metaRe('name', 'twitter:image:alt'), `<meta name="twitter:image:alt" content="${alt}" />`, missing);

	// The shell describes the Anatomy app; this page describes one machine.
	head = head.replace(/<script[^>]*application\/ld\+json[^>]*>[\s\S]*?<\/script>\s*/gi, '');
	missing.push(`<script type="application/ld+json">${scriptJson({ '@context': 'https://schema.org', '@graph': [m.jsonLd] })}</script>`);
	head = head.replace(/<\/head>/i, () => `\t${missing.join('\n\t')}\n</head>`);

	const outline = outlineHtml(m);
	const rest = html.slice(headMatch.index + headMatch[0].length);
	const body = outline ? rest.replace(/<main\b[^>]*>/i, (open) => `${open}\n${outline}`) : rest;
	return html.slice(0, headMatch.index) + head + body;
}

/**
 * Build a cached renderer around a design lookup. Production passes a direct
 * read (loadDesign in api/_lib/anatomy/service.js); the Vite dev server passes
 * a fetch of GET /api/anatomy on its API upstream.
 *
 * @param {object} o
 * @param {(id:string)=>Promise<object|null>} o.loadDesign
 * @param {string} [o.origin]
 * @param {number} [o.ttlMs]
 * @param {number} [o.max]
 * @param {number} [o.timeoutMs]
 * @returns {(pathname:string, html:string)=>Promise<string|null>}
 */
export function createAnatomyHeadRenderer({ loadDesign, origin = ORIGIN, ttlMs = CACHE_TTL_MS, max = CACHE_MAX, timeoutMs = LOOKUP_TIMEOUT_MS }) {
	const cache = new Map();

	async function lookup(id) {
		const hit = cache.get(id);
		if (hit && hit.expires > Date.now()) return hit.design;
		let timer;
		const timeout = new Promise((resolve) => {
			timer = setTimeout(() => resolve(undefined), timeoutMs);
		});
		let design;
		try {
			design = await Promise.race([loadDesign(id), timeout]);
		} finally {
			clearTimeout(timer);
		}
		if (design === undefined) return null;
		const value = design && design.id ? design : null;
		cache.delete(id);
		cache.set(id, { design: value, expires: Date.now() + ttlMs });
		while (cache.size > max) cache.delete(cache.keys().next().value);
		return value;
	}

	return async function renderAnatomyHead(pathname, html) {
		const id = anatomyIdFromPath(pathname);
		if (!id) return null;
		try {
			const design = await lookup(id);
			if (!design) return null;
			return rewriteAnatomyHead(html, design, origin);
		} catch (err) {
			console.error(`[anatomy-head] ${pathname} fell back to the static shell:`, err?.message);
			return null;
		}
	};
}

/** Lookup for a server that holds the database. A missing design is null, not an error. */
export async function loadPublicDesign(id) {
	const { loadDesign } = await import('../api/_lib/anatomy/service.js');
	try {
		return await loadDesign(id);
	} catch (err) {
		if (err?.status === 404 || err?.code === 'not_found') return null;
		throw err;
	}
}

/** Lookup through the public JSON API, for the dev server that proxies /api upstream. */
export function apiDesignLoader(apiBase) {
	return async (id) => {
		const r = await fetch(`${apiBase}/api/anatomy?id=${encodeURIComponent(id)}`, { headers: { accept: 'application/json' } });
		if (r.status === 404) return null;
		if (!r.ok) throw new Error(`anatomy answered ${r.status}`);
		const body = await r.json();
		return body && body.design ? body.design : null;
	};
}

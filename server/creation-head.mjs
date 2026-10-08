// Per-creation <head> for the forge model page (/m/:id).
//
// /m/:id serves one static shell (pages/model.html) for every forge creation,
// and src/model-page.js fills in the model client-side. Anything that reads the
// HTML without running that script saw the same generic "3D Model" title, the
// brand card image, an og:url of /creations, and no structured data at all:
// a link unfurled on X as a stock card, and a model asked "what is this?" about
// a shared link (Grok under a post, an assistant fetching it for a user) had
// nothing to read but a loading skeleton.
//
// This module rewrites the shell's head per request with the creation's own
// title, description, canonical, Open Graph and Twitter tags (a
// summary_large_image card whose image is the PNG render of the model), and a
// schema.org 3DModel node carrying the GLB as its encoding, the render as its
// thumbnail, the creator, the date and the terms (api/_lib/creation-jsonld.js).
//
// It runs for every User-Agent, browsers included. That is deliberate: Grok
// Bot drives a real browser and xAI publishes no fetcher token to match on, so
// a crawler-only branch would miss exactly the reader this exists for. The head
// a crawler gets is therefore byte-for-byte the head a visitor gets.
//
// Safety rules this module holds itself to:
//   - Never fail a page: no creation, a slow or failing lookup, or any error
//     returns null and the caller serves the untouched shell.
//   - Never block on a slow lookup: one short timeout, then fall back.
//   - Bounded memory: a small TTL cache keyed by creation id, oldest evicted.

import { scriptJson, truncateChars } from '../api/_lib/safe-text.js';
import { creationJsonLd, renderPosterUrl, renderableGlb, POSTER_WIDTH, POSTER_HEIGHT } from '../api/_lib/creation-jsonld.js';
// The page's own pure helpers, so the server head and the hydrated page agree
// on which paths are creations and what a creation is called.
import { modelIdFromPath, titleFromPrompt } from '../src/model-lib.js';

const ORIGIN = 'https://three.ws';
const LOOKUP_TIMEOUT_MS = 2500;
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX = 500;

/** The creation id a request path names, or null when it is not /m/:id. */
export function creationIdFromPath(pathname) {
	const id = modelIdFromPath(pathname);
	return id ? id.toLowerCase() : null;
}

function htmlEscape(s) {
	return String(s ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

// Refined and image-to-3D prompts run to hundreds of characters of structured
// spec; a description quotes the opening of it and cuts on a word boundary.
function promptExcerpt(prompt, max = 160) {
	const p = String(prompt || '').trim().replace(/\s+/g, ' ');
	if (p.length <= max) return p;
	const cut = truncateChars(p, max);
	const space = cut.lastIndexOf(' ');
	return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, '')}…`;
}

/**
 * Everything the head needs, derived from one public creation record (the
 * shape both getPublicCreation and GET /api/forge-creation return).
 */
export function creationMeta(creation, origin = ORIGIN) {
	const id = String(creation.id).toLowerCase();
	const pageUrl = `${origin}/m/${id}`;
	const name = titleFromPrompt(creation.prompt);
	const by = creation.creatorUsername ? ` by @${creation.creatorUsername}` : '';
	const description = `3D model${by} on three.ws, generated from the prompt "${promptExcerpt(creation.prompt)}". View it in 3D and AR, download the GLB, or remix it.`;
	// The renderer gets the light delivery variant when it exists, the original
	// otherwise, and neither when both are past its size cap.
	const posterGlb = renderableGlb([
		{ url: creation.web_glb_url, sizeBytes: creation.web_size_bytes },
		{ url: creation.glb_url, sizeBytes: creation.size_bytes },
	]);
	const poster = posterGlb ? renderPosterUrl(origin, posterGlb) : null;
	const image = poster || creation.preview_image_url || `${origin}/og-image.png`;
	const jsonLd = creationJsonLd({
		origin,
		pageUrl,
		name,
		description,
		glbUrl: creation.glb_url,
		glbSizeBytes: creation.size_bytes,
		thumbnailUrl: poster || creation.preview_image_url || null,
		image,
		creator: creation.creatorUsername
			? { username: creation.creatorUsername, displayName: creation.creatorDisplayName }
			: null,
		dateCreated: creation.created_at,
		keywords: creation.model_category && creation.model_category !== 'other' ? [creation.model_category] : [],
	});
	return { pageUrl, title: `${name} · 3D Model · three.ws`, name, description, image, imageIsPoster: Boolean(poster), jsonLd };
}

// Replace a whole tag matched by `re`, or queue it for insertion before
// </head>. Rebuilding the whole tag also drops the shell's data-i18n-attr, so
// the runtime locale swap cannot put the generic string back over this one.
function setTag(head, re, tag, missing) {
	if (re.test(head)) return head.replace(re, () => tag);
	missing.push(tag);
	return head;
}

const metaRe = (attr, key) => new RegExp(`<meta\\b[^>]*\\b${attr}=["']${key}["'][^>]*>`, 'i');

/**
 * Rewrite the model shell's head for one creation. Pure.
 *
 * @param {string} html      the model.html shell
 * @param {object} creation  public creation record
 * @param {string} [origin]
 * @returns {string|null}    null when the shell has no <head>
 */
export function rewriteCreationHead(html, creation, origin = ORIGIN) {
	const headMatch = /<head[^>]*>[\s\S]*?<\/head>/i.exec(html);
	if (!headMatch) return null;
	const m = creationMeta(creation, origin);
	const t = htmlEscape(m.title);
	const d = htmlEscape(m.description);
	const img = htmlEscape(m.image);
	const alt = htmlEscape(`${m.name}, a 3D model on three.ws`);
	const missing = [];
	let head = headMatch[0];

	head = setTag(head, /<title[^>]*>[\s\S]*?<\/title>/i, `<title>${t}</title>`, missing);
	head = setTag(head, metaRe('name', 'description'), `<meta name="description" content="${d}" />`, missing);
	head = setTag(head, /<link\b[^>]*rel=["']canonical["'][^>]*>/i, `<link rel="canonical" href="${htmlEscape(m.pageUrl)}" />`, missing);
	head = setTag(head, metaRe('property', 'og:type'), '<meta property="og:type" content="website" />', missing);
	head = setTag(head, metaRe('property', 'og:url'), `<meta property="og:url" content="${htmlEscape(m.pageUrl)}" />`, missing);
	head = setTag(head, metaRe('property', 'og:title'), `<meta property="og:title" content="${t}" />`, missing);
	head = setTag(head, metaRe('property', 'og:description'), `<meta property="og:description" content="${d}" />`, missing);
	head = setTag(head, metaRe('property', 'og:image'), `<meta property="og:image" content="${img}" />`, missing);
	head = setTag(head, metaRe('property', 'og:image:alt'), `<meta property="og:image:alt" content="${alt}" />`, missing);
	if (m.imageIsPoster) {
		head = setTag(head, metaRe('property', 'og:image:width'), `<meta property="og:image:width" content="${POSTER_WIDTH}" />`, missing);
		head = setTag(head, metaRe('property', 'og:image:height'), `<meta property="og:image:height" content="${POSTER_HEIGHT}" />`, missing);
	} else {
		// A fallback image has its own proportions; claiming 1200x630 for it
		// would make an unfurler crop it wrong.
		head = head.replace(metaRe('property', 'og:image:width'), '').replace(metaRe('property', 'og:image:height'), '');
	}
	head = setTag(head, metaRe('name', 'twitter:card'), '<meta name="twitter:card" content="summary_large_image" />', missing);
	head = setTag(head, metaRe('name', 'twitter:title'), `<meta name="twitter:title" content="${t}" />`, missing);
	head = setTag(head, metaRe('name', 'twitter:description'), `<meta name="twitter:description" content="${d}" />`, missing);
	head = setTag(head, metaRe('name', 'twitter:image'), `<meta name="twitter:image" content="${img}" />`, missing);
	head = setTag(head, metaRe('name', 'twitter:image:alt'), `<meta name="twitter:image:alt" content="${alt}" />`, missing);

	// The shell carries no JSON-LD of its own today; drop any that a build
	// step adds for the shell route so the page never describes two things.
	head = head.replace(/<script[^>]*application\/ld\+json[^>]*>[\s\S]*?<\/script>\s*/gi, '');
	missing.push(
		`<script type="application/ld+json">${scriptJson({ '@context': 'https://schema.org', '@graph': [m.jsonLd] })}</script>`,
	);
	head = head.replace(/<\/head>/i, () => `\t${missing.join('\n\t')}\n</head>`);

	return html.slice(0, headMatch.index) + head + html.slice(headMatch.index + headMatch[0].length);
}

/**
 * Build a cached renderer around a creation lookup. Production passes a direct
 * read of the public creation (api/_lib/forge-store.js getPublicCreation); the
 * Vite dev server passes a fetch of GET /api/forge-creation on its API upstream.
 *
 * @param {object} o
 * @param {(id:string)=>Promise<object|null>} o.loadCreation
 * @param {string} [o.origin]
 * @param {number} [o.ttlMs]
 * @param {number} [o.max]
 * @param {number} [o.timeoutMs]
 * @returns {(pathname:string, html:string)=>Promise<string|null>}
 */
export function createCreationHeadRenderer({
	loadCreation,
	origin = ORIGIN,
	ttlMs = CACHE_TTL_MS,
	max = CACHE_MAX,
	timeoutMs = LOOKUP_TIMEOUT_MS,
}) {
	const cache = new Map();

	async function lookup(id) {
		const hit = cache.get(id);
		if (hit && hit.expires > Date.now()) return hit.creation;
		let timer;
		const timeout = new Promise((resolve) => {
			timer = setTimeout(() => resolve(undefined), timeoutMs);
		});
		let creation;
		try {
			creation = await Promise.race([loadCreation(id), timeout]);
		} finally {
			clearTimeout(timer);
		}
		// undefined is a timeout: do not cache it, the next request retries.
		if (creation === undefined) return null;
		const value = creation && creation.glb_url ? creation : null;
		cache.delete(id);
		cache.set(id, { creation: value, expires: Date.now() + ttlMs });
		while (cache.size > max) cache.delete(cache.keys().next().value);
		return value;
	}

	return async function renderCreationHead(pathname, html) {
		const id = creationIdFromPath(pathname);
		if (!id) return null;
		try {
			const creation = await lookup(id);
			if (!creation) return null;
			return rewriteCreationHead(html, creation, origin);
		} catch (err) {
			console.error(`[creation-head] ${pathname} fell back to the static shell:`, err?.message);
			return null;
		}
	};
}

/** Lookup for a server that holds the database: the same visibility rules as the API. */
export async function loadPublicCreation(id) {
	const { getPublicCreation } = await import('../api/_lib/forge-store.js');
	return getPublicCreation({ id });
}

/** Lookup through the public JSON API, for the dev server that proxies /api upstream. */
export function apiCreationLoader(apiBase) {
	return async (id) => {
		const r = await fetch(`${apiBase}/api/forge-creation?id=${encodeURIComponent(id)}`, {
			headers: { accept: 'application/json' },
		});
		if (r.status === 404) return null;
		if (!r.ok) throw new Error(`forge-creation answered ${r.status}`);
		const body = await r.json();
		return body && body.creation ? body.creation : null;
	};
}

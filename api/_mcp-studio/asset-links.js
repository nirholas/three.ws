// Agent-first asset links: the four plain URLs every asset-returning studio tool
// hands back, so a client that renders no widget still leaves with something it
// can open, download, show and paste.
//
// ChatGPT and Claude draw our viewer widget from structuredContent, but an agent
// with a browser and a file system (Grok Bot, the xAI Responses API, a scripted
// MCP client) sees only JSON and text. For that reader a result is only useful if
// it carries stable, absolute links:
//
//   viewer_url      the interactive viewer page, opens in any browser
//   glb_url         the model file itself, to download or re-host
//   poster_png_url  a rendered PNG of the model (/api/render/glb, CDN-cached a
//                   day), for a reply image, a card, or a markdown embed
//   embed_html      the paste-ready snippet our embed docs ship: <agent-3d> for
//                   an embodied avatar, <model-viewer> for a prop, both pinned
//                   with their integrity hashes
//
// The snippet is the catalog's own (api/_lib/asset-snippets.js), so a generated
// model and a catalog prop embed with byte-identical markup and one place keeps
// the pinned versions current.

import { snippetFor } from '../_lib/asset-snippets.js';

// Square, large enough for a social card or a reply image, and well inside the
// renderer's 2048 px ceiling.
export const POSTER_SIZE = 1024;

// The largest GLB /api/render/glb will render (MAX_GLB_BYTES in api/render/glb.js;
// tests/mcp-studio-asset-links.test.js holds the two equal). A catalog item known
// to be bigger gets its published PNG thumbnail as the poster instead of a render
// link that would answer 413.
export const RENDER_MAX_GLB_BYTES = 10 * 1024 * 1024;

// Kinds that are a body rather than a prop. These embed as <agent-3d> (the
// element that animates, talks and wears a persona); everything else embeds as
// the <model-viewer> tag our browse grids render props with.
const EMBODIED_KINDS = new Set(['avatar', 'rigged model', 'character', 'persona']);

const TITLE_MAX = 80;

function absoluteHttpUrl(url, base) {
	if (typeof url !== 'string' || !url.trim()) return null;
	try {
		const u = new URL(url.trim(), base);
		return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null;
	} catch {
		return null;
	}
}

function cleanTitle(value) {
	const s = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
	return s.length > TITLE_MAX ? `${s.slice(0, TITLE_MAX - 1).trimEnd()}…` : s;
}

/** The rendered-PNG link for a GLB: what a reply image or a card points at. */
export function posterPngUrl(base, glbUrl) {
	return `${base}/api/render/glb?glbUrl=${encodeURIComponent(glbUrl)}&width=${POSTER_SIZE}&height=${POSTER_SIZE}`;
}

function posterFor(base, glb, bytes, thumb) {
	const tooBigToRender = Number(bytes) > RENDER_MAX_GLB_BYTES;
	const pngThumb = typeof thumb === 'string' && /^https:\/\/\S+\.png(?:[?#]\S*)?$/i.test(thumb) ? thumb : null;
	return tooBigToRender && pngThumb ? pngThumb : posterPngUrl(base, glb);
}

/**
 * The four agent-first links for one GLB asset, or null when there is no usable
 * model URL (an animation clip, a job still rendering).
 *
 * @param {object} p
 * @param {string} p.base        Absolute site origin, e.g. https://three.ws.
 * @param {string} p.glbUrl      The model URL; a site-relative path resolves against base.
 * @param {string} [p.kind]      model | mesh | avatar | rigged model | refined model | object | character | persona
 * @param {string} [p.id]        A stable handle (catalog id, persona id); the title fallback.
 * @param {string} [p.title]     Human title (the prompt, the item title, the persona name).
 * @param {boolean} [p.rigged]   A rigged result embeds as an avatar whatever its kind.
 * @param {number} [p.bytes]     GLB size when known (catalog items).
 * @param {string} [p.thumb]     Published PNG thumbnail, the poster for a GLB too big to render.
 * @returns {{ viewer_url: string, glb_url: string, poster_png_url: string, embed_html: string } | null}
 */
export function assetLinks({ base, glbUrl, kind, id, title, rigged = false, bytes = null, thumb = null }) {
	const origin = typeof base === 'string' && /^https?:\/\/[^/\s]+$/i.test(base.replace(/\/+$/, '')) ? base.replace(/\/+$/, '') : null;
	if (!origin) return null;
	const glb = absoluteHttpUrl(glbUrl, `${origin}/`);
	if (!glb) return null;

	const embodied = Boolean(rigged) || EMBODIED_KINDS.has(kind);
	const label = cleanTitle(title) || cleanTitle(id) || (embodied ? '3D avatar' : '3D model');
	const snippet = snippetFor(
		{ kind: embodied ? 'character' : 'object', name: cleanTitle(id) || label, title: label, url: glb },
		embodied ? 'agent-3d' : 'model-viewer',
		origin,
	);

	return {
		viewer_url: `${origin}/viewer?src=${encodeURIComponent(glb)}&title=${encodeURIComponent(label)}`,
		glb_url: glb,
		poster_png_url: posterFor(origin, glb, bytes, thumb),
		embed_html: snippet.code,
	};
}

/**
 * The same links as plain text lines, for the first lines of a tool's text
 * content. The embed snippet is folded onto one line (HTML ignores the
 * whitespace) so every link stays one greppable line.
 *
 * @param {ReturnType<typeof assetLinks>} links
 * @param {string} [indent]  Prefix for each line (a list item's continuation).
 */
export function assetLinksText(links, indent = '') {
	if (!links) return '';
	return [
		`Viewer: ${links.viewer_url}`,
		`GLB: ${links.glb_url}`,
		`Poster PNG: ${links.poster_png_url}`,
		`Embed HTML: ${links.embed_html.replace(/\s*\n\s*/g, ' ')}`,
	]
		.map((line) => indent + line)
		.join('\n');
}

/**
 * Structured data for three.ws creation pages.
 * --------------------------------------------
 * A forge creation (/m/:id, /forge/share/:id), an avatar (/avatars/:id) and an
 * agent (/agents/:id) are all things a person made. When a model reads one of
 * those pages (a search engine, Grok answering "what is this?" under a shared
 * link, an assistant fetching it for a user) the page should say, in a form a
 * machine can parse, what the thing is, where its 3D file lives, what it looks
 * like, who made it, when, and under what terms.
 *
 * Every creation page builds that node here so the shape is the same wherever
 * it appears:
 *
 *   - `encoding`      the GLB itself, as a schema.org MediaObject with the
 *                     registered `model/gltf-binary` media type.
 *   - `thumbnailUrl`  a PNG of the model, rendered by GET /api/render/glb from
 *                     the same GLB, so the picture is the model and not a card.
 *   - `creator`       the three.ws user who made it, when one is on record.
 *   - `license`       the Terms of Service: the creator keeps ownership of what
 *                     they make (section 5) and three.ws displays it under them.
 *
 * Pure functions only: no I/O, safe to import from api/ handlers, server/
 * modules and vite.config.js alike.
 */

export const GLB_MEDIA_TYPE = 'model/gltf-binary';

// The 1.91:1 frame every social card on the platform uses (og:image:width and
// og:image:height on the crawler pages say 1200x630).
export const POSTER_WIDTH = 1200;
export const POSTER_HEIGHT = 630;

/**
 * Absolute URL of the PNG render of a GLB, addressable by link so it can be an
 * og:image, a twitter:image, or a JSON-LD thumbnailUrl. The render endpoint
 * CDN-caches each URL for a day, so a crawler pays for one render per model.
 *
 * @param {string} origin   site origin, e.g. https://three.ws
 * @param {string} glbUrl   absolute http(s) URL of the model
 * @param {{width?:number,height?:number}} [size]
 * @returns {string|null}   null when glbUrl is not an absolute http(s) URL
 */
export function renderPosterUrl(origin, glbUrl, { width = POSTER_WIDTH, height = POSTER_HEIGHT } = {}) {
	if (!isHttpUrl(glbUrl)) return null;
	const q = new URLSearchParams({ glbUrl, width: String(width), height: String(height) });
	return `${origin}/api/render/glb?${q.toString()}`;
}

// GET /api/render/glb refuses a model above this size (MAX_GLB_BYTES there),
// and a refused render is a broken image in a card. Keep the two in step.
export const RENDER_MAX_GLB_BYTES = 10 * 1024 * 1024;

/**
 * The first GLB the renderer will accept, from candidates in preference order
 * (the light web-delivery variant before the full-resolution original). A
 * candidate with an unknown size is accepted: the renderer checks it itself.
 *
 * @param {{url:string|null|undefined,sizeBytes?:number|null}[]} candidates
 * @returns {string|null}
 */
export function renderableGlb(candidates) {
	for (const c of candidates || []) {
		if (!c || !isHttpUrl(c.url)) continue;
		const bytes = Number(c.sizeBytes);
		if (c.sizeBytes != null && Number.isFinite(bytes) && bytes > RENDER_MAX_GLB_BYTES) continue;
		return c.url;
	}
	return null;
}

/** The terms a three.ws creation is published under. */
export function creationLicenseUrl(origin) {
	return `${origin}/legal/tos`;
}

/**
 * schema.org MediaObject for a GLB file.
 *
 * @param {string} glbUrl
 * @param {{sizeBytes?:number|null,name?:string}} [o]
 * @returns {object|null}
 */
export function glbMediaObject(glbUrl, { sizeBytes = null, name } = {}) {
	if (!isHttpUrl(glbUrl)) return null;
	const node = { '@type': 'MediaObject', contentUrl: glbUrl, encodingFormat: GLB_MEDIA_TYPE };
	if (name) node.name = name;
	const bytes = Number(sizeBytes);
	if (Number.isFinite(bytes) && bytes > 0) node.contentSize = `${Math.round(bytes)} B`;
	return node;
}

/**
 * The structured-data node for one creation. Fields with no value are left
 * out rather than emitted empty, so the node never claims a fact it lacks.
 *
 * @param {object} o
 * @param {string} o.origin
 * @param {string} o.pageUrl             absolute canonical URL of the page
 * @param {string} o.name
 * @param {string} [o.description]
 * @param {string} [o.type]              schema.org type, default 3DModel
 * @param {string|null} [o.glbUrl]       the model file
 * @param {number|null} [o.glbSizeBytes]
 * @param {string|null} [o.thumbnailUrl] override; default is the render of glbUrl
 *                                       when the renderer accepts its size
 * @param {string|null} [o.image]        the page's card image, default thumbnailUrl
 * @param {{username:string,displayName?:string|null}|null} [o.creator]
 * @param {Date|string|null} [o.dateCreated]
 * @param {Date|string|null} [o.dateModified]
 * @param {string[]} [o.keywords]
 * @param {object} [o.extra]             type-specific properties merged last
 * @returns {object}
 */
export function creationJsonLd({
	origin,
	pageUrl,
	name,
	description,
	type = '3DModel',
	glbUrl = null,
	glbSizeBytes = null,
	thumbnailUrl = null,
	image = null,
	creator = null,
	dateCreated = null,
	dateModified = null,
	keywords = [],
	extra = {},
}) {
	const encoding = glbMediaObject(glbUrl, { sizeBytes: glbSizeBytes });
	const posterGlb = encoding ? renderableGlb([{ url: glbUrl, sizeBytes: glbSizeBytes }]) : null;
	const thumb = thumbnailUrl || (posterGlb ? renderPosterUrl(origin, posterGlb) : null);
	const node = {
		'@type': type,
		'@id': pageUrl,
		name,
		url: pageUrl,
	};
	if (description) node.description = description;
	if (image || thumb) node.image = image || thumb;
	if (thumb) node.thumbnailUrl = thumb;
	if (encoding) {
		node.encoding = [encoding];
		// A 3DModel IS the file, so it also carries the file's media type. For
		// any other type (an agent is software that has a body) the format
		// belongs to the encoding alone.
		if (type === '3DModel') node.encodingFormat = GLB_MEDIA_TYPE;
	}
	const person = creatorNode(origin, creator);
	if (person) {
		node.creator = person;
		node.author = person;
	}
	const created = isoDay(dateCreated);
	if (created) node.dateCreated = created;
	const modified = isoDay(dateModified);
	if (modified) node.dateModified = modified;
	if (Array.isArray(keywords) && keywords.length) node.keywords = keywords.join(', ');
	node.license = creationLicenseUrl(origin);
	node.isFamilyFriendly = true;
	node.publisher = { '@type': 'Organization', name: 'three.ws', url: origin };
	return { ...node, ...extra };
}

function creatorNode(origin, creator) {
	const username = creator && typeof creator.username === 'string' ? creator.username.trim() : '';
	if (!username) return null;
	return {
		'@type': 'Person',
		name: creator.displayName ? String(creator.displayName) : `@${username}`,
		alternateName: `@${username}`,
		url: `${origin}/u/${encodeURIComponent(username)}`,
	};
}

/** YYYY-MM-DD, or '' for a missing or unparseable date. */
export function isoDay(v) {
	if (!v) return '';
	const t = v instanceof Date ? v : new Date(v);
	return Number.isNaN(t.getTime()) ? '' : t.toISOString().slice(0, 10);
}

function isHttpUrl(u) {
	return typeof u === 'string' && /^https?:\/\/[^\s]+$/i.test(u);
}

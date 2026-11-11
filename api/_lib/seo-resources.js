/**
 * The public resource types three.ws asks search engines to index.
 * ----------------------------------------------------------------
 * One definition of "which URL does this row live at" and "how is a sitemap
 * file named", shared by the sitemap index (api/sitemap.js), the per-type
 * child sitemaps (api/sitemap/[type].js) and the IndexNow pipeline
 * (api/_lib/indexnow.js), so a URL submitted to Bing is always the same URL
 * the sitemap lists and the page declares as its canonical.
 *
 * Pure: no I/O.
 */

/** sitemaps.org caps a single sitemap file at 50,000 URLs. */
export const SITEMAP_PAGE_SIZE = 50_000;

/** Entity types whose sitemap is paged from the database by id cursor. */
export const PAGED_SITEMAP_TYPES = Object.freeze(['agents', 'avatars', 'creations', 'widgets', 'profiles']);

/** Sitemap types that always fit in one file. */
export const SINGLE_SITEMAP_TYPES = Object.freeze(['core', 'news']);

export const SITEMAP_TYPES = Object.freeze([
	'core',
	'agents',
	'avatars',
	'creations',
	'widgets',
	'profiles',
	'news',
]);

const PAGED = new Set(PAGED_SITEMAP_TYPES);
const KNOWN = new Set(SITEMAP_TYPES);

/**
 * Parse a child sitemap name as it arrives from the route ("avatars",
 * "avatars.xml", "avatars-2.xml"). Page 1 has exactly one name, the bare type:
 * "avatars-1" is rejected so one file never answers at two URLs, and leading
 * zeros are rejected for the same reason.
 *
 * @param {string} raw
 * @returns {{type:string,page:number}|null}
 */
export function parseSitemapName(raw) {
	const name = String(raw ?? '').replace(/\.xml$/i, '');
	const m = /^([a-z]+)(?:-([2-9]|[1-9][0-9]+))?$/.exec(name);
	if (!m || !KNOWN.has(m[1])) return null;
	if (m[2] && !PAGED.has(m[1])) return null;
	return { type: m[1], page: m[2] ? Number(m[2]) : 1 };
}

/** The file name of page `page` (1-based) of a sitemap type. */
export function sitemapFileName(type, page = 1) {
	return page > 1 ? `${type}-${page}.xml` : `${type}.xml`;
}

/** Row offset of the first row of a 1-based sitemap page. */
export function sitemapPageOffset(page) {
	return (Math.max(1, Math.floor(page)) - 1) * SITEMAP_PAGE_SIZE;
}

/** Public resource types IndexNow and the sitemaps both cover. */
export const RESOURCE_TYPES = Object.freeze(['page', 'agent', 'avatar', 'creation', 'widget', 'profile']);

/**
 * Absolute canonical URL of one public resource.
 *
 * @param {string} origin  e.g. https://three.ws
 * @param {'page'|'agent'|'avatar'|'creation'|'widget'|'profile'} type
 * @param {string} key     id, username, or (for 'page') the path
 * @returns {string|null}  null when the key cannot name a page
 */
export function resourceUrl(origin, type, key) {
	const k = String(key ?? '').trim();
	if (!k) return null;
	switch (type) {
		case 'page':
			return k.startsWith('/') && !k.includes(':') ? `${origin}${k}` : null;
		case 'agent':
			return `${origin}/agents/${encodeURIComponent(k)}`;
		case 'avatar':
			return `${origin}/avatars/${encodeURIComponent(k)}`;
		case 'creation':
			// /m/:id is lowercase-only in the route and in the page's canonical.
			return `${origin}/m/${encodeURIComponent(k.toLowerCase())}`;
		case 'widget':
			return `${origin}/w/${encodeURIComponent(k)}`;
		case 'profile':
			// Stored casing, matching every `/u/${username}` link the app renders.
			return `${origin}/u/${k}`;
		default:
			return null;
	}
}

/** YYYY-MM-DD of a timestamp, or null when there is no real timestamp. */
export function sitemapDate(v) {
	if (!v) return null;
	const t = v instanceof Date ? v : new Date(v);
	return Number.isNaN(t.getTime()) ? null : t.toISOString().slice(0, 10);
}

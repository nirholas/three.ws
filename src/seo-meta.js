// Crawler-facing <head> state for pages the router builds from a template.
//
// One HTML file backs an unbounded URL space on this site: /coin/:id, /m/:id,
// /signals/:id and friends all render the same shell and fill it in from an API
// call. Two things follow, and neither is optional if the page should rank.
//
//   1. A canonical baked into the file would name the template, not the page,
//      so the shell ships without one and the controller sets a self-referential
//      canonical once it knows which entity it is showing. Google reads the
//      rendered DOM, so a canonical written here counts.
//
//   2. When the entity does not exist, the shell still answers 200 with an
//      apology in the body: a soft 404. The router cannot know, but the
//      controller does, so it marks the page noindex the moment it renders that
//      state. The URL then leaves the index as "excluded by noindex" instead of
//      accumulating as "soft 404".

const ORIGIN = 'https://three.ws';

/**
 * Point this page's canonical at `path` (default: the URL being viewed, minus
 * query and hash). Creates the tag when the shell shipped without one.
 *
 * @param {string} [path] absolute path, leading slash included
 */
export function setCanonical(path = location.pathname) {
	let link = document.querySelector('link[rel="canonical"]');
	if (!link) {
		link = document.createElement('link');
		link.rel = 'canonical';
		document.head.appendChild(link);
	}
	link.href = `${ORIGIN}${path}`;
}

/**
 * Declare this URL unindexable, for a view that renders "not found" over a 200.
 * `follow` is kept so the links out of the empty state still carry the crawler
 * somewhere useful. Also drops any canonical the page set earlier: a canonical
 * on a noindex page only muddies which URL the directive applies to.
 */
export function markNoindex() {
	let meta = document.querySelector('meta[name="robots"]');
	if (!meta) {
		meta = document.createElement('meta');
		meta.name = 'robots';
		document.head.appendChild(meta);
	}
	meta.setAttribute('content', 'noindex, follow');
	document.querySelector('link[rel="canonical"]')?.remove();
}

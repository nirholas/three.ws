// thumb-fallback.js: shared broken-thumbnail fallback wiring.
//
// Renderers that build a container's markup as one HTML string
// (`.map(...).join('')` assigned to `.innerHTML`) have no live <img> node at
// template-build time to attach an error listener to, unlike a renderer that
// creates a single DOM node up front and can call
// `img.addEventListener('error', ...)` directly (see
// src/marketplace-gallery.js). Tag the <img> with its fallback markup
// instead and wire one delegated listener on the container after insertion.
//
// The DOM `error` event does not bubble, so a listener on an ancestor only
// ever sees it if it is added on the capture phase.

const ATTR = 'data-thumb-fallback';

// `esc` is the caller's own HTML-escaper (every call site already has one);
// passing it in keeps the escaping consistent with the rest of that file's
// template instead of duplicating an escaper here.
export function thumbFallbackAttr(fallbackHtml, esc) {
	return `${ATTR}="${esc(fallbackHtml)}"`;
}

// Call once per container, any time after its markup (or appended children)
// are in place. One call wires every current AND future
// <img data-thumb-fallback> inside root, including rows added by later
// pagination or a refresh. Safe to call again on the same root: it is a
// no-op after the first call, so repeated renders of the same container
// never pile up duplicate listeners.
export function wireThumbFallback(root) {
	if (root.dataset.thumbFallbackWired) return;
	root.dataset.thumbFallbackWired = '1';
	root.addEventListener(
		'error',
		(event) => {
			const img = event.target;
			if (!img || img.tagName !== 'IMG' || !img.hasAttribute(ATTR)) return;
			const fallback = img.getAttribute(ATTR);
			// Remove before swapping: a failure on the fallback's own markup (if
			// it somehow contains another <img>) carries no data-thumb-fallback
			// of its own, so it cannot re-enter this branch and loop.
			img.removeAttribute(ATTR);
			img.outerHTML = fallback;
		},
		true,
	);
}

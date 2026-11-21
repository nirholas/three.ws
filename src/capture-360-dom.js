// The one DOM helper the /capture 360 page builds its markup with. It lives
// apart from capture-360.js (which boots the page on import) so it can be
// unit-tested under jsdom (tests/capture-360-dom.test.js).

/** createElement with attributes, `on*` listeners and children. */
export function h(tag, attrs = {}, ...kids) {
	const el = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (v == null || v === false) continue;
		if (k === 'class') el.className = v;
		else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
		else el.setAttribute(k, v === true ? '' : v);
	}
	for (const kid of kids.flat()) {
		// Optional children are written `cond ? node : null`; skip the misses.
		if (kid == null || kid === false) continue;
		el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
	}
	return el;
}

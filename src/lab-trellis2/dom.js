// Tiny DOM helpers for the TRELLIS.2 lab. Kept apart from main.js (which boots
// the page on import) so they can be unit tested under jsdom.

export const $ = (sel, root = document) => root.querySelector(sel);

export function el(tag, attrs = {}, ...children) {
	const node = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (v == null || v === false) continue;
		if (k === 'class') node.className = v;
		else if (k === 'text') node.textContent = v;
		else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
		else node.setAttribute(k, v === true ? '' : v);
	}
	node.append(...children.filter((c) => c != null));
	return node;
}

// Replace a node's children. Optional children are passed as null (or false),
// which replaceChildren would otherwise print as text.
export function fill(node, ...children) {
	node.replaceChildren(...children.filter((c) => c != null && c !== false));
	return node;
}

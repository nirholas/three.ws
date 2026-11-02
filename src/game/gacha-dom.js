// Tiny DOM builder for the card gacha modal (gacha-ui.js). Props understood:
// class, text, hidden, a style object (custom properties included), on*
// listeners, and plain attributes (true becomes an empty attribute, null and
// false are skipped). Kids may be strings, nodes, null or false.

// Custom properties (--ga-tier, --ga-glow) only take effect through
// setProperty: assigning them onto the style object is silently ignored.
function setStyle(n, style) {
	for (const [prop, value] of Object.entries(style)) {
		if (value == null || value === false) continue;
		if (prop.startsWith('--')) n.style.setProperty(prop, String(value));
		else n.style[prop] = value;
	}
}

export function el(tag, props = {}, kids = []) {
	const n = document.createElement(tag);
	for (const [k, v] of Object.entries(props)) {
		if (k === 'class') n.className = v;
		else if (k === 'text') n.textContent = v;
		else if (k === 'hidden') n.hidden = !!v;
		else if (k === 'style' && typeof v === 'object') setStyle(n, v);
		else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
		else if (v != null && v !== false) n.setAttribute(k, v === true ? '' : v);
	}
	for (const kid of [].concat(kids)) if (kid != null && kid !== false) n.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
	return n;
}

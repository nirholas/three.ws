// Tiny DOM helpers shared by the /glass views. All text goes through textContent,
// so agent names and captions from the network never become markup.

export function el(tag, props = {}, ...kids) {
	const n = document.createElement(tag);
	for (const [k, v] of Object.entries(props)) {
		if (v == null || v === false) continue;
		if (k === 'class') n.className = v;
		else if (k === 'text') n.textContent = v;
		else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
		else n.setAttribute(k, v === true ? '' : String(v));
	}
	for (const kid of kids.flat()) if (kid != null) n.append(kid);
	return n;
}

export function button(label, onClick, extra = {}) {
	return el('button', { type: 'button', class: 'g-btn', onclick: onClick, ...extra }, label);
}

export function skeleton(rows = 3) {
	return el('div', { 'aria-busy': 'true', 'aria-label': 'Loading' }, Array.from({ length: rows }, () => el('div', { class: 'g-skel' })));
}

export function notice(title, body, ...actions) {
	return el('section', { class: 'g-notice' },
		el('h1', { class: 'g-title', text: title }),
		body ? el('p', { class: 'g-sub', text: body }) : null,
		el('div', { class: 'g-row' }, actions));
}

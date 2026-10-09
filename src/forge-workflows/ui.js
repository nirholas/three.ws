// Forge Workflows: small DOM helpers shared by the editor, inspector and page.

/**
 * Build an element. `attrs` keys: class, text, html is not supported on purpose
 * (every string goes in as text), on:{event:fn}, dataset:{}, style:{}, and any
 * other key becomes an attribute (false/null/undefined skip it, true sets "").
 */
export function h(tag, attrs = {}, ...children) {
	const el = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs || {})) {
		if (v === false || v === null || v === undefined) continue;
		if (k === 'class') el.className = v;
		else if (k === 'text') el.textContent = v;
		else if (k === 'on') for (const [ev, fn] of Object.entries(v)) el.addEventListener(ev, fn);
		else if (k === 'dataset') Object.assign(el.dataset, v);
		else if (k === 'style') Object.assign(el.style, v);
		else if (k === 'value') el.value = v;
		else if (k === 'checked') el.checked = Boolean(v);
		else el.setAttribute(k, v === true ? '' : String(v));
	}
	for (const c of children.flat()) {
		if (c === null || c === undefined || c === false) continue;
		el.append(c instanceof Node ? c : document.createTextNode(String(c)));
	}
	return el;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
export function svg(tag, attrs = {}) {
	const el = document.createElementNS(SVG_NS, tag);
	for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, String(v));
	return el;
}

/** Inline icon from a path list (24px grid, stroke = currentColor). */
export function icon(paths, size = 16) {
	const el = svg('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' });
	for (const d of paths) el.append(svg('path', { d }));
	return el;
}

export const ICONS = {
	play: ['M7 4v16l13-8z'],
	stop: ['M6 6h12v12H6z'],
	undo: ['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'],
	redo: ['m15 14 5-5-5-5', 'M20 9H9.5a5.5 5.5 0 0 0 0 11H13'],
	upload: ['M12 15V3', 'm7 8 5-5 5 5', 'M5 21h14'],
	download: ['M12 3v12', 'm7 10 5 5 5-5', 'M5 21h14'],
	grid: ['M3 3h7v7H3z', 'M14 3h7v7h-7z', 'M3 14h7v7H3z', 'M14 14h7v7h-7z'],
	fit: ['M3 8V3h5', 'M21 8V3h-5', 'M3 16v5h5', 'M21 16v5h-5'],
	plus: ['M12 5v14', 'M5 12h14'],
	minus: ['M5 12h14'],
	trash: ['M3 6h18', 'M8 6V4h8v2', 'M6 6l1 14h10l1-14'],
	retry: ['M3 12a9 9 0 1 0 3-6.7', 'M3 4v5h5'],
	check: ['M5 12l5 5L20 7'],
	x: ['M6 6l12 12', 'M18 6 6 18'],
	alert: ['M12 9v4', 'M12 17h.01', 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'],
	chip: ['M9 3v2', 'M15 3v2', 'M9 19v2', 'M15 19v2', 'M3 9h2', 'M3 15h2', 'M19 9h2', 'M19 15h2', 'M6 5h12v14H6z'],
	link: ['M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7', 'M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7'],
};

/** Polite live-region announcer for screen readers. */
let liveRegion = null;
export function announce(message) {
	if (!liveRegion) {
		liveRegion = h('div', { class: 'fw-sr-only', 'aria-live': 'polite', role: 'status' });
		document.body.append(liveRegion);
	}
	liveRegion.textContent = '';
	requestAnimationFrame(() => {
		liveRegion.textContent = message;
	});
}

/** Transient toast in the corner. */
export function toast(message, { tone = 'info', timeout = 4200 } = {}) {
	let host = document.querySelector('.fw-toasts');
	if (!host) {
		host = h('div', { class: 'fw-toasts' });
		document.body.append(host);
	}
	const t = h('div', { class: `fw-toast is-${tone}`, role: tone === 'error' ? 'alert' : 'status' }, message);
	host.append(t);
	requestAnimationFrame(() => t.classList.add('is-in'));
	setTimeout(() => {
		t.classList.remove('is-in');
		t.addEventListener('transitionend', () => t.remove(), { once: true });
		setTimeout(() => t.remove(), 400);
	}, timeout);
}

export function formatSeconds(sec) {
	const s = Math.max(0, Math.round(sec));
	if (s < 60) return `${s}s`;
	return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
export const MOD = isMac ? '⌘' : 'Ctrl';

/** True when keyboard focus is inside a text field, where shortcuts must not fire. */
export function typingInField(target) {
	const el = target instanceof Element ? target : null;
	if (!el) return false;
	return Boolean(el.closest('input, textarea, select, [contenteditable="true"]'));
}

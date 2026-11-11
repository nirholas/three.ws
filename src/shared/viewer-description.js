// Text alternative for a 3D canvas (WCAG 1.1.1 and 2.1.1).
//
// A WebGL canvas is opaque to assistive technology, so every viewer canvas is
// exposed as role="img" with an accessible name that says WHAT it shows (the
// agent or model, plus the first sentence of its description) and HOW to drive
// it without a pointer (the keyboard orbit in src/viewer.js). Kept pure and
// dependency-free so the viewer, the <agent-3d> element and the iframe embed
// all build the same sentence.

export const KEYBOARD_HINT = 'Focus and use the arrow keys to orbit, plus and minus to zoom.';

const MAX_SUMMARY = 180;

function clean(text) {
	return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
}

function withPeriod(text) {
	return /[.!?…]$/.test(text) ? text : `${text}.`;
}

// First sentence, capped so a long bio never turns the canvas name into an essay.
function summarize(description) {
	const text = clean(description);
	if (!text) return '';
	const match = text.match(/^.+?[.!?](?=\s|$)/);
	let sentence = match ? match[0] : text;
	if (sentence.length > MAX_SUMMARY) {
		const cut = sentence.slice(0, MAX_SUMMARY);
		const space = cut.lastIndexOf(' ');
		sentence = `${(space > MAX_SUMMARY / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:]+$/, '')}…`;
	}
	return withPeriod(sentence);
}

export function describe3dCanvas({ name, description, alt, kind = '3D avatar' } = {}) {
	const explicit = clean(alt);
	if (explicit) {
		return explicit.endsWith(KEYBOARD_HINT) ? explicit : `${withPeriod(explicit)} ${KEYBOARD_HINT}`;
	}
	const title = clean(name);
	if (!title) return `3D model viewer. ${KEYBOARD_HINT}`;
	const summary = summarize(description);
	return [`${title}, ${kind}.`, summary, KEYBOARD_HINT].filter(Boolean).join(' ');
}

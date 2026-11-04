// Neural Band d-pad model for the /glass web app. The band reaches the lens
// browser as arrow keys, Enter (pinch) and Escape (double pinch); a thumb-swipe
// scrub arrives as pointer drag. This module maps those to intents and owns a
// wrapping focus ring, with no DOM dependency so Node can test it.

export const KEY_INTENTS = Object.freeze({
	ArrowUp: 'prev',
	ArrowLeft: 'prev',
	ArrowDown: 'next',
	ArrowRight: 'next',
	Enter: 'select',
	' ': 'select',
	Escape: 'back',
	Backspace: 'back',
});

export function intentForKey(key) {
	return KEY_INTENTS[key] || null;
}

export function createFocusRing(size = 0) {
	let count = Math.max(0, size | 0);
	let index = 0;
	return {
		get index() { return index; },
		get size() { return count; },
		setSize(n) {
			count = Math.max(0, n | 0);
			if (index >= count) index = Math.max(0, count - 1);
			return index;
		},
		move(delta) {
			if (!count) return 0;
			index = (((index + delta) % count) + count) % count;
			return index;
		},
		set(i) {
			if (count) index = Math.min(Math.max(0, i | 0), count - 1);
			return index;
		},
	};
}

// A horizontal or vertical drag becomes one step per `stepPx` travelled, so a
// thumb swipe scrubs through a list the way a scroll wheel would.
export function createScrubber({ stepPx = 48, onStep } = {}) {
	let origin = null;
	let emitted = 0;
	return {
		start(x, y) { origin = { x, y }; emitted = 0; },
		move(x, y) {
			if (!origin) return 0;
			const dx = x - origin.x;
			const dy = y - origin.y;
			const travel = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
			const steps = Math.trunc(travel / stepPx);
			const delta = steps - emitted;
			if (delta !== 0) {
				emitted = steps;
				if (onStep) onStep(delta);
			}
			return delta;
		},
		end() { origin = null; emitted = 0; },
	};
}

// Binds keyboard and pointer input on `root`. `getItems()` returns the focusable
// elements of the current view; the binder keeps real DOM focus on the ring index.
export function bindDpad(root, { getItems, onSelect, onBack } = {}) {
	const ring = createFocusRing(0);
	const apply = () => {
		const items = getItems();
		ring.setSize(items.length);
		const el = items[ring.index];
		if (el && typeof el.focus === 'function') el.focus({ preventScroll: false });
	};
	const scrub = createScrubber({ onStep: (d) => { ring.setSize(getItems().length); ring.move(d); apply(); } });
	const onKey = (e) => {
		const intent = intentForKey(e.key);
		if (!intent) return;
		e.preventDefault();
		const items = getItems();
		ring.setSize(items.length);
		if (intent === 'next') { ring.move(1); apply(); }
		else if (intent === 'prev') { ring.move(-1); apply(); }
		else if (intent === 'select') { if (onSelect) onSelect(items[ring.index] || null, ring.index); }
		else if (intent === 'back') { if (onBack) onBack(); }
	};
	const onDown = (e) => scrub.start(e.clientX, e.clientY);
	const onMove = (e) => scrub.move(e.clientX, e.clientY);
	const onUp = () => scrub.end();
	root.addEventListener('keydown', onKey);
	root.addEventListener('pointerdown', onDown);
	root.addEventListener('pointermove', onMove);
	root.addEventListener('pointerup', onUp);
	root.addEventListener('pointercancel', onUp);
	return {
		ring,
		refocus: apply,
		destroy() {
			root.removeEventListener('keydown', onKey);
			root.removeEventListener('pointerdown', onDown);
			root.removeEventListener('pointermove', onMove);
			root.removeEventListener('pointerup', onUp);
			root.removeEventListener('pointercancel', onUp);
		},
	};
}

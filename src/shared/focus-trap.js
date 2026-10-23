/**
 * Modal focus management for wallet and payment dialogs (W3AG 2.1.2).
 *
 * `aria-modal="true"` is a promise to assistive tech, not an enforcement, so a
 * dialog has to make it real: the page behind it is made `inert` (unreachable
 * by Tab, pointer and screen-reader virtual cursor), Tab cycles inside the
 * dialog, Escape asks it to close, and focus goes back to whatever opened it.
 *
 * One implementation serves every modal. It works for dialogs that live in the
 * light DOM and for ones inside a shadow root (the embeddable payment modal):
 * the inert pass walks from the dialog up through shadow hosts to the document
 * body and marks every sibling that is not on that path.
 */

const FOCUSABLE =
	'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

function parentOf(node) {
	if (node.parentNode instanceof ShadowRoot) return node.parentNode.host;
	return node.parentNode;
}

function deepActiveElement() {
	let active = document.activeElement;
	while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
	return active || null;
}

function isVisible(el) {
	return el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
}

/** Visible, enabled, tabbable controls inside `container`, in DOM order. */
export function focusablesIn(container) {
	return Array.from(container.querySelectorAll(FOCUSABLE)).filter(
		(el) => !el.closest('[inert]') && !el.closest('[hidden]') && isVisible(el),
	);
}

/**
 * Mark everything outside `container` inert. Returns a function that restores
 * only the elements this call changed, so nested modals unwind correctly.
 */
function inertBackground(container) {
	const changed = [];
	let node = container;
	while (node && node !== document.documentElement) {
		const parent = parentOf(node);
		if (!parent) break;
		for (const sib of parent.children) {
			if (sib === node) continue;
			const tag = sib.tagName;
			if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK' || tag === 'TEMPLATE' || tag === 'HEAD') continue;
			if (sib.hasAttribute('inert')) continue;
			sib.setAttribute('inert', '');
			changed.push(sib);
		}
		node = parent;
	}
	return () => {
		for (const el of changed) el.removeAttribute('inert');
	};
}

/**
 * Trap focus inside `container` until the returned handle is released.
 *
 * @param {HTMLElement} container      the dialog element (the box, not the backdrop)
 * @param {object} [opts]
 * @param {() => void} [opts.onEscape] called when Escape is pressed
 * @param {HTMLElement|(() => HTMLElement|null)} [opts.initialFocus] where focus lands first
 * @param {HTMLElement|null} [opts.returnTo] element to refocus on release (default: whatever was focused before)
 * @returns {{ release: (restoreFocus?: boolean) => void }}
 */
export function trapFocus(container, { onEscape, initialFocus, returnTo } = {}) {
	const opener = returnTo || deepActiveElement();
	const restoreBackground = inertBackground(container);
	let released = false;

	const onKeydown = (e) => {
		if (e.key === 'Escape' && onEscape) {
			e.preventDefault();
			e.stopPropagation();
			onEscape();
			return;
		}
		if (e.key !== 'Tab') return;
		const items = focusablesIn(container);
		if (!items.length) {
			e.preventDefault();
			container.focus();
			return;
		}
		const first = items[0];
		const last = items[items.length - 1];
		const active = deepActiveElement();
		const inside = active && container.contains(active);
		if (e.shiftKey && (!inside || active === first)) {
			e.preventDefault();
			last.focus();
		} else if (!e.shiftKey && (!inside || active === last)) {
			e.preventDefault();
			first.focus();
		}
	};
	document.addEventListener('keydown', onKeydown, true);

	const target = typeof initialFocus === 'function' ? initialFocus() : initialFocus;
	const start = target || focusablesIn(container)[0];
	if (start) start.focus();
	const landed = deepActiveElement();
	if (!landed || !container.contains(landed)) {
		if (!container.hasAttribute('tabindex')) container.setAttribute('tabindex', '-1');
		container.focus();
	}

	return {
		release(restoreFocus = true) {
			if (released) return;
			released = true;
			document.removeEventListener('keydown', onKeydown, true);
			restoreBackground();
			if (restoreFocus && opener && opener.isConnected && typeof opener.focus === 'function') {
				opener.focus();
			}
		},
	};
}

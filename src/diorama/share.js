// Diorama share sheet — turns a saved world into a shareable 3D postcard.
//
// `openShare` populates the (already-in-DOM, `#share-panel`) sheet with the real
// permalink the save endpoint returned and wires its three actions: copy the
// link, share to X, and copy an embeddable <iframe> snippet. main.js reveals the
// panel; this module owns its contents and handlers. Idempotent — safe to call
// again for a new world; handlers are re-pointed, not stacked.

import { beaconShareEvent } from '../shared/share-beacon.js';

/** Resolve a possibly-relative permalink to an absolute URL for sharing/embedding. */
function absolute(url) {
	try {
		return new URL(url, window.location.origin).href;
	} catch {
		return String(url || window.location.href);
	}
}

// Copy `text` to the clipboard, with a graceful fallback for insecure contexts.
async function copyText(text) {
	try {
		if (navigator.clipboard && window.isSecureContext) {
			await navigator.clipboard.writeText(text);
			return true;
		}
	} catch {
		/* fall through to legacy path */
	}
	try {
		const ta = document.createElement('textarea');
		ta.value = text;
		ta.setAttribute('readonly', '');
		ta.style.position = 'fixed';
		ta.style.opacity = '0';
		document.body.appendChild(ta);
		ta.select();
		const ok = document.execCommand('copy');
		document.body.removeChild(ta);
		return ok;
	} catch {
		return false;
	}
}

// Flash a "Copied" (or "Copied!") confirmation on a button, then restore its label.
const flashTimers = new WeakMap();
function flash(btn, ok) {
	if (!btn) return;
	if (!btn.dataset.label) btn.dataset.label = btn.textContent;
	clearTimeout(flashTimers.get(btn));
	btn.textContent = ok ? 'Copied ✓' : 'Copy failed';
	btn.classList.toggle('is-copied', ok);
	flashTimers.set(
		btn,
		setTimeout(() => {
			btn.textContent = btn.dataset.label;
			btn.classList.remove('is-copied');
		}, 1600),
	);
}

function embedSnippet(url) {
	return (
		`<iframe src="${url}" width="480" height="360" frameborder="0" ` +
		`allow="fullscreen; xr-spatial-tracking" loading="lazy" ` +
		`title="A 3D diorama on three.ws" style="border-radius:12px;border:0"></iframe>`
	);
}

/**
 * @param {{ diorama?: { title?: string, prompt?: string }, url: string }} opts
 */
export function openShare({ diorama = {}, url } = {}) {
	const href = absolute(url);
	const link = document.getElementById('share-link');
	const copyBtn = document.getElementById('share-copy');
	const xBtn = document.getElementById('share-x');
	const embedBtn = document.getElementById('share-embed');

	if (link) {
		link.value = href;
		// Select-all on focus so a manual copy is one tap.
		link.onfocus = () => link.select();
	}

	if (copyBtn) {
		copyBtn.onclick = async () => {
			beaconShareEvent('diorama_share', 'action');
			flash(copyBtn, await copyText(href));
		};
	}

	if (xBtn) {
		xBtn.onclick = () => {
			beaconShareEvent('diorama_share', 'action');
			const what = diorama.title || diorama.prompt || 'a little 3D world';
			const text = `I spoke a little world into being on three.ws — “${what}”. Explore it in 3D:`;
			const intent =
				'https://twitter.com/intent/tweet?text=' +
				encodeURIComponent(text) +
				'&url=' +
				encodeURIComponent(href);
			window.open(intent, '_blank', 'noopener,noreferrer');
		};
	}

	if (embedBtn) {
		embedBtn.onclick = async () => {
			beaconShareEvent('diorama_share', 'action');
			flash(embedBtn, await copyText(embedSnippet(href)));
		};
	}
}

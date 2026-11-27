/**
 * Mount a risk note as the first child of a page's main content and keep it
 * there. Several pages replace their container's children on every render, so a
 * one-shot insert would vanish; a childList observer puts the note back.
 *
 *   import { mountRiskNoteOnMain } from './shared/risk-note-mount.js';
 *   mountRiskNoteOnMain('trading');
 */
import { mountRiskNote } from './risk-note.js';

/**
 * @param {'token'|'trading'|'launch'|'chance'} kind
 * @param {string} [selector] container selector, defaults to the page's main element.
 */
export function mountRiskNoteOnMain(kind = 'trading', selector = 'main') {
	if (typeof document === 'undefined') return;
	const run = () => {
		const host = document.querySelector(selector) || document.getElementById('app') || document.body;
		mountRiskNote(host, kind);
		if (host.__twsRiskObserver) return;
		const obs = new MutationObserver(() => {
			if (!host.querySelector(`[data-risk-note="${kind}"]`)) mountRiskNote(host, kind);
		});
		obs.observe(host, { childList: true });
		host.__twsRiskObserver = obs;
	};
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
	else run();
}

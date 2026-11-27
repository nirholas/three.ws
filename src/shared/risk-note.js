/**
 * Shared risk disclosure note for token, trading and real-funds surfaces.
 *
 * One component so the wording stays identical everywhere and legal can change
 * it in one place. Each variant links to the full Risk Disclosure.
 *
 *   import { riskNoteHTML, mountRiskNote } from '../shared/risk-note.js';
 *   el.insertAdjacentHTML('afterbegin', riskNoteHTML('trading'));
 *   mountRiskNote(document.querySelector('main'), 'token');
 *
 * Variants:
 *   token    the $THREE token (or any token page): utility, not an investment
 *   trading  signals, copy-trading, ROI and win-rate figures, autonomous trading
 *   launch   coin launching and creator price tools
 *   chance   paid random outcomes (gacha pulls, holder draws)
 */

const STYLE_ID = 'tws-risk-note-styles';
const RISK_URL = '/legal/risk';

export const RISK_NOTE_TEXT = Object.freeze({
	token:
		'$THREE is a utility token used to pay for three.ws features. It is not an investment, gives no right to revenue, profit, dividends or any return, and can lose all of its value. Nothing here is financial advice.',
	trading:
		'Past performance does not predict future results. Figures exclude fees and slippage unless stated. Nothing here is financial advice, and you can lose everything you commit.',
	launch:
		'Launching or trading a coin is high risk and most coins lose all value. Do not promise buyers a return, and do not trade to support your own coin\'s price. Nothing here is financial or legal advice.',
	chance:
		'Outcomes are random and you may receive less value than you paid. Available only to adults where this is lawful. Nothing here is financial advice.',
});

const CSS = `
.tws-risk-note{display:flex;gap:10px;align-items:flex-start;margin:0 0 16px;padding:10px 14px;border:1px solid rgba(250,204,21,.28);background:rgba(250,204,21,.06);border-radius:10px;font-size:12.5px;line-height:1.5;color:inherit;opacity:.92}
.tws-risk-note svg{flex:0 0 auto;width:16px;height:16px;margin-top:1px;color:#facc15}
.tws-risk-note a{color:inherit;text-decoration:underline;text-underline-offset:2px;white-space:nowrap}
.tws-risk-note a:hover{opacity:.8}
.tws-risk-note a:focus-visible{outline:2px solid #facc15;outline-offset:2px;border-radius:3px}
.tws-risk-note a:active{opacity:.65}
`;

/** Inject the note stylesheet once. Idempotent and SSR-safe. */
export function ensureRiskNoteStyles() {
	if (typeof document === 'undefined') return;
	if (document.getElementById(STYLE_ID)) return;
	const style = document.createElement('style');
	style.id = STYLE_ID;
	style.textContent = CSS;
	(document.head || document.documentElement).appendChild(style);
}

/**
 * @param {'token'|'trading'|'launch'|'chance'} kind
 * @returns {string} HTML for the note.
 */
export function riskNoteHTML(kind = 'trading') {
	ensureRiskNoteStyles();
	const text = RISK_NOTE_TEXT[kind] || RISK_NOTE_TEXT.trading;
	return `<aside class="tws-risk-note" role="note" aria-label="Risk disclosure" data-risk-note="${kind}">
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/></svg>
		<span>${text} <a href="${RISK_URL}">Risk Disclosure</a></span>
	</aside>`;
}

/**
 * Prepend the note to a container once. Safe to call on every render.
 * @param {Element|null} container
 * @param {'token'|'trading'|'launch'|'chance'} kind
 */
export function mountRiskNote(container, kind = 'trading') {
	if (!container || container.querySelector(`[data-risk-note="${kind}"]`)) return;
	container.insertAdjacentHTML('afterbegin', riskNoteHTML(kind));
}

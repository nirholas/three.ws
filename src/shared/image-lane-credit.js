// Attribution for images produced by the keyless Pollinations lane. The API
// reports which lane made an image in `provider` (providerLabel in
// api/_lib/ai-image-lanes.js); the credit is shown only for that lane.

const CREDIT_CLASS = 'lane-credit';
const STYLE_ID = 'lane-credit-styles';

function ensureStyles() {
	if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
	const style = document.createElement('style');
	style.id = STYLE_ID;
	style.textContent = `
		.${CREDIT_CLASS} { display: inline-block; margin-left: 8px; font-size: 11px; color: var(--ink-dim, #a1a1aa); text-decoration: underline; text-underline-offset: 2px; border-radius: 4px; transition: color .15s; }
		.${CREDIT_CLASS}:hover { color: var(--ink, #fff); }
		.${CREDIT_CLASS}:active { opacity: .75; }
		.${CREDIT_CLASS}:focus-visible { outline: 2px solid var(--accent, #7c5cff); outline-offset: 2px; }
	`;
	document.head.appendChild(style);
}

export function laneCredit(provider) {
	if (provider !== 'pollinations') return null;
	ensureStyles();
	const a = document.createElement('a');
	a.className = CREDIT_CLASS;
	a.href = 'https://pollinations.ai/';
	a.target = '_blank';
	a.rel = 'noopener noreferrer';
	a.textContent = 'Powered by Pollinations';
	return a;
}

// Put the credit after `node`'s text, replacing any credit from a previous run.
export function appendLaneCredit(node, provider) {
	if (!node) return;
	node.querySelectorAll(`.${CREDIT_CLASS}`).forEach((n) => n.remove());
	const credit = laneCredit(provider);
	if (credit) node.appendChild(credit);
}

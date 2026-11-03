// Phone tools drawer for the corner companion.
//
// Five modules each slot a settings control into the companion's top-right
// chrome: themed transitions (walk-companion-transitions.js), path trail
// (walk-companion.js), click-to-walk (walk-companion-click-to-walk.js),
// narration (walk-companion-narrator.js) and the feedback reporter
// (feedback-companion.js). On a desktop companion (200px wide) they fit in one
// row. On a phone the companion is 112px wide, so the row ran past the avatar's
// left edge, the discs overlapped each other, and two of them stayed at 22px
// because their coarse-pointer rules lose to inline styles.
//
// Below 520px this keeps close and swap in the row, adds one "more" button in
// the third slot, and stacks the five settings controls in a 44px column beside
// a row directly above while it is open. A row, not a column: a column beside
// the avatar ran down into the bottom-left "Getting started" pill. Desktop is untouched: every rule sits inside the
// phone media query and the button is display:none outside it.

export const TOOL_CLASSES = [
	'walk-companion-fx-toggle',
	'walk-companion-trail',
	'walk-companion-c2w',
	'walk-companion-narrate',
	'walk-companion-feedback',
];

export const OPEN_CLASS = 'is-tools-open';
const BUTTON_CLASS = 'walk-companion-tools';
const STYLE_ID = 'walk-companion-tools-style';
const SLOT = 46; // 44px target; the 36px visible discs sit 10px apart

function toolsCss() {
	const all = TOOL_CLASSES.map((c) => `.walk-companion .${c}`).join(',');
	const open = TOOL_CLASSES.map((c) => `.walk-companion.${OPEN_CLASS} .${c}`).join(',');
	const offsets = TOOL_CLASSES.map(
		(c, i) => `.walk-companion.${OPEN_CLASS} .${c}{right:${i * SLOT - 4}px!important}`,
	).join('');
	return (
		`.${BUTTON_CLASS}{display:none}` +
		'@media (max-width:520px){' +
		`.${BUTTON_CLASS}{display:grid;place-items:center;position:absolute;top:-7px;right:53px;z-index:3;` +
		'width:44px;height:44px;padding:0;border:9px solid transparent;border-radius:50%;' +
		'background:rgba(12,14,20,.55);background-clip:padding-box;color:#fff;cursor:pointer;pointer-events:auto;' +
		'-webkit-tap-highlight-color:transparent;transition:background-color .15s ease}' +
		`.${BUTTON_CLASS}:active{background-color:rgba(122,162,255,.6)}` +
		`.${BUTTON_CLASS}[aria-expanded="true"]{background-color:rgba(122,162,255,.85)}` +
		`.${BUTTON_CLASS}:focus-visible{outline:2px solid #7aa2ff;outline-offset:-7px}` +
		`.${BUTTON_CLASS} svg{display:block;width:14px;height:14px}` +
		`${all}{display:none!important}` +
		`${open}{display:grid!important;place-items:center;position:absolute!important;top:-55px!important;bottom:auto!important;left:auto!important;` +
		'width:44px!important;height:44px!important;margin:0!important;border-radius:50%!important;' +
		'border:4px solid transparent!important;background-clip:padding-box!important;opacity:1!important;' +
		'color:#fff!important;font-size:15px!important;box-shadow:none!important}' +
		offsets +
		// A solid tray behind the row: several controls keep a translucent "off"
		// fill, which let page text read through them. Pointer events on the tray
		// keep a tap between two discs from landing on the page underneath.
		`.walk-companion.${OPEN_CLASS}::after{content:"";position:absolute;top:-58px;right:-7px;` +
		`width:${(TOOL_CLASSES.length - 1) * SLOT + 50}px;height:50px;z-index:2;border-radius:25px;` +
		'background:rgba(12,14,20,.92);border:1px solid rgba(255,255,255,.12);box-sizing:border-box;' +
		'-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);pointer-events:auto}' +
		// The bubble and the narration caption open over the same strip the
		// row occupies; the drawer is the thing being used, so they yield.
		`.walk-companion.${OPEN_CLASS} .walk-companion-bubble,.walk-companion.${OPEN_CLASS} .walk-companion-caption{visibility:hidden}` +
		'}'
	);
}

function ensureStyles(doc) {
	if (doc.getElementById(STYLE_ID)) return;
	const s = doc.createElement('style');
	s.id = STYLE_ID;
	s.textContent = toolsCss();
	doc.head.appendChild(s);
}

const DOTS_SVG =
	'<svg viewBox="0 0 14 14" aria-hidden="true" focusable="false">' +
	'<circle cx="2" cy="7" r="1.6" fill="currentColor"/>' +
	'<circle cx="7" cy="7" r="1.6" fill="currentColor"/>' +
	'<circle cx="12" cy="7" r="1.6" fill="currentColor"/></svg>';

export function setToolsOpen(host, open) {
	if (!host) return;
	host.classList.toggle(OPEN_CLASS, open);
	const btn = host.querySelector(`.${BUTTON_CLASS}`);
	if (!btn) return;
	btn.setAttribute('aria-expanded', open ? 'true' : 'false');
	btn.title = open ? 'Hide companion controls' : 'More companion controls';
	btn.setAttribute('aria-label', btn.title);
}

let globalListenersFor = null;

function installGlobalListeners(doc) {
	if (globalListenersFor === doc) return;
	globalListenersFor = doc;
	// A tap anywhere outside the open companion closes the drawer, the same way
	// a native overflow menu dismisses.
	doc.addEventListener(
		'pointerdown',
		(e) => {
			const host = doc.querySelector(`.walk-companion.${OPEN_CLASS}`);
			if (host && !host.contains(e.target)) setToolsOpen(host, false);
		},
		{ capture: true, passive: true },
	);
	doc.addEventListener('keydown', (e) => {
		if (e.key !== 'Escape') return;
		const host = doc.querySelector(`.walk-companion.${OPEN_CLASS}`);
		if (!host) return;
		setToolsOpen(host, false);
		host.querySelector(`.${BUTTON_CLASS}`)?.focus();
	});
}

/**
 * Slot the phone "more" button into a companion host. Idempotent: the host is
 * rebuilt on an avatar swap or playground round-trip, so callers run this on
 * every host they see.
 * @param {HTMLElement|null} host the live `.walk-companion` element
 * @param {Document} [doc]
 */
export function ensureToolsMenu(host, doc = document) {
	if (!host || host.querySelector(`.${BUTTON_CLASS}`)) return;
	ensureStyles(doc);
	installGlobalListeners(doc);
	const btn = doc.createElement('button');
	btn.type = 'button';
	btn.className = BUTTON_CLASS;
	btn.innerHTML = DOTS_SVG;
	btn.addEventListener('click', (e) => {
		e.stopPropagation();
		setToolsOpen(host, !host.classList.contains(OPEN_CLASS));
	});
	// The feedback control opens a panel of its own, so the drawer gets out of
	// its way. It stops propagation on its own click, hence the capture phase.
	host.addEventListener(
		'click',
		(e) => {
			if (e.target instanceof Element && e.target.closest('.walk-companion-feedback')) setToolsOpen(host, false);
		},
		true,
	);
	host.appendChild(btn);
	setToolsOpen(host, false);
}

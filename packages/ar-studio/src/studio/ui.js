// The studio's DOM.
//
// Built in code rather than shipped as an HTML file so the whole surface is one
// import: `createArStudio(document.body)` and you have a working AR studio, with
// no markup to copy, no stylesheet to link, and no ids to keep in sync.
//
// Every control is a real button with a real accessible name, the tab strip
// implements the full ARIA tablist contract (arrow keys, roving tabindex), and
// every dialog is a real `role="dialog"` that takes and returns focus. The
// stylesheet is injected once per document and scoped under `.ars-root`.

import { studioStyles } from './styles.js';

const STYLE_ID = 'ar-studio-styles';

/** Inject the stylesheet once per document. */
export function ensureStyles(doc = document) {
	if (doc.getElementById(STYLE_ID)) return;
	const style = doc.createElement('style');
	style.id = STYLE_ID;
	style.textContent = studioStyles();
	doc.head.appendChild(style);
}

function el(tag, attrs = {}, children = []) {
	const node = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (v === null || v === undefined || v === false) continue;
		if (k === 'class') node.className = v;
		else if (k === 'text') node.textContent = v;
		else if (k === 'html') node.innerHTML = v;
		else if (k === 'hidden') node.hidden = Boolean(v);
		else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
		else node.setAttribute(k, v === true ? '' : String(v));
	}
	for (const child of [].concat(children)) {
		if (child) node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
	}
	return node;
}

export { el };

/**
 * Build the studio's DOM inside `host` and return every node the controller
 * drives. The host keeps whatever children it already had: the studio appends
 * its own root: so it can be mounted inside an existing layout.
 *
 * @param {HTMLElement} host
 * @param {object} cfg  Resolved config (branding, generate, rooms).
 * @returns {Record<string, HTMLElement>}
 */
export function buildUI(host, cfg) {
	ensureStyles(host.ownerDocument || document);

	const t = cfg.branding || {};
	const canGenerate = cfg.generate?.enabled !== false;
	const canRoom = cfg.rooms?.enabled !== false;

	const video = el('video', { class: 'ars-video', playsinline: true, muted: true, 'aria-hidden': 'true' });
	const canvas = el('canvas', { class: 'ars-canvas' });

	// ── Top bar ──────────────────────────────────────────────────────────────
	const back = t.backHref
		? el('a', { class: 'ars-back', href: t.backHref }, [el('span', { 'aria-hidden': 'true', text: '←' }), t.backLabel || 'Back'])
		: null;
	const title = el('span', { class: 'ars-title', text: t.title || 'AR Studio' });
	const count = el('span', { class: 'ars-count', hidden: true, role: 'status', 'aria-live': 'polite' });
	const roomBtn = canRoom
		? el('button', { type: 'button', class: 'ars-icon-btn', 'aria-label': 'Open a shared room so other people can build in this scene with you' }, [
			el('span', { 'aria-hidden': 'true', text: '👥' }),
			el('span', { class: 'ars-room-label', text: 'Share live' }),
			el('span', { class: 'ars-room-code-label', hidden: true }),
		])
		: null;
	const qrBtn = el('button', { type: 'button', class: 'ars-icon-btn', hidden: true, 'aria-label': 'Show a QR code that opens this scene on your phone' }, [
		el('span', { 'aria-hidden': 'true', text: '📱' }), 'Open on phone',
	]);
	// One AR button that always does the best thing this device can do: an
	// immersive WebXR session where that exists, otherwise the device's own AR
	// viewer (Quick Look / Scene Viewer). The label is set at boot, once the
	// capability is known, so it never promises the wrong experience.
	const xrBtn = el('button', { type: 'button', class: 'ars-icon-btn', hidden: true, 'aria-pressed': 'false', 'aria-label': 'View this in augmented reality' }, [
		el('span', { 'aria-hidden': 'true', text: '✦' }),
		el('span', { class: 'ars-ar-label', text: 'AR' }),
	]);
	const cameraBtn = el('button', { type: 'button', class: 'ars-icon-btn', 'aria-pressed': 'false', 'aria-label': 'Turn the camera on to see your models in the room' }, [
		el('span', { 'aria-hidden': 'true', text: '📷' }), 'Camera',
	]);

	const top = el('div', { class: 'ars-top' }, [
		back, title, count,
		el('span', { class: 'ars-spacer' }),
		roomBtn, qrBtn, xrBtn, cameraBtn,
	]);

	// ── Progress chip ────────────────────────────────────────────────────────
	const chip = el('div', { class: 'ars-chip', hidden: true, 'data-state': 'idle', role: 'status', 'aria-live': 'polite' }, [
		el('span', { class: 'ars-spinner', 'aria-hidden': 'true' }),
		el('span', { class: 'ars-chip-label' }),
		el('span', { class: 'ars-chip-elapsed' }),
	]);

	// ── Empty state ──────────────────────────────────────────────────────────
	const emptyCamera = el('button', { type: 'button', class: 'ars-btn ars-btn-primary' }, [
		el('span', { 'aria-hidden': 'true', text: '📷' }), 'Turn on the camera',
	]);
	const emptyAdd = el('button', { type: 'button', class: 'ars-btn', text: 'Browse models' });
	const emptyForge = canGenerate ? el('button', { type: 'button', class: 'ars-btn', text: 'Generate one' }) : null;
	const empty = el('div', { class: 'ars-empty' }, [
		el('div', { class: 'ars-empty-card' }, [
			el('div', { class: 'ars-empty-art', 'aria-hidden': 'true', text: '🪄' }),
			el('h2', { text: 'Put anything in your room' }),
			el('p', {
				text: canGenerate
					? 'Add a model, or describe one and watch it appear. Turn on the camera and it stands on your actual floor.'
					: 'Add a model from the library, then turn on the camera and it stands on your actual floor.',
			}),
			el('div', { class: 'ars-empty-row' }, [emptyCamera, emptyAdd, emptyForge]),
		]),
	]);

	// ── Status + selection ───────────────────────────────────────────────────
	const status = el('div', { class: 'ars-status', hidden: true, role: 'status', 'aria-live': 'polite' });
	const selName = el('span', { class: 'ars-sel-name' });
	const selbar = el('div', { class: 'ars-selbar', hidden: true, role: 'toolbar', 'aria-label': 'Selected model' }, [
		selName,
		el('button', { type: 'button', class: 'ars-icon-btn', 'data-act': 'rotate', 'aria-label': 'Rotate the selected model' }, [el('span', { 'aria-hidden': 'true', text: '⟳' })]),
		el('button', { type: 'button', class: 'ars-icon-btn', 'data-act': 'duplicate', 'aria-label': 'Duplicate the selected model' }, [el('span', { 'aria-hidden': 'true', text: '⧉' })]),
		el('button', { type: 'button', class: 'ars-icon-btn', 'data-act': 'remove', 'aria-label': 'Remove the selected model' }, [el('span', { 'aria-hidden': 'true', text: '✕' })]),
	]);

	// ── Dock ─────────────────────────────────────────────────────────────────
	const addBtn = el('button', { type: 'button', class: 'ars-icon-btn', 'aria-expanded': 'false', 'aria-label': 'Add a model to the scene' }, [
		el('span', { 'aria-hidden': 'true', text: '＋' }), 'Add',
	]);
	const forgeInput = el('input', {
		class: 'ars-forge-input', type: 'text', name: 'prompt', autocomplete: 'off',
		placeholder: 'Describe something to generate…', 'aria-label': 'Describe a 3D model to generate',
		maxlength: '300',
	});
	const forgeGo = el('button', { type: 'submit', class: 'ars-forge-go', 'aria-label': 'Generate this model' }, ['Make']);
	const forgeForm = canGenerate ? el('form', { class: 'ars-forge-form' }, [forgeInput, forgeGo]) : el('span', { class: 'ars-spacer' });
	const photoBtn = el('button', { type: 'button', class: 'ars-icon-btn', disabled: true, 'aria-label': 'Take a photo of the scene' }, [el('span', { 'aria-hidden': 'true', text: '⬤' })]);
	const clearBtn = el('button', { type: 'button', class: 'ars-icon-btn', hidden: true, 'aria-label': 'Remove every model from the scene' }, ['Clear']);
	const dock = el('div', { class: 'ars-dock' }, [addBtn, forgeForm, photoBtn, clearBtn]);

	// ── Tray ─────────────────────────────────────────────────────────────────
	const trayTabs = el('div', { class: 'ars-tabs', role: 'tablist', 'aria-label': 'Model sources' });
	const trayBody = el('div', { class: 'ars-tray-body', role: 'tabpanel', tabindex: '-1' });
	const trayClose = el('button', { type: 'button', class: 'ars-icon-btn', 'aria-label': 'Close the model browser' }, [el('span', { 'aria-hidden': 'true', text: '✕' })]);
	const tray = el('div', { class: 'ars-tray', hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Add a model' }, [
		el('div', { class: 'ars-tray-panel' }, [
			el('div', { class: 'ars-tray-head' }, [el('h2', { text: 'Add a model' }), el('span', { class: 'ars-spacer' }), trayClose]),
			trayTabs,
			trayBody,
		]),
	]);

	// ── QR dialog ────────────────────────────────────────────────────────────
	const qrBox = el('div', { class: 'ars-qr-box' });
	const qrLink = el('a', { class: 'ars-link-out', target: '_blank', rel: 'noopener' });
	const qrClose = el('button', { type: 'button', class: 'ars-btn', text: 'Done' });
	const qrModal = el('div', { class: 'ars-modal', hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Open this scene on your phone' }, [
		el('div', { class: 'ars-dialog' }, [
			el('h2', { text: 'Open this scene on your phone' }),
			el('p', { text: 'Scan it and the same models, in the same arrangement, open on the phone: ready to place in your room.' }),
			qrBox, qrLink, qrClose,
		]),
	]);

	// ── AR hand-off sheet ────────────────────────────────────────────────────
	// The one screen between "I want this in my room" and the device's own AR
	// viewer. It exists because that hand-off is not instant on iOS: the GLB has
	// to become a USDZ first, and Safari will only open Quick Look while the page
	// still holds a user gesture. So the sheet prepares in the background, says
	// so, and then puts a real button under the person's thumb: one tap, straight
	// into ARKit, no dead wait.
	const arThumb = el('span', { class: 'ars-ar-thumb', 'aria-hidden': 'true' });
	const arName = el('span', { class: 'ars-ar-name' });
	const arPicker = el('div', { class: 'ars-ar-picker', hidden: true, role: 'group', 'aria-label': 'Choose which model to place' });
	const arHint = el('p', { class: 'ars-ar-hint' });
	const arStatus = el('p', { class: 'ars-ar-status', role: 'status', 'aria-live': 'polite' });
	const arGo = el('button', { type: 'button', class: 'ars-btn ars-btn-primary ars-ar-go' }, [
		el('span', { class: 'ars-ar-go-icon', 'aria-hidden': 'true', text: '⬡' }),
		el('span', { class: 'ars-ar-go-label', text: 'Place in your space' }),
	]);
	const arXr = el('button', { type: 'button', class: 'ars-btn ars-ar-xr', hidden: true }, [
		el('span', { 'aria-hidden': 'true', text: '✦' }), 'Immersive AR: place the whole scene',
	]);
	const arQr = el('button', { type: 'button', class: 'ars-btn ars-ar-qr', hidden: true }, [
		el('span', { 'aria-hidden': 'true', text: '📱' }), 'Open on your phone',
	]);
	const arClose = el('button', { type: 'button', class: 'ars-btn ars-ar-done', text: 'Done' });
	const arModal = el('div', { class: 'ars-modal', hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Place a model in your space' }, [
		el('div', { class: 'ars-dialog ars-ar-sheet' }, [
			el('h2', { class: 'ars-ar-heading', text: 'Place in your space' }),
			el('div', { class: 'ars-ar-target' }, [arThumb, arName]),
			arPicker,
			arHint,
			arStatus,
			arGo, arXr, arQr, arClose,
		]),
	]);

	// ── Room dialog ──────────────────────────────────────────────────────────
	const roomCreate = el('button', { type: 'button', class: 'ars-btn ars-btn-primary', text: 'Start a shared room' });
	const roomJoinInput = el('input', { class: 'ars-search', type: 'text', placeholder: 'Room code', 'aria-label': 'Room code', maxlength: '20', autocomplete: 'off', spellcheck: 'false' });
	const roomJoinForm = el('form', { class: 'ars-link-row' }, [roomJoinInput, el('button', { type: 'submit', class: 'ars-btn', text: 'Join' })]);
	const roomIdle = el('div', {}, [
		el('p', { text: 'Open a room and anyone who joins sees the same scene. Every move, resize and rotate syncs live.' }),
		el('div', { class: 'ars-dialog-row' }, [roomCreate]),
		el('div', { class: 'ars-divider' }),
		el('p', { text: 'Got a code from someone?' }),
		roomJoinForm,
	]);
	const roomCode = el('div', { class: 'ars-code' });
	const roomPresence = el('p', {});
	const roomQr = el('div', { class: 'ars-qr-box' });
	const roomCopy = el('button', { type: 'button', class: 'ars-btn ars-btn-primary', text: 'Copy invite link' });
	const roomLeave = el('button', { type: 'button', class: 'ars-btn', text: 'Leave room' });
	const roomLive = el('div', { hidden: true }, [
		roomCode, roomPresence, roomQr,
		el('div', { class: 'ars-dialog-row' }, [roomCopy, roomLeave]),
	]);
	const roomClose = el('button', { type: 'button', class: 'ars-btn', text: 'Close' });
	const roomModal = el('div', { class: 'ars-modal', hidden: true, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Shared room' }, [
		el('div', { class: 'ars-dialog' }, [
			el('h2', { text: 'Build together' }),
			roomIdle, roomLive, roomClose,
		]),
	]);

	const hud = el('div', { class: 'ars-hud' }, [top, empty, status, chip, selbar, dock, tray, qrModal, arModal, roomModal]);
	const root = el('div', { class: 'ars-root' }, [video, canvas, hud]);
	if (t.accent) root.style.setProperty('--ars-accent', t.accent);
	host.appendChild(root);
	// The studio fills its host absolutely, so the host has to be a positioned box
	// with a real height. A statically-positioned or zero-height container would
	// otherwise render a canvas nobody can see or click, which reads as "the
	// library is broken" rather than "my div has no height".
	const style = host.ownerDocument.defaultView?.getComputedStyle(host);
	if (style && style.position === 'static') host.style.position = 'relative';
	if (host !== host.ownerDocument.body && host.clientHeight < 80 && !host.style.height) {
		host.style.minHeight = host.style.minHeight || '70vh';
	}

	return {
		root, video, canvas, hud, top, title, count, status, chip,
		cameraBtn, xrBtn, qrBtn, roomBtn, addBtn, photoBtn, clearBtn,
		forgeForm: canGenerate ? forgeForm : null, forgeInput: canGenerate ? forgeInput : null, forgeGo: canGenerate ? forgeGo : null,
		empty, emptyCamera, emptyAdd, emptyForge,
		selbar, selName,
		tray, trayTabs, trayBody, trayClose,
		qrModal, qrBox, qrLink, qrClose,
		arModal, arThumb, arName, arPicker, arHint, arStatus, arGo, arXr, arQr, arClose,
		roomModal, roomIdle, roomLive, roomCreate, roomJoinForm, roomJoinInput,
		roomCode, roomPresence, roomQr, roomCopy, roomLeave, roomClose,
	};
}

/** Escape a string for interpolation into innerHTML. */
export function esc(s) {
	return String(s ?? '').replace(/[&<>"']/g, (c) => ({
		'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
	}[c]));
}

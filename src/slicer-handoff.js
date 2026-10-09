// "Open in OrcaSlicer" and friends: hand a stored creation to a desktop slicer.
//
// Adapted from Modly (https://github.com/lightningpixel/modly), MIT License,
// Copyright (c) 2026 Lightning Pixel. Modly's orcaSlicerLink.ts established the
// contract this follows: OrcaSlicer registers `orcaslicer://open?file=<url>`,
// downloads the http(s) URL it is given, and picks the importer from the URL's
// FINAL path segment, so the file URL must end in a literal `model.stl` with no
// query string and must be percent-encoded as a whole.
//
// Verified against each slicer's own source before a button was offered:
//   OrcaSlicer     orcaslicer://open?file=<encoded url>   any https host
//   Bambu Studio   bambustudio://open?file=<encoded url>  any host, after the
//                  app's own "not from a trusted site" confirmation
//   PrusaSlicer    prusaslicer://open?file=...            only printables.com
//                  and thingiverse.com URLs are accepted, so no button: the STL
//                  download is the honest path there
//
// The file itself is served by api/slicer/model.js: Z-up, millimetres, on the
// bed. A browser cannot tell whether a custom scheme has a handler, so the
// handoff watches for the page losing focus (which is what happens when the OS
// switches to the slicer) and, if nothing happens, offers the download and the
// install links instead of leaving the user looking at a button that did nothing.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GLB_ID_RE = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\.web)?\.glb(?:$|[?#])/i;

export const SLICERS = Object.freeze({
	orca: Object.freeze({
		id: 'orca',
		name: 'OrcaSlicer',
		scheme: 'orcaslicer',
		install: 'https://github.com/SoftFever/OrcaSlicer/releases/latest',
	}),
	bambu: Object.freeze({
		id: 'bambu',
		name: 'Bambu Studio',
		scheme: 'bambustudio',
		install: 'https://bambulab.com/en/download/studio',
	}),
});

export const PRUSA_NOTE =
	'PrusaSlicer only opens links from Printables and Thingiverse, so download the STL and open it from PrusaSlicer instead.';

/** The creation id embedded in a forge storage URL (`.../<uuid>.glb` or `.web.glb`), or null. */
export function creationIdFromGlbUrl(url) {
	const match = GLB_ID_RE.exec(String(url || ''));
	return match ? match[1].toLowerCase() : null;
}

/**
 * The print-ready file URL for a creation. Path only, ending in `model.<ext>`,
 * because slicers name and parse the download from the last path segment.
 *
 * @param {string} origin  e.g. https://three.ws
 * @param {string} id      creation UUID
 * @param {{ format?: 'stl'|'3mf', sizeMm?: number|null }} [opts]
 */
export function slicerModelUrl(origin, id, { format = 'stl', sizeMm = null } = {}) {
	if (!UUID_RE.test(String(id || ''))) throw new TypeError('slicerModelUrl needs a creation UUID');
	if (format !== 'stl' && format !== '3mf') throw new TypeError('format must be stl or 3mf');
	const base = String(origin || '').replace(/\/+$/, '');
	const size = sizeMm ? `${Math.round(sizeMm)}mm/` : '';
	return `${base}/api/slicer/${String(id).toLowerCase()}/${size}model.${format}`;
}

/** The deep link that asks `slicer` to download and import `fileUrl`. */
export function buildSlicerLink(slicer, fileUrl) {
	const s = typeof slicer === 'string' ? SLICERS[slicer] : slicer;
	if (!s?.scheme) throw new TypeError(`unknown slicer: ${slicer}`);
	const url = String(fileUrl || '');
	if (!/^https?:\/\//i.test(url)) throw new TypeError('slicers can only download http(s) URLs');
	if (/[?#]/.test(url)) throw new TypeError('slicer file URLs must not carry a query string or fragment');
	return `${s.scheme}://open?file=${encodeURIComponent(url)}`;
}

// How long the page waits for the OS to switch to the slicer before it offers
// the fallback. Long enough for a cold app launch to steal focus on a slow
// machine, short enough that the help appears while the user is still looking.
const HANDOFF_WINDOW_MS = 2500;

/**
 * Fire a slicer deep link. Resolves to true when the page lost focus (the
 * slicer, or the browser's "open this app?" prompt, took over) and false when
 * nothing happened in the window, which almost always means no app is
 * registered for the scheme.
 */
export function openInSlicer(slicer, fileUrl) {
	const link = buildSlicerLink(slicer, fileUrl);
	return new Promise((resolve) => {
		let settled = false;
		const finish = (opened) => {
			if (settled) return;
			settled = true;
			window.removeEventListener('blur', onBlur);
			document.removeEventListener('visibilitychange', onHide);
			clearTimeout(timer);
			resolve(opened);
		};
		const onBlur = () => finish(true);
		const onHide = () => {
			if (document.visibilityState === 'hidden') finish(true);
		};
		window.addEventListener('blur', onBlur);
		document.addEventListener('visibilitychange', onHide);
		const timer = setTimeout(() => finish(false), HANDOFF_WINDOW_MS);
		const a = document.createElement('a');
		a.href = link;
		a.rel = 'noopener';
		document.body.appendChild(a);
		a.click();
		a.remove();
	});
}

const SIZES = [
	['', 'Auto size'],
	['50', '50 mm'],
	['80', '80 mm'],
	['100', '100 mm'],
	['150', '150 mm'],
	['200', '200 mm'],
];

function injectStyles() {
	if (document.getElementById('slicer-handoff-styles')) return;
	const style = document.createElement('style');
	style.id = 'slicer-handoff-styles';
	style.textContent = `
		.sh { display: flex; flex-direction: column; gap: var(--space-sm, 0.6rem); }
		.sh-row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-sm, 0.6rem); }
		.sh-btn {
			display: inline-flex; align-items: center; gap: 0.45rem; cursor: pointer; text-decoration: none;
			background: var(--surface-1, #16161d); color: var(--ink, #eee); border: 1px solid var(--stroke, rgba(255,255,255,0.12));
			border-radius: var(--radius-md, 8px); padding: 0.5rem 0.85rem; font: inherit; font-size: var(--text-sm, 0.85rem);
			transition: border-color 0.15s ease, background 0.15s ease, transform 0.15s ease;
		}
		.sh-btn:hover { border-color: var(--stroke-strong, rgba(255,255,255,0.24)); background: var(--surface-2, rgba(255,255,255,0.06)); }
		.sh-btn:active { transform: translateY(1px); }
		.sh-btn:focus-visible, .sh-size:focus-visible, .sh-help a:focus-visible { outline: 2px solid var(--accent, #7c6cff); outline-offset: 2px; }
		.sh-btn[aria-busy='true'] { opacity: 0.6; cursor: progress; }
		.sh-btn.is-primary { background: var(--accent, #7c6cff); border-color: var(--accent, #7c6cff); color: var(--bg-0, #0a0a0a); font-weight: 600; }
		.sh-size {
			background: var(--surface-1, #16161d); border: 1px solid var(--stroke, rgba(255,255,255,0.12)); border-radius: var(--radius-md, 8px);
			color: var(--ink, #eee); font: inherit; font-size: var(--text-sm, 0.85rem); padding: 0.45rem 0.6rem;
		}
		.sh-note { margin: 0; font-size: var(--text-xs, 0.78rem); color: var(--ink-dim, #999); line-height: 1.5; }
		.sh-help {
			margin: 0; padding: 0.7rem 0.85rem; border-radius: var(--radius-md, 8px); line-height: 1.5;
			border: 1px solid var(--stroke, rgba(255,255,255,0.12)); background: var(--surface-1, #16161d);
			font-size: var(--text-xs, 0.78rem); color: var(--ink, #eee);
			animation: sh-in 0.18s ease;
		}
		.sh-help[hidden] { display: none; }
		.sh-help a { color: var(--accent, #7c6cff); }
		@keyframes sh-in { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; transform: none; } }
		@media (prefers-reduced-motion: reduce) { .sh-help { animation: none; } }
	`;
	document.head.appendChild(style);
}

function esc(s) {
	return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

/**
 * Explain a deep link that did nothing, with the file one click away. Shared by
 * the model page block and the forge export menu so both say the same thing.
 */
export function missedHandoffHtml(slicer, fileUrl) {
	const s = typeof slicer === 'string' ? SLICERS[slicer] : slicer;
	return `${esc(s.name)} did not open. If it is not installed, <a href="${esc(s.install)}" target="_blank" rel="noopener">get ${esc(s.name)}</a>, or <a href="${esc(fileUrl)}" download>download the STL</a> and drag it into any slicer. In Bambu Studio, accept the "open from an untrusted site" prompt.`;
}

/**
 * Render the full handoff block: a size picker, one button per supported
 * slicer, the STL and 3MF downloads, and the PrusaSlicer explanation.
 *
 * @param {HTMLElement} host
 * @param {{ creationId: string, origin?: string }} opts
 */
export function renderSlicerHandoff(host, { creationId, origin = location.origin } = {}) {
	injectStyles();
	const urlFor = (format) => slicerModelUrl(origin, creationId, { format, sizeMm: Number(sizeSel.value) || null });
	host.innerHTML = `
		<div class="sh">
			<div class="sh-row">
				<label class="sh-note" for="sh-size-${esc(creationId)}">Print size</label>
				<select class="sh-size" id="sh-size-${esc(creationId)}" aria-describedby="sh-size-note-${esc(creationId)}">
					${SIZES.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}
				</select>
			</div>
			<p class="sh-note" id="sh-size-note-${esc(creationId)}">Auto keeps real-world units when the model has them and otherwise makes the longest side 100 mm. The file opens Z-up, on the bed, in millimetres.</p>
			<div class="sh-row">
				${Object.values(SLICERS)
					.map((s, i) => `<button class="sh-btn${i === 0 ? ' is-primary' : ''}" type="button" data-slicer="${s.id}">Open in ${esc(s.name)}</button>`)
					.join('')}
				<a class="sh-btn" data-format="stl" download>Download STL</a>
				<a class="sh-btn" data-format="3mf" download>Download 3MF</a>
			</div>
			<p class="sh-help" role="status" aria-live="polite" hidden></p>
			<p class="sh-note">${esc(PRUSA_NOTE)}</p>
		</div>`;
	const sizeSel = host.querySelector('.sh-size');
	const help = host.querySelector('.sh-help');
	const syncLinks = () => {
		for (const a of host.querySelectorAll('a[data-format]')) a.href = urlFor(a.dataset.format);
	};
	sizeSel.addEventListener('change', () => {
		syncLinks();
		help.hidden = true;
	});
	syncLinks();
	for (const btn of host.querySelectorAll('[data-slicer]')) {
		btn.addEventListener('click', async () => {
			if (btn.getAttribute('aria-busy') === 'true') return;
			const slicer = SLICERS[btn.dataset.slicer];
			const fileUrl = urlFor('stl');
			btn.setAttribute('aria-busy', 'true');
			help.hidden = false;
			help.textContent = `Opening ${slicer.name}…`;
			const opened = await openInSlicer(slicer, fileUrl);
			btn.removeAttribute('aria-busy');
			if (opened) {
				help.textContent = `Sent to ${slicer.name}. It downloads the file itself, so give it a moment on large models.`;
			} else {
				help.innerHTML = missedHandoffHtml(slicer, fileUrl);
			}
		});
	}
}

/**
 * Add "Open in <slicer>" rows to a forge export menu. The rows reuse the menu's
 * own `.export-item` markup so arrow-key navigation and styling apply to them
 * unchanged, and stay hidden until the model has a stored creation id (a file
 * dropped from disk has none, so there is nothing a slicer could download).
 *
 * @param {HTMLElement} menu  the export menu (role="menu")
 * @param {{ isLocalEdit?: () => boolean }} [opts]  true while the viewer shows
 *   an unsaved in-browser edit, which the slicer cannot see
 * @returns {{ setCreation: (id: string|null) => void }}
 */
export function mountSlicerMenuItems(menu, { isLocalEdit = () => false } = {}) {
	let creationId = null;
	const rows = Object.values(SLICERS).map((slicer) => {
		const item = document.createElement('button');
		item.type = 'button';
		item.className = 'export-item';
		item.setAttribute('role', 'menuitem');
		item.dataset.slicer = slicer.id;
		item.hidden = true;
		item.innerHTML = `
			<span class="fmt">${slicer.id === 'orca' ? 'Orca' : 'Bambu'}</span>
			<span class="blurb">Open in ${esc(slicer.name)}: print-ready STL, Z-up, on the bed, in millimetres.</span>
			<span class="status" aria-live="polite"></span>`;
		const status = item.querySelector('.status');
		item.addEventListener('click', async () => {
			if (!creationId || item.getAttribute('aria-disabled') === 'true') return;
			const fileUrl = slicerModelUrl(location.origin, creationId);
			item.setAttribute('aria-disabled', 'true');
			status.classList.remove('is-error');
			status.textContent = 'opening';
			const opened = await openInSlicer(slicer, fileUrl);
			item.removeAttribute('aria-disabled');
			if (opened) {
				status.textContent = isLocalEdit() ? 'sent (saved model, not your edits)' : 'sent ✓';
			} else {
				status.innerHTML = `not installed? <a class="export-again" href="${esc(fileUrl)}" download>download STL</a> or <a class="export-again" href="${esc(slicer.install)}" target="_blank" rel="noopener">get it</a>`;
			}
		});
		menu.appendChild(item);
		return { item, status };
	});
	return {
		setCreation(id) {
			creationId = id && UUID_RE.test(id) ? id.toLowerCase() : null;
			for (const { item, status } of rows) {
				item.hidden = !creationId;
				status.textContent = '';
				status.classList.remove('is-error');
			}
		},
	};
}

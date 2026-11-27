// Paste or drop reference photos anywhere on /forge and Forge Studio.
//
// One module for both pages (src/forge-dropzone.js and
// src/forge-studio/forge-dropzone.js only call installForgeDropzone with their
// view count). Every capture path ends at the same `forge:add-images` hook the
// page listens for, so a pasted photo, a dropped photo, a picked photo and a
// linked photo are all prepared and uploaded by the same code:
//
//   Paste (Cmd+V / Ctrl+V). An image on the clipboard becomes a reference view
//   from anywhere on the page. A pasted image link (outside a text field) is
//   fetched for the person through /api/forge-upload { source_url }, which runs
//   the SSRF guard, and is then added like a dropped file. Text pasted into a
//   field is never touched.
//
//   Drag onto the page. Outside photo mode a full-page overlay invites the drop;
//   in photo mode the slots light up themselves, so the page only catches drops
//   that miss a slot instead of letting the browser navigate to the file. An
//   image dragged in from another tab often arrives as a link with no file, and
//   is fetched the same way as a pasted link.
//
// Files are judged by their bytes (src/shared/forge-image-intake.js), never by
// the name or the type the operating system guessed: a HEIC with no type is
// added, a PDF renamed .jpg is refused with a message naming what works.
//
// Self-contained: injects its own styles, owns its overlay and toast nodes, and
// talks to the page only through CustomEvents.

import { planIntake, HEADER_BYTES } from './forge-image-intake.js';
import { importForgeImageUrl } from './forge-upload-client.js';

const STYLE_ID = 'forge-dropzone-styles';
const SHORT_TOAST_MS = 2600;
const LONG_TOAST_MS = 7000;
/** The import endpoint answers every failure with a designed state; tell the session recorder so. */
const IMPORT_HEADERS = { 'x-witness': 'handled' };

const installed = new WeakSet();

function injectStyles(doc) {
	if (doc.getElementById(STYLE_ID)) return;
	const style = doc.createElement('style');
	style.id = STYLE_ID;
	style.textContent = `
		.forge-drop-overlay {
			position: fixed;
			inset: 0;
			z-index: 80;
			display: grid;
			place-items: center;
			background: color-mix(in srgb, var(--bg, #0b0b10) 72%, transparent);
			backdrop-filter: blur(3px);
			-webkit-backdrop-filter: blur(3px);
			opacity: 0;
			pointer-events: none;
			transition: opacity 0.15s ease;
		}
		.forge-drop-overlay[data-active='true'] {
			opacity: 1;
			pointer-events: auto;
		}
		.forge-drop-card {
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: 0.6rem;
			padding: 2.2rem 2.8rem;
			border: 2px dashed var(--accent, #7c9cff);
			border-radius: var(--radius-lg, 16px);
			background: var(--surface-1, rgba(255, 255, 255, 0.04));
			text-align: center;
			transform: scale(0.97);
			transition: transform 0.15s ease;
		}
		.forge-drop-overlay[data-active='true'] .forge-drop-card {
			transform: scale(1);
		}
		.forge-drop-card .glyph {
			font-size: 2rem;
			color: var(--accent, #7c9cff);
			line-height: 1;
		}
		.forge-drop-card h3 {
			margin: 0;
			color: var(--ink, #fff);
			font-family: var(--font-display, inherit);
			font-size: var(--text-lg, 1.1rem);
		}
		.forge-drop-card p {
			margin: 0;
			color: var(--ink-dim, #aab);
			font-size: var(--text-sm, 0.85rem);
			max-width: 34ch;
		}
		.forge-toast {
			position: fixed;
			left: 50%;
			bottom: 28px;
			transform: translate(-50%, 8px);
			z-index: 90;
			max-width: min(92vw, 560px);
			background: var(--surface-3, #1d1d26);
			border: 1px solid var(--stroke-strong, rgba(255, 255, 255, 0.16));
			border-radius: 14px;
			color: var(--ink, #fff);
			font-size: var(--text-sm, 0.85rem);
			line-height: 1.4;
			text-align: center;
			padding: 0.55rem 1.1rem;
			box-shadow: 0 12px 32px -12px rgba(0, 0, 0, 0.7);
			opacity: 0;
			pointer-events: none;
			transition: opacity 0.18s ease, transform 0.18s ease;
		}
		.forge-toast[data-show='true'] {
			opacity: 1;
			transform: translate(-50%, 0);
		}
		.forge-toast[data-tone='error'] {
			border-color: color-mix(in srgb, var(--danger, #ff6b6b) 55%, transparent);
		}
		@media (prefers-reduced-motion: reduce) {
			.forge-drop-overlay, .forge-drop-card, .forge-toast {
				transition: none;
			}
		}
	`;
	doc.head.appendChild(style);
}

async function readHeader(file) {
	const part = file.slice(0, HEADER_BYTES);
	if (typeof part.arrayBuffer === 'function') return new Uint8Array(await part.arrayBuffer());
	return new Uint8Array(
		await new Promise((resolve, reject) => {
			const reader = new FileReader();
			reader.onload = () => resolve(reader.result);
			reader.onerror = () => reject(reader.error);
			reader.readAsArrayBuffer(part);
		}),
	);
}

/** Split files into ones the page can turn into a photo and ones refused by content. */
async function sortFiles(list) {
	const keep = [];
	const refused = [];
	for (const file of Array.from(list || [])) {
		if (!file) continue;
		let plan;
		try {
			plan = planIntake({ header: await readHeader(file), size: file.size, type: file.type, name: file.name });
		} catch {
			refused.push({ file, message: `${file.name || 'That file'} could not be read. Save it again and add it from there.` });
			continue;
		}
		if (plan.action === 'refuse') refused.push({ file, message: plan.message });
		else keep.push(file);
	}
	return { keep, refused };
}

/** A single http(s) link and nothing else, as people paste them. */
function singleLink(text) {
	const t = String(text || '').trim();
	if (!t || /\s/.test(t) || t.length > 4096) return null;
	try {
		const url = new URL(t);
		return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
	} catch {
		return null;
	}
}

/** The first link in a text/uri-list payload (lines starting with # are comments). */
function firstUri(uriList) {
	for (const line of String(uriList || '').split(/\r?\n/)) {
		const link = singleLink(line.startsWith('#') ? '' : line);
		if (link) return link;
	}
	return null;
}

function isEditable(target) {
	if (!target || typeof target.closest !== 'function') return false;
	return Boolean(target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'));
}

/**
 * @param {{ maxViews: number, fetchImpl?: typeof fetch, doc?: Document }} opts
 */
export function installForgeDropzone({ maxViews, fetchImpl, doc = document } = {}) {
	if (installed.has(doc)) return;
	installed.add(doc);

	let toastEl = null;
	let toastTimer = null;
	function toast(message, { tone = 'info' } = {}) {
		if (!toastEl) {
			toastEl = doc.createElement('div');
			toastEl.className = 'forge-toast';
			toastEl.setAttribute('role', 'status');
			toastEl.setAttribute('aria-live', 'polite');
			doc.body.appendChild(toastEl);
		}
		toastEl.textContent = message;
		toastEl.dataset.tone = tone;
		toastEl.dataset.show = 'true';
		clearTimeout(toastTimer);
		toastTimer = setTimeout(() => {
			toastEl.dataset.show = 'false';
		}, tone === 'error' ? LONG_TOAST_MS : SHORT_TOAST_MS);
	}

	const currentMode = () => doc.querySelector('#mode-switch [aria-selected="true"]')?.dataset.mode || 'text';

	function addImages(files, source) {
		if (!files.length) return;
		const sketch = currentMode() === 'sketch';
		doc.dispatchEvent(new CustomEvent('forge:add-images', { detail: { files } }));
		if (sketch) toast(`${source} added as your sketch`);
		else toast(files.length === 1 ? `${source} added as a reference view` : `${files.length} photos added as reference views`);
	}

	async function addFiles(list, source) {
		const { keep, refused } = await sortFiles(list);
		addImages(keep, source);
		if (!refused.length) return;
		// A refusal outlives the "added" line: it is the one the person must act on.
		const first = refused[0];
		const others = refused.length - 1;
		const lead = keep.length || refused.length > 1 ? `${first.file.name || 'One file'} was not added. ` : '';
		const tail = others > 0 ? ` (${others} more file${others === 1 ? '' : 's'} left out for the same kind of reason.)` : '';
		toast(`${lead}${first.message}${tail}`, { tone: 'error' });
	}

	let importing = false;
	async function addLink(link) {
		if (importing) {
			toast('Still fetching the last link. Add this one when it lands.', { tone: 'error' });
			return;
		}
		importing = true;
		toast('Fetching the image from that link...');
		try {
			const got = await importForgeImageUrl(link, {
				headers: IMPORT_HEADERS,
				...(fetchImpl ? { fetchImpl } : {}),
			});
			if (!got.ok) {
				toast(got.code === 'sign_in' ? got.message : got.detail || got.message, { tone: 'error' });
				return;
			}
			await addFiles([got.file], 'Linked image');
		} finally {
			importing = false;
		}
	}

	doc.addEventListener('paste', (e) => {
		const cd = e.clipboardData;
		if (!cd) return;
		if (cd.files?.length) {
			e.preventDefault();
			addFiles(cd.files, 'Pasted image');
			return;
		}
		if (isEditable(e.target)) return;
		const link = singleLink(cd.getData('text/plain') || cd.getData('text'));
		if (!link) return; // ordinary text: leave the browser alone
		e.preventDefault();
		addLink(link);
	});

	let overlay = null;
	function ensureOverlay() {
		if (overlay) return overlay;
		overlay = doc.createElement('div');
		overlay.className = 'forge-drop-overlay';
		overlay.setAttribute('aria-hidden', 'true');
		overlay.innerHTML = `
			<div class="forge-drop-card">
				<span class="glyph" aria-hidden="true">&#8675;</span>
				<h3>Drop photos to forge in 3D</h3>
				<p>1-${maxViews} views of one object, or an image dragged from another tab. I'll switch to <strong>From photos</strong> and place them for you.</p>
			</div>`;
		doc.body.appendChild(overlay);
		return overlay;
	}
	const setOverlay = (active) => {
		ensureOverlay().dataset.active = String(active);
	};

	const carries = (e) => {
		const types = Array.from(e.dataTransfer?.types || []);
		return types.includes('Files') || types.includes('text/uri-list');
	};
	// A drag of a slot's own thumbnail (reorder) is the slot's business.
	const isSlotReorder = (e) => Array.from(e.dataTransfer?.types || []).includes('application/x-forge-slot');

	// dragenter/leave fire for every child node; a depth counter is the reliable
	// way to know when the pointer truly left the window.
	let dragDepth = 0;
	doc.addEventListener('dragenter', (e) => {
		if (!carries(e) || isSlotReorder(e)) return;
		dragDepth++;
		// In photo mode the view slots are on screen and light up themselves; the
		// overlay would cover them and steal their per-slot targeting.
		if (currentMode() !== 'image') setOverlay(true);
	});
	doc.addEventListener('dragleave', () => {
		dragDepth = Math.max(0, dragDepth - 1);
		if (dragDepth === 0) setOverlay(false);
	});
	doc.addEventListener('dragover', (e) => {
		if (!carries(e) || isSlotReorder(e)) return;
		// Without this the drop never fires and the browser navigates to the file.
		e.preventDefault();
	});
	doc.addEventListener('drop', (e) => {
		dragDepth = 0;
		setOverlay(false);
		if (!carries(e) || isSlotReorder(e)) return;
		e.preventDefault();
		const files = e.dataTransfer.files;
		if (files?.length) {
			// A file dropped directly on a view slot was already handled there.
			if (e.target instanceof Element && e.target.closest('.view-slot')) return;
			addFiles(files, 'Dropped photo');
			return;
		}
		// A slot only reads files, so a link is ours wherever it lands.
		const link = firstUri(e.dataTransfer.getData('text/uri-list')) || singleLink(e.dataTransfer.getData('text/plain'));
		if (link) addLink(link);
	});

	injectStyles(doc);
}

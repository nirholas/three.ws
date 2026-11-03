// In-viewer progress panel for path-traced stills. The canvas itself shows the
// image converging sample by sample; this panel reports how far along it is,
// offers Cancel (button or Escape), and saves the PNG when it finishes.
//
// The viewer mounts into arbitrary host pages and into <agent-3d>'s shadow
// root, so the panel brings its own scoped stylesheet, injected once per root.

import { log } from '../shared/log.js';

const STYLE_ID = 'tws-photoreal-ui-style';
const CSS = `
.tws-pt {
	position: absolute; left: 50%; bottom: 16px; transform: translateX(-50%);
	z-index: 20; min-width: 240px; max-width: calc(100% - 32px);
	display: grid; gap: 8px; padding: 12px 14px;
	font: 500 13px/1.3 system-ui, -apple-system, 'Segoe UI', sans-serif;
	color: #f4f4f6; background: rgba(14, 14, 18, 0.86);
	border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 12px;
	box-shadow: 0 8px 28px rgba(0, 0, 0, 0.35);
	backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
	animation: tws-pt-in 180ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
}
@keyframes tws-pt-in { from { opacity: 0; transform: translate(-50%, 8px); } to { opacity: 1; transform: translate(-50%, 0); } }
.tws-pt-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.tws-pt-label { font-variant-numeric: tabular-nums; }
.tws-pt-label[data-state="error"] { color: #ffb4b4; }
.tws-pt-bar { height: 4px; border-radius: 2px; background: rgba(255, 255, 255, 0.14); overflow: hidden; }
.tws-pt-fill { height: 100%; width: 0; background: #6ee7b7; border-radius: inherit; transition: width 160ms linear; }
.tws-pt-bar[data-indeterminate] .tws-pt-fill { width: 30%; animation: tws-pt-sweep 1.1s ease-in-out infinite; }
@keyframes tws-pt-sweep { from { transform: translateX(-100%); } to { transform: translateX(340%); } }
.tws-pt-btn {
	appearance: none; font: inherit; font-size: 12px; cursor: pointer;
	color: #f4f4f6; background: rgba(255, 255, 255, 0.08);
	border: 1px solid rgba(255, 255, 255, 0.16); border-radius: 8px; padding: 5px 10px;
	transition: background 120ms ease, border-color 120ms ease;
}
.tws-pt-btn:hover { background: rgba(255, 255, 255, 0.16); border-color: rgba(255, 255, 255, 0.28); }
.tws-pt-btn:active { background: rgba(255, 255, 255, 0.24); }
.tws-pt-btn:focus-visible { outline: 2px solid var(--accent, #6ee7b7); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) {
	.tws-pt { animation: none; }
	.tws-pt-bar[data-indeterminate] .tws-pt-fill { animation: none; width: 100%; opacity: 0.5; }
	.tws-pt-fill { transition: none; }
}
`;

function ensureStyles(root) {
	const host = root instanceof ShadowRoot ? root : document.head;
	if (!host || host.querySelector(`#${STYLE_ID}`)) return;
	const style = document.createElement('style');
	style.id = STYLE_ID;
	style.textContent = CSS;
	host.appendChild(style);
}

function download(blob, prefix) {
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.download = `${prefix}-${timestamp}.png`;
	link.href = url;
	link.click();
	URL.revokeObjectURL(url);
}

function buildPanel(viewer) {
	ensureStyles(viewer.el.getRootNode());
	if (getComputedStyle(viewer.el).position === 'static') viewer.el.style.position = 'relative';
	const panel = document.createElement('div');
	panel.className = 'tws-pt';
	panel.setAttribute('role', 'status');
	panel.setAttribute('aria-live', 'polite');
	panel.innerHTML = `
		<div class="tws-pt-row">
			<span class="tws-pt-label">Preparing path tracer</span>
			<button type="button" class="tws-pt-btn">Cancel</button>
		</div>
		<div class="tws-pt-bar" data-indeterminate><div class="tws-pt-fill"></div></div>`;
	viewer.el.appendChild(panel);
	return {
		panel,
		label: panel.querySelector('.tws-pt-label'),
		bar: panel.querySelector('.tws-pt-bar'),
		fill: panel.querySelector('.tws-pt-fill'),
		button: panel.querySelector('.tws-pt-btn'),
	};
}

/**
 * Path-trace the viewer's current view with an on-canvas progress panel, then
 * save the PNG. Resolves with the Blob, or null when cancelled or failed (the
 * panel explains which).
 *
 * @param {import('../viewer.js').Viewer} viewer
 * @param {{ samples?: number, bounces?: number, save?: boolean }} [opts]
 */
export async function runPhotorealWithProgress(viewer, { save = true, ...opts } = {}) {
	if (viewer._photorealUi) return null;
	const ui = buildPanel(viewer);
	const controller = new AbortController();
	// Once the render has settled (failed), the button and Escape dismiss.
	let settled = false;
	const cancelOrClose = () => (settled || controller.signal.aborted ? close() : controller.abort());
	const close = () => {
		window.removeEventListener('keydown', onKey, true);
		ui.panel.remove();
		viewer._photorealUi = null;
	};
	const onKey = (e) => {
		if (e.key !== 'Escape') return;
		e.preventDefault();
		e.stopPropagation();
		cancelOrClose();
	};
	viewer._photorealUi = ui;
	ui.button.addEventListener('click', cancelOrClose);
	window.addEventListener('keydown', onKey, true);

	// Let the panel paint before the scene's BVH build briefly holds the thread.
	await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

	try {
		const blob = await viewer.renderPhotoreal({
			...opts,
			signal: controller.signal,
			onProgress: ({ samples, total }) => {
				if (samples === 0) return;
				ui.bar.removeAttribute('data-indeterminate');
				ui.label.textContent = `Path tracing ${samples} / ${total} samples`;
				ui.fill.style.width = `${Math.round((samples / total) * 100)}%`;
			},
		});
		if (save) download(blob, '3d-photoreal');
		close();
		return blob;
	} catch (err) {
		if (err?.name === 'AbortError') {
			close();
			return null;
		}
		settled = true;
		log.error('Photoreal render failed:', err);
		ui.bar.hidden = true;
		ui.label.dataset.state = 'error';
		ui.label.textContent = `Render failed: ${err?.message || err}. The live view is unchanged; try again.`;
		ui.button.textContent = 'Close';
		ui.button.focus();
		return null;
	}
}

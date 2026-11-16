// OneDrive and SharePoint in Forge.
//
//   • "From OneDrive or SharePoint" beside the photo views opens Microsoft's
//     File Picker v8 (personal OneDrive, work OneDrive, SharePoint libraries),
//     downloads the chosen photos through Graph and hands them to Forge's own
//     upload path over the `forge:add-images` event, so they get the same type
//     check, photo prep, 8 MB cap and slot handling as a dropped file.
//   • "Save to OneDrive" in the download menu asks for a folder with the same
//     picker and uploads the GLB, a poster PNG and (for a stored model) the
//     PowerPoint slide, with progress read from the Graph upload session.
//
// Both stay hidden unless /api/config reports a client id for the three.ws
// Entra app. MSAL and the picker host load only on first use.
// Docs: docs/onedrive.md.

import { OneDriveError, uploadToFolder, downloadPickedImage, GRAPH_BASE, graphRequest, safeDriveFileName } from './microsoft-graph/onedrive-core.js';
import { fetchPptx } from './forge-powerpoint.js';

const STYLE_ID = 'forge-onedrive-styles';
const MAX_VIEWS = 6;

// ---- configuration and lazy client -------------------------------------------

let configPromise = null;
/** { enabled, clientId } from the server; never throws. */
export function oneDriveConfig() {
	configPromise ||= fetch('/api/config', { headers: { accept: 'application/json' } })
		.then((r) => (r.ok ? r.json() : {}))
		.then((c) => ({ enabled: Boolean(c?.oneDrive?.enabled && c.oneDrive.clientId), clientId: c?.oneDrive?.clientId || '' }))
		.catch(() => ({ enabled: false, clientId: '' }));
	return configPromise;
}

let clientModule = null;
const loadClient = () => (clientModule ||= import('./microsoft-graph/onedrive-client.js'));

let session = null;
async function getSession() {
	if (session) return session;
	const [{ createOneDriveSession }, cfg] = await Promise.all([loadClient(), oneDriveConfig()]);
	session = createOneDriveSession({ clientId: cfg.clientId, askToContinue: (message) => dialog.askToContinue(message) });
	return session;
}

const graphFetch = (...args) => window.fetch(...args);
const graphToken = (force) => session.graphToken(force);

// ---- styles ------------------------------------------------------------------

function injectStyles() {
	if (document.getElementById(STYLE_ID)) return;
	const style = document.createElement('style');
	style.id = STYLE_ID;
	style.textContent = `
		.od-source { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 0.4rem 0.75rem; margin-top: var(--space-sm, 8px); }
		.od-btn {
			display: inline-flex; align-items: center; gap: 0.5rem;
			min-height: 36px; padding: 0.45rem 0.9rem;
			border: 1px solid var(--stroke-strong, rgba(255,255,255,0.18)); border-radius: var(--radius-md, 10px);
			background: var(--surface-1, rgba(255,255,255,0.04)); color: var(--ink, #ececf1);
			font: inherit; font-size: var(--text-sm, 0.875rem); cursor: pointer;
			transition: background var(--duration-fast, 120ms) ease, border-color var(--duration-fast, 120ms) ease, transform var(--duration-fast, 120ms) ease;
		}
		.od-btn:hover { background: var(--surface-2, rgba(255,255,255,0.08)); border-color: var(--accent, #7c9cff); }
		.od-btn:active { transform: translateY(1px); background: var(--surface-3, rgba(255,255,255,0.12)); }
		.od-btn:focus-visible { outline: 2px solid var(--accent, #7c9cff); outline-offset: 2px; }
		.od-btn[aria-busy='true'] { cursor: progress; opacity: 0.75; }
		.od-btn svg { width: 18px; height: 18px; flex: none; }
		.od-btn-primary { background: var(--accent, #7c9cff); border-color: var(--accent, #7c9cff); color: #0b0b10; font-weight: 600; }
		.od-btn-primary:hover { background: color-mix(in srgb, var(--accent, #7c9cff) 85%, white); }
		.od-btn-quiet { border-color: transparent; background: transparent; color: var(--ink-dim, #a0a0b0); }
		.od-btn-quiet:hover { color: var(--ink, #ececf1); background: var(--surface-1, rgba(255,255,255,0.04)); border-color: var(--stroke, rgba(255,255,255,0.1)); }
		.od-status { font-size: var(--text-xs, 0.75rem); color: var(--ink-dim, #a0a0b0); min-height: 1em; text-align: center; }
		.od-status.is-error { color: var(--danger, #ff6b6b); }
		.od-status.is-ok { color: var(--success, #4ade80); }

		.od-dialog {
			width: min(1080px, 94vw); height: min(720px, 90vh); max-width: none; max-height: none;
			padding: 0; border: 1px solid var(--stroke-strong, rgba(255,255,255,0.18)); border-radius: var(--radius-lg, 16px);
			background: var(--bg, #0b0b10); color: var(--ink, #ececf1); overflow: hidden;
		}
		.od-dialog[open] { display: flex; flex-direction: column; animation: od-in 0.16s ease-out; }
		.od-dialog::backdrop { background: rgba(5,5,10,0.6); backdrop-filter: blur(3px); }
		@keyframes od-in { from { opacity: 0; transform: translateY(6px) scale(0.99); } to { opacity: 1; transform: none; } }
		.od-head { display: flex; align-items: center; gap: 0.6rem; padding: 0.6rem 0.75rem 0.6rem 1rem; border-bottom: 1px solid var(--stroke, rgba(255,255,255,0.1)); }
		.od-head h2 { margin: 0; font-size: var(--text-sm, 0.9rem); font-weight: 600; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.od-account { font-size: var(--text-xs, 0.75rem); color: var(--ink-dim, #a0a0b0); max-width: 30ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.od-body { position: relative; flex: 1; min-height: 0; background: var(--surface-1, #121218); }
		.od-frame { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: transparent; }
		.od-skeleton { position: absolute; inset: 0; display: grid; grid-template-columns: 200px 1fr; gap: 16px; padding: 20px; background: var(--bg, #0b0b10); }
		.od-skeleton i { display: block; border-radius: 8px; background: linear-gradient(90deg, var(--surface-1, #15151c) 0%, var(--surface-2, #1e1e27) 50%, var(--surface-1, #15151c) 100%); background-size: 200% 100%; animation: od-shimmer 1.2s linear infinite; }
		.od-skeleton .od-sk-nav { display: grid; gap: 12px; align-content: start; }
		.od-skeleton .od-sk-nav i { height: 28px; }
		.od-skeleton .od-sk-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 14px; align-content: start; }
		.od-skeleton .od-sk-grid i { aspect-ratio: 1; }
		@keyframes od-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
		.od-panel { position: absolute; inset: 0; display: grid; place-items: center; padding: 1.5rem; background: var(--bg, #0b0b10); text-align: center; }
		.od-panel-card { max-width: 46ch; display: grid; gap: 0.9rem; justify-items: center; }
		.od-panel-card p { margin: 0; line-height: 1.5; }
		.od-panel-actions { display: flex; gap: 0.6rem; flex-wrap: wrap; justify-content: center; }
		.od-close { width: 36px; height: 36px; padding: 0; justify-content: center; }

		.od-toast {
			position: fixed; right: max(16px, env(safe-area-inset-right)); bottom: max(16px, env(safe-area-inset-bottom)); z-index: 90;
			width: min(380px, calc(100vw - 32px)); padding: 0.9rem 1rem;
			border: 1px solid var(--stroke-strong, rgba(255,255,255,0.18)); border-radius: var(--radius-lg, 14px);
			background: var(--bg, #0b0b10); color: var(--ink, #ececf1); box-shadow: 0 18px 48px rgba(0,0,0,0.45);
			display: grid; gap: 0.6rem; font-size: var(--text-sm, 0.875rem);
			animation: od-in 0.16s ease-out;
		}
		.od-toast-head { display: flex; align-items: center; gap: 0.5rem; font-weight: 600; }
		.od-toast-head span { flex: 1; }
		.od-row { display: grid; grid-template-columns: 1fr auto; gap: 0.25rem 0.6rem; align-items: center; }
		.od-row .od-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
		.od-row .od-state { font-size: var(--text-xs, 0.75rem); color: var(--ink-dim, #a0a0b0); font-variant-numeric: tabular-nums; }
		.od-row .od-state.is-error { color: var(--danger, #ff6b6b); }
		.od-row .od-state.is-ok { color: var(--success, #4ade80); }
		.od-row .od-err { grid-column: 1 / -1; font-size: var(--text-xs, 0.75rem); color: var(--danger, #ff6b6b); }
		.od-bar { grid-column: 1 / -1; height: 4px; border-radius: 2px; background: var(--surface-2, rgba(255,255,255,0.08)); overflow: hidden; }
		.od-bar i { display: block; height: 100%; width: 0; background: var(--accent, #7c9cff); transition: width 0.2s ease; }
		.od-toast a { color: var(--accent, #7c9cff); text-underline-offset: 2px; }
		.od-toast a:hover { text-decoration: none; }
		.od-toast a:focus-visible { outline: 2px solid var(--accent, #7c9cff); outline-offset: 2px; border-radius: 2px; }
		.od-toast-actions { display: flex; gap: 0.5rem; justify-content: flex-end; flex-wrap: wrap; }

		@media (max-width: 520px) {
			.od-dialog { width: 100vw; height: 100dvh; border-radius: 0; border: 0; }
			.od-skeleton { grid-template-columns: 1fr; }
			.od-skeleton .od-sk-nav { display: none; }
			.od-account { display: none; }
		}
		@media (prefers-reduced-motion: reduce) {
			.od-dialog[open], .od-toast { animation: none; }
			.od-skeleton i { animation: none; }
			.od-btn, .od-bar i { transition: none; }
		}
	`;
	document.head.appendChild(style);
}

const CLOUD_ICON =
	'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 18h10.5a4 4 0 0 0 .6-7.96A6 6 0 0 0 6.6 9.1 4.5 4.5 0 0 0 7 18Z"/></svg>';
const CLOSE_ICON =
	'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>';

// ---- the picker dialog -------------------------------------------------------

const dialog = (() => {
	let el = null;
	let parts = null;
	let abort = null;
	let continueWaiter = null;
	let returnFocus = null;

	function build() {
		injectStyles();
		el = document.createElement('dialog');
		el.className = 'od-dialog';
		el.setAttribute('aria-labelledby', 'od-dialog-title');
		el.innerHTML = `
			<div class="od-head">
				<h2 id="od-dialog-title">OneDrive and SharePoint</h2>
				<span class="od-account" data-od="account"></span>
				<button type="button" class="od-btn od-btn-quiet" data-od="switch">Switch account</button>
				<button type="button" class="od-btn od-btn-quiet od-close" data-od="close" aria-label="Close">${CLOSE_ICON}</button>
			</div>
			<div class="od-body">
				<iframe class="od-frame" name="od-picker-frame" title="Microsoft OneDrive file picker"></iframe>
				<div class="od-skeleton" data-od="skeleton" aria-hidden="true">
					<div class="od-sk-nav"><i></i><i></i><i></i><i></i></div>
					<div class="od-sk-grid"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
				</div>
				<div class="od-panel" data-od="panel" hidden>
					<div class="od-panel-card">
						<p data-od="panel-msg"></p>
						<div class="od-panel-actions">
							<button type="button" class="od-btn od-btn-primary" data-od="continue">Continue</button>
							<button type="button" class="od-btn" data-od="panel-cancel">Cancel</button>
						</div>
					</div>
				</div>
			</div>`;
		document.body.appendChild(el);
		const q = (k) => el.querySelector(`[data-od="${k}"]`);
		parts = {
			title: el.querySelector('#od-dialog-title'),
			account: q('account'),
			switchBtn: q('switch'),
			closeBtn: q('close'),
			frame: el.querySelector('iframe'),
			skeleton: q('skeleton'),
			panel: q('panel'),
			panelMsg: q('panel-msg'),
			continueBtn: q('continue'),
			panelCancel: q('panel-cancel'),
		};
		parts.closeBtn.addEventListener('click', () => close());
		parts.panelCancel.addEventListener('click', () => {
			if (continueWaiter) {
				const w = continueWaiter;
				continueWaiter = null;
				w.reject(new OneDriveError('cancelled', 'Cancelled.'));
			}
			close();
		});
		parts.continueBtn.addEventListener('click', () => {
			if (!continueWaiter) return;
			const w = continueWaiter;
			continueWaiter = null;
			parts.panel.hidden = true;
			w.resolve();
			// Opened only to collect this click (a token refresh after the picker
			// closed): nothing else to show, so get out of the way.
			if (w.standalone) close();
		});
		parts.switchBtn.addEventListener('click', () => el.dispatchEvent(new CustomEvent('od:switch')));
		// Esc: close the dialog through the same path as the close button.
		el.addEventListener('cancel', (e) => {
			e.preventDefault();
			close();
		});
	}

	function open(title) {
		if (!el) build();
		returnFocus = document.activeElement;
		parts.title.textContent = title;
		parts.account.textContent = session?.label || '';
		parts.skeleton.hidden = false;
		parts.panel.hidden = true;
		parts.frame.src = 'about:blank';
		abort = new AbortController();
		if (!el.open) el.showModal();
		return { iframe: parts.frame, signal: abort.signal, ready: () => (parts.skeleton.hidden = true) };
	}

	function close() {
		abort?.abort();
		abort = null;
		if (continueWaiter) {
			const w = continueWaiter;
			continueWaiter = null;
			w.reject(new OneDriveError('cancelled', 'Cancelled.'));
		}
		if (el?.open) el.close();
		if (parts) parts.frame.src = 'about:blank';
		if (returnFocus?.isConnected) returnFocus.focus();
	}

	return {
		open,
		close,
		get element() {
			if (!el) build();
			return el;
		},
		/** Show a message with a Continue button and wait for the click (a fresh user activation for MSAL's popup). */
		askToContinue(message) {
			if (!el) build();
			const standalone = !el.open;
			if (standalone) {
				returnFocus = document.activeElement;
				parts.title.textContent = 'OneDrive and SharePoint';
				abort = new AbortController();
				el.showModal();
			}
			parts.panelMsg.textContent = message;
			parts.panel.hidden = false;
			parts.continueBtn.focus();
			return new Promise((resolve, reject) => {
				continueWaiter = { resolve, reject, standalone };
			});
		},
		/** Show an error inside the dialog with a Close action. */
		showError(message) {
			if (!el?.open) return false;
			parts.skeleton.hidden = true;
			parts.panelMsg.textContent = message;
			parts.continueBtn.hidden = true;
			parts.panelCancel.textContent = 'Close';
			parts.panel.hidden = false;
			parts.panelCancel.focus();
			const restore = () => {
				parts.continueBtn.hidden = false;
				parts.panelCancel.textContent = 'Cancel';
			};
			el.addEventListener('close', restore, { once: true });
			return true;
		},
	};
})();

/**
 * Sign in (popup on this click), then show the picker in the dialog. Resolves
 * with the picked items, or null when cancelled. "Switch account" restarts the
 * picker with the Microsoft account chooser.
 */
async function pickWithDialog({ title, mode, maximumCount }) {
	const s = await getSession();
	try {
		await s.signIn();
	} catch (err) {
		// The click's user activation ran out while MSAL loaded (slow network,
		// touch with no hover to prefetch on): ask for one more click.
		if (err?.code !== 'popup_blocked') throw err;
		try {
			await dialog.askToContinue('Sign in to Microsoft to choose your files.');
			await s.signIn();
		} catch (again) {
			dialog.close();
			throw again;
		}
	}
	const { runPicker } = await loadClient();
	for (;;) {
		const view = dialog.open(title);
		let switched = false;
		const onSwitch = () => {
			switched = true;
			dialog.close();
		};
		dialog.element.addEventListener('od:switch', onSwitch, { once: true });
		try {
			const items = await runPicker({ session: s, iframe: view.iframe, mode, maximumCount, onReady: view.ready, signal: view.signal });
			if (switched) {
				await s.forget();
				await s.signIn({ switchAccount: true });
				continue;
			}
			dialog.close();
			return items;
		} catch (err) {
			if (switched) {
				await s.forget();
				await s.signIn({ switchAccount: true });
				continue;
			}
			if (err?.code !== 'cancelled' && dialog.showError(err?.message || 'The OneDrive picker failed. Try again.')) {
				await new Promise((r) => dialog.element.addEventListener('close', r, { once: true }));
				err.shown = true;
			} else {
				dialog.close();
			}
			throw err;
		} finally {
			dialog.element.removeEventListener('od:switch', onSwitch);
		}
	}
}

/** Hover or focus: load MSAL and its cache now, so the click opens sign-in at once. */
function prefetchClient() {
	oneDriveConfig()
		.then((c) => (c.enabled ? getSession() : null))
		.then((s) => s?.warm())
		.catch(() => {});
}

// ---- photo source: From OneDrive or SharePoint -------------------------------

function mountPhotoSource() {
	const pane = document.getElementById('image-pane');
	const counter = document.getElementById('views-counter');
	if (!pane || !counter) return;
	injectStyles();
	const wrap = document.createElement('div');
	wrap.className = 'od-source';
	wrap.innerHTML = `
		<button type="button" class="od-btn" aria-describedby="od-photo-status">${CLOUD_ICON}<span>From OneDrive or SharePoint</span></button>
		<span class="od-status" id="od-photo-status" role="status" aria-live="polite"></span>`;
	counter.insertAdjacentElement('afterend', wrap);
	const btn = wrap.querySelector('button');
	const status = wrap.querySelector('.od-status');
	btn.addEventListener('pointerenter', prefetchClient, { once: true });
	btn.addEventListener('focus', prefetchClient, { once: true });

	const say = (text, kind = '') => {
		status.textContent = text;
		status.classList.toggle('is-error', kind === 'error');
		status.classList.toggle('is-ok', kind === 'ok');
	};

	btn.addEventListener('click', async () => {
		if (btn.getAttribute('aria-busy') === 'true') return;
		if (navigator.onLine === false) return say('You are offline. Reconnect, then try again.', 'error');
		btn.setAttribute('aria-busy', 'true');
		say('Connecting to Microsoft…');
		try {
			const items = await pickWithDialog({ title: 'Add photos from OneDrive or SharePoint', mode: 'files', maximumCount: MAX_VIEWS });
			if (!items?.length) return say('');
			const files = [];
			const problems = [];
			for (let i = 0; i < items.length; i++) {
				say(items.length > 1 ? `Downloading ${i + 1} of ${items.length}…` : 'Downloading your photo…');
				try {
					files.push(await downloadPickedImage(items[i], { fetch: graphFetch, getToken: graphToken }));
				} catch (err) {
					problems.push(err?.message || 'A photo could not be downloaded.');
				}
			}
			if (files.length) document.dispatchEvent(new CustomEvent('forge:add-images', { detail: { files } }));
			if (problems.length) say(files.length ? `Added ${files.length}. ${problems[0]}` : problems[0], 'error');
			else say(`Added ${files.length} photo${files.length === 1 ? '' : 's'} from OneDrive.`, 'ok');
		} catch (err) {
			if (err?.code === 'cancelled') say('');
			else say(err?.message || 'OneDrive is not available right now. Add the photo from your device instead.', 'error');
		} finally {
			btn.removeAttribute('aria-busy');
		}
	});
	return wrap;
}

// ---- export: Save to OneDrive ------------------------------------------------

function slugTitle(label) {
	return safeDriveFileName(String(label || '').slice(0, 80), 'three.ws model');
}

/** The current viewer frame as a PNG Blob, or null when the viewer cannot render one. */
async function posterBlob() {
	const viewer = document.getElementById('viewer');
	try {
		if (typeof viewer?.toBlob === 'function') return await viewer.toBlob({ mimeType: 'image/png', idealAspect: true });
		if (typeof viewer?.toDataURL === 'function') return await (await fetch(viewer.toDataURL('image/png'))).blob();
	} catch {
		// A tainted or lost WebGL context: skip the poster, keep the rest.
	}
	return null;
}

function createToast() {
	injectStyles();
	document.querySelector('.od-toast')?.remove();
	const el = document.createElement('div');
	el.className = 'od-toast';
	el.setAttribute('role', 'status');
	el.setAttribute('aria-live', 'polite');
	el.innerHTML = `
		<div class="od-toast-head">${CLOUD_ICON}<span>Saving to OneDrive</span></div>
		<div class="od-rows"></div>
		<div class="od-toast-foot"></div>
		<div class="od-toast-actions"><button type="button" class="od-btn od-btn-quiet" data-od="dismiss">Cancel</button></div>`;
	document.body.appendChild(el);
	const rows = el.querySelector('.od-rows');
	const head = el.querySelector('.od-toast-head span');
	const foot = el.querySelector('.od-toast-foot');
	const action = el.querySelector('[data-od="dismiss"]');
	return {
		el,
		action,
		row(name) {
			const r = document.createElement('div');
			r.className = 'od-row';
			r.innerHTML = '<span class="od-name"></span><span class="od-state">waiting</span><div class="od-bar"><i></i></div>';
			r.querySelector('.od-name').textContent = name;
			rows.appendChild(r);
			const state = r.querySelector('.od-state');
			const bar = r.querySelector('.od-bar i');
			return {
				progress(f) {
					state.textContent = `${Math.round(f * 100)}%`;
					bar.style.width = `${Math.round(f * 100)}%`;
				},
				done(item) {
					state.className = 'od-state is-ok';
					bar.style.width = '100%';
					state.textContent = '';
					if (item?.webUrl) {
						const a = document.createElement('a');
						a.href = item.webUrl;
						a.target = '_blank';
						a.rel = 'noopener';
						a.textContent = 'Open';
						a.setAttribute('aria-label', `Open ${item.name || name} in OneDrive`);
						state.appendChild(a);
					} else state.textContent = 'saved';
				},
				fail(message) {
					state.className = 'od-state is-error';
					state.textContent = 'failed';
					const e = document.createElement('span');
					e.className = 'od-err';
					e.textContent = message;
					r.appendChild(e);
				},
			};
		},
		finish(title, folder) {
			head.textContent = title;
			if (folder?.webUrl) {
				foot.innerHTML = '';
				const a = document.createElement('a');
				a.href = folder.webUrl;
				a.target = '_blank';
				a.rel = 'noopener';
				a.textContent = `Open ${folder.name || 'the folder'} in OneDrive`;
				foot.appendChild(a);
			}
			action.textContent = 'Close';
		},
		remove() {
			el.remove();
		},
	};
}

/**
 * The "Save to OneDrive" row in the Forge download menu. Hidden until the
 * server reports OneDrive as configured and a model is on screen.
 *
 * @param {HTMLElement} menu
 * @param {{ getGlbUrl: () => string, isLocalEdit: () => boolean }} o
 */
export function mountOneDriveMenuItem(menu, { getGlbUrl, isLocalEdit }) {
	let enabled = false;
	let model = null; // { glbUrl, label, creationId }
	let busy = false;
	const item = document.createElement('button');
	item.type = 'button';
	item.className = 'export-item';
	item.setAttribute('role', 'menuitem');
	item.dataset.format = 'onedrive';
	item.hidden = true;
	item.innerHTML = `
		<span class="fmt">OneDrive</span>
		<span class="blurb">Save the GLB, a poster image and the PowerPoint slide to a OneDrive or SharePoint folder you choose.</span>
		<span class="status" aria-live="polite"></span>`;
	const status = item.querySelector('.status');
	menu.appendChild(item);
	const sync = () => (item.hidden = !(enabled && model));
	oneDriveConfig().then((c) => {
		enabled = c.enabled;
		sync();
	});
	item.addEventListener('pointerenter', prefetchClient, { once: true });
	item.addEventListener('focus', prefetchClient, { once: true });

	item.addEventListener('click', async () => {
		if (busy || !model) return;
		status.classList.remove('is-error');
		if (navigator.onLine === false) {
			status.textContent = 'you are offline: reconnect, then try again';
			status.classList.add('is-error');
			return;
		}
		busy = true;
		item.setAttribute('aria-busy', 'true');
		status.innerHTML = '<span class="export-spinner" aria-hidden="true"></span> choose a folder';
		const snapshot = { ...model, glbUrl: getGlbUrl() || model.glbUrl, localEdit: isLocalEdit() };
		try {
			const picked = await pickWithDialog({ title: 'Choose a OneDrive or SharePoint folder', mode: 'folders' });
			status.textContent = '';
			const folder = picked?.[0];
			if (!folder) return;
			await saveModelToFolder(folder, snapshot);
		} catch (err) {
			if (err?.code === 'cancelled') status.textContent = '';
			else {
				status.textContent = err?.message || 'Could not save to OneDrive. Try again.';
				status.classList.add('is-error');
			}
		} finally {
			busy = false;
			item.removeAttribute('aria-busy');
		}
	});

	return {
		setModel(next) {
			model = next?.glbUrl ? next : null;
			status.textContent = '';
			status.classList.remove('is-error');
			sync();
		},
	};
}

async function saveModelToFolder(folder, model) {
	const driveId = folder.parentReference?.driveId;
	if (!folder.id || !driveId) throw new OneDriveError('bad_item', 'The picker returned a folder three.ws could not open. Pick it again.');
	const base = slugTitle(model.label);
	const toast = createToast();
	const controller = new AbortController();
	toast.action.addEventListener('click', () => {
		if (toast.action.textContent === 'Close') toast.remove();
		else controller.abort();
	});
	const { signal } = controller;

	// Each job yields its Blob lazily so a slow PowerPoint build never holds up the GLB.
	const jobs = [
		{
			name: `${base}.glb`,
			blob: async () => {
				const res = await fetch(model.glbUrl, { signal });
				if (!res.ok) throw new OneDriveError('source', 'Could not read the model file. Reload the model and try again.');
				const b = await res.blob();
				return b.type ? b : new Blob([b], { type: 'model/gltf-binary' });
			},
		},
		{
			name: `${base} poster.png`,
			blob: async () => {
				const b = await posterBlob();
				if (!b) throw new OneDriveError('poster', 'The viewer could not render a poster on this device.');
				return b;
			},
		},
	];
	if (model.creationId && !model.localEdit) {
		jobs.push({
			name: `${base}.pptx`,
			blob: async () => (await fetchPptx(model.creationId)).blob,
		});
	}
	const rows = jobs.map((j) => toast.row(j.name));

	let saved = 0;
	for (let i = 0; i < jobs.length; i++) {
		if (signal.aborted) {
			rows[i].fail('Cancelled.');
			continue;
		}
		try {
			const blob = await jobs[i].blob();
			const item = await uploadToFolder({
				fetch: graphFetch,
				getToken: graphToken,
				driveId,
				folderId: folder.id,
				name: jobs[i].name,
				blob,
				onProgress: (f) => rows[i].progress(f),
				signal,
			});
			rows[i].done(item);
			saved++;
		} catch (err) {
			rows[i].fail(err?.name === 'AbortError' || err?.code === 'cancelled' ? 'Cancelled.' : err?.message || 'Upload failed.');
		}
	}

	let folderInfo = { name: folder.name, webUrl: folder.webUrl };
	if (!folderInfo.webUrl && saved) {
		try {
			const res = await graphRequest(`${GRAPH_BASE}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(folder.id)}?$select=name,webUrl`, {
				fetch: graphFetch,
				getToken: graphToken,
			});
			folderInfo = await res.json();
		} catch {
			// The per-file Open links already work; the folder link is a bonus.
		}
	}
	const title = saved === jobs.length ? 'Saved to OneDrive' : saved ? `Saved ${saved} of ${jobs.length} files` : signal.aborted ? 'Save cancelled' : 'Nothing was saved';
	toast.finish(title, saved ? folderInfo : null);
	toast.action.focus();
}

// ---- boot --------------------------------------------------------------------

oneDriveConfig().then((c) => {
	if (c.enabled) mountPhotoSource();
});

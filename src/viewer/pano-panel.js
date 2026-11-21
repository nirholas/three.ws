// UI for a user's own 360 photo: the picker panel (empty, loading, error and
// ready states), the canvas loading overlay with real progress, and drag-and-drop
// onto the canvas. It only talks to a PanoController, so the viewer and the splat
// page get identical controls.

import { PANO_ACCEPT, PANO_RANGES, PANO_MESSAGES, parseEnvParam } from './pano-photo.js';

const STYLE_ID = 'pano-panel-style';

const CSS = `
.pano-panel{--pp-bg:rgba(18,18,24,.94);--pp-fg:#eceaf4;--pp-dim:#a29fb4;--pp-line:rgba(255,255,255,.14);--pp-accent:#8b7cf6;--pp-accent-fg:#0d0b18;--pp-bad:#ff8f8f;
 box-sizing:border-box;width:min(340px,calc(100vw - 32px));max-height:calc(100% - 24px);overflow:auto;padding:14px 14px 16px;border-radius:14px;
 background:var(--pp-bg);color:var(--pp-fg);border:1px solid var(--pp-line);box-shadow:0 12px 40px rgba(0,0,0,.45);font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;backdrop-filter:blur(12px)}
.pano-panel *{box-sizing:border-box}
.pano-panel[hidden]{display:none}
.pano-panel__head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px}
.pano-panel__title{margin:0;font-size:14px;font-weight:650;letter-spacing:.01em}
.pano-panel p{margin:0 0 10px;color:var(--pp-dim)}
.pano-panel ol{margin:0 0 12px;padding-left:18px;color:var(--pp-dim)}
.pano-panel li{margin-bottom:4px}
.pano-panel b{color:var(--pp-fg);font-weight:600}
.pano-btn{appearance:none;display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:34px;padding:7px 12px;border-radius:9px;border:1px solid var(--pp-line);
 background:rgba(255,255,255,.06);color:var(--pp-fg);font:inherit;font-weight:550;cursor:pointer;transition:background .15s,border-color .15s,transform .1s}
.pano-btn:hover{background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.28)}
.pano-btn:active{transform:translateY(1px);background:rgba(255,255,255,.16)}
.pano-btn:focus-visible,.pano-field input:focus-visible,.pano-range input:focus-visible,.pano-switch input:focus-visible+span{outline:2px solid var(--pp-accent);outline-offset:2px}
.pano-btn--primary{background:var(--pp-accent);border-color:var(--pp-accent);color:var(--pp-accent-fg)}
.pano-btn--primary:hover{background:#a094ff;border-color:#a094ff}
.pano-btn--block{width:100%}
.pano-btn--icon{min-height:28px;width:28px;padding:0}
.pano-field{display:flex;gap:6px;margin:10px 0 0}
.pano-field input{flex:1;min-width:0;min-height:34px;padding:6px 10px;border-radius:9px;border:1px solid var(--pp-line);background:rgba(0,0,0,.35);color:var(--pp-fg);font:inherit}
.pano-field input::placeholder{color:#7d7a90}
.pano-or{margin:10px 0 0;text-align:center;color:var(--pp-dim);font-size:12px}
.pano-private{margin:12px 0 0!important;font-size:12px}
.pano-skel{height:10px;border-radius:5px;background:linear-gradient(90deg,rgba(255,255,255,.07),rgba(255,255,255,.18),rgba(255,255,255,.07));background-size:200% 100%;animation:pano-shimmer 1.2s linear infinite;margin:6px 0}
.pano-skel--wide{height:46px;border-radius:9px}
.pano-bar{height:6px;border-radius:3px;background:rgba(255,255,255,.12);overflow:hidden;margin:10px 0 6px}
.pano-bar>span{display:block;height:100%;width:0;background:var(--pp-accent);transition:width .12s linear}
.pano-bar--indeterminate>span{width:40%;animation:pano-slide 1s ease-in-out infinite alternate}
@keyframes pano-shimmer{to{background-position:-200% 0}}
@keyframes pano-slide{from{margin-left:0}to{margin-left:60%}}
.pano-error{margin:0 0 12px;padding:10px 12px;border-radius:10px;border:1px solid rgba(255,143,143,.4);background:rgba(255,143,143,.1);color:var(--pp-fg)}
.pano-error strong{display:block;margin-bottom:2px;color:var(--pp-bad)}
.pano-meta{margin:0 0 12px;color:var(--pp-dim);font-size:12px;word-break:break-word}
.pano-meta b{display:block;margin-bottom:2px}
.pano-group{margin:12px 0 0;padding:10px 0 0;border-top:1px solid var(--pp-line)}
.pano-group h3{margin:0 0 8px;font-size:12px;font-weight:650;color:var(--pp-dim);text-transform:uppercase;letter-spacing:.06em}
.pano-switch{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 8px;cursor:pointer}
.pano-switch input{position:absolute;opacity:0;width:1px;height:1px}
.pano-switch span{position:relative;flex:none;width:34px;height:20px;border-radius:10px;background:rgba(255,255,255,.2);transition:background .15s}
.pano-switch span::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .15s}
.pano-switch input:checked+span{background:var(--pp-accent)}
.pano-switch input:checked+span::after{transform:translateX(14px)}
.pano-switch:hover span{filter:brightness(1.15)}
.pano-range{display:grid;grid-template-columns:1fr auto;gap:2px 8px;margin:0 0 8px;align-items:center}
.pano-range label{color:var(--pp-fg)}
.pano-range output{color:var(--pp-dim);font-variant-numeric:tabular-nums;font-size:12px}
.pano-range input{grid-column:1/-1;width:100%;margin:2px 0;accent-color:var(--pp-accent);cursor:pointer}
.pano-range input:disabled{opacity:.4;cursor:not-allowed}
.pano-actions{display:flex;gap:8px;margin-top:12px}
.pano-actions .pano-btn{flex:1}
.pano-overlay{position:absolute;inset:0;z-index:30;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(10,10,16,.55);backdrop-filter:blur(3px);color:#eceaf4;font:13px/1.45 system-ui,sans-serif;pointer-events:none}
.pano-overlay[hidden]{display:none}
.pano-overlay__card{width:min(320px,100%);padding:16px;border-radius:14px;background:rgba(18,18,24,.92);border:1px solid rgba(255,255,255,.14)}
.pano-overlay__card strong{display:block;margin-bottom:4px}
.pano-overlay__card p{margin:0;color:#a29fb4;font-size:12px}
.pano-drop{position:absolute;inset:8px;z-index:29;display:none;align-items:center;justify-content:center;border:2px dashed #8b7cf6;border-radius:14px;background:rgba(139,124,246,.14);color:#eceaf4;font:600 15px system-ui,sans-serif;pointer-events:none}
.pano-drop.is-active{display:flex}
@media (prefers-reduced-motion:reduce){.pano-skel,.pano-bar--indeterminate>span{animation:none}.pano-btn,.pano-bar>span{transition:none}}
`;

function ensureStyle() {
	if (document.getElementById(STYLE_ID)) return;
	const style = document.createElement('style');
	style.id = STYLE_ID;
	style.textContent = CSS;
	document.head.appendChild(style);
}

let uid = 0;

function h(tag, props = {}, ...kids) {
	const el = document.createElement(tag);
	for (const [k, v] of Object.entries(props)) {
		if (v == null || v === false) continue;
		if (k === 'class') el.className = v;
		else if (k === 'text') el.textContent = v;
		else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
		else el.setAttribute(k, v === true ? '' : v);
	}
	for (const kid of kids) if (kid) el.append(kid);
	return el;
}

const mb = (bytes) => `${(bytes / 1048576).toFixed(bytes < 10485760 ? 1 : 0)} MB`;

const RANGE_TEXT = {
	rotation: (v) => `${Math.round(v)} degrees`,
	blur: (v) => `${Math.round(v * 100)} percent`,
	backgroundIntensity: (v) => `${Math.round(v * 100)} percent`,
	lightingIntensity: (v) => `${Math.round(v * 100)} percent`,
	brightenStrength: (v) => `${Math.round(v * 100)} percent`,
	groundOffset: (v) => `${v >= 0 ? 'up' : 'down'} ${Math.abs(v).toFixed(2)} metres`,
};
const RANGE_SHORT = {
	rotation: (v) => `${Math.round(v)}°`,
	blur: (v) => `${Math.round(v * 100)}%`,
	backgroundIntensity: (v) => `${Math.round(v * 100)}%`,
	lightingIntensity: (v) => `${Math.round(v * 100)}%`,
	brightenStrength: (v) => `${Math.round(v * 100)}%`,
	groundOffset: (v) => `${v.toFixed(2)} m`,
};

/**
 * Build the picker panel for a controller.
 * @param {import('./pano-stage.js').PanoController} controller
 * @param {{ onClose?: () => void, title?: string }} [options]
 * @returns {{ el: HTMLElement, destroy: () => void, openPicker: () => void }}
 */
export function createPanoPanel(controller, { onClose, title = 'Your 360 photo' } = {}) {
	ensureStyle();
	const id = `pano${++uid}`;
	const file = h('input', { type: 'file', accept: PANO_ACCEPT, hidden: true, id: `${id}-file` });
	const openPicker = () => file.click();
	file.addEventListener('change', () => {
		const picked = file.files?.[0];
		file.value = '';
		if (picked) controller.load(picked);
	});

	const urlInput = h('input', {
		type: 'url',
		id: `${id}-url`,
		placeholder: 'https://example.com/photo-360.jpg',
		autocomplete: 'off',
		'aria-label': '360 photo link',
	});
	const submitUrl = () => {
		const parsed = parseEnvParam(urlInput.value);
		if (parsed.kind === 'url') controller.load(parsed.url);
		else controller._setStatus('error', { error: { code: 'badUrl', message: PANO_MESSAGES.badUrl } });
	};
	urlInput.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') submitUrl();
	});

	const close = onClose
		? h('button', { class: 'pano-btn pano-btn--icon', type: 'button', 'aria-label': 'Close 360 photo panel', title: 'Close', onclick: onClose, text: '×' })
		: null;

	const errorBox = h('div', { class: 'pano-error', role: 'alert' });
	const loadingBox = h('div', { role: 'status', 'aria-live': 'polite' });
	const loadingText = h('p', { text: '' });
	const bar = h('div', { class: 'pano-bar', role: 'progressbar', 'aria-label': 'Reading 360 photo', 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('span'));
	loadingBox.append(h('div', { class: 'pano-skel pano-skel--wide' }), bar, loadingText);

	const emptyBox = h(
		'div',
		{},
		h('p', {}, 'A 360 photo is one flat, 2:1 panorama from a 360 camera. Add yours and your avatar stands in that place, lit by it.'),
		h(
			'ol',
			{},
			h('li', {}, 'Insta360 app: open the photo, tap Export, then ', h('b', { text: 'Export Original' }), '.'),
			h('li', {}, 'Insta360 Studio: open the photo, choose ', h('b', { text: 'Export Original' }), ' and the JPG format.'),
			h('li', {}, 'Other 360 cameras: export the full equirectangular 2:1 panorama.'),
		),
		h('button', { class: 'pano-btn pano-btn--primary pano-btn--block', type: 'button', onclick: openPicker, text: 'Choose a 360 photo' }),
		h('p', { class: 'pano-or', text: 'or drop it on the canvas, or paste a link' }),
		h(
			'div',
			{ class: 'pano-field' },
			urlInput,
			h('button', { class: 'pano-btn', type: 'button', onclick: submitUrl, text: 'Use link' }),
		),
		h('p', { class: 'pano-private', text: 'Your photo stays in your browser. Nothing is uploaded. JPEG, PNG, WebP, AVIF, EXR and HDR work.' }),
	);

	const meta = h('div', { class: 'pano-meta' });
	const controls = h('div', {});

	function range(key, label, { disabled } = {}) {
		const r = PANO_RANGES[key];
		const input = h('input', { type: 'range', id: `${id}-${key}`, min: r.min, max: r.max, step: r.step });
		const out = h('output', { for: input.id });
		const sync = () => {
			const v = Number(controller.settings[key]);
			input.value = String(v);
			input.setAttribute('aria-valuetext', RANGE_TEXT[key](v));
			out.textContent = RANGE_SHORT[key](v);
			input.disabled = Boolean(disabled?.());
		};
		input.addEventListener('input', () => {
			controller.set(key, input.value);
			sync();
		});
		const row = h('div', { class: 'pano-range' }, h('label', { for: input.id, text: label }), out, input);
		return { row, sync };
	}

	function toggle(key, label) {
		const input = h('input', { type: 'checkbox', id: `${id}-${key}` });
		input.addEventListener('change', () => controller.set(key, input.checked));
		const row = h('label', { class: 'pano-switch', for: input.id }, h('b', { text: label }), input, h('span', { 'aria-hidden': 'true' }));
		return { row, sync: () => { input.checked = Boolean(controller.settings[key]); } };
	}

	const syncers = [];
	const add = (parent, built) => {
		parent.append(built.row);
		syncers.push(built.sync);
	};
	const hasLighting = controller.features.lighting !== false;
	const lightGroup = h('div', { class: 'pano-group' }, h('h3', { text: 'Lighting' }));
	const backdropGroup = h('div', { class: 'pano-group' }, h('h3', { text: 'Backdrop' }));
	if (hasLighting) {
		add(lightGroup, toggle('lighting', 'Use as lighting'));
		add(lightGroup, range('lightingIntensity', 'Light intensity', { disabled: () => !controller.settings.lighting }));
		add(lightGroup, range('rotation', 'Rotate so the sun lines up'));
		add(lightGroup, toggle('brighten', 'Brighten highlights'));
		add(lightGroup, range('brightenStrength', 'Highlight strength', { disabled: () => !controller.settings.brighten || !controller.settings.lighting }));
	}
	lightGroup.hidden = !hasLighting;
	add(backdropGroup, toggle('background', 'Show as background'));
	if (!hasLighting) add(backdropGroup, range('rotation', 'Rotate the backdrop'));
	add(backdropGroup, range('blur', 'Background blur', { disabled: () => !controller.settings.background }));
	add(backdropGroup, range('backgroundIntensity', 'Background brightness', { disabled: () => !controller.settings.background }));
	const groundGroup = h('div', { class: 'pano-group' }, h('h3', { text: 'Ground' }));
	add(groundGroup, range('groundOffset', 'Shadow height'));
	groundGroup.hidden = !controller.features.ground;
	controls.append(lightGroup, backdropGroup, groundGroup);
	controls.append(
		h(
			'div',
			{ class: 'pano-actions' },
			h('button', { class: 'pano-btn', type: 'button', onclick: openPicker, text: 'Change photo' }),
			h('button', { class: 'pano-btn', type: 'button', onclick: () => controller.clear(), text: 'Remove' }),
		),
	);

	const retry = h('div', { class: 'pano-actions' }, h('button', { class: 'pano-btn', type: 'button', onclick: () => controller.dismissError(), text: 'Dismiss' }), h('button', { class: 'pano-btn pano-btn--primary', type: 'button', onclick: openPicker, text: 'Choose another' }));
	const errorWrap = h('div', {}, errorBox, retry);

	const el = h(
		'section',
		{ class: 'pano-panel', 'aria-label': title },
		h('div', { class: 'pano-panel__head' }, h('h2', { class: 'pano-panel__title', text: title }), close),
		errorWrap,
		loadingBox,
		emptyBox,
		controls,
		file,
	);

	function render() {
		const { status } = controller;
		errorWrap.hidden = status !== 'error';
		loadingBox.hidden = status !== 'loading';
		const showEmpty = status === 'empty' || (status === 'error' && !controller.image);
		emptyBox.hidden = !showEmpty;
		controls.hidden = !(controller.image && status !== 'loading');
		if (status === 'error') {
			errorBox.replaceChildren(h('strong', { text: 'Could not use that photo' }), controller.error?.message || PANO_MESSAGES.unreadable);
		}
		if (status === 'loading') {
			const pct = Math.round((controller.progress || 0) * 100);
			const known = controller.progress > 0;
			bar.classList.toggle('pano-bar--indeterminate', !known);
			bar.firstChild.style.width = known ? `${pct}%` : '';
			if (known) bar.setAttribute('aria-valuenow', String(pct));
			else bar.removeAttribute('aria-valuenow');
			loadingText.textContent = controller.loadedBytes ? `Reading ${mb(controller.loadedBytes)}${known ? ` (${pct}%)` : ''}` : 'Reading photo';
		}
		const img = controller.image;
		if (img) {
			meta.replaceChildren(
				h('b', { text: img.name }),
				`${img.sourceWidth} x ${img.sourceHeight}${img.scaled ? `, decoded at ${img.width} x ${img.height}` : ''}, ${mb(img.bytes)}, ${img.format.toUpperCase()}`,
			);
			if (!meta.isConnected) controls.prepend(meta);
		}
		for (const sync of syncers) sync();
	}

	controller.addEventListener('change', render);
	render();

	return {
		el,
		openPicker,
		destroy() {
			controller.removeEventListener('change', render);
			el.remove();
		},
	};
}

/**
 * Canvas overlay shown while a photo is being read and decoded.
 * @param {HTMLElement} host a positioned element covering the canvas
 * @param {import('./pano-stage.js').PanoController} controller
 */
export function createPanoOverlay(host, controller, { showErrors = () => true } = {}) {
	ensureStyle();
	const title = h('strong', { text: 'Loading your 360 photo' });
	const text = h('p', { text: 'Reading photo' });
	const bar = h('div', { class: 'pano-bar pano-bar--indeterminate', role: 'progressbar', 'aria-label': 'Loading 360 photo', 'aria-valuemin': '0', 'aria-valuemax': '100' }, h('span'));
	const skel = h('div', { class: 'pano-skel' });
	const dismiss = h('button', { class: 'pano-btn', type: 'button', style: 'margin-top:10px;pointer-events:auto', onclick: () => controller.dismissError(), text: 'Dismiss' });
	const card = h('div', { class: 'pano-overlay__card' }, title, skel, bar, text, dismiss);
	const el = h('div', { class: 'pano-overlay', role: 'status', 'aria-live': 'polite', hidden: true }, card);
	host.append(el);
	const render = () => {
		const loading = controller.status === 'loading';
		const failed = controller.status === 'error' && showErrors();
		el.hidden = !(loading || failed);
		if (el.hidden) return;
		el.setAttribute('role', failed ? 'alert' : 'status');
		skel.hidden = bar.hidden = !loading;
		dismiss.hidden = !failed;
		if (failed) {
			title.textContent = 'Could not use that photo';
			text.textContent = controller.error?.message || PANO_MESSAGES.unreadable;
			return;
		}
		title.textContent = 'Loading your 360 photo';
		const known = controller.progress > 0;
		const pct = Math.round(controller.progress * 100);
		bar.classList.toggle('pano-bar--indeterminate', !known);
		bar.firstChild.style.width = known ? `${pct}%` : '';
		if (known) bar.setAttribute('aria-valuenow', String(pct));
		else bar.removeAttribute('aria-valuenow');
		text.textContent = controller.loadedBytes ? `Reading ${mb(controller.loadedBytes)}${known ? ` (${pct}%)` : ' then decoding'}` : 'Reading photo';
	};
	controller.addEventListener('change', render);
	return {
		render,
		destroy() {
			controller.removeEventListener('change', render);
			el.remove();
		},
	};
}

/**
 * Accept a dropped 360 photo anywhere on `host`. Splat files and other drops are
 * left alone: only an image file (by type or extension) is claimed.
 * @param {HTMLElement} host
 * @param {import('./pano-stage.js').PanoController} controller
 * @param {{ accepts?: (file: File) => boolean }} [options]
 */
export function attachPanoDrop(host, controller, { accepts = isImageFile } = {}) {
	ensureStyle();
	const hint = h('div', { class: 'pano-drop', 'aria-hidden': 'true', text: 'Drop to use as your 360 photo' });
	host.append(hint);
	// Only a lone image claims the drop. A glTF folder or several files (a model
	// with its textures) belongs to the model loader and is never intercepted.
	const items = (e) => Array.from(e.dataTransfer?.items || []).filter((i) => i.kind === 'file');
	const hasFile = (e) => {
		const files = items(e);
		return files.length === 1 && (files[0].type === '' || files[0].type.startsWith('image/'));
	};
	let depth = 0;
	const enter = (e) => {
		if (!hasFile(e)) return;
		depth++;
		hint.classList.add('is-active');
	};
	const over = (e) => {
		if (hasFile(e)) e.preventDefault();
	};
	const leave = () => {
		depth = Math.max(0, depth - 1);
		if (!depth) hint.classList.remove('is-active');
	};
	const drop = (e) => {
		depth = 0;
		hint.classList.remove('is-active');
		const files = Array.from(e.dataTransfer?.files || []);
		const dropped = files.length === 1 && accepts(files[0]) ? files[0] : null;
		if (!dropped) return;
		e.preventDefault();
		e.stopImmediatePropagation();
		controller.load(dropped);
	};
	host.addEventListener('dragenter', enter, true);
	host.addEventListener('dragover', over, true);
	host.addEventListener('dragleave', leave, true);
	host.addEventListener('drop', drop, true);
	return {
		destroy() {
			host.removeEventListener('dragenter', enter, true);
			host.removeEventListener('dragover', over, true);
			host.removeEventListener('dragleave', leave, true);
			host.removeEventListener('drop', drop, true);
			hint.remove();
		},
	};
}

/** Image containers a 360 photo can arrive in (never a glTF, splat or video). */
export function isImageFile(file) {
	return /^image\//.test(file.type) || /\.(jpe?g|png|webp|avif|exr|hdr)$/i.test(file.name);
}

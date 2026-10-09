// Workbench controller: wires the viewport, the workflow model, the graph
// editor and the platform API into the four rail views (Generate, Workflows,
// Extensions, Settings). Everything persistent lives in localStorage under
// the wb: prefix; everything remote goes through ./api.js.

import { mountViewport } from './viewport.js';
import { mountGraphEditor } from './graph-editor.js';
import { runWorkflow } from './runner.js';
import { countScene, decimateScene, smoothScene } from './mesh-tools.js';
import { CLIENT_ID, fetchCatalog, fetchHealth, uploadImage } from './api.js';
import {
	NODE_TYPES,
	PALETTE,
	TEMPLATES,
	duplicateWorkflow,
	insertNode,
	loadActiveId,
	loadWorkflows,
	resetWorkflows,
	saveActiveId,
	saveWorkflows,
	tidy,
	validate,
} from './workflows.js';

const $ = (id) => document.getElementById(id);
const VIEWS = ['generate', 'workflows', 'extensions', 'settings'];
const HISTORY_KEY = 'wb:history';
const HISTORY_MAX = 30;
const LANES_OFF_KEY = 'wb:lanes-off';
const SETTINGS_KEY = 'wb:settings';
const PROMPT_MAX = 1000;

const ICONS = {
	chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 15-6-6-6 6"/></svg>',
	image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>',
	close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
	dice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/><circle cx="16" cy="16" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/></svg>',
	plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
};

// ── storage ────────────────────────────────────────────────────

function readJSON(key, fallback) {
	try {
		const v = JSON.parse(localStorage.getItem(key) || 'null');
		return v ?? fallback;
	} catch {
		return fallback;
	}
}

function writeJSON(key, value) {
	try {
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// Storage full or blocked: this session keeps working from memory.
	}
}

// ── state ──────────────────────────────────────────────────────

const app = $('wb-app');
let vp = null;
let graph = null;
let flows = loadWorkflows();
let activeId = loadActiveId(flows);
let editingId = activeId;
let catalog = null;
let health = null;
let lanesOff = new Set(readJSON(LANES_OFF_KEY, []));
const settings = { grid: true, env: true, spin: false, ...readJSON(SETTINGS_KEY, {}) };
let recent = readJSON(HISTORY_KEY, []);

// The image waiting in the Image node. Uploading starts the moment it is
// dropped so the run does not wait for it.
let source = { file: null, preview: null, url: null, upload: null, error: null };
let promptText = '';

// What the viewport currently shows, so "Copy GLB link" only offers a URL that
// matches the pixels. editDepth tracks undo-able edits since the last save.
let current = { url: null, name: 'model' };
let editDepth = 0;
let hasModel = false;
let run = null;

const activeFlow = () => flows.find((f) => f.id === activeId) || flows[0];
const editingFlow = () => flows.find((f) => f.id === editingId) || activeFlow();

function persistFlows() {
	saveWorkflows(flows);
}

// ── small DOM helpers ──────────────────────────────────────────

function h(tag, props = {}, ...children) {
	const node = document.createElement(tag);
	for (const [k, v] of Object.entries(props)) {
		if (v == null || v === false) continue;
		if (k === 'class') node.className = v;
		else if (k === 'text') node.textContent = v;
		else if (k === 'html') node.innerHTML = v;
		else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
		else if (k === 'dataset') Object.assign(node.dataset, v);
		else node.setAttribute(k, v === true ? '' : v);
	}
	for (const c of children.flat()) if (c != null && c !== false) node.append(c);
	return node;
}

function timeAgo(ts) {
	const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
	if (s < 60) return `${s}s ago`;
	const m = Math.round(s / 60);
	if (m < 60) return `${m}m ago`;
	const hr = Math.round(m / 60);
	if (hr < 48) return `${hr}h ago`;
	return new Date(ts).toLocaleDateString();
}

function clock(ms) {
	const s = Math.floor(ms / 1000);
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function download(blob, filename) {
	const url = URL.createObjectURL(blob);
	const a = h('a', { href: url, download: filename });
	document.body.append(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 4000);
}

const safeName = (s) =>
	String(s || 'model')
		.replace(/\.[a-z0-9]+$/i, '')
		.replace(/[^a-z0-9-_]+/gi, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48) || 'model';

// ── toasts ─────────────────────────────────────────────────────

function toast(message, { tone = 'info', actions = [], timeout } = {}) {
	const box = $('wb-toasts');
	const el = h('div', { class: 'wb-toast', role: tone === 'err' ? 'alert' : 'status', dataset: { tone } }, h('p', { text: message }));
	const close = () => {
		el.dataset.leaving = 'true';
		setTimeout(() => el.remove(), 200);
	};
	for (const a of actions) {
		el.append(
			h('button', {
				type: 'button',
				text: a.label,
				onclick: () => {
					close();
					a.run();
				},
			}),
		);
	}
	el.append(h('button', { type: 'button', class: 'wb-toast-x', 'aria-label': 'Dismiss', html: ICONS.close, onclick: close }));
	box.append(el);
	while (box.children.length > 4) box.firstElementChild.remove();
	const ms = timeout ?? (tone === 'err' ? 12000 : actions.length ? 9000 : 4500);
	if (ms) setTimeout(close, ms);
	return close;
}

// ── views / routing ────────────────────────────────────────────

function setView(view, { push = true } = {}) {
	if (!VIEWS.includes(view)) view = 'generate';
	app.dataset.view = view;
	for (const b of document.querySelectorAll('.wb-rail-btn')) {
		if (b.dataset.nav === view) b.setAttribute('aria-current', 'page');
		else b.removeAttribute('aria-current');
	}
	closeMenus();
	if (push && location.hash.slice(1) !== view) syncHash(view);
	if (view === 'workflows') renderWorkflowsView();
	if (view === 'extensions' && !health) loadExtensions();
	if (view === 'settings') renderSettings();
}

function syncHash(view) {
	const url = view === 'generate' ? location.pathname + location.search : `#${view}`;
	window.history.replaceState(null, '', url);
}

// ── generate panel: node cards ─────────────────────────────────

function availableLanes() {
	if (!catalog) return [];
	return catalog.backends.filter(
		(b) => b.paths?.includes('image') && b.user_images && b.configured && !b.byok && !lanesOff.has(b.id),
	);
}

function renderFlowSelect() {
	const sel = $('wb-flow-select');
	sel.replaceChildren(...flows.map((f) => h('option', { value: f.id, text: f.name })));
	sel.value = activeFlow().id;
}

function paramControl(node, p) {
	const value = node.params[p.key];
	const id = `wb-p-${node.id}-${p.key}`;
	const set = (v) => {
		node.params[p.key] = v;
		persistFlows();
	};
	let control;
	switch (p.type) {
		case 'select':
		case 'lane': {
			const options =
				p.type === 'lane'
					? [['auto', 'Auto (best available)'], ...availableLanes().map((b) => [b.id, b.label])]
					: p.options;
			if (p.type === 'lane' && catalog && value !== 'auto' && !options.some(([v]) => v === value)) {
				// The pinned engine was switched off or went away: fall back to routing.
				node.params[p.key] = 'auto';
				persistFlows();
			}
			if (p.type === 'lane' && !catalog && value !== 'auto') options.push([value, value]);
			control = h(
				'select',
				{ class: 'wb-select', id, onchange: (e) => set(e.target.value) },
				options.map(([v, label]) => h('option', { value: v, text: label })),
			);
			control.value = String(node.params[p.key] ?? '');
			break;
		}
		case 'number':
			control = h('input', {
				class: 'wb-input',
				id,
				type: 'number',
				inputmode: 'numeric',
				min: p.min,
				max: p.max,
				step: p.step,
				placeholder: p.placeholder,
				value: value === '' || value == null ? '' : String(value),
				onchange: (e) => {
					const raw = e.target.value.trim();
					if (raw === '') return set('');
					const n = Math.min(p.max, Math.max(p.min, Math.round(Number(raw))));
					e.target.value = String(n);
					set(n);
				},
			});
			break;
		case 'range': {
			const fmt = (v) => (p.format === 'percent' ? `${Math.round(Number(v) * 100)}%` : String(v));
			const out = h('output', { for: id, text: fmt(value) });
			const input = h('input', {
				type: 'range',
				id,
				min: p.min,
				max: p.max,
				step: p.step,
				value: String(value),
				oninput: (e) => (out.textContent = fmt(e.target.value)),
				onchange: (e) => set(Number(e.target.value)),
			});
			control = h('div', { class: 'wb-range' }, input, out);
			break;
		}
		case 'text':
			control = h('input', {
				class: 'wb-input',
				id,
				type: 'text',
				maxlength: p.maxLength,
				value: String(value ?? ''),
				onchange: (e) => set(e.target.value.trim()),
			});
			break;
		case 'seed': {
			const input = h('input', {
				class: 'wb-input',
				id,
				type: 'number',
				min: 0,
				max: 2147483647,
				placeholder: 'Random',
				value: value === '' || value == null ? '' : String(value),
				onchange: (e) => set(e.target.value.trim() === '' ? '' : Math.max(0, Math.floor(Number(e.target.value)))),
			});
			const dice = h('button', {
				type: 'button',
				class: 'wb-icon-btn',
				'aria-label': 'Pick a random seed',
				title: 'Random seed',
				html: ICONS.dice,
				onclick: () => {
					const n = crypto.getRandomValues(new Uint32Array(1))[0] % 2147483647;
					input.value = String(n);
					set(n);
				},
			});
			control = h('div', { class: 'wb-row' }, input, dice);
			break;
		}
		default:
			return null;
	}
	const row = h('label', { class: 'wb-param', for: id }, h('span', { text: p.label, title: p.hint || p.label }), control);
	if (p.type === 'range' || p.type === 'seed') row.removeAttribute('for');
	return row;
}

function imageNodeBody() {
	const status = h('div', { class: 'wb-drop-status', id: 'wb-drop-status', hidden: true });
	const img = h('img', { alt: 'Reference image', hidden: !source.preview, src: source.preview || null });
	const input = h('input', {
		type: 'file',
		accept: 'image/png,image/jpeg,image/webp',
		'aria-label': 'Choose a reference image',
		onchange: (e) => e.target.files[0] && setImage(e.target.files[0]),
	});
	const clear = h('button', {
		type: 'button',
		class: 'wb-icon-btn wb-drop-clear',
		'aria-label': 'Remove image',
		title: 'Remove image',
		hidden: !source.preview,
		html: ICONS.close,
		onclick: (e) => {
			e.stopPropagation();
			clearImage();
		},
	});
	const empty = h(
		'div',
		{ class: 'wb-drop-empty', hidden: Boolean(source.preview) },
		h('span', { html: ICONS.image }),
		h('strong', { text: 'Drop image here' }),
		h('span', { text: 'or click to browse. Paste works too.' }),
	);
	const drop = h('div', { class: 'wb-drop', id: 'wb-drop' }, input, empty, img, clear, status);
	drop.addEventListener('dragover', (e) => {
		e.preventDefault();
		e.stopPropagation();
		drop.classList.add('is-over');
	});
	drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
	drop.addEventListener('drop', (e) => {
		e.preventDefault();
		e.stopPropagation();
		drop.classList.remove('is-over');
		const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/'));
		if (file) setImage(file);
		else toast('Drop a PNG, JPG or WebP image here. Models go on the viewport.', { tone: 'warn' });
	});
	const promptBox = h('textarea', {
		class: 'wb-input wb-prompt',
		id: 'wb-prompt',
		rows: 2,
		maxlength: PROMPT_MAX,
		placeholder: 'Or describe it: a weathered bronze dragon statue',
		'aria-label': 'Describe the object instead of using an image',
		disabled: Boolean(source.file),
		oninput: (e) => (promptText = e.target.value),
	});
	promptBox.value = promptText;
	queueMicrotask(updateDropStatus);
	return [drop, promptBox];
}

function renderNodes() {
	const flow = activeFlow();
	const { ok, order, errors } = validate(flow);
	const box = $('wb-nodes');
	const nodes = ok ? order : flow.nodes;
	const cards = nodes.map((node) => {
		const t = NODE_TYPES[node.type];
		const off = !t.locked && node.enabled === false;
		const head = h('div', { class: 'wb-node-head' });
		if (!t.locked) {
			head.append(
				h(
					'label',
					{ class: 'wb-switch', title: off ? `Turn ${t.label} on` : `Skip ${t.label}` },
					h('input', {
						type: 'checkbox',
						checked: !off,
						'aria-label': `Run ${t.label}`,
						onchange: (e) => {
							node.enabled = e.target.checked;
							card.dataset.off = String(!node.enabled);
							persistFlows();
						},
					}),
					h('span'),
				),
			);
		}
		head.append(
			h(
				'div',
				{ class: 'wb-node-title' },
				h('strong', { text: t.label }),
				h(
					'span',
					{ class: 'wb-io' },
					h('span', { class: 'in', text: t.in || 'source' }),
					h('span', { class: 'arrow', text: '→' }),
					h('span', { class: 'out', text: t.out || 'scene' }),
				),
			),
		);
		const chev = h('button', {
			type: 'button',
			class: 'wb-chev',
			'aria-label': `Collapse ${t.label}`,
			'aria-expanded': String(!node.collapsed),
			html: ICONS.chevron,
			onclick: () => {
				node.collapsed = !node.collapsed;
				card.dataset.collapsed = String(node.collapsed);
				chev.setAttribute('aria-expanded', String(!node.collapsed));
				persistFlows();
			},
		});
		head.append(chev);
		const body = h('div', { class: 'wb-node-body' });
		if (node.type === 'image') body.append(...imageNodeBody());
		for (const p of t.params) {
			const row = paramControl(node, p);
			if (row) body.append(row);
		}
		if (!t.params.length && node.type !== 'image') body.append(h('p', { class: 'wb-hint', text: t.blurb }));
		const card = h(
			'section',
			{
				class: 'wb-node',
				dataset: { id: node.id, type: node.type, off: String(off), collapsed: String(Boolean(node.collapsed)) },
				'aria-label': t.label,
			},
			head,
			body,
		);
		return card;
	});
	if (!ok) {
		cards.unshift(
			h(
				'div',
				{ class: 'wb-flow-warning', role: 'alert' },
				h('strong', { text: 'This workflow cannot run yet' }),
				h('p', { text: errors[0].message }),
				h('button', {
					type: 'button',
					class: 'wb-btn',
					text: 'Fix in Workflows',
					onclick: () => {
						editingId = activeId;
						setView('workflows');
					},
				}),
			),
		);
	}
	box.replaceChildren(...cards);
	updateRunButton();
}

// ── reference image ────────────────────────────────────────────

function setImage(file) {
	if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) {
		toast('Use a PNG, JPG or WebP image.', { tone: 'err' });
		return;
	}
	if (file.size > 8 * 1024 * 1024) {
		toast(`That image is ${(file.size / 1048576).toFixed(1)} MB. The limit is 8 MB.`, { tone: 'err' });
		return;
	}
	if (source.preview) URL.revokeObjectURL(source.preview);
	source = { file, preview: URL.createObjectURL(file), url: null, upload: null, error: null };
	startUpload();
	if (app.dataset.view !== 'generate') setView('generate');
	renderNodes();
}

function startUpload() {
	const file = source.file;
	source.error = null;
	source.upload = uploadImage(file)
		.then((url) => {
			if (source.file === file) source.url = url;
			return url;
		})
		.catch((err) => {
			if (source.file === file) source.error = err.message;
			throw err;
		})
		.finally(updateDropStatus);
	source.upload.catch(() => {});
	updateDropStatus();
}

function clearImage() {
	if (source.preview) URL.revokeObjectURL(source.preview);
	source = { file: null, preview: null, url: null, upload: null, error: null };
	renderNodes();
}

function updateDropStatus() {
	const el = $('wb-drop-status');
	if (!el) return;
	if (!source.file) {
		el.hidden = true;
		return;
	}
	el.hidden = false;
	if (source.error) {
		el.dataset.tone = 'err';
		el.textContent = `${source.error} It will retry when you generate.`;
	} else if (!source.url) {
		el.dataset.tone = '';
		el.textContent = `Uploading ${source.file.name}`;
	} else {
		el.dataset.tone = '';
		el.textContent = `${source.file.name} · ready`;
	}
}

async function ensureUploaded() {
	if (source.url) return source.url;
	try {
		return await source.upload;
	} catch {
		startUpload();
		return source.upload;
	}
}

// ── run ────────────────────────────────────────────────────────

function updateRunButton() {
	const btn = $('wb-run');
	const busy = Boolean(run);
	btn.dataset.busy = String(busy);
	$('wb-run-label').textContent = busy ? 'Cancel' : 'Generate 3D Model';
	btn.title = busy ? 'Stop this run' : 'Run the workflow (Ctrl+Enter)';
	btn.disabled = !busy && !validate(activeFlow()).ok;
	for (const id of ['wb-import-btn', 'wb-free', 'wb-flow-select']) $(id).disabled = busy;
	syncModelTools();
}

function setBusy(on, { title = 'Working', text = '', image = null } = {}) {
	$('wb-busy').hidden = !on;
	$('wb-busy-title').textContent = title;
	$('wb-busy-text').textContent = text;
	const img = $('wb-busy-img');
	img.hidden = !image;
	if (image && img.src !== image) img.src = image;
}

async function generate() {
	if (run) {
		run.controller.abort();
		return;
	}
	const flow = activeFlow();
	const check = validate(flow);
	if (!check.ok) {
		toast(check.errors[0].message, { tone: 'err', actions: [{ label: 'Fix in Workflows', run: () => setView('workflows') }] });
		return;
	}
	const text = promptText.trim();
	if (!source.file && !text) {
		toast('Add an image to the Image node, or describe the object in its prompt box.', { tone: 'warn' });
		$('wb-drop')?.querySelector('input')?.focus();
		return;
	}
	if (!source.file && text.length < 3) {
		toast('Describe the object in at least a few words.', { tone: 'warn' });
		return;
	}

	const steps = check.order;
	const total = steps.length;
	let finished = 0;
	const log = $('wb-run-log');
	const items = new Map(
		steps.map((n) => [n.id, h('li', { dataset: { state: 'pending' }, text: NODE_TYPES[n.type].label })]),
	);
	log.replaceChildren(...items.values());
	const progress = $('wb-run-progress');
	progress.style.width = '0%';

	const started = performance.now();
	const controller = new AbortController();
	let stepText = 'Starting';
	const tick = () => setBusy(true, { title: stepText, text: `${clock(performance.now() - started)} elapsed`, image: source.preview });
	run = { controller, timer: setInterval(tick, 1000) };
	updateRunButton();
	tick();

	const name = source.file ? source.file.name : text.slice(0, 48);
	try {
		let src;
		if (source.file) {
			stepText = 'Uploading the image';
			tick();
			src = { url: await ensureUploaded() };
		} else {
			src = { prompt: text };
		}
		const result = await runWorkflow(flow, {
			viewport: vp,
			source: src,
			signal: controller.signal,
			onStep: ({ nodeId, state, text: label }) => {
				const li = items.get(nodeId);
				if (li) {
					li.dataset.state = state;
					li.textContent = label;
				}
				if (state === 'done' || state === 'skipped') {
					finished += 1;
					progress.style.width = `${Math.round((finished / total) * 100)}%`;
				}
				if (state === 'active') {
					stepText = label;
					tick();
				}
			},
		});
		current = { url: result.glbUrl, name };
		editDepth = 0;
		if (settings.spin) setSpin(true);
		syncModelTools();
		const secs = Math.round((performance.now() - started) / 1000);
		const where = result.backend ? ` on ${laneLabel(result.backend)}` : '';
		toast(`Model ready in ${clock(secs * 1000)}${where}.`, {
			tone: 'ok',
			actions: [{ label: 'Download GLB', run: () => exportModel('glb') }],
		});
		if (result.glbUrl) await addHistory({ glbUrl: result.glbUrl, name, flow: flow.name, backend: result.backend, tier: result.tier });
	} catch (err) {
		const active = [...items.values()].find((li) => li.dataset.state === 'active');
		if (active) active.dataset.state = err.kind === 'cancelled' ? 'skipped' : 'error';
		runFailed(err, flow);
	} finally {
		clearInterval(run.timer);
		run = null;
		setBusy(false);
		updateRunButton();
	}
}

function laneLabel(id) {
	return catalog?.backends.find((b) => b.id === id)?.label || id;
}

function generateNode(flow) {
	return flow.nodes.find((n) => n.type === 'generate');
}

function runFailed(err, flow) {
	const again = { label: 'Try again', run: generate };
	switch (err.kind) {
		case 'cancelled':
			toast('Run cancelled.', { tone: 'warn' });
			return;
		case 'hold_required':
			toast(err.message, {
				tone: 'err',
				actions: [
					{
						label: 'Switch to Standard',
						run: () => {
							generateNode(flow).params.tier = 'standard';
							persistFlows();
							renderNodes();
							generate();
						},
					},
				],
			});
			return;
		case 'busy':
		case 'rate_limited':
			toast(`${err.message}${err.retryAfter ? ` Try again in about ${err.retryAfter}s.` : ''}`, { tone: 'warn', actions: [again] });
			return;
		case 'lane_failed': {
			const next = err.retryBackends?.[0];
			toast(err.message, {
				tone: 'err',
				actions: next
					? [
							{
								label: `Use ${laneLabel(next)}`,
								run: () => {
									generateNode(flow).params.backend = next;
									persistFlows();
									renderNodes();
									generate();
								},
							},
						]
					: [again],
			});
			return;
		}
		case 'not_usable': {
			const hasRembg = flow.nodes.some((n) => n.type === 'rembg' && n.enabled !== false);
			toast(`${err.message} A clear photo of one object on a plain background works best.`, {
				tone: 'err',
				actions: hasRembg
					? []
					: [
							{
								label: 'Add background removal',
								run: () => {
									insertNode(flow, 'rembg');
									persistFlows();
									renderNodes();
								},
							},
						],
			});
			return;
		}
		case 'needs_key':
			toast(err.message, { tone: 'err', actions: [{ label: 'Open Forge', run: () => (location.href = '/forge') }] });
			return;
		case 'invalid':
		case 'region':
		case 'unconfigured':
			toast(err.message, { tone: 'err' });
			return;
		default:
			toast(err.message || 'The run failed.', { tone: 'err', actions: [again] });
	}
}

// ── history ───────────────────────────────────────────────────

async function thumbnail() {
	const png = await vp.screenshot();
	if (!png) return null;
	const bmp = await createImageBitmap(png);
	const size = 96;
	const c = document.createElement('canvas');
	c.width = c.height = size;
	const s = Math.min(bmp.width, bmp.height);
	c.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size);
	bmp.close();
	return c.toDataURL('image/jpeg', 0.72);
}

async function addHistory(entry) {
	let thumb = null;
	try {
		thumb = await thumbnail();
	} catch {
		thumb = null;
	}
	const stats = vp.model ? countScene(vp.model) : null;
	recent = [{ id: crypto.randomUUID(), at: Date.now(), thumb, tris: stats?.tris ?? null, ...entry }, ...recent.filter((e) => e.glbUrl !== entry.glbUrl)].slice(
		0,
		HISTORY_MAX,
	);
	writeJSON(HISTORY_KEY, recent);
	renderHistory();
}

function renderHistory() {
	const list = $('wb-history-list');
	$('wb-history-clear').disabled = !recent.length;
	if (!recent.length) {
		list.replaceChildren(
			h('li', { class: 'wb-history-empty', text: 'Finished models land here with a thumbnail. Each one is a hosted GLB, so you can reopen it any time from this browser.' }),
		);
		return;
	}
	list.replaceChildren(
		...recent.map((e) =>
			h(
				'li',
				{},
				h(
					'button',
					{ type: 'button', title: `Open ${e.name}`, onclick: () => openRemote(e.glbUrl, e.name) },
					e.thumb ? h('img', { src: e.thumb, alt: '' }) : h('img', { alt: '' }),
					h(
						'span',
						{},
						h('strong', { text: e.name }),
						h('small', {
							text: [e.flow, e.tris ? `${Number(e.tris).toLocaleString()} tri` : null, timeAgo(e.at)].filter(Boolean).join(' · '),
						}),
					),
				),
			),
		),
	);
}

function toggleHistory(force) {
	const panel = $('wb-history');
	const open = force ?? panel.dataset.open !== 'true';
	panel.dataset.open = String(open);
	$('wb-history-btn').setAttribute('aria-pressed', String(open));
	if (open) {
		renderHistory();
		panel.querySelector('button')?.focus({ preventScroll: true });
	}
}

async function openRemote(url, name) {
	if (run) return;
	toggleHistory(false);
	setBusy(true, { title: 'Loading model', text: name });
	try {
		await vp.loadGLB(url);
		current = { url, name };
		editDepth = 0;
		syncModelTools();
	} catch (err) {
		toast(`That model could not be loaded: ${err.message}`, { tone: 'err' });
	} finally {
		setBusy(false);
	}
}

// ── viewport tools ─────────────────────────────────────────────

function syncModelTools() {
	const busy = Boolean(run);
	for (const id of ['wb-export-btn', 'wb-smooth-btn', 'wb-decimate-btn']) $(id).disabled = !hasModel || busy;
	const link = $('wb-copy-link');
	const linkable = Boolean(current.url) && editDepth === 0;
	link.disabled = !linkable;
	link.title = linkable ? current.url : 'Available for generated or reopened models with no unsaved edits';
	$('wb-empty').hidden = hasModel || busy;
}

function closeMenus(except) {
	for (const wrap of document.querySelectorAll('.wb-menu-wrap')) {
		const btn = wrap.querySelector(':scope > .wb-tool');
		const panel = wrap.querySelector('.wb-menu, .wb-popover');
		if (panel === except) continue;
		panel.dataset.open = 'false';
		btn.setAttribute('aria-expanded', 'false');
	}
}

function wireMenu(btnId, panelId, onOpen) {
	const btn = $(btnId);
	const panel = $(panelId);
	btn.addEventListener('click', (e) => {
		e.stopPropagation();
		const open = panel.dataset.open !== 'true';
		closeMenus(panel);
		panel.dataset.open = String(open);
		btn.setAttribute('aria-expanded', String(open));
		if (open) {
			onOpen?.();
			panel.querySelector('button:not(:disabled), input')?.focus();
		}
	});
	panel.addEventListener('click', (e) => e.stopPropagation());
	panel.addEventListener('keydown', (e) => {
		if (e.key === 'Escape') {
			closeMenus();
			btn.focus();
			return;
		}
		if (panel.classList.contains('wb-menu') && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
			e.preventDefault();
			const items = [...panel.querySelectorAll('button:not(:disabled)')];
			const i = items.indexOf(document.activeElement);
			const next = items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
			next?.focus();
		}
	});
}

async function exportModel(format) {
	closeMenus();
	if (!vp.model) return;
	if (format === 'link') {
		try {
			await navigator.clipboard.writeText(current.url);
			toast('GLB link copied.', { tone: 'ok' });
		} catch {
			window.prompt('Copy the GLB link', current.url);
		}
		return;
	}
	try {
		const blob = await vp.exportAs(format);
		download(blob, `${safeName(current.name)}.${format}`);
		toast(`Saved ${safeName(current.name)}.${format} (${(blob.size / 1048576).toFixed(1)} MB).`, { tone: 'ok' });
	} catch (err) {
		toast(`Export failed: ${err.message}`, { tone: 'err' });
	}
}

async function applyMutation(label, op) {
	closeMenus();
	try {
		const result = await vp.mutate(op);
		editDepth += 1;
		syncModelTools();
		return result;
	} catch (err) {
		toast(`${label} failed: ${err.message}`, { tone: 'err' });
		return null;
	}
}

function updateDecimateEstimate() {
	const ratio = Number($('wb-decimate-range').value);
	$('wb-decimate-out').textContent = `${Math.round(ratio * 100)}%`;
	const stats = vp?.model ? countScene(vp.model) : null;
	$('wb-decimate-est').textContent = stats
		? `About ${Math.round(stats.tris * ratio).toLocaleString()} of ${stats.tris.toLocaleString()} triangles. UV seams and borders are kept.`
		: 'Simplifies every mesh with edge collapse.';
}

function setMode(mode) {
	vp.setMode(mode);
	for (const b of document.querySelectorAll('.wb-strip-btn[data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
}

function setGrid(on) {
	vp.setGrid(on);
	$('wb-grid').setAttribute('aria-pressed', String(on));
}

function setEnv(on) {
	vp.setEnvironment(on);
	$('wb-env').setAttribute('aria-pressed', String(on));
}

function setSpin(on) {
	vp.setAutoRotate(on);
	$('wb-spin').setAttribute('aria-pressed', String(on));
}

function undo() {
	if (run || !vp.undo()) return;
	editDepth -= 1;
	syncModelTools();
}

function redo() {
	if (run || !vp.redo()) return;
	editDepth += 1;
	syncModelTools();
}

async function importModelFile(file) {
	if (run) return;
	setBusy(true, { title: 'Opening model', text: file.name });
	try {
		await vp.loadFile(file);
		current = { url: null, name: file.name };
		editDepth = 0;
		syncModelTools();
	} catch (err) {
		toast(`Could not open ${file.name}: ${err.message}`, { tone: 'err' });
	} finally {
		setBusy(false);
	}
}

const MODEL_EXT = /\.(glb|gltf|obj|stl|ply|fbx)$/i;

function handleDroppedFiles(files) {
	const list = [...files];
	const model = list.find((f) => MODEL_EXT.test(f.name));
	const image = list.find((f) => f.type.startsWith('image/'));
	if (model) importModelFile(model);
	else if (image) {
		setImage(image);
		toast('Image added to the Image node. Press Generate when ready.', { tone: 'ok' });
	} else toast('Drop a GLB, glTF, OBJ, STL, PLY or FBX model, or a PNG, JPG or WebP image.', { tone: 'warn' });
}

function wireViewport() {
	$('wb-undo').addEventListener('click', undo);
	$('wb-redo').addEventListener('click', redo);

	wireMenu('wb-import-btn', 'wb-import-menu');
	for (const b of $('wb-import-menu').querySelectorAll('[data-import]')) {
		b.addEventListener('click', () => {
			closeMenus();
			$(b.dataset.import === 'model' ? 'wb-model-input' : 'wb-image-input').click();
		});
	}
	$('wb-model-input').addEventListener('change', (e) => {
		const f = e.target.files[0];
		e.target.value = '';
		if (f) importModelFile(f);
	});
	$('wb-image-input').addEventListener('change', (e) => {
		const f = e.target.files[0];
		e.target.value = '';
		if (f) setImage(f);
	});

	wireMenu('wb-export-btn', 'wb-export-menu');
	for (const b of $('wb-export-menu').querySelectorAll('[data-export]')) b.addEventListener('click', () => exportModel(b.dataset.export));

	wireMenu('wb-smooth-btn', 'wb-smooth-pop');
	$('wb-smooth-range').addEventListener('input', (e) => ($('wb-smooth-out').textContent = e.target.value));
	$('wb-smooth-apply').addEventListener('click', async () => {
		const passes = Number($('wb-smooth-range').value);
		const ok = await applyMutation('Smoothing', (m) => smoothScene(m, passes));
		if (ok !== null) toast(`Smoothed with ${passes} pass${passes === 1 ? '' : 'es'}. Ctrl+Z to undo.`, { tone: 'ok' });
	});

	wireMenu('wb-decimate-btn', 'wb-decimate-pop', updateDecimateEstimate);
	$('wb-decimate-range').addEventListener('input', updateDecimateEstimate);
	$('wb-decimate-apply').addEventListener('click', async () => {
		const ratio = Number($('wb-decimate-range').value);
		const res = await applyMutation('Decimation', (m) => decimateScene(m, ratio));
		if (res) toast(`Decimated ${res.before.tris.toLocaleString()} to ${res.after.tris.toLocaleString()} triangles. Ctrl+Z to undo.`, { tone: 'ok' });
	});

	$('wb-free').addEventListener('click', () => {
		const before = performance.memory?.usedJSHeapSize;
		vp.free();
		current = { url: null, name: 'model' };
		editDepth = 0;
		syncModelTools();
		const note = before ? ` Heap was ${Math.round(before / 1048576)} MB.` : '';
		toast(`Model unloaded and its GPU buffers released.${note}`, { tone: 'ok' });
	});

	for (const b of document.querySelectorAll('.wb-strip-btn[data-mode]')) b.addEventListener('click', () => setMode(b.dataset.mode));
	$('wb-grid').addEventListener('click', () => setGrid(!vp.gridVisible));
	$('wb-env').addEventListener('click', () => setEnv(!vp.environmentOn));
	$('wb-spin').addEventListener('click', () => setSpin(!vp.autoRotate));
	$('wb-history-btn').addEventListener('click', () => toggleHistory());
	$('wb-history-clear').addEventListener('click', clearHistory);
	$('wb-frame').addEventListener('click', () => vp.frame());
	$('wb-shot').addEventListener('click', screenshot);

	document.addEventListener('click', () => closeMenus());

	// Drag and drop anywhere on the viewport.
	const stage = $('wb-stage');
	const veil = $('wb-dropveil');
	let depth = 0;
	stage.addEventListener('dragenter', (e) => {
		if (!e.dataTransfer?.types?.includes('Files')) return;
		depth += 1;
		veil.dataset.on = 'true';
	});
	stage.addEventListener('dragleave', () => {
		depth = Math.max(0, depth - 1);
		if (!depth) veil.dataset.on = 'false';
	});
	stage.addEventListener('dragover', (e) => e.preventDefault());
	stage.addEventListener('drop', (e) => {
		e.preventDefault();
		depth = 0;
		veil.dataset.on = 'false';
		if (e.dataTransfer?.files?.length) handleDroppedFiles(e.dataTransfer.files);
	});
}

async function screenshot() {
	if (!vp.model) {
		toast('Load or generate a model first.', { tone: 'warn' });
		return;
	}
	const blob = await vp.screenshot();
	if (blob) download(blob, `${safeName(current.name)}.png`);
}

function clearHistory() {
	const prev = recent;
	recent = [];
	writeJSON(HISTORY_KEY, recent);
	renderHistory();
	toast('History cleared.', {
		actions: [
			{
				label: 'Undo',
				run: () => {
					recent = prev;
					writeJSON(HISTORY_KEY, recent);
					renderHistory();
				},
			},
		],
	});
}

// ── memory meter ───────────────────────────────────────────────

function startMeter() {
	const mem = performance.memory;
	if (!mem || !mem.jsHeapSizeLimit) return;
	const meter = $('wb-meter');
	meter.hidden = false;
	const update = () => {
		const used = performance.memory.usedJSHeapSize;
		const limit = performance.memory.jsHeapSizeLimit;
		$('wb-meter-fill').style.width = `${Math.min(100, (used / limit) * 100).toFixed(1)}%`;
		$('wb-meter-text').textContent = used > 1073741824 ? `${(used / 1073741824).toFixed(2)} GB` : `${Math.round(used / 1048576)} MB`;
		meter.title = `JavaScript heap: ${Math.round(used / 1048576)} MB of ${Math.round(limit / 1048576)} MB available to this tab`;
	};
	update();
	setInterval(update, 2000);
}

// ── workflows view ─────────────────────────────────────────────

function setFlowStatus(result) {
	const el = $('wb-flow-status');
	if (result.hint) {
		el.dataset.tone = '';
		el.textContent = result.hint;
		return;
	}
	el.dataset.tone = result.ok ? 'ok' : 'err';
	el.textContent = result.ok ? `Ready to run · ${result.order.length} steps` : result.errors[0]?.message || 'Invalid workflow';
	$('wb-flow-use').disabled = !result.ok;
}

function renderFlowList() {
	$('wb-flow-list').replaceChildren(
		...flows.map((f) => {
			const { ok, order } = validate(f);
			const item = h(
				'button',
				{
					type: 'button',
					class: 'wb-flow-item',
					role: 'option',
					'aria-selected': String(f.id === editingId),
					'aria-current': String(f.id === editingId),
					onclick: () => {
						editingId = f.id;
						graph.resetView();
						renderWorkflowsView();
					},
				},
				h('strong', { text: f.name }),
				h('small', { text: ok ? `${order.length} steps${f.id === activeId ? ' · in use' : ''}` : 'Needs fixing' }),
			);
			return item;
		}),
	);
}

function renderWorkflowsView() {
	const flow = editingFlow();
	editingId = flow.id;
	$('wb-flow-name').value = flow.name;
	$('wb-flow-del').disabled = flows.length < 2;
	renderFlowList();
	graph.render(flow);
}

function onFlowsChanged() {
	persistFlows();
	renderFlowList();
	renderFlowSelect();
	if (editingId === activeId) renderNodes();
}

function wireWorkflows() {
	graph = mountGraphEditor($('wb-graph'), { onChange: onFlowsChanged, onStatus: setFlowStatus });

	$('wb-flow-name').addEventListener('input', (e) => {
		editingFlow().name = e.target.value.trim() || 'Untitled workflow';
		onFlowsChanged();
	});
	$('wb-flow-new').addEventListener('click', () => {
		const flow = duplicateWorkflow(TEMPLATES[0], 'Untitled workflow');
		flows.push(flow);
		editingId = flow.id;
		persistFlows();
		renderWorkflowsView();
		renderFlowSelect();
		$('wb-flow-name').select();
	});
	$('wb-flow-dup').addEventListener('click', () => {
		const src = editingFlow();
		const flow = duplicateWorkflow(src, `${src.name} copy`);
		flows.splice(flows.indexOf(src) + 1, 0, flow);
		editingId = flow.id;
		persistFlows();
		renderWorkflowsView();
		renderFlowSelect();
	});
	$('wb-flow-tidy').addEventListener('click', () => {
		tidy(editingFlow());
		graph.resetView();
		graph.render(editingFlow());
		persistFlows();
	});
	$('wb-flow-del').addEventListener('click', () => {
		if (flows.length < 2) return;
		const flow = editingFlow();
		const index = flows.indexOf(flow);
		flows.splice(index, 1);
		const wasActive = activeId === flow.id;
		if (wasActive) {
			activeId = flows[0].id;
			saveActiveId(activeId);
		}
		editingId = flows[Math.min(index, flows.length - 1)].id;
		persistFlows();
		renderWorkflowsView();
		renderFlowSelect();
		renderNodes();
		toast(`Deleted "${flow.name}".`, {
			actions: [
				{
					label: 'Undo',
					run: () => {
						flows.splice(index, 0, flow);
						if (wasActive) {
							activeId = flow.id;
							saveActiveId(activeId);
						}
						editingId = flow.id;
						persistFlows();
						renderFlowSelect();
						renderNodes();
						if (app.dataset.view === 'workflows') renderWorkflowsView();
					},
				},
			],
		});
	});
	$('wb-flow-use').addEventListener('click', () => {
		activeId = editingId;
		saveActiveId(activeId);
		renderFlowSelect();
		renderNodes();
		setView('generate');
	});

	const palette = $('wb-palette');
	for (const type of PALETTE) {
		const t = NODE_TYPES[type];
		palette.append(
			h('button', {
				type: 'button',
				class: 'wb-btn',
				title: t.blurb,
				html: ICONS.plus,
				onclick: () => {
					insertNode(editingFlow(), type);
					graph.render(editingFlow());
					onFlowsChanged();
				},
			}),
		);
		palette.lastElementChild.append(t.label);
	}
}

// ── extensions view ────────────────────────────────────────────

const HEALTH_TAG = {
	ok: ['Online', 'ok'],
	byok: ['Your API key', 'warn'],
	unconfigured: ['Not configured', 'err'],
	degraded: ['Degraded', 'warn'],
	down: ['Down', 'err'],
};

function laneCard(b) {
	const hs = health?.backends?.[b.id];
	const [hLabel, hTone] = HEALTH_TAG[hs?.status] || (hs ? [hs.status, 'warn'] : ['Status unknown', '']);
	const eta = b.estimates?.image?.find((e) => e.tier === 'standard')?.eta_seconds;
	const tags = [h('span', { class: 'wb-tag', dataset: { tone: hTone }, title: hs?.message || '', text: hLabel })];
	if (b.free) tags.push(h('span', { class: 'wb-tag', dataset: { tone: 'accent' }, text: 'Free' }));
	for (const p of b.paths || []) tags.push(h('span', { class: 'wb-tag', text: p === 'image' ? 'Image to 3D' : p === 'sketch' ? 'Sketch' : 'Geometry' }));
	if (b.poly_control) tags.push(h('span', { class: 'wb-tag', text: 'Face budget' }));
	if (hs?.latency_ms) tags.push(h('span', { class: 'wb-tag', text: `${hs.latency_ms} ms` }));

	const eligible = b.paths?.includes('image') && b.user_images && b.configured && !b.byok;
	let foot;
	if (eligible) {
		foot = h(
			'label',
			{},
			'Show in Engine picker',
			h(
				'span',
				{ class: 'wb-switch' },
				h('input', {
					type: 'checkbox',
					checked: !lanesOff.has(b.id),
					'aria-label': `Show ${b.label} in the Engine picker`,
					onchange: (e) => {
						if (e.target.checked) lanesOff.delete(b.id);
						else lanesOff.add(b.id);
						writeJSON(LANES_OFF_KEY, [...lanesOff]);
						renderNodes();
					},
				}),
				h('span'),
			),
		);
	} else if (b.byok) {
		foot = h('a', { href: '/forge', text: 'Add your key on Forge' });
	} else if (!b.configured) {
		foot = h('span', { text: 'Not available on this deployment' });
	} else if (!b.user_images) {
		foot = h('span', { text: 'Used by Auto for text prompts' });
	} else {
		foot = h('span', { text: 'Not an image lane' });
	}

	return h(
		'article',
		{ class: 'wb-ext' },
		h('header', {}, h('div', {}, h('h3', { text: b.label }), h('small', { text: b.vendor || '' }))),
		h('p', { text: b.blurb || '' }),
		h('div', { class: 'wb-tags' }, tags),
		h('footer', {}, eta ? h('span', { text: `About ${eta}s at Standard` }) : null, foot),
	);
}

const TOOL_KIND = {
	rembg: 'GPU worker',
	restyle: 'AI materials',
	remesh: 'GPU worker',
	rig: 'GPU worker',
	decimate: 'In browser',
	smooth: 'In browser',
};

function toolCard(type) {
	const t = NODE_TYPES[type];
	return h(
		'article',
		{ class: 'wb-ext' },
		h('header', {}, h('div', {}, h('h3', { text: t.label }), h('small', { text: TOOL_KIND[type] }))),
		h('p', { text: t.blurb }),
		h(
			'div',
			{ class: 'wb-tags' },
			h('span', { class: 'wb-tag', dataset: { tone: 'accent' }, text: `${t.in} → ${t.out}` }),
			t.params.length ? h('span', { class: 'wb-tag', text: `${t.params.length} setting${t.params.length > 1 ? 's' : ''}` }) : null,
		),
		h(
			'footer',
			{},
			h('button', {
				type: 'button',
				class: 'wb-btn',
				text: 'Add to current workflow',
				onclick: () => {
					const flow = activeFlow();
					insertNode(flow, type);
					persistFlows();
					renderNodes();
					toast(`${t.label} added to "${flow.name}".`, {
						tone: 'ok',
						actions: [
							{
								label: 'View',
								run: () => {
									editingId = flow.id;
									setView('workflows');
								},
							},
						],
					});
				},
			}),
		),
	);
}

async function loadExtensions() {
	const grid = $('wb-ext-lanes');
	grid.setAttribute('aria-busy', 'true');
	if (!catalog) grid.replaceChildren(...Array.from({ length: 6 }, () => h('div', { class: 'wb-skel' })));
	$('wb-ext-tools').replaceChildren(...PALETTE.map(toolCard));
	const [cat, hl] = await Promise.allSettled([fetchCatalog(), fetchHealth()]);
	if (cat.status === 'fulfilled') catalog = cat.value;
	if (hl.status === 'fulfilled') health = hl.value;
	grid.setAttribute('aria-busy', 'false');
	if (!catalog) {
		grid.replaceChildren(
			h(
				'div',
				{ class: 'wb-ext-error', role: 'alert' },
				h('strong', { text: 'The engine list did not load' }),
				h('p', { text: cat.reason?.message || 'The platform did not answer.' }),
				h('button', { type: 'button', class: 'wb-btn', text: 'Try again', onclick: loadExtensions }),
			),
		);
		return;
	}
	const rank = (b) => (b.configured && !b.byok ? 0 : b.byok ? 1 : 2);
	grid.replaceChildren(...[...catalog.backends].sort((a, b) => rank(a) - rank(b)).map(laneCard));
	renderNodes();
}

// ── settings view ──────────────────────────────────────────────

function apiSnippet() {
	const origin = location.origin;
	const gen = generateNode(activeFlow())?.params || {};
	const body = { path: 'image', tier: gen.tier || 'standard', image_urls: ['$PUBLIC_URL'] };
	if (gen.backend && gen.backend !== 'auto') body.backend = gen.backend;
	if (gen.texture_size) body.texture_size = Number(gen.texture_size);
	if (gen.target_polycount) body.target_polycount = Number(gen.target_polycount);
	return [
		'# 1. Ask for an upload slot, then PUT the image to upload_url',
		`curl -s ${origin}/api/forge-upload -H 'content-type: application/json' \\`,
		`  -d '{"content_type":"image/png","size_bytes":'$(wc -c < photo.png)'}'`,
		`curl -X PUT "$UPLOAD_URL" -H 'content-type: image/png' --data-binary @photo.png`,
		'',
		`# 2. Submit public_url with this workflow's Generate settings`,
		`curl -s ${origin}/api/forge -H 'content-type: application/json' \\`,
		`  -d '${JSON.stringify(body).replace('"$PUBLIC_URL"', `"'"$PUBLIC_URL"'"`)}'`,
		'',
		'# 3. Poll every few seconds until status is "done", then fetch glb_url',
		`curl -s "${origin}/api/forge?job=$JOB_ID"`,
	].join('\n');
}

function renderSettings() {
	for (const sel of document.querySelectorAll('[data-setting]')) sel.value = settings[sel.dataset.setting] ? '1' : '0';
	$('wb-theme-select').value = window.threeTheme?.get() || 'dark';
	$('wb-theme-select').disabled = window.threeTheme ? !window.threeTheme.supportsLight() : true;
	$('wb-client-id').value = CLIENT_ID;
	$('wb-api-snippet').textContent = apiSnippet();
}

function wireSettings() {
	for (const sel of document.querySelectorAll('[data-setting]')) {
		sel.addEventListener('change', () => {
			const key = sel.dataset.setting;
			settings[key] = sel.value === '1';
			writeJSON(SETTINGS_KEY, settings);
			if (key === 'grid') setGrid(settings.grid);
			if (key === 'env') setEnv(settings.env);
		});
	}
	$('wb-theme-select').addEventListener('change', (e) => window.threeTheme?.set(e.target.value));
	$('wb-clear-history').addEventListener('click', clearHistory);
	$('wb-reset-flows').addEventListener('click', () => {
		const prev = { flows, activeId };
		flows = resetWorkflows();
		activeId = flows[0].id;
		editingId = activeId;
		renderFlowSelect();
		renderNodes();
		toast('Default workflows restored.', {
			actions: [
				{
					label: 'Undo',
					run: () => {
						flows = prev.flows;
						activeId = prev.activeId;
						editingId = activeId;
						persistFlows();
						saveActiveId(activeId);
						renderFlowSelect();
						renderNodes();
					},
				},
			],
		});
	});
	$('wb-copy-snippet').addEventListener('click', async () => {
		try {
			await navigator.clipboard.writeText($('wb-api-snippet').textContent);
			toast('Copied.', { tone: 'ok' });
		} catch {
			toast('Clipboard access was blocked. Select the text and copy it instead.', { tone: 'warn' });
		}
	});
	$('wb-client-id').addEventListener('focus', (e) => e.target.select());
}

// ── keyboard ───────────────────────────────────────────────────

function wireKeyboard() {
	document.addEventListener('keydown', (e) => {
		const mod = e.ctrlKey || e.metaKey;
		const typing = e.target.closest?.('input, textarea, select, [contenteditable="true"]');
		if (mod && e.key === 'Enter' && app.dataset.view === 'generate') {
			e.preventDefault();
			generate();
			return;
		}
		if (e.key === 'Escape') {
			closeMenus();
			toggleHistory(false);
			return;
		}
		if (typing || app.dataset.view !== 'generate' || !vp) return;
		const key = e.key.toLowerCase();
		if (mod && key === 'z') {
			e.preventDefault();
			if (e.shiftKey) redo();
			else undo();
			return;
		}
		if (mod && key === 'y') {
			e.preventDefault();
			redo();
			return;
		}
		if (mod || e.altKey) return;
		const actions = {
			f: () => vp.frame(),
			g: () => setGrid(!vp.gridVisible),
			e: () => setEnv(!vp.environmentOn),
			t: () => setSpin(!vp.autoRotate),
			h: () => toggleHistory(),
			p: screenshot,
			1: () => setMode('shaded'),
			2: () => setMode('wireframe'),
			3: () => setMode('normals'),
			4: () => setMode('clay'),
		};
		if (actions[key]) {
			e.preventDefault();
			actions[key]();
		}
	});

	document.addEventListener('paste', (e) => {
		if (app.dataset.view !== 'generate' || e.target.closest?.('input, textarea')) return;
		const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
		if (!file) return;
		e.preventDefault();
		setImage(file);
		toast('Pasted image added to the Image node.', { tone: 'ok' });
	});
}

// ── boot ───────────────────────────────────────────────────────

function wireShell() {
	for (const b of document.querySelectorAll('.wb-rail-btn')) b.addEventListener('click', () => setView(b.dataset.nav));
	window.addEventListener('hashchange', () => setView(location.hash.slice(1), { push: false }));
	$('wb-flow-select').addEventListener('change', (e) => {
		activeId = e.target.value;
		saveActiveId(activeId);
		renderNodes();
	});
	$('wb-flow-edit').addEventListener('click', () => {
		editingId = activeId;
		setView('workflows');
	});
	$('wb-run').addEventListener('click', generate);
	$('wb-ext-refresh').addEventListener('click', loadExtensions);
}

async function boot() {
	wireShell();
	renderFlowSelect();
	renderNodes();
	renderHistory();
	wireWorkflows();
	wireSettings();
	wireKeyboard();
	startMeter();
	setView(location.hash.slice(1) || 'generate', { push: false });

	try {
		vp = await mountViewport($('wb-canvas'), {
			onStats: (stats) => {
				hasModel = Boolean(stats);
				$('wb-stats').textContent = stats ? `${stats.tris.toLocaleString()} tri • ${stats.verts.toLocaleString()} verts` : '';
				syncModelTools();
			},
			onHistory: ({ canUndo, canRedo }) => {
				$('wb-undo').disabled = !canUndo;
				$('wb-redo').disabled = !canRedo;
			},
		});
	} catch (err) {
		$('wb-empty').querySelector('h2').textContent = 'The 3D viewport could not start';
		$('wb-empty').querySelector('p').textContent = `${err.message}. The Workbench needs WebGL 2; try an up-to-date Chrome, Edge, Firefox or Safari.`;
		$('wb-run').disabled = true;
		return;
	}
	setGrid(settings.grid);
	setEnv(settings.env);
	wireViewport();
	syncModelTools();

	// Engines feed the Engine picker; load them in the background.
	if (!catalog) {
		fetchCatalog()
			.then((c) => {
				catalog = c;
				renderNodes();
			})
			.catch(() => {
				// The picker keeps Auto, which routes server-side without the catalog.
			});
	}
}

boot();

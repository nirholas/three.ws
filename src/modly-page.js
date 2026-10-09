// /modly: the three.ws hub for Modly, the open-source image-to-3D app that runs
// on the visitor's own GPU.
//
// All talk with the local Modly server goes through src/modly-local.js, the
// same client the Forge "Your GPU (Modly)" lane uses. This page adds the UI on
// top: detection with every failure explained, the live model list, quick
// generation with real progress, Modly's mesh tools with undo, the three.ws
// concept-image lane for text prompts, and saving the result to the account.
// Based on Modly by Lightning Pixel (MIT): https://github.com/lightningpixel/modly

import {
	MODLY_DEFAULT_ORIGINS,
	MODLY_INSTALL_URL,
	ModlyError,
	defaultModlyParams,
	downloadModlyGlb,
	generateWithModly,
	getModlyOriginOverride,
	listModlyMeshOps,
	listModlyModels,
	modlyMeshOp,
	normalizeModlyOrigin,
	probeModly,
	setModlyOriginOverride,
	validateModlyWorkspacePath,
} from './modly-local.js';
import { ensureModelViewer } from './shared/model-viewer-loader.js';
import { getMe, saveRemoteGlbToAccount } from './account.js';

const CONNECTED_KEY = 'tws:modly-connected';
const RESUME_KEY = 'tws:modly-resume';
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

// The official local generators, as listed in Modly's README. Shown when Modly
// has none installed; each one is added from Modly's Models page.
const OFFICIAL_EXTENSIONS = [
	{ name: 'Hunyuan3D 2 Mini', repo: 'https://github.com/lightningpixel/modly-hunyuan3d-mini-extension' },
	{ name: 'Hunyuan3D 2 Mini Turbo', repo: 'https://github.com/lightningpixel/modly-hunyuan3d-mini-turbo-extension' },
	{ name: 'Hunyuan3D 2 Mini Fast', repo: 'https://github.com/lightningpixel/modly-hunyuan3d-mini-fast-extension' },
	{ name: 'TripoSG', repo: 'https://github.com/lightningpixel/modly-triposg-extension' },
	{ name: 'Trellis2 GGUF', repo: 'https://github.com/lightningpixel/modly-trellis2-gguf-extension' },
];

const $ = (id) => document.getElementById(id);

const el = {
	conn: $('mdConn'),
	connStatus: $('mdConnStatus'),
	baseForm: $('mdBaseForm'),
	base: $('mdBase'),
	connect: $('mdConnect'),
	baseError: $('mdBaseError'),
	probingText: $('mdProbingText'),
	installLink: $('mdInstallLink'),
	connOrigin: $('mdConnOrigin'),
	connSummary: $('mdConnSummary'),
	studio: $('mdStudio'),
	refreshModels: $('mdRefreshModels'),
	modelsLoading: $('mdModelsLoading'),
	modelsEmpty: $('mdModelsEmpty'),
	extList: $('mdExtList'),
	modelsError: $('mdModelsError'),
	modelList: $('mdModelList'),
	params: $('mdParams'),
	paramsForm: $('mdParamsForm'),
	tabImage: $('mdTabImage'),
	tabPrompt: $('mdTabPrompt'),
	paneImage: $('mdPaneImage'),
	panePrompt: $('mdPanePrompt'),
	drop: $('mdDrop'),
	file: $('mdFile'),
	dropImg: $('mdDropImg'),
	dropMeta: $('mdDropMeta'),
	dropName: $('mdDropName'),
	clearImage: $('mdClearImage'),
	prompt: $('mdPrompt'),
	concept: $('mdConcept'),
	conceptError: $('mdConceptError'),
	generate: $('mdGenerate'),
	generateHint: $('mdGenerateHint'),
	openForm: $('mdOpenForm'),
	openPath: $('mdOpenPath'),
	openError: $('mdOpenError'),
	stage: $('mdStage'),
	step: $('mdStep'),
	progress: $('mdProgress'),
	progressBar: $('mdProgressBar'),
	pct: $('mdPct'),
	elapsed: $('mdElapsed'),
	cancel: $('mdCancel'),
	loadingText: $('mdLoadingText'),
	stageErrorTitle: $('mdStageErrorTitle'),
	stageErrorText: $('mdStageErrorText'),
	stageErrorDetail: $('mdStageErrorDetail'),
	stageErrorPre: $('mdStageErrorPre'),
	stageRetry: $('mdStageRetry'),
	stageDismiss: $('mdStageDismiss'),
	viewerHost: $('mdViewerHost'),
	meta: $('mdMeta'),
	metaPath: $('mdMetaPath'),
	metaStats: $('mdMetaStats'),
	result: $('mdResult'),
	undo: $('mdUndo'),
	ops: $('mdOps'),
	opsError: $('mdOpsError'),
	download: $('mdDownload'),
	saveForm: $('mdSaveForm'),
	saveName: $('mdSaveName'),
	saveVis: $('mdSaveVis'),
	save: $('mdSave'),
	saveProgress: $('mdSaveProgress'),
	saveProgressBar: $('mdSaveProgressBar'),
	saveSignedOut: $('mdSaveSignedOut'),
	signIn: $('mdSignIn'),
	saveDone: $('mdSaveDone'),
	saveLink: $('mdSaveLink'),
	saveError: $('mdSaveError'),
	toast: $('mdToast'),
};

const state = {
	origin: null,
	probeController: null,
	models: [],
	modelId: null,
	paramsSchema: [],
	paramValues: {},
	ops: [],
	opValues: {},
	image: null,
	imageName: '',
	imageUrl: null,
	job: null,
	/** { workspacePath, blob, modelId, faceCount } of the model on the stage. */
	current: null,
	history: [],
	viewer: null,
	busy: false,
	retryAction: null,
	saveController: null,
};

// ── small helpers ──────────────────────────────────────────────────────────

function readStore(store, key) {
	try {
		return globalThis[store]?.getItem(key) ?? null;
	} catch {
		return null;
	}
}

function writeStore(store, key, value) {
	try {
		if (value === null) globalThis[store]?.removeItem(key);
		else globalThis[store]?.setItem(key, value);
	} catch {
		// Storage blocked (private mode): the feature still works for this visit.
	}
}

function show(node, visible) {
	node.hidden = !visible;
}

function setBusy(button, busy) {
	button.classList.toggle('is-busy', busy);
	button.disabled = busy;
	button.setAttribute('aria-busy', busy ? 'true' : 'false');
}

let toastTimer = null;
function toast(message) {
	el.toast.textContent = message;
	el.toast.hidden = false;
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => {
		el.toast.hidden = true;
	}, 3200);
}

function formatBytes(n) {
	if (!Number.isFinite(n)) return '';
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
	return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatElapsed(ms) {
	const s = Math.max(0, Math.floor(ms / 1000));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function fileBaseName(path) {
	const name = String(path).split('/').pop() || 'model';
	return name.replace(/\.[a-z0-9]+$/i, '');
}

function humanName(path) {
	const base = fileBaseName(path).replace(/[_-]+/g, ' ').trim();
	return (base.charAt(0).toUpperCase() + base.slice(1)).slice(0, 120) || 'Local model';
}

function errorText(err) {
	return err?.message || 'Something went wrong.';
}

/** A title and a next step for every ModlyError code a page action can hit. */
function modlyErrorCopy(err) {
	const message = errorText(err);
	switch (err?.code) {
		case 'NOT_RUNNING':
		case 'BLOCKED':
			return { title: 'Lost the connection to Modly', text: `${message} Make sure the Modly app is still open, then try again.` };
		case 'TIMEOUT':
			return { title: 'Modly took too long', text: `${message} Large models on small GPUs can be slow; a lighter model or a smaller image helps.` };
		case 'UNAVAILABLE':
			return { title: 'Modly could not run that step', text: `${message} The mesh tools need Modly's optional geometry packages; updating Modly restores them.` };
		case 'GENERATION_FAILED':
			return { title: 'The model failed inside Modly', text: `${message}. A clear photo of a single object on a plain background often helps; out-of-memory errors mean the model needs more GPU memory than is free.` };
		case 'RUN_LOST':
			return { title: 'Modly lost track of the generation', text: message };
		case 'NOT_GLB':
			return { title: 'This output is not a mesh', text: `${message} Models that make Gaussian splats write PLY files; open those in Modly itself.` };
		case 'NOT_FOUND':
			return { title: 'Modly could not find that', text: message };
		case 'UNKNOWN_MODEL':
			return { title: 'That model is no longer installed', text: `${message} Press Refresh to reload the model list.` };
		case 'BAD_REQUEST':
		case 'BAD_INPUT':
			return { title: 'Modly rejected the request', text: message };
		case 'BAD_PATH':
			return { title: 'Modly reported an unusable file location', text: message };
		default:
			return { title: 'Something went wrong', text: message };
	}
}

// ── connection ─────────────────────────────────────────────────────────────

const CONN_LABEL = {
	idle: 'Not connected',
	probing: 'Looking for Modly',
	'not-running': 'Modly not found',
	blocked: 'Connection blocked by the browser',
	connected: 'Connected',
};

function setConnState(next, { reason = '' } = {}) {
	el.conn.dataset.state = next;
	el.connStatus.textContent = CONN_LABEL[next] || next;
	el.conn.querySelector('.md-panel[data-for="blocked"]').dataset.reason = reason;
	setBusy(el.connect, next === 'probing');
	el.connect.querySelector('.md-btn__label').textContent = next === 'connected' ? 'Reconnect' : 'Connect';
	show(el.studio, next === 'connected');
}

/** Read the address field: '' means "Modly's default port". Throws BAD_ORIGIN. */
function readOriginField() {
	const typed = el.base.value.trim();
	if (!typed) return '';
	const origin = normalizeModlyOrigin(typed);
	return MODLY_DEFAULT_ORIGINS.includes(origin) ? '' : origin;
}

async function connect() {
	show(el.baseError, false);
	el.base.removeAttribute('aria-invalid');
	let override;
	try {
		override = readOriginField();
	} catch (err) {
		el.baseError.textContent = errorText(err);
		show(el.baseError, true);
		el.base.setAttribute('aria-invalid', 'true');
		el.base.focus();
		return;
	}
	setModlyOriginOverride(override);
	el.base.value = override;

	state.probeController?.abort();
	const controller = new AbortController();
	state.probeController = controller;
	el.probingText.textContent = `Looking for Modly at ${override || MODLY_DEFAULT_ORIGINS[0]}.`;
	setConnState('probing');

	const probe = await probeModly({ signal: controller.signal });
	if (controller.signal.aborted) return;
	state.probeController = null;

	if (probe.status !== 'connected') {
		state.origin = null;
		setConnState(probe.status, { reason: probe.reason });
		return;
	}
	state.origin = probe.origin;
	writeStore('localStorage', CONNECTED_KEY, '1');
	el.connOrigin.textContent = `at ${probe.origin}`;
	setConnState('connected');
	applyModels(probe.models, probe.error);
	await loadOps();
	await resumeAfterSignIn();
}

function summarizeConnection() {
	const n = state.models.length;
	const ready = state.models.filter((m) => m.downloaded).length;
	if (!n) {
		el.connSummary.textContent = 'No models installed in Modly yet. Add one below to start generating.';
		return;
	}
	const models = n === 1 ? '1 model installed' : `${n} models installed`;
	el.connSummary.textContent = ready === n ? `${models}, all downloaded and ready.` : `${models}, ${ready} downloaded. The others fetch their weights on first use.`;
}

// ── models ─────────────────────────────────────────────────────────────────

function applyModels(models, error) {
	state.models = models;
	show(el.modelsLoading, false);
	show(el.modelsEmpty, false);
	show(el.modelList, false);
	if (error) {
		el.modelsError.textContent = `Modly is running, but its model list failed to load. ${modlyErrorCopy(error).text}`;
		show(el.modelsError, true);
	} else {
		show(el.modelsError, false);
	}
	summarizeConnection();
	if (!models.length) {
		state.modelId = null;
		renderParams([]);
		if (!error) renderEmptyModels();
	} else {
		const keep = models.find((m) => m.id === state.modelId);
		const pick = keep || models.find((m) => m.active) || models.find((m) => m.loaded) || models.find((m) => m.downloaded) || models[0];
		state.modelId = pick.id;
		renderModelList();
		// A refresh that keeps the same model keeps the settings already chosen.
		if (!keep) renderParams(pick.paramsSchema);
	}
	updateGenerateState();
}

async function refreshModels() {
	if (!state.origin) return;
	setBusy(el.refreshModels, true);
	show(el.modelsLoading, true);
	show(el.modelList, false);
	show(el.modelsEmpty, false);
	try {
		applyModels(await listModlyModels(state.origin));
	} catch (err) {
		applyModels([], err);
	} finally {
		show(el.modelsLoading, false);
		setBusy(el.refreshModels, false);
	}
}

function renderEmptyModels() {
	el.extList.replaceChildren(
		...OFFICIAL_EXTENSIONS.map((ext) => {
			const li = document.createElement('li');
			li.className = 'md-ext';
			const name = document.createElement('span');
			name.className = 'md-ext__name';
			const strong = document.createElement('strong');
			strong.textContent = ext.name;
			const url = document.createElement('span');
			url.className = 'md-ext__url';
			url.textContent = ext.repo.replace('https://', '');
			name.append(strong, url);
			const copy = document.createElement('button');
			copy.type = 'button';
			copy.className = 'md-btn md-btn--sm';
			copy.textContent = 'Copy link';
			copy.setAttribute('aria-label', `Copy the ${ext.name} repository link`);
			copy.addEventListener('click', () => copyText(ext.repo, `${ext.name} link copied. Paste it into Modly.`));
			li.append(name, copy);
			return li;
		}),
	);
	show(el.modelsEmpty, true);
}

async function copyText(text, message) {
	try {
		await navigator.clipboard.writeText(text);
		toast(message);
	} catch {
		toast(`Copy this link: ${text}`);
	}
}

function renderModelList() {
	const buttons = state.models.map((m) => {
		const btn = document.createElement('button');
		btn.type = 'button';
		btn.className = 'md-model';
		btn.setAttribute('role', 'radio');
		btn.dataset.id = m.id;
		const checked = m.id === state.modelId;
		btn.setAttribute('aria-checked', checked ? 'true' : 'false');
		btn.tabIndex = checked ? 0 : -1;

		const radio = document.createElement('span');
		radio.className = 'md-model__radio';
		radio.setAttribute('aria-hidden', 'true');
		const name = document.createElement('span');
		name.className = 'md-model__name';
		name.textContent = m.name;
		btn.append(radio, name);

		if (m.description) {
			const desc = document.createElement('span');
			desc.className = 'md-model__desc';
			desc.textContent = m.description;
			btn.append(desc);
		}
		const tags = document.createElement('span');
		tags.className = 'md-model__tags';
		tags.append(tag(m.downloaded ? 'Downloaded' : 'Downloads on first run', m.downloaded ? 'ok' : 'warn'));
		if (m.loaded) tags.append(tag('In GPU memory', 'ok'));
		if (m.vramGb > 0) tags.append(tag(`${m.vramGb} GB VRAM`));
		btn.append(tags);
		btn.addEventListener('click', () => selectModel(m.id));
		return btn;
	});
	el.modelList.replaceChildren(...buttons);
	show(el.modelList, true);
}

function tag(text, tone) {
	const span = document.createElement('span');
	span.className = `md-tag${tone ? ` md-tag--${tone}` : ''}`;
	span.textContent = text;
	return span;
}

el.modelList.addEventListener('keydown', (e) => {
	if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.key)) return;
	e.preventDefault();
	const ids = state.models.map((m) => m.id);
	const idx = ids.indexOf(state.modelId);
	const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
	const next = ids[(idx + step + ids.length) % ids.length];
	selectModel(next);
	el.modelList.querySelector(`[data-id="${CSS.escape(next)}"]`)?.focus();
});

function selectModel(id) {
	if (id === state.modelId) return;
	state.modelId = id;
	renderModelList();
	renderParams(state.models.find((m) => m.id === id)?.paramsSchema || []);
	updateGenerateState();
}

function renderParams(schema) {
	state.paramsSchema = schema;
	state.paramValues = defaultValues(schema);
	renderSchemaForm(el.paramsForm, schema, state.paramValues, 'mdp');
	show(el.params, schema.length > 0);
}

// ── schema-driven forms (model params and mesh ops share them) ─────────────

// Modly's own defaults, plus a value for every control a schema leaves
// without one, so what the form shows is exactly what gets sent.
function defaultValues(schema) {
	const values = defaultModlyParams(schema);
	for (const p of schema) {
		if (values[p.id] !== undefined && values[p.id] !== null) continue;
		if (p.type === 'boolean') values[p.id] = false;
		else if (p.type === 'select' && p.options?.length) values[p.id] = p.options[0].value;
	}
	return values;
}

function isVisible(param, values) {
	if (!param.show_if) return true;
	return Object.entries(param.show_if).every(([key, expected]) => {
		const actual = values[key];
		return Array.isArray(expected) ? expected.some((v) => String(v) === String(actual)) : String(expected) === String(actual);
	});
}

function applyVisibility(container, schema, values) {
	for (const p of schema) {
		const field = container.querySelector(`[data-param="${CSS.escape(p.id)}"]`);
		if (field) field.hidden = !isVisible(p, values);
	}
}

function clampNumber(raw, p) {
	let n = p.type === 'int' ? Math.round(Number(raw)) : Number(raw);
	if (!Number.isFinite(n)) n = Number(p.default ?? p.min ?? 0);
	if (Number.isFinite(p.min)) n = Math.max(p.min, n);
	if (Number.isFinite(p.max)) n = Math.min(p.max, n);
	return n;
}

function renderSchemaForm(container, schema, values, prefix) {
	const fields = schema.map((p) => {
		const id = `${prefix}-${p.id}`;
		const field = document.createElement('div');
		field.className = 'md-field';
		field.dataset.param = p.id;

		const label = document.createElement('label');
		label.className = 'md-label';
		label.htmlFor = id;
		label.textContent = p.label || p.id;

		let hint = null;
		if (p.tooltip) {
			hint = document.createElement('p');
			hint.className = 'md-hint';
			hint.id = `${id}-hint`;
			hint.textContent = p.tooltip;
		}
		const update = (v) => {
			values[p.id] = v;
			applyVisibility(container, schema, values);
		};

		if (p.type === 'boolean') {
			field.classList.add('md-field--inline');
			const input = document.createElement('input');
			input.type = 'checkbox';
			input.className = 'md-check';
			input.id = id;
			input.checked = Boolean(values[p.id]);
			input.addEventListener('change', () => update(input.checked));
			field.append(input, label);
		} else if (p.type === 'select') {
			const select = document.createElement('select');
			select.className = 'md-input';
			select.id = id;
			(p.options || []).forEach((opt, i) => {
				const o = document.createElement('option');
				o.value = String(i);
				o.textContent = opt.label ?? String(opt.value);
				if (String(opt.value) === String(values[p.id])) o.selected = true;
				select.append(o);
			});
			select.addEventListener('change', () => update(p.options[Number(select.value)]?.value));
			field.append(label, select);
		} else if (p.type === 'int' || p.type === 'float') {
			const bounded = Number.isFinite(p.min) && Number.isFinite(p.max);
			const step = p.step ?? (p.type === 'int' ? 1 : 0.01);
			const number = document.createElement('input');
			number.type = 'number';
			number.className = 'md-input md-input--mono';
			number.id = id;
			number.step = String(step);
			if (Number.isFinite(p.min)) number.min = String(p.min);
			if (Number.isFinite(p.max)) number.max = String(p.max);
			number.value = String(values[p.id] ?? '');
			if (bounded) {
				const row = document.createElement('div');
				row.className = 'md-num-row';
				const range = document.createElement('input');
				range.type = 'range';
				range.className = 'md-range';
				range.min = String(p.min);
				range.max = String(p.max);
				range.step = String(step);
				range.value = number.value;
				range.setAttribute('aria-label', `${p.label || p.id} slider`);
				range.addEventListener('input', () => {
					number.value = range.value;
					update(clampNumber(range.value, p));
				});
				number.addEventListener('change', () => {
					const v = clampNumber(number.value, p);
					number.value = String(v);
					range.value = String(v);
					update(v);
				});
				row.append(range, number);
				field.append(label, row);
			} else {
				number.addEventListener('change', () => {
					const v = clampNumber(number.value, p);
					number.value = String(v);
					update(v);
				});
				field.append(label, number);
			}
		} else {
			// 'string' and 'file-select' (a path on the visitor's disk; the
			// browser cannot browse it, so it is typed).
			const input = document.createElement('input');
			input.type = 'text';
			input.className = 'md-input';
			input.id = id;
			input.spellcheck = false;
			input.value = String(values[p.id] ?? '');
			if (p.type === 'file-select') {
				input.classList.add('md-input--mono');
				input.placeholder = 'Full path on this computer';
			}
			input.addEventListener('input', () => update(input.value));
			field.append(label, input);
		}
		if (hint) {
			field.querySelector('input, select')?.setAttribute('aria-describedby', hint.id);
			field.append(hint);
		}
		return field;
	});
	container.replaceChildren(...fields);
	applyVisibility(container, schema, values);
}

// Only send the params the visitor can see; hidden ones belong to other modes.
function visibleValues(schema, values) {
	const out = {};
	for (const p of schema) if (isVisible(p, values) && values[p.id] !== undefined) out[p.id] = values[p.id];
	return out;
}

// ── input: image ───────────────────────────────────────────────────────────

function setImage(blob, name) {
	if (!blob) return;
	if (!/^image\/(png|jpeg|webp)$/.test(blob.type)) {
		toast('Use a PNG, JPEG or WebP image.');
		return;
	}
	if (blob.size > MAX_IMAGE_BYTES) {
		toast('That image is over 20 MB. Use a smaller one.');
		return;
	}
	if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
	state.image = blob;
	state.imageName = name || 'image';
	state.imageUrl = URL.createObjectURL(blob);
	el.dropImg.src = state.imageUrl;
	el.dropImg.alt = `Input image: ${state.imageName}`;
	el.dropImg.hidden = false;
	el.drop.classList.add('has-image');
	el.dropName.textContent = `${state.imageName} · ${formatBytes(blob.size)}`;
	show(el.dropMeta, true);
	if (!el.saveName.value || el.saveName.dataset.auto === '1') {
		el.saveName.value = humanName(state.imageName);
		el.saveName.dataset.auto = '1';
	}
	updateGenerateState();
}

function clearImage() {
	if (state.imageUrl) URL.revokeObjectURL(state.imageUrl);
	state.image = null;
	state.imageUrl = null;
	el.dropImg.hidden = true;
	el.dropImg.removeAttribute('src');
	el.drop.classList.remove('has-image');
	show(el.dropMeta, false);
	el.file.value = '';
	updateGenerateState();
}

el.drop.addEventListener('click', () => el.file.click());
el.drop.addEventListener('keydown', (e) => {
	if (e.key === 'Enter' || e.key === ' ') {
		e.preventDefault();
		el.file.click();
	}
});
el.file.addEventListener('change', () => {
	const f = el.file.files?.[0];
	if (f) setImage(f, f.name);
});
for (const type of ['dragenter', 'dragover']) {
	el.drop.addEventListener(type, (e) => {
		e.preventDefault();
		el.drop.classList.add('is-over');
	});
}
for (const type of ['dragleave', 'drop']) {
	el.drop.addEventListener(type, () => el.drop.classList.remove('is-over'));
}
el.drop.addEventListener('drop', (e) => {
	e.preventDefault();
	const f = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith('image/'));
	if (f) setImage(f, f.name);
	else toast('Drop an image file (PNG, JPEG or WebP).');
});
el.clearImage.addEventListener('click', clearImage);

document.addEventListener('paste', (e) => {
	if (el.studio.hidden) return;
	const target = e.target;
	if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
	const item = [...(e.clipboardData?.items || [])].find((i) => i.kind === 'file' && i.type.startsWith('image/'));
	const f = item?.getAsFile();
	if (!f) return;
	e.preventDefault();
	selectTab('image');
	setImage(f, f.name && f.name !== 'image.png' ? f.name : `pasted.${f.type.split('/')[1] || 'png'}`);
	toast('Image pasted.');
});

// ── input: text prompt via the three.ws concept-image lane ─────────────────

function selectTab(which) {
	const image = which === 'image';
	el.tabImage.setAttribute('aria-selected', String(image));
	el.tabPrompt.setAttribute('aria-selected', String(!image));
	el.tabImage.tabIndex = image ? 0 : -1;
	el.tabPrompt.tabIndex = image ? -1 : 0;
	el.paneImage.hidden = !image;
	el.panePrompt.hidden = image;
}

el.tabImage.addEventListener('click', () => selectTab('image'));
el.tabPrompt.addEventListener('click', () => {
	selectTab('prompt');
	el.prompt.focus();
});
for (const tab of [el.tabImage, el.tabPrompt]) {
	tab.addEventListener('keydown', (e) => {
		if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
		const next = tab === el.tabImage ? el.tabPrompt : el.tabImage;
		next.click();
		next.focus();
	});
}

function conceptErrorMessage(status, data) {
	if (status === 402) return 'You have used today\'s free concept images on this network. Upload your own image instead, or come back tomorrow.';
	if (status === 422) return data?.error_description || data?.message || 'That prompt was refused by the image model. Try describing it differently.';
	if (status === 429) return 'The image lane is busy. Try again in a few seconds.';
	if (status === 400) return data?.error_description || data?.message || 'That prompt could not be used. Keep it under 1000 characters.';
	return 'The concept image could not be drawn right now. Try again shortly, or upload an image instead.';
}

async function drawConcept() {
	const text = el.prompt.value.trim();
	show(el.conceptError, false);
	if (text.length < 3) {
		el.conceptError.textContent = 'Describe the object in a few words first.';
		show(el.conceptError, true);
		el.prompt.focus();
		return;
	}
	setBusy(el.concept, true);
	try {
		const prompt = `${text}. Single object, centered, full view, plain light grey background, soft even studio lighting, no text`;
		const res = await fetch('/api/v1/ai/image', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ prompt, aspect_ratio: '1:1' }),
		});
		const data = await res.json().catch(() => ({}));
		if (!res.ok || !data?.url) throw Object.assign(new Error(conceptErrorMessage(res.status, data)), { status: res.status });
		const imgRes = await fetch(data.url, { mode: 'cors' });
		if (!imgRes.ok) throw new Error('The concept image was drawn but could not be downloaded. Try again.');
		const blob = await imgRes.blob();
		const typed = /^image\/(png|jpeg|webp)$/.test(blob.type) ? blob : new Blob([blob], { type: 'image/jpeg' });
		setImage(typed, `${text.slice(0, 40).replace(/[^\w -]+/g, '').trim() || 'concept'}.${typed.type.split('/')[1].replace('jpeg', 'jpg')}`);
		el.saveName.value = text.slice(0, 120);
		el.saveName.dataset.auto = '1';
		selectTab('image');
		toast(data.free && data.quota?.remaining !== undefined ? `Concept ready. ${data.quota.remaining} free left today.` : 'Concept ready. Check it, then generate.');
	} catch (err) {
		el.conceptError.textContent = err?.message || 'The concept image could not be drawn.';
		show(el.conceptError, true);
	} finally {
		setBusy(el.concept, false);
	}
}

el.concept.addEventListener('click', drawConcept);
el.prompt.addEventListener('keydown', (e) => {
	if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
		e.preventDefault();
		drawConcept();
	}
});

// ── generate ───────────────────────────────────────────────────────────────

function updateGenerateState() {
	const running = Boolean(state.job);
	el.generate.disabled = !(state.modelId && state.image && !running && !state.busy);
	let hint;
	if (running) hint = 'Generating on your GPU.';
	else if (!state.models.length) hint = 'Install a model in Modly to start.';
	else if (!state.image) hint = 'Add an image, or draw one from a text prompt.';
	else {
		const m = state.models.find((x) => x.id === state.modelId);
		hint = m && !m.downloaded ? `${m.name} downloads its weights on the first run, which can take a while.` : 'Runs entirely on this computer.';
	}
	el.generateHint.textContent = hint;
}

function setStage(name) {
	el.stage.dataset.stage = name;
}

function restStage() {
	setStage(state.current ? 'ready' : 'empty');
}

function showStageError(err, retry) {
	const copy = modlyErrorCopy(err);
	el.stageErrorTitle.textContent = copy.title;
	el.stageErrorText.textContent = copy.text;
	const detail = err instanceof ModlyError ? err.detail : '';
	el.stageErrorPre.textContent = detail;
	show(el.stageErrorDetail, Boolean(detail));
	state.retryAction = retry || null;
	show(el.stageRetry, Boolean(retry));
	setStage('error');
}

el.stageRetry.addEventListener('click', () => state.retryAction?.());
el.stageDismiss.addEventListener('click', restStage);

const STATE_STEP = { pending: 'Queued in Modly', running: 'Generating', done: 'Fetching the mesh from Modly' };

function renderProgress(pct, step, runState) {
	el.progressBar.style.transform = `scaleX(${pct / 100})`;
	el.progress.setAttribute('aria-valuenow', String(pct));
	el.pct.textContent = `${pct}%`;
	el.step.textContent = step || STATE_STEP[runState] || 'Generating';
}

let elapsedTimer = null;

async function generate() {
	if (!state.origin || !state.image || !state.modelId || state.job) return;
	const controller = new AbortController();
	const started = Date.now();
	state.job = { controller };
	updateGenerateState();
	renderProgress(0, 'Sending your image to Modly', 'pending');
	el.elapsed.textContent = '0:00';
	clearInterval(elapsedTimer);
	elapsedTimer = setInterval(() => {
		el.elapsed.textContent = formatElapsed(Date.now() - started);
	}, 1000);
	setStage('generating');
	el.cancel.disabled = false;
	el.cancel.focus();

	const model = state.models.find((m) => m.id === state.modelId);
	try {
		const result = await generateWithModly(state.origin, {
			image: state.image,
			modelId: state.modelId,
			params: visibleValues(state.paramsSchema, state.paramValues),
			onProgress: renderProgress,
			signal: controller.signal,
		});
		state.history = [];
		await showResult({ workspacePath: result.workspacePath, blob: result.blob, modelId: result.modelId });
		if (model && !model.downloaded) refreshModels();
	} catch (err) {
		if (err?.code === 'CANCELLED') {
			restStage();
			toast('Generation cancelled. Modly stopped the run.');
		} else {
			showStageError(err, generate);
		}
	} finally {
		clearInterval(elapsedTimer);
		state.job = null;
		updateGenerateState();
	}
}

el.generate.addEventListener('click', generate);
el.cancel.addEventListener('click', () => {
	el.cancel.disabled = true;
	el.step.textContent = 'Cancelling';
	state.job?.controller.abort();
});

// ── result: preview, mesh tools, download, save ────────────────────────────

/** Put a GLB on the stage. `pushHistory` keeps the previous one for Undo. */
async function showResult(next, { pushHistory = false } = {}) {
	await ensureModelViewer();
	if (pushHistory && state.current) state.history.push(state.current);
	setCurrent(next);
	await showInViewer(next.blob);
	setStage('ready');
}

function setCurrent(next) {
	state.current = { faceCount: null, modelId: null, ...next };
	el.metaPath.textContent = next.workspacePath;
	el.metaPath.title = `Modly workspace: ${next.workspacePath}`;
	renderMetaStats();
	show(el.meta, true);
	show(el.result, true);
	el.undo.disabled = state.history.length === 0;
	for (const btn of el.ops.querySelectorAll('button')) btn.disabled = false;
	el.save.disabled = false;
	if (!el.saveName.value) el.saveName.value = humanName(next.workspacePath);
	show(el.saveDone, false);
	show(el.saveError, false);
}

function renderMetaStats() {
	const c = state.current;
	const stats = [formatBytes(c.blob.size)];
	if (c.faceCount) stats.push(`${Number(c.faceCount).toLocaleString()} faces`);
	const model = c.modelId ? state.models.find((m) => m.id === c.modelId) : null;
	if (model) stats.push(model.name);
	el.metaStats.textContent = stats.join(' · ');
}

function showInViewer(blob) {
	return new Promise((resolve) => {
		if (!state.viewer) {
			const mv = document.createElement('model-viewer');
			mv.setAttribute('camera-controls', '');
			mv.setAttribute('auto-rotate', '');
			mv.setAttribute('shadow-intensity', '0.8');
			mv.setAttribute('exposure', '1');
			mv.setAttribute('interaction-prompt', 'none');
			// The stage keeps the viewer hidden until the model has loaded, and
			// model-viewer's default lazy loading waits for visibility.
			mv.setAttribute('loading', 'eager');
			mv.setAttribute('alt', 'Generated 3D model preview');
			el.viewerHost.append(mv);
			state.viewer = mv;
		}
		const mv = state.viewer;
		const previousUrl = mv.dataset.objectUrl;
		const url = URL.createObjectURL(blob);
		mv.dataset.objectUrl = url;
		const done = () => {
			mv.removeEventListener('load', done);
			mv.removeEventListener('error', done);
			if (previousUrl) URL.revokeObjectURL(previousUrl);
			resolve();
		};
		mv.addEventListener('load', done);
		mv.addEventListener('error', done);
		mv.src = url;
	});
}

el.stage.addEventListener(
	'error',
	(e) => {
		if (e.target === state.viewer) toast('The preview could not render this file. Download and save still work.');
	},
	true,
);

async function openWorkspaceFile(path) {
	el.loadingText.textContent = 'Loading the model from Modly';
	setStage('loading');
	const { blob } = await downloadModlyGlb(state.origin, path);
	state.history = [];
	await showResult({ workspacePath: path, blob });
}

async function openFromWorkspace(e) {
	e.preventDefault();
	show(el.openError, false);
	el.openPath.removeAttribute('aria-invalid');
	let path;
	try {
		path = validateModlyWorkspacePath(el.openPath.value.trim());
	} catch {
		el.openError.textContent = 'Use a path inside the Modly workspace, like Default/model.glb (no leading slash, no "..").';
		show(el.openError, true);
		el.openPath.setAttribute('aria-invalid', 'true');
		el.openPath.focus();
		return;
	}
	try {
		await openWorkspaceFile(path);
		el.saveName.value = humanName(path);
		el.saveName.dataset.auto = '0';
	} catch (err) {
		if (err?.code === 'NOT_FOUND') {
			el.openError.textContent = `There is no file at ${path} in the Modly workspace. Check the folder and the file name.`;
			show(el.openError, true);
			restStage();
			return;
		}
		showStageError(err, () => el.openForm.requestSubmit());
	}
}

el.openForm.addEventListener('submit', openFromWorkspace);

// mesh tools (Modly's /optimize ops, run on the visitor's machine)

async function loadOps() {
	try {
		state.ops = await listModlyMeshOps(state.origin);
	} catch {
		state.ops = [];
	}
	renderOps();
}

function renderOps() {
	if (!state.ops.length) {
		el.ops.replaceChildren();
		el.opsError.textContent = 'This Modly install does not offer mesh tools. Updating Modly adds repair, decimate and smooth.';
		show(el.opsError, true);
		return;
	}
	show(el.opsError, false);
	const cards = state.ops.map((op) => {
		const card = document.createElement('div');
		card.className = 'md-op';
		const head = document.createElement('div');
		head.className = 'md-op__head';
		const title = document.createElement('span');
		title.className = 'md-op__title';
		title.textContent = op.label;
		const run = document.createElement('button');
		run.type = 'button';
		run.className = 'md-btn md-btn--sm';
		const label = document.createElement('span');
		label.className = 'md-btn__label';
		label.textContent = 'Run';
		const spinner = document.createElement('span');
		spinner.className = 'md-btn__spinner';
		spinner.setAttribute('aria-hidden', 'true');
		run.append(label, spinner);
		run.setAttribute('aria-label', `Run ${op.label}`);
		run.disabled = !state.current;
		head.append(title, run);
		const form = document.createElement('div');
		form.className = 'md-form';
		state.opValues[op.id] = defaultValues(op.paramsSchema);
		renderSchemaForm(form, op.paramsSchema, state.opValues[op.id], `mdo-${op.id}`);
		card.append(head, form);
		run.addEventListener('click', () => runOp(op, run));
		return card;
	});
	el.ops.replaceChildren(...cards);
}

function setToolsBusy(busy) {
	state.busy = busy;
	for (const b of el.ops.querySelectorAll('button')) b.disabled = busy || !state.current;
	el.undo.disabled = busy || state.history.length === 0;
	el.save.disabled = busy || !state.current;
	el.download.disabled = busy || !state.current;
	updateGenerateState();
}

async function runOp(op, button) {
	if (!state.current || state.busy) return;
	show(el.opsError, false);
	setToolsBusy(true);
	setBusy(button, true);
	try {
		const result = await modlyMeshOp(state.origin, {
			glb: state.current.workspacePath,
			op: op.id,
			params: visibleValues(op.paramsSchema, state.opValues[op.id]),
		});
		await showResult(
			{ workspacePath: result.workspacePath, blob: result.blob, modelId: state.current.modelId, faceCount: result.details?.face_count ?? null },
			{ pushHistory: true },
		);
		toast(`${op.label} done.`);
	} catch (err) {
		const copy = modlyErrorCopy(err);
		el.opsError.textContent = `${copy.title}. ${copy.text}`;
		show(el.opsError, true);
	} finally {
		setBusy(button, false);
		setToolsBusy(false);
	}
}

el.undo.addEventListener('click', async () => {
	const prev = state.history.pop();
	if (!prev) return;
	setCurrent(prev);
	await showInViewer(prev.blob);
	setStage('ready');
	toast('Back to the previous version.');
});

// download

function downloadBlob(blob, filename) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.append(a);
	a.click();
	a.remove();
	// Release the object URL once the download manager has surely read it.
	setTimeout(() => URL.revokeObjectURL(url), 60000);
}

el.download.addEventListener('click', () => {
	if (state.current) downloadBlob(state.current.blob, `${fileBaseName(state.current.workspacePath)}.glb`);
});

// save to account

async function saveToAccount(e) {
	e?.preventDefault();
	if (!state.current) return;
	show(el.saveError, false);
	show(el.saveDone, false);
	const name = el.saveName.value.trim() || humanName(state.current.workspacePath);
	el.saveName.value = name;

	let me;
	try {
		me = await getMe();
	} catch {
		// The session check itself failed (network); let the upload decide.
		me = { unknown: true };
	}
	if (!me) {
		writeStore(
			'sessionStorage',
			RESUME_KEY,
			JSON.stringify({ path: state.current.workspacePath, modelId: state.current.modelId, name, visibility: el.saveVis.value, at: Date.now() }),
		);
		show(el.saveSignedOut, true);
		el.signIn.focus();
		return;
	}
	show(el.saveSignedOut, false);

	const controller = new AbortController();
	state.saveController = controller;
	setBusy(el.save, true);
	show(el.saveProgress, true);
	el.saveProgressBar.style.transform = 'scaleX(0)';
	try {
		const model = state.models.find((m) => m.id === state.current.modelId);
		const avatar = await saveRemoteGlbToAccount(
			state.current.blob,
			{
				name,
				visibility: el.saveVis.value,
				source: 'reconstruct',
				tags: ['modly', 'local-gpu'],
				source_meta: {
					generator: 'modly',
					model_id: state.current.modelId || null,
					model_name: model?.name || null,
					modly_path: state.current.workspacePath,
				},
			},
			{
				signal: controller.signal,
				onProgress: (pct) => {
					el.saveProgressBar.style.transform = `scaleX(${Math.max(0, Math.min(100, pct)) / 100})`;
					el.saveProgress.setAttribute('aria-valuenow', String(Math.round(pct)));
				},
			},
		);
		writeStore('sessionStorage', RESUME_KEY, null);
		el.saveLink.href = `/avatars/${encodeURIComponent(avatar.id)}`;
		show(el.saveDone, true);
		el.saveLink.focus();
	} catch (err) {
		if (err?.code === 'not_signed_in' || err?.status === 401) {
			show(el.saveSignedOut, true);
		} else {
			el.saveError.textContent = `Could not save to your account${err?.stage ? ` (${err.stage} step)` : ''}. ${err?.message || ''} Try again; the model is still in your Modly workspace.`;
			show(el.saveError, true);
		}
	} finally {
		state.saveController = null;
		setBusy(el.save, false);
		show(el.saveProgress, false);
	}
}

el.saveForm.addEventListener('submit', saveToAccount);
el.saveName.addEventListener('input', () => {
	el.saveName.dataset.auto = '0';
});
el.signIn.href = `/login?next=${encodeURIComponent('/modly')}`;

// After signing in, the visitor lands back here: reload the same workspace file
// from Modly and finish the save they asked for.
async function resumeAfterSignIn() {
	const raw = readStore('sessionStorage', RESUME_KEY);
	if (!raw) return;
	let stash;
	try {
		stash = JSON.parse(raw);
	} catch {
		writeStore('sessionStorage', RESUME_KEY, null);
		return;
	}
	if (!stash?.path || Date.now() - Number(stash.at || 0) > 60 * 60 * 1000) {
		writeStore('sessionStorage', RESUME_KEY, null);
		return;
	}
	const me = await getMe().catch(() => null);
	if (!me) return;
	try {
		el.loadingText.textContent = 'Loading the model from Modly';
		setStage('loading');
		const { blob } = await downloadModlyGlb(state.origin, stash.path);
		state.history = [];
		await showResult({ workspacePath: stash.path, blob, modelId: stash.modelId || null });
		if (stash.name) el.saveName.value = stash.name;
		if (stash.visibility) el.saveVis.value = stash.visibility;
		toast('Welcome back. Finishing your save.');
		await saveToAccount();
	} catch (err) {
		writeStore('sessionStorage', RESUME_KEY, null);
		showStageError(err, null);
	}
}

// ── boot ───────────────────────────────────────────────────────────────────

el.installLink.href = MODLY_INSTALL_URL;
el.refreshModels.addEventListener('click', refreshModels);
el.base.value = getModlyOriginOverride();
el.baseForm.addEventListener('submit', (e) => {
	e.preventDefault();
	connect();
});
for (const btn of el.conn.querySelectorAll('[data-action="retry"]')) btn.addEventListener('click', connect);

window.addEventListener('pagehide', () => {
	// Leaving mid-run cancels it inside Modly instead of leaving the GPU busy.
	state.job?.controller.abort();
	state.saveController?.abort();
});

// Probing loopback can raise the browser's local-access prompt, so a first
// visit waits for the Connect click, after the page has explained why. A
// returning visitor (connected before, or mid sign-in round trip) has seen
// that prompt already, so the page probes straight away.
if (readStore('localStorage', CONNECTED_KEY) || readStore('sessionStorage', RESUME_KEY)) {
	connect();
} else {
	setConnState('idle');
}

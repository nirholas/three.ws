// Forge Workflows: page entry.
//
// Wires the pure graph core, the node registry, the runner and the real
// /api/forge executors to the canvas editor, the inspector and the phone layout.
// The page owns one workflow value; every edit replaces it through commit(),
// which records undo history and autosaves to this browser.

import {
	blockingIssues,
	cloneWithFreshIds,
	connect,
	canConnect,
	emptyWorkflow,
	parseWorkflow,
	preflight,
	pruneInvalidEdges,
	removeNodes,
	serializeWorkflow,
	topoSort,
} from './graph.js';
import { NODE_TYPES, PALETTE } from './node-types.js';
import { TEMPLATES, instantiateTemplate } from './templates.js';
import { createRunner, summarizeNode } from './runner.js';
import { EXECUTORS, CLIENT_HEADERS } from './executors.js';
import { createEditor, progressText } from './editor.js';
import { createInspector, paramForm } from './inspector.js';
import { createResults, releaseObjectUrls } from './results.js';
import { h, icon, ICONS, announce, toast, MOD, formatSeconds, typingInField } from './ui.js';
import { MODLY_INSTALL_URL, probeModly } from '../modly-local.js';

const types = NODE_TYPES;
const STORE_KEY = 'forge-workflows:v1:current';
const HISTORY_MAX = 100;
const COALESCE_MS = 1200;

const app = document.getElementById('fw-app');

// ── State ───────────────────────────────────────────────────────────────────
let workflow = loadSaved() || emptyWorkflow();
const past = [];
const future = [];
let lastCommit = { coalesce: null, at: 0 };
const ctx = { catalog: null, health: null, modly: null, signedIn: undefined };
let issues = [];
let saveTimer = 0;

function loadSaved() {
	let raw = null;
	try {
		raw = localStorage.getItem(STORE_KEY);
	} catch {
		return null;
	}
	if (!raw) return null;
	try {
		return parseWorkflow(raw, types);
	} catch (err) {
		queueMicrotask(() => toast(`Your saved workflow could not be restored: ${err.message}`, { tone: 'error', timeout: 7000 }));
		return null;
	}
}

function persist() {
	clearTimeout(saveTimer);
	saveTimer = setTimeout(() => {
		try {
			localStorage.setItem(STORE_KEY, serializeWorkflow(workflow, types));
			els.saved.textContent = 'Saved in this browser';
		} catch {
			els.saved.textContent = 'Not saved: browser storage is unavailable. Use Export.';
		}
	}, 400);
}

// ── Layout ──────────────────────────────────────────────────────────────────
const els = {};

function buildShell() {
	els.runBtn = h('button', { type: 'button', class: 'fw-btn is-primary', on: { click: () => (isRunning() ? runner.cancel() : runWorkflow()) } });
	els.freshBtn = h('button', { type: 'button', class: 'fw-btn is-ghost', title: 'Ignore reused results and run every step again', on: { click: () => runWorkflow({ mode: 'fresh' }) } }, icon(ICONS.retry, 14), h('span', { class: 'fw-hide-sm' }, 'Run fresh'));
	els.retryBtn = h('button', { type: 'button', class: 'fw-btn is-ghost', hidden: true, on: { click: retryFailed } }, icon(ICONS.retry, 14), 'Retry failed');
	els.status = h('div', { class: 'fw-runstatus', role: 'status', 'aria-live': 'polite' });
	els.undo = h('button', { type: 'button', class: 'fw-icon-btn', 'aria-label': `Undo (${MOD}+Z)`, title: `Undo (${MOD}+Z)`, on: { click: undo } }, icon(ICONS.undo));
	els.redo = h('button', { type: 'button', class: 'fw-icon-btn', 'aria-label': `Redo (${MOD}+Shift+Z)`, title: `Redo (${MOD}+Shift+Z)`, on: { click: redo } }, icon(ICONS.redo));
	els.importInput = h('input', { type: 'file', accept: '.json,application/json', class: 'fw-sr-only', id: 'fw-import', on: { change: onImportFile } });
	els.saved = h('span', { class: 'fw-saved' });
	els.templatesBtn = h('button', { type: 'button', class: 'fw-btn is-ghost', 'aria-haspopup': 'menu', 'aria-expanded': 'false', on: { click: toggleTemplates } }, icon(ICONS.grid, 14), 'Templates');
	els.templatesMenu = h(
		'div',
		{ class: 'fw-menu', role: 'menu', hidden: true },
		TEMPLATES.map((t) =>
			h(
				'button',
				{ type: 'button', role: 'menuitem', class: 'fw-menu-item', on: { click: () => loadTemplate(t.id) } },
				h('span', { class: 'fw-menu-title' }, t.title),
				h('span', { class: 'fw-menu-sub' }, t.description),
			),
		),
		h('div', { class: 'fw-menu-sep', role: 'separator' }),
		h('button', { type: 'button', role: 'menuitem', class: 'fw-menu-item', on: { click: clearCanvas } }, h('span', { class: 'fw-menu-title' }, 'Blank canvas'), h('span', { class: 'fw-menu-sub' }, 'Start from scratch. Undo brings the current graph back.')),
	);

	const toolbar = h(
		'div',
		{ class: 'fw-toolbar', role: 'toolbar', 'aria-label': 'Workflow' },
		h(
			'div',
			{ class: 'fw-tb-group' },
			h('a', { class: 'fw-crumb', href: '/forge' }, 'Forge'),
			h('span', { class: 'fw-crumb-sep', 'aria-hidden': 'true' }, '/'),
			h('h1', { class: 'fw-title' }, 'Workflows'),
			els.saved,
		),
		h(
			'div',
			{ class: 'fw-tb-group' },
			h('div', { class: 'fw-menu-wrap' }, els.templatesBtn, els.templatesMenu),
			els.undo,
			els.redo,
			h('label', { class: 'fw-btn is-ghost', for: 'fw-import', title: 'Open a workflow file' }, icon(ICONS.upload, 14), h('span', { class: 'fw-hide-sm' }, 'Import')),
			els.importInput,
			h('button', { type: 'button', class: 'fw-btn is-ghost', title: 'Save this workflow as a file', on: { click: exportFile } }, icon(ICONS.download, 14), h('span', { class: 'fw-hide-sm' }, 'Export')),
		),
		h('div', { class: 'fw-tb-group is-run' }, els.status, els.retryBtn, els.freshBtn, els.runBtn),
	);

	els.palette = h(
		'aside',
		{ class: 'fw-palette', 'aria-label': 'Add nodes' },
		h('p', { class: 'fw-palette-hint' }, 'Click to add, or drag onto the canvas.'),
		PALETTE.map((g) =>
			h(
				'section',
				{ class: 'fw-palette-group' },
				h('h2', { class: 'fw-palette-title' }, g.label),
				g.types.map((type) => {
					const def = types[type];
					const b = h(
						'button',
						{
							type: 'button',
							class: `fw-palette-item cat-${def.category}`,
							draggable: 'true',
							title: def.blurb,
							on: {
								click: () => guardEdit() && editor.addNode(type),
								dragstart: (e) => {
									e.dataTransfer.setData('application/x-fw-node', type);
									e.dataTransfer.effectAllowed = 'copy';
								},
							},
						},
						h('span', { class: 'fw-node-dot', 'aria-hidden': 'true' }),
						h('span', {}, def.label),
					);
					return b;
				}),
			),
		),
		h('p', { class: 'fw-palette-foot' }, 'Run models on your own GPU: pick "Your GPU (Modly)" as the Generate engine.'),
	);

	els.canvas = h('div', { class: 'fw-canvas', tabindex: 0, role: 'application', 'aria-label': 'Workflow canvas. Tab to move between nodes; the inspector edits the selected node.' });
	els.empty = h(
		'div',
		{ class: 'fw-empty', hidden: true },
		h('h2', { class: 'fw-empty-title' }, 'Chain three.ws tools into one run'),
		h('p', { class: 'fw-empty-sub' }, 'Start from a template, or drag nodes in from the left and link an output dot to an input dot.'),
		h(
			'div',
			{ class: 'fw-empty-grid' },
			TEMPLATES.map((t) =>
				h(
					'button',
					{ type: 'button', class: 'fw-tcard', on: { click: () => loadTemplate(t.id) } },
					h('span', { class: 'fw-tcard-title' }, t.title),
					h('span', { class: 'fw-tcard-desc' }, t.description),
					h('span', { class: 'fw-tcard-needs' }, `Needs: ${t.needs}`),
				),
			),
		),
	);
	els.zoomLabel = h('span', { class: 'fw-zoom-label' }, '100%');
	const zoom = h(
		'div',
		{ class: 'fw-zoom', role: 'group', 'aria-label': 'Zoom' },
		h('button', { type: 'button', class: 'fw-icon-btn', 'aria-label': 'Zoom out', on: { click: () => editor.zoomOut() } }, icon(ICONS.minus)),
		els.zoomLabel,
		h('button', { type: 'button', class: 'fw-icon-btn', 'aria-label': 'Zoom in', on: { click: () => editor.zoomIn() } }, icon(ICONS.plus)),
		h('button', { type: 'button', class: 'fw-icon-btn', 'aria-label': 'Fit the workflow on screen', title: 'Fit', on: { click: () => editor.fit() } }, icon(ICONS.fit)),
	);
	els.issues = h('div', { class: 'fw-issues', hidden: true });
	els.canvasWrap = h('section', { class: 'fw-canvas-wrap' }, els.canvas, els.empty, zoom, els.issues);
	els.inspector = h('aside', { class: 'fw-inspector', 'aria-label': 'Inspector' });
	els.linear = h('section', { class: 'fw-linear', 'aria-label': 'Workflow steps', hidden: true });

	app.textContent = '';
	app.append(toolbar, h('div', { class: 'fw-body' }, els.palette, els.canvasWrap, els.inspector), els.linear);
	app.dataset.state = 'ready';
	app.removeAttribute('aria-busy');
}

// ── Commit / history ────────────────────────────────────────────────────────
function isRunning() {
	return runner.state.status === 'running';
}

/** Structural edits wait for the run to finish; moving nodes never does. */
function guardEdit() {
	if (!isRunning()) return true;
	toast('A run is in progress. Cancel it (Esc) to edit the workflow.', { tone: 'error' });
	return false;
}

function commit(next, label = 'Edit', { coalesce = null, structural = true } = {}) {
	if (isRunning() && !/^Move/.test(label)) {
		guardEdit();
		editor.render();
		return;
	}
	const now = Date.now();
	const merge = coalesce && lastCommit.coalesce === coalesce && now - lastCommit.at < COALESCE_MS;
	if (!merge) {
		past.push(workflow);
		if (past.length > HISTORY_MAX) past.shift();
	}
	future.length = 0;
	lastCommit = { coalesce, at: now };
	workflow = pruneInvalidEdges(next, types);
	afterChange({ structural });
}

function afterChange({ structural = true } = {}) {
	persist();
	recomputeIssues();
	editor.render();
	results.prune(new Set(workflow.nodes.map((n) => n.id)));
	paintRun();
	updateChrome();
	if (structural && isLinear()) renderLinear();
}

function undo() {
	if (!past.length || isRunning()) return;
	future.push(workflow);
	workflow = past.pop();
	lastCommit = { coalesce: null, at: 0 };
	afterChange();
	inspector.render();
	announce('Undone');
}

function redo() {
	if (!future.length || isRunning()) return;
	past.push(workflow);
	workflow = future.pop();
	lastCommit = { coalesce: null, at: 0 };
	afterChange();
	inspector.render();
	announce('Redone');
}

/** Replace the whole graph (template, import, blank). Undo restores the old one. */
function replaceWorkflow(next, label) {
	if (!guardEdit()) return;
	runner.clearCache();
	runner.reset();
	releaseObjectUrls();
	results.resetPages();
	commit(next, label);
	editor.clearSelection();
	inspector.render();
	requestAnimationFrame(() => editor.fit());
}

// ── Issues ──────────────────────────────────────────────────────────────────
function recomputeIssues() {
	issues = preflight(workflow, types, ctx);
	editor.setIssues(issues);
	const blocking = blockingIssues(issues);
	const warnings = issues.filter((i) => i.level === 'warning');
	els.issues.textContent = '';
	const show = workflow.nodes.length > 0 && issues.length > 0;
	els.issues.hidden = !show;
	if (!show) return;
	const open = els.issues.dataset.open === 'true';
	const head = h(
		'button',
		{
			type: 'button',
			class: `fw-issues-head ${blocking.length ? 'is-error' : 'is-warning'}`,
			'aria-expanded': String(open),
			on: {
				click: () => {
					els.issues.dataset.open = String(!open);
					recomputeIssues();
				},
			},
		},
		icon(ICONS.alert, 14),
		blocking.length ? `${blocking.length} thing${blocking.length === 1 ? '' : 's'} to fix before running` : `${warnings.length} note${warnings.length === 1 ? '' : 's'} before you run`,
		blocking.length && warnings.length ? h('span', { class: 'fw-issues-sub' }, ` and ${warnings.length} note${warnings.length === 1 ? '' : 's'}`) : null,
	);
	els.issues.append(head);
	if (open) {
		els.issues.append(
			h(
				'ul',
				{ class: 'fw-issues-list' },
				issues.map((i) =>
					h(
						'li',
						{ class: `is-${i.level}` },
						i.nodeId
							? h('button', { type: 'button', class: 'fw-link', on: { click: () => editor.focusNode(i.nodeId) } }, i.message)
							: h('span', {}, i.message),
					),
				),
			),
		);
	}
}

// ── Running ─────────────────────────────────────────────────────────────────
const runner = createRunner({ types, executors: EXECUTORS, onChange: () => schedulePaint() });

let paintQueued = false;
function schedulePaint() {
	if (paintQueued) return;
	paintQueued = true;
	requestAnimationFrame(() => {
		paintQueued = false;
		paintRun();
	});
}

let lastInspectorSig = '';
function paintRun() {
	const status = new Map();
	const ids = workflow.nodes.map((n) => n.id);
	for (const id of ids) {
		const steps = runner.stepsFor(id);
		if (steps.length) status.set(id, summarizeNode(steps));
	}
	editor.setStatus(status);
	const surface = isLinear() ? 'linear' : 'canvas';
	results.paintAll(ids, surface);
	if (surface === 'linear') paintLinearStatus(status);
	updateChrome();
	const sig = [runner.state.status, ...[...runner.state.steps.values()].map((s) => `${s.nodeId}${s.iter}${s.status}`)].join('|');
	if (sig !== lastInspectorSig) {
		lastInspectorSig = sig;
		inspector.refreshRun();
	}
}

async function runWorkflow({ mode = 'reuse', fromNodeId = null } = {}) {
	if (isRunning()) return;
	recomputeIssues();
	const blocking = blockingIssues(issues);
	if (blocking.length) {
		els.issues.dataset.open = 'true';
		recomputeIssues();
		const first = blocking.find((i) => i.nodeId);
		if (first && !isLinear()) editor.focusNode(first.nodeId);
		toast(blocking.length === 1 ? blocking[0].message : `Fix ${blocking.length} problems before running.`, { tone: 'error', timeout: 6000 });
		return;
	}
	if (mode === 'fresh') releaseObjectUrls();
	results.resetPages();
	announce('Workflow running');
	let final;
	try {
		final = await runner.run(workflow, { mode, fromNodeId, context: { modly: ctx.modly } });
	} catch (err) {
		toast(err?.message || 'The run could not start.', { tone: 'error' });
		return;
	}
	reportRun(final);
}

function reportRun(final) {
	const steps = [...final.steps.values()];
	const failed = steps.filter((s) => s.status === 'failed');
	const secs = formatSeconds((final.finishedAt - final.startedAt) / 1000);
	if (final.status === 'done') {
		const reused = steps.filter((s) => s.reused).length;
		const msg = reused === steps.length ? 'Nothing changed, so every step was reused.' : `Workflow finished in ${secs}.`;
		toast(msg, { tone: 'success' });
		announce(msg);
	} else if (final.status === 'cancelled') {
		toast('Run cancelled. Finished steps are kept; Run picks up where it stopped.');
		announce('Run cancelled');
	} else {
		const names = [...new Set(failed.map((s) => types[workflow.nodes.find((n) => n.id === s.nodeId)?.type]?.label).filter(Boolean))];
		const msg = `${failed.length} step${failed.length === 1 ? '' : 's'} failed (${names.join(', ')}). The rest of the run finished; open a red node to see why and retry.`;
		toast(msg, { tone: 'error', timeout: 8000 });
		announce(msg);
		const first = failed[0]?.nodeId;
		if (first && !isLinear()) editor.select([first]);
	}
}

function retryFailed() {
	runWorkflow({ mode: 'reuse' });
}

function runFrom(nodeId) {
	runWorkflow({ mode: 'reuse', fromNodeId: nodeId });
}

function updateChrome() {
	const running = isRunning();
	const state = runner.state;
	els.runBtn.textContent = '';
	els.runBtn.classList.toggle('is-danger', running);
	els.runBtn.classList.toggle('is-primary', !running);
	els.runBtn.append(icon(running ? ICONS.stop : ICONS.play, 14), running ? 'Cancel' : 'Run', h('kbd', { class: 'fw-hide-sm' }, running ? 'Esc' : `${MOD}+↵`));
	const blocked = blockingIssues(issues).length > 0;
	els.runBtn.setAttribute('aria-disabled', String(!running && blocked));
	els.runBtn.title = !running && blocked ? 'Fix the listed problems first' : '';
	els.freshBtn.hidden = running || state.status === 'idle';
	const anyFailed = [...state.steps.values()].some((s) => s.status === 'failed');
	els.retryBtn.hidden = running || !anyFailed;
	els.undo.disabled = running || !past.length;
	els.redo.disabled = running || !future.length;
	els.empty.hidden = workflow.nodes.length > 0;
	els.canvasWrap.classList.toggle('is-empty', workflow.nodes.length === 0);
	app.classList.toggle('is-running', running);
	els.status.textContent = statusLine(state);
	els.status.className = `fw-runstatus is-${state.status}`;
	if (els.linearRun) {
		els.linearRun.textContent = '';
		els.linearRun.append(icon(running ? ICONS.stop : ICONS.play, 16), running ? 'Cancel run' : 'Run workflow');
		els.linearRun.classList.toggle('is-danger', running);
		els.linearRun.classList.toggle('is-primary', !running);
	}
}

function statusLine(state) {
	if (state.status === 'idle') return '';
	const steps = [...state.steps.values()];
	if (state.status === 'running') {
		const active = state.activeKey ? state.steps.get(state.activeKey) : null;
		const node = active && workflow.nodes.find((n) => n.id === active.nodeId);
		const done = steps.filter((s) => s.status === 'done').length;
		const pct = active?.progress?.pct;
		const name = node ? types[node.type].label : 'Starting';
		return `${name}${pct != null ? ` ${active.progress.estimate ? '~' : ''}${pct}%` : ''} · ${done}/${steps.length} steps`;
	}
	const secs = formatSeconds(((state.finishedAt || Date.now()) - state.startedAt) / 1000);
	const failed = steps.filter((s) => s.status === 'failed').length;
	if (state.status === 'done') return `Done in ${secs}`;
	if (state.status === 'cancelled') return 'Cancelled';
	return `${failed} failed · ${secs}`;
}

// ── Editing helpers used by the inspector ───────────────────────────────────
function updateParam(nodeId, paramId, value, { coalesce = false } = {}) {
	const nodes = workflow.nodes.map((n) => (n.id === nodeId ? { ...n, params: { ...n.params, [paramId]: value } } : n));
	commit({ ...workflow, nodes }, 'Edit setting', { coalesce: coalesce ? `${nodeId}:${paramId}` : null, structural: false });
}

function deleteSelection() {
	if (!guardEdit()) return;
	const sel = editor.selection;
	if (sel.edge) {
		commit({ ...workflow, edges: workflow.edges.filter((e) => e.id !== sel.edge) }, 'Remove link');
		editor.clearSelection();
		announce('Link removed');
		return;
	}
	if (!sel.nodes.length) return;
	commit(removeNodes(workflow, sel.nodes), sel.nodes.length > 1 ? 'Delete nodes' : 'Delete node');
	editor.clearSelection();
	els.canvas.focus({ preventScroll: true });
	announce(sel.nodes.length > 1 ? `${sel.nodes.length} nodes deleted` : 'Node deleted');
}

function duplicate(ids) {
	if (!guardEdit() || !ids.length) return;
	const pick = new Set(ids);
	const sub = {
		...workflow,
		nodes: workflow.nodes.filter((n) => pick.has(n.id)).map((n) => ({ ...n, x: n.x + 32, y: n.y + 32 })),
		edges: workflow.edges.filter((e) => pick.has(e.from.node) && pick.has(e.to.node)),
	};
	const copy = cloneWithFreshIds(sub);
	commit({ ...workflow, nodes: [...workflow.nodes, ...copy.nodes], edges: [...workflow.edges, ...copy.edges] }, 'Duplicate');
	editor.select(copy.nodes.map((n) => n.id));
}

async function connectModly() {
	const res = await probeModly();
	if (res.status === 'connected') {
		ctx.modly = { origin: res.origin, models: res.models || [] };
		const ready = ctx.modly.models.find((m) => m.downloaded);
		// Point every Modly generate node that has no model yet at the first ready one.
		if (ready) {
			const nodes = workflow.nodes.map((n) => (n.type === 'generate' && n.params.engine === 'modly' && !n.params.modlyModel ? { ...n, params: { ...n.params, modlyModel: ready.id } } : n));
			if (nodes.some((n, i) => n !== workflow.nodes[i])) commit({ ...workflow, nodes }, 'Pick Modly model');
		}
		recomputeIssues();
		editor.render();
		toast(ctx.modly.models.length ? `Modly connected with ${ctx.modly.models.length} model${ctx.modly.models.length === 1 ? '' : 's'}.` : 'Modly is running but has no models yet. Install one in Modly.', { tone: 'success' });
	}
	return res;
}

// ── Templates, import, export ───────────────────────────────────────────────
function toggleTemplates(force) {
	const open = typeof force === 'boolean' ? force : els.templatesMenu.hidden;
	els.templatesMenu.hidden = !open;
	els.templatesBtn.setAttribute('aria-expanded', String(open));
	if (open) els.templatesMenu.querySelector('button')?.focus();
}

function loadTemplate(id) {
	toggleTemplates(false);
	const t = TEMPLATES.find((x) => x.id === id);
	if (!t) return;
	const had = workflow.nodes.length > 0;
	replaceWorkflow(instantiateTemplate(id), `Load ${t.title}`);
	toast(had ? `Loaded "${t.title}". Undo (${MOD}+Z) brings back your previous graph.` : `Loaded "${t.title}". Fill in the inputs, then Run.`, { tone: 'success' });
}

function clearCanvas() {
	toggleTemplates(false);
	if (!workflow.nodes.length) return;
	replaceWorkflow(emptyWorkflow(), 'Clear canvas');
	toast(`Canvas cleared. Undo (${MOD}+Z) restores it.`);
}

async function onImportFile(e) {
	const file = e.target.files?.[0];
	e.target.value = '';
	if (!file) return;
	if (file.size > 2 * 1024 * 1024) {
		toast('That file is too large to be a workflow (over 2 MB).', { tone: 'error' });
		return;
	}
	try {
		const next = parseWorkflow(await file.text(), types);
		replaceWorkflow(next, 'Import');
		toast(`Imported "${next.name}".`, { tone: 'success' });
	} catch (err) {
		toast(err.message || 'That file could not be imported.', { tone: 'error', timeout: 6000 });
	}
}

function exportFile() {
	const text = serializeWorkflow(workflow, types);
	const slug = String(workflow.name || 'workflow').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workflow';
	const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
	const a = h('a', { href: url, download: `${slug}.forge-workflow.json` });
	document.body.append(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 0);
	toast('Workflow file downloaded. Import it here any time.', { tone: 'success' });
}

// ── Phone layout ────────────────────────────────────────────────────────────
const phone = window.matchMedia('(max-width: 760px)');
function isLinear() {
	return phone.matches;
}

function applyLayout() {
	const linear = isLinear();
	app.dataset.layout = linear ? 'linear' : 'canvas';
	els.linear.hidden = !linear;
	if (linear) renderLinear();
	else {
		editor.render();
		requestAnimationFrame(() => editor.fit());
	}
	paintRun();
}

const LINEAR_EDITABLE = { prompt: ['text'], image: ['images'], forEach: ['mode', 'images', 'prompts'], loadMesh: ['url'] };

function renderLinear() {
	const order = topoSort(workflow).order;
	const nodes = order.map((id) => workflow.nodes.find((n) => n.id === id)).filter(Boolean);
	const pickId = 'fw-linear-template';
	const picker = h(
		'select',
		{
			id: pickId,
			class: 'fw-input',
			on: {
				change: (e) => {
					if (e.target.value) loadTemplate(e.target.value);
				},
			},
		},
		h('option', { value: '' }, workflow.nodes.length ? `Current: ${workflow.name}` : 'Choose a template'),
		TEMPLATES.map((t) => h('option', { value: t.id }, t.title)),
	);
	els.linearSteps = new Map();
	const list = h(
		'ol',
		{ class: 'fw-linear-steps' },
		nodes.map((n, i) => {
			const def = types[n.type];
			const editable = LINEAR_EDITABLE[n.type];
			const badge = h('span', { class: 'fw-node-badge' });
			const prog = h('div', { class: 'fw-progress-label', hidden: true });
			els.linearSteps.set(n.id, { badge, prog });
			return h(
				'li',
				{ class: `fw-linear-step cat-${def.category}`, dataset: { id: n.id } },
				h('div', { class: 'fw-linear-head' }, h('span', { class: 'fw-linear-num' }, String(i + 1)), h('span', { class: 'fw-linear-title' }, def.label), badge),
				h('div', { class: 'fw-node-summary' }, def.summary ? def.summary(n.params || {}, ctx) : ''),
				editable
					? paramForm(n, def, ctx, (paramId, value, { rerender } = {}) => {
							updateParam(n.id, paramId, value, { coalesce: !rerender });
							if (rerender) renderLinear();
						}, { only: editable, disabled: isRunning() })
					: null,
				prog,
				results.hostFor(n.id, 'linear'),
			);
		}),
	);
	els.linearRun = h('button', { type: 'button', class: 'fw-btn is-primary is-block', on: { click: () => (isRunning() ? runner.cancel() : runWorkflow()) } });
	const blocking = blockingIssues(issues);
	els.linear.textContent = '';
	els.linear.append(
		h('div', { class: 'fw-field' }, h('label', { class: 'fw-label', for: pickId }, 'Workflow'), picker),
		h('p', { class: 'fw-hint' }, 'Rearranging nodes needs a larger screen. Here you can pick a template, fill in its prompt or photos, and run it.'),
		nodes.length ? list : h('p', { class: 'fw-linear-empty' }, 'Pick a template above to get started.'),
		blocking.length ? h('ul', { class: 'fw-issues-list is-inline' }, blocking.map((i) => h('li', { class: 'is-error' }, i.message))) : null,
		h('div', { class: 'fw-linear-bar' }, els.linearRun),
	);
	updateChrome();
	paintRun();
}

function paintLinearStatus(status) {
	if (!els.linearSteps) return;
	for (const [id, parts] of els.linearSteps) {
		const s = status.get(id);
		const st = s?.status || 'idle';
		parts.badge.className = `fw-node-badge is-${st}`;
		parts.badge.textContent = st === 'idle' ? '' : `${{ pending: 'Waiting', running: 'Running', done: 'Done', partial: 'Partial', failed: 'Failed', cancelled: 'Cancelled', skipped: 'Skipped' }[st]}${s.total > 1 ? ` ${s.done}/${s.total}` : ''}`;
		parts.prog.hidden = st !== 'running';
		if (st === 'running') parts.prog.textContent = progressText(s.running?.progress, s);
	}
}

// ── Keyboard ────────────────────────────────────────────────────────────────
function onKey(e) {
	const mod = e.metaKey || e.ctrlKey;
	if (mod && e.key === 'Enter') {
		e.preventDefault();
		if (!isRunning()) runWorkflow();
		return;
	}
	if (e.key === 'Escape') {
		if (!els.templatesMenu.hidden) {
			toggleTemplates(false);
			els.templatesBtn.focus();
			return;
		}
		if (isRunning()) {
			runner.cancel();
			return;
		}
		if (!typingInField(e.target)) editor.clearSelection();
		return;
	}
	if (typingInField(e.target) || isLinear()) return;
	if (mod && (e.key === 'z' || e.key === 'Z')) {
		e.preventDefault();
		if (e.shiftKey) redo();
		else undo();
		return;
	}
	if (mod && (e.key === 'y' || e.key === 'Y')) {
		e.preventDefault();
		redo();
		return;
	}
	const inApp = app.contains(e.target) || e.target === document.body;
	if (!inApp) return;
	if (mod && (e.key === 'd' || e.key === 'D')) {
		e.preventDefault();
		duplicate(editor.selection.nodes);
		return;
	}
	if (e.key === 'Delete' || e.key === 'Backspace') {
		if (e.target.closest?.('button, a')) return;
		e.preventDefault();
		deleteSelection();
		return;
	}
	const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
	if (arrows[e.key] && editor.selection.nodes.length && !e.target.closest?.('button, a, .fw-quickadd')) {
		e.preventDefault();
		const step = e.shiftKey ? 40 : 8;
		editor.nudge(arrows[e.key][0] * step, arrows[e.key][1] * step);
	}
}

// ── Live context ────────────────────────────────────────────────────────────
async function loadContext() {
	const get = async (url, init) => {
		try {
			const res = await fetch(url, init);
			return res.ok ? await res.json() : null;
		} catch {
			return null;
		}
	};
	const [catalog, health, me] = await Promise.all([
		get('/api/forge?catalog=1', { headers: CLIENT_HEADERS }),
		get('/api/forge?health=1', { headers: CLIENT_HEADERS }),
		get('/api/auth/me', { credentials: 'include', headers: { 'x-witness': 'handled' } }),
	]);
	ctx.catalog = catalog;
	ctx.health = health?.backends || null;
	ctx.signedIn = me ? Boolean(me.user) : undefined;
	if (!catalog) toast('The engine list did not load, so engine checks are limited. Auto still picks a working engine when you run.', { tone: 'error', timeout: 7000 });
	recomputeIssues();
	editor.render();
	inspector.render();
	if (isLinear()) renderLinear();
	updateChrome();
}

// ── Boot ────────────────────────────────────────────────────────────────────
buildShell();

const results = createResults({
	types,
	getNode: (id) => workflow.nodes.find((n) => n.id === id),
	stepsFor: (id) => runner.stepsFor(id),
	onRetry: (nodeId) => {
		if (isRunning()) return;
		runWorkflow({ mode: 'reuse' });
		announce(`Retrying ${types[workflow.nodes.find((n) => n.id === nodeId)?.type]?.label || 'step'}`);
	},
});

const editor = createEditor(els.canvas, {
	types,
	getWorkflow: () => workflow,
	getContext: () => ctx,
	commit: (wf, label) => commit(wf, label),
	onSelect: () => inspector.render(),
	onError: (msg) => toast(msg, { tone: 'error' }),
	resultHost: (id) => results.hostFor(id, 'canvas'),
	onView: (z) => {
		if (els.zoomLabel) els.zoomLabel.textContent = `${Math.round(z * 100)}%`;
	},
});

const inspector = createInspector(els.inspector, {
	types,
	getWorkflow: () => workflow,
	getContext: () => ctx,
	selection: () => editor.selection,
	updateParam,
	canLink: (from, to) => canConnect({ ...workflow, edges: workflow.edges.filter((e) => !(e.to.node === to.node && e.to.port === to.port)) }, types, from, to).ok,
	linkInput: (from, to) => {
		if (!guardEdit()) return;
		const res = connect(workflow, types, from, to);
		if (res.error) toast(res.error, { tone: 'error' });
		else commit(res.workflow, 'Link nodes');
	},
	unlinkInput: (nodeId, portId) => {
		if (!guardEdit()) return;
		commit({ ...workflow, edges: workflow.edges.filter((e) => !(e.to.node === nodeId && e.to.port === portId)) }, 'Remove link');
	},
	stepsFor: (id) => runner.stepsFor(id),
	runState: () => runner.state,
	isRunning,
	issues: () => issues,
	hasBlocking: () => blockingIssues(issues).length > 0,
	runFrom,
	retryFailed,
	duplicate,
	deleteSelection,
	focusNode: (id) => editor.focusNode(id),
	rename: (name) => {
		commit({ ...workflow, name: name.slice(0, 120) }, 'Rename', { coalesce: 'name' });
	},
	connectModly,
	get modly() {
		return ctx.modly;
	},
	modlyInstallUrl: MODLY_INSTALL_URL,
});

document.addEventListener('keydown', onKey);
document.addEventListener('pointerdown', (e) => {
	if (!els.templatesMenu.hidden && !e.target.closest('.fw-menu-wrap')) toggleTemplates(false);
});
phone.addEventListener('change', applyLayout);
window.addEventListener('beforeunload', (e) => {
	if (isRunning()) {
		e.preventDefault();
		e.returnValue = '';
	}
});

const requested = new URLSearchParams(location.search).get('template');
if (requested && TEMPLATES.some((t) => t.id === requested)) {
	workflow = instantiateTemplate(requested);
	history.replaceState(null, '', location.pathname);
	persist();
}

recomputeIssues();
editor.render();
inspector.render();
updateChrome();
applyLayout();
requestAnimationFrame(() => editor.fit());
loadContext();

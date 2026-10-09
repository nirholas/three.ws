// In-browser mesh tools: repair, smooth and decimate any GLB, with undo.
//
// One component, mounted by every surface that shows a model: the forge result
// panel (src/forge-optimize.js and its forge-studio twin) and the model page
// (src/model-page.js). The host hands it a source URL; the panel fetches the
// bytes the first time it is opened, runs every operation in a module worker
// (./client.js), and reports each new version through `onChange` so the host
// can swap its viewer and its download button. Nothing leaves the browser.
//
// History is a stack of GLB versions. Undo pops one, "Reset to original" drops
// to the first, and every version keeps its triangle count so the before/after
// line is exact rather than estimated.
//
// Usage: mountMeshTools(host, { onChange }) returns the panel; onChange gets
// { url, edited } after every edit. Give it a model with
// setSource(glbUrl, { label }), then call activate() when the panel becomes
// visible, which is when it starts fetching.

import { inspect, run } from './client.js';

const HISTORY_LIMIT = 10;
const MAX_SOURCE_BYTES = 150 * 1024 * 1024;

const OPS = {
	repair: {
		label: 'Repair',
		verb: 'Repairing',
		hint: 'Welds duplicate vertices, drops collapsed and duplicate faces, makes the winding consistent and points every shell outward, then rebuilds normals. Edges sharper than the crease angle stay hard.',
	},
	smooth: {
		label: 'Smooth',
		verb: 'Smoothing',
		hint: 'Relaxes surface noise without changing the vertex count, so UVs and textures stay put. Taubin keeps the volume; Laplacian shrinks it and suits heavy noise.',
	},
	decimate: {
		label: 'Decimate',
		verb: 'Decimating',
		hint: 'Collapses the edges that change the shape least until the triangle budget is met. UV seams are respected, so textures keep mapping.',
	},
};

const PHASES = { reading: 'Reading the model', processing: 'Processing geometry', writing: 'Writing the GLB' };

const fmt = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString() : '0');

function injectStyles() {
	if (document.getElementById('mesh-tools-styles')) return;
	const style = document.createElement('style');
	style.id = 'mesh-tools-styles';
	style.textContent = `
		.mt { display: flex; flex-direction: column; gap: var(--space-sm, 0.6rem); }
		.mt-head { display: flex; align-items: baseline; justify-content: space-between; gap: var(--space-sm, 0.6rem); flex-wrap: wrap; }
		.mt-title { font-family: var(--font-display, inherit); font-weight: 600; font-size: var(--text-sm, 0.9rem); color: var(--ink, #eee); }
		.mt-tag { font-family: var(--font-mono, monospace); font-size: var(--text-xs, 0.75rem); color: var(--ink-dim, #999); }
		.mt-tabs {
			display: inline-flex; gap: 2px; padding: 2px; align-self: flex-start;
			background: var(--surface-1, #16161d); border: 1px solid var(--stroke, rgba(255,255,255,0.12)); border-radius: var(--radius-md, 8px);
		}
		.mt-tab {
			background: transparent; border: 0; color: var(--ink-dim, #999); cursor: pointer;
			font-family: var(--font-mono, monospace); font-size: var(--text-xs, 0.75rem); padding: 0.4rem 0.8rem;
			border-radius: var(--radius-sm, 6px); transition: background 0.15s ease, color 0.15s ease;
		}
		.mt-tab:hover { color: var(--ink, #eee); }
		.mt-tab[aria-selected='true'] { background: var(--surface-3, rgba(255,255,255,0.1)); color: var(--ink, #eee); }
		.mt-tab:focus-visible { outline: 2px solid var(--accent, #7c6cff); outline-offset: 2px; }
		.mt-pane { display: flex; flex-direction: column; gap: var(--space-sm, 0.6rem); }
		.mt-pane[hidden] { display: none; }
		.mt-hint { margin: 0; font-size: var(--text-xs, 0.75rem); color: var(--ink-dim, #999); line-height: 1.45; }
		.mt-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: var(--space-sm, 0.6rem) var(--space-md, 1rem); }
		.mt-field { display: flex; flex-direction: column; gap: 0.3rem; min-width: 0; }
		.mt-field > span, .mt-field > label {
			display: flex; justify-content: space-between; gap: 0.5rem;
			font-family: var(--font-mono, monospace); font-size: var(--text-xs, 0.75rem); color: var(--ink-dim, #999);
			text-transform: uppercase; letter-spacing: 0.04em;
		}
		.mt-field output { color: var(--ink, #eee); text-transform: none; letter-spacing: 0; }
		.mt-range { width: 100%; accent-color: var(--accent, #7c6cff); cursor: pointer; }
		.mt-range:focus-visible { outline: 2px solid var(--accent, #7c6cff); outline-offset: 3px; border-radius: 4px; }
		.mt-number, .mt-select {
			background: var(--surface-1, #16161d); border: 1px solid var(--stroke, rgba(255,255,255,0.12)); border-radius: var(--radius-md, 8px);
			color: var(--ink, #eee); font-family: var(--font-mono, monospace); font-size: var(--text-xs, 0.75rem); padding: 0.45rem 0.6rem; width: 100%;
			transition: border-color 0.15s ease;
		}
		.mt-number:hover, .mt-select:hover { border-color: var(--stroke-strong, rgba(255,255,255,0.24)); }
		.mt-number:focus-visible, .mt-select:focus-visible { outline: 2px solid var(--accent, #7c6cff); outline-offset: 1px; }
		.mt-check { display: inline-flex; align-items: center; gap: 0.45rem; font-size: var(--text-xs, 0.75rem); color: var(--ink, #eee); cursor: pointer; }
		.mt-check input { accent-color: var(--accent, #7c6cff); }
		.mt-check input:focus-visible { outline: 2px solid var(--accent, #7c6cff); outline-offset: 2px; }
		.mt-preview { font-family: var(--font-mono, monospace); font-size: var(--text-xs, 0.75rem); color: var(--ink-dim, #999); }
		.mt-preview strong { color: var(--ink, #eee); font-weight: 600; }
		.mt-actions { display: flex; align-items: center; gap: var(--space-sm, 0.6rem); flex-wrap: wrap; }
		.mt-btn {
			display: inline-flex; align-items: center; gap: 0.4rem; cursor: pointer; text-decoration: none;
			background: var(--surface-1, #16161d); color: var(--ink, #eee); border: 1px solid var(--stroke, rgba(255,255,255,0.12));
			border-radius: var(--radius-md, 8px); padding: 0.45rem 0.8rem; font-family: var(--font-body, inherit); font-size: var(--text-xs, 0.78rem);
			transition: border-color 0.15s ease, background 0.15s ease, transform 0.15s ease, opacity 0.15s ease;
		}
		.mt-btn:hover:not(:disabled):not([aria-disabled='true']) { border-color: var(--stroke-strong, rgba(255,255,255,0.24)); background: var(--surface-2, rgba(255,255,255,0.06)); }
		.mt-btn:active:not(:disabled) { transform: translateY(1px); }
		.mt-btn:focus-visible { outline: 2px solid var(--accent, #7c6cff); outline-offset: 2px; }
		.mt-btn:disabled, .mt-btn[aria-disabled='true'] { opacity: 0.45; cursor: not-allowed; }
		.mt-btn.is-primary { background: var(--accent, #7c6cff); border-color: var(--accent, #7c6cff); color: var(--bg-0, #0a0a0a); font-weight: 600; }
		.mt-btn.is-primary:hover:not(:disabled) { background: var(--accent, #7c6cff); filter: brightness(1.08); }
		.mt-spinner {
			width: 0.85em; height: 0.85em; border: 2px solid currentColor; border-right-color: transparent;
			border-radius: 50%; animation: mt-spin 0.7s linear infinite;
		}
		@keyframes mt-spin { to { transform: rotate(360deg); } }
		.mt-status { font-family: var(--font-mono, monospace); font-size: var(--text-xs, 0.75rem); color: var(--ink-dim, #999); min-height: 1.2em; }
		.mt-status[data-kind='error'] { color: var(--danger, #ff6b6b); }
		.mt-status[data-kind='done'] { color: var(--success, #3ecf8e); }
		.mt-counts {
			display: flex; align-items: baseline; gap: 0.5rem; flex-wrap: wrap;
			font-family: var(--font-mono, monospace); font-size: var(--text-xs, 0.75rem); color: var(--ink-dim, #999);
		}
		.mt-counts strong { color: var(--ink, #eee); font-weight: 600; }
		.mt-counts .mt-delta { color: var(--success, #3ecf8e); }
		.mt-counts .mt-delta.is-up { color: var(--warning, #f5a524); }
		.mt-details { display: flex; flex-wrap: wrap; gap: 0.35rem; margin: 0; padding: 0; list-style: none; }
		.mt-details li {
			font-family: var(--font-mono, monospace); font-size: var(--text-2xs, 0.7rem); color: var(--ink-dim, #999);
			border: 1px solid var(--stroke, rgba(255,255,255,0.12)); border-radius: 999px; padding: 0.15rem 0.55rem;
		}
		.mt-details li strong { color: var(--ink, #eee); font-weight: 600; }
		.mt-history { display: flex; flex-wrap: wrap; align-items: center; gap: 0.3rem; font-size: var(--text-2xs, 0.7rem); color: var(--ink-dim, #999); font-family: var(--font-mono, monospace); }
		.mt-history span + span::before { content: '\\2192'; margin-right: 0.3rem; opacity: 0.6; }
		.mt-skeleton {
			height: 1.2rem; border-radius: var(--radius-md, 8px);
			background: linear-gradient(90deg, var(--surface-1, #16161d) 0%, var(--surface-2, rgba(255,255,255,0.06)) 50%, var(--surface-1, #16161d) 100%);
			background-size: 200% 100%; animation: mt-shimmer 1.2s ease-in-out infinite;
		}
		@keyframes mt-shimmer { from { background-position: 100% 0; } to { background-position: -100% 0; } }
		.mt[data-busy='true'] .mt-pane { opacity: 0.6; pointer-events: none; transition: opacity 0.15s ease; }
		@media (prefers-reduced-motion: reduce) {
			.mt-spinner { animation-duration: 1.6s; }
			.mt-skeleton { animation: none; }
		}
	`;
	document.head.appendChild(style);
}

let uid = 0;

function template(id) {
	const tab = (op, selected) => `
		<button class="mt-tab" type="button" role="tab" id="${id}-tab-${op}" data-op="${op}"
			aria-controls="${id}-pane-${op}" aria-selected="${selected}" tabindex="${selected ? 0 : -1}">${OPS[op].label}</button>`;
	return `
		<div class="mt-head">
			<span class="mt-title">Mesh tools</span>
			<span class="mt-tag">runs in your browser, nothing is uploaded</span>
		</div>
		<div class="mt-tabs" role="tablist" aria-label="Mesh operation">
			${tab('repair', true)}${tab('smooth', false)}${tab('decimate', false)}
		</div>
		<div class="mt-pane" role="tabpanel" id="${id}-pane-repair" aria-labelledby="${id}-tab-repair" data-op="repair">
			<p class="mt-hint">${OPS.repair.hint}</p>
			<div class="mt-grid">
				<div class="mt-field">
					<label for="${id}-crease">Crease angle <output for="${id}-crease" data-out="crease">60°</output></label>
					<input class="mt-range" id="${id}-crease" type="range" min="0" max="180" step="5" value="60" data-param="crease" />
				</div>
			</div>
		</div>
		<div class="mt-pane" role="tabpanel" id="${id}-pane-smooth" aria-labelledby="${id}-tab-smooth" data-op="smooth" hidden>
			<p class="mt-hint">${OPS.smooth.hint}</p>
			<div class="mt-grid">
				<div class="mt-field">
					<label for="${id}-method">Method</label>
					<select class="mt-select" id="${id}-method" data-param="method">
						<option value="taubin" selected>Taubin (keeps volume)</option>
						<option value="laplacian">Laplacian</option>
					</select>
				</div>
				<div class="mt-field">
					<label for="${id}-iterations">Iterations <output for="${id}-iterations" data-out="iterations">10</output></label>
					<input class="mt-range" id="${id}-iterations" type="range" min="1" max="50" step="1" value="10" data-param="iterations" />
				</div>
				<div class="mt-field">
					<label for="${id}-lambda">Strength (λ) <output for="${id}-lambda" data-out="lambda">0.50</output></label>
					<input class="mt-range" id="${id}-lambda" type="range" min="0.05" max="1" step="0.05" value="0.5" data-param="lambda" />
				</div>
			</div>
			<label class="mt-check"><input type="checkbox" data-param="preserveBoundary" checked /> Keep open borders fixed</label>
		</div>
		<div class="mt-pane" role="tabpanel" id="${id}-pane-decimate" aria-labelledby="${id}-tab-decimate" data-op="decimate" hidden>
			<p class="mt-hint">${OPS.decimate.hint}</p>
			<div class="mt-grid">
				<div class="mt-field">
					<label for="${id}-ratio">Keep <output for="${id}-ratio" data-out="ratio">50%</output></label>
					<input class="mt-range" id="${id}-ratio" type="range" min="1" max="100" step="1" value="50" data-param="ratio" />
				</div>
				<div class="mt-field">
					<label for="${id}-target">Target triangles</label>
					<input class="mt-number" id="${id}-target" type="number" min="4" step="1" inputmode="numeric" data-param="target" />
				</div>
			</div>
			<div class="mt-preview" data-role="preview" aria-live="polite"></div>
		</div>
		<div class="mt-actions">
			<button class="mt-btn is-primary" type="button" data-action="apply">Apply repair</button>
			<button class="mt-btn" type="button" data-action="undo" disabled title="Undo (Ctrl+Z)">Undo</button>
			<button class="mt-btn" type="button" data-action="reset" disabled>Reset to original</button>
			<a class="mt-btn" data-action="download" aria-disabled="true" role="link">Download GLB</a>
		</div>
		<div class="mt-status" role="status" aria-live="polite"></div>
		<div class="mt-counts" data-role="counts" hidden></div>
		<ul class="mt-details" data-role="details" hidden></ul>
		<div class="mt-history" data-role="history" hidden></div>
	`;
}

function safeName(label) {
	return String(label || 'model').replace(/[^a-z0-9]+/gi, '-').slice(0, 48).replace(/^-|-$/g, '') || 'model';
}

function describe(stats) {
	const items = [];
	const add = (n, text) => {
		if (n > 0) items.push(`<li><strong>${fmt(n)}</strong> ${text}</li>`);
	};
	if (stats.op === 'repair') {
		add(stats.mergedVertices, 'vertices welded');
		add(stats.collapsedFaces + stats.zeroAreaFaces, 'degenerate faces removed');
		add(stats.duplicateFaces, 'duplicate faces removed');
		add(stats.flippedFaces, 'faces re-wound');
		add(stats.reversedShells, 'inside-out shells flipped');
		add(stats.hardEdgeVertices, 'vertices split for hard edges');
		if (stats.openEdges > 0) items.push(`<li><strong>${fmt(stats.openEdges)}</strong> open edges remain</li>`);
		if (stats.nonManifoldEdges > 0) items.push(`<li><strong>${fmt(stats.nonManifoldEdges)}</strong> non-manifold edges remain</li>`);
		if (!items.length) items.push('<li>Nothing needed fixing: the mesh was already clean</li>');
	} else if (stats.op === 'smooth') {
		items.push(`<li>${stats.method === 'laplacian' ? 'Laplacian' : 'Taubin'} × <strong>${fmt(stats.iterations)}</strong></li>`);
		add(stats.movedPoints, 'points moved');
		add(stats.pinnedPoints, 'border points pinned');
		if (typeof stats.maxDisplacement === 'number') {
			items.push(`<li>max shift <strong>${(stats.maxDisplacement * 100).toFixed(2)}%</strong> of size</li>`);
		}
	} else if (stats.op === 'decimate') {
		if (typeof stats.error === 'number') items.push(`<li>shape error <strong>${(stats.error * 100).toFixed(2)}%</strong></li>`);
		if (stats.seamsRelaxed) items.push('<li>UV seams relaxed to reach the budget</li>');
	}
	return items.join('');
}

/**
 * @param {HTMLElement} host  element the tools render into
 * @param {{ onChange?: (v: { url: string, edited: boolean, triangles: number, op: string|null, filename: string }) => void }} opts
 */
export function mountMeshTools(host, { onChange } = {}) {
	injectStyles();
	const id = `mt${++uid}`;
	const root = document.createElement('div');
	root.className = 'mt';
	root.innerHTML = template(id);
	host.appendChild(root);

	const q = (sel) => root.querySelector(sel);
	const tabs = [...root.querySelectorAll('.mt-tab')];
	const panes = [...root.querySelectorAll('.mt-pane')];
	const applyBtn = q('[data-action="apply"]');
	const undoBtn = q('[data-action="undo"]');
	const resetBtn = q('[data-action="reset"]');
	const downloadLink = q('[data-action="download"]');
	const statusEl = q('.mt-status');
	const countsEl = q('[data-role="counts"]');
	const detailsEl = q('[data-role="details"]');
	const historyEl = q('[data-role="history"]');
	const previewEl = q('[data-role="preview"]');
	const input = (name) => q(`[data-param="${name}"]`);
	const output = (name) => q(`[data-out="${name}"]`);

	const state = {
		op: 'repair',
		sourceUrl: null,
		label: 'model',
		history: [], // [{ bytes, triangles, op, stats, url }]
		loading: null,
		failed: false,
		busy: false,
		token: 0,
	};

	const current = () => state.history[state.history.length - 1] || null;

	function setStatus(text, kind) {
		statusEl.textContent = text || '';
		if (kind) statusEl.dataset.kind = kind;
		else statusEl.removeAttribute('data-kind');
	}

	function setBusy(busy, label) {
		state.busy = busy;
		root.dataset.busy = String(busy);
		applyBtn.disabled = busy || !state.sourceUrl;
		applyBtn.innerHTML = busy ? `<span class="mt-spinner" aria-hidden="true"></span> ${label}…` : `Apply ${OPS[state.op].label.toLowerCase()}`;
		syncButtons();
	}

	function filename() {
		const steps = state.history.slice(1).map((v) => v.op);
		const suffix = steps.length ? `-${[...new Set(steps)].join('-')}` : '';
		return `${safeName(state.label)}${suffix}.glb`;
	}

	function syncButtons() {
		const edits = state.history.length - 1;
		undoBtn.disabled = state.busy || edits < 1;
		resetBtn.disabled = state.busy || edits < 1;
		const v = current();
		const href = v?.url || state.sourceUrl;
		if (href && !state.busy) {
			downloadLink.href = href;
			downloadLink.setAttribute('download', filename());
			downloadLink.removeAttribute('aria-disabled');
			downloadLink.removeAttribute('role');
		} else {
			downloadLink.removeAttribute('href');
			downloadLink.setAttribute('aria-disabled', 'true');
			downloadLink.setAttribute('role', 'link');
		}
	}

	function renderCounts() {
		const original = state.history[0];
		const v = current();
		if (!original || !v) {
			countsEl.hidden = !state.loading;
			countsEl.innerHTML = state.loading ? '<div class="mt-skeleton" style="width:100%" aria-hidden="true"></div>' : '';
			return;
		}
		countsEl.hidden = false;
		if (v === original) {
			countsEl.innerHTML = `<span><strong>${fmt(original.triangles)}</strong> triangles</span><span>original</span>`;
			return;
		}
		const delta = v.triangles - original.triangles;
		const pct = original.triangles ? Math.round((delta / original.triangles) * 100) : 0;
		const deltaText = delta === 0 ? 'unchanged' : `${delta > 0 ? '+' : ''}${pct}%`;
		countsEl.innerHTML = `
			<span>Before <strong>${fmt(original.triangles)}</strong></span>
			<span aria-hidden="true">→</span>
			<span>After <strong>${fmt(v.triangles)}</strong> triangles</span>
			<span class="mt-delta${delta > 0 ? ' is-up' : ''}">${deltaText}</span>`;
	}

	function renderHistory() {
		const steps = state.history.slice(1);
		historyEl.hidden = steps.length === 0;
		historyEl.innerHTML = steps.length
			? `<span>Original</span>${steps.map((v) => `<span>${OPS[v.op].label}</span>`).join('')}`
			: '';
	}

	function renderDetails(stats) {
		const html = stats ? describe(stats) : '';
		detailsEl.hidden = !html;
		detailsEl.innerHTML = html;
	}

	function decimateTarget() {
		const v = current();
		const n = Number(input('target').value);
		if (Number.isFinite(n) && n > 0) return Math.round(n);
		return v ? Math.max(4, Math.round(v.triangles * (Number(input('ratio').value) / 100))) : 0;
	}

	function renderPreview() {
		const v = current();
		if (!v) {
			previewEl.innerHTML = state.loading ? 'Counting triangles…' : 'Open the model to see the live count.';
			return;
		}
		const target = Math.min(v.triangles, decimateTarget());
		previewEl.innerHTML = `<strong>${fmt(v.triangles)}</strong> → <strong>${fmt(target)}</strong> triangles`;
	}

	function syncRatioFromTarget() {
		const v = current();
		const n = Number(input('target').value);
		if (!v || !n) return;
		const pct = Math.max(1, Math.min(100, Math.round((n / v.triangles) * 100)));
		input('ratio').value = String(pct);
		output('ratio').textContent = `${pct}%`;
	}

	function syncTargetFromRatio() {
		const v = current();
		const pct = Number(input('ratio').value);
		output('ratio').textContent = `${pct}%`;
		if (v) input('target').value = String(Math.max(4, Math.round(v.triangles * (pct / 100))));
	}

	function selectTab(op, focus) {
		state.op = op;
		for (const t of tabs) {
			const on = t.dataset.op === op;
			t.setAttribute('aria-selected', String(on));
			t.tabIndex = on ? 0 : -1;
			if (on && focus) t.focus();
		}
		for (const p of panes) p.hidden = p.dataset.op !== op;
		if (!state.busy) applyBtn.textContent = `Apply ${OPS[op].label.toLowerCase()}`;
		if (op === 'decimate') renderPreview();
	}

	function emit() {
		const v = current();
		if (!v) return;
		onChange?.({
			url: v.url || state.sourceUrl,
			edited: state.history.length > 1,
			triangles: v.triangles,
			op: v.op,
			filename: filename(),
		});
	}

	function dropHistory() {
		for (const v of state.history) if (v.url) URL.revokeObjectURL(v.url);
		state.history = [];
	}

	async function load() {
		if (current()) return current();
		if (!state.sourceUrl) throw new Error('No model is loaded yet.');
		if (!state.loading) {
			const token = state.token;
			state.loading = (async () => {
				const res = await fetch(state.sourceUrl);
				if (!res.ok) throw new Error(`The model could not be downloaded (HTTP ${res.status}).`);
				const declared = Number(res.headers.get('content-length'));
				if (declared > MAX_SOURCE_BYTES) throw new Error('This model is over 150 MB, too large to edit in the browser.');
				const bytes = await res.arrayBuffer();
				if (bytes.byteLength > MAX_SOURCE_BYTES) throw new Error('This model is over 150 MB, too large to edit in the browser.');
				const { triangles } = await inspect(bytes);
				if (token !== state.token) return null;
				state.history = [{ bytes, triangles, op: null, stats: null, url: null }];
				return current();
			})().finally(() => {
				state.loading = null;
			});
			renderPreview();
			renderCounts();
		}
		return state.loading;
	}

	async function activate() {
		if (current() || state.loading || state.failed || !state.sourceUrl) return;
		setStatus('Reading the model…');
		try {
			const v = await load();
			if (!v) return;
			setStatus('');
			syncTargetFromRatio();
			renderCounts();
			renderPreview();
			syncButtons();
		} catch (err) {
			state.failed = true;
			setStatus(`${err.message || 'The model could not be read.'} Press Apply to try again.`, 'error');
			renderCounts();
			renderPreview();
		}
	}

	function paramsFor(op) {
		if (op === 'repair') return { creaseDegrees: Number(input('crease').value) };
		if (op === 'smooth') {
			return {
				method: input('method').value,
				iterations: Number(input('iterations').value),
				lambda: Number(input('lambda').value),
				preserveBoundary: input('preserveBoundary').checked,
				creaseDegrees: Number(input('crease').value),
			};
		}
		return { targetTriangles: decimateTarget() };
	}

	async function apply() {
		if (state.busy || !state.sourceUrl) return;
		const op = state.op;
		const token = state.token;
		setBusy(true, OPS[op].verb);
		setStatus('Reading the model…');
		try {
			const base = await load();
			if (!base || token !== state.token) return;
			state.failed = false;
			renderCounts();
			const params = paramsFor(op);
			if (op === 'decimate' && params.targetTriangles >= base.triangles) {
				setStatus(`The model already has ${fmt(base.triangles)} triangles. Pick a lower target.`, 'error');
				return;
			}
			const started = performance.now();
			const result = await run(base.bytes, op, params, (phase) => {
				if (token === state.token) setStatus(`${PHASES[phase] || phase}…`);
			});
			if (token !== state.token) return;
			const url = URL.createObjectURL(new Blob([result.bytes], { type: 'model/gltf-binary' }));
			state.history.push({ bytes: result.bytes, triangles: result.triangles, op, stats: result.stats, url });
			while (state.history.length > HISTORY_LIMIT + 1) {
				const [dropped] = state.history.splice(1, 1);
				if (dropped.url) URL.revokeObjectURL(dropped.url);
			}
			const seconds = ((performance.now() - started) / 1000).toFixed(1);
			setStatus(`${OPS[op].label} done in ${seconds}s.`, 'done');
			renderDetails(result.stats);
			afterHistoryChange();
		} catch (err) {
			if (token === state.token) setStatus(err.message || `${OPS[op].label} failed.`, 'error');
		} finally {
			if (token === state.token) setBusy(false);
		}
	}

	function afterHistoryChange() {
		syncTargetFromRatio();
		renderCounts();
		renderHistory();
		renderPreview();
		syncButtons();
		emit();
	}

	function undo() {
		if (state.busy || state.history.length < 2) return;
		const popped = state.history.pop();
		if (popped.url) setTimeout(() => URL.revokeObjectURL(popped.url), 1000);
		renderDetails(current().stats);
		setStatus(`Undid ${OPS[popped.op].label.toLowerCase()}.`);
		afterHistoryChange();
	}

	function resetToOriginal() {
		if (state.busy || state.history.length < 2) return;
		const removed = state.history.splice(1);
		setTimeout(() => {
			for (const v of removed) if (v.url) URL.revokeObjectURL(v.url);
		}, 1000);
		renderDetails(null);
		setStatus('Back to the original model.');
		afterHistoryChange();
	}

	// ---- wiring ---------------------------------------------------------------

	root.querySelector('.mt-tabs').addEventListener('click', (e) => {
		const tab = e.target.closest('.mt-tab');
		if (tab) selectTab(tab.dataset.op);
	});
	root.querySelector('.mt-tabs').addEventListener('keydown', (e) => {
		const i = tabs.findIndex((t) => t.dataset.op === state.op);
		let next = null;
		if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
		else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
		else if (e.key === 'Home') next = 0;
		else if (e.key === 'End') next = tabs.length - 1;
		if (next === null) return;
		e.preventDefault();
		selectTab(tabs[next].dataset.op, true);
	});

	input('crease').addEventListener('input', () => {
		output('crease').textContent = `${input('crease').value}°`;
	});
	input('iterations').addEventListener('input', () => {
		output('iterations').textContent = input('iterations').value;
	});
	input('lambda').addEventListener('input', () => {
		output('lambda').textContent = Number(input('lambda').value).toFixed(2);
	});
	input('ratio').addEventListener('input', () => {
		syncTargetFromRatio();
		renderPreview();
	});
	input('target').addEventListener('input', () => {
		syncRatioFromTarget();
		renderPreview();
	});

	applyBtn.addEventListener('click', apply);
	undoBtn.addEventListener('click', undo);
	resetBtn.addEventListener('click', resetToOriginal);
	downloadLink.addEventListener('click', (e) => {
		if (downloadLink.getAttribute('aria-disabled') === 'true') e.preventDefault();
	});
	root.addEventListener('keydown', (e) => {
		if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z' && !e.target.matches('input[type="number"]')) {
			e.preventDefault();
			undo();
		}
	});
	root.addEventListener('focusin', () => activate());

	function setSource(url, { label } = {}) {
		state.token += 1;
		dropHistory();
		state.loading = null;
		state.failed = false;
		state.sourceUrl = url || null;
		state.label = label || 'model';
		renderDetails(null);
		renderHistory();
		renderCounts();
		setStatus(url ? '' : 'No model is loaded yet.');
		input('target').value = '';
		setBusy(false);
		renderPreview();
	}

	selectTab('repair');
	setBusy(false);
	renderPreview();

	return {
		setSource,
		activate,
		/** True when the visible model is a local edit rather than the source URL. */
		get edited() {
			return state.history.length > 1;
		},
		destroy() {
			dropHistory();
			root.remove();
		},
	};
}

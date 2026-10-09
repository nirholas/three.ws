// Topology optimizer layered onto the forge result viewer.
//
// When a model becomes available (forge.js dispatches `forge:model-ready`),
// this panel lets the user produce game/animation-ready output from the live
// GLB via the real /api/forge-remesh route:
//   • triangle — quadric (QEM) decimation, fast polygon reduction
//   • quad     — field-aligned quad-dominant retopology (QuadriFlow): clean
//                edge loops that deform well for rigging & animation
//   • lowpoly  — silhouette-preserving low-poly with the original texture
//                re-unwrapped + re-baked onto the new mesh
//
// GLB output renders inline (swaps the live <model-viewer> src); every other
// format is download-only. Nothing fakes progress — the panel polls the job.
//
// Above the server remesh sit the in-browser mesh tools (src/mesh-ops/): repair,
// smooth and decimate, run in a worker with undo and reset to original. Their
// edits swap the viewer and the download button just like a GLB remesh does;
// the server remesh still starts from the last saved (remote) model, because a
// local edit only exists as a blob in this tab.
//
// The panel injects its own markup + styles so it survives independently of the
// forge.html template: it only needs the result panel, viewer, and download
// button to be present.

import { mountMeshTools } from './mesh-ops/panel.js';

const resultPanel = document.getElementById('state-result');
const viewer = document.getElementById('viewer');
const download = document.getElementById('download');

if (resultPanel && viewer) {
	const OPT_POLL_MS = 2500;
	const OPT_MAX_MS = 8 * 60 * 1000; // quad/lowpoly bakes can take a couple minutes

	// Reuse the forge anonymous client id (set by forge.js) for rate-limit
	// fairness; harmless if absent.
	const CLIENT_HEADERS = (() => {
		try {
			const id = localStorage.getItem('forge:cid');
			return id ? { 'x-forge-client': id } : {};
		} catch {
			return {};
		}
	})();

	const MODE_HINTS = {
		triangle:
			'Quadric (QEM) decimation. Fast, general-purpose polygon reduction, best for trimming size before download.',
		quad:
			'Field-aligned quad-dominant retopology (QuadriFlow). Clean edge loops that deform well for rigging & animation. GLB triangulates for preview, pick OBJ for true quad faces.',
		lowpoly:
			'Silhouette-preserving low-poly for real-time use. UVs are re-unwrapped and the original texture is re-baked onto the new mesh so it still renders correctly.',
	};

	const TARGETS = {
		triangle: {
			label: 'Target faces',
			options: [
				[5000, '5k'],
				[10000, '10k'],
				[20000, '20k'],
				[50000, '50k'],
				[100000, '100k'],
			],
			default: 20000,
		},
		quad: {
			label: 'Target quads',
			options: [
				[2500, '2.5k'],
				[5000, '5k'],
				[10000, '10k'],
				[20000, '20k'],
				[40000, '40k'],
			],
			default: 10000,
		},
		lowpoly: {
			label: 'Poly budget',
			options: [
				[1000, '1k, mobile'],
				[5000, '5k, standard'],
				[20000, '20k, hero'],
			],
			default: 5000,
		},
	};

	const FORMATS = [
		['glb', 'GLB (textured)'],
		['obj', 'OBJ (true quads)'],
		['fbx', 'FBX'],
		['stl', 'STL'],
		['ply', 'PLY'],
		['usdz', 'USDZ'],
		['3mf', '3MF'],
	];

	// ── Styles ───────────────────────────────────────────────────────────────
	if (!document.getElementById('forge-optimize-styles')) {
		const style = document.createElement('style');
		style.id = 'forge-optimize-styles';
		style.textContent = `
			.optimize { border-top: 1px solid var(--stroke); }
			.optimize-toggle {
				width: 100%; display: flex; align-items: center; justify-content: space-between;
				gap: var(--space-sm); background: transparent; border: none; color: var(--ink);
				font-family: var(--font-display); font-weight: 600; font-size: var(--text-sm);
				padding: var(--space-sm) var(--space-md); cursor: pointer;
			}
			.optimize-toggle:hover { background: var(--surface-2); }
			.optimize-toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
			.optimize-toggle .chev { transition: transform 0.18s ease; color: var(--ink-dim); }
			.optimize[data-open='true'] .optimize-toggle .chev { transform: rotate(180deg); }
			.optimize-body { display: none; flex-direction: column; gap: var(--space-md); padding: 0 var(--space-md) var(--space-md); }
			.optimize[data-open='true'] .optimize-body { display: flex; }
			.opt-field { display: flex; flex-direction: column; gap: 0.4rem; }
			.opt-field > span {
				font-size: var(--text-xs); color: var(--ink-dim); font-family: var(--font-mono);
				text-transform: uppercase; letter-spacing: 0.04em;
			}
			.seg {
				display: inline-flex; flex-wrap: wrap; gap: 2px; background: var(--surface-1);
				border: 1px solid var(--stroke); border-radius: var(--radius-md); padding: 2px;
			}
			.seg button {
				flex: 1 1 auto; background: transparent; border: none; color: var(--ink-dim);
				font-family: var(--font-mono); font-size: var(--text-xs); padding: 0.4rem 0.7rem;
				border-radius: var(--radius-sm); cursor: pointer; transition: background 0.15s, color 0.15s;
			}
			.seg button:hover { color: var(--ink); }
			.seg button[aria-pressed='true'] { background: var(--surface-3); color: var(--ink); }
			.seg button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
			.opt-mode-hint { font-size: var(--text-xs); color: var(--ink-dim); line-height: 1.4; min-height: 1.4em; margin: 0; }
			.opt-row { display: flex; gap: var(--space-md); flex-wrap: wrap; }
			.opt-row .opt-field { flex: 1 1 140px; }
			.opt-select {
				background: var(--surface-1); border: 1px solid var(--stroke); border-radius: var(--radius-md);
				color: var(--ink); font-family: var(--font-mono); font-size: var(--text-xs); padding: 0.45rem 0.6rem;
			}
			.opt-select:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
			.opt-actions { display: flex; align-items: center; gap: var(--space-md); flex-wrap: wrap; }
			.opt-status { font-size: var(--text-xs); font-family: var(--font-mono); color: var(--ink-dim); }
			.opt-status[data-kind='error'] { color: var(--danger); }
			.opt-status[data-kind='done'] { color: var(--success); }
			.opt-stats { display: flex; gap: var(--space-md); flex-wrap: wrap; font-family: var(--font-mono); font-size: var(--text-xs); color: var(--ink-dim); }
			.opt-stats strong { color: var(--ink); font-weight: 600; }
			.opt-stats.is-hidden { display: none; }
			.opt-section-title {
				margin: 0; font-family: var(--font-mono); font-size: var(--text-xs); color: var(--ink-dim);
				text-transform: uppercase; letter-spacing: 0.04em; padding-top: var(--space-sm);
				border-top: 1px solid var(--stroke);
			}
			.opt-local-note { margin: 0; font-size: var(--text-xs); color: var(--warning); line-height: 1.4; }
			.opt-local-note[hidden] { display: none; }
		`;
		document.head.appendChild(style);
	}

	// ── DOM ────────────────────────────────────────────────────────────────────
	const panel = document.createElement('div');
	panel.className = 'optimize';
	panel.dataset.open = 'false';
	panel.innerHTML = `
		<button class="optimize-toggle" type="button" aria-expanded="false">
			<span>Optimize: repair, smooth, decimate, quad remesh &amp; low-poly</span>
			<svg class="chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
				stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
				<polyline points="6 9 12 15 18 9" />
			</svg>
		</button>
		<div class="optimize-body">
			<div class="opt-local"></div>
			<p class="opt-section-title">Server remesh</p>
			<p class="opt-local-note" hidden>Server remesh starts from the saved model, not your in-browser edits. Download the edited GLB above to keep them.</p>
			<div class="opt-field">
				<span>Mode</span>
				<div class="seg opt-mode" role="group" aria-label="Remesh mode">
					<button type="button" data-mode="triangle" aria-pressed="false">Triangle</button>
					<button type="button" data-mode="quad" aria-pressed="true">Quad retopo</button>
					<button type="button" data-mode="lowpoly" aria-pressed="false">Low-poly</button>
				</div>
				<p class="opt-mode-hint"></p>
			</div>
			<div class="opt-row">
				<label class="opt-field">
					<span class="opt-target-label">Target faces</span>
					<select class="opt-select opt-target"></select>
				</label>
				<label class="opt-field">
					<span>Format</span>
					<select class="opt-select opt-format"></select>
				</label>
				<label class="opt-field opt-texsize-field">
					<span>Texture</span>
					<select class="opt-select opt-texsize">
						<option value="512">512px</option>
						<option value="1024" selected>1024px</option>
						<option value="2048">2048px</option>
					</select>
				</label>
			</div>
			<div class="opt-actions">
				<button class="btn opt-run" type="button"><span class="opt-run-label">Optimize</span></button>
				<span class="opt-status" role="status" aria-live="polite"></span>
			</div>
			<div class="opt-stats is-hidden"></div>
		</div>
	`;
	resultPanel.appendChild(panel);

	const toggle = panel.querySelector('.optimize-toggle');
	const modeGroup = panel.querySelector('.opt-mode');
	const modeHint = panel.querySelector('.opt-mode-hint');
	const targetSel = panel.querySelector('.opt-target');
	const targetLabel = panel.querySelector('.opt-target-label');
	const formatSel = panel.querySelector('.opt-format');
	const texsizeField = panel.querySelector('.opt-texsize-field');
	const texsizeSel = panel.querySelector('.opt-texsize');
	const runBtn = panel.querySelector('.opt-run');
	const runLabel = panel.querySelector('.opt-run-label');
	const statusEl = panel.querySelector('.opt-status');
	const stats = panel.querySelector('.opt-stats');
	const localNote = panel.querySelector('.opt-local-note');

	// The forge download button as forge.js left it, captured the first time a
	// local edit repoints it, so "Reset to original" can hand it back exactly.
	let originalDownload = null;
	function pointDownload(href, name, text) {
		if (!download) return;
		download.href = href;
		download.setAttribute('download', name);
		download.textContent = text;
	}
	const meshTools = mountMeshTools(panel.querySelector('.opt-local'), {
		onChange({ url, edited, filename }) {
			if (download && !originalDownload) {
				originalDownload = {
					href: download.getAttribute('href'),
					name: download.getAttribute('download') || 'forge.glb',
					text: download.textContent,
				};
			}
			viewer.setAttribute('src', url);
			localNote.hidden = !edited;
			if (edited) pointDownload(url, filename, 'Download GLB');
			else if (originalDownload) pointDownload(originalDownload.href, originalDownload.name, originalDownload.text);
		},
	});

	for (const [value, text] of FORMATS) {
		const opt = document.createElement('option');
		opt.value = value;
		opt.textContent = text;
		formatSel.appendChild(opt);
	}

	const state = {
		glbUrl: null,
		label: 'model',
		mode: 'quad',
		running: false,
		pollAbort: false,
	};

	function setStatus(text, kind) {
		statusEl.textContent = text || '';
		if (kind) statusEl.dataset.kind = kind;
		else statusEl.removeAttribute('data-kind');
	}

	function fillTargets(mode) {
		const cfg = TARGETS[mode];
		targetLabel.textContent = cfg.label;
		targetSel.innerHTML = '';
		for (const [value, text] of cfg.options) {
			const opt = document.createElement('option');
			opt.value = String(value);
			opt.textContent = text;
			if (value === cfg.default) opt.selected = true;
			targetSel.appendChild(opt);
		}
	}

	function applyMode(mode) {
		state.mode = mode;
		for (const b of modeGroup.querySelectorAll('button')) {
			b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
		}
		modeHint.textContent = MODE_HINTS[mode];
		fillTargets(mode);
		// Texture re-bake only applies to quad/lowpoly.
		texsizeField.classList.toggle('is-hidden', mode === 'triangle');
	}

	function reset(glbUrl, label) {
		state.glbUrl = glbUrl;
		state.label = label || 'model';
		state.pollAbort = true; // cancel any in-flight poll for the previous model
		setStatus('');
		stats.classList.add('is-hidden');
		stats.innerHTML = '';
		// The source model is always the forged GLB — restore the default label
		// in case a prior optimization repointed the download button.
		if (download) download.textContent = 'Download GLB';
		panel.dataset.open = 'false';
		toggle.setAttribute('aria-expanded', 'false');
		originalDownload = null;
		localNote.hidden = true;
		meshTools.setSource(glbUrl, { label: state.label });
	}

	function setRunning(running) {
		state.running = running;
		runBtn.disabled = running;
		runLabel.textContent = running ? 'Optimizing…' : 'Optimize';
	}

	function sleep(ms) {
		return new Promise((r) => setTimeout(r, ms));
	}

	async function startRemesh() {
		const res = await fetch('/api/forge-remesh', {
			method: 'POST',
			headers: { 'content-type': 'application/json', ...CLIENT_HEADERS },
			body: JSON.stringify({
				mesh_url: state.glbUrl,
				remesh_mode: state.mode,
				target_faces: Number(targetSel.value),
				output_format: formatSel.value,
				texture_size: Number(texsizeSel.value),
			}),
		});
		const data = await res.json().catch(() => ({}));
		if (res.status === 503 || data.error === 'unconfigured') {
			throw new Error('Mesh optimization is not configured on this deployment yet.');
		}
		if (res.status === 429 || data.error === 'rate_limited') {
			const secs = Number(data.retry_after) > 0 ? Math.ceil(Number(data.retry_after)) : 10;
			throw new Error(`Optimizer is busy. Try again in about ${secs}s.`);
		}
		if (!res.ok || !data.job_id) {
			throw new Error(data.message || `Optimizer returned ${res.status}.`);
		}
		return data.job_id;
	}

	async function pollRemesh(jobId) {
		const deadline = performance.now() + OPT_MAX_MS;
		while (!state.pollAbort && performance.now() < deadline) {
			await sleep(OPT_POLL_MS);
			if (state.pollAbort) return null;
			const res = await fetch(`/api/forge-remesh?job=${encodeURIComponent(jobId)}`, {
				headers: CLIENT_HEADERS,
			});
			const data = await res.json().catch(() => ({}));
			if (data.status === 'done' && data.result_url) return data;
			if (data.status === 'failed') throw new Error(data.error || 'Optimization failed.');
			setStatus(data.status === 'running' ? 'Optimizing topology…' : 'Queued…');
		}
		if (state.pollAbort) return null;
		throw new Error('Optimization timed out.');
	}

	function showStats(data, format) {
		const parts = [];
		if (typeof data.face_count === 'number') {
			parts.push(
				`<span><strong>${data.face_count.toLocaleString()}</strong> ${
					state.mode === 'quad' ? 'quads' : 'faces'
				}</span>`,
			);
		}
		if (typeof data.quad_ratio === 'number' && data.quad_ratio > 0) {
			parts.push(
				`<span><strong>${Math.round(data.quad_ratio * 100)}%</strong> quad-dominant</span>`,
			);
		}
		if (data.textured === true) parts.push('<span>texture re-baked ✓</span>');
		parts.push(`<span>${format.toUpperCase()}</span>`);
		stats.innerHTML = parts.join('');
		stats.classList.remove('is-hidden');
	}

	function applyResult(data) {
		const format = formatSel.value;
		const result = data.result_url;
		// GLB renders inline — swap the live viewer so the user sees the new
		// topology immediately. Other formats are download-only.
		if (format === 'glb') {
			viewer.setAttribute('src', result);
			state.glbUrl = result; // chain further optimizations from the new mesh
			originalDownload = null;
			localNote.hidden = true;
			meshTools.setSource(result, { label: `${state.label} ${state.mode}` });
		}
		const safe =
			state.label.replace(/[^a-z0-9]+/gi, '-').slice(0, 48).replace(/^-|-$/g, '') || 'forge';
		if (download) {
			download.href = result;
			download.setAttribute('download', `${safe}-${state.mode}.${format}`);
			download.textContent = `Download ${format.toUpperCase()}`;
		}
		showStats(data, format);
	}

	async function run() {
		if (state.running || !state.glbUrl) return;
		state.pollAbort = false;
		setRunning(true);
		setStatus('Starting…');
		stats.classList.add('is-hidden');
		try {
			const jobId = await startRemesh();
			const done = await pollRemesh(jobId);
			if (!done) return; // superseded by a newer model / cancelled
			applyResult(done);
			setStatus('Done, optimized mesh ready to download.', 'done');
		} catch (err) {
			setStatus(err.message || 'Optimization failed.', 'error');
		} finally {
			setRunning(false);
		}
	}

	// ── Wiring ───────────────────────────────────────────────────────────────
	toggle.addEventListener('click', () => {
		const open = panel.dataset.open === 'true';
		panel.dataset.open = String(!open);
		toggle.setAttribute('aria-expanded', String(!open));
		if (!open) meshTools.activate();
	});

	modeGroup.addEventListener('click', (e) => {
		const btn = e.target.closest('button[data-mode]');
		if (btn) applyMode(btn.dataset.mode);
	});

	runBtn.addEventListener('click', run);

	// Pick up the live model whenever one is forged or loaded from the gallery.
	document.addEventListener('forge:model-ready', (e) => {
		const url = e.detail?.glbUrl;
		if (url) reset(url, e.detail?.label);
	});

	applyMode('quad');
}

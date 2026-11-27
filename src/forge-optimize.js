// Topology optimizer layered onto the forge result viewer.
//
// When a model becomes available (forge.js dispatches `forge:model-ready`),
// this panel lets the user produce game/animation-ready output from the live
// GLB via the real /api/forge-remesh route:
//   • triangle: attribute-safe decimation plus texture right-sizing, keeping
//                UVs, materials, texture and rig (api/_lib/glb-optimize.js)
//   • quad:     field-aligned quad-dominant retopology (QuadriFlow), clean
//                edge loops that deform well for rigging & animation
//   • lowpoly:  silhouette-preserving low-poly with the original texture
//                re-unwrapped + re-baked onto the new mesh
//
// Triangle mode on a GLB answers at once (the API optimizes it in-process and
// keeps the UVs, materials, texture and rig); it shows the before and after
// size, triangles and textures, or says the model is already light. The result
// never replaces the original on its own: Original / Optimized compares the two
// in the viewer, and only "Use optimized" points the page's download and later
// edits at the new file ("Back to original" undoes it). The opens-everywhere
// GLB is the default download; a meshopt or Draco variant is offered beside it
// and labelled with the extensions a reader needs.
//
// Quad and low-poly run on the worker and are polled; nothing fakes progress.
// Other formats are download-only.
//
// Above the server remesh sit the in-browser mesh tools (src/mesh-ops/): repair,
// smooth and decimate, run in a worker with undo and reset to original. Their
// edits swap the viewer and the download button just like a GLB remesh does;
// the server optimize still starts from the last saved (remote) model, because
// a local edit only exists as a blob in this tab.
//
// The panel injects its own markup + styles so it survives independently of the
// forge.html template: it only needs the result panel, viewer, and download
// button to be present.

import { mountMeshTools } from './mesh-ops/panel.js';
import { forgeCopyError, forgeErrorFromResponse, forgeErrorMessage, forgeJobFailedError } from './forge-errors.js';

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
			'Fewer triangles and right-sized textures, keeping the UVs, materials, texture and any rig. Never heavier than the original: a model that is already light is kept as it is.',
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

	// Who can open the file. The default needs no glTF extension at all.
	const COMPATIBILITY = [
		['none', 'Opens everywhere'],
		['meshopt', 'Smallest, web (needs meshopt + WebP)'],
		['draco', 'Small, Draco (needs Draco + WebP)'],
	];

	const FORMATS = [
		['glb', 'GLB'],
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
			.opt-result {
				display: flex; flex-direction: column; gap: var(--space-sm); padding: var(--space-sm) var(--space-md);
				background: var(--surface-1); border: 1px solid var(--stroke); border-radius: var(--radius-md);
				animation: opt-in 0.2s ease;
			}
			.opt-result[hidden] { display: none; }
			@keyframes opt-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
			.opt-compare-table { display: grid; grid-template-columns: auto 1fr 1fr; gap: 0.25rem var(--space-md); margin: 0; font-family: var(--font-mono); font-size: var(--text-xs); }
			.opt-compare-table dt { color: var(--ink-dim); }
			.opt-compare-table dd { margin: 0; color: var(--ink); }
			.opt-compare-table .opt-head { color: var(--ink-dim); text-transform: uppercase; letter-spacing: 0.04em; }
			.opt-compare-table .opt-gain { color: var(--success); }
			.opt-reason { margin: 0; font-size: var(--text-xs); color: var(--ink); line-height: 1.4; }
			.opt-notes { margin: 0; padding-left: 1.1em; font-size: var(--text-xs); color: var(--ink-dim); line-height: 1.4; }
			.opt-notes:empty { display: none; }
			.opt-keep { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-sm); }
			.opt-keep[hidden] { display: none; }
			.opt-link {
				font-family: var(--font-mono); font-size: var(--text-xs); color: var(--accent); text-decoration: none;
				border-radius: var(--radius-sm); padding: 0.2rem 0.1rem;
			}
			.opt-link:hover { text-decoration: underline; }
			.opt-link:active { opacity: 0.75; }
			.opt-link:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
			.opt-link[hidden] { display: none; }
			.opt-link small { color: var(--ink-dim); }
			.btn.opt-use[hidden], .btn.opt-revert[hidden] { display: none; }
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
			<p class="opt-section-title">Optimize on the server</p>
			<p class="opt-local-note" hidden>Server optimize starts from the saved model, not your in-browser edits. Download the edited GLB above to keep them.</p>
			<div class="opt-field">
				<span>Mode</span>
				<div class="seg opt-mode" role="group" aria-label="Remesh mode">
					<button type="button" data-mode="triangle" aria-pressed="true">Triangle</button>
					<button type="button" data-mode="quad" aria-pressed="false">Quad retopo</button>
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
				<label class="opt-field">
					<span>Texture</span>
					<select class="opt-select opt-texsize">
						<option value="512">512px</option>
						<option value="1024" selected>1024px</option>
						<option value="2048">2048px</option>
					</select>
				</label>
				<label class="opt-field opt-compat-field">
					<span>Compatibility</span>
					<select class="opt-select opt-compat"></select>
				</label>
			</div>
			<div class="opt-actions">
				<button class="btn opt-run" type="button"><span class="opt-run-label">Optimize</span></button>
				<span class="opt-status" role="status" aria-live="polite"></span>
			</div>
			<div class="opt-stats is-hidden"></div>
			<div class="opt-result" hidden>
				<div class="seg opt-compare" role="group" aria-label="Compare in the viewer">
					<button type="button" data-view="original" aria-pressed="false">Original</button>
					<button type="button" data-view="optimized" aria-pressed="true">Optimized</button>
				</div>
				<p class="opt-reason" hidden></p>
				<dl class="opt-compare-table"></dl>
				<ul class="opt-notes"></ul>
				<div class="opt-keep">
					<button class="btn opt-use" type="button">Use optimized</button>
					<button class="btn opt-revert" type="button" hidden>Back to original</button>
					<a class="opt-link opt-dl-universal" download>Download optimized GLB <small>(opens everywhere)</small></a>
					<a class="opt-link opt-dl-compressed" download hidden></a>
				</div>
			</div>
		</div>
	`;
	resultPanel.appendChild(panel);

	const toggle = panel.querySelector('.optimize-toggle');
	const modeGroup = panel.querySelector('.opt-mode');
	const modeHint = panel.querySelector('.opt-mode-hint');
	const targetSel = panel.querySelector('.opt-target');
	const targetLabel = panel.querySelector('.opt-target-label');
	const formatSel = panel.querySelector('.opt-format');
	const texsizeSel = panel.querySelector('.opt-texsize');
	const compatField = panel.querySelector('.opt-compat-field');
	const compatSel = panel.querySelector('.opt-compat');
	const resultBox = panel.querySelector('.opt-result');
	const compareGroup = panel.querySelector('.opt-compare');
	const reasonEl = panel.querySelector('.opt-reason');
	const compareTable = panel.querySelector('.opt-compare-table');
	const notesEl = panel.querySelector('.opt-notes');
	const keepRow = panel.querySelector('.opt-keep');
	const useBtn = panel.querySelector('.opt-use');
	const revertBtn = panel.querySelector('.opt-revert');
	const dlUniversal = panel.querySelector('.opt-dl-universal');
	const dlCompressed = panel.querySelector('.opt-dl-compressed');
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

	for (const [sel, list] of [[formatSel, FORMATS], [compatSel, COMPATIBILITY]]) {
		for (const [value, text] of list) {
			const opt = document.createElement('option');
			opt.value = value;
			opt.textContent = text;
			sel.appendChild(opt);
		}
	}

	const state = {
		glbUrl: null,
		// The model as the page first loaded it, so "Back to original" can return.
		sourceUrl: null,
		label: 'model',
		mode: 'triangle',
		running: false,
		pollAbort: false,
		// The last finished GLB result: { url, compressedUrl, requires, mode }.
		result: null,
		kept: false,
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
		syncCompat();
	}

	// A compressed variant exists only for a triangle GLB.
	function syncCompat() {
		compatField.classList.toggle('is-hidden', !(state.mode === 'triangle' && formatSel.value === 'glb'));
	}

	function reset(glbUrl, label) {
		state.glbUrl = glbUrl;
		state.sourceUrl = glbUrl;
		state.label = label || 'model';
		state.pollAbort = true; // cancel any in-flight poll for the previous model
		state.result = null;
		state.kept = false;
		setStatus('');
		stats.classList.add('is-hidden');
		stats.innerHTML = '';
		resultBox.hidden = true;
		// The source model is always the forged GLB, so restore the default label
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
				compression: state.mode === 'triangle' && formatSel.value === 'glb' ? compatSel.value : 'none',
			}),
		});
		const data = await res.json().catch(() => ({}));
		// The guards answer with structured fields; the page writes its own copy.
		if (data.error === 'mesh_too_large') {
			const limit = Number(data.limit_bytes) > 0 ? `${Math.round(data.limit_bytes / 1048576)} MB` : 'the size limit';
			throw forgeCopyError(
				'Model too large to optimize',
				`This model is larger than ${limit}. ${state.mode === 'triangle' ? 'Try Low-poly, which accepts larger files.' : 'Use a smaller file.'}`,
			);
		}
		if (data.error === 'rigged_model') {
			throw forgeCopyError(
				'This model is rigged',
				`${state.mode === 'quad' ? 'Quad retopology' : 'Low-poly'} rebuilds the surface and would drop the skeleton. Use Triangle, which keeps the rig and skin.`,
			);
		}
		if (res.status === 503 || data.error === 'unconfigured') {
			throw forgeErrorFromResponse(res.status, { ...data, error: 'unconfigured' });
		}
		if (res.status === 429 || data.error === 'rate_limited') {
			throw forgeErrorFromResponse(429, data);
		}
		if (!res.ok || !data.job_id) {
			throw forgeErrorFromResponse(res.status, res.ok ? { error: 'remesh_failed' } : data);
		}
		return data;
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
			if (data.status === 'failed') throw forgeJobFailedError(data.error, 'remesh_failed');
			setStatus(data.status === 'running' ? 'Optimizing topology…' : 'Queued…');
		}
		if (state.pollAbort) return null;
		throw forgeCopyError('Optimize is taking too long', 'Optimizing took too long and was stopped. Try again with a lower face target.');
	}

	const fmtBytes = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(2)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
	const fmtCount = (n) => Number(n).toLocaleString('en-US');
	function fmtTextures(list) {
		if (!Array.isArray(list)) return null;
		if (!list.length) return 'none';
		return list
			.map((t) => `${t.width && t.height ? `${Math.max(t.width, t.height)}px ` : ''}${String(t.mimeType || '').replace('image/', '').toUpperCase()}`)
			.join(', ');
	}

	function el(tag, cls, text) {
		const node = document.createElement(tag);
		if (cls) node.className = cls;
		if (text !== undefined) node.textContent = text;
		return node;
	}

	// Before / after rows. A row is shown only when both sides were measured.
	function renderCompare(before, after, data) {
		compareTable.replaceChildren();
		if (!before) return;
		const rows = [['', 'Before', after ? 'After' : '']];
		if (before.bytes) {
			const gain = after?.bytes ? Math.round((1 - after.bytes / before.bytes) * 100) : null;
			rows.push(['Size', fmtBytes(before.bytes), after?.bytes ? `${fmtBytes(after.bytes)}${gain > 0 ? ` (${gain}% smaller)` : ''}` : '']);
		}
		if (typeof before.triangles === 'number') {
			let afterFaces = '';
			if (after && typeof after.triangles === 'number') afterFaces = fmtCount(after.triangles);
			else if (!after && typeof data.face_count === 'number' && !data.noop) {
				afterFaces = `${fmtCount(data.face_count)} ${data.mode === 'quad' ? 'quads' : 'faces'}`;
			}
			rows.push(['Triangles', fmtCount(before.triangles), afterFaces]);
		}
		const tb = fmtTextures(before.textures);
		if (tb) rows.push(['Textures', tb, fmtTextures(after?.textures) || '']);
		if (before.skins) rows.push(['Rig', `${before.joints} bones`, after ? (after.skins ? `${after.joints} bones` : 'none') : '']);
		rows.forEach((cells, i) => {
			cells.forEach((text, c) => {
				const node = el(c === 0 ? 'dt' : 'dd', i === 0 ? 'opt-head' : '', text);
				if (i > 0 && c === 2 && /smaller/.test(text)) node.classList.add('opt-gain');
				compareTable.appendChild(node);
			});
		});
	}

	function showStats(data, format) {
		const parts = [];
		if (typeof data.quad_ratio === 'number' && data.quad_ratio > 0) {
			parts.push(`${Math.round(data.quad_ratio * 100)}% quad-dominant`);
		}
		if (data.textured === true && data.mode !== 'triangle') parts.push('texture re-baked');
		parts.push(format.toUpperCase());
		stats.replaceChildren(...parts.map((p) => el('span', '', p)));
		stats.classList.remove('is-hidden');
	}

	function setView(view) {
		for (const b of compareGroup.querySelectorAll('button')) {
			b.setAttribute('aria-pressed', String(b.dataset.view === view));
		}
		const url = view === 'optimized' && state.result ? state.result.url : state.sourceUrl;
		if (url && viewer.getAttribute('src') !== url) viewer.setAttribute('src', url);
	}

	const safeName = () =>
		state.label.replace(/[^a-z0-9]+/gi, '-').slice(0, 48).replace(/^-|-$/g, '') || 'forge';

	// "Use optimized": the optimized GLB becomes the page's model, for the
	// download button, the in-browser tools and any further optimize run.
	function keep(optimized) {
		if (!state.result) return;
		state.kept = optimized;
		const url = optimized ? state.result.url : state.sourceUrl;
		state.glbUrl = url;
		setView(optimized ? 'optimized' : 'original');
		pointDownload(url, `${safeName()}${optimized ? '-optimized' : ''}.glb`, 'Download GLB');
		originalDownload = null;
		localNote.hidden = true;
		meshTools.setSource(url, { label: optimized ? `${state.label} optimized` : state.label });
		useBtn.hidden = optimized;
		revertBtn.hidden = !optimized;
		setStatus(optimized ? 'Using the optimized model.' : 'Back to the original model.', 'done');
	}

	function showResult(data, format) {
		resultBox.hidden = false;
		notesEl.replaceChildren(...(data.notes || []).map((n) => el('li', '', n)));
		reasonEl.hidden = !data.noop;
		reasonEl.textContent = data.noop ? data.reason || 'This model is already light, so the original is kept.' : '';
		renderCompare(data.before, data.noop ? null : data.after, data);

		const glbResult = format === 'glb' && !data.noop;
		compareGroup.hidden = !glbResult;
		state.result = glbResult
			? { url: data.universal_url || data.result_url, compressedUrl: data.compressed_url || null, requires: data.requires || [] }
			: null;
		state.kept = false;
		useBtn.hidden = !glbResult;
		revertBtn.hidden = true;
		keepRow.hidden = data.noop;

		if (glbResult) {
			dlUniversal.href = state.result.url;
			dlUniversal.setAttribute('download', `${safeName()}-optimized.glb`);
			dlUniversal.replaceChildren('Download optimized GLB ', el('small', '', '(opens everywhere)'));
			dlCompressed.hidden = !state.result.compressedUrl;
			if (state.result.compressedUrl) {
				dlCompressed.href = state.result.compressedUrl;
				dlCompressed.setAttribute('download', `${safeName()}-${data.compression}.glb`);
				dlCompressed.replaceChildren(
					`Download ${data.compression === 'draco' ? 'Draco' : 'meshopt'} GLB `,
					el('small', '', `(needs ${state.result.requires.join(', ') || 'a compression-aware reader'})`),
				);
			}
			setView('optimized');
		} else if (!data.noop) {
			// Other formats are download-only and never touch the page's model.
			dlUniversal.href = data.result_url;
			dlUniversal.setAttribute('download', `${safeName()}-${data.mode || state.mode}.${format}`);
			dlUniversal.replaceChildren(`Download ${format.toUpperCase()}`);
			dlCompressed.hidden = true;
		}
		if (!data.noop) showStats(data, format);
	}

	async function run() {
		if (state.running || !state.glbUrl) return;
		state.pollAbort = false;
		setRunning(true);
		setStatus('Starting…');
		stats.classList.add('is-hidden');
		resultBox.hidden = true;
		const format = formatSel.value;
		try {
			const started = await startRemesh();
			// A triangle GLB optimize finishes inside the request.
			const done = started.status === 'done' ? started : await pollRemesh(started.job_id);
			if (!done) return; // superseded by a newer model / cancelled
			// The submit answer carries the measurements a worker poll does not.
			const merged = {
				...done,
				before: done.before || started.before,
				after: done.after || started.after,
				notes: [...new Set([...(started.notes || []), ...(done.notes || []), ...(started.optimize_notes || [])])],
				noop: Boolean(done.noop),
				mode: done.mode || started.remesh_mode || state.mode,
			};
			showResult(merged, format);
			setStatus(
				merged.noop ? 'Already light, nothing to do.' : format === 'glb' ? 'Done. Compare, then keep the version you want.' : `Done, ${format.toUpperCase()} ready to download.`,
				'done',
			);
		} catch (err) {
			setStatus(forgeErrorMessage(err, 'remesh_failed'), 'error');
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
	formatSel.addEventListener('change', syncCompat);
	compareGroup.addEventListener('click', (e) => {
		const btn = e.target.closest('button[data-view]');
		if (btn) setView(btn.dataset.view);
	});
	useBtn.addEventListener('click', () => keep(true));
	revertBtn.addEventListener('click', () => keep(false));

	// Pick up the live model whenever one is forged or loaded from the gallery.
	document.addEventListener('forge:model-ready', (e) => {
		const url = e.detail?.glbUrl;
		if (url) reset(url, e.detail?.label);
	});

	applyMode('triangle');
}

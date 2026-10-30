// Refine — local, instant mesh refinement layered onto the forge result viewer.
//
// Unlike Stylize (/api/forge-stylize) and Optimize (/api/forge-remesh), which
// dispatch jobs to GPU workers, Refine runs entirely in the browser: it parses
// the current GLB with three's GLTFLoader, runs deterministic geometry passes
// (weld / smooth normals / Laplacian relax / decimate / subdivide) from
// shared/mesh-refine.js, re-exports with GLTFExporter, and swaps the live
// <model-viewer> to the result. No worker, no API call, no rate limit — so it
// works on every deployment and never 429s, which makes it the dependable
// "improve this model" path when the paid generation lane is throttled.
//
// Non-destructive: the original GLB bytes are kept and every preset re-parses
// from them, so applying a different preset (or reverting) is always clean.
// Nothing fakes progress — the only timer is an honest elapsed counter, and the
// geometry work is real synchronous compute behind a busy indicator.

import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { getMeshoptDecoder } from '../viewer/internal.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { refineScene, REFINE_PRESETS, REFINE_PRESET_BY_KEY, specForPreset } from '../shared/mesh-refine.js';

const resultPanel = document.getElementById('state-result');
const viewer = document.getElementById('viewer');

if (resultPanel && viewer) {
	// Reuse the forge anonymous client id (set by forge.js) for the source fetch,
	// so a refine on a first-party CDN URL is attributed consistently. Harmless
	// if absent; blob: sources ignore it entirely.
	const CLIENT_HEADERS = (() => {
		try {
			const id = localStorage.getItem('forge:cid');
			return id ? { 'x-forge-client': id } : {};
		} catch {
			return {};
		}
	})();

	injectStyles();
	const { panel, gallery, controls, slider, sliderLabel, sliderVal, applyBtn, downloadBtn, revertBtn, stats, status } =
		injectPanel();

	const loader = new GLTFLoader();
	// three.ws GLBs may carry EXT_meshopt_compression — decoder required before load
	const meshoptReady = getMeshoptDecoder().then((d) => loader.setMeshoptDecoder(d));
	const exporter = new GLTFExporter();

	let sourceUrl = ''; // the GLB this panel is refining (the forge result)
	let sourceBytes = null; // ArrayBuffer of the original, kept for non-destructive re-runs
	let lastRefinedUrl = ''; // object URL we swapped in; lets the src observer skip our own swap
	let baseLabel = '';
	let activeKey = '';
	let runToken = 0; // bumped per apply/revert/new-source to abort stale work
	let elapsedTimer = null;
	let loadingBytes = false;

	const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

	function setStatus(text, kind = '') {
		status.textContent = text || '';
		status.dataset.kind = kind;
	}

	function stopElapsed() {
		if (elapsedTimer) {
			clearInterval(elapsedTimer);
			elapsedTimer = null;
		}
	}

	function startElapsed(label) {
		stopElapsed();
		const t0 = performance.now();
		const tick = () => setStatus(`${label} — ${Math.floor((performance.now() - t0) / 1000)}s`, 'busy');
		tick();
		elapsedTimer = setInterval(tick, 1000);
	}

	function setBusy(busy) {
		for (const card of gallery.querySelectorAll('.refine-card')) card.disabled = busy;
		applyBtn.disabled = busy;
		slider.disabled = busy;
		revertBtn.disabled = busy;
		panel.dataset.busy = busy ? 'true' : 'false';
	}

	function buildGallery() {
		gallery.innerHTML = '';
		for (const p of REFINE_PRESETS) {
			const card = document.createElement('button');
			card.type = 'button';
			card.className = 'refine-card';
			card.dataset.preset = p.key;
			card.setAttribute('aria-pressed', 'false');
			card.title = p.blurb;
			card.innerHTML =
				`<span class="refine-thumb" aria-hidden="true">${p.icon}</span>` +
				`<span class="refine-name">${p.name}</span>` +
				`<span class="refine-blurb">${p.blurb}</span>`;
			card.addEventListener('click', () => selectPreset(p.key, { apply: true }));
			gallery.appendChild(card);
		}
	}

	function markActive(key) {
		activeKey = key;
		for (const card of gallery.querySelectorAll('.refine-card')) {
			card.setAttribute('aria-pressed', String(card.dataset.preset === key));
		}
	}

	function syncSlider(key) {
		const spec = REFINE_PRESET_BY_KEY[key]?.slider;
		if (!spec) {
			controls.classList.add('no-slider');
			slider.disabled = true;
			sliderLabel.textContent = '';
			sliderVal.textContent = '';
			return;
		}
		controls.classList.remove('no-slider');
		slider.disabled = false;
		slider.min = String(spec.min);
		slider.max = String(spec.max);
		slider.step = '1';
		slider.value = String(spec.def);
		sliderLabel.textContent = spec.label;
		sliderVal.textContent = `${spec.def}${spec.unit || ''}`;
	}

	function selectPreset(key, { apply }) {
		if (!REFINE_PRESET_BY_KEY[key]) return;
		markActive(key);
		syncSlider(key);
		controls.classList.remove('is-hidden');
		if (apply) runRefine(key, Number(slider.value));
	}

	// Parse → refine → export, fully client-side. token guards against a newer
	// run (or a new source model) superseding this one mid-flight.
	async function runRefine(key, sliderValue) {
		if (!sourceUrl) return;
		const token = ++runToken;
		const preset = REFINE_PRESET_BY_KEY[key];
		const spec = specForPreset(key, sliderValue);
		setBusy(true);
		startElapsed(`Refining — ${preset.name}`);
		try {
			const bytes = await ensureSourceBytes();
			if (token !== runToken) return;
			if (!bytes) throw new Error('Could not read the model to refine.');

			await nextFrame(); // let the busy indicator paint before the sync work
			const gltf = await parseGlb(bytes);
			if (token !== runToken) return;

			await nextFrame();
			const { before, after } = await refineScene(gltf.scene, spec);

			const glb = await exportGlb(gltf.scene);
			if (token !== runToken) return;

			const blob = new Blob([glb], { type: 'model/gltf-binary' });
			const url = URL.createObjectURL(blob);
			swapViewer(url, `${baseLabel} — ${preset.name} refine`);

			downloadBtn.href = url;
			downloadBtn.setAttribute('download', `${slugLabel()}-${key}.glb`);
			downloadBtn.hidden = false;
			revertBtn.hidden = false;

			stopElapsed();
			renderStats(before, after, blob.size);
			setStatus(`${preset.name} applied — instant, on-device. Adjust and re-apply, or revert.`, 'done');
		} catch (err) {
			if (token !== runToken) return;
			stopElapsed();
			setBusy(false);
			setStatus(err?.message || 'Refinement failed. Try a different preset.', 'error');
			return;
		}
		if (token === runToken) setBusy(false);
	}

	function renderStats(before, after, byteSize) {
		const dTri = after.triangles - before.triangles;
		const pct = before.triangles > 0 ? Math.round((dTri / before.triangles) * 100) : 0;
		const arrow = dTri === 0 ? '·' : dTri > 0 ? '▲' : '▼';
		const triLine = `${fmt(before.triangles)} → ${fmt(after.triangles)} tris ${arrow}${pct ? ` ${Math.abs(pct)}%` : ''}`;
		stats.innerHTML =
			`<span class="refine-stat">${triLine}</span>` +
			`<span class="refine-stat">${fmt(after.vertices)} verts</span>` +
			`<span class="refine-stat">${fmtBytes(byteSize)}</span>`;
		stats.hidden = false;
	}

	function swapViewer(url, alt) {
		if (lastRefinedUrl && lastRefinedUrl !== sourceUrl) URL.revokeObjectURL(lastRefinedUrl);
		lastRefinedUrl = url;
		viewer.setAttribute('src', url);
		viewer.setAttribute('alt', alt);
	}

	function revert() {
		runToken++; // abort any in-flight refine
		stopElapsed();
		setBusy(false);
		if (lastRefinedUrl && lastRefinedUrl !== sourceUrl) {
			URL.revokeObjectURL(lastRefinedUrl);
			lastRefinedUrl = '';
		}
		viewer.setAttribute('src', sourceUrl);
		viewer.setAttribute('alt', baseLabel || '3D model');
		downloadBtn.hidden = true;
		revertBtn.hidden = true;
		stats.hidden = true;
		markActive('');
		setStatus('Showing the original model.', '');
	}

	// Fetch the source bytes once and cache them, so re-applying a preset or
	// switching presets never re-downloads. Both first-party URLs and blob: URLs
	// (a chained result from Stylize/Optimize) are fetchable here.
	async function ensureSourceBytes() {
		if (sourceBytes) return sourceBytes;
		if (loadingBytes) {
			// A concurrent call is already fetching — wait for it.
			while (loadingBytes) await new Promise((r) => setTimeout(r, 30));
			return sourceBytes;
		}
		loadingBytes = true;
		try {
			const res = await fetch(sourceUrl, { headers: CLIENT_HEADERS });
			if (!res.ok) throw new Error(`Couldn't load the model (${res.status}).`);
			sourceBytes = await res.arrayBuffer();
			return sourceBytes;
		} finally {
			loadingBytes = false;
		}
	}

	function parseGlb(arrayBuffer) {
		// Parse a *copy* of the buffer: GLTFLoader.parse can detach/consume the
		// ArrayBuffer, and we keep the original for every subsequent re-run.
		const copy = arrayBuffer.slice(0);
		return meshoptReady.then(() => new Promise((resolve, reject) => {
			loader.parse(copy, '', resolve, reject);
		}));
	}

	function exportGlb(scene) {
		return new Promise((resolve, reject) => {
			exporter.parse(scene, resolve, reject, { binary: true });
		});
	}

	function slugLabel() {
		return (baseLabel || 'forge').replace(/[^a-z0-9]+/gi, '-').slice(0, 40).replace(/^-|-$/g, '') || 'forge';
	}

	// A new source model became available — reset to the idle gallery for it.
	// Idempotent: re-firing with the current source (or our own refined swap) is
	// a no-op so the event and the src observer can both call it safely.
	function onNewSource(url, label) {
		if (!url || url === sourceUrl || url === lastRefinedUrl) return;
		runToken++;
		stopElapsed();
		sourceUrl = url;
		sourceBytes = null;
		lastRefinedUrl = '';
		baseLabel = label || '';
		markActive('');
		controls.classList.add('is-hidden');
		downloadBtn.hidden = true;
		revertBtn.hidden = true;
		stats.hidden = true;
		setBusy(false);
		setStatus('Pick a refinement to perfect this model — instant, on-device, unlimited.', '');
		panel.hidden = false;
	}

	// Wiring -------------------------------------------------------------------
	slider.addEventListener('input', () => {
		const spec = REFINE_PRESET_BY_KEY[activeKey]?.slider;
		sliderVal.textContent = `${slider.value}${spec?.unit || ''}`;
	});
	// Re-apply only when the user releases the slider, so dragging doesn't fire a
	// parse+export on every integer step.
	slider.addEventListener('change', () => {
		if (activeKey) runRefine(activeKey, Number(slider.value));
	});
	applyBtn.addEventListener('click', () => {
		if (activeKey) runRefine(activeKey, Number(slider.value));
	});
	revertBtn.addEventListener('click', revert);

	document.addEventListener('forge:model-ready', (e) => {
		onNewSource(e.detail?.glbUrl, e.detail?.label);
	});

	// External request (e.g. the rate-limit error CTA in forge.js) to surface and
	// focus this panel so the user can refine locally instead of waiting.
	document.addEventListener('forge:refine-here', () => {
		if (!sourceUrl) return;
		panel.hidden = false;
		panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
		gallery.querySelector('.refine-card')?.focus();
	});

	// Resilient fallback: watch the viewer src so the panel reveals on any model
	// load, even without the explicit event. Our own swaps are ignored.
	const srcObserver = new MutationObserver(() => {
		const url = viewer.getAttribute('src');
		if (!url || url === sourceUrl || url === lastRefinedUrl) return;
		onNewSource(url, document.getElementById('result-label')?.textContent?.trim() || '');
	});
	srcObserver.observe(viewer, { attributes: true, attributeFilter: ['src'] });

	if (viewer.getAttribute('src')) {
		onNewSource(viewer.getAttribute('src'), document.getElementById('result-label')?.textContent?.trim() || '');
	}

	buildGallery();

	// ── markup + styles (self-contained so the panel survives template edits) ──

	function injectPanel() {
		const el = document.createElement('div');
		el.className = 'refine-panel';
		el.id = 'refine-panel';
		el.dataset.busy = 'false';
		el.hidden = true;
		el.innerHTML = `
			<div class="refine-head">
				<h3>Refine <span class="refine-badge">Instant · on-device · free</span></h3>
				<p class="refine-sub">
					Perfect the model you already have — no re-generation, no waiting, no limits.
					Every preset runs in your browser on the live mesh.
				</p>
			</div>
			<div class="refine-gallery" id="refine-gallery" role="group" aria-label="Refinement presets"></div>
			<div class="refine-controls is-hidden" id="refine-controls">
				<div class="refine-slider">
					<label id="refine-slider-label" for="refine-slider"></label>
					<input type="range" id="refine-slider" min="1" max="8" value="3" />
					<output id="refine-slider-val" for="refine-slider"></output>
				</div>
				<div class="refine-actions">
					<button class="btn btn-ghost" type="button" id="refine-apply">Re-apply</button>
					<a class="btn btn-ghost" id="refine-download" download hidden>Download refined GLB</a>
					<button class="btn btn-ghost" type="button" id="refine-revert" hidden>Revert to original</button>
				</div>
			</div>
			<div class="refine-stats" id="refine-stats" hidden></div>
			<div class="refine-status" id="refine-status" role="status" aria-live="polite"></div>
		`;
		// Place directly after the Stylize panel when present, else at panel end,
		// so the three "improve this model" surfaces sit together.
		const anchor = document.getElementById('stylize-panel');
		if (anchor && anchor.parentElement === resultPanel) anchor.after(el);
		else resultPanel.appendChild(el);
		return {
			panel: el,
			gallery: el.querySelector('#refine-gallery'),
			controls: el.querySelector('#refine-controls'),
			slider: el.querySelector('#refine-slider'),
			sliderLabel: el.querySelector('#refine-slider-label'),
			sliderVal: el.querySelector('#refine-slider-val'),
			applyBtn: el.querySelector('#refine-apply'),
			downloadBtn: el.querySelector('#refine-download'),
			revertBtn: el.querySelector('#refine-revert'),
			stats: el.querySelector('#refine-stats'),
			status: el.querySelector('#refine-status'),
		};
	}

	function injectStyles() {
		if (document.getElementById('refine-panel-styles')) return;
		const style = document.createElement('style');
		style.id = 'refine-panel-styles';
		style.textContent = `
			.refine-panel { margin-top: var(--space-lg, 24px); padding-top: var(--space-md, 16px); border-top: 1px solid var(--stroke, rgba(255,255,255,.08)); }
			.refine-head h3 { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin:0 0 4px; font-family: var(--font-display, inherit); font-size: var(--text-lg, 1.1rem); color: var(--ink, #fff); }
			.refine-badge { font-family: var(--font-mono, monospace); font-size: 10px; letter-spacing:.04em; text-transform:uppercase; color: var(--accent, #7c9cff); background: var(--accent-soft, rgba(124,156,255,.12)); border:1px solid var(--stroke, rgba(255,255,255,.1)); border-radius: 999px; padding: 2px 8px; }
			.refine-sub { margin:0 0 var(--space-md,16px); font-size: var(--text-sm, .85rem); color: var(--ink-dim, #9aa); line-height: var(--leading-normal, 1.5); max-width: 56ch; }
			.refine-gallery { display:grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: var(--space-sm, 10px); }
			.refine-card { display:flex; flex-direction:column; align-items:flex-start; gap:4px; text-align:left; padding: var(--space-sm,10px) var(--space-md,14px); background: var(--surface-1, rgba(255,255,255,.03)); border:1px solid var(--stroke, rgba(255,255,255,.1)); border-radius: var(--radius-md, 10px); color: var(--ink, #fff); cursor:pointer; transition: border-color .15s, background .15s, transform .1s; }
			.refine-card:hover { border-color: var(--stroke-strong, rgba(255,255,255,.25)); background: var(--surface-2, rgba(255,255,255,.05)); }
			.refine-card:active { transform: translateY(1px); }
			.refine-card:focus-visible { outline: 2px solid var(--accent, #7c9cff); outline-offset: 2px; }
			.refine-card[aria-pressed="true"] { border-color: var(--accent, #7c9cff); background: var(--accent-soft, rgba(124,156,255,.12)); }
			.refine-card:disabled { opacity:.5; cursor: progress; }
			.refine-thumb { font-size: 18px; line-height:1; color: var(--accent, #7c9cff); }
			.refine-name { font-weight:600; font-size: var(--text-sm, .9rem); }
			.refine-blurb { font-size: var(--text-xs, .72rem); color: var(--ink-dim, #9aa); line-height:1.4; }
			.refine-controls { margin-top: var(--space-md,16px); display:flex; flex-direction:column; gap: var(--space-sm,10px); }
			.refine-controls.no-slider .refine-slider { display:none; }
			.refine-slider { display:flex; align-items:center; gap: var(--space-sm,10px); }
			.refine-slider label { font-size: var(--text-xs,.72rem); color: var(--ink-dim,#9aa); min-width: 110px; }
			.refine-slider input[type=range] { flex:1; accent-color: var(--accent, #7c9cff); }
			.refine-slider output { font-family: var(--font-mono, monospace); font-size: var(--text-xs,.72rem); color: var(--ink,#fff); min-width: 40px; text-align:right; }
			.refine-actions { display:flex; flex-wrap:wrap; gap: var(--space-sm,8px); }
			.refine-stats { display:flex; flex-wrap:wrap; gap: var(--space-sm,10px); margin-top: var(--space-sm,10px); }
			.refine-stat { font-family: var(--font-mono, monospace); font-size: var(--text-xs,.72rem); color: var(--ink-dim,#9aa); background: var(--surface-1, rgba(255,255,255,.03)); border:1px solid var(--stroke, rgba(255,255,255,.08)); border-radius: var(--radius-sm,6px); padding: 3px 8px; }
			.refine-status { margin-top: var(--space-sm,10px); font-size: var(--text-xs,.72rem); min-height: 1.2em; color: var(--ink-dim,#9aa); }
			.refine-status[data-kind="busy"] { color: var(--accent, #7c9cff); }
			.refine-status[data-kind="done"] { color: var(--success, #5fd38a); }
			.refine-status[data-kind="error"] { color: var(--danger, #ff6b6b); }
			@media (prefers-reduced-motion: reduce) { .refine-card { transition: none; } }
		`;
		document.head.appendChild(style);
	}

	function fmt(n) {
		return Number(n || 0).toLocaleString();
	}
	function fmtBytes(b) {
		if (!b) return '—';
		if (b < 1024) return `${b} B`;
		if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
		return `${(b / (1024 * 1024)).toFixed(2)} MB`;
	}
}

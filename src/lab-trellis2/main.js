// TRELLIS.2 lab page controller.
//
// One photo, the full TRELLIS.2 parameter set, a real run on the forge with
// honest queued / running status, and an inspector that reads the mesh stats
// from the GLB itself. An optional second lane runs the same photo in parallel;
// once both finish the URL becomes ?a=<creation>&b=<creation>, which reloads
// the pair from the public creation records with their measured times.

import benchmark from '../../data/trellis2-benchmark.json';
import {
	DEFAULT_SEED,
	GUIDANCE_RANGE,
	PARAM_HELP,
	POLY_RANGE,
	PRESETS,
	RESOLUTIONS,
	RESOLUTION_DEFAULTS,
	SEED_MAX,
	STAGES,
	STEPS_RANGE,
	TEXTURE_SIZES,
	applyPreset,
	buildLaneBody,
	buildTrellis2Body,
	compareQuery,
	defaultState,
	formatBytes,
	formatCount,
	formatSeconds,
	matchPreset,
	parseCompareQuery,
	presetSpeed,
} from './params.js';
import { LabError, loadCommunityPhotos, loadCreation, loadLanes, runJob, uploadImage } from './client.js';
import { $, el, fill } from './dom.js';


const app = {
	state: defaultState(),
	imageUrl: null,
	lanes: [],
	trellis: null,
	running: false,
	abort: null,
	mode: 'texture',
	panes: {},
	viewerModule: null,
	results: { a: null, b: null },
};

// ── Viewer (three.js loads only when a model is about to show) ──────────────

async function viewerFor(paneId) {
	const pane = app.panes[paneId];
	if (pane.viewer) return pane.viewer;
	app.viewerModule ||= import('./viewer.js');
	const { LabViewer } = await app.viewerModule;
	pane.viewer = new LabViewer($('.lt-stage', pane.root));
	pane.viewer.setMode(app.mode);
	return pane.viewer;
}

// ── Lane status ──────────────────────────────────────────────────────────────

function setLaneStatus(kind, text) {
	const box = $('#lt-lane');
	box.dataset.state = kind;
	$('.lt-lane-text', box).textContent = text;
}

function laneRunnable(l) {
	return l.configured && !l.needsKey && l.health !== 'down' && l.health !== 'unconfigured';
}

async function initLanes() {
	try {
		app.lanes = await loadLanes();
	} catch (err) {
		setLaneStatus('down', err.message);
		showBanner(`${err.message} Reload the page to retry.`, { retry: () => location.reload() });
		updateGo();
		return;
	}
	app.trellis = app.lanes.find((l) => l.id === 'trellis2') || null;
	const t = app.trellis;
	if (!t) setLaneStatus('down', 'This deployment does not list TRELLIS.2 as an engine.');
	else if (!t.configured || t.health === 'unconfigured') setLaneStatus('down', 'TRELLIS.2 worker is not connected on this deployment yet. Shared results still open below.');
	else if (t.health === 'down') setLaneStatus('down', `TRELLIS.2 worker is unreachable${t.healthMessage ? `: ${t.healthMessage}` : ''}.`);
	else if (t.health === 'degraded') setLaneStatus('warn', 'TRELLIS.2 worker is up but slow to answer. Runs may queue for a GPU.');
	else setLaneStatus('ok', 'TRELLIS.2 worker online. Scales from zero, so the first run can wait for a GPU.');

	const sel = $('#lt-compare');
	for (const l of app.lanes) {
		if (l.id === 'trellis2') continue;
		const ok = laneRunnable(l);
		const why = l.needsKey ? ' (needs your own key)' : !l.configured ? ' (not configured)' : l.health === 'down' ? ' (down)' : '';
		sel.append(el('option', { value: l.id, disabled: !ok }, `${l.label}${why}`));
	}
	updateGo();
}

// ── Banner ───────────────────────────────────────────────────────────────────

function showBanner(message, { retry, action } = {}) {
	const b = $('#lt-banner');
	fill(b, el('span', { text: message }));
	if (action?.href) b.append(el('a', { class: 'lt-btn lt-btn-ghost', href: action.href }, action.label));
	if (retry) b.append(el('button', { type: 'button', class: 'lt-btn lt-btn-ghost', onclick: () => { hideBanner(); retry(); } }, 'Retry'));
	b.hidden = false;
}

function hideBanner() {
	$('#lt-banner').hidden = true;
}

// ── Photo input ──────────────────────────────────────────────────────────────

function setPhoto(url) {
	app.imageUrl = url;
	const img = $('#lt-photo');
	img.src = url;
	img.alt = 'Selected input photo';
	img.hidden = false;
	$('#lt-drop-empty').hidden = true;
	for (const b of document.querySelectorAll('.lt-pick')) b.setAttribute('aria-pressed', String(b.dataset.url === url));
	updateGo();
}

async function handleFile(file) {
	if (!file) return;
	const busy = $('#lt-drop-busy');
	busy.hidden = false;
	$('#lt-drop').setAttribute('aria-busy', 'true');
	try {
		const { url } = await uploadImage(file);
		hideBanner();
		setPhoto(url);
	} catch (err) {
		showBanner(err.message || 'The photo did not upload.', { retry: () => handleFile(file) });
	} finally {
		busy.hidden = true;
		$('#lt-drop').removeAttribute('aria-busy');
	}
}

function initDrop() {
	const drop = $('#lt-drop');
	const input = $('#lt-file');
	drop.addEventListener('click', (e) => {
		if (e.target !== input) input.click();
	});
	drop.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			input.click();
		}
	});
	input.addEventListener('change', () => {
		handleFile(input.files?.[0]);
		input.value = '';
	});
	drop.addEventListener('dragover', (e) => {
		e.preventDefault();
		drop.classList.add('is-over');
	});
	drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
	drop.addEventListener('drop', (e) => {
		e.preventDefault();
		drop.classList.remove('is-over');
		handleFile(e.dataTransfer?.files?.[0]);
	});
	document.addEventListener('paste', (e) => {
		const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith('image/'));
		if (file) handleFile(file);
	});
}

async function initPicks() {
	const box = $('#lt-picks');
	try {
		const photos = await loadCommunityPhotos({ limit: 8 });
		if (!photos.length) {
			fill(box, el('p', { class: 'lt-help', text: 'No community photos yet. Upload your own above to start.' }));
			return;
		}
		fill(box,
			...photos.map((p) =>
				el(
					'button',
					{ type: 'button', class: 'lt-pick', role: 'listitem', 'aria-pressed': 'false', 'data-url': p.url, title: p.label, onclick: () => setPhoto(p.url) },
					el('img', { src: p.url, alt: p.label, loading: 'lazy', decoding: 'async' }),
				),
			),
		);
	} catch (err) {
		fill(box,
			el('p', { class: 'lt-help', text: `${err.message} ` }, el('button', { type: 'button', class: 'lt-link', onclick: () => initPicks() }, 'Retry')),
		);
	}
}

// ── Presets and parameters ───────────────────────────────────────────────────

function renderPresets() {
	const box = $('#lt-presets');
	const active = matchPreset(app.state);
	fill(box,
		...PRESETS.map((p) => {
			const speed = presetSpeed(benchmark, p.id);
			return el(
				'button',
				{
					type: 'button',
					role: 'radio',
					class: 'lt-preset',
					'aria-checked': String(active === p.id),
					onclick: () => {
						app.state = applyPreset(p.id);
						syncForm();
					},
				},
				el('strong', { text: p.label }),
				el('span', { class: 'lt-preset-sum', text: p.summary }),
				el('span', { class: `lt-preset-speed${speed.measured ? '' : ' is-unmeasured'}`, title: speed.detail, text: speed.label }),
			);
		}),
	);
}

function renderResolution() {
	const box = $('#lt-resolution');
	fill(box,
		...RESOLUTIONS.map((r) =>
			el(
				'button',
				{
					type: 'button',
					role: 'radio',
					'aria-checked': String(app.state.resolution === r),
					onclick: () => {
						app.state.resolution = r;
						syncForm();
					},
				},
				String(r),
			),
		),
	);
}

function renderTextureOptions() {
	const sel = $('#lt-texture');
	const def = RESOLUTION_DEFAULTS[app.state.resolution].texture_size;
	fill(sel,
		el('option', { value: '' }, `Resolution default (${def} px)`),
		...TEXTURE_SIZES.map((t) => el('option', { value: String(t) }, `${t} px`)),
	);
	sel.value = app.state.textureSize ? String(app.state.textureSize) : '';
}

function renderStages() {
	const fs = $('#lt-stages');
	for (const old of fs.querySelectorAll('.lt-stage-block')) old.remove();
	for (const stage of STAGES) {
		const cur = app.state.sampler[stage.id];
		const stepsId = `lt-${stage.id}-steps`;
		const guideId = `lt-${stage.id}-guidance`;
		const block = el(
			'div',
			{ class: 'lt-stage-block' },
			el('h3', { text: stage.label }),
			el('p', { class: 'lt-help', text: stage.help }),
			el(
				'div',
				{ class: 'lt-slider' },
				el('label', { for: stepsId }, 'Steps ', el('span', { class: 'lt-default', text: `default ${stage.defaults.steps}` })),
				el('input', { type: 'range', id: stepsId, min: STEPS_RANGE[0], max: STEPS_RANGE[1], step: 1, value: cur.steps, 'data-stage': stage.id, 'data-key': 'steps', title: PARAM_HELP.steps }),
				el('output', { for: stepsId, text: String(cur.steps) }),
			),
			el(
				'div',
				{ class: 'lt-slider' },
				el('label', { for: guideId }, 'Guidance ', el('span', { class: 'lt-default', text: `default ${stage.defaults.guidance_strength.toFixed(1)}` })),
				el('input', { type: 'range', id: guideId, min: GUIDANCE_RANGE[0], max: GUIDANCE_RANGE[1], step: 0.1, value: cur.guidance_strength, 'data-stage': stage.id, 'data-key': 'guidance_strength', title: PARAM_HELP.guidance }),
				el('output', { for: guideId, text: cur.guidance_strength.toFixed(1) }),
			),
		);
		fs.append(block);
	}
}

function syncForm() {
	renderPresets();
	renderResolution();
	renderTextureOptions();
	renderStages();
	$('#lt-seed').value = String(app.state.seed);
	const faces = $('#lt-faces');
	const mode = $('#lt-faces-mode');
	const def = RESOLUTION_DEFAULTS[app.state.resolution].faces;
	mode.options[0].textContent = `Resolution default (${formatCount(def)})`;
	mode.value = app.state.faces == null ? 'default' : 'custom';
	faces.hidden = app.state.faces == null;
	if (app.state.faces != null) faces.value = String(app.state.faces);
}

function initParams() {
	for (const p of document.querySelectorAll('[data-help]')) p.textContent = PARAM_HELP[p.dataset.help] || '';
	$('#lt-params').addEventListener('submit', (e) => e.preventDefault());
	$('#lt-seed').addEventListener('change', (e) => {
		const v = Math.round(Number(e.target.value));
		app.state.seed = Number.isFinite(v) ? Math.min(SEED_MAX, Math.max(0, v)) : DEFAULT_SEED;
		e.target.value = String(app.state.seed);
		renderPresets();
	});
	$('#lt-seed-random').addEventListener('click', () => {
		const buf = new Uint32Array(1);
		crypto.getRandomValues(buf);
		app.state.seed = buf[0];
		$('#lt-seed').value = String(app.state.seed);
		renderPresets();
	});
	$('#lt-texture').addEventListener('change', (e) => {
		app.state.textureSize = e.target.value ? Number(e.target.value) : null;
		renderPresets();
	});
	$('#lt-faces-mode').addEventListener('change', (e) => {
		if (e.target.value === 'default') app.state.faces = null;
		else app.state.faces = Math.min(POLY_RANGE[1], RESOLUTION_DEFAULTS[app.state.resolution].faces);
		syncForm();
		if (app.state.faces != null) $('#lt-faces').focus();
	});
	$('#lt-faces').addEventListener('change', (e) => {
		const v = Math.round(Number(e.target.value));
		app.state.faces = Number.isFinite(v) ? Math.min(POLY_RANGE[1], Math.max(POLY_RANGE[0], v)) : POLY_RANGE[1];
		e.target.value = String(app.state.faces);
		renderPresets();
	});
	$('#lt-stages').addEventListener('input', (e) => {
		const t = e.target;
		if (!t.dataset?.stage) return;
		const v = Number(t.value);
		app.state.sampler[t.dataset.stage][t.dataset.key] = v;
		const out = t.nextElementSibling;
		if (out) out.textContent = t.dataset.key === 'steps' ? String(v) : v.toFixed(1);
		renderPresets();
	});
	$('#lt-reset').addEventListener('click', () => {
		const { resolution, seed } = app.state;
		app.state = { ...defaultState(), resolution, seed };
		syncForm();
	});
	syncForm();
}

// ── Generate ─────────────────────────────────────────────────────────────────

function goBlocker() {
	if (app.running) return null;
	if (!app.trellis) return app.lanes.length ? 'TRELLIS.2 is not available on this deployment.' : 'Checking which engines are available.';
	if (!laneRunnable(app.trellis)) return 'The TRELLIS.2 worker is not connected here, so runs are paused. Shared results still load.';
	if (!app.imageUrl) return 'Upload or pick a photo first.';
	return null;
}

function updateGo() {
	const go = $('#lt-go');
	const why = goBlocker();
	go.disabled = !app.running && why != null;
	go.textContent = app.running ? 'Cancel' : 'Generate';
	go.classList.toggle('is-cancel', app.running);
	$('#lt-go-hint').textContent = app.running ? 'Running. Cancel stops watching; a started GPU job still finishes on the server.' : why || `Ready. ${navigator.platform?.includes('Mac') ? 'Cmd' : 'Ctrl'}+Enter also runs.`;
}

function paneState(paneId, kind, payload = {}) {
	const pane = app.panes[paneId];
	const root = pane.root;
	const empty = $('.lt-stage-empty', root);
	const progress = $('.lt-stage-progress', root);
	const error = $('.lt-stage-error', root);
	empty.hidden = kind !== 'empty';
	progress.hidden = kind !== 'progress';
	error.hidden = kind !== 'error';
	root.dataset.state = kind;
	if (kind === 'progress') {
		const { phase, elapsed, eta, backend } = payload;
		const label = phase === 'submitting' ? 'Submitting' : phase === 'queued' ? 'Queued for a GPU' : phase === 'loading' ? 'Loading the mesh' : 'Generating';
		const etaText = eta && elapsed < eta ? `, about ${formatSeconds(Math.max(0, eta - elapsed))} left by the engine's estimate` : '';
		fill(progress,
			el('span', { class: 'lt-spinner', 'aria-hidden': 'true' }),
			el('strong', { text: label }),
			el('span', { text: phase === 'submitting' || phase === 'loading' ? '' : `${formatSeconds(elapsed || 0)} elapsed${etaText}` }),
			backend ? el('span', { class: 'lt-help', text: `Lane: ${laneLabel(backend)}` }) : null,
		);
	} else if (kind === 'error') {
		const { error: err, retry } = payload;
		fill(error,
			el('strong', { text: 'This run did not finish' }),
			el('span', { text: err.message }),
			err.action?.href ? el('a', { class: 'lt-btn lt-btn-ghost', href: err.action.href }, err.action.label) : null,
			retry ? el('button', { type: 'button', class: 'lt-btn lt-btn-ghost', onclick: retry }, 'Retry') : null,
		);
	}
}

function laneLabel(id) {
	return app.lanes.find((l) => l.id === id)?.label || id;
}

function renderStats(paneId, rows) {
	const dl = $('.lt-stats', app.panes[paneId].root);
	fill(dl, ...rows.flatMap(([k, v, title]) => [el('dt', { text: k }), el('dd', { text: v, title })]));
	dl.hidden = false;
}

async function showResult(paneId, { glbUrl, creationId, backend, requested, timing }) {
	const pane = app.panes[paneId];
	paneState(paneId, 'progress', { phase: 'loading', backend });
	const viewer = await viewerFor(paneId);
	const { stats, bytes, blobUrl } = await viewer.load(glbUrl);
	$('.lt-stage-empty', pane.root).hidden = true;
	$('.lt-stage-progress', pane.root).hidden = true;
	pane.root.dataset.state = 'done';
	const served = $('.lt-served', pane.root);
	served.textContent = backend ? laneLabel(backend) : '';
	served.classList.toggle('is-swapped', Boolean(requested && backend && requested !== backend));
	if (requested && backend && requested !== backend) {
		served.textContent = `${laneLabel(backend)} served (asked for ${laneLabel(requested)})`;
		served.title = 'The forge failed over to another engine for this run, so these numbers are for that engine.';
	}
	const tex = stats.maxTexture ? `${stats.maxTexture.w} x ${stats.maxTexture.h}` : 'none';
	const rows = [
		['Triangles', formatCount(stats.triangles)],
		['Vertices', formatCount(stats.vertices)],
		['Texture', `${tex}${stats.textureCount > 1 ? ` (${stats.textureCount} maps)` : ''}`],
		['File size', formatBytes(bytes)],
	];
	for (const row of timing) rows.push(row);
	renderStats(paneId, rows);
	const actions = $('.lt-pane-actions', pane.root);
	$('.lt-download', actions).href = blobUrl;
	const open = $('.lt-open', actions);
	open.hidden = !creationId;
	if (creationId) open.href = `/forge/share/${encodeURIComponent(creationId)}`;
	actions.hidden = false;
	app.results[paneId] = { creationId, backend };
	updateShare();
}

function timingFromRun(run) {
	const rows = [['Wall time', formatSeconds(run.wallSeconds), 'Measured in this browser from submit to result.']];
	const ws = run.workerStats;
	if (ws && Number.isFinite(ws.queue_ms)) rows.push(['Worker queue', formatSeconds(ws.queue_ms / 1000), 'Measured by the GPU worker: time waiting for the GPU.']);
	if (ws && Number.isFinite(ws.gpu_ms)) rows.push(['GPU time', formatSeconds(ws.gpu_ms / 1000), 'Measured by the GPU worker: generation plus GLB export.']);
	if (ws?.resolution_served || ws?.resolution) rows.push(['Voxel grid', String(ws.resolution_served || ws.resolution)]);
	if (run.jobId) rows.push(['Job', run.jobId.length > 18 ? `${run.jobId.slice(0, 18)}...` : run.jobId, run.jobId]);
	return rows;
}

function timingFromCreation(c) {
	const rows = [];
	if (c.completed_at && c.created_at) {
		const s = (Date.parse(c.completed_at) - Date.parse(c.created_at)) / 1000;
		if (Number.isFinite(s) && s >= 0) rows.push(['End to end', formatSeconds(s), 'Recorded by the forge: created to completed.']);
	}
	if (rows.length === 0) rows.push(['End to end', 'not measured', 'This lane did not record a completion time.']);
	if (Number.isFinite(c.queue_ms)) rows.push(['Worker queue', formatSeconds(c.queue_ms / 1000)]);
	if (Number.isFinite(c.gpu_ms)) rows.push(['GPU time', formatSeconds(c.gpu_ms / 1000)]);
	if (c.voxel_resolution) rows.push(['Voxel grid', String(c.voxel_resolution)]);
	return rows;
}

async function runLane(paneId, body, signal) {
	try {
		const run = await runJob(body, { signal, onProgress: (p) => paneState(paneId, 'progress', p) });
		await showResult(paneId, { glbUrl: run.glbUrl, creationId: run.creationId, backend: run.backend, requested: body.backend, timing: timingFromRun(run) });
		return run;
	} catch (err) {
		if (err?.name === 'AbortError') {
			paneState(paneId, 'error', { error: new LabError('Cancelled. The page stopped watching this run.'), retry: null });
			return null;
		}
		paneState(paneId, 'error', { error: err instanceof LabError ? err : new LabError(err?.message || 'The model did not load.'), retry: () => generate() });
		return null;
	}
}

async function generate() {
	if (app.running) {
		app.abort?.abort();
		return;
	}
	if (goBlocker()) return;
	hideBanner();
	app.running = true;
	app.abort = new AbortController();
	app.results = { a: null, b: null };
	updateShare();
	updateGo();
	const compare = $('#lt-compare').value;
	const paneB = app.panes.b.root;
	paneB.hidden = !compare;
	if (compare) $('h3', paneB).textContent = laneLabel(compare);
	const jobs = [runLane('a', buildTrellis2Body(app.state, app.imageUrl), app.abort.signal)];
	if (compare) jobs.push(runLane('b', buildLaneBody(compare, app.imageUrl), app.abort.signal));
	await Promise.all(jobs);
	app.running = false;
	app.abort = null;
	updateGo();
}

// ── Share link ───────────────────────────────────────────────────────────────

function updateShare() {
	const a = app.results.a?.creationId;
	const b = app.results.b?.creationId;
	const btn = $('#lt-share');
	btn.hidden = !a;
	const q = compareQuery(a, b);
	history.replaceState(null, '', q ? `${location.pathname}?${q}` : location.pathname);
}

async function copyShare() {
	const btn = $('#lt-share');
	try {
		await navigator.clipboard.writeText(location.href);
		btn.textContent = 'Link copied';
	} catch {
		btn.textContent = 'Copy the address bar';
	}
	setTimeout(() => (btn.textContent = 'Copy share link'), 1800);
}

async function loadShared() {
	const { a, b } = parseCompareQuery(location.search);
	if (!a && !b) return;
	app.panes.b.root.hidden = !b;
	const one = async (paneId, id) => {
		if (!id) return;
		paneState(paneId, 'progress', { phase: 'loading' });
		try {
			const c = await loadCreation(id);
			if (!c?.glb_url) throw new LabError('That shared model is no longer available.');
			$('h3', app.panes[paneId].root).textContent = paneId === 'a' ? 'Run A' : 'Run B';
			if (c.preview_image_url && paneId === 'a') setPhoto(c.preview_image_url);
			await showResult(paneId, { glbUrl: c.glb_url, creationId: c.id, backend: c.backend, timing: timingFromCreation(c) });
		} catch (err) {
			paneState(paneId, 'error', { error: err instanceof LabError ? err : new LabError(err?.message || 'The shared model did not load.'), retry: () => one(paneId, id) });
		}
	};
	await Promise.all([one('a', a), one('b', b)]);
}

// ── Benchmark table ──────────────────────────────────────────────────────────

function cell(dist, fmt) {
	return dist && typeof dist === 'object' ? fmt(dist) : 'not measured';
}

function renderBenchmark() {
	const w = benchmark.window || {};
	const day = (iso) => (iso ? new Date(iso).toISOString().slice(0, 10) : '?');
	$('#lt-bench-meta').textContent = `${formatCount(benchmark.row_count)} forge runs from ${day(w.from)} to ${day(w.to)}. TRELLIS.2 rows in the window: ${formatCount(benchmark.trellis2_rows)}. Generated ${day(benchmark.generated_at)}.`;
	const tbody = $('#lt-bench-table tbody');
	const lanes = (benchmark.lanes || []).filter((l) => l.lane !== 'unrecorded');
	if (!lanes.length) {
		fill(tbody, el('tr', {}, el('td', { colspan: 6, text: 'No production runs in the benchmark window yet.' })));
		return;
	}
	fill(tbody,
		...lanes.map((l) =>
			el(
				'tr',
				{ class: l.lane === 'trellis2' ? 'is-highlight' : null },
				el('th', { scope: 'row', text: laneLabel(l.lane) }),
				el('td', { text: formatCount(l.rows) }),
				el('td', { text: typeof l.failure_rate === 'number' ? `${(l.failure_rate * 100).toFixed(1)}%` : 'not measured' }),
				el('td', { text: cell(l.e2e_seconds, (d) => `${formatSeconds(d.p50)} / ${formatSeconds(d.p90)} / ${formatSeconds(d.p99)}`) }),
				el('td', { text: cell(l.gpu_seconds, (d) => formatSeconds(d.p50)) }),
				el('td', { text: cell(l.output_bytes, (d) => formatBytes(d.p50)) }),
			),
		),
	);
}

// ── Boot ─────────────────────────────────────────────────────────────────────

function initModes() {
	const group = $('#lt-modes');
	group.addEventListener('click', (e) => {
		const btn = e.target.closest('[data-mode]');
		if (!btn) return;
		app.mode = btn.dataset.mode;
		for (const b of group.querySelectorAll('[data-mode]')) b.setAttribute('aria-checked', String(b === btn));
		for (const pane of Object.values(app.panes)) pane.viewer?.setMode(app.mode);
	});
}

function initCite() {
	$('#lt-cite-copy').addEventListener('click', async (e) => {
		const btn = e.currentTarget;
		try {
			await navigator.clipboard.writeText($('#lt-bibtex').textContent);
			btn.textContent = 'Copied';
		} catch {
			btn.textContent = 'Select and copy above';
		}
		setTimeout(() => (btn.textContent = 'Copy BibTeX'), 1800);
	});
}

function boot() {
	for (const root of document.querySelectorAll('.lt-pane')) app.panes[root.dataset.pane] = { root, viewer: null };
	initDrop();
	initParams();
	initModes();
	initCite();
	$('#lt-go').addEventListener('click', generate);
	$('#lt-share').addEventListener('click', copyShare);
	document.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !$('#lt-go').disabled) {
			e.preventDefault();
			generate();
		}
	});
	initLanes().then(renderBenchmark);
	renderBenchmark();
	initPicks();
	loadShared();
}

boot();

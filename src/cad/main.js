// CAD Forge page controller: /cad (create + gallery) and /cad/:id (a design).

import { CadApiError, fetchDesign, fetchGallery, generateDesign, rebuildDesign } from './api.js';
import { MATERIALS, MAX_PROMPT_LEN, applyParams, massGrams } from './params.js';

const EXAMPLES = [
	'Wall-mounted phone holder with two countersunk screw holes',
	'20-tooth spur gear, module 1.5, with a 5 mm bore and a hub',
	'Raspberry Pi 4 case base with standoffs and vent slots',
	'Cable organizer clip for five 6 mm cables',
	'L bracket, 90 degrees, 3 mm thick, four M4 holes',
	'Knob for a 6 mm D-shaft with grip ridges',
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REBUILD_DEBOUNCE_MS = 350;

const $ = (sel) => document.querySelector(sel);

const state = {
	design: null,
	variant: null,
	values: {},
	viewer: null,
	viewerReady: null,
	rebuild: null,
	rebuildTimer: 0,
	finish: 'pla',
	busy: false,
};

// ── small DOM helpers ───────────────────────────────────────────────────────

function el(tag, attrs = {}, ...children) {
	const node = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (v == null || v === false) continue;
		if (k === 'class') node.className = v;
		else if (k === 'text') node.textContent = v;
		else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
		else node.setAttribute(k, v === true ? '' : String(v));
	}
	for (const child of children.flat()) {
		if (child == null || child === false) continue;
		node.append(child instanceof Node ? child : document.createTextNode(String(child)));
	}
	return node;
}

function fmtMm(v) {
	return v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2);
}

function sizeText(size) {
	return Array.isArray(size) ? `${size.map((v) => fmtMm(Number(v))).join(' × ')} mm` : '';
}

function toast(message) {
	const node = $('#cadToast');
	node.textContent = message;
	node.hidden = false;
	node.classList.add('is-on');
	clearTimeout(toast.timer);
	toast.timer = setTimeout(() => {
		node.classList.remove('is-on');
		node.hidden = true;
	}, 2600);
}

// ── routing ─────────────────────────────────────────────────────────────────

function routeId() {
	const m = /^\/cad\/([0-9a-f-]{36})\/?$/i.exec(location.pathname);
	return m && UUID_RE.test(m[1]) ? m[1] : null;
}

function showView(name) {
	$('#cadHome').hidden = name !== 'home';
	$('#cadDesign').hidden = name !== 'design';
	document.body.dataset.cadView = name;
}

async function route() {
	const id = routeId();
	if (id) {
		showView('design');
		await openDesign(id, new URLSearchParams(location.search).get('v'));
	} else {
		showView('home');
		document.title = 'CAD Forge · Describe a part, get real CAD · three.ws';
		const prefill = new URLSearchParams(location.search).get('prompt');
		if (prefill) $('#cadPrompt').value = prefill.slice(0, MAX_PROMPT_LEN);
		loadGallery();
	}
}

function navigate(path) {
	history.pushState(null, '', path);
	window.scrollTo({ top: 0 });
	route();
}

// ── progress (real server stages) ───────────────────────────────────────────

function createProgress(container) {
	const started = performance.now();
	const list = el('ol', { class: 'cad-steps' });
	const clock = el('span', { class: 'cad-progress__clock', text: '0 s' });
	const panel = el(
		'div',
		{ class: 'cad-progress', role: 'status', 'aria-live': 'polite' },
		el('div', { class: 'cad-progress__head' }, el('span', { class: 'cad-progress__title', text: 'Forging your part' }), clock),
		list,
	);
	container.replaceChildren(panel);
	container.hidden = false;
	const timer = setInterval(() => {
		clock.textContent = `${Math.round((performance.now() - started) / 1000)} s`;
	}, 1000);
	let current = null;

	function step(text, detail = null, tone = 'active') {
		if (current) current.classList.replace('is-active', 'is-done');
		const item = el('li', { class: `cad-step is-${tone}` }, el('span', { class: 'cad-step__dot', 'aria-hidden': 'true' }), el('span', { class: 'cad-step__text', text }));
		if (detail) item.append(el('code', { class: 'cad-step__detail', text: detail }));
		list.append(item);
		current = tone === 'active' ? item : null;
	}

	return {
		stage(event) {
			if (event.stage === 'writing') step('Writing the build123d program');
			else if (event.stage === 'building') step(event.attempt > 1 ? `Rebuilding on the OpenCascade kernel (attempt ${event.attempt})` : 'Building on the OpenCascade kernel');
			else if (event.stage === 'repairing') {
				const e = event.error || {};
				const where = e.line ? `line ${e.line}: ` : '';
				step('The kernel rejected it, so the program is being repaired', `${e.kind || 'error'} · ${where}${String(e.message || '').slice(0, 220)}`, 'warn');
				step('Rewriting the failing feature');
			} else if (event.stage === 'built') step('Kernel accepted the solid');
			else if (event.stage === 'saving') step('Exporting STEP, STL, GLB and drawings');
		},
		finish() {
			clearInterval(timer);
			if (current) current.classList.replace('is-active', 'is-done');
		},
		fail(message) {
			clearInterval(timer);
			if (current) current.classList.replace('is-active', 'is-failed');
			panel.append(el('p', { class: 'cad-progress__error', text: message }));
		},
	};
}

function errorMessage(err) {
	if (err instanceof CadApiError) {
		if (err.code === 'design_failed' && err.body.lastError) {
			const e = err.body.lastError;
			return `${err.message} Last kernel error: ${e.message}${e.line ? ` (line ${e.line})` : ''}.`;
		}
		return err.message;
	}
	if (err?.name === 'AbortError') return 'Cancelled.';
	return 'The connection dropped before the part finished. Check your network and try again.';
}

// ── create ──────────────────────────────────────────────────────────────────

async function submitCreate(event) {
	event?.preventDefault();
	if (state.busy) return;
	const prompt = $('#cadPrompt').value.trim();
	if (prompt.length < 3) {
		$('#cadPrompt').focus();
		toast('Describe the part first: what it is, its key sizes and features.');
		return;
	}
	state.busy = true;
	const button = $('#cadSubmit');
	button.disabled = true;
	button.classList.add('is-busy');
	const progress = createProgress($('#cadProgress'));
	try {
		const { design } = await generateDesign({ prompt, onStage: progress.stage });
		progress.finish();
		navigate(`/cad/${design.id}`);
	} catch (err) {
		progress.fail(errorMessage(err));
	} finally {
		state.busy = false;
		button.disabled = false;
		button.classList.remove('is-busy');
	}
}

function renderExamples() {
	$('#cadExamples').replaceChildren(
		...EXAMPLES.map((text) =>
			el('button', {
				type: 'button',
				class: 'cad-chip',
				text,
				onclick: () => {
					$('#cadPrompt').value = text;
					$('#cadPrompt').focus();
				},
			}),
		),
	);
}

// ── gallery ─────────────────────────────────────────────────────────────────

function galleryCard(d) {
	return el(
		'a',
		{ class: 'cad-card', href: `/cad/${d.id}` },
		el('div', { class: 'cad-card__paper' }, d.thumb ? el('img', { src: d.thumb, alt: `Line drawing of ${d.title}`, loading: 'lazy', decoding: 'async' }) : el('span', { class: 'cad-card__nothumb', text: 'No drawing' })),
		el('div', { class: 'cad-card__meta' }, el('strong', { text: d.title }), el('span', { text: sizeText(d.sizeMm) })),
	);
}

async function loadGallery() {
	const grid = $('#cadGallery');
	const status = $('#cadGalleryStatus');
	grid.replaceChildren(...Array.from({ length: 8 }, () => el('div', { class: 'cad-card cad-card--skeleton', 'aria-hidden': 'true' })));
	status.hidden = true;
	try {
		const { designs, available } = await fetchGallery({ limit: 24 });
		setAvailability(available);
		if (!designs.length) {
			grid.replaceChildren();
			status.replaceChildren(el('p', { text: 'No parts forged yet. Pick an example above, or describe the part you need, and yours becomes the first one here.' }));
			status.hidden = false;
			return;
		}
		grid.replaceChildren(...designs.map(galleryCard));
	} catch {
		grid.replaceChildren();
		status.replaceChildren(
			el('p', { text: 'Recent parts could not be loaded.' }),
			el('button', { type: 'button', class: 'cad-btn cad-btn--ghost', text: 'Retry', onclick: loadGallery }),
		);
		status.hidden = false;
	}
}

function setAvailability(available) {
	const notice = $('#cadOffline');
	notice.hidden = available !== false;
	$('#cadSubmit').disabled = available === false;
}

// ── design view ─────────────────────────────────────────────────────────────

async function ensureViewer() {
	if (!state.viewerReady) {
		state.viewerReady = import('./viewer.js').then(({ createCadViewer }) => {
			state.viewer = createCadViewer($('#cadViewport'));
			state.viewer.setFinish(state.finish);
			return state.viewer;
		});
	}
	return state.viewerReady;
}

function current() {
	const v = state.variant;
	return {
		files: v?.files || state.design.files,
		metrics: v?.metrics || state.design.metrics,
		adjustments: v?.adjustments || state.design.adjustments || [],
	};
}

async function openDesign(id, variantKey) {
	$('#cadDesignError').hidden = true;
	$('#cadDesignBody').classList.add('is-loading');
	let payload;
	try {
		payload = await fetchDesign(id, variantKey);
	} catch (err) {
		$('#cadDesignBody').classList.remove('is-loading');
		const box = $('#cadDesignError');
		const missing = err instanceof CadApiError && err.status === 404;
		box.replaceChildren(
			el('h2', { text: missing ? 'This part does not exist' : 'This part could not be loaded' }),
			el('p', { text: missing ? 'The link may be mistyped, or the design was never saved.' : errorMessage(err) }),
			el('div', { class: 'cad-row' },
				missing ? null : el('button', { type: 'button', class: 'cad-btn', text: 'Retry', onclick: () => openDesign(id, variantKey) }),
				el('a', { class: 'cad-btn cad-btn--ghost', href: '/cad', text: 'Forge a new part' })),
		);
		box.hidden = false;
		return;
	}
	state.design = payload.design;
	state.variant = payload.variant || null;
	state.values = Object.fromEntries(state.design.params.map((p) => [p.name, p.value]));
	if (state.variant) Object.assign(state.values, state.variant.values);
	document.title = `${state.design.title} · CAD Forge · three.ws`;

	renderHeader(payload.lineage);
	renderParams();
	renderOutputs();
	renderCode();
	$('#cadDesignBody').classList.remove('is-loading');

	try {
		const viewer = await ensureViewer();
		await viewer.load(current().files.glb, current().metrics.size_mm);
		viewer.reframe();
	} catch {
		$('#cadViewportError').hidden = false;
	}
}

function renderHeader(lineage) {
	const d = state.design;
	$('#cadTitle').textContent = d.title;
	$('#cadSummary').textContent = d.summary || '';
	$('#cadSummary').hidden = !d.summary;
	$('#cadAsked').textContent = d.prompt;
	const meta = $('#cadMeta');
	meta.replaceChildren(
		...[
		d.creatorUsername ? el('a', { href: `/u/${encodeURIComponent(d.creatorUsername)}`, text: `by @${d.creatorUsername}` }) : null,
		el('span', { text: `${d.views} view${d.views === 1 ? '' : 's'}` }),
		d.model ? el('span', { title: 'The model that wrote the program', text: d.model.split('/').pop() }) : null,
		].filter(Boolean),
	);
	const lin = $('#cadLineage');
	const parts = [];
	if (lineage?.parent) parts.push(el('span', {}, 'Refined from ', el('a', { href: `/cad/${lineage.parent.id}`, text: lineage.parent.title })));
	if (lineage?.children?.length) {
		parts.push(el('span', {}, 'Refinements: ', ...lineage.children.map((c, i) => [i ? ', ' : '', el('a', { href: `/cad/${c.id}`, text: c.title })])));
	}
	lin.replaceChildren(...parts);
	lin.hidden = !parts.length;
}

function renderParams() {
	const host = $('#cadParams');
	const params = state.design.params;
	$('#cadParamsSection').hidden = !params.length;
	host.replaceChildren(
		...params.map((p) => {
			const id = `cad-p-${p.name}`;
			const range = el('input', { type: 'range', id, min: p.min, max: p.max, step: p.step, value: state.values[p.name], 'aria-label': p.label });
			const number = el('input', { type: 'number', class: 'cad-param__num', min: p.min, max: p.max, step: p.step, value: state.values[p.name], 'aria-label': `${p.label} value` });
			const sync = (value, commit) => {
				const v = Math.min(p.max, Math.max(p.min, Number(value)));
				if (!Number.isFinite(v)) return;
				range.value = String(v);
				number.value = String(v);
				state.values[p.name] = v;
				if (commit) scheduleRebuild();
			};
			range.addEventListener('input', () => sync(range.value, false));
			range.addEventListener('change', () => sync(range.value, true));
			number.addEventListener('change', () => sync(number.value, true));
			return el(
				'div',
				{ class: 'cad-param' },
				el('label', { for: id, class: 'cad-param__label' }, el('span', { text: p.label }), el('code', { text: p.name })),
				el('div', { class: 'cad-param__controls' }, range, number, el('span', { class: 'cad-param__unit', text: p.unit === 'count' ? '' : p.unit })),
			);
		}),
	);
}

function scheduleRebuild() {
	clearTimeout(state.rebuildTimer);
	state.rebuildTimer = setTimeout(runRebuild, REBUILD_DEBOUNCE_MS);
}

async function runRebuild() {
	state.rebuild?.abort();
	const controller = new AbortController();
	state.rebuild = controller;
	const badge = $('#cadRebuilding');
	const err = $('#cadParamError');
	badge.hidden = false;
	err.hidden = true;
	try {
		const { variant } = await rebuildDesign(state.design.id, state.values, { signal: controller.signal });
		if (controller.signal.aborted) return;
		state.variant = variant;
		const viewer = await ensureViewer();
		await viewer.load(variant.files.glb, variant.metrics.size_mm);
		history.replaceState(null, '', `/cad/${state.design.id}?v=${variant.key}`);
		renderOutputs();
		renderCode();
	} catch (e) {
		if (e?.name === 'AbortError') return;
		const kernel = e instanceof CadApiError ? e.body.buildError : null;
		err.textContent = kernel ? `${e.message} Kernel: ${kernel.message}` : errorMessage(e);
		err.hidden = false;
	} finally {
		if (state.rebuild === controller) {
			badge.hidden = true;
			state.rebuild = null;
		}
	}
}

function resetParams() {
	state.values = Object.fromEntries(state.design.params.map((p) => [p.name, p.value]));
	state.variant = null;
	history.replaceState(null, '', `/cad/${state.design.id}`);
	renderParams();
	renderOutputs();
	renderCode();
	$('#cadParamError').hidden = true;
	ensureViewer().then((v) => v.load(state.design.files.glb, state.design.metrics.size_mm));
}

function renderOutputs() {
	const { files, metrics, adjustments } = current();
	const d = state.design;
	const [x, y, z] = metrics.size_mm;
	$('#cadMetrics').replaceChildren(
		metricRow('Size', `${fmtMm(x)} × ${fmtMm(y)} × ${fmtMm(z)} mm`),
		metricRow('Volume', `${(metrics.volume_mm3 / 1000).toFixed(2)} cm³`),
		metricRow('Surface', `${(metrics.area_mm2 / 100).toFixed(1)} cm²`),
		metricRow('Topology', `${metrics.solids} solid${metrics.solids === 1 ? '' : 's'} · ${metrics.faces} faces · ${metrics.edges} edges`),
		metricRow('Kernel check', metrics.valid ? 'Valid B-rep' : 'Built, with geometry warnings', metrics.valid ? 'ok' : 'warn'),
	);
	$('#cadMass').replaceChildren(
		...MATERIALS.map((m) =>
			el(
				'button',
				{
					type: 'button',
					class: `cad-mass${m.id === state.finish ? ' is-on' : ''}`,
					'aria-pressed': m.id === state.finish ? 'true' : 'false',
					onclick: () => {
						state.finish = m.id;
						state.viewer?.setFinish(m.id);
						renderOutputs();
					},
				},
				el('span', { text: m.label }),
				el('strong', { text: `${massGrams(metrics.volume_mm3, m.density).toFixed(1)} g` }),
			),
		),
	);
	const notes = $('#cadAdjustments');
	notes.replaceChildren(...adjustments.map((a) => el('li', { text: a })));
	$('#cadAdjustmentsSection').hidden = !adjustments.length;

	const slug = d.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'part';
	const pyUrl = `/api/cad?id=${d.id}&format=py${state.variant ? `&v=${state.variant.key}` : ''}`;
	$('#cadDownloads').replaceChildren(
		...[
		download(files.step, `${slug}.step`, 'STEP', 'Fusion, SolidWorks, FreeCAD, Onshape'),
		download(files.stl, `${slug}.stl`, 'STL', 'Any slicer, ready to print'),
		download(files.glb, `${slug}.glb`, 'GLB', 'Web, games, AR, true scale'),
		files.drawing_svg ? download(files.drawing_svg, `${slug}-drawing.svg`, 'Drawing', 'Front, top, right and iso views') : null,
		download(pyUrl, `${slug}.py`, 'Python', 'The build123d program itself'),
		].filter(Boolean),
	);

	const glb = files.glb;
	$('#cadAr').href = `/api/ar?src=${encodeURIComponent(glb)}&title=${encodeURIComponent(d.title)}`;
	$('#cadPrint').href = `/materialize?glb=${encodeURIComponent(glb)}`;
	$('#cadScene').href = `/scene?model=${encodeURIComponent(glb)}&name=${encodeURIComponent(d.title)}`;

	const drawing = $('#cadDrawingImg');
	if (files.drawing_svg) drawing.src = files.drawing_svg;
	$('#cadModeDrawing').disabled = !files.drawing_svg;
}

function metricRow(label, value, tone = null) {
	return el('div', { class: `cad-metric${tone ? ` is-${tone}` : ''}` }, el('dt', { text: label }), el('dd', { text: value }));
}

function download(href, filename, label, hint) {
	return el('a', { class: 'cad-dl', href, download: filename, rel: 'noopener' }, el('strong', { text: label }), el('span', { text: hint }));
}

function renderCode() {
	$('#cadCode').textContent = applyParams(state.design.code, state.values).code;
}

async function submitRefine(event) {
	event.preventDefault();
	if (state.busy) return;
	const input = $('#cadRefineInput');
	const prompt = input.value.trim();
	if (prompt.length < 3) {
		input.focus();
		return;
	}
	state.busy = true;
	const button = $('#cadRefineSubmit');
	button.disabled = true;
	const progress = createProgress($('#cadRefineProgress'));
	try {
		const { design } = await generateDesign({ prompt, parentId: state.design.id, values: state.values, onStage: progress.stage });
		progress.finish();
		input.value = '';
		$('#cadRefineProgress').hidden = true;
		navigate(`/cad/${design.id}`);
	} catch (err) {
		progress.fail(errorMessage(err));
	} finally {
		state.busy = false;
		button.disabled = false;
	}
}

function setMode(mode) {
	const drawing = mode === 'drawing';
	$('#cadViewport').hidden = drawing;
	$('#cadDrawing').hidden = !drawing;
	$('#cadModeModel').setAttribute('aria-pressed', String(!drawing));
	$('#cadModeDrawing').setAttribute('aria-pressed', String(drawing));
	$('#cadViewTools').classList.toggle('is-drawing', drawing);
}

function wireDesignTools() {
	$('#cadEdges').addEventListener('change', (e) => state.viewer?.setEdges(e.target.checked));
	$('#cadDims').addEventListener('change', (e) => state.viewer?.setDimensions(e.target.checked));
	$('#cadReframe').addEventListener('click', () => state.viewer?.reframe());
	$('#cadModeModel').addEventListener('click', () => setMode('model'));
	$('#cadModeDrawing').addEventListener('click', () => setMode('drawing'));
	$('#cadReset').addEventListener('click', resetParams);
	$('#cadRefine').addEventListener('submit', submitRefine);
	$('#cadCopyLink').addEventListener('click', async () => {
		try {
			await navigator.clipboard.writeText(location.href);
			toast('Link copied. Anyone with it sees this exact configuration.');
		} catch {
			toast('Copy failed. Select the address bar to copy the link.');
		}
	});
	$('#cadCopyCode').addEventListener('click', async () => {
		try {
			await navigator.clipboard.writeText($('#cadCode').textContent);
			toast('Program copied. It runs anywhere build123d is installed.');
		} catch {
			toast('Copy failed. Select the code to copy it.');
		}
	});
}

// ── boot ────────────────────────────────────────────────────────────────────

function boot() {
	renderExamples();
	$('#cadForm').addEventListener('submit', submitCreate);
	$('#cadPrompt').addEventListener('keydown', (e) => {
		if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitCreate(e);
	});
	$('#cadPrompt').maxLength = MAX_PROMPT_LEN;
	wireDesignTools();
	document.addEventListener('click', (e) => {
		const link = e.target.closest?.('a[href^="/cad"]');
		if (!link || e.metaKey || e.ctrlKey || e.shiftKey || link.target === '_blank' || link.hasAttribute('download')) return;
		e.preventDefault();
		navigate(link.getAttribute('href'));
	});
	window.addEventListener('popstate', route);
	route();
}

boot();

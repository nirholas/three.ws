// Forge: Conversational iteration (browser client).
//
// "Make the helmet red", "add a cape", "less shiny": a free-text instruction
// against the model on screen, via POST /api/forge-iterate. That endpoint
// shares its lineage core with the MCP `refine_model` tool, and its plan
// (src/shared/iterate-plan.js) with this page, so the hint shown before a
// request is exactly what the server will do:
//   - a surface change restyles the current version's materials and keeps the
//     shape (no geometry job),
//   - a shape change rebuilds from the current version's prompt plus the change,
//   - "More like this" (src/forge-more-like-this.js asks via
//     `forge:iterate-request`) makes another take on the same subject with a
//     new seed.
//
// Every result is a version with a parent. The strip shows them all, the chain
// line shows how the selected one was reached, any version can be shown,
// branched from, tried again (same change, new seed) or compared side by side
// with another. Nothing is overwritten. History is kept per original model in
// localStorage, so a reload does not lose it.
//
// Distinct from:
//   - #refine (forge.js)      → re-runs the SAME prompt at a HIGHER quality tier
//   - #refine-locally / forge-refine.js → local deterministic geometry ops
//   - forge-stylize.js        → geometric filters (voxel/brick/voronoi)
//   - forge-materials.js      → preset looks and AI restyle on this device
//
// The server fetches the model by URL, so Iterate always works from saved
// versions. A `blob:` src in the viewer is another tool's tab-local edit that
// the server cannot read; the src observer ignores those, and a model that only
// exists in the tab gets a note instead of a request that would fail.

import { escapeHtml } from './shared/coin-format.js';
import { planIteration } from './shared/iterate-plan.js';
import { ensureModelViewer } from './shared/model-viewer-loader.js';

const LOCAL_ONLY_NOTE =
	'Iterate works on a saved model, and this one only exists in this tab. Save it to your account or generate it on three.ws, then describe your change.';
const HISTORY_KEY = 'forge:iterate-history';
const HISTORY_MAX = 20;

const KIND_COPY = {
	look: { badge: 'Surface', hint: 'Surface change: restyles the materials and keeps this exact shape. Usually under 30 s.', busy: 'Restyling the surface' },
	shape: { badge: 'Shape', hint: 'Shape change: rebuilds the model from this version plus your change. Usually 2 to 3 min.', busy: 'Rebuilding the shape' },
	variation: { badge: 'Take', hint: 'Another take on the same subject with a new seed. Usually 2 to 3 min.', busy: 'Making another take' },
};

const isTabLocal = (url) => typeof url === 'string' && url.startsWith('blob:');

const actions = document.querySelector('#state-result .result-bar .actions');
const resultBar = document.getElementById('state-result');
const viewer = document.getElementById('viewer');

if (actions && resultBar && viewer) {
	injectStyles();

	const CLIENT_ID = (() => {
		const KEY = 'forge:cid';
		try {
			let id = localStorage.getItem(KEY);
			if (!id) {
				id =
					crypto?.randomUUID?.() ||
					`c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
				localStorage.setItem(KEY, id);
			}
			return id;
		} catch {
			return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
		}
	})();

	const btn = document.createElement('button');
	btn.type = 'button';
	btn.className = 'btn btn--ghost';
	btn.id = 'forge-iterate-btn';
	btn.setAttribute('aria-expanded', 'false');
	btn.setAttribute('aria-controls', 'iterate-panel');
	btn.title = 'Describe a change to iterate on this exact model ("make it metallic", "add a hat")';
	btn.innerHTML = `
		<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
		</svg>
		Iterate`;

	const materialsBtn = document.getElementById('forge-materials-btn');
	const rigBtn = document.getElementById('forge-rig-btn');
	const anchorAfter = materialsBtn || rigBtn || document.getElementById('forge-ar-btn');
	if (anchorAfter && anchorAfter.parentNode === actions) {
		anchorAfter.after(btn);
	} else {
		actions.appendChild(btn);
	}

	const panel = document.createElement('div');
	panel.className = 'iterate-panel is-hidden';
	panel.id = 'iterate-panel';
	panel.innerHTML = `
		<div class="iterate-head">
			<h3>Iterate on this model</h3>
			<p class="iterate-sub">Describe a change. Each result is a new version with its parent recorded. Nothing overwrites a version you have.</p>
		</div>
		<div class="iterate-history is-hidden" id="iterate-history">
			<div class="iterate-lineage" id="iterate-lineage" role="group" aria-label="Version history"></div>
			<p class="iterate-chain" id="iterate-chain"></p>
			<p class="iterate-inputs" id="iterate-inputs"></p>
			<div class="iterate-version-actions">
				<button type="button" class="iterate-link" id="iterate-again">Try again</button>
				<button type="button" class="iterate-link" id="iterate-compare-open">Compare versions</button>
			</div>
		</div>
		<form class="iterate-form" id="iterate-form">
			<input
				type="text"
				id="iterate-instruction"
				maxlength="500"
				autocomplete="off"
				placeholder="e.g. &quot;make it red&quot;, &quot;add a small backpack&quot;"
				aria-label="Describe a change"
				aria-describedby="iterate-hint"
			/>
			<button type="submit" class="btn btn--primary" id="iterate-apply">Iterate</button>
		</form>
		<div class="iterate-hint" id="iterate-hint" aria-live="polite">
			<span id="iterate-hint-text"></span>
			<button type="button" class="iterate-link is-hidden" id="iterate-mode-toggle"></button>
		</div>
		<div class="iterate-status" id="iterate-status" role="status" aria-live="polite"></div>
		<div class="iterate-recover is-hidden" id="iterate-recover"></div>
		<div class="iterate-compare is-hidden" id="iterate-compare" role="region" aria-label="Compare two versions">
			<div class="iterate-compare-head">
				<strong>Compare versions</strong>
				<button type="button" class="iterate-link" id="iterate-compare-close" aria-label="Close comparison">Close</button>
			</div>
			<div class="iterate-compare-grid">
				<figure class="iterate-compare-cell">
					<label><span class="sr-only">Left version</span><select id="iterate-compare-a"></select></label>
					<model-viewer id="iterate-compare-view-a" camera-controls interaction-prompt="none" shadow-intensity="1" exposure="1.5" tone-mapping="aces"></model-viewer>
				</figure>
				<figure class="iterate-compare-cell">
					<label><span class="sr-only">Right version</span><select id="iterate-compare-b"></select></label>
					<model-viewer id="iterate-compare-view-b" camera-controls interaction-prompt="none" shadow-intensity="1" exposure="1.5" tone-mapping="aces"></model-viewer>
				</figure>
			</div>
			<p class="iterate-compare-note" id="iterate-compare-note">Drag either model: both turn together.</p>
		</div>
	`;
	resultBar.after(panel);

	const $ = (id) => panel.querySelector(`#${id}`);
	const form = $('iterate-form');
	const input = $('iterate-instruction');
	const status = $('iterate-status');
	const applyBtn = $('iterate-apply');
	const historyHost = $('iterate-history');
	const lineageHost = $('iterate-lineage');
	const chainLine = $('iterate-chain');
	const inputsLine = $('iterate-inputs');
	const againBtn = $('iterate-again');
	const compareOpen = $('iterate-compare-open');
	const hintText = $('iterate-hint-text');
	const modeToggle = $('iterate-mode-toggle');
	const recover = $('iterate-recover');
	const compare = $('iterate-compare');
	const compareA = $('iterate-compare-a');
	const compareB = $('iterate-compare-b');
	const viewA = $('iterate-compare-view-a');
	const viewB = $('iterate-compare-view-b');

	let originalGlbUrl = '';
	let originalLabel = '';
	let originalPrompt = '';
	let currentGlbUrl = '';
	let lineage = null; // immutable version array from the last response
	let activeIndex = -1;
	let modeOverride = null; // null (auto), 'look' or 'shape'
	let busy = false;
	let runToken = 0;
	let lastRequest = null;

	function setStatus(text, kind = '') {
		status.textContent = text || '';
		status.dataset.kind = kind;
	}

	function setBusy(next) {
		busy = next;
		applyBtn.disabled = next;
		input.disabled = next;
		againBtn.disabled = next;
		panel.dataset.busy = next ? 'true' : 'false';
		for (const b of lineageHost.querySelectorAll('button')) b.disabled = next;
	}

	// ── history persistence ─────────────────────────────────────────────────

	function readHistory() {
		try {
			const all = JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}');
			return all && typeof all === 'object' ? all : {};
		} catch {
			return {};
		}
	}

	function saveHistory() {
		if (!originalGlbUrl || !Array.isArray(lineage)) return;
		try {
			const all = readHistory();
			delete all[originalGlbUrl];
			all[originalGlbUrl] = { lineage, activeIndex, savedAt: Date.now() };
			const keys = Object.keys(all);
			for (const k of keys.slice(0, Math.max(0, keys.length - HISTORY_MAX))) delete all[k];
			localStorage.setItem(HISTORY_KEY, JSON.stringify(all));
		} catch {
			// Storage full or disabled: history still lives for this page view.
		}
	}

	// ── versions ────────────────────────────────────────────────────────────

	const versionName = (i) => (i === 0 ? 'Original' : `v${i}`);

	function versionLabel(v) {
		if (!v || v.index === 0) return 'Original';
		if (v.refKind === 'variation') return 'Another take';
		return v.instruction || `Version ${v.index}`;
	}

	function versionKind(v) {
		if (!v || v.index === 0) return null;
		if (v.inputs?.mode && KIND_COPY[v.inputs.mode]) return v.inputs.mode;
		if (v.refKind === 'restyle') return 'look';
		if (v.refKind === 'variation') return 'variation';
		return 'shape';
	}

	function activeVersion() {
		return Array.isArray(lineage) ? lineage[activeIndex] : null;
	}

	function chainOf(index) {
		const chain = [];
		const guard = new Set();
		let cursor = index;
		while (Number.isInteger(cursor) && lineage?.[cursor] && !guard.has(cursor)) {
			guard.add(cursor);
			chain.unshift(lineage[cursor]);
			cursor = lineage[cursor].parentIndex;
		}
		return chain;
	}

	function renderLineage() {
		const hasHistory = Array.isArray(lineage) && lineage.length > 1;
		historyHost.classList.toggle('is-hidden', !hasHistory);
		if (!hasHistory) {
			lineageHost.innerHTML = '';
			return;
		}
		lineageHost.innerHTML = lineage
			.map((v, i) => {
				const kind = versionKind(v);
				const label = versionLabel(v);
				const from = i > 0 && Number.isInteger(v.parentIndex) ? `, from ${versionName(v.parentIndex)}` : '';
				return `<button type="button" class="iterate-version${i === activeIndex ? ' is-active' : ''}" data-index="${i}" aria-pressed="${i === activeIndex}" title="${escapeHtml(label + from)}">
					<span class="iterate-version-name">${versionName(i)}</span>${kind ? `<span class="iterate-kind iterate-kind--${kind}">${KIND_COPY[kind].badge}</span>` : ''}
				</button>`;
			})
			.join('');
		lineageHost.querySelectorAll('.iterate-version').forEach((b) => {
			b.addEventListener('click', () => jumpTo(Number(b.dataset.index)));
		});

		const v = activeVersion();
		chainLine.innerHTML = chainOf(activeIndex)
			.map((c) => `<span class="iterate-chain-step">${escapeHtml(versionName(c.index))}${c.index ? `: ${escapeHtml(versionLabel(c))}` : ''}</span>`)
			.join('<span class="iterate-chain-sep" aria-hidden="true">›</span>');
		const parts = [];
		if (v?.inputs?.seed) parts.push(`seed ${v.inputs.seed}`);
		if (v?.inputs?.backend) parts.push(v.inputs.backend === 'material-restyle' ? 'material restyle' : v.inputs.backend);
		if (v?.prompt) parts.push(`prompt "${v.prompt}"`);
		inputsLine.textContent = parts.length ? `Made with ${parts.join(', ')}` : '';
		againBtn.hidden = !(v && v.index > 0);
		againBtn.title = v?.index
			? `Run "${versionLabel(v)}" again from ${versionName(v.parentIndex)} with a new seed, as a sibling of ${versionName(v.index)}`
			: '';
	}

	function jumpTo(index) {
		if (busy || !Array.isArray(lineage) || !lineage[index]) return;
		activeIndex = index;
		const v = lineage[index];
		currentGlbUrl = v.glbUrl;
		viewer.setAttribute('src', v.glbUrl);
		viewer.setAttribute('alt', `${originalLabel}: ${versionLabel(v)}`);
		renderLineage();
		saveHistory();
		clearRecover();
		setStatus(
			index === lineage.length - 1
				? `Showing ${versionName(index)}. Describe another change to keep going.`
				: `Showing ${versionName(index)}. A change from here starts a new branch; later versions stay in the strip.`,
			'',
		);
	}

	// ── hint and mode override ──────────────────────────────────────────────

	function predictedKind(text) {
		const v = activeVersion();
		const plan = planIteration({
			instruction: text,
			mode: modeOverride || 'auto',
			parentInstruction: v?.instruction || null,
			parentPrompt: v?.prompt || originalPrompt,
		});
		return plan.ok ? plan.kind : null;
	}

	function renderHint() {
		const text = input.value.trim();
		const kind = text ? predictedKind(text) : null;
		if (!kind) {
			hintText.textContent = text ? '' : 'Colours and materials keep the shape. New parts or proportions rebuild it.';
			modeToggle.classList.add('is-hidden');
			return;
		}
		hintText.textContent = KIND_COPY[kind].hint;
		modeToggle.classList.remove('is-hidden');
		modeToggle.textContent = kind === 'look' ? 'Rebuild the shape instead' : 'Change the surface only';
		modeToggle.dataset.target = kind === 'look' ? 'shape' : 'look';
	}

	modeToggle.addEventListener('click', () => {
		modeOverride = modeToggle.dataset.target === 'shape' ? 'shape' : 'look';
		renderHint();
		input.focus();
	});
	input.addEventListener('input', () => {
		if (!input.value.trim()) modeOverride = null;
		renderHint();
	});

	// ── recovery actions ────────────────────────────────────────────────────

	function clearRecover() {
		recover.innerHTML = '';
		recover.classList.add('is-hidden');
	}

	function offerRecover(buttons) {
		recover.innerHTML = '';
		for (const b of buttons) {
			const el = document.createElement('button');
			el.type = 'button';
			el.className = b.primary ? 'btn btn--primary btn--sm' : 'btn btn--ghost btn--sm';
			el.textContent = b.label;
			el.addEventListener('click', b.run);
			recover.appendChild(el);
		}
		recover.classList.toggle('is-hidden', buttons.length === 0);
	}

	function retryButton(request) {
		return { label: 'Retry this step', primary: true, run: () => send(request) };
	}

	function failureActions(res, data, request) {
		const code = data?.error;
		if (code === 'different_object' && data.suggested_prompt) {
			return [
				{
					label: `Generate "${data.suggested_prompt}"`,
					primary: true,
					run: () => document.dispatchEvent(new CustomEvent('forge:run-prompt', { detail: { prompt: data.suggested_prompt } })),
				},
				{ label: 'Iterate anyway', run: () => send({ ...request, allowNewSubject: true }) },
			];
		}
		if (code === 'same_instruction') {
			const v = activeVersion();
			return v?.index ? [{ label: `Try ${versionName(v.index)} again`, primary: true, run: tryAgain }] : [];
		}
		if (code === 'look_unavailable') {
			const out = [{ label: 'Rebuild the shape instead', primary: true, run: () => send({ ...request, mode: 'shape' }) }];
			if (document.getElementById('forge-materials-btn')) {
				out.push({ label: 'Open Materials', run: () => document.getElementById('forge-materials-btn')?.click() });
			}
			return out;
		}
		if (code === 'no_subject' || code === 'missing_instruction' || code === 'instruction_too_long' || res.status === 401) return [];
		return [retryButton(request)];
	}

	function failureMessage(res, data) {
		if (res.status === 401) return 'Sign in to iterate on a model. Your current version is unchanged.';
		if (res.status === 429) {
			const secs = Number(data.retry_after) > 0 ? Math.ceil(Number(data.retry_after)) : 20;
			return `Iteration is busy right now. Your current version is unchanged. Try again in about ${secs} s.`;
		}
		const base = data.message || `Iteration failed (${res.status}).`;
		return /unchanged|nothing was changed/i.test(base) ? base : `${base} Your current version is unchanged.`;
	}

	// ── run ─────────────────────────────────────────────────────────────────

	function buildRequest({ instruction = '', mode = 'auto', parentIndex = activeIndex, seed, allowNewSubject = false }) {
		return { instruction, mode, parentIndex, seed, allowNewSubject };
	}

	async function send(request) {
		if (busy) return;
		const parent = Array.isArray(lineage) ? lineage[request.parentIndex] : null;
		const glbUrl = parent?.glbUrl || currentGlbUrl;
		if (!glbUrl || isTabLocal(glbUrl)) {
			setStatus(LOCAL_ONLY_NOTE, 'error');
			return;
		}
		const kind =
			request.mode === 'variation'
				? 'variation'
				: planIteration({ instruction: request.instruction, mode: request.mode, allowNewSubject: true }).kind || 'shape';
		const token = ++runToken;
		lastRequest = request;
		clearRecover();
		setBusy(true);
		const started = Date.now();
		const tick = () => setStatus(`${KIND_COPY[kind].busy}, ${Math.round((Date.now() - started) / 1000)} s. Your current version stays on screen.`, 'busy');
		tick();
		const timer = setInterval(tick, 1000);
		try {
			const res = await fetch('/api/forge-iterate', {
				method: 'POST',
				headers: { 'content-type': 'application/json', 'x-forge-client': CLIENT_ID },
				body: JSON.stringify({
					glb_url: glbUrl,
					instruction: request.instruction || undefined,
					mode: request.mode,
					parent_prompt: parent?.prompt || originalPrompt || originalLabel,
					parent_lineage: Array.isArray(lineage) ? lineage : undefined,
					parent_index: Array.isArray(lineage) && request.parentIndex >= 0 ? request.parentIndex : undefined,
					...(Number.isInteger(request.seed) ? { seed: request.seed } : {}),
					...(request.allowNewSubject ? { allow_new_subject: true } : {}),
				}),
			});
			const data = await res.json().catch(() => ({}));
			if (token !== runToken) return;
			if (!res.ok || !data.glbUrl) {
				setStatus(failureMessage(res, data), 'error');
				offerRecover(failureActions(res, data, request));
				return;
			}
			currentGlbUrl = data.glbUrl;
			lineage = Array.isArray(data.lineage) ? data.lineage : lineage;
			activeIndex = Number.isInteger(data.activeIndex) ? data.activeIndex : (lineage?.length || 1) - 1;
			const v = activeVersion();
			viewer.setAttribute('src', data.glbUrl);
			viewer.setAttribute('alt', `${originalLabel}: ${versionLabel(v)}`);
			renderLineage();
			saveHistory();
			input.value = '';
			modeOverride = null;
			renderHint();
			const what = data.kind === 'look' ? 'Restyled the surface, shape kept' : data.kind === 'variation' ? 'New take ready' : 'Shape rebuilt';
			setStatus(`${what}: ${versionName(activeIndex)}. Keep going, or pick any version above to branch or compare.`, 'done');
		} catch {
			if (token !== runToken) return;
			setStatus('Network hiccup. Your current version is unchanged.', 'error');
			offerRecover([retryButton(request)]);
		} finally {
			clearInterval(timer);
			if (token === runToken) setBusy(false);
		}
	}

	// "Do that again": the selected version's own change, from its own parent,
	// with a new seed, as a sibling. History is never rewritten.
	function tryAgain() {
		const v = activeVersion();
		if (!v || !v.index) return;
		send(
			buildRequest({
				instruction: v.refKind === 'variation' ? '' : v.instruction || '',
				mode: v.refKind === 'variation' ? 'variation' : versionKind(v) || 'shape',
				parentIndex: v.parentIndex,
				allowNewSubject: true,
			}),
		);
	}
	againBtn.addEventListener('click', tryAgain);

	form.addEventListener('submit', (e) => {
		e.preventDefault();
		const text = input.value.trim();
		if (!text) {
			setStatus('Describe the change first, for example "make it red" or "add a small backpack".', 'error');
			input.focus();
			return;
		}
		send(buildRequest({ instruction: text, mode: modeOverride || 'auto' }));
	});

	function openPanel() {
		panel.classList.remove('is-hidden');
		btn.setAttribute('aria-expanded', 'true');
	}

	btn.addEventListener('click', () => {
		const willShow = panel.classList.contains('is-hidden');
		panel.classList.toggle('is-hidden', !willShow);
		btn.setAttribute('aria-expanded', String(willShow));
		if (willShow) input.focus();
	});

	// "More like this" and other result tools ask for an iteration through a
	// public event so every version lands in this one lineage.
	document.addEventListener('forge:iterate-request', (e) => {
		if (!panel.isConnected) return;
		const mode = e.detail?.mode;
		if (!['variation', 'look', 'shape'].includes(mode)) return;
		openPanel();
		if (busy) {
			setStatus('One change at a time: wait for the current one to finish.', 'error');
			return;
		}
		send(buildRequest({ instruction: typeof e.detail.instruction === 'string' ? e.detail.instruction : '', mode, allowNewSubject: true }));
	});

	// ── compare ─────────────────────────────────────────────────────────────

	let syncing = false;
	function syncCamera(from, to) {
		if (syncing || typeof from.getCameraOrbit !== 'function') return;
		syncing = true;
		const o = from.getCameraOrbit();
		to.cameraOrbit = `${o.theta}rad ${o.phi}rad ${o.radius}m`;
		requestAnimationFrame(() => {
			syncing = false;
		});
	}
	viewA.addEventListener('camera-change', () => syncCamera(viewA, viewB));
	viewB.addEventListener('camera-change', () => syncCamera(viewB, viewA));

	function fillCompareSelect(select, selected) {
		select.innerHTML = lineage
			.map((v, i) => `<option value="${i}"${i === selected ? ' selected' : ''}>${escapeHtml(`${versionName(i)}: ${versionLabel(v)}`)}</option>`)
			.join('');
	}

	function showCompared() {
		const a = lineage?.[Number(compareA.value)];
		const b = lineage?.[Number(compareB.value)];
		if (a) viewA.setAttribute('src', a.glbUrl);
		if (b) viewB.setAttribute('src', b.glbUrl);
	}

	compareOpen.addEventListener('click', async () => {
		if (!Array.isArray(lineage) || lineage.length < 2) return;
		const v = activeVersion();
		const other = v && Number.isInteger(v.parentIndex) ? v.parentIndex : activeIndex === 0 ? 1 : 0;
		fillCompareSelect(compareA, other);
		fillCompareSelect(compareB, activeIndex);
		compare.classList.remove('is-hidden');
		showCompared();
		compareA.focus();
		$('iterate-compare-note').textContent = 'Loading the 3D viewer…';
		try {
			await ensureModelViewer();
			$('iterate-compare-note').textContent = 'Drag either model: both turn together.';
		} catch (err) {
			$('iterate-compare-note').textContent = err?.message || 'The 3D viewer could not load. Reload the page to compare.';
		}
	});
	compareA.addEventListener('change', showCompared);
	compareB.addEventListener('change', showCompared);
	function closeCompare() {
		compare.classList.add('is-hidden');
		compareOpen.focus();
	}
	$('iterate-compare-close').addEventListener('click', closeCompare);
	compare.addEventListener('keydown', (e) => {
		if (e.key === 'Escape') closeCompare();
	});

	// ── source tracking ─────────────────────────────────────────────────────

	function onNewSource(glbUrl, label) {
		if (!glbUrl || glbUrl === originalGlbUrl) return;
		originalGlbUrl = glbUrl;
		originalLabel = label || '';
		originalPrompt = label || '';
		currentGlbUrl = glbUrl;
		lineage = null;
		activeIndex = -1;
		const saved = readHistory()[glbUrl];
		if (saved && Array.isArray(saved.lineage) && saved.lineage[0]?.glbUrl === glbUrl) {
			lineage = saved.lineage;
			// Reopening a model starts on the model that was opened (the origin);
			// every later version is one tap away in the strip.
			activeIndex = 0;
		}
		runToken++;
		lastRequest = null;
		modeOverride = null;
		setStatus(lineage ? `${lineage.length - 1} earlier change${lineage.length === 2 ? '' : 's'} restored from this browser.` : '', '');
		input.value = '';
		clearRecover();
		compare.classList.add('is-hidden');
		renderLineage();
		renderHint();
		panel.classList.add('is-hidden');
		btn.setAttribute('aria-expanded', 'false');
		setBusy(false);
	}

	document.addEventListener('forge:model-ready', (e) => {
		if (!panel.isConnected) return;
		onNewSource(e.detail?.glbUrl, e.detail?.label);
	});

	// Ignore our own lineage-jump / iterate swaps; only a genuinely new source
	// model (fresh generation, gallery open) should reset the panel.
	const srcObserver = new MutationObserver(() => {
		const url = viewer.getAttribute('src');
		if (!url || url === originalGlbUrl || url === currentGlbUrl || isTabLocal(url)) return;
		if (Array.isArray(lineage) && lineage.some((v) => v.glbUrl === url)) return;
		onNewSource(url, document.getElementById('result-label')?.textContent?.trim() || '');
	});
	srcObserver.observe(viewer, { attributes: true, attributeFilter: ['src'] });

	if (viewer.getAttribute('src')) {
		onNewSource(viewer.getAttribute('src'), document.getElementById('result-label')?.textContent?.trim() || '');
	}
	renderHint();
}

function injectStyles() {
	if (document.getElementById('forge-iterate-styles')) return;
	const style = document.createElement('style');
	style.id = 'forge-iterate-styles';
	style.textContent = `
		.iterate-panel {
			margin: 0 var(--space-md, 1rem) var(--space-md, 1rem);
			padding: 0.9rem 1rem;
			border: 1px solid var(--stroke);
			border-radius: var(--radius-sm, 8px);
			background: var(--surface, rgba(255,255,255,0.03));
		}
		.iterate-panel.is-hidden, .iterate-panel .is-hidden { display: none; }
		.iterate-panel[data-busy='true'] .iterate-form { opacity: .7; }
		.iterate-head h3 { margin: 0 0 0.15rem; font-size: var(--text-md, 1rem); }
		.iterate-sub { margin: 0 0 0.7rem; font-size: var(--text-sm, 0.85rem); color: var(--ink-dim); }
		.iterate-history { margin-bottom: 0.7rem; }
		.iterate-lineage { display: flex; flex-wrap: wrap; gap: 0.35rem; }
		.iterate-version {
			display: inline-flex; align-items: center; gap: 0.35rem;
			min-height: 32px; padding: 0.25rem 0.65rem;
			border: 1px solid var(--stroke); border-radius: 999px;
			background: transparent; color: var(--ink-dim);
			font-size: var(--text-xs, 0.75rem); cursor: pointer;
			transition: border-color .15s ease, color .15s ease, background .15s ease;
		}
		.iterate-version:hover:not(:disabled) { border-color: var(--stroke-strong, var(--ink-dim)); color: var(--ink); }
		.iterate-version:active:not(:disabled) { background: var(--surface-2, rgba(255,255,255,.06)); }
		.iterate-version.is-active { border-color: var(--accent); color: var(--accent); }
		.iterate-version:disabled { opacity: .55; cursor: progress; }
		.iterate-version:focus-visible, .iterate-link:focus-visible, .iterate-compare select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
		.iterate-kind { font-size: 0.66rem; letter-spacing: .04em; text-transform: uppercase; padding: 0 0.35rem; border-radius: 999px; border: 1px solid currentColor; opacity: .8; }
		.iterate-chain { display: flex; flex-wrap: wrap; align-items: center; gap: 0.3rem; margin: 0.55rem 0 0.15rem; font-size: var(--text-xs, 0.78rem); color: var(--ink); }
		.iterate-chain-sep { color: var(--ink-dim); }
		.iterate-inputs { margin: 0; font-size: var(--text-xs, 0.74rem); color: var(--ink-dim); overflow-wrap: anywhere; }
		.iterate-inputs:empty { display: none; }
		.iterate-version-actions { display: flex; flex-wrap: wrap; gap: 0.9rem; margin-top: 0.35rem; }
		.iterate-link {
			padding: 0.2rem 0; border: 0; background: none; color: var(--accent);
			font: inherit; font-size: var(--text-xs, 0.78rem); cursor: pointer;
			text-decoration: underline; text-underline-offset: 3px; text-decoration-color: transparent;
			transition: text-decoration-color .15s ease, opacity .15s ease;
		}
		.iterate-link:hover:not(:disabled) { text-decoration-color: currentColor; }
		.iterate-link:active:not(:disabled) { opacity: .7; }
		.iterate-link:disabled { opacity: .5; cursor: progress; }
		.iterate-form { display: flex; gap: 0.5rem; flex-wrap: wrap; }
		.iterate-form input {
			flex: 1 1 220px; min-width: 0;
			padding: 0.5rem 0.7rem;
			border: 1px solid var(--stroke);
			border-radius: var(--radius-sm, 8px);
			background: transparent;
			color: var(--ink);
			font-size: var(--text-sm, 0.85rem);
		}
		.iterate-form input:hover:not(:disabled) { border-color: var(--stroke-strong, var(--ink-dim)); }
		.iterate-form input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
		.iterate-hint { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.25rem 0.6rem; margin-top: 0.45rem; font-size: var(--text-xs, 0.78rem); color: var(--ink-dim); min-height: 1.2em; }
		.iterate-status { margin-top: 0.5rem; font-size: var(--text-xs, 0.8rem); color: var(--ink-dim); min-height: 1em; }
		.iterate-status[data-kind='busy'] { color: var(--accent); }
		.iterate-status[data-kind='error'] { color: var(--danger); }
		.iterate-status[data-kind='done'] { color: var(--success); }
		.iterate-recover { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.5rem; }
		.iterate-compare { margin-top: 0.8rem; padding-top: 0.7rem; border-top: 1px solid var(--stroke); }
		.iterate-compare-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem; font-size: var(--text-sm, 0.85rem); }
		.iterate-compare-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; }
		.iterate-compare-cell { margin: 0; display: flex; flex-direction: column; gap: 0.35rem; min-width: 0; }
		.iterate-compare select {
			width: 100%; padding: 0.35rem 0.5rem; border: 1px solid var(--stroke); border-radius: var(--radius-sm, 8px);
			background: var(--surface-2, transparent); color: var(--ink); font-size: var(--text-xs, 0.78rem);
		}
		.iterate-compare select:hover { border-color: var(--stroke-strong, var(--ink-dim)); }
		.iterate-compare model-viewer { width: 100%; aspect-ratio: 1 / 1; border: 1px solid var(--stroke); border-radius: var(--radius-sm, 8px); background: var(--surface-2, rgba(255,255,255,.03)); }
		.iterate-compare-note { margin: 0.45rem 0 0; font-size: var(--text-xs, 0.74rem); color: var(--ink-dim); }
		.iterate-panel .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
		@media (max-width: 560px) { .iterate-compare-grid { grid-template-columns: 1fr; } }
		@media (prefers-reduced-motion: reduce) { .iterate-version, .iterate-link { transition: none; } }
	`;
	document.head.appendChild(style);
}

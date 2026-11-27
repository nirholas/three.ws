// Forge: Restyle materials panel (browser client).
//
// Changes how the model's surface looks and never its shape. Two paths:
//   - Preset looks run on this device. "Finish" looks keep the model's colors
//     and change the shine; "Material" looks replace the colors with a solid
//     material. src/shared/glb-material-restyle.js rewrites only the GLB's JSON
//     chunk, so geometry, UVs and textures stay byte-identical, and a look lands
//     in milliseconds with no server, no quota and nothing to wait on.
//   - Free text ("weathered bronze with green patina") goes to AI restyle
//     (POST /api/material-studio?action=restyle) through
//     src/shared/material-restyle-client.js: the shared instruction checks, a
//     30 s bound, a Cancel button, and our own copy for every failure, each of
//     which points back at the presets. A request that would change the shape
//     ("make it voxel", "add a hat") is pointed at the tool that does that.
//
// Every look joins a history strip (Original, then each look) the user can step
// through. The panel's download and the page's main Download both follow the
// look on screen, and hand back the original when the user steps back to it.
//
// Self-contained: builds its own button and panel off `forge:model-ready` and a
// watch on the viewer's src, the same pattern as forge-stylize.js and forge-rig.js.

import { BROWSER_LOOKS, LOOK_GROUPS, restyleGlb } from './shared/glb-material-restyle.js';
import { INSTRUCTION_MAX, checkInstruction, shapeIntent } from './shared/restyle-instruction.js';
import { requestServerRestyle } from './shared/material-restyle-client.js';
import { stampGlbAttribution } from './shared/glb-attribution.js';

/** Looks kept in the history strip before the oldest unused one is dropped. */
const HISTORY_MAX = 16;

const actions = document.querySelector('#state-result .result-bar .actions');
const resultBar = document.getElementById('state-result');
const viewer = document.getElementById('viewer');

if (actions && resultBar && viewer) {
	injectStyles();

	// The forge anonymous client id (set by forge.js), forwarded on the source
	// fetch and the AI restyle so both are attributed like the generation was.
	const CLIENT_HEADERS = (() => {
		try {
			const id = localStorage.getItem('forge:cid');
			return id ? { 'x-forge-client': id } : {};
		} catch {
			return {};
		}
	})();

	const btn = document.createElement('button');
	btn.type = 'button';
	btn.className = 'btn btn--ghost';
	btn.id = 'forge-materials-btn';
	btn.setAttribute('aria-expanded', 'false');
	btn.setAttribute('aria-controls', 'materials-panel');
	btn.title = 'Change the surface, keep the shape: instant preset looks, or describe one for AI restyle';
	btn.innerHTML = `
		<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
			<path d="M12 19l7-7 3 3-7 7-3-3z" />
			<path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
			<path d="M2 2l7.586 7.586" />
			<circle cx="11" cy="11" r="2" />
		</svg>
		Restyle materials`;

	const rigBtn = document.getElementById('forge-rig-btn');
	const arBtn = document.getElementById('forge-irl-btn') || document.getElementById('forge-ar-btn');
	const anchorAfter = rigBtn || arBtn;
	if (anchorAfter && anchorAfter.parentNode === actions) anchorAfter.after(btn);
	else actions.appendChild(btn);

	const panel = document.createElement('section');
	panel.className = 'materials-panel is-hidden';
	panel.id = 'materials-panel';
	panel.setAttribute('aria-labelledby', 'materials-title');
	panel.innerHTML = `
		<div class="materials-head">
			<h3 id="materials-title">Restyle materials</h3>
			<p class="materials-sub">Changes the surface, never the shape. Presets apply instantly on this device.</p>
		</div>
		<div class="materials-groups" id="materials-groups"></div>
		<div class="materials-history" id="materials-history" role="group" aria-label="Looks you have tried" hidden></div>
		<form class="materials-form" id="materials-form" novalidate>
			<label class="materials-label" for="materials-instruction">Or describe a material for AI restyle</label>
			<div class="materials-row">
				<input
					type="text"
					id="materials-instruction"
					maxlength="${INSTRUCTION_MAX}"
					autocomplete="off"
					placeholder="e.g. weathered bronze with green patina"
					aria-describedby="materials-count materials-ai-note"
				/>
				<button type="submit" class="btn btn--primary" id="materials-apply">AI restyle</button>
			</div>
			<p class="materials-meta">
				<span id="materials-ai-note">Needs a three.ws account and takes a few seconds.</span>
				<span class="materials-count" id="materials-count" aria-live="off">0/${INSTRUCTION_MAX}</span>
			</p>
		</form>
		<div class="materials-pointer" id="materials-pointer" role="note" hidden>
			<p id="materials-pointer-text"></p>
			<div class="materials-pointer-actions">
				<button type="button" class="btn btn--primary btn--sm" id="materials-pointer-open"></button>
				<button type="button" class="btn btn--ghost btn--sm" id="materials-pointer-anyway">Restyle the surface anyway</button>
			</div>
		</div>
		<div class="materials-working" id="materials-working" hidden>
			<span class="materials-skeleton" aria-hidden="true"></span>
			<span class="materials-working-text" id="materials-working-text">AI restyle working</span>
			<button type="button" class="btn btn--ghost btn--sm" id="materials-cancel">Cancel</button>
		</div>
		<div class="materials-actions">
			<a class="btn btn--ghost" id="materials-download" download hidden>Download this look</a>
			<button type="button" class="btn btn--ghost" id="materials-revert" hidden>Back to original</button>
			<a class="btn btn--ghost" id="materials-studio" hidden>Fine-tune in Restyle Studio</a>
		</div>
		<p class="materials-status" id="materials-status" role="status" aria-live="polite"></p>
	`;
	resultBar.after(panel);

	const $ = (sel) => panel.querySelector(sel);
	const groupsHost = $('#materials-groups');
	const historyHost = $('#materials-history');
	const form = $('#materials-form');
	const input = $('#materials-instruction');
	const applyBtn = $('#materials-apply');
	const countEl = $('#materials-count');
	const pointer = $('#materials-pointer');
	const pointerText = $('#materials-pointer-text');
	const pointerOpen = $('#materials-pointer-open');
	const pointerAnyway = $('#materials-pointer-anyway');
	const working = $('#materials-working');
	const workingText = $('#materials-working-text');
	const cancelBtn = $('#materials-cancel');
	const panelDownload = $('#materials-download');
	const revertBtn = $('#materials-revert');
	const studioLink = $('#materials-studio');
	const status = $('#materials-status');
	const mainDownload = document.getElementById('download');

	const lookButtons = new Map();
	for (const group of LOOK_GROUPS) {
		const looks = BROWSER_LOOKS.filter((l) => l.group === group.id);
		const wrap = document.createElement('div');
		wrap.className = 'materials-group';
		wrap.dataset.group = group.id;
		wrap.setAttribute('role', 'group');
		wrap.setAttribute('aria-labelledby', `materials-group-${group.id}`);
		const head = document.createElement('p');
		head.className = 'materials-group-head';
		head.id = `materials-group-${group.id}`;
		const name = document.createElement('strong');
		name.textContent = group.label;
		const hint = document.createElement('span');
		hint.textContent = group.hint;
		head.append(name, hint);
		const row = document.createElement('div');
		row.className = 'materials-looks';
		for (const look of looks) {
			const b = document.createElement('button');
			b.type = 'button';
			b.className = 'materials-look';
			b.dataset.look = look.id;
			b.setAttribute('aria-pressed', 'false');
			const sw = document.createElement('span');
			sw.className = 'materials-swatch';
			sw.setAttribute('aria-hidden', 'true');
			Object.assign(sw.style, swatchStyle(look));
			const label = document.createElement('span');
			label.textContent = look.label;
			b.append(sw, label);
			b.addEventListener('click', () => applyLook(look));
			row.appendChild(b);
			lookButtons.set(look.id, b);
		}
		wrap.append(head, row);
		groupsHost.appendChild(wrap);
	}

	// ── state ────────────────────────────────────────────────────────────────
	// entries: [{ kind: 'original'|'look'|'ai', label, url, lookId?, base?, title? }]
	// A look is always built from a base: the original or an AI result, never
	// another look, so "Glossy" after "Gold" is glossy paint, not glossy gold.
	let sourceLabel = '';
	let entries = [];
	let active = null;
	let lookToken = 0;
	let aiCtrl = null;
	let elapsedTimer = null;
	let pendingShape = '';
	const bytesCache = new Map();
	const retired = new Set(); // blob URLs another tool may still hold; freed on the next fresh model
	let originalDownload = null; // the page's main Download as forge.js left it

	const isBlob = (url) => typeof url === 'string' && url.startsWith('blob:');
	const isOurs = (url) => entries.some((e) => e.url === url);
	const baseOf = (entry) => (entry.kind === 'look' ? entry.base : entry);

	function setStatus(text, kind = '', link = null) {
		status.textContent = text || '';
		status.dataset.kind = kind;
		if (link) {
			const a = document.createElement('a');
			a.href = link.href;
			a.textContent = link.text;
			status.append(' ', a);
		}
	}

	function slug(text) {
		return (text || '').replace(/[^a-z0-9]+/gi, '-').slice(0, 40).replace(/^-|-$/g, '').toLowerCase();
	}

	function fileNameFor(entry) {
		return `${slug(sourceLabel) || 'forge'}-${slug(entry.label) || 'restyled'}.glb`;
	}

	function loadBytes(url) {
		if (!bytesCache.has(url)) {
			const p = fetch(url, isBlob(url) ? undefined : { headers: CLIENT_HEADERS }).then((res) => {
				if (!res.ok) throw new Error(`source ${res.status}`);
				return res.arrayBuffer();
			});
			p.catch(() => bytesCache.delete(url));
			bytesCache.set(url, p);
		}
		return bytesCache.get(url);
	}

	// ── downloads ────────────────────────────────────────────────────────────
	function restoreMainDownload() {
		if (!mainDownload || !originalDownload) return;
		if (originalDownload.href) mainDownload.setAttribute('href', originalDownload.href);
		else mainDownload.removeAttribute('href');
		mainDownload.setAttribute('download', originalDownload.name);
		mainDownload.textContent = originalDownload.text;
		originalDownload = null;
	}

	function syncDownloads() {
		const onOriginal = !active || active.kind === 'original';
		panelDownload.hidden = onOriginal;
		revertBtn.hidden = onOriginal;
		if (!onOriginal) {
			panelDownload.href = active.url;
			panelDownload.setAttribute('download', fileNameFor(active));
		}
		const remote = active && /^https:\/\//i.test(active.url) ? active.url : '';
		studioLink.hidden = !remote;
		if (remote) studioLink.href = `/restyle?url=${encodeURIComponent(remote)}`;
		if (!mainDownload) return;
		if (onOriginal) {
			restoreMainDownload();
			return;
		}
		if (!originalDownload) {
			originalDownload = {
				href: mainDownload.getAttribute('href'),
				name: mainDownload.getAttribute('download') || 'forge.glb',
				text: mainDownload.textContent,
			};
		}
		mainDownload.setAttribute('href', active.url);
		mainDownload.setAttribute('download', fileNameFor(active));
	}

	// ── rendering ────────────────────────────────────────────────────────────
	function renderLooks() {
		const shown = active?.kind === 'look' ? active.lookId : '';
		for (const [id, b] of lookButtons) b.setAttribute('aria-pressed', String(id === shown));
	}

	function renderHistory() {
		historyHost.replaceChildren();
		if (entries.length < 2) {
			historyHost.hidden = true;
			return;
		}
		historyHost.hidden = false;
		for (const entry of entries) {
			const b = document.createElement('button');
			b.type = 'button';
			b.className = 'materials-step';
			b.dataset.kind = entry.kind;
			b.textContent = entry.kind === 'original' ? 'Original' : entry.label;
			b.title = entry.title || (entry.kind === 'original' ? 'The model as it was generated' : `${entry.label}, applied on this device`);
			if (entry === active) b.setAttribute('aria-current', 'true');
			b.disabled = Boolean(aiCtrl);
			b.addEventListener('click', () => {
				show(entry);
				setStatus(entry.kind === 'original' ? 'Showing the original.' : `Showing ${entry.label}.`);
			});
			historyHost.appendChild(b);
		}
	}

	function show(entry) {
		active = entry;
		lookToken++; // a look still loading for an older pick must not land on top
		viewer.setAttribute('src', entry.url);
		viewer.setAttribute('alt', entry.kind === 'original' ? sourceLabel || '3D model' : `${sourceLabel || '3D model'}: ${entry.label}`);
		syncDownloads();
		renderHistory();
		renderLooks();
	}

	function pushEntry(entry) {
		entries.push(entry);
		while (entries.length > HISTORY_MAX) {
			const drop = entries.find((e) => e.kind !== 'original' && e !== entry && !entries.some((o) => o.base === e));
			if (!drop) break;
			entries = entries.filter((e) => e !== drop);
			if (isBlob(drop.url)) URL.revokeObjectURL(drop.url);
		}
		show(entry);
	}

	// ── preset looks (on this device) ───────────────────────────────────────
	async function applyLook(look) {
		if (!active || aiCtrl) return;
		hidePointer();
		const base = baseOf(active);
		const existing = entries.find((e) => e.kind === 'look' && e.lookId === look.id && e.base === base);
		if (existing) {
			show(existing);
			setStatus(`Showing ${look.label}.`);
			return;
		}
		const token = ++lookToken;
		const b = lookButtons.get(look.id);
		b?.setAttribute('aria-busy', 'true');
		let buffer;
		try {
			buffer = await loadBytes(base.url);
		} catch {
			if (token === lookToken) {
				setStatus('Could not load this model to restyle it. Check your connection, then pick the look again.', 'error');
			}
			return;
		} finally {
			b?.removeAttribute('aria-busy');
		}
		if (token !== lookToken) return;
		let result;
		try {
			result = restyleGlb(buffer, look);
		} catch {
			setStatus('The presets could not read this model’s materials. It may not be a standard .glb file.', 'error');
			return;
		}
		let out = result.buffer;
		try {
			out = stampGlbAttribution(out, { prompt: sourceLabel || undefined });
		} catch {
			// Attribution is a courtesy; an unstampable file still gets its look.
		}
		const url = URL.createObjectURL(new Blob([out], { type: 'model/gltf-binary' }));
		pushEntry({ kind: 'look', lookId: look.id, label: look.label, url, base });
		const n = result.materialsEdited + result.materialsCreated;
		setStatus(`${look.label} applied to ${n} material${n === 1 ? '' : 's'} on this device. Step back any time above.`, 'done');
	}

	// ── AI restyle (free text) ──────────────────────────────────────────────
	function setAiBusy(on) {
		working.hidden = !on;
		applyBtn.disabled = on;
		input.disabled = on;
		panel.dataset.busy = String(on);
		for (const b of lookButtons.values()) b.disabled = on;
		for (const b of historyHost.querySelectorAll('.materials-step')) b.disabled = on;
		clearInterval(elapsedTimer);
		elapsedTimer = null;
		if (on) {
			const started = Date.now();
			const tick = () => {
				workingText.textContent = `AI restyle working, ${Math.round((Date.now() - started) / 1000)} s`;
			};
			tick();
			elapsedTimer = setInterval(tick, 1000);
		}
	}

	function hidePointer() {
		pointer.hidden = true;
		pendingShape = '';
	}

	function showPointer(intent, text) {
		pendingShape = text;
		pointer.dataset.tool = intent.tool;
		pointerText.textContent = intent.message;
		pointerOpen.textContent = intent.label;
		pointer.hidden = false;
		setStatus('');
	}

	function offerPresets() {
		groupsHost.classList.remove('is-offered');
		void groupsHost.offsetWidth;
		groupsHost.classList.add('is-offered');
	}

	async function runAiRestyle(raw, { skipShapeCheck = false } = {}) {
		if (!active || aiCtrl) return;
		const checked = checkInstruction(raw);
		if (!checked.ok) {
			setStatus(checked.message, 'error');
			input.focus();
			return;
		}
		if (!skipShapeCheck) {
			const intent = shapeIntent(checked.text);
			if (intent) {
				showPointer(intent, checked.text);
				return;
			}
		}
		hidePointer();
		const base = baseOf(active);
		const ctrl = new AbortController();
		aiCtrl = ctrl;
		setAiBusy(true);
		setStatus('');
		try {
			const out = await requestServerRestyle({ glbUrl: base.url, instruction: checked.text, headers: CLIENT_HEADERS, signal: ctrl.signal });
			if (aiCtrl !== ctrl) return;
			aiCtrl = null;
			setAiBusy(false);
			const label = out.name || (checked.text.length > 28 ? `${checked.text.slice(0, 27)}…` : checked.text);
			pushEntry({ kind: 'ai', label, url: out.glbUrl, title: `AI restyle: ${checked.text}` });
			input.value = '';
			syncCount();
			setStatus(`${label} applied${out.notes ? `: ${out.notes}` : ''}. Step back any time above.`, 'done');
		} catch (err) {
			if (aiCtrl !== ctrl) return;
			aiCtrl = null;
			setAiBusy(false);
			if (err.code === 'aborted') {
				setStatus('AI restyle cancelled. The model is unchanged.');
			} else {
				const link =
					err.action === 'sign_in'
						? { href: `/login?next=${encodeURIComponent(location.pathname + location.search)}`, text: 'Sign in' }
						: null;
				setStatus(err.message, 'error', link);
				if (err.action === 'edit_input') input.focus();
				if (err.offerPresets) offerPresets();
			}
		}
	}

	function openTool(tool, text) {
		const reveal = (el, focusEl) => {
			el?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
			focusEl?.focus?.({ preventScroll: true });
		};
		if (tool === 'iterate') {
			const iteratePanel = document.getElementById('iterate-panel');
			if (iteratePanel?.classList.contains('is-hidden')) document.getElementById('forge-iterate-btn')?.click();
			const field = document.getElementById('iterate-instruction');
			if (field) field.value = text;
			reveal(iteratePanel, field);
			return Boolean(field);
		}
		if (tool === 'stylize') {
			const stylize = document.getElementById('stylize-panel');
			reveal(stylize, stylize?.querySelector('.stylize-card:not(:disabled)'));
			return Boolean(stylize);
		}
		if (tool === 'refine') {
			document.dispatchEvent(new CustomEvent('forge:refine-here'));
			return true;
		}
		if (tool === 'optimize') {
			const optimize = document.querySelector('.optimize');
			const toggle = optimize?.querySelector('.optimize-toggle');
			if (optimize && optimize.dataset.open !== 'true') toggle?.click();
			reveal(optimize, toggle);
			return Boolean(optimize);
		}
		return false;
	}

	function syncCount() {
		const len = input.value.length;
		countEl.textContent = `${len}/${INSTRUCTION_MAX}`;
		countEl.dataset.near = String(len >= INSTRUCTION_MAX - 30);
	}

	// ── wiring ───────────────────────────────────────────────────────────────
	form.addEventListener('submit', (e) => {
		e.preventDefault();
		runAiRestyle(input.value);
	});
	input.addEventListener('input', () => {
		syncCount();
		if (!pointer.hidden) hidePointer();
	});
	cancelBtn.addEventListener('click', () => aiCtrl?.abort());
	pointerAnyway.addEventListener('click', () => {
		const text = pendingShape;
		hidePointer();
		runAiRestyle(text, { skipShapeCheck: true });
	});
	pointerOpen.addEventListener('click', () => {
		const tool = pointer.dataset.tool;
		const label = pointerOpen.textContent.replace(/^Open\s+/, '');
		const opened = openTool(tool, pendingShape);
		hidePointer();
		setStatus(opened ? `Opened ${label}. The materials stay as they are.` : `${label} is not on this page. Open the model in Forge to use it.`);
	});
	revertBtn.addEventListener('click', () => {
		if (!entries.length) return;
		show(entries[0]);
		setStatus('Showing the original. Your looks are still in the history.');
	});
	btn.addEventListener('click', () => {
		const willShow = panel.classList.contains('is-hidden');
		panel.classList.toggle('is-hidden', !willShow);
		btn.setAttribute('aria-expanded', String(willShow));
		if (willShow) groupsHost.querySelector('.materials-look:not(:disabled)')?.focus();
	});
	groupsHost.addEventListener('animationend', () => groupsHost.classList.remove('is-offered'));

	/**
	 * A model became the one on screen. `fresh` is a new generation or gallery
	 * open (forge.js has already pointed its Download at it); otherwise another
	 * tool showed an edit of its own, which becomes this panel's new original.
	 */
	function onNewSource(url, label, { fresh }) {
		if (!url || (!fresh && url === entries[0]?.url)) return;
		const shown = viewer.getAttribute('src');
		const showingOurLook = isOurs(shown) && shown !== entries[0]?.url;
		lookToken++;
		if (aiCtrl) {
			const ctrl = aiCtrl;
			aiCtrl = null;
			ctrl.abort();
			setAiBusy(false);
		}
		const mainIsOurs = mainDownload && isOurs(mainDownload.getAttribute('href'));
		if (fresh) originalDownload = null;
		else if (mainIsOurs) restoreMainDownload();
		else originalDownload = null;
		for (const e of entries) if (isBlob(e.url) && e.kind !== 'original') retired.add(e.url);
		if (fresh) {
			for (const u of retired) URL.revokeObjectURL(u);
			retired.clear();
			bytesCache.clear();
		}
		sourceLabel = label || '';
		const original = { kind: 'original', label: 'Original', url };
		entries = [original];
		active = original;
		// A fresh model announced without a viewer swap (a local model promoted to
		// a public URL) must not leave a look on screen that is about to be freed.
		if (fresh && showingOurLook) viewer.setAttribute('src', url);
		input.value = '';
		syncCount();
		hidePointer();
		setStatus('');
		syncDownloads();
		renderHistory();
		renderLooks();
		if (fresh) {
			panel.classList.add('is-hidden');
			btn.setAttribute('aria-expanded', 'false');
		}
	}

	const currentLabel = () => document.getElementById('result-label')?.textContent?.trim() || '';

	document.addEventListener('forge:model-ready', (e) => {
		onNewSource(e.detail?.glbUrl, e.detail?.label, { fresh: true });
	});

	const srcObserver = new MutationObserver(() => {
		const url = viewer.getAttribute('src');
		if (!url || isOurs(url)) return;
		onNewSource(url, currentLabel(), { fresh: false });
	});
	srcObserver.observe(viewer, { attributes: true, attributeFilter: ['src'] });

	if (viewer.getAttribute('src')) onNewSource(viewer.getAttribute('src'), currentLabel(), { fresh: true });
}

/** A small CSS sphere that reads like the look: color, shine, metal, glow. */
function swatchStyle(look) {
	const p = look.params;
	const color = look.keepPaint ? '#8f9bb3' : p.color || '#9a9a9a';
	const gloss = 1 - Math.min(1, Math.max(0, p.roughness ?? 0.5));
	const highlight = `rgba(255,255,255,${(0.12 + 0.78 * gloss).toFixed(2)})`;
	const spread = Math.round(14 + 34 * (1 - gloss));
	const shade = (p.metalness ?? 0) > 0.5 ? 'rgba(0,0,0,0.62)' : 'rgba(0,0,0,0.32)';
	const body =
		look.id === 'holographic'
			? 'conic-gradient(from 210deg, #b6a8ff, #7ef9ff, #ffb3f0, #fff7a8, #b6a8ff)'
			: `radial-gradient(circle at 50% 45%, ${color} 38%, ${shade} 100%), ${color}`;
	const style = {
		background: `radial-gradient(circle at 32% 28%, ${highlight} 0, transparent ${spread}%), ${body}`,
	};
	const glows = [];
	if (p.emissive) glows.push(`0 0 7px 1px ${p.emissive}`, `inset 0 0 0 2px ${p.emissive}`);
	if (p.sheen) glows.push('inset 0 0 5px 1px rgba(255,255,255,0.45)');
	if (p.clearcoat) glows.push('inset 0 0 0 1px rgba(255,255,255,0.55)');
	if (p.transmission) {
		style.background = `radial-gradient(circle at 32% 28%, rgba(255,255,255,0.9) 0, transparent 22%), radial-gradient(circle at 50% 50%, rgba(220,240,255,0.18) 45%, rgba(160,200,230,0.55) 100%)`;
		glows.push('inset 0 0 0 1px rgba(200,230,255,0.7)');
	}
	if (glows.length) style.boxShadow = glows.join(', ');
	return style;
}

function injectStyles() {
	if (document.getElementById('forge-materials-styles')) return;
	const style = document.createElement('style');
	style.id = 'forge-materials-styles';
	style.textContent = `
		.materials-panel {
			margin: 0 var(--space-md, 1rem) var(--space-md, 1rem);
			padding: 0.9rem 1rem;
			border: 1px solid var(--stroke);
			border-radius: var(--radius-sm, 8px);
			background: var(--surface, rgba(255,255,255,0.03));
		}
		.materials-panel.is-hidden { display: none; }
		.materials-head h3 { margin: 0 0 0.15rem; font-size: var(--text-md, 1rem); }
		.materials-sub { margin: 0 0 0.75rem; font-size: var(--text-sm, 0.85rem); color: var(--ink-dim); }
		.materials-groups { display: grid; gap: 0.7rem; margin-bottom: 0.8rem; border-radius: var(--radius-sm, 8px); }
		.materials-groups.is-offered { animation: materials-offer 1.2s ease-out 1; }
		@keyframes materials-offer {
			0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 55%, transparent); }
			100% { box-shadow: 0 0 0 10px transparent; }
		}
		.materials-group-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.25rem 0.5rem; margin: 0 0 0.35rem; font-size: var(--text-xs, 0.78rem); }
		.materials-group-head strong { color: var(--ink); font-weight: 600; }
		.materials-group-head span { color: var(--ink-dim); }
		.materials-looks { display: flex; flex-wrap: wrap; gap: 0.4rem; }
		.materials-look {
			display: inline-flex;
			align-items: center;
			gap: 0.4rem;
			min-height: 34px;
			padding: 0.25rem 0.7rem 0.25rem 0.3rem;
			border: 1px solid var(--stroke);
			border-radius: 999px;
			background: transparent;
			color: var(--ink);
			font: inherit;
			font-size: var(--text-xs, 0.78rem);
			cursor: pointer;
			transition: border-color 0.15s ease, background-color 0.15s ease, transform 0.1s ease;
		}
		.materials-look:hover:not(:disabled) { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent); }
		.materials-look:active:not(:disabled) { transform: scale(0.97); }
		.materials-look:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
		.materials-look[aria-pressed='true'] { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 16%, transparent); font-weight: 600; }
		.materials-look[aria-busy='true'] { cursor: progress; }
		.materials-look[aria-busy='true'] .materials-swatch { animation: materials-pulse 0.9s ease-in-out infinite; }
		.materials-look:disabled { opacity: 0.5; cursor: not-allowed; }
		.materials-swatch { flex: none; width: 24px; height: 24px; border-radius: 50%; }
		@keyframes materials-pulse { 50% { opacity: 0.45; } }
		.materials-history {
			display: flex;
			gap: 0.35rem;
			overflow-x: auto;
			padding: 0.5rem 0 0.6rem;
			margin-bottom: 0.6rem;
			border-top: 1px dashed var(--stroke);
			border-bottom: 1px dashed var(--stroke);
			scrollbar-width: thin;
		}
		.materials-history[hidden] { display: none; }
		.materials-step {
			flex: none;
			max-width: 14rem;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
			padding: 0.3rem 0.65rem;
			border: 1px solid var(--stroke);
			border-radius: var(--radius-sm, 8px);
			background: transparent;
			color: var(--ink-dim);
			font: inherit;
			font-size: var(--text-xs, 0.78rem);
			cursor: pointer;
			transition: border-color 0.15s ease, color 0.15s ease;
		}
		.materials-step[data-kind='ai']::before { content: ''; display: inline-block; width: 6px; height: 6px; margin-right: 0.35rem; border-radius: 50%; background: var(--accent); vertical-align: middle; }
		.materials-step:hover:not(:disabled) { border-color: var(--accent); color: var(--ink); }
		.materials-step:active:not(:disabled) { transform: scale(0.97); }
		.materials-step:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
		.materials-step[aria-current='true'] { border-color: var(--accent); color: var(--ink); background: color-mix(in srgb, var(--accent) 14%, transparent); }
		.materials-step:disabled { opacity: 0.5; cursor: not-allowed; }
		.materials-label { display: block; margin-bottom: 0.3rem; font-size: var(--text-xs, 0.78rem); color: var(--ink-dim); }
		.materials-row { display: flex; gap: 0.5rem; }
		.materials-row input {
			flex: 1;
			min-width: 0;
			padding: 0.5rem 0.7rem;
			border: 1px solid var(--stroke);
			border-radius: var(--radius-sm, 8px);
			background: transparent;
			color: var(--ink);
			font: inherit;
			font-size: var(--text-sm, 0.85rem);
		}
		.materials-row input:hover:not(:disabled) { border-color: color-mix(in srgb, var(--accent) 50%, var(--stroke)); }
		.materials-row input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
		.materials-row input:disabled { opacity: 0.6; }
		.materials-meta { display: flex; justify-content: space-between; gap: 0.5rem; margin: 0.3rem 0 0; font-size: var(--text-xs, 0.75rem); color: var(--ink-dim); }
		.materials-count { font-variant-numeric: tabular-nums; }
		.materials-count[data-near='true'] { color: var(--danger); }
		.materials-pointer {
			margin-top: 0.6rem;
			padding: 0.6rem 0.75rem;
			border: 1px solid color-mix(in srgb, var(--accent) 45%, var(--stroke));
			border-radius: var(--radius-sm, 8px);
			background: color-mix(in srgb, var(--accent) 7%, transparent);
			font-size: var(--text-sm, 0.85rem);
		}
		.materials-pointer[hidden] { display: none; }
		.materials-pointer p { margin: 0 0 0.5rem; }
		.materials-pointer-actions { display: flex; flex-wrap: wrap; gap: 0.4rem; }
		.materials-working { display: flex; align-items: center; gap: 0.6rem; margin-top: 0.6rem; font-size: var(--text-xs, 0.8rem); color: var(--ink-dim); }
		.materials-working[hidden] { display: none; }
		.materials-skeleton {
			flex: 1;
			max-width: 10rem;
			height: 8px;
			border-radius: 999px;
			background: linear-gradient(90deg, var(--stroke) 0%, color-mix(in srgb, var(--accent) 40%, var(--stroke)) 50%, var(--stroke) 100%);
			background-size: 200% 100%;
			animation: materials-shimmer 1.4s linear infinite;
		}
		@keyframes materials-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }
		.materials-working-text { font-variant-numeric: tabular-nums; }
		.materials-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.6rem; }
		.materials-actions:not(:has(> :not([hidden]))) { display: none; }
		.materials-actions [hidden] { display: none; }
		.materials-status { margin: 0.5rem 0 0; font-size: var(--text-xs, 0.8rem); color: var(--ink-dim); min-height: 1em; }
		.materials-status[data-kind='error'] { color: var(--danger); }
		.materials-status[data-kind='done'] { color: var(--success); }
		.materials-status a { color: inherit; font-weight: 600; text-decoration: underline; }
		@media (max-width: 520px) {
			.materials-panel { margin: 0 0.5rem 0.75rem; padding: 0.8rem; }
			.materials-row { flex-direction: column; }
			.materials-row .btn { width: 100%; justify-content: center; }
			.materials-look { min-height: 40px; }
			.materials-actions .btn { flex: 1 1 100%; justify-content: center; }
		}
		@media (prefers-reduced-motion: reduce) {
			.materials-skeleton, .materials-groups.is-offered, .materials-look[aria-busy='true'] .materials-swatch { animation: none; }
			.materials-look, .materials-step { transition: none; }
		}
	`;
	document.head.appendChild(style);
}

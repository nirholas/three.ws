// Anatomy page controller: /anatomy (describe + gallery) and /anatomy/:id
// (one machine). A new machine is drawn while Claude writes it: every part
// that finishes streaming is added to the explorer immediately.

import { AnatomyApiError, fetchDesign, fetchGallery, generateDesign } from './api.js';
import { mountAnatomy } from './runtime.js';
import { scanPartialSpec } from './stream.js';

const EXAMPLES = [
	'How a big airliner turbofan like the A380\'s makes thrust',
	'A V8 engine: pistons, crankshaft, cams and valves in time',
	'The escapement and balance wheel inside a mechanical watch',
	'A pressurized water reactor, from core to turbine',
	'A tokamak fusion reactor confining plasma with magnets',
	'A steam locomotive: firebox, boiler, cylinders and drive rods',
	'A Stirling engine running on a candle',
	'A liquid rocket engine with its turbopump',
	'A wind turbine nacelle: rotor, gearbox and generator',
	'A centrifugal water pump',
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STAGE_TEXT = {
	writing: 'Claude is writing the machine',
	repairing: 'Fixing the spec',
	saving: 'Saving',
};

const $ = (sel) => document.querySelector(sel);

const state = {
	app: null,
	design: null,
	busy: false,
	abort: null,
	galleryQuery: '',
	galleryToken: 0,
};

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

let toastTimer = 0;
function toast(message) {
	const node = $('#anpToast');
	node.textContent = message;
	node.hidden = false;
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => (node.hidden = true), 2600);
}

function plural(n, word) {
	return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function relativeTime(iso) {
	const t = Date.parse(iso);
	if (!Number.isFinite(t)) return '';
	const s = Math.max(1, Math.round((Date.now() - t) / 1000));
	if (s < 60) return 'just now';
	const m = Math.round(s / 60);
	if (m < 60) return `${m}m ago`;
	const h = Math.round(m / 60);
	if (h < 48) return `${h}h ago`;
	return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

async function copyText(text, done) {
	try {
		await navigator.clipboard.writeText(text);
		toast(done);
	} catch {
		toast('Copy failed. Your browser blocked clipboard access.');
	}
}

// ── routing ─────────────────────────────────────────────────────────────────

function routeId() {
	const m = location.pathname.match(/^\/anatomy\/([^/]+)\/?$/);
	return m ? m[1] : null;
}

function navigate(path) {
	history.pushState(null, '', path);
	route();
}

function route() {
	const id = routeId();
	if (id) return openDesign(id);
	showHome();
}

function teardownExplorer() {
	state.abort?.abort();
	state.abort = null;
	state.app?.dispose();
	state.app = null;
	state.design = null;
}

// ── home ────────────────────────────────────────────────────────────────────

function showHome() {
	teardownExplorer();
	setBusy(false);
	$('#anpDesign').hidden = true;
	$('#anpHome').hidden = false;
	document.title = 'Anatomy · See how any machine works · three.ws';
	const prefill = new URLSearchParams(location.search).get('prompt');
	if (prefill && !$('#anpPrompt').value) $('#anpPrompt').value = prefill.slice(0, 600);
	loadGallery();
}

function renderExamples() {
	const host = $('#anpExamples');
	host.replaceChildren(
		...EXAMPLES.map((text) =>
			el('button', {
				type: 'button',
				class: 'anp-chip',
				text,
				onclick: () => {
					$('#anpPrompt').value = text;
					startGenerate(text);
				},
			}),
		),
	);
}

function setBusy(busy) {
	state.busy = busy;
	const btn = $('#anpSubmit');
	btn.disabled = busy;
	btn.classList.toggle('is-busy', busy);
	for (const chip of document.querySelectorAll('.anp-chip')) chip.disabled = busy;
}

function galleryCard(d) {
	const s = d.stats || {};
	const facts = [plural(s.instances || s.parts || 0, 'part'), s.moving ? `${s.moving} moving` : null, s.effects ? plural(s.effects, 'effect') : null].filter(Boolean);
	return el(
		'a',
		{ class: 'anp-card', href: `/anatomy/${d.id}`, onclick: (e) => onInternalLink(e, `/anatomy/${d.id}`) },
		el('span', { class: 'anp-card__glyph', 'aria-hidden': 'true' }, el('span'), el('span'), el('span')),
		el('span', { class: 'anp-card__title', text: d.title }),
		d.subtitle ? el('span', { class: 'anp-card__subtitle', text: d.subtitle }) : null,
		el('span', { class: 'anp-card__facts' }, ...facts.map((f) => el('span', { text: f }))),
		el('span', { class: 'anp-card__meta', text: [relativeTime(d.createdAt), d.views ? plural(d.views, 'view') : null].filter(Boolean).join(' · ') }),
	);
}

async function loadGallery() {
	const token = ++state.galleryToken;
	const grid = $('#anpGallery');
	const status = $('#anpGalleryStatus');
	status.hidden = true;
	grid.setAttribute('aria-busy', 'true');
	grid.replaceChildren(...Array.from({ length: 6 }, () => el('div', { class: 'anp-card anp-card--skeleton', 'aria-hidden': 'true' }, el('span'), el('span'), el('span'))));
	try {
		const { designs, storage } = await fetchGallery({ q: state.galleryQuery });
		if (token !== state.galleryToken) return;
		grid.replaceChildren(...designs.map(galleryCard));
		if (!designs.length) {
			status.hidden = false;
			status.replaceChildren(
				el('strong', { text: state.galleryQuery ? `Nothing matches "${state.galleryQuery}" yet.` : storage === false ? 'Saved machines are not available on this deployment.' : 'No machines yet.' }),
				el('span', { text: state.galleryQuery ? 'Build it: type it into the box above.' : 'Pick an example above to build the first one.' }),
			);
		}
	} catch (err) {
		if (token !== state.galleryToken) return;
		grid.replaceChildren();
		status.hidden = false;
		status.replaceChildren(
			el('strong', { text: 'The gallery did not load.' }),
			el('span', { text: err.message || 'Check your connection.' }),
			el('button', { type: 'button', class: 'anp-btn', text: 'Try again', onclick: loadGallery }),
		);
	} finally {
		if (token === state.galleryToken) grid.removeAttribute('aria-busy');
	}
}

function onInternalLink(e, path) {
	if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
	e.preventDefault();
	navigate(path);
}

// ── design view ─────────────────────────────────────────────────────────────

function showDesignShell() {
	$('#anpHome').hidden = true;
	$('#anpDesign').hidden = false;
	$('#anpDesignError').hidden = true;
	$('#anpStage').hidden = false;
	$('#anpWarn').hidden = true;
	$('#anpCopyLink').hidden = true;
	$('#anpCopySpec').hidden = true;
	window.scrollTo(0, 0);
}

function setHeader(title, subtitle, prompt) {
	$('#anpTitle').textContent = title || 'New machine';
	$('#anpSubtitle').textContent = subtitle || '';
	$('#anpSubtitle').hidden = !subtitle;
	const asked = $('#anpAsked');
	asked.hidden = !prompt;
	if (prompt) asked.replaceChildren(el('span', { text: 'Asked for' }), ' ', el('q', { text: prompt }));
	document.title = `${title || 'New machine'} · Anatomy · three.ws`;
}

function setStatus(text) {
	const node = $('#anpStatus');
	node.hidden = !text;
	$('#anpStatusText').textContent = text || '';
}

function ensureExplorer() {
	if (state.app) return state.app;
	const stage = $('#anpStage');
	state.app = mountAnatomy(stage, null, { theme: 'auto' });
	return state.app;
}

function showDesignError(err, { retry } = {}) {
	setStatus('');
	state.app?.dispose();
	state.app = null;
	$('#anpStage').hidden = true;
	$('#anpSkeleton').hidden = true;
	const box = $('#anpDesignError');
	box.hidden = false;
	const notFound = err instanceof AnatomyApiError && err.status === 404;
	box.replaceChildren(
		el('strong', { text: notFound ? 'This machine does not exist.' : 'That did not work.' }),
		el('span', { text: notFound ? 'The link may be mistyped, or the machine was never saved.' : err.message || 'Something went wrong.' }),
		el(
			'div',
			{ class: 'anp-empty__actions' },
			retry ? el('button', { type: 'button', class: 'anp-btn anp-btn--primary', text: 'Try again', onclick: retry }) : null,
			el('a', { class: 'anp-btn', href: '/anatomy', text: 'Back to Anatomy', onclick: (e) => onInternalLink(e, '/anatomy') }),
		),
	);
}

function showDesign(design, warnings = []) {
	state.design = design;
	setHeader(design.title, design.subtitle, design.prompt);
	setStatus('');
	$('#anpSkeleton').hidden = true;
	const app = ensureExplorer();
	app.update(design.spec);
	$('#anpCopySpec').hidden = false;
	$('#anpCopyLink').hidden = !design.url;
	const notes = [];
	if (!design.id) notes.push('Saving is unavailable right now, so this machine has no shareable link. Copy the spec to keep it.');
	if (warnings.some((w) => /ran out of room/.test(w))) notes.push('Claude ran out of room on this one, so a few parts may be missing.');
	$('#anpWarn').hidden = !notes.length;
	$('#anpWarn').textContent = notes.join(' ');
	app.root.focus({ preventScroll: true });
}

async function openDesign(id) {
	teardownExplorer();
	showDesignShell();
	if (!UUID_RE.test(id)) return showDesignError(new AnatomyApiError(404, {}));
	setHeader('Loading machine', '', null);
	$('#anpSkeleton').hidden = false;
	$('#anpSkeletonText').textContent = 'Loading the machine.';
	try {
		const { design } = await fetchDesign(id);
		if (routeId() !== id) return;
		showDesign(design);
	} catch (err) {
		if (routeId() !== id) return;
		showDesignError(err, { retry: () => openDesign(id) });
	}
}

async function startGenerate(promptIn) {
	const prompt = String(promptIn || '').trim();
	const formError = $('#anpFormError');
	formError.hidden = true;
	if (prompt.length < 3) {
		formError.textContent = 'Describe the machine you want to see, for example "a jet engine".';
		formError.hidden = false;
		$('#anpPrompt').focus();
		return;
	}
	if (state.busy) return;

	teardownExplorer();
	setBusy(true);
	history.pushState(null, '', '/anatomy');
	showDesignShell();
	setHeader('New machine', '', prompt);
	$('#anpSkeleton').hidden = false;
	$('#anpSkeletonText').textContent = 'Claude is designing the machine. Parts appear here as they are written.';
	setStatus(STAGE_TEXT.writing);

	const ctrl = new AbortController();
	state.abort = ctrl;
	let lastCounts = '';
	let pendingText = null;
	let raf = 0;
	let stage = 'writing';

	const render = () => {
		raf = 0;
		if (ctrl.signal.aborted || pendingText == null) return;
		const partial = scanPartialSpec(pendingText);
		const counts = `${partial.parts.length}/${partial.effects.length}/${partial.flows.length}/${partial.steps.length}/${partial.title || ''}`;
		if (counts === lastCounts) return;
		lastCounts = counts;
		if (partial.title) setHeader(partial.title, partial.subtitle, prompt);
		if (partial.parts.length) {
			$('#anpSkeleton').hidden = true;
			ensureExplorer().update(partial, { progressive: true });
		}
		const bits = [partial.parts.length ? plural(partial.parts.length, 'part') : null, partial.effects.length ? plural(partial.effects.length, 'effect') : null, partial.steps.length ? plural(partial.steps.length, 'tour step') : null].filter(Boolean);
		setStatus(`${STAGE_TEXT[stage] || STAGE_TEXT.writing}${bits.length ? ` · ${bits.join(', ')}` : ''}`);
	};

	try {
		const result = await generateDesign({
			prompt,
			signal: ctrl.signal,
			onStage: (s) => {
				stage = s;
				setStatus(STAGE_TEXT[s] || STAGE_TEXT.writing);
			},
			onText: (text) => {
				pendingText = text;
				if (!text) {
					lastCounts = '';
					return;
				}
				raf ||= requestAnimationFrame(render);
			},
		});
		if (ctrl.signal.aborted) return;
		cancelAnimationFrame(raf);
		const { design, warnings } = result;
		if (design.id) history.replaceState(null, '', `/anatomy/${design.id}`);
		showDesign(design, warnings || []);
		$('#anpPrompt').value = '';
	} catch (err) {
		if (ctrl.signal.aborted || err?.name === 'AbortError') return;
		cancelAnimationFrame(raf);
		const msg = err instanceof AnatomyApiError && err.status === 429 ? err.message || 'You are building machines quickly. Try again in a few minutes.' : err.message;
		showDesignError(new Error(msg), { retry: err?.status === 429 ? null : () => startGenerate(prompt) });
	} finally {
		if (state.abort === ctrl) state.abort = null;
		setBusy(false);
	}
}

// ── wiring ──────────────────────────────────────────────────────────────────

function init() {
	renderExamples();
	const form = $('#anpForm');
	const input = $('#anpPrompt');
	form.addEventListener('submit', (e) => {
		e.preventDefault();
		startGenerate(input.value);
	});
	input.addEventListener('keydown', (e) => {
		if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			startGenerate(input.value);
		}
	});
	let searchTimer = 0;
	$('#anpSearchInput').addEventListener('input', (e) => {
		clearTimeout(searchTimer);
		searchTimer = setTimeout(() => {
			state.galleryQuery = e.target.value.trim();
			loadGallery();
		}, 250);
	});
	$('#anpSearch').addEventListener('submit', (e) => e.preventDefault());
	$('#anpCopyLink').addEventListener('click', () => state.design?.url && copyText(state.design.url, 'Link copied'));
	$('#anpCopySpec').addEventListener('click', () => state.app && copyText(JSON.stringify(state.app.spec, null, 2), 'Spec copied as JSON'));
	for (const link of [$('#anpNew'), document.querySelector('.anp-back')]) {
		link.addEventListener('click', (e) => onInternalLink(e, '/anatomy'));
	}
	window.addEventListener('popstate', route);
	route();
}

init();

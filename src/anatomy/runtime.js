// Anatomy runtime: mounts a full interactive machine explorer for one spec.
//
// The mount function returns a controller. Its update method takes a grown
// spec while one streams in (progressive mode keeps the camera steady), and
// dispose tears everything down.
//
// The same runtime powers /anatomy, /anatomy/:id permalinks and the standalone
// HTML the agent skill writes (via the /anatomy-runtime.js bundle).

import { AnatomyViewer } from './viewer.js';
import { normalizeSpec } from './spec.js';

const ICONS = {
	play: '<path d="M7 5v14l11-7z" fill="currentColor"/>',
	pause: '<path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/>',
	explode: '<path d="M12 3v5M12 16v5M3 12h5M16 12h5M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
	section: '<path d="M4 4h16v16H4z" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M12 4v16" stroke="currentColor" stroke-width="1.8" stroke-dasharray="2 2"/><path d="M12 4h8v16h-8z" fill="currentColor" opacity=".25"/>',
	xray: '<circle cx="12" cy="12" r="7.5" stroke="currentColor" stroke-width="1.6" fill="none"/><circle cx="12" cy="12" r="3.5" stroke="currentColor" stroke-width="1.6" fill="none" stroke-dasharray="2 1.6"/>',
	labels: '<path d="M4 6h10l4 4-4 4H4z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/><path d="M7 18h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
	reset: '<path d="M5 12a7 7 0 1 0 2.1-5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M4 4v4h4" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
	camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.5" stroke="currentColor" stroke-width="1.6" fill="none"/>',
	full: '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/>',
	eye: '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12z" stroke="currentColor" stroke-width="1.6" fill="none"/><circle cx="12" cy="12" r="2.8" fill="currentColor"/>',
	eyeOff: '<path d="M3 3l18 18M10.6 6.1A10.7 10.7 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3.1 3.7M6.5 7.6C3.8 9.3 2 12 2 12s3.6 6 10 6c1.6 0 3-.4 4.2-.9" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linecap="round"/>',
	tour: '<path d="M5 4h11l3 3v13H5z" stroke="currentColor" stroke-width="1.6" fill="none" stroke-linejoin="round"/><path d="M8 10h8M8 14h8M8 18h5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
	prev: '<path d="M15 5l-7 7 7 7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
	next: '<path d="M9 5l7 7-7 7" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
	close: '<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
	spin: '<path d="M20 12a8 8 0 1 1-3-6.2" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M18 3v4h-4" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>',
	panel: '<rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" stroke-width="1.6" fill="none"/><path d="M15 4v16" stroke="currentColor" stroke-width="1.6"/>',
};

const icon = (name) => `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;

function h(tag, attrs = {}, children = []) {
	const el = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (v == null || v === false) continue;
		if (k === 'class') el.className = v;
		else if (k === 'html') el.innerHTML = v;
		else if (k === 'text') el.textContent = v;
		else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
		else el.setAttribute(k, v === true ? '' : v);
	}
	for (const c of [].concat(children)) if (c != null) el.append(c);
	return el;
}

const SHAPE_NAMES = {
	box: 'Block',
	cylinder: 'Cylinder',
	tube: 'Tube',
	cone: 'Cone',
	sphere: 'Sphere',
	capsule: 'Capsule',
	torus: 'Ring',
	gear: 'Gear',
	rotor: 'Bladed rotor',
	lathe: 'Turned profile',
	extrude: 'Extruded profile',
	spring: 'Spring',
	pipe: 'Pipe',
};

function describeMotion(m) {
	if (m.type === 'spin') {
		const rpm = Math.abs(m.speed) * 60;
		return `Spins about ${m.axis.toUpperCase()} (${rpm >= 10 ? Math.round(rpm) : rpm.toFixed(1)} rpm shown)`;
	}
	if (m.type === 'oscillate') return m.kind === 'rotate' ? `Rocks ±${Math.abs(m.amplitude)}° about ${m.axis.toUpperCase()}` : `Reciprocates along ${m.axis.toUpperCase()}`;
	if (m.type === 'crank') return `Driven by a crank along ${m.axis.toUpperCase()} (stroke ${(m.radius * 2).toFixed(2)})`;
	if (m.type === 'pulse') return 'Pulses';
	return '';
}

function paragraphs(text) {
	const frag = document.createDocumentFragment();
	for (const p of String(text || '').split(/\n{2,}/)) if (p.trim()) frag.append(h('p', { text: p.trim() }));
	return frag;
}

/**
 * Mount the explorer. `spec` may be raw (it is normalized here) or already
 * normalized. Options:
 *   theme      'auto' | 'dark' | 'light'
 *   compact    start with the side panel collapsed (embeds, narrow screens)
 *   header     render the title block inside the explorer (standalone pages)
 *   onSelect   (partId|null) => void
 */
export function mountAnatomy(el, specIn, opts = {}) {
	const root = h('div', { class: 'anx', tabindex: '0', role: 'application', 'aria-label': 'Machine explorer' });
	const stage = h('div', { class: 'anx-stage' });
	const tooltip = h('div', { class: 'anx-tooltip', role: 'status', hidden: true });
	const side = h('aside', { class: 'anx-side', 'aria-label': 'Parts and tour' });
	const toolbar = h('div', { class: 'anx-toolbar', role: 'toolbar', 'aria-label': 'View controls' });
	const tourCard = h('section', { class: 'anx-tour', hidden: true, 'aria-live': 'polite' });
	const hint = h('div', { class: 'anx-hint', text: 'Drag to rotate · Scroll to zoom · Click a part' });
	const header = opts.header ? h('header', { class: 'anx-header' }) : null;
	stage.append(tooltip, tourCard, hint);
	root.append(...[header, stage, side, toolbar].filter(Boolean));
	el.append(root);

	let spec = null;
	let selected = null;
	let step = -1;
	let explodeTarget = 0;
	let explodeValue = 0;
	let explodeRaf = 0;
	const compact = opts.compact ?? window.matchMedia?.('(max-width: 760px)').matches;
	if (compact) root.classList.add('is-collapsed');

	const viewer = new AnatomyViewer(stage, {
		theme: opts.theme || 'auto',
		onHover: (id, ev) => showTooltip(id, ev),
		onSelect: (id) => select(id),
	});

	// ------------------------------------------------------------- toolbar

	const btn = (name, label, onClick, extra = {}) => h('button', { type: 'button', class: 'anx-btn', 'aria-label': label, title: label, html: icon(name), onclick: onClick, ...extra });
	const playBtn = btn('pause', 'Pause (Space)', () => setPlaying(!viewer.state.playing), { 'aria-pressed': 'true' });
	const speedSel = h('select', { class: 'anx-select', 'aria-label': 'Animation speed', title: 'Animation speed' }, [
		...[0.1, 0.25, 0.5, 1, 2].map((s) => h('option', { value: String(s), text: `${s}x`, selected: s === 1 })),
	]);
	speedSel.addEventListener('change', () => viewer.setSpeed(Number(speedSel.value)));
	const explodeInput = h('input', { type: 'range', min: '0', max: '1', step: '0.01', value: '0', class: 'anx-range', 'aria-label': 'Explode parts' });
	explodeInput.addEventListener('input', () => {
		explodeTarget = explodeValue = Number(explodeInput.value);
		viewer.setExplode(explodeValue);
		explodeBtn.setAttribute('aria-pressed', String(explodeValue > 0));
	});
	const explodeBtn = btn('explode', 'Explode view (E)', () => animateExplode(explodeTarget > 0 ? 0 : 0.8), { 'aria-pressed': 'false' });
	const sectionSel = h('select', { class: 'anx-select', 'aria-label': 'Section cut axis', title: 'Section cut' }, [
		h('option', { value: '', text: 'No cut' }),
		h('option', { value: 'z', text: 'Cut Z' }),
		h('option', { value: 'x', text: 'Cut X' }),
		h('option', { value: 'y', text: 'Cut Y' }),
	]);
	const sectionInput = h('input', { type: 'range', min: '0', max: '1', step: '0.005', value: '0.5', class: 'anx-range', 'aria-label': 'Section cut position', disabled: true });
	sectionSel.addEventListener('change', () => applySectionUI(sectionSel.value || null));
	sectionInput.addEventListener('input', () => viewer.setSection(viewer.state.section, Number(sectionInput.value)));
	const xrayBtn = btn('xray', 'X-ray (X)', () => toggle(xrayBtn, (on) => viewer.setXray(on)), { 'aria-pressed': 'false' });
	const labelsBtn = btn('labels', 'Labels (L)', () => toggle(labelsBtn, (on) => viewer.setLabels(on)), { 'aria-pressed': 'true' });
	const viewSel = h('select', { class: 'anx-select', 'aria-label': 'Camera view', title: 'Camera view' }, [
		h('option', { value: 'iso', text: 'Isometric' }),
		h('option', { value: 'front', text: 'Front' }),
		h('option', { value: 'side', text: 'Side' }),
		h('option', { value: 'top', text: 'Top' }),
	]);
	viewSel.addEventListener('change', () => viewer.setView(viewSel.value));
	const resetBtn = btn('reset', 'Reset view (R)', () => {
		viewSel.value = 'iso';
		viewer.resetView();
	});
	const shotBtn = btn('camera', 'Save image', () => saveImage());
	const fullBtn = btn('full', 'Fullscreen (F)', () => toggleFullscreen());
	const panelBtn = btn('panel', 'Toggle parts panel', () => {
		root.classList.toggle('is-collapsed');
		panelBtn.setAttribute('aria-pressed', String(!root.classList.contains('is-collapsed')));
	}, { 'aria-pressed': String(!compact) });

	toolbar.append(
		h('div', { class: 'anx-tgroup' }, [playBtn, speedSel]),
		h('div', { class: 'anx-tgroup' }, [explodeBtn, explodeInput]),
		h('div', { class: 'anx-tgroup' }, [h('span', { class: 'anx-ticon', html: icon('section') }), sectionSel, sectionInput]),
		h('div', { class: 'anx-tgroup' }, [xrayBtn, labelsBtn, viewSel, resetBtn]),
		h('div', { class: 'anx-tgroup anx-tgroup-end' }, [shotBtn, fullBtn, panelBtn]),
	);

	function toggle(button, fn) {
		const on = button.getAttribute('aria-pressed') !== 'true';
		button.setAttribute('aria-pressed', String(on));
		fn(on);
	}

	function setPlaying(on) {
		viewer.setPlaying(on);
		playBtn.innerHTML = icon(on ? 'pause' : 'play');
		playBtn.setAttribute('aria-pressed', String(on));
		playBtn.setAttribute('aria-label', on ? 'Pause (Space)' : 'Play (Space)');
		playBtn.title = on ? 'Pause (Space)' : 'Play (Space)';
	}

	function animateExplode(to) {
		explodeTarget = to;
		explodeBtn.setAttribute('aria-pressed', String(to > 0));
		cancelAnimationFrame(explodeRaf);
		const from = explodeValue;
		const start = performance.now();
		const run = (now) => {
			const k = Math.min(1, (now - start) / 650);
			const e = 1 - (1 - k) ** 3;
			explodeValue = from + (to - from) * e;
			viewer.setExplode(explodeValue);
			explodeInput.value = String(explodeValue);
			if (k < 1) explodeRaf = requestAnimationFrame(run);
		};
		explodeRaf = requestAnimationFrame(run);
	}

	function applySectionUI(axis) {
		sectionSel.value = axis || '';
		sectionInput.disabled = !axis;
		viewer.setSection(axis, Number(sectionInput.value));
	}

	async function saveImage() {
		shotBtn.disabled = true;
		try {
			const blob = await viewer.screenshot();
			if (!blob) throw new Error('The browser could not capture the canvas.');
			const a = h('a', { href: URL.createObjectURL(blob), download: `${(spec?.title || 'machine').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png` });
			document.body.append(a);
			a.click();
			a.remove();
			setTimeout(() => URL.revokeObjectURL(a.href), 4000);
		} catch (err) {
			flash(err.message || 'Could not save the image.');
		} finally {
			shotBtn.disabled = false;
		}
	}

	function toggleFullscreen() {
		if (document.fullscreenElement) document.exitFullscreen?.();
		else root.requestFullscreen?.().catch(() => flash('Fullscreen is blocked in this frame.'));
	}

	const flashEl = h('div', { class: 'anx-flash', role: 'alert', hidden: true });
	stage.append(flashEl);
	let flashTimer = 0;
	function flash(msg) {
		flashEl.textContent = msg;
		flashEl.hidden = false;
		clearTimeout(flashTimer);
		flashTimer = setTimeout(() => (flashEl.hidden = true), 3200);
	}

	// ------------------------------------------------------------- tooltip

	let lastTip = null;
	function showTooltip(id, ev) {
		if (!id || !spec || !ev) {
			tooltip.hidden = true;
			lastTip = null;
			return;
		}
		const part = spec.parts.find((p) => p.id === id);
		if (!part) return;
		if (lastTip !== id) {
			tooltip.replaceChildren(h('strong', { text: part.name }), part.group ? h('span', { class: 'anx-tip-group', text: part.group }) : null);
			lastTip = id;
		}
		const rect = stage.getBoundingClientRect();
		const x = ev.clientX - rect.left;
		const y = ev.clientY - rect.top;
		tooltip.hidden = false;
		const flip = x > rect.width - 220;
		tooltip.style.transform = `translate(${flip ? x - tooltip.offsetWidth - 14 : x + 14}px, ${y + 14}px)`;
	}

	// ----------------------------------------------------------- side panel

	const tabs = h('div', { class: 'anx-tabs', role: 'tablist' });
	const partsTab = h('button', { type: 'button', class: 'anx-tab', role: 'tab', 'aria-selected': 'true', text: 'Parts' });
	const tourTab = h('button', { type: 'button', class: 'anx-tab', role: 'tab', 'aria-selected': 'false', text: 'How it works' });
	tabs.append(partsTab, tourTab);
	const partsPane = h('div', { class: 'anx-pane', role: 'tabpanel' });
	const tourPane = h('div', { class: 'anx-pane', role: 'tabpanel', hidden: true });
	const inspector = h('section', { class: 'anx-inspector', hidden: true, 'aria-live': 'polite' });
	side.append(tabs, inspector, partsPane, tourPane);
	const showTab = (which) => {
		partsTab.setAttribute('aria-selected', String(which === 'parts'));
		tourTab.setAttribute('aria-selected', String(which === 'tour'));
		partsPane.hidden = which !== 'parts';
		tourPane.hidden = which !== 'tour';
	};
	partsTab.addEventListener('click', () => showTab('parts'));
	tourTab.addEventListener('click', () => showTab('tour'));

	const rowById = new Map();
	function renderParts() {
		rowById.clear();
		const groups = new Map();
		for (const p of spec.parts) {
			const g = p.group || 'Parts';
			if (!groups.has(g)) groups.set(g, []);
			groups.get(g).push(p);
		}
		const frag = document.createDocumentFragment();
		for (const [g, list] of groups) {
			const ul = h('ul', { class: 'anx-plist' });
			for (const p of list) {
				const color = viewer.parts.get(p.id)?.color.getStyle() || '#888';
				const vis = h('button', { type: 'button', class: 'anx-eye', 'aria-label': `Hide ${p.name}`, title: 'Hide', html: icon('eye') });
				vis.addEventListener('click', (e) => {
					e.stopPropagation();
					const hidden = !viewer.hidden.has(p.id);
					viewer.setPartVisible(p.id, !hidden);
					vis.innerHTML = icon(hidden ? 'eyeOff' : 'eye');
					vis.setAttribute('aria-label', `${hidden ? 'Show' : 'Hide'} ${p.name}`);
					vis.title = hidden ? 'Show' : 'Hide';
					row.classList.toggle('is-hidden', hidden);
				});
				const count = p.repeat?.count > 1 ? h('span', { class: 'anx-count', text: `×${p.repeat.count}` }) : null;
				const moving = p.motion.length ? h('span', { class: 'anx-moving', title: 'Moves', html: icon('spin') }) : null;
				const name = h('button', { type: 'button', class: 'anx-pname' }, [h('span', { class: 'anx-swatch', style: `--c:${color}` }), h('span', { class: 'anx-ptext', text: p.name }), count, moving]);
				name.addEventListener('click', () => select(selected === p.id ? null : p.id, { focus: true }));
				name.addEventListener('mouseenter', () => viewer.setHover(p.id));
				name.addEventListener('mouseleave', () => viewer.setHover(null));
				const row = h('li', { class: 'anx-prow', 'data-part': p.id }, [name, vis]);
				if (viewer.hidden.has(p.id)) row.classList.add('is-hidden');
				rowById.set(p.id, row);
				ul.append(row);
			}
			frag.append(h('div', { class: 'anx-pgroup' }, [h('h3', { class: 'anx-gtitle', text: `${g}`, 'data-count': String(list.length) }), ul]));
		}
		const extras = [...spec.effects.map((e) => ['Effect', e]), ...spec.flows.map((f) => ['Flow', f])];
		if (extras.length) {
			const ul = h('ul', { class: 'anx-plist' });
			for (const [kind, e] of extras) {
				const b = h('button', { type: 'button', class: 'anx-pname' }, [h('span', { class: 'anx-swatch is-fx', style: `--c:${e.color}` }), h('span', { class: 'anx-ptext', text: e.name }), h('span', { class: 'anx-count', text: kind === 'Flow' ? 'flow' : e.type })]);
				b.addEventListener('click', () => {
					selectExtra(e, kind);
				});
				ul.append(h('li', { class: 'anx-prow' }, [b]));
			}
			frag.append(h('div', { class: 'anx-pgroup' }, [h('h3', { class: 'anx-gtitle', text: 'Effects and flows', 'data-count': String(extras.length) }), ul]));
		}
		partsPane.replaceChildren(frag);
		if (selected && rowById.has(selected)) rowById.get(selected).classList.add('is-selected');
	}

	function renderInspector(item, kind) {
		if (!item) {
			inspector.hidden = true;
			return;
		}
		const meta = [];
		if (kind === 'part') {
			meta.push(SHAPE_NAMES[item.shape.type] || item.shape.type);
			if (item.repeat?.count > 1) meta.push(`${item.repeat.count} copies`);
			for (const m of item.motion) meta.push(describeMotion(m));
		} else meta.push(kind === 'Flow' ? 'Flow path' : `${item.type[0].toUpperCase()}${item.type.slice(1)} effect`);
		const close = h('button', { type: 'button', class: 'anx-btn anx-btn-sm', 'aria-label': 'Close details', html: icon('close'), onclick: () => select(null) });
		inspector.replaceChildren(
			h('div', { class: 'anx-ihead' }, [h('div', {}, [item.group ? h('div', { class: 'anx-eyebrow', text: item.group }) : null, h('h2', { class: 'anx-ititle', text: item.name })]), close]),
			h('div', { class: 'anx-imeta' }, meta.filter(Boolean).map((m) => h('span', { text: m }))),
			item.description ? h('div', { class: 'anx-ibody' }, [paragraphs(item.description)]) : h('p', { class: 'anx-ibody anx-muted', text: 'No description for this part.' }),
		);
		inspector.hidden = false;
	}

	function select(id, { focus = false } = {}) {
		if (!spec) return;
		selected = id && spec.parts.some((p) => p.id === id) ? id : null;
		viewer.setSelected(selected);
		for (const [pid, row] of rowById) row.classList.toggle('is-selected', pid === selected);
		renderInspector(selected ? spec.parts.find((p) => p.id === selected) : null, 'part');
		if (selected) {
			showTab('parts');
			if (root.classList.contains('is-collapsed') && !compact) root.classList.remove('is-collapsed');
			rowById.get(selected)?.scrollIntoView({ block: 'nearest' });
		}
		if (focus && step < 0) viewer.focusOn(selected ? [selected] : null);
		opts.onSelect?.(selected);
	}

	function selectExtra(item, kind) {
		selected = null;
		viewer.setSelected(null);
		for (const row of rowById.values()) row.classList.remove('is-selected');
		renderInspector(item, kind);
		if (step < 0) viewer.focusOn([item.id]);
	}

	// ---------------------------------------------------------------- tour

	function renderTourPane() {
		if (!spec.steps.length) {
			tourPane.replaceChildren(h('p', { class: 'anx-muted anx-pad', text: 'This machine has no guided tour. Click any part to read what it does.' }));
			tourTab.hidden = true;
			return;
		}
		tourTab.hidden = false;
		const start = h('button', { type: 'button', class: 'anx-cta', html: `${icon('tour')}<span>Start the tour</span>`, onclick: () => setStep(0) });
		const ol = h('ol', { class: 'anx-steps' });
		spec.steps.forEach((s, i) => {
			const b = h('button', { type: 'button', class: 'anx-step', onclick: () => setStep(i) }, [h('span', { class: 'anx-stepn', text: String(i + 1) }), h('span', { text: s.title })]);
			if (i === step) b.classList.add('is-active');
			ol.append(h('li', {}, [b]));
		});
		tourPane.replaceChildren(h('div', { class: 'anx-pad' }, [spec.summary ? h('div', { class: 'anx-summary' }, [paragraphs(spec.summary)]) : null, start]), ol);
	}

	function setStep(i) {
		if (!spec?.steps.length) return;
		if (i < 0 || i >= spec.steps.length) {
			step = -1;
			tourCard.hidden = true;
			viewer.setFocus(null);
			root.classList.remove('is-touring');
			renderTourPane();
			return;
		}
		step = i;
		const s = spec.steps[i];
		root.classList.add('is-touring');
		viewer.setFocus(s.focus);
		const prev = h('button', { type: 'button', class: 'anx-btn', 'aria-label': 'Previous step', html: icon('prev'), disabled: i === 0, onclick: () => setStep(i - 1) });
		const last = i === spec.steps.length - 1;
		const next = h('button', { type: 'button', class: 'anx-btn anx-btn-primary', 'aria-label': last ? 'Finish tour' : 'Next step', html: last ? '<span>Done</span>' : icon('next'), onclick: () => setStep(last ? -1 : i + 1) });
		const exit = h('button', { type: 'button', class: 'anx-btn anx-btn-sm', 'aria-label': 'Exit tour', html: icon('close'), onclick: () => setStep(-1) });
		const dots = h('div', { class: 'anx-dots', 'aria-hidden': 'true' }, spec.steps.map((_, k) => h('span', { class: k === i ? 'is-on' : '' })));
		tourCard.replaceChildren(
			h('div', { class: 'anx-tour-head' }, [h('span', { class: 'anx-eyebrow', text: `Step ${i + 1} of ${spec.steps.length}` }), exit]),
			h('h2', { class: 'anx-tour-title', text: s.title }),
			h('div', { class: 'anx-tour-body' }, [paragraphs(s.body)]),
			h('div', { class: 'anx-tour-foot' }, [dots, h('div', { class: 'anx-tour-nav' }, [prev, next])]),
		);
		tourCard.hidden = false;
		renderTourPane();
	}

	// ---------------------------------------------------------------- header

	function renderHeader() {
		if (!header) return;
		header.replaceChildren(h('h1', { class: 'anx-title', text: spec.title }), spec.subtitle ? h('p', { class: 'anx-subtitle', text: spec.subtitle }) : null);
	}

	// ------------------------------------------------------------- keyboard

	function onKey(e) {
		if (e.target.closest('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
		const k = e.key;
		if (k === ' ') setPlaying(!viewer.state.playing);
		else if (k === 'ArrowRight' && spec?.steps.length) setStep(step < 0 ? 0 : Math.min(step + 1, spec.steps.length - 1));
		else if (k === 'ArrowLeft' && step > 0) setStep(step - 1);
		else if (k === 'Escape') {
			if (step >= 0) setStep(-1);
			else select(null, { focus: true });
		} else if (k === 'e' || k === 'E') animateExplode(explodeTarget > 0 ? 0 : 0.8);
		else if (k === 'x' || k === 'X') xrayBtn.click();
		else if (k === 'l' || k === 'L') labelsBtn.click();
		else if (k === 'r' || k === 'R') resetBtn.click();
		else if (k === 'f' || k === 'F') toggleFullscreen();
		else return;
		e.preventDefault();
	}
	root.addEventListener('keydown', onKey);
	const onFs = () => root.classList.toggle('is-fullscreen', document.fullscreenElement === root);
	document.addEventListener('fullscreenchange', onFs);

	// ---------------------------------------------------------------- load

	function update(next, { progressive = false } = {}) {
		const normalized = next?.version && Array.isArray(next.parts) && next.view ? next : normalizeSpec(next, { strict: !progressive }).spec;
		spec = normalized;
		const res = viewer.load(spec, { progressive });
		if (!progressive) {
			if (spec.view.explode > 0 && explodeTarget === 0) animateExplode(spec.view.explode);
			else viewer.setExplode(explodeValue);
			if (spec.view.section && !viewer.state.section) applySectionUI(spec.view.section);
		} else viewer.setExplode(explodeValue);
		if (selected && !spec.parts.some((p) => p.id === selected)) selected = null;
		if (step >= spec.steps.length) step = -1;
		renderParts();
		renderTourPane();
		renderHeader();
		root.classList.toggle('has-tour', spec.steps.length > 0);
		if (res.truncated) flash('This machine is very large; some repeated copies were left out.');
		return res;
	}

	if (specIn) update(specIn);

	return {
		viewer,
		root,
		update,
		select,
		setStep,
		get spec() {
			return spec;
		},
		dispose() {
			cancelAnimationFrame(explodeRaf);
			clearTimeout(flashTimer);
			document.removeEventListener('fullscreenchange', onFs);
			viewer.dispose();
			root.remove();
		},
	};
}

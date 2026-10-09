// Forge Workflows: the canvas editor.
//
// A DOM node layer plus one SVG layer for links, both inside a "world" element
// that is panned and zoomed with a single CSS transform. Nodes are real DOM, so
// they are focusable, labelled and readable by assistive tech; the inspector
// offers keyboard-only linking for every input port.
//
// The editor never mutates the workflow it is given. Every edit goes through
// opts.commit(nextWorkflow, label), which owns undo history and autosave.

import { canConnect, connect, findPort, inputPorts, outputPorts, createNode } from './graph.js';
import { PALETTE } from './node-types.js';
import { h, svg, icon, ICONS } from './ui.js';

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2;
const GRID = 8;

const TYPE_LABEL = { image: 'image', text: 'text', mesh: '3D model' };

/**
 * @param {HTMLElement} root  the canvas element
 * @param {object} opts
 * @param {object} opts.types
 * @param {() => object} opts.getWorkflow
 * @param {() => object} opts.getContext            live catalog / Modly context for summaries
 * @param {(wf:object, label:string) => void} opts.commit
 * @param {(sel:{nodes:string[], edge:string|null}) => void} opts.onSelect
 * @param {(message:string) => void} opts.onError
 * @param {(nodeId:string) => HTMLElement} opts.resultHost   persistent per-node result element
 */
export function createEditor(root, opts) {
	const { types } = opts;
	const view = { x: 40, y: 40, z: 1 };
	const selection = { nodes: new Set(), edge: null };
	let nodeStatus = new Map();
	let issuesByNode = new Map();
	let drag = null;

	const world = h('div', { class: 'fw-world' });
	const edgeLayer = svg('svg', { class: 'fw-edges', width: 1, height: 1, 'aria-hidden': 'true' });
	const nodeLayer = h('div', { class: 'fw-nodes' });
	world.append(edgeLayer, nodeLayer);
	root.append(world);

	const nodeEls = new Map();
	const tempPath = svg('path', { class: 'fw-edge is-temp' });

	// ── View transform ──────────────────────────────────────────────────────
	function applyView() {
		world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`;
		root.style.setProperty('--fw-grid', `${24 * view.z}px`);
		root.style.backgroundPosition = `${view.x}px ${view.y}px`;
		root.dataset.zoom = String(Math.round(view.z * 100));
		opts.onView?.(view.z);
	}

	function toWorld(clientX, clientY) {
		const r = root.getBoundingClientRect();
		return { x: (clientX - r.left - view.x) / view.z, y: (clientY - r.top - view.y) / view.z };
	}

	function zoomAt(factor, clientX, clientY) {
		const r = root.getBoundingClientRect();
		const cx = clientX ?? r.left + r.width / 2;
		const cy = clientY ?? r.top + r.height / 2;
		const before = toWorld(cx, cy);
		view.z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.z * factor));
		view.x = cx - r.left - before.x * view.z;
		view.y = cy - r.top - before.y * view.z;
		applyView();
	}

	function fit() {
		const wf = opts.getWorkflow();
		const r = root.getBoundingClientRect();
		if (!wf.nodes.length || !r.width) {
			view.x = 40;
			view.y = 40;
			view.z = 1;
			applyView();
			return;
		}
		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		for (const n of wf.nodes) {
			const el = nodeEls.get(n.id);
			const w = el?.offsetWidth || 220;
			const ht = el?.offsetHeight || 140;
			minX = Math.min(minX, n.x);
			minY = Math.min(minY, n.y);
			maxX = Math.max(maxX, n.x + w);
			maxY = Math.max(maxY, n.y + ht);
		}
		const pad = 48;
		const z = Math.min(1.1, Math.max(MIN_ZOOM, Math.min((r.width - pad * 2) / (maxX - minX), (r.height - pad * 2) / (maxY - minY))));
		view.z = z;
		view.x = (r.width - (maxX - minX) * z) / 2 - minX * z;
		view.y = (r.height - (maxY - minY) * z) / 2 - minY * z;
		applyView();
	}

	/** World coordinates of the visible centre, for placing a new node. */
	function centerPoint() {
		const r = root.getBoundingClientRect();
		const p = toWorld(r.left + r.width / 2, r.top + r.height / 2);
		const wf = opts.getWorkflow();
		let x = Math.round((p.x - 110) / GRID) * GRID;
		let y = Math.round((p.y - 60) / GRID) * GRID;
		// Step diagonally so repeated adds do not stack exactly on top of each other.
		while (wf.nodes.some((n) => Math.abs(n.x - x) < 16 && Math.abs(n.y - y) < 16)) {
			x += 24;
			y += 24;
		}
		return { x, y };
	}

	// ── Rendering ───────────────────────────────────────────────────────────
	function portRow(node, port, dir) {
		const row = h(
			'div',
			{ class: `fw-port is-${dir}`, dataset: { node: node.id, port: port.id, dir, type: port.type } },
			h('span', { class: 'fw-port-dot', title: `${port.label || port.id}: ${TYPE_LABEL[port.type]}${port.optional ? ' (optional)' : ''}` }),
			h('span', { class: 'fw-port-label' }, port.label || port.id, port.optional ? h('span', { class: 'fw-port-opt' }, ' optional') : null),
		);
		return row;
	}

	function buildNode(node) {
		const def = types[node.type];
		const ctx = opts.getContext();
		const ins = inputPorts(def, node.params);
		const outs = outputPorts(def, node.params);
		const el = h(
			'div',
			{
				class: `fw-node cat-${def?.category || 'unknown'}`,
				tabindex: 0,
				role: 'group',
				'aria-roledescription': 'workflow node',
				'aria-label': `${def?.label || node.type} node`,
				dataset: { id: node.id, type: node.type },
			},
			h(
				'div',
				{ class: 'fw-node-head' },
				h('span', { class: 'fw-node-dot', 'aria-hidden': 'true' }),
				h('span', { class: 'fw-node-title' }, def?.label || node.type),
				h('span', { class: 'fw-node-badge', 'aria-live': 'polite' }),
			),
			h(
				'div',
				{ class: 'fw-node-ports' },
				h('div', { class: 'fw-node-ins' }, ins.map((p) => portRow(node, p, 'in'))),
				h('div', { class: 'fw-node-outs' }, outs.map((p) => portRow(node, p, 'out'))),
			),
			h('div', { class: 'fw-node-summary' }, def?.summary ? def.summary(node.params || {}, ctx) : ''),
			h('div', { class: 'fw-node-progress', hidden: true }, h('div', { class: 'fw-bar' }, h('span')), h('div', { class: 'fw-progress-label' })),
			h('div', { class: 'fw-node-issue', hidden: true }),
		);
		el.append(opts.resultHost(node.id));
		el.style.transform = `translate(${node.x}px, ${node.y}px)`;
		return el;
	}

	// The parts of a node card that need a rebuild when they change. Anything
	// else (position, summary) is patched in place, so a live 3D preview inside
	// the card is never torn down by an unrelated edit.
	function shapeKey(node) {
		const def = types[node.type];
		const ports = (list) => list.map((p) => `${p.id}:${p.type}:${p.label || ''}:${p.optional ? 1 : 0}`).join(',');
		return `${node.type}|${ports(inputPorts(def, node.params))}|${ports(outputPorts(def, node.params))}`;
	}

	function render() {
		const wf = opts.getWorkflow();
		const ctx = opts.getContext();
		const live = new Set();
		for (const n of wf.nodes) {
			live.add(n.id);
			const key = shapeKey(n);
			let el = nodeEls.get(n.id);
			if (!el || el.dataset.shape !== key) {
				const fresh = buildNode(n);
				fresh.dataset.shape = key;
				if (el) el.replaceWith(fresh);
				else nodeLayer.append(fresh);
				el = fresh;
				nodeEls.set(n.id, el);
			} else {
				el.style.transform = `translate(${n.x}px, ${n.y}px)`;
				const def = types[n.type];
				el.querySelector('.fw-node-summary').textContent = def?.summary ? def.summary(n.params || {}, ctx) : '';
			}
		}
		for (const [id, el] of nodeEls) {
			if (live.has(id)) continue;
			el.remove();
			nodeEls.delete(id);
		}
		for (const id of [...selection.nodes]) if (!nodeEls.has(id)) selection.nodes.delete(id);
		if (selection.edge && !wf.edges.some((e) => e.id === selection.edge)) selection.edge = null;
		paintSelection();
		paintStatus();
		paintIssues();
		drawEdges();
	}

	function portCenter(nodeId, portId, dir, positions) {
		const el = nodeEls.get(nodeId);
		const dot = el?.querySelector(`.fw-port[data-dir="${dir}"][data-port="${CSS.escape(portId)}"] .fw-port-dot`);
		if (!dot) return null;
		let x = dot.offsetWidth / 2;
		let y = dot.offsetHeight / 2;
		for (let cur = dot; cur && cur !== el; cur = cur.offsetParent) {
			x += cur.offsetLeft;
			y += cur.offsetTop;
		}
		const pos = positions?.get(nodeId) || opts.getWorkflow().nodes.find((n) => n.id === nodeId);
		return { x: pos.x + x, y: pos.y + y };
	}

	function curve(a, b) {
		const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
		return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
	}

	function edgeState(e) {
		const src = nodeStatus.get(e.from.node)?.status;
		const dst = nodeStatus.get(e.to.node)?.status;
		if (dst === 'running') return 'is-flowing';
		if (src === 'done' && (dst === 'done' || dst === 'partial')) return 'is-done';
		return '';
	}

	function drawEdges(positions) {
		const wf = opts.getWorkflow();
		edgeLayer.textContent = '';
		for (const e of wf.edges) {
			const a = portCenter(e.from.node, e.from.port, 'out', positions);
			const b = portCenter(e.to.node, e.to.port, 'in', positions);
			if (!a || !b) continue;
			const type = findPort(types, wf.nodes.find((n) => n.id === e.from.node), e.from.port, 'out')?.type || 'mesh';
			const d = curve(a, b);
			const hit = svg('path', { class: 'fw-edge-hit', d });
			hit.dataset.edge = e.id;
			const path = svg('path', { class: `fw-edge type-${type} ${edgeState(e)} ${selection.edge === e.id ? 'is-selected' : ''}`, d });
			path.dataset.edge = e.id;
			edgeLayer.append(path, hit);
		}
		if (drag?.kind === 'connect') edgeLayer.append(tempPath);
	}

	function paintSelection() {
		for (const [id, el] of nodeEls) el.classList.toggle('is-selected', selection.nodes.has(id));
	}

	function paintStatus() {
		for (const [id, el] of nodeEls) {
			const s = nodeStatus.get(id);
			const status = s?.status || 'idle';
			el.dataset.status = status;
			const badge = el.querySelector('.fw-node-badge');
			const label = STATUS_LABEL[status] || '';
			const count = s && s.total > 1 ? ` ${s.done}/${s.total}` : '';
			badge.textContent = label ? `${label}${count}` : '';
			badge.className = `fw-node-badge is-${status}`;
			const prog = el.querySelector('.fw-node-progress');
			const p = s?.running?.progress;
			if (status === 'running') {
				prog.hidden = false;
				const bar = prog.querySelector('.fw-bar');
				bar.classList.toggle('is-indeterminate', p?.pct == null);
				bar.firstChild.style.transform = `scaleX(${p?.pct != null ? p.pct / 100 : 1})`;
				prog.querySelector('.fw-progress-label').textContent = progressText(p, s);
			} else if (!prog.hidden) {
				prog.hidden = true;
				prog.querySelector('.fw-progress-label').textContent = '';
			}
		}
	}

	function paintIssues() {
		for (const [id, el] of nodeEls) {
			const list = issuesByNode.get(id) || [];
			const errors = list.filter((i) => i.level !== 'warning');
			el.classList.toggle('has-error', errors.length > 0);
			el.classList.toggle('has-warning', !errors.length && list.length > 0);
			const box = el.querySelector('.fw-node-issue');
			box.hidden = !list.length;
			box.textContent = list.length ? list[0].message.replace(/^[^:]+:\s*/, '') : '';
		}
	}

	// ── Interaction ─────────────────────────────────────────────────────────
	function select(ids, { additive = false } = {}) {
		if (!additive) selection.nodes.clear();
		for (const id of ids) {
			if (additive && selection.nodes.has(id)) selection.nodes.delete(id);
			else selection.nodes.add(id);
		}
		selection.edge = null;
		paintSelection();
		drawEdges();
		opts.onSelect({ nodes: [...selection.nodes], edge: null });
	}

	function selectEdge(id) {
		selection.nodes.clear();
		selection.edge = id;
		paintSelection();
		drawEdges();
		opts.onSelect({ nodes: [], edge: id });
	}

	function clearSelection() {
		if (!selection.nodes.size && !selection.edge) return;
		selection.nodes.clear();
		selection.edge = null;
		paintSelection();
		drawEdges();
		opts.onSelect({ nodes: [], edge: null });
	}

	function markTargets(from) {
		const wf = opts.getWorkflow();
		for (const el of root.querySelectorAll('.fw-port')) {
			const dir = el.dataset.dir;
			el.classList.remove('is-target-ok', 'is-target-bad');
			if (dir === from.dir) continue;
			const pair = from.dir === 'out' ? [{ node: from.node, port: from.port }, { node: el.dataset.node, port: el.dataset.port }] : [{ node: el.dataset.node, port: el.dataset.port }, { node: from.node, port: from.port }];
			const ok = canConnect(wf, types, pair[0], pair[1]).ok;
			el.classList.add(ok ? 'is-target-ok' : 'is-target-bad');
		}
		root.classList.add('is-connecting');
	}

	function clearTargets() {
		for (const el of root.querySelectorAll('.is-target-ok, .is-target-bad')) el.classList.remove('is-target-ok', 'is-target-bad');
		root.classList.remove('is-connecting');
	}

	root.addEventListener('pointerdown', (ev) => {
		if (ev.button !== 0 && ev.pointerType === 'mouse') return;
		closeQuickAdd();
		const portDot = ev.target.closest('.fw-port-dot');
		const nodeEl = ev.target.closest('.fw-node');
		const edgeHit = ev.target.closest('.fw-edge-hit');
		const interactive = ev.target.closest('a, button, input, select, textarea, model-viewer, .fw-result');

		if (portDot) {
			ev.preventDefault();
			startConnect(portDot.closest('.fw-port'), ev);
			return;
		}
		if (interactive) return;
		if (edgeHit) {
			selectEdge(edgeHit.dataset.edge);
			return;
		}
		if (nodeEl) {
			const id = nodeEl.dataset.id;
			if (ev.shiftKey || ev.metaKey || ev.ctrlKey) {
				select([id], { additive: true });
				return;
			}
			if (!selection.nodes.has(id)) select([id]);
			startMove(ev);
			return;
		}
		clearSelection();
		root.focus({ preventScroll: true });
		drag = { kind: 'pan', startX: ev.clientX, startY: ev.clientY, vx: view.x, vy: view.y, pointerId: ev.pointerId };
		root.setPointerCapture(ev.pointerId);
		root.classList.add('is-panning');
	});

	function startMove(ev) {
		const wf = opts.getWorkflow();
		const start = toWorld(ev.clientX, ev.clientY);
		const origin = new Map(wf.nodes.filter((n) => selection.nodes.has(n.id)).map((n) => [n.id, { x: n.x, y: n.y }]));
		drag = { kind: 'move', start, origin, moved: false, pointerId: ev.pointerId, positions: null };
		root.setPointerCapture(ev.pointerId);
	}

	function startConnect(portEl, ev) {
		const wf = opts.getWorkflow();
		let from = { node: portEl.dataset.node, port: portEl.dataset.port, dir: portEl.dataset.dir, type: portEl.dataset.type };
		let detached = null;
		// Grabbing a linked input picks the link up from its source, so it can be
		// moved to another input or dropped on empty canvas to delete it.
		if (from.dir === 'in') {
			const existing = wf.edges.find((e) => e.to.node === from.node && e.to.port === from.port);
			if (existing) {
				detached = existing;
				const srcNode = wf.nodes.find((n) => n.id === existing.from.node);
				from = { node: existing.from.node, port: existing.from.port, dir: 'out', type: findPort(types, srcNode, existing.from.port, 'out')?.type };
			}
		}
		const anchor = portCenter(from.node, from.port, from.dir);
		drag = { kind: 'connect', from, anchor, detached, pointerId: ev.pointerId };
		root.setPointerCapture(ev.pointerId);
		if (detached) {
			const without = { ...wf, edges: wf.edges.filter((e) => e.id !== detached.id) };
			drag.base = without;
		}
		markTargets(from);
		tempPath.setAttribute('class', `fw-edge is-temp type-${from.type}`);
		updateTemp(ev);
		drawEdges();
	}

	function updateTemp(ev) {
		const p = toWorld(ev.clientX, ev.clientY);
		const { anchor, from } = drag;
		tempPath.setAttribute('d', from.dir === 'out' ? curve(anchor, p) : curve(p, anchor));
	}

	root.addEventListener('pointermove', (ev) => {
		if (!drag || ev.pointerId !== drag.pointerId) return;
		if (drag.kind === 'pan') {
			view.x = drag.vx + ev.clientX - drag.startX;
			view.y = drag.vy + ev.clientY - drag.startY;
			applyView();
		} else if (drag.kind === 'move') {
			const p = toWorld(ev.clientX, ev.clientY);
			const dx = p.x - drag.start.x;
			const dy = p.y - drag.start.y;
			if (!drag.moved && Math.hypot(dx, dy) < 3) return;
			drag.moved = true;
			const positions = new Map(opts.getWorkflow().nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
			for (const [id, o] of drag.origin) {
				const x = Math.round((o.x + dx) / GRID) * GRID;
				const y = Math.round((o.y + dy) / GRID) * GRID;
				positions.set(id, { x, y });
				const el = nodeEls.get(id);
				if (el) el.style.transform = `translate(${x}px, ${y}px)`;
			}
			drag.positions = positions;
			root.classList.add('is-dragging');
			drawEdges(positions);
		} else if (drag.kind === 'connect') {
			updateTemp(ev);
			const over = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.fw-port');
			for (const el of root.querySelectorAll('.fw-port.is-hover')) el.classList.remove('is-hover');
			over?.classList.add('is-hover');
		}
	});

	function endDrag(ev) {
		if (!drag || ev.pointerId !== drag.pointerId) return;
		const d = drag;
		drag = null;
		try {
			root.releasePointerCapture(ev.pointerId);
		} catch {
			// Capture was already released by the browser.
		}
		root.classList.remove('is-panning', 'is-dragging');
		if (d.kind === 'move' && d.moved && d.positions) {
			const wf = opts.getWorkflow();
			const nodes = wf.nodes.map((n) => (d.origin.has(n.id) ? { ...n, ...d.positions.get(n.id) } : n));
			opts.commit({ ...wf, nodes }, d.origin.size > 1 ? 'Move nodes' : 'Move node');
		} else if (d.kind === 'connect') {
			clearTargets();
			for (const el of root.querySelectorAll('.fw-port.is-hover')) el.classList.remove('is-hover');
			finishConnect(d, ev);
		}
	}
	root.addEventListener('pointerup', endDrag);
	root.addEventListener('pointercancel', (ev) => {
		if (drag?.kind === 'connect') clearTargets();
		endDrag(ev);
		render();
	});

	function finishConnect(d, ev) {
		const base = d.base || opts.getWorkflow();
		const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('.fw-port');
		if (target && target.dataset.dir !== d.from.dir) {
			const pair = d.from.dir === 'out' ? [{ node: d.from.node, port: d.from.port }, { node: target.dataset.node, port: target.dataset.port }] : [{ node: target.dataset.node, port: target.dataset.port }, { node: d.from.node, port: d.from.port }];
			const res = connect(base, types, pair[0], pair[1]);
			if (res.error) {
				opts.onError(res.error);
				drawEdges();
				return;
			}
			opts.commit(res.workflow, 'Link nodes');
			return;
		}
		if (d.detached) {
			opts.commit(base, 'Remove link');
			return;
		}
		if (!target && d.from.dir === 'out') {
			openQuickAdd(d.from, ev);
			return;
		}
		drawEdges();
	}

	// Drop a link on empty canvas: offer the nodes that can take it.
	let quickAdd = null;
	function openQuickAdd(from, ev) {
		const wf = opts.getWorkflow();
		const at = toWorld(ev.clientX, ev.clientY);
		const choices = [];
		for (const group of PALETTE) {
			for (const type of group.types) {
				const def = types[type];
				const probe = createNode(types, type, at);
				const port = inputPorts(def, probe.params).find((p) => p.type === from.type);
				if (port) choices.push({ type, def, port: port.id });
			}
		}
		if (!choices.length) {
			drawEdges();
			return;
		}
		const r = root.getBoundingClientRect();
		const menu = h(
			'div',
			{ class: 'fw-quickadd', role: 'menu', 'aria-label': `Add a node that takes ${TYPE_LABEL[from.type]}`, style: { left: `${ev.clientX - r.left}px`, top: `${ev.clientY - r.top}px` } },
			h('div', { class: 'fw-quickadd-title' }, `Add a step that takes ${TYPE_LABEL[from.type]}`),
			choices.map((c) =>
				h(
					'button',
					{
						type: 'button',
						role: 'menuitem',
						class: `fw-quickadd-item cat-${c.def.category}`,
						on: {
							click: () => {
								const node = createNode(types, c.type, { x: Math.round(at.x / GRID) * GRID, y: Math.round((at.y - 30) / GRID) * GRID });
								const added = { ...wf, nodes: [...wf.nodes, node] };
								const res = connect(added, types, { node: from.node, port: from.port }, { node: node.id, port: c.port });
								closeQuickAdd();
								opts.commit(res.workflow, `Add ${c.def.label}`);
								select([node.id]);
							},
						},
					},
					h('span', { class: 'fw-node-dot', 'aria-hidden': 'true' }),
					c.def.label,
				),
			),
		);
		menu.addEventListener('keydown', (e) => {
			const items = [...menu.querySelectorAll('button')];
			const i = items.indexOf(document.activeElement);
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				items[(i + 1) % items.length].focus();
			} else if (e.key === 'ArrowUp') {
				e.preventDefault();
				items[(i - 1 + items.length) % items.length].focus();
			} else if (e.key === 'Escape') {
				e.preventDefault();
				closeQuickAdd();
				root.focus();
			}
		});
		root.append(menu);
		quickAdd = menu;
		menu.querySelector('button')?.focus();
		drawEdges();
	}
	function closeQuickAdd() {
		quickAdd?.remove();
		quickAdd = null;
	}

	root.addEventListener(
		'wheel',
		(ev) => {
			if (ev.target.closest('.fw-result model-viewer, .fw-quickadd')) return;
			ev.preventDefault();
			if (ev.ctrlKey || ev.metaKey) {
				zoomAt(Math.exp(-ev.deltaY * 0.0025), ev.clientX, ev.clientY);
			} else {
				view.x -= ev.deltaX;
				view.y -= ev.deltaY;
				applyView();
			}
		},
		{ passive: false },
	);

	root.addEventListener('focusin', (ev) => {
		const nodeEl = ev.target.closest?.('.fw-node');
		if (nodeEl && ev.target === nodeEl && !selection.nodes.has(nodeEl.dataset.id)) select([nodeEl.dataset.id]);
	});

	// Drop from the palette.
	root.addEventListener('dragover', (ev) => {
		if (ev.dataTransfer?.types?.includes('application/x-fw-node')) {
			ev.preventDefault();
			ev.dataTransfer.dropEffect = 'copy';
		}
	});
	root.addEventListener('drop', (ev) => {
		const type = ev.dataTransfer?.getData('application/x-fw-node');
		if (!type || !types[type]) return;
		ev.preventDefault();
		const p = toWorld(ev.clientX, ev.clientY);
		addNode(type, { x: Math.round((p.x - 110) / GRID) * GRID, y: Math.round((p.y - 24) / GRID) * GRID });
	});

	function addNode(type, at = centerPoint()) {
		const wf = opts.getWorkflow();
		const node = createNode(types, type, at);
		opts.commit({ ...wf, nodes: [...wf.nodes, node] }, `Add ${types[type].label}`);
		select([node.id]);
		nodeEls.get(node.id)?.focus({ preventScroll: true });
		return node;
	}

	/** Move the selected nodes with the keyboard. */
	function nudge(dx, dy) {
		if (!selection.nodes.size) return false;
		const wf = opts.getWorkflow();
		const nodes = wf.nodes.map((n) => (selection.nodes.has(n.id) ? { ...n, x: n.x + dx, y: n.y + dy } : n));
		opts.commit({ ...wf, nodes }, 'Move node');
		return true;
	}

	function focusNode(id) {
		const wf = opts.getWorkflow();
		const n = wf.nodes.find((x) => x.id === id);
		const el = nodeEls.get(id);
		if (!n || !el) return;
		const r = root.getBoundingClientRect();
		view.x = r.width / 2 - (n.x + el.offsetWidth / 2) * view.z;
		view.y = r.height / 2 - (n.y + el.offsetHeight / 2) * view.z;
		applyView();
		select([id]);
		el.focus({ preventScroll: true });
	}

	applyView();

	return {
		render,
		fit,
		zoomIn: () => zoomAt(1.2),
		zoomOut: () => zoomAt(1 / 1.2),
		addNode,
		nudge,
		focusNode,
		select,
		clearSelection,
		get selection() {
			return { nodes: [...selection.nodes], edge: selection.edge };
		},
		setStatus(map) {
			nodeStatus = map;
			paintStatus();
			drawEdges();
		},
		setIssues(issues) {
			issuesByNode = new Map();
			for (const i of issues) {
				if (!i.nodeId) continue;
				if (!issuesByNode.has(i.nodeId)) issuesByNode.set(i.nodeId, []);
				issuesByNode.get(i.nodeId).push(i);
			}
			paintIssues();
		},
		/** Refresh summaries without a full rebuild (live catalog arrived). */
		refreshSummaries() {
			const wf = opts.getWorkflow();
			const ctx = opts.getContext();
			for (const n of wf.nodes) {
				const el = nodeEls.get(n.id);
				const def = types[n.type];
				if (el && def?.summary) el.querySelector('.fw-node-summary').textContent = def.summary(n.params || {}, ctx);
			}
		},
		get zoom() {
			return view.z;
		},
	};
}

const STATUS_LABEL = {
	pending: 'Waiting',
	running: 'Running',
	done: 'Done',
	partial: 'Partial',
	failed: 'Failed',
	cancelled: 'Cancelled',
	skipped: 'Skipped',
};

export function progressText(p, s) {
	if (!p) return s?.total > 1 ? `Item ${(s.running?.iter ?? 0) + 1} of ${s.total}` : 'Starting';
	const parts = [p.label || 'Working'];
	if (p.pct != null) parts.push(`${p.estimate ? '~' : ''}${p.pct}%`);
	if (p.elapsed != null) {
		if (!p.eta) parts.push(`${p.elapsed}s`);
		else if (p.elapsed > p.eta) parts.push(`${p.elapsed}s, taking longer than usual`);
		else parts.push(`${p.elapsed}s of ~${p.eta}s`);
	}
	if (s?.total > 1) parts.push(`item ${(s.running?.iter ?? 0) + 1}/${s.total}`);
	return parts.join(' · ');
}

export { icon, ICONS };

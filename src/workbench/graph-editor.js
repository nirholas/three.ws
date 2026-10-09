// Node-graph editor for Workbench workflows.
//
// Drag a node by its header, drag the canvas to pan, drag from an output dot
// to an input dot to wire them (or click one then the other, which also works
// from the keyboard). Clicking a wired input dot unplugs it. Delete removes the
// selected node. Every change is validated and reported through onChange.

import { NODE_TYPES, removeNode, validate } from './workflows.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const X_ICON =
	'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

function summary(node) {
	const p = node.params || {};
	switch (node.type) {
		case 'image':
			return 'Photo or prompt';
		case 'generate':
			return [p.backend === 'auto' || !p.backend ? 'Auto engine' : p.backend, p.tier, p.resolution && `${p.resolution} grid`]
				.filter(Boolean)
				.join(' · ');
		case 'rembg':
			return p.model;
		case 'restyle':
			return `"${String(p.instruction || '').slice(0, 26)}"`;
		case 'remesh':
			return `${p.mode} · ${Number(p.target_faces).toLocaleString()} faces`;
		case 'decimate':
			return `keep ${Math.round(Number(p.ratio) * 100)}%`;
		case 'smooth':
			return `${p.iterations} passes`;
		case 'rig':
			return 'Skeleton + skin weights';
		case 'output':
			return 'Viewport + history';
		default:
			return '';
	}
}

export function mountGraphEditor(graphEl, { onChange, onStatus }) {
	const layer = document.createElement('div');
	layer.className = 'wb-graph-layer';
	const svg = document.createElementNS(SVG_NS, 'svg');
	svg.classList.add('wires');
	svg.setAttribute('aria-hidden', 'true');
	layer.appendChild(svg);
	graphEl.appendChild(layer);
	graphEl.tabIndex = 0;

	let flow = null;
	let pan = { x: 0, y: 0 };
	let selected = null;
	let pendingFrom = null;
	let pendingPath = null;
	const nodeEls = new Map();

	const applyPan = () => (layer.style.transform = `translate(${pan.x}px, ${pan.y}px)`);

	function portPoint(nodeId, dir) {
		const el = nodeEls.get(nodeId)?.querySelector(`.port.${dir} .dot`);
		if (!el) return null;
		const r = el.getBoundingClientRect();
		const base = layer.getBoundingClientRect();
		return { x: r.left + r.width / 2 - base.left, y: r.top + r.height / 2 - base.top };
	}

	function curve(a, b) {
		const dx = Math.max(40, Math.abs(b.x - a.x) * 0.5);
		return `M${a.x},${a.y} C${a.x + dx},${a.y} ${b.x - dx},${b.y} ${b.x},${b.y}`;
	}

	function drawWires() {
		svg.querySelectorAll('path:not(.pending)').forEach((p) => p.remove());
		for (const e of flow.edges) {
			const a = portPoint(e.from, 'out');
			const b = portPoint(e.to, 'in');
			if (!a || !b) continue;
			const path = document.createElementNS(SVG_NS, 'path');
			path.setAttribute('d', curve(a, b));
			svg.insertBefore(path, svg.firstChild);
		}
	}

	function report() {
		const result = validate(flow);
		const bad = new Set(result.errors.map((e) => e.nodeId).filter(Boolean));
		for (const [id, el] of nodeEls) el.dataset.invalid = String(bad.has(id));
		onStatus?.(result);
		return result;
	}

	function commit() {
		report();
		onChange?.(flow);
	}

	function select(id) {
		selected = id;
		for (const [nid, el] of nodeEls) el.dataset.selected = String(nid === id);
	}

	function cancelPending() {
		pendingFrom = null;
		pendingPath?.remove();
		pendingPath = null;
		graphEl.classList.remove('is-wiring');
	}

	function connect(fromId, toId) {
		const a = flow.nodes.find((n) => n.id === fromId);
		const b = flow.nodes.find((n) => n.id === toId);
		if (!a || !b || a.id === b.id) return;
		const outT = NODE_TYPES[a.type].out;
		const inT = NODE_TYPES[b.type].in;
		if (outT !== inT) {
			onStatus?.({ ok: false, errors: [{ message: `${NODE_TYPES[a.type].label} outputs ${outT}; ${NODE_TYPES[b.type].label} takes ${inT}.` }] });
			return;
		}
		flow.edges = flow.edges.filter((e) => e.from !== a.id && e.to !== b.id);
		flow.edges.push({ from: a.id, to: b.id });
		drawWires();
		commit();
	}

	function startWire(nodeId, ev) {
		cancelPending();
		pendingFrom = nodeId;
		graphEl.classList.add('is-wiring');
		pendingPath = document.createElementNS(SVG_NS, 'path');
		pendingPath.classList.add('pending');
		svg.appendChild(pendingPath);
		if (!ev) return;
		const a = portPoint(nodeId, 'out');
		const base = layer.getBoundingClientRect();
		const startX = ev.clientX;
		const startY = ev.clientY;
		let moved = false;
		const move = (e) => {
			if (Math.hypot(e.clientX - startX, e.clientY - startY) > 4) moved = true;
			pendingPath.setAttribute('d', curve(a, { x: e.clientX - base.left, y: e.clientY - base.top }));
		};
		const up = (e) => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
			if (!moved) return; // a click: stay in click-to-connect mode
			const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('.port.in .dot');
			const toId = target?.closest('.wb-gnode')?.dataset.id;
			const from = pendingFrom;
			cancelPending();
			if (toId) connect(from, toId);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}

	function dragNode(node, el, ev) {
		const sx = ev.clientX;
		const sy = ev.clientY;
		const ox = node.x;
		const oy = node.y;
		el.setPointerCapture(ev.pointerId);
		const move = (e) => {
			node.x = Math.round(ox + e.clientX - sx);
			node.y = Math.round(oy + e.clientY - sy);
			el.style.left = `${node.x}px`;
			el.style.top = `${node.y}px`;
			drawWires();
		};
		const up = () => {
			el.removeEventListener('pointermove', move);
			el.removeEventListener('pointerup', up);
			if (node.x !== ox || node.y !== oy) onChange?.(flow);
		};
		el.addEventListener('pointermove', move);
		el.addEventListener('pointerup', up);
	}

	function nodeElement(node) {
		const t = NODE_TYPES[node.type];
		const el = document.createElement('div');
		el.className = 'wb-gnode';
		el.dataset.id = node.id;
		el.dataset.type = node.type;
		el.style.left = `${node.x}px`;
		el.style.top = `${node.y}px`;
		el.setAttribute('role', 'group');
		el.setAttribute('aria-label', `${t.label} node`);

		const head = document.createElement('header');
		head.innerHTML = `<i aria-hidden="true"></i><span>${t.label}</span>`;
		if (!t.locked) {
			const del = document.createElement('button');
			del.type = 'button';
			del.innerHTML = X_ICON;
			del.setAttribute('aria-label', `Remove ${t.label}`);
			del.addEventListener('click', () => {
				removeNode(flow, node.id);
				render(flow);
				commit();
			});
			head.appendChild(del);
		}
		head.addEventListener('pointerdown', (ev) => {
			if (ev.target.closest('button')) return;
			select(node.id);
			dragNode(node, head, ev);
		});

		const ports = document.createElement('div');
		ports.className = 'ports';
		const inPort = document.createElement('div');
		inPort.className = 'port in';
		if (t.in) {
			const dot = document.createElement('button');
			dot.type = 'button';
			dot.className = 'dot';
			dot.setAttribute('aria-label', `${t.label} input (${t.in}). Click to connect or unplug.`);
			dot.addEventListener('click', () => {
				if (pendingFrom) {
					const from = pendingFrom;
					cancelPending();
					connect(from, node.id);
					return;
				}
				const before = flow.edges.length;
				flow.edges = flow.edges.filter((e) => e.to !== node.id);
				if (flow.edges.length !== before) {
					drawWires();
					commit();
				}
			});
			inPort.append(dot, t.in);
		}
		const outPort = document.createElement('div');
		outPort.className = 'port out';
		if (t.out) {
			const dot = document.createElement('button');
			dot.type = 'button';
			dot.className = 'dot';
			dot.setAttribute('aria-label', `${t.label} output (${t.out}). Drag or click, then pick an input.`);
			dot.addEventListener('pointerdown', (ev) => {
				ev.stopPropagation();
				startWire(node.id, ev);
			});
			dot.addEventListener('keydown', (ev) => {
				if (ev.key === 'Enter' || ev.key === ' ') {
					ev.preventDefault();
					startWire(node.id, null);
					onStatus?.({ ok: true, errors: [], hint: `Wiring from ${t.label}. Pick an input dot, or press Escape.` });
				}
			});
			outPort.append(t.out, dot);
		}
		ports.append(inPort, outPort);

		const sub = document.createElement('div');
		sub.className = 'sub';
		sub.textContent = summary(node);
		if (!t.locked && node.enabled === false) sub.textContent += ' · off';

		el.append(head, ports, sub);
		el.addEventListener('pointerdown', () => select(node.id));
		return el;
	}

	function render(next) {
		flow = next;
		cancelPending();
		for (const el of nodeEls.values()) el.remove();
		nodeEls.clear();
		for (const node of flow.nodes) {
			const el = nodeElement(node);
			nodeEls.set(node.id, el);
			layer.appendChild(el);
		}
		select(flow.nodes.some((n) => n.id === selected) ? selected : null);
		requestAnimationFrame(drawWires);
		report();
	}

	// Pan by dragging empty canvas.
	graphEl.addEventListener('pointerdown', (ev) => {
		if (ev.target !== graphEl && ev.target !== layer && ev.target !== svg) return;
		if (pendingFrom) cancelPending();
		select(null);
		const sx = ev.clientX - pan.x;
		const sy = ev.clientY - pan.y;
		graphEl.setPointerCapture(ev.pointerId);
		graphEl.classList.add('is-panning');
		const move = (e) => {
			pan = { x: e.clientX - sx, y: e.clientY - sy };
			applyPan();
		};
		const up = () => {
			graphEl.classList.remove('is-panning');
			graphEl.removeEventListener('pointermove', move);
			graphEl.removeEventListener('pointerup', up);
		};
		graphEl.addEventListener('pointermove', move);
		graphEl.addEventListener('pointerup', up);
	});

	graphEl.addEventListener('keydown', (ev) => {
		if (ev.key === 'Escape' && pendingFrom) {
			cancelPending();
			report();
			return;
		}
		if ((ev.key === 'Delete' || ev.key === 'Backspace') && selected && !ev.target.closest('input, textarea')) {
			const node = flow.nodes.find((n) => n.id === selected);
			if (!node || NODE_TYPES[node.type].locked) return;
			ev.preventDefault();
			removeNode(flow, selected);
			selected = null;
			render(flow);
			commit();
		}
	});

	const ro = new ResizeObserver(() => flow && drawWires());
	ro.observe(graphEl);

	return {
		render,
		resetView() {
			pan = { x: 0, y: 0 };
			applyPan();
		},
		redraw: () => flow && drawWires(),
		destroy: () => ro.disconnect(),
	};
}

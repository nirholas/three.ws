// Desktop icon layer: grid-snapped icons with click/Ctrl/Shift selection,
// rubber-band (marquee) selection on the empty desktop, group drag and drop,
// keyboard navigation and persisted placement. Geometry lives in layout.js.

import {
	ICON_SIZES,
	addIcons,
	arrangeIcons,
	cellAt,
	gridSize,
	iconsInRect,
	marqueeRect,
	moveIcons,
	reflowIcons,
	sanitizeIcons,
} from './layout.js';

const PAD = 8;
const DRAG_PX = 5;

export function createIconLayer({ host, resolve, isKnown, defaults, load, save, launch, menu, size }) {
	let items = [];
	let selected = new Set();
	let anchor = null;
	let grid = { cols: 1, rows: 1 };
	let cell = ICON_SIZES[size] || ICON_SIZES.medium;
	let tileFn = () => '';
	const els = new Map();

	const marquee = document.createElement('div');
	marquee.className = 'os-marquee';
	marquee.hidden = true;

	const area = () => ({ w: Math.max(0, host.clientWidth - PAD * 2), h: Math.max(0, host.clientHeight - PAD * 2) });
	const origin = { x: PAD, y: PAD };
	const local = (e) => {
		const r = host.getBoundingClientRect();
		return { x: e.clientX - r.left, y: e.clientY - r.top };
	};
	const persist = () => save(items.map(({ id, col, row }) => ({ id, col, row })));

	function measure() {
		cell = ICON_SIZES[size] || ICON_SIZES.medium;
		const a = area();
		grid = gridSize(a.w, a.h, cell);
		host.style.setProperty('--icon-w', `${cell.w}px`);
		host.style.setProperty('--icon-h', `${cell.h}px`);
		host.style.setProperty('--icon-tile', `${cell.tile}px`);
	}

	function place(el, it) {
		el.style.transform = `translate(${origin.x + it.col * cell.w}px, ${origin.y + it.row * cell.h}px)`;
	}

	function paintSelection() {
		els.forEach((el, id) => {
			const on = selected.has(id);
			el.classList.toggle('is-sel', on);
			el.setAttribute('aria-selected', String(on));
		});
	}

	function build(it) {
		const app = resolve(it.id);
		if (!app) return null;
		const b = document.createElement('button');
		b.type = 'button';
		b.className = 'os-icon';
		b.dataset.id = it.id;
		b.setAttribute('role', 'option');
		b.innerHTML = `${tileFn(app)}<span class="os-label"></span>`;
		b.querySelector('.os-label').textContent = app.title;
		b.title = app.desc || app.title;
		return b;
	}

	function render() {
		measure();
		const live = new Set(items.map((i) => i.id));
		els.forEach((el, id) => {
			if (!live.has(id)) {
				el.remove();
				els.delete(id);
			}
		});
		items.forEach((it) => {
			let el = els.get(it.id);
			if (!el) {
				el = build(it);
				if (!el) return;
				els.set(it.id, el);
				host.append(el);
			}
			place(el, it);
		});
		selected = new Set([...selected].filter((id) => els.has(id)));
		paintSelection();
	}

	function reseat() {
		measure();
		items = reflowIcons(items, grid);
		render();
		persist();
	}

	function select(ids, additive) {
		selected = additive ? new Set([...selected, ...ids]) : new Set(ids);
		paintSelection();
	}

	// ---------- pointer: icon click, group drag ----------
	host.addEventListener('pointerdown', (e) => {
		if (e.button !== 0) return;
		const el = e.target.closest('.os-icon');
		if (el) return iconDown(e, el);
		if (e.target !== host && e.target !== marquee) return;
		marqueeDown(e);
	});

	function iconDown(e, el) {
		const id = el.dataset.id;
		const toggle = e.ctrlKey || e.metaKey;
		if (e.shiftKey && anchor && els.has(anchor)) {
			const order = items.slice().sort((a, b) => a.col - b.col || a.row - b.row).map((i) => i.id);
			const [a, b] = [order.indexOf(anchor), order.indexOf(id)].sort((x, y) => x - y);
			select(order.slice(a, b + 1), false);
		} else if (toggle) {
			if (selected.has(id)) selected.delete(id);
			else selected.add(id);
			anchor = id;
			paintSelection();
		} else {
			if (!selected.has(id)) select([id], false);
			anchor = id;
		}
		el.focus({ preventScroll: true });
		if (toggle || e.shiftKey) return;
		const start = local(e);
		const startCell = cellAt(start.x, start.y, cell, grid, origin);
		let dragging = false;
		let ghost = [];
		const move = (ev) => {
			const p = local(ev);
			if (!dragging && Math.hypot(p.x - start.x, p.y - start.y) < DRAG_PX) return;
			if (!dragging) {
				dragging = true;
				ghost = [...selected].map((sid) => els.get(sid)).filter(Boolean);
				ghost.forEach((g) => g.classList.add('is-drag'));
				host.classList.add('is-moving');
			}
			const dx = p.x - start.x;
			const dy = p.y - start.y;
			ghost.forEach((g) => {
				const it = items.find((i) => i.id === g.dataset.id);
				g.style.transform = `translate(${origin.x + it.col * cell.w + dx}px, ${origin.y + it.row * cell.h + dy}px)`;
			});
		};
		const up = (ev) => {
			removeEventListener('pointermove', move);
			removeEventListener('pointerup', up);
			removeEventListener('pointercancel', up);
			if (!dragging) return;
			host.classList.remove('is-moving');
			ghost.forEach((g) => g.classList.remove('is-drag'));
			const p = local(ev);
			const to = cellAt(p.x, p.y, cell, grid, origin);
			items = moveIcons(items, [...selected], to.col - startCell.col, to.row - startCell.row, grid);
			render();
			persist();
		};
		addEventListener('pointermove', move);
		addEventListener('pointerup', up);
		addEventListener('pointercancel', up);
	}

	// ---------- pointer: rubber band ----------
	function marqueeDown(e) {
		const additive = e.ctrlKey || e.metaKey || e.shiftKey;
		const base = additive ? new Set(selected) : new Set();
		if (!additive) {
			selected = new Set();
			paintSelection();
		}
		const a = local(e);
		let active = false;
		if (!marquee.isConnected) host.append(marquee);
		const move = (ev) => {
			const p = local(ev);
			if (!active && Math.hypot(p.x - a.x, p.y - a.y) < 3) return;
			active = true;
			const r = marqueeRect(a.x, a.y, p.x, p.y);
			marquee.hidden = false;
			marquee.style.cssText = `left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px`;
			const hit = iconsInRect(r, items, cell, origin);
			selected = new Set([...base, ...hit]);
			paintSelection();
		};
		const up = () => {
			removeEventListener('pointermove', move);
			removeEventListener('pointerup', up);
			removeEventListener('pointercancel', up);
			marquee.hidden = true;
			if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur?.();
		};
		addEventListener('pointermove', move);
		addEventListener('pointerup', up);
		addEventListener('pointercancel', up);
	}

	// ---------- open, context menu, keyboard ----------
	const openIcon = (id) => launch(resolve(id));
	host.addEventListener('dblclick', (e) => {
		const el = e.target.closest('.os-icon');
		if (el) openIcon(el.dataset.id);
	});
	host.addEventListener('click', (e) => {
		const el = e.target.closest('.os-icon');
		if (!el) return;
		// Touch has no double-click: a single tap opens.
		if (matchMedia('(pointer: coarse)').matches || innerWidth <= 720) openIcon(el.dataset.id);
	});
	host.addEventListener('contextmenu', (e) => {
		const el = e.target.closest('.os-icon');
		if (!el) return;
		e.preventDefault();
		e.stopPropagation();
		const id = el.dataset.id;
		if (!selected.has(id)) select([id], false);
		const many = selected.size > 1;
		menu(e.clientX, e.clientY, [
			[many ? `Open ${selected.size} apps` : 'Open', 'external', () => [...selected].forEach(openIcon)],
			'-',
			[many ? 'Remove from desktop' : 'Remove from desktop', 'close', () => remove([...selected])],
		]);
	});
	host.addEventListener('keydown', (e) => {
		const el = e.target.closest('.os-icon');
		if (!el) return;
		const id = el.dataset.id;
		if (e.key === 'Enter') {
			e.preventDefault();
			[...(selected.size ? selected : new Set([id]))].forEach(openIcon);
		} else if (e.key === 'Delete') {
			remove(selected.size ? [...selected] : [id]);
		} else if (e.key === ' ') {
			e.preventDefault();
			select([id], false);
			anchor = id;
		} else if (e.key.startsWith('Arrow')) {
			e.preventDefault();
			const cur = items.find((i) => i.id === id);
			const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
			let best = null;
			let bestD = Infinity;
			for (const it of items) {
				if (it === cur) continue;
				const dc = it.col - cur.col;
				const dr = it.row - cur.row;
				if (dc * d[0] + dr * d[1] <= 0) continue;
				const dist = dc * dc + dr * dr;
				if (dist < bestD) {
					best = it;
					bestD = dist;
				}
			}
			if (!best) return;
			if (e.ctrlKey || e.metaKey) {
				// Ctrl+Arrow nudges the selection one cell.
				items = moveIcons(items, [...(selected.size ? selected : [id])], d[0], d[1], grid);
				render();
				persist();
				els.get(id)?.focus();
				return;
			}
			select([best.id], e.shiftKey);
			anchor = best.id;
			els.get(best.id)?.focus();
		} else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
			e.preventDefault();
			select(items.map((i) => i.id), false);
		}
	});

	function remove(ids) {
		const gone = new Set(ids);
		items = items.filter((i) => !gone.has(i.id));
		selected = new Set([...selected].filter((i) => !gone.has(i)));
		render();
		persist();
	}

	return {
		/** Load persisted placement (or defaults on first run) and draw it. */
		init(tile) {
			tileFn = tile;
			measure();
			const saved = load();
			items = saved == null ? [] : sanitizeIcons(saved, isKnown);
			if (saved == null) items = addIcons(items, defaults(), grid);
			items = reflowIcons(items, grid);
			render();
			persist();
		},
		reseat,
		setSize(next) {
			if (!ICON_SIZES[next] || next === size) return;
			size = next;
			reseat();
		},
		arrange(ids) {
			const order = ids || items.slice().sort((a, b) => a.col - b.col || a.row - b.row).map((i) => i.id);
			items = arrangeIcons(order, grid).map((p) => ({ ...p }));
			render();
			persist();
		},
		sortByName() {
			const names = items.map((i) => [i.id, (resolve(i.id)?.title || i.id).toLowerCase()]);
			names.sort((a, b) => a[1].localeCompare(b[1]));
			this.arrange(names.map((n) => n[0]));
		},
		add(id) {
			if (items.some((i) => i.id === id) || !resolve(id)) return false;
			const next = addIcons(items, [id], grid);
			if (next.length === items.length) return false;
			items = next;
			render();
			persist();
			return true;
		},
		remove,
		has: (id) => items.some((i) => i.id === id),
		refresh() {
			render();
		},
		selectAll() {
			select(items.map((i) => i.id), false);
		},
		clearSelection() {
			select([], false);
		},
		ids: () => items.map((i) => i.id),
	};
}

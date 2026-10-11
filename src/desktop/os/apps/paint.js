// Paint: a canvas editor with pen, pencil, brush, eraser, shapes, fill, eyedropper and text,
// undo/redo, zoom, resize, open/save through the virtual file system, clipboard and download.
import './paint.css';
import { floodFill, History, hexToRgb, rgbToHex, stepZoom, fitZoom, constrain, pressureWidth, clampDim, formatForName, clampZoom } from './paint-logic.js';

const svg = (b, s = 18) => `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${b}</svg>`;
const TOOLS = [
	['pen', 'Pen', 'P', svg('<path d="M4 20l1-4L16 5l3 3L8 19zM14 7l3 3"/>')],
	['pencil', 'Pencil', 'N', svg('<path d="M4 20l1-4 11-11 3 3L8 19z"/><path d="M4 20h4" stroke-width="3"/>')],
	['brush', 'Brush', 'B', svg('<path d="M14 4l6 6-8 8c-1 1-2.5 1.5-4 1.5-2 0-3.5 1-4.5 1.5.5-1.5 1.5-3 1.5-5 0-1.5.5-3 1.5-4z"/>')],
	['eraser', 'Eraser', 'E', svg('<path d="M4 16l9-10 7 7-6 6H8zM9 11l6 6M12 20h8"/>')],
	['fill', 'Fill', 'F', svg('<path d="M5 12l7-8 7 7-7 8zM4 20h6M19 14c1 1.5 2 2.5 2 4a2 2 0 0 1-4 0c0-1.5 1-2.5 2-4z"/>')],
	['picker', 'Eyedropper', 'I', svg('<path d="M20 4a2.5 2.5 0 0 0-3.5 0L14 6.5 17.5 10 20 7.5A2.5 2.5 0 0 0 20 4zM13 8l-8 8v4h4l8-8z"/>')],
	['text', 'Text', 'T', svg('<path d="M5 5h14M12 5v14M9 19h6"/>')],
	['line', 'Line', 'L', svg('<path d="M5 19L19 5"/>')],
	['rect', 'Rectangle', 'R', svg('<rect x="4" y="6" width="16" height="12" rx="1"/>')],
	['ellipse', 'Ellipse', 'O', svg('<ellipse cx="12" cy="12" rx="8" ry="6"/>')],
];
const ACTION_ICONS = {
	new: svg('<path d="M6 3h9l4 4v14H6zM14 3v5h5M12 11v6M9 14h6"/>'),
	open: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H3zM3 10h19l-2 8H5z"/>'),
	save: svg('<path d="M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6"/>'),
	undo: svg('<path d="M9 7L4 12l5 5M4 12h10a6 6 0 0 1 0 12h-2" transform="translate(0 -3)"/>'),
	redo: svg('<path d="M15 7l5 5-5 5M20 12H10a6 6 0 0 0 0 12h2" transform="translate(0 -3)"/>'),
	copy: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
	paste: svg('<path d="M9 4h6v3H9zM15 5h2a2 2 0 0 1 2 2v13H5V7a2 2 0 0 1 2-2h2"/>'),
	download: svg('<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>'),
	clear: svg('<path d="M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13"/>'),
	fit: svg('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
};
const PALETTE = ['#000000', '#7f7f7f', '#880015', '#ed1c24', '#ff7f27', '#fff200', '#22b14c', '#00a2e8', '#3f48cc', '#a349a4', '#ffffff', '#c3c3c3', '#b97a57', '#ffaec9', '#ffc90e', '#efe4b0', '#b5e61d', '#99d9ea', '#7092be', '#c8bfe7'];
const FONTS = { Sans: 'system-ui, "Segoe UI", sans-serif', Serif: 'Georgia, "Times New Roman", serif', Mono: 'ui-monospace, Consolas, monospace', Handwriting: '"Comic Sans MS", "Segoe Print", cursive' };

export function mount(host, ctx) {
	const { h, esc, fs, store } = ctx;
	host.classList.add('napp-paint');
	host.innerHTML = '';

	const st = {
		tool: 'pen', prevTool: 'pen', color: store.get('tws:paint:color') || '#000000', size: Number(store.get('tws:paint:size')) || 4,
		opacity: 100, tolerance: 24, filled: false, font: 'Sans', zoom: 1, path: null, name: 'Untitled', dirty: false,
	};
	const hist = new History();
	let W = 800;
	let H = 520;
	let disposed = false;
	let drawing = null;
	let floating = null;
	let textBox = null;
	let loadToken = 0;

	// ---- DOM ----
	const root = h('div', 'pt');
	root.tabIndex = 0;
	const actions = h('div', 'pt-row pt-actions');
	const toolsRow = h('div', 'pt-row pt-tools');
	const optsRow = h('div', 'pt-row pt-opts');
	const viewport = h('div', 'pt-view');
	const sheet = h('div', 'pt-sheet');
	const cv = h('canvas', 'pt-cv');
	const ov = h('canvas', 'pt-ov');
	cv.setAttribute('aria-label', 'Drawing canvas');
	cv.setAttribute('role', 'img');
	sheet.append(cv, ov);
	viewport.append(sheet);
	const status = h('div', 'pt-status');
	const stPos = h('span', 'pos', '');
	const stSize = h('span', 'dim', '');
	const stMsg = h('span', 'msg', '');
	const zoomWrap = h('div', 'pt-zoom');
	status.append(stPos, stSize, stMsg, h('span', 'grow'), zoomWrap);
	const dialog = h('div', 'pt-dialog');
	dialog.hidden = true;
	root.append(actions, toolsRow, optsRow, viewport, status, dialog);
	host.append(root);
	const g = cv.getContext('2d', { willReadFrequently: true });
	const o = ov.getContext('2d');

	// ---- canvas helpers ----
	function sizeCanvas(w, h2, keep) {
		const snap = keep ? g.getImageData(0, 0, cv.width, cv.height) : null;
		W = w;
		H = h2;
		cv.width = ov.width = w;
		cv.height = ov.height = h2;
		g.fillStyle = '#ffffff';
		g.fillRect(0, 0, w, h2);
		if (snap) g.putImageData(snap, 0, 0);
		applyZoom();
	}
	function applyZoom() {
		sheet.style.width = `${Math.round(W * st.zoom)}px`;
		sheet.style.height = `${Math.round(H * st.zoom)}px`;
		stSize.textContent = `${W} × ${H} px`;
		zoomLabel.textContent = `${Math.round(st.zoom * 100)}%`;
		zoomRange.value = String(Math.round(st.zoom * 100));
	}
	const snapshot = () => g.getImageData(0, 0, cv.width, cv.height);
	function restore(s) {
		if (s.width !== cv.width || s.height !== cv.height) {
			W = s.width;
			H = s.height;
			cv.width = ov.width = W;
			cv.height = ov.height = H;
			applyZoom();
		}
		g.putImageData(s, 0, 0);
	}
	function checkpoint() {
		hist.push(snapshot());
		setDirty(true);
		syncUi();
	}
	function setDirty(d) {
		st.dirty = d;
		ctx.setTitle(`${st.name}${d ? ' *' : ''} - Paint`);
	}
	function undo() {
		commitFloat();
		const s = hist.undo(snapshot());
		if (s) {
			restore(s);
			setDirty(true);
		}
		syncUi();
	}
	function redo() {
		commitFloat();
		const s = hist.redo(snapshot());
		if (s) {
			restore(s);
			setDirty(true);
		}
		syncUi();
	}
	const msg = (t) => {
		stMsg.textContent = t;
	};

	function pos(e) {
		const r = cv.getBoundingClientRect();
		return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
	}
	const rgba = (alpha = 1) => {
		const [r, gg, b] = hexToRgb(st.color) || [0, 0, 0];
		return `rgba(${r},${gg},${b},${alpha})`;
	};

	// ---- tools ----
	const paintsOnOverlay = () => ['pen', 'brush'].includes(st.tool);
	function strokeSeg(c, x0, y0, x1, y1, width) {
		c.lineCap = 'round';
		c.lineJoin = 'round';
		c.lineWidth = width;
		c.beginPath();
		c.moveTo(x0, y0);
		c.lineTo(x1, y1);
		c.stroke();
	}
	function pencilSeg(c, x0, y0, x1, y1, sz) {
		// Bresenham with a square nib: crisp, aliased pixels.
		let ax = Math.floor(x0);
		let ay = Math.floor(y0);
		const bx = Math.floor(x1);
		const by = Math.floor(y1);
		const dx = Math.abs(bx - ax);
		const dy = -Math.abs(by - ay);
		const sx = ax < bx ? 1 : -1;
		const sy = ay < by ? 1 : -1;
		let err = dx + dy;
		const n = Math.max(1, Math.round(sz / 2));
		for (;;) {
			c.fillRect(ax - Math.floor(n / 2), ay - Math.floor(n / 2), n, n);
			if (ax === bx && ay === by) break;
			const e2 = 2 * err;
			if (e2 >= dy) {
				err += dy;
				ax += sx;
			}
			if (e2 <= dx) {
				err += dx;
				ay += sy;
			}
		}
	}
	function shapePath(c, kind, x0, y0, x1, y1) {
		c.beginPath();
		if (kind === 'line') {
			c.moveTo(x0, y0);
			c.lineTo(x1, y1);
		} else if (kind === 'rect') c.rect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
		else c.ellipse((x0 + x1) / 2, (y0 + y1) / 2, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, 0, 0, Math.PI * 2);
	}
	function drawShape(c, d, x1, y1) {
		let [x0, y0] = [d.x0, d.y0];
		if (d.shift) [x1, y1] = constrain(d.kind === 'line' ? 'line' : 'box', x0, y0, x1, y1);
		c.clearRect(0, 0, W, H);
		c.lineWidth = st.size;
		c.lineJoin = 'round';
		c.lineCap = 'round';
		c.strokeStyle = c.fillStyle = rgba(1);
		shapePath(c, d.kind, x0, y0, x1, y1);
		if (d.kind !== 'line' && st.filled) c.fill();
		else c.stroke();
		d.end = [x1, y1];
	}

	function onDown(e) {
		if (e.button > 0 && e.pointerType === 'mouse' && e.button !== 2) return;
		if (drawing) return;
		if (floating) {
			const [x, y] = pos(e);
			if (x >= floating.x && y >= floating.y && x <= floating.x + floating.w && y <= floating.y + floating.h) {
				floating.drag = [x - floating.x, y - floating.y];
				cv.setPointerCapture(e.pointerId);
				e.preventDefault();
				return;
			}
			commitFloat();
		}
		if (textBox) commitText();
		const [x, y] = pos(e);
		const right = e.button === 2;
		e.preventDefault();
		root.focus({ preventScroll: true });
		const t = st.tool;
		if (t === 'picker') return pickColor(x, y);
		if (t === 'text') return beginText(x, y);
		if (t === 'fill') {
			checkpoint();
			const im = g.getImageData(0, 0, W, H);
			const rgb = right ? [255, 255, 255] : hexToRgb(st.color);
			const n = floodFill(im, x, y, rgb, { tolerance: st.tolerance, opacity: st.opacity / 100 });
			if (n) g.putImageData(im, 0, 0);
			else {
				hist.undo(snapshot());
				syncUi();
			}
			return;
		}
		cv.setPointerCapture(e.pointerId);
		checkpoint();
		drawing = { id: e.pointerId, kind: t, x0: x, y0: y, lx: x, ly: y, shift: e.shiftKey, pen: e.pointerType, erase: t === 'eraser' || right };
		if (['line', 'rect', 'ellipse'].includes(t)) {
			ov.style.opacity = String(st.opacity / 100);
			drawShape(o, drawing, x, y);
			return;
		}
		if (paintsOnOverlay() && !right) {
			ov.style.opacity = String(st.opacity / 100);
			o.clearRect(0, 0, W, H);
			o.strokeStyle = o.fillStyle = rgba(1);
			applyBrush(o);
			dot(o, x, y, pressureWidth(st.size, e.pointerType, e.pressure));
		} else {
			stroke(g, x, y, x, y, e);
		}
	}
	function applyBrush(c) {
		if (st.tool === 'brush') {
			c.shadowColor = rgba(1);
			c.shadowBlur = Math.max(2, st.size * 0.6);
		} else {
			c.shadowBlur = 0;
			c.shadowColor = 'transparent';
		}
	}
	function dot(c, x, y, w) {
		c.beginPath();
		c.arc(x, y, w / 2, 0, Math.PI * 2);
		c.fill();
	}
	function stroke(c, x0, y0, x1, y1, e) {
		const w = pressureWidth(drawing.erase ? st.size * 2.5 : st.size, e.pointerType, e.pressure);
		if (drawing.erase) {
			c.save();
			c.strokeStyle = c.fillStyle = '#ffffff';
			c.shadowBlur = 0;
			strokeSeg(c, x0, y0, x1, y1, w);
			dot(c, x1, y1, w);
			c.restore();
		} else if (st.tool === 'pencil') {
			c.fillStyle = rgba(st.opacity / 100);
			pencilSeg(c, x0, y0, x1, y1, st.size);
		} else {
			strokeSeg(c, x0, y0, x1, y1, w);
		}
	}
	function onMove(e) {
		const [x, y] = pos(e);
		stPos.textContent = x >= 0 && y >= 0 && x < W && y < H ? `${Math.floor(x)}, ${Math.floor(y)} px` : '';
		if (floating?.drag) {
			floating.x = Math.round(x - floating.drag[0]);
			floating.y = Math.round(y - floating.drag[1]);
			drawFloat();
			return;
		}
		if (!drawing || e.pointerId !== drawing.id) return;
		const evs = e.getCoalescedEvents?.().length ? e.getCoalescedEvents() : [e];
		for (const ev of evs) {
			const [px, py] = pos(ev);
			if (['line', 'rect', 'ellipse'].includes(drawing.kind)) {
				drawing.shift = ev.shiftKey;
				drawShape(o, drawing, px, py);
			} else if (paintsOnOverlay() && !drawing.erase) {
				applyBrush(o);
				o.strokeStyle = o.fillStyle = rgba(1);
				strokeSeg(o, drawing.lx, drawing.ly, px, py, pressureWidth(st.size, ev.pointerType, ev.pressure));
			} else stroke(g, drawing.lx, drawing.ly, px, py, ev);
			drawing.lx = px;
			drawing.ly = py;
		}
	}
	function onUp(e) {
		if (floating?.drag) {
			floating.drag = null;
			return;
		}
		if (!drawing || e.pointerId !== drawing.id) return;
		const d = drawing;
		drawing = null;
		if (['line', 'rect', 'ellipse'].includes(d.kind) || (paintsOnOverlay() && !d.erase)) {
			g.save();
			g.globalAlpha = st.opacity / 100;
			g.drawImage(ov, 0, 0);
			g.restore();
			o.clearRect(0, 0, W, H);
			ov.style.opacity = '1';
		}
	}
	function onCancel(e) {
		if (!drawing || e.pointerId !== drawing.id) return;
		onUp(e);
	}
	cv.addEventListener('pointerdown', onDown);
	cv.addEventListener('pointermove', onMove);
	cv.addEventListener('pointerup', onUp);
	cv.addEventListener('pointercancel', onCancel);
	cv.addEventListener('contextmenu', (e) => e.preventDefault());
	cv.addEventListener('pointerleave', () => {
		if (!drawing) stPos.textContent = '';
	});

	function pickColor(x, y) {
		const px = g.getImageData(Math.max(0, Math.min(W - 1, Math.floor(x))), Math.max(0, Math.min(H - 1, Math.floor(y))), 1, 1).data;
		setColor(rgbToHex(px[0], px[1], px[2]));
		setTool(st.prevTool === 'picker' ? 'pen' : st.prevTool);
		msg(`Picked ${st.color}`);
	}

	// ---- text ----
	function beginText(x, y) {
		const px = Math.max(10, st.size * 3 + 8);
		const ta = h('textarea', 'pt-text');
		ta.rows = 1;
		ta.spellcheck = false;
		ta.setAttribute('aria-label', 'Text to place on the canvas');
		ta.placeholder = 'Type...';
		const sc = st.zoom;
		Object.assign(ta.style, { left: `${x * sc}px`, top: `${y * sc}px`, fontSize: `${px * sc}px`, color: st.color, fontFamily: FONTS[st.font], opacity: String(st.opacity / 100) });
		textBox = { ta, x, y, px };
		sheet.append(ta);
		ta.addEventListener('input', () => {
			ta.style.height = 'auto';
			ta.style.height = `${ta.scrollHeight}px`;
			ta.style.width = `${Math.max(80, ta.scrollWidth)}px`;
		});
		ta.addEventListener('keydown', (e) => {
			e.stopPropagation();
			if (e.key === 'Escape') cancelText();
			else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commitText();
		});
		ta.addEventListener('blur', () => setTimeout(() => textBox?.ta === ta && commitText(), 120));
		requestAnimationFrame(() => ta.focus());
	}
	function cancelText() {
		textBox?.ta.remove();
		textBox = null;
	}
	function commitText() {
		if (!textBox) return;
		const { ta, x, y, px } = textBox;
		textBox = null;
		const text = ta.value;
		ta.remove();
		if (!text.trim()) return;
		checkpoint();
		g.save();
		g.globalAlpha = st.opacity / 100;
		g.fillStyle = st.color;
		g.textBaseline = 'top';
		g.font = `${px}px ${FONTS[st.font]}`;
		text.split('\n').forEach((line, i) => g.fillText(line, x + 2, y + 2 + i * px * 1.2));
		g.restore();
	}

	// ---- floating paste ----
	function drawFloat() {
		o.clearRect(0, 0, W, H);
		if (!floating) return;
		o.drawImage(floating.bmp, floating.x, floating.y);
		o.save();
		o.setLineDash([5, 4]);
		o.strokeStyle = '#0078d4';
		o.lineWidth = 1 / st.zoom;
		o.strokeRect(floating.x + 0.5, floating.y + 0.5, floating.w, floating.h);
		o.restore();
	}
	function commitFloat() {
		if (!floating) return;
		const f = floating;
		floating = null;
		o.clearRect(0, 0, W, H);
		checkpoint();
		g.drawImage(f.bmp, f.x, f.y);
		cv.style.cursor = '';
		msg('Pasted');
	}
	function cancelFloat() {
		floating = null;
		o.clearRect(0, 0, W, H);
	}
	async function beginFloat(blob) {
		let bmp;
		try {
			bmp = await createImageBitmap(blob);
		} catch {
			return ctx.toast('That clipboard content is not an image Paint can read');
		}
		commitFloat();
		if (bmp.width > W || bmp.height > H) {
			checkpoint();
			sizeCanvas(Math.max(W, bmp.width), Math.max(H, bmp.height), true);
		}
		const r = viewport.getBoundingClientRect();
		const sx = Math.max(0, Math.floor(viewport.scrollLeft / st.zoom));
		const sy = Math.max(0, Math.floor(viewport.scrollTop / st.zoom));
		floating = { bmp, x: Math.min(sx, W - bmp.width), y: Math.min(sy, H - bmp.height), w: bmp.width, h: bmp.height, drag: null };
		void r;
		drawFloat();
		msg('Drag to position the pasted image, then press Enter or click outside it to place it');
	}

	// ---- file ops ----
	async function loadBlob(blob, { path = null, name = 'Untitled' } = {}) {
		const token = ++loadToken;
		let bmp;
		try {
			bmp = await createImageBitmap(blob);
		} catch {
			return ctx.toast('Paint could not read that image');
		}
		if (token !== loadToken || disposed) return;
		cancelFloat();
		cancelText();
		hist.clear();
		sizeCanvas(clampDim(bmp.width), clampDim(bmp.height), false);
		g.drawImage(bmp, 0, 0);
		st.path = path;
		st.name = name;
		setDirty(false);
		fitView();
		syncUi();
	}
	async function openPath(p) {
		try {
			const f = await fs.read(p);
			if (!f) return ctx.toast(`Cannot find ${p}`);
			await loadBlob(f.blob, { path: p, name: fs.nameOf(p) });
		} catch (err) {
			ctx.toast(`Could not open ${p}: ${err.message}`);
		}
	}
	function toBlob(mime) {
		const c = document.createElement('canvas');
		c.width = W;
		c.height = H;
		const x = c.getContext('2d');
		if (mime === 'image/jpeg') {
			x.fillStyle = '#fff';
			x.fillRect(0, 0, W, H);
		}
		x.drawImage(cv, 0, 0);
		return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode the image'))), mime, 0.92));
	}
	async function writeTo(path) {
		commitFloat();
		const fmt = formatForName(path);
		const blob = await toBlob(fmt.mime);
		await fs.write(path, blob, { mime: fmt.mime });
		st.path = path;
		st.name = fs.nameOf(path);
		setDirty(false);
		msg(`Saved ${path}`);
		ctx.toast(`Saved ${st.name}`);
	}
	async function save() {
		try {
			if (st.path && formatForName(st.path).ext && (await fs.exists(st.path))) return await writeTo(st.path);
			const name = await fs.uniqueName('/Pictures', 'Drawing.png');
			await writeTo(fs.join('/Pictures', name));
		} catch (err) {
			ctx.toast(`Could not save: ${err.message}`);
		}
	}
	function modal(title, build) {
		dialog.replaceChildren();
		const card = h('form', 'pt-card');
		card.append(h('h3', '', esc(title)));
		const close = () => {
			dialog.hidden = true;
			dialog.replaceChildren();
			root.focus({ preventScroll: true });
		};
		build(card, close);
		card.addEventListener('keydown', (e) => {
			if (e.key === 'Escape') {
				e.stopPropagation();
				close();
			}
		});
		dialog.append(card);
		dialog.hidden = false;
		card.querySelector('input,select')?.focus();
		return close;
	}
	function saveAs() {
		const base = st.path ? fs.nameOf(st.path) : 'Drawing.png';
		modal('Save as', (card, close) => {
			card.insertAdjacentHTML('beforeend', `<label>File name<input class="pt-in" name="n" value="${esc(base)}" maxlength="100"></label><label>Folder<input class="pt-in" name="d" value="${esc(st.path ? fs.parentOf(st.path) : '/Pictures')}"></label><p class="pt-hint">Use .png, .jpg or .webp.</p><p class="pt-warn" hidden></p>`);
			const row = h('div', 'pt-btns');
			const cancel = h('button', 'pt-btn', 'Cancel');
			cancel.type = 'button';
			cancel.addEventListener('click', close);
			const ok = h('button', 'pt-btn primary', 'Save');
			ok.type = 'submit';
			row.append(cancel, ok);
			card.append(row);
			const warn = card.querySelector('.pt-warn');
			let armed = '';
			card.addEventListener('submit', async (e) => {
				e.preventDefault();
				let n = card.n.value.trim();
				const dir = fs.normalize(card.d.value.trim() || '/Pictures');
				if (!n) return;
				if (!/\.(png|jpe?g|webp)$/i.test(n)) n += '.png';
				const path = fs.join(dir, n);
				try {
					const dnode = await fs.stat(dir);
					if (!dnode || dnode.type !== 'dir') {
						warn.hidden = false;
						warn.textContent = `The folder ${dir} does not exist.`;
						return;
					}
					if ((await fs.exists(path)) && armed !== path) {
						armed = path;
						warn.hidden = false;
						warn.textContent = `${n} already exists. Choose Save again to replace it.`;
						return;
					}
					await writeTo(path);
					close();
				} catch (err) {
					warn.hidden = false;
					warn.textContent = err.message;
				}
			});
		});
	}
	async function exportDownload() {
		commitFloat();
		const fmt = st.path ? formatForName(st.path) : { ext: 'png', mime: 'image/png' };
		try {
			const blob = await toBlob(fmt.mime);
			const a = document.createElement('a');
			const u = URL.createObjectURL(blob);
			a.href = u;
			a.download = `${st.name.replace(/\.[^.]+$/, '')}.${fmt.ext === 'jpeg' ? 'jpg' : fmt.ext}`;
			document.body.append(a);
			a.click();
			a.remove();
			setTimeout(() => URL.revokeObjectURL(u), 4000);
		} catch (err) {
			ctx.toast(err.message);
		}
	}
	async function copyImage() {
		commitFloat();
		try {
			const blob = await toBlob('image/png');
			await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
			ctx.toast('Image copied to the clipboard');
		} catch {
			ctx.toast('The browser blocked clipboard access. Allow it for this site, or use Export.');
		}
	}
	async function pasteImage() {
		try {
			const items = await navigator.clipboard.read();
			for (const it of items) {
				const type = it.types.find((t) => t.startsWith('image/'));
				if (type) return beginFloat(await it.getType(type));
			}
			ctx.toast('There is no image on the clipboard');
		} catch {
			ctx.toast('The browser blocked clipboard access. Press Ctrl+V with the canvas focused instead.');
		}
	}
	root.addEventListener('paste', (e) => {
		const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
		if (!item || e.target.closest('textarea,input')) return;
		e.preventDefault();
		beginFloat(item.getAsFile());
	});
	function confirmDiscard(next) {
		if (!st.dirty) return next();
		modal('Discard changes?', (card, close) => {
			card.append(h('p', 'pt-hint', `${esc(st.name)} has unsaved changes.`));
			const row = h('div', 'pt-btns');
			const cancel = h('button', 'pt-btn', 'Cancel');
			cancel.type = 'button';
			cancel.addEventListener('click', close);
			const sv = h('button', 'pt-btn', 'Save first');
			sv.type = 'button';
			sv.addEventListener('click', async () => {
				await save();
				close();
				if (!st.dirty) next();
			});
			const ok = h('button', 'pt-btn primary', 'Discard');
			ok.type = 'button';
			ok.addEventListener('click', () => {
				close();
				next();
			});
			row.append(cancel, sv, ok);
			card.append(row);
		});
	}
	function newImage() {
		confirmDiscard(() =>
			modal('New image', (card, close) => {
				card.insertAdjacentHTML('beforeend', `<div class="pt-two"><label>Width<input class="pt-in" type="number" name="w" min="1" max="8192" value="${W}"></label><label>Height<input class="pt-in" type="number" name="h" min="1" max="8192" value="${H}"></label></div><div class="pt-presets"></div>`);
				const presets = card.querySelector('.pt-presets');
				for (const [l, w, hh] of [['800 × 520', 800, 520], ['1280 × 720', 1280, 720], ['1920 × 1080', 1920, 1080], ['512 × 512', 512, 512]]) {
					const b = h('button', 'pt-chip', l);
					b.type = 'button';
					b.addEventListener('click', () => ((card.w.value = w), (card.h.value = hh)));
					presets.append(b);
				}
				const row = h('div', 'pt-btns');
				const cancel = h('button', 'pt-btn', 'Cancel');
				cancel.type = 'button';
				cancel.addEventListener('click', close);
				const ok = h('button', 'pt-btn primary', 'Create');
				ok.type = 'submit';
				row.append(cancel, ok);
				card.append(row);
				card.addEventListener('submit', (e) => {
					e.preventDefault();
					cancelFloat();
					cancelText();
					hist.clear();
					sizeCanvas(clampDim(card.w.value), clampDim(card.h.value), false);
					st.path = null;
					st.name = 'Untitled';
					setDirty(false);
					fitView();
					syncUi();
					close();
				});
			}),
		);
	}
	function resizeCanvas() {
		modal('Canvas size', (card, close) => {
			card.insertAdjacentHTML('beforeend', `<div class="pt-two"><label>Width<input class="pt-in" type="number" name="w" min="1" max="8192" value="${W}"></label><label>Height<input class="pt-in" type="number" name="h" min="1" max="8192" value="${H}"></label></div><label class="pt-chk"><input type="checkbox" name="scale"> Stretch the picture to the new size</label><p class="pt-hint">Otherwise the picture keeps its size and the canvas grows or crops from the bottom right.</p>`);
			const row = h('div', 'pt-btns');
			const cancel = h('button', 'pt-btn', 'Cancel');
			cancel.type = 'button';
			cancel.addEventListener('click', close);
			const ok = h('button', 'pt-btn primary', 'Apply');
			ok.type = 'submit';
			row.append(cancel, ok);
			card.append(row);
			card.addEventListener('submit', (e) => {
				e.preventDefault();
				commitFloat();
				const nw = clampDim(card.w.value);
				const nh = clampDim(card.h.value);
				checkpoint();
				if (card.scale.checked) {
					const t = document.createElement('canvas');
					t.width = W;
					t.height = H;
					t.getContext('2d').drawImage(cv, 0, 0);
					sizeCanvas(nw, nh, false);
					g.imageSmoothingQuality = 'high';
					g.drawImage(t, 0, 0, nw, nh);
				} else sizeCanvas(nw, nh, true);
				close();
			});
		});
	}
	function clearAll() {
		commitFloat();
		cancelText();
		checkpoint();
		g.fillStyle = '#ffffff';
		g.fillRect(0, 0, W, H);
	}
	function openFromComputer() {
		const inp = document.createElement('input');
		inp.type = 'file';
		inp.accept = 'image/*';
		inp.addEventListener('change', () => {
			const f = inp.files?.[0];
			if (f) confirmDiscard(() => loadBlob(f, { name: f.name }));
		});
		inp.click();
	}

	// ---- toolbar ----
	const btn = (cls, html, title, onClick) => {
		const b = h('button', cls, html);
		b.type = 'button';
		b.title = title;
		b.setAttribute('aria-label', title.replace(/ \(.*\)$/, ''));
		b.addEventListener('click', onClick);
		return b;
	};
	const bNew = btn('pt-ab', `${ACTION_ICONS.new}<span>New</span>`, 'New image (Ctrl+N)', newImage);
	const bOpen = btn('pt-ab', `${ACTION_ICONS.open}<span>Open</span>`, 'Open from this computer (Ctrl+O)', openFromComputer);
	const bSave = btn('pt-ab', `${ACTION_ICONS.save}<span>Save</span>`, 'Save (Ctrl+S)', save);
	const bSaveAs = btn('pt-ab', '<span>Save as</span>', 'Save as (Ctrl+Shift+S)', saveAs);
	const bExport = btn('pt-ab', `${ACTION_ICONS.download}<span>Export</span>`, 'Download a copy', exportDownload);
	const bUndo = btn('pt-ab icon', ACTION_ICONS.undo, 'Undo (Ctrl+Z)', undo);
	const bRedo = btn('pt-ab icon', ACTION_ICONS.redo, 'Redo (Ctrl+Y)', redo);
	const bCopy = btn('pt-ab icon', ACTION_ICONS.copy, 'Copy image (Ctrl+C)', copyImage);
	const bPaste = btn('pt-ab icon', ACTION_ICONS.paste, 'Paste image (Ctrl+V)', pasteImage);
	const bResize = btn('pt-ab', '<span>Canvas size</span>', 'Canvas size', resizeCanvas);
	const bClear = btn('pt-ab icon', ACTION_ICONS.clear, 'Clear canvas', clearAll);
	const sep = () => h('span', 'pt-sep');
	actions.append(bNew, bOpen, bSave, bSaveAs, bExport, sep(), bUndo, bRedo, sep(), bCopy, bPaste, sep(), bResize, bClear);

	const toolBtns = {};
	for (const [id, label, key, icon] of TOOLS) {
		const b = btn('pt-tool', icon, `${label} (${key})`, () => setTool(id));
		b.setAttribute('aria-pressed', 'false');
		toolBtns[id] = b;
		toolsRow.append(b);
	}
	function setTool(id) {
		if (id !== st.tool) st.prevTool = st.tool;
		if (textBox) commitText();
		st.tool = id;
		for (const [k, b] of Object.entries(toolBtns)) {
			b.classList.toggle('on', k === id);
			b.setAttribute('aria-pressed', String(k === id));
		}
		cv.style.cursor = id === 'picker' ? 'copy' : id === 'text' ? 'text' : 'crosshair';
		fillWrap.hidden = !['rect', 'ellipse'].includes(id);
		tolWrap.hidden = id !== 'fill';
		fontWrap.hidden = id !== 'text';
		sizeWrap.hidden = ['fill', 'picker'].includes(id);
	}

	const field = (label, input, cls = '') => {
		const w = h('label', `pt-field ${cls}`);
		w.append(h('span', '', label), input);
		return w;
	};
	const sizeRange = h('input');
	Object.assign(sizeRange, { type: 'range', min: '1', max: '80', value: String(st.size) });
	const sizeOut = h('output', '', String(st.size));
	const sizeWrap = field(
		'Size',
		(() => {
			const d = h('span', 'pt-rng');
			d.append(sizeRange, sizeOut);
			return d;
		})(),
	);
	sizeRange.addEventListener('input', () => {
		st.size = Number(sizeRange.value);
		sizeOut.textContent = sizeRange.value;
		store.set('tws:paint:size', sizeRange.value);
	});
	const opRange = h('input');
	Object.assign(opRange, { type: 'range', min: '5', max: '100', value: '100' });
	const opOut = h('output', '', '100%');
	const opWrap = field(
		'Opacity',
		(() => {
			const d = h('span', 'pt-rng');
			d.append(opRange, opOut);
			return d;
		})(),
	);
	opRange.addEventListener('input', () => {
		st.opacity = Number(opRange.value);
		opOut.textContent = `${opRange.value}%`;
	});
	const tolRange = h('input');
	Object.assign(tolRange, { type: 'range', min: '0', max: '128', value: String(st.tolerance) });
	const tolOut = h('output', '', String(st.tolerance));
	const tolWrap = field(
		'Tolerance',
		(() => {
			const d = h('span', 'pt-rng');
			d.append(tolRange, tolOut);
			return d;
		})(),
	);
	tolRange.addEventListener('input', () => {
		st.tolerance = Number(tolRange.value);
		tolOut.textContent = tolRange.value;
	});
	const fillSel = h('select', 'pt-sel', '<option value="0">Outline</option><option value="1">Filled</option>');
	fillSel.addEventListener('change', () => (st.filled = fillSel.value === '1'));
	const fillWrap = field('Shape', fillSel);
	const fontSel = h('select', 'pt-sel', Object.keys(FONTS).map((f) => `<option>${f}</option>`).join(''));
	fontSel.addEventListener('change', () => (st.font = fontSel.value));
	const fontWrap = field('Font', fontSel);

	const colorIn = h('input', 'pt-color');
	colorIn.type = 'color';
	colorIn.value = st.color;
	colorIn.title = 'Custom colour';
	colorIn.setAttribute('aria-label', 'Custom colour');
	colorIn.addEventListener('input', () => setColor(colorIn.value));
	const swatches = h('div', 'pt-swatches');
	swatches.setAttribute('role', 'group');
	swatches.setAttribute('aria-label', 'Colour palette');
	for (const c of PALETTE) {
		const b = h('button', 'pt-sw');
		b.type = 'button';
		b.style.background = c;
		b.title = c;
		b.setAttribute('aria-label', `Colour ${c}`);
		b.addEventListener('click', () => setColor(c));
		swatches.append(b);
	}
	const cur = h('span', 'pt-cur');
	function setColor(c) {
		st.color = c;
		colorIn.value = c;
		cur.style.background = c;
		cur.title = `Current colour ${c}`;
		store.set('tws:paint:color', c);
		for (const b of swatches.children) b.classList.toggle('on', b.title === c);
	}
	optsRow.append(sizeWrap, opWrap, tolWrap, fillWrap, fontWrap, h('span', 'pt-grow'), cur, swatches, colorIn);

	// ---- zoom ----
	const zoomLabel = h('span', 'z', '100%');
	const zoomRange = h('input');
	Object.assign(zoomRange, { type: 'range', min: '10', max: '800', step: '5', value: '100' });
	zoomRange.setAttribute('aria-label', 'Zoom');
	const zOut = btn('pt-zb', '−', 'Zoom out (Ctrl+-)', () => setZoom(stepZoom(st.zoom, -1)));
	const zIn = btn('pt-zb', '+', 'Zoom in (Ctrl++)', () => setZoom(stepZoom(st.zoom, 1)));
	const zFit = btn('pt-zb', ACTION_ICONS.fit, 'Fit to window', () => fitView());
	zoomRange.addEventListener('input', () => setZoom(Number(zoomRange.value) / 100));
	zoomWrap.append(zFit, zOut, zoomRange, zIn, zoomLabel);
	function setZoom(z, anchor) {
		const old = st.zoom;
		st.zoom = clampZoom(z);
		const vr = viewport.getBoundingClientRect();
		const ax = anchor ? anchor.x - vr.left : vr.width / 2;
		const ay = anchor ? anchor.y - vr.top : vr.height / 2;
		const cx = (viewport.scrollLeft + ax) / old;
		const cy = (viewport.scrollTop + ay) / old;
		applyZoom();
		viewport.scrollLeft = cx * st.zoom - ax;
		viewport.scrollTop = cy * st.zoom - ay;
		if (textBox) cancelText();
		if (floating) drawFloat();
	}
	function fitView() {
		const r = viewport.getBoundingClientRect();
		st.zoom = fitZoom(W, H, Math.max(100, r.width - 40), Math.max(100, r.height - 40));
		applyZoom();
	}
	viewport.addEventListener(
		'wheel',
		(e) => {
			if (!e.ctrlKey && !e.metaKey) return;
			e.preventDefault();
			setZoom(stepZoom(st.zoom, e.deltaY < 0 ? 1 : -1), { x: e.clientX, y: e.clientY });
		},
		{ passive: false },
	);

	// ---- drop + keyboard ----
	viewport.addEventListener('dragover', (e) => {
		if ([...(e.dataTransfer?.types || [])].includes('Files')) {
			e.preventDefault();
			viewport.classList.add('drop');
		}
	});
	viewport.addEventListener('dragleave', () => viewport.classList.remove('drop'));
	viewport.addEventListener('drop', (e) => {
		viewport.classList.remove('drop');
		const f = [...(e.dataTransfer?.files || [])].find((x) => x.type.startsWith('image/'));
		if (!f) return;
		e.preventDefault();
		confirmDiscard(() => loadBlob(f, { name: f.name }));
	});
	root.addEventListener('keydown', (e) => {
		if (e.target.closest('textarea,input[type=number],input[type=text],.pt-in')) return;
		const mod = e.ctrlKey || e.metaKey;
		const k = e.key.toLowerCase();
		if (floating && (e.key === 'Enter' || e.key === 'Escape')) {
			e.preventDefault();
			return e.key === 'Enter' ? commitFloat() : cancelFloat();
		}
		if (mod) {
			if (k === 'z') (e.shiftKey ? redo : undo)();
			else if (k === 'y') redo();
			else if (k === 's') (e.shiftKey ? saveAs : save)();
			else if (k === 'o') openFromComputer();
			else if (k === 'n') newImage();
			else if (k === 'c' && !window.getSelection()?.toString()) copyImage();
			else if (k === '=' || k === '+') setZoom(stepZoom(st.zoom, 1));
			else if (k === '-') setZoom(stepZoom(st.zoom, -1));
			else if (k === '0') setZoom(1);
			else return;
			e.preventDefault();
			return;
		}
		if (e.target.closest('button') && (e.key === 'Enter' || e.key === ' ')) return;
		const hit = TOOLS.find(([, , key]) => key.toLowerCase() === k);
		if (hit) setTool(hit[0]);
		else if (k === '[') bump(-2);
		else if (k === ']') bump(2);
		else return;
		e.preventDefault();
	});
	function bump(d) {
		st.size = Math.max(1, Math.min(80, st.size + d));
		sizeRange.value = String(st.size);
		sizeOut.textContent = String(st.size);
	}
	const beforeUnload = (e) => {
		if (st.dirty) {
			e.preventDefault();
			e.returnValue = '';
		}
	};
	window.addEventListener('beforeunload', beforeUnload);

	function syncUi() {
		bUndo.disabled = !hist.canUndo;
		bRedo.disabled = !hist.canRedo;
		bSave.classList.toggle('dirty', st.dirty);
	}

	ctx.onArg((p) => {
		if (typeof p === 'string' && p) confirmDiscard(() => openPath(p));
	});

	// ---- start ----
	sizeCanvas(W, H, false);
	setColor(st.color);
	setTool('pen');
	syncUi();
	ctx.setTitle('Untitled - Paint');
	if (typeof ctx.arg === 'string' && ctx.arg) openPath(ctx.arg);
	else requestAnimationFrame(() => !disposed && fitView());
	root.focus({ preventScroll: true });

	return () => {
		disposed = true;
		loadToken++;
		window.removeEventListener('beforeunload', beforeUnload);
	};
}

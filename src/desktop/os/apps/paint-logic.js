// Pure helpers for Paint: scanline flood fill, undo/redo history, colour parsing and shape maths.
// Works on plain { data: Uint8ClampedArray, width, height } so it runs under Node as well as in the browser.

/** "#rrggbb" or "#rgb" to [r, g, b], or null. */
export function hexToRgb(hex) {
	const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim());
	if (!m) return null;
	let s = m[1];
	if (s.length === 3) s = [...s].map((c) => c + c).join('');
	const n = parseInt(s, 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgbToHex = (r, g, b) => `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;

const near = (d, i, t, tol) => Math.abs(d[i] - t[0]) <= tol && Math.abs(d[i + 1] - t[1]) <= tol && Math.abs(d[i + 2] - t[2]) <= tol && Math.abs(d[i + 3] - t[3]) <= tol;

/**
 * Scanline flood fill. Replaces the connected region around (x, y) whose colour is within `tolerance`
 * (0 to 255 per channel) of the start pixel with `rgb`, blended by `opacity` (0 to 1).
 * Mutates image.data and returns the number of pixels changed.
 */
export function floodFill(image, x, y, rgb, { tolerance = 0, opacity = 1 } = {}) {
	const { data, width, height } = image;
	x = Math.floor(x);
	y = Math.floor(y);
	if (x < 0 || y < 0 || x >= width || y >= height) return 0;
	const si = (y * width + x) * 4;
	const target = [data[si], data[si + 1], data[si + 2], data[si + 3]];
	const visited = new Uint8Array(width * height);
	const match = (px, py) => !visited[py * width + px] && near(data, (py * width + px) * 4, target, tolerance);
	let changed = 0;
	const stack = [[x, y]];
	while (stack.length) {
		const [sx, sy] = stack.pop();
		if (!match(sx, sy)) continue;
		let l = sx;
		while (l > 0 && match(l - 1, sy)) l--;
		let r = sx;
		while (r < width - 1 && match(r + 1, sy)) r++;
		for (let px = l; px <= r; px++) {
			const p = sy * width + px;
			visited[p] = 1;
			const i = p * 4;
			data[i] = Math.round(data[i] * (1 - opacity) + rgb[0] * opacity);
			data[i + 1] = Math.round(data[i + 1] * (1 - opacity) + rgb[1] * opacity);
			data[i + 2] = Math.round(data[i + 2] * (1 - opacity) + rgb[2] * opacity);
			data[i + 3] = Math.round(data[i + 3] * (1 - opacity) + 255 * opacity);
			changed++;
		}
		for (const ny of [sy - 1, sy + 1]) {
			if (ny < 0 || ny >= height) continue;
			let inRun = false;
			for (let px = l; px <= r; px++) {
				if (match(px, ny)) {
					if (!inRun) stack.push([px, ny]);
					inRun = true;
				} else inRun = false;
			}
		}
	}
	return changed;
}

/** Undo/redo over snapshots (anything with .data.length). Bounded by count and total bytes. */
export class History {
	constructor({ maxCount = 60, maxBytes = 256 * 1024 * 1024 } = {}) {
		this.maxCount = maxCount;
		this.maxBytes = maxBytes;
		this.undoStack = [];
		this.redoStack = [];
	}
	static size(s) {
		return s?.data?.length || 0;
	}
	/** Record the state BEFORE a change. Clears redo. */
	push(snapshot) {
		this.undoStack.push(snapshot);
		this.redoStack = [];
		this.trim();
	}
	trim() {
		let bytes = this.undoStack.reduce((n, s) => n + History.size(s), 0);
		while (this.undoStack.length > 1 && (this.undoStack.length > this.maxCount || bytes > this.maxBytes)) bytes -= History.size(this.undoStack.shift());
	}
	get canUndo() {
		return this.undoStack.length > 0;
	}
	get canRedo() {
		return this.redoStack.length > 0;
	}
	/** Step back: pass the CURRENT state, get the previous one (or null). */
	undo(current) {
		if (!this.undoStack.length) return null;
		this.redoStack.push(current);
		return this.undoStack.pop();
	}
	redo(current) {
		if (!this.redoStack.length) return null;
		this.undoStack.push(current);
		return this.redoStack.pop();
	}
	clear() {
		this.undoStack = [];
		this.redoStack = [];
	}
}

export const ZOOM_STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8];
export const clampZoom = (z) => Math.max(0.1, Math.min(8, z));
/** Next zoom stop above (dir 1) or below (dir -1) `z`. */
export function stepZoom(z, dir) {
	if (dir > 0) return ZOOM_STEPS.find((s) => s > z + 1e-6) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
	return [...ZOOM_STEPS].reverse().find((s) => s < z - 1e-6) ?? ZOOM_STEPS[0];
}
/** Largest zoom (at most 1) at which a w by h canvas fits a box. */
export const fitZoom = (w, h, boxW, boxH) => clampZoom(Math.min(1, boxW / w, boxH / h));

/**
 * Constrain the drag from (x0, y0) to (x1, y1): lines snap to 45 degree steps, boxes to squares/circles.
 */
export function constrain(kind, x0, y0, x1, y1) {
	const dx = x1 - x0;
	const dy = y1 - y0;
	if (kind === 'line') {
		const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
		const len = Math.hypot(dx, dy);
		return [x0 + Math.cos(a) * len, y0 + Math.sin(a) * len];
	}
	const m = Math.max(Math.abs(dx), Math.abs(dy));
	return [x0 + Math.sign(dx || 1) * m, y0 + Math.sign(dy || 1) * m];
}

/** Brush width for a pointer: mouse is constant, pens scale with pressure (0 to 1). */
export function pressureWidth(size, pointerType, pressure) {
	if (pointerType !== 'pen' || !(pressure > 0)) return size;
	return Math.max(0.5, size * (0.25 + pressure * 1.5));
}

/** Clamp a canvas dimension to a sane range. */
export const clampDim = (n) => Math.max(1, Math.min(8192, Math.round(Number(n) || 0)));

/** Output format for a file name: png, jpeg or webp. Defaults to png. */
export function formatForName(name) {
	const e = String(name).split('.').pop().toLowerCase();
	if (e === 'jpg' || e === 'jpeg') return { ext: e, mime: 'image/jpeg' };
	if (e === 'webp') return { ext: 'webp', mime: 'image/webp' };
	return { ext: 'png', mime: 'image/png' };
}

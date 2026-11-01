// Pure rules for the desktop widgets: the catalog, the desktop grid and its
// first-fit placement, stored-layout validation, number and time formatting,
// sparkline geometry, weather codes and the month grid. No DOM, unit tested in
// tests/desktop-widgets.test.js.

/** Pixel size of one grid unit and the gap between widgets. */
export const UNIT = 168;
export const GAP = 14;
export const STEP = UNIT + GAP;

/** Widget sizes in grid units. */
export const SIZES = {
	s: { w: 1, h: 1, label: 'Small' },
	m: { w: 2, h: 1, label: 'Medium' },
	l: { w: 2, h: 2, label: 'Large' },
};

/**
 * Every widget a visitor can add. `sizes` lists the sizes the widget renders
 * well at, the first being its default. `feeds` names the live sources it reads
 * (see data.js), so the board can say where the numbers come from.
 */
export const CATALOG = [
	{ type: 'three', title: '$THREE', desc: 'Live price, 24h change and a 24 hour chart', sizes: ['m', 's', 'l'], feeds: ['token', 'history'], app: 'trenches' },
	{ type: 'weather', title: 'Weather', desc: 'Current conditions and the next hours where you are', sizes: ['m', 's', 'l'], feeds: ['weather'], app: 'weather' },
	{ type: 'clock', title: 'Clock', desc: 'Analog clock with your local time and date', sizes: ['s', 'm'], feeds: [], app: 'clock' },
	{ type: 'calendar', title: 'Calendar', desc: 'This month at a glance', sizes: ['l', 'm'], feeds: [] },
	{ type: 'agents', title: 'New agents', desc: 'The newest agents on three.ws', sizes: ['m', 'l'], feeds: ['agents'], app: 'discover' },
	{ type: 'pulse', title: 'Pulse', desc: 'Live wallet moves by agents', sizes: ['l', 'm'], feeds: ['pulse'], app: 'pulse' },
	{ type: 'launches', title: 'Launches', desc: 'Coins agents launched through three.ws', sizes: ['l', 'm'], feeds: ['launches'], app: 'launcher' },
	{ type: 'platform', title: 'Platform', desc: 'Agents, launches and strategies right now', sizes: ['m', 's'], feeds: ['stats'] },
	{ type: 'news', title: 'Headlines', desc: 'Top crypto headlines from the three.ws news desk', sizes: ['l', 'm'], feeds: ['news'], app: 'page:/markets/news' },
	{ type: 'system', title: 'System', desc: 'Battery, network, memory and storage of this device', sizes: ['m', 's'], feeds: [] },
	{ type: 'note', title: 'Sticky note', desc: 'A note that stays on your desktop', sizes: ['s', 'm', 'l'], feeds: [] },
];

export const catalogItem = (type) => CATALOG.find((c) => c.type === type) || null;

/** The widgets a fresh desktop starts with. */
export const DEFAULT_LAYOUT = [
	{ type: 'three', size: 'm' },
	{ type: 'weather', size: 'm' },
	{ type: 'clock', size: 's' },
	{ type: 'platform', size: 's' },
	{ type: 'pulse', size: 'l' },
];

/** How many grid columns and rows fit a work area of the given pixel size. */
export function gridFor(width, height) {
	return {
		cols: Math.max(0, Math.floor((width + GAP) / STEP)),
		rows: Math.max(0, Math.floor((height + GAP) / STEP)),
	};
}

const sizeOf = (w) => SIZES[w.size] || SIZES.s;
const hits = (a, b) => a.col < b.col + b.w && b.col < a.col + a.w && a.row < b.row + b.h && b.row < a.row + a.h;
const box = (w) => ({ col: w.col, row: w.row, ...sizeOf(w) });

/** True when a widget at (col,row) fits the grid and overlaps none of `others`. */
export function fits(widget, col, row, others, grid) {
	const s = sizeOf(widget);
	if (col < 0 || row < 0 || col + s.w > grid.cols || row + s.h > grid.rows) return false;
	const me = { col, row, w: s.w, h: s.h };
	return !others.some((o) => o.id !== widget.id && hits(me, box(o)));
}

/**
 * First free cell for `widget`. Columns count from the right edge of the work
 * area (column 0 is rightmost) so widgets fill in from the right and leave the
 * desktop icons on the left alone. Scans column by column, top to bottom.
 * Returns null when the grid is full.
 */
export function firstFit(widget, others, grid) {
	for (let col = 0; col < grid.cols; col++) {
		for (let row = 0; row < grid.rows; row++) if (fits(widget, col, row, others, grid)) return { col, row };
	}
	return null;
}

const STEPS = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/**
 * The cell an arrow key moves `widget` to: one step in that direction (columns
 * count from the right, so Left is col + 1), hopping over any neighbour in the
 * way to the next free cell. Null when the key is not an arrow or nothing beyond
 * fits. `others` may include the widget itself.
 */
export function nudge(widget, key, others, grid) {
	const step = STEPS[key];
	if (!step) return null;
	let { col, row } = widget;
	for (;;) {
		col += step[0];
		row += step[1];
		if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return null;
		if (fits(widget, col, row, others, grid)) return { col, row };
	}
}

/**
 * Validate a stored layout: drop unknown types and bad sizes, give every widget
 * an id, and re-place anything that no longer fits (a smaller window, a moved
 * neighbour). Widgets that cannot fit at all are kept with `hidden: true` so
 * they come back when there is room again.
 */
export function settle(raw, grid) {
	const list = Array.isArray(raw) ? raw : [];
	const out = [];
	let n = 0;
	for (const r of list) {
		if (!r || typeof r !== 'object') continue;
		const item = catalogItem(r.type);
		if (!item) continue;
		const size = item.sizes.includes(r.size) ? r.size : item.sizes[0];
		const id = typeof r.id === 'string' && /^[\w-]{1,40}$/.test(r.id) && !out.some((o) => o.id === r.id) ? r.id : `w${Date.now().toString(36)}${n++}`;
		const w = { id, type: r.type, size, col: Number.isInteger(r.col) ? r.col : -1, row: Number.isInteger(r.row) ? r.row : -1 };
		if (r.data && typeof r.data === 'object') w.data = r.data;
		const placed = out.filter((o) => !o.hidden);
		if (!fits(w, w.col, w.row, placed, grid)) {
			const at = firstFit(w, placed, grid);
			if (at) Object.assign(w, at);
			else w.hidden = true;
		}
		out.push(w);
	}
	return out;
}

/** Nearest grid cell to a pixel offset measured from the top-right of the work area. */
export function cellAt(dxFromRight, dyFromTop) {
	return { col: Math.max(0, Math.round(dxFromRight / STEP)), row: Math.max(0, Math.round(dyFromTop / STEP)) };
}

/** Pixel box of a widget, `right`/`top` offsets from the work area's top-right. */
export function pixelBox(w) {
	const s = sizeOf(w);
	return { right: w.col * STEP, top: w.row * STEP, width: s.w * UNIT + (s.w - 1) * GAP, height: s.h * UNIT + (s.h - 1) * GAP };
}

// ---------- formatting ----------

/** USD price with enough significant digits for sub-cent tokens. */
export function fmtPrice(v) {
	const n = Number(v);
	if (!Number.isFinite(n) || n < 0) return '';
	if (n === 0) return '$0.00';
	if (n >= 1) return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	const digits = Math.min(10, Math.max(2, 2 - Math.floor(Math.log10(n))));
	return `$${n.toFixed(digits)}`;
}

/** 1234 -> 1.2K, 502446 -> 502K, 1.5e6 -> 1.5M. */
export function fmtCompact(v, prefix = '') {
	const n = Number(v);
	if (!Number.isFinite(n)) return '';
	const abs = Math.abs(n);
	const unit = abs >= 1e9 ? [1e9, 'B'] : abs >= 1e6 ? [1e6, 'M'] : abs >= 1e3 ? [1e3, 'K'] : [1, ''];
	const x = n / unit[0];
	const s = unit[0] === 1 ? String(Math.round(x)) : x.toFixed(Math.abs(x) >= 100 ? 0 : 1).replace(/\.0$/, '');
	return `${prefix}${s}${unit[1]}`;
}

/** Signed percent: +3.2%, -0.4%, 0.0%. */
export function fmtPct(v) {
	if (v == null || v === '') return '';
	const n = Number(v);
	if (!Number.isFinite(n)) return '';
	return `${n > 0 ? '+' : ''}${n.toFixed(Math.abs(n) >= 100 ? 0 : 1)}%`;
}

/** Compact age: now, 4m, 3h, 2d. */
export function relTime(ts, now = Date.now()) {
	const t = typeof ts === 'number' ? ts : Date.parse(ts);
	if (!Number.isFinite(t)) return '';
	const s = Math.max(0, (now - t) / 1000);
	if (s < 45) return 'now';
	if (s < 3600) return `${Math.round(s / 60)}m`;
	if (s < 86400) return `${Math.round(s / 3600)}h`;
	return `${Math.round(s / 86400)}d`;
}

/**
 * SVG path data for a sparkline through `values`, fitted to w x h with a small
 * vertical pad. Returns { line, area } ('' when there are fewer than 2 points).
 */
export function sparkPath(values, w, h, pad = 2) {
	const v = (values || []).map(Number).filter(Number.isFinite);
	if (v.length < 2) return { line: '', area: '' };
	const lo = Math.min(...v);
	const hi = Math.max(...v);
	const span = hi - lo || 1;
	const pts = v.map((x, i) => [(i / (v.length - 1)) * w, pad + (1 - (x - lo) / span) * (h - pad * 2)]);
	const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
	return { line, area: `${line}L${w} ${h}L0 ${h}Z` };
}

// ---------- weather ----------

const WMO = [
	[[0], 'Clear', 'sun'],
	[[1], 'Mostly clear', 'sun'],
	[[2], 'Partly cloudy', 'partly'],
	[[3], 'Overcast', 'cloud'],
	[[45, 48], 'Fog', 'fog'],
	[[51, 53, 55, 56, 57], 'Drizzle', 'rain'],
	[[61, 63, 66, 80, 81], 'Rain', 'rain'],
	[[65, 67, 82], 'Heavy rain', 'rain'],
	[[71, 73, 75, 77, 85, 86], 'Snow', 'snow'],
	[[95, 96, 99], 'Thunderstorm', 'storm'],
];

/** Open-Meteo WMO weather code to a label and an icon key. Night swaps sun for moon. */
export function weatherInfo(code, isDay = true) {
	const hit = WMO.find(([codes]) => codes.includes(Number(code)));
	const [, label, icon] = hit || [null, 'Unknown', 'cloud'];
	return { label, icon: !isDay && icon === 'sun' ? 'moon' : !isDay && icon === 'partly' ? 'partly-night' : icon };
}

/** A readable city from an IANA time zone: "America/New_York" -> "New York". */
export function tzCity(tz) {
	const last = String(tz || '').split('/').pop() || '';
	if (!last || /^(UTC|GMT|Etc)/i.test(last) || /[+-]\d/.test(last)) return '';
	return last.replace(/_/g, ' ');
}

/** Fahrenheit for the few regions that use it, Celsius everywhere else. */
export function usesFahrenheit(locale) {
	return /-(US|LR|MM|BS|BZ|KY|PW)\b/i.test(String(locale || ''));
}

// ---------- calendar ----------

/**
 * The 6x7 day grid for the month containing `date`, weeks starting on
 * `weekStart` (0 Sunday, 1 Monday). Each cell: { y, m, d, inMonth, today }.
 */
export function monthGrid(date, weekStart = 0, today = new Date()) {
	const first = new Date(date.getFullYear(), date.getMonth(), 1);
	const lead = (first.getDay() - weekStart + 7) % 7;
	const start = new Date(first.getFullYear(), first.getMonth(), 1 - lead);
	const cells = [];
	for (let i = 0; i < 42; i++) {
		const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
		cells.push({
			y: d.getFullYear(),
			m: d.getMonth(),
			d: d.getDate(),
			inMonth: d.getMonth() === first.getMonth(),
			today: d.getFullYear() === today.getFullYear() && d.getMonth() === today.getMonth() && d.getDate() === today.getDate(),
		});
	}
	return cells;
}

/** First day of the week for a locale (1 Monday for most of the world, 0 Sunday for a few). */
export function weekStartFor(locale) {
	try {
		const info = new Intl.Locale(locale);
		const wi = info.getWeekInfo?.() || info.weekInfo;
		if (wi && Number.isInteger(wi.firstDay)) return wi.firstDay % 7;
	} catch {
		/* older engines */
	}
	return /-(US|CA|JP|BR|IL|PH|MX|KR|TW|IN|ZA|SA|AU)\b/i.test(String(locale || '')) ? 0 : 1;
}

// ---------- system ----------

/** "1.2 GB" style byte formatting. */
export function fmtBytes(b) {
	const n = Number(b);
	if (!Number.isFinite(n) || n < 0) return '';
	const u = ['B', 'KB', 'MB', 'GB', 'TB'];
	let i = 0;
	let x = n;
	while (x >= 1024 && i < u.length - 1) {
		x /= 1024;
		i++;
	}
	return `${x.toFixed(x >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

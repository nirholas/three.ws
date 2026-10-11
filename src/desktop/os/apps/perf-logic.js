// Pure maths and formatting for the Task Manager's Performance and Details tabs.

/** Fixed-capacity ring buffer of numbers (null marks a sample the source could not provide). */
export class RingBuffer {
	constructor(capacity = 60) {
		this.capacity = capacity;
		this.buf = new Array(capacity).fill(null);
		this.head = 0;
		this.size = 0;
	}
	push(v) {
		this.buf[this.head] = v;
		this.head = (this.head + 1) % this.capacity;
		if (this.size < this.capacity) this.size++;
	}
	/** Oldest to newest. */
	toArray() {
		const out = [];
		for (let i = 0; i < this.size; i++) out.push(this.buf[(this.head - this.size + i + this.capacity * 2) % this.capacity]);
		return out;
	}
	last() {
		return this.size ? this.buf[(this.head - 1 + this.capacity) % this.capacity] : null;
	}
	/** Max of the real (non-null) samples, or 0. */
	max() {
		return this.toArray().reduce((m, v) => (v != null && v > m ? v : m), 0);
	}
}

export function formatBytes(n) {
	if (n == null || !Number.isFinite(n)) return 'n/a';
	if (n < 1024) return `${Math.round(n)} B`;
	const u = ['KB', 'MB', 'GB', 'TB'];
	let i = -1;
	do {
		n /= 1024;
		i++;
	} while (n >= 1024 && i < u.length - 1);
	return `${n.toFixed(n < 10 ? 2 : n < 100 ? 1 : 0)} ${u[i]}`;
}

export function formatMs(ms) {
	if (ms == null || !Number.isFinite(ms)) return 'n/a';
	return ms < 1000 ? `${ms < 10 ? ms.toFixed(1) : Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

export const formatPct = (f) => (f == null || !Number.isFinite(f) ? 'n/a' : `${Math.round(f * 100)}%`);

export function formatDuration(ms) {
	const s = Math.floor(ms / 1000);
	const hh = Math.floor(s / 3600);
	const mm = Math.floor((s % 3600) / 60);
	const ss = s % 60;
	return hh ? `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${mm}:${String(ss).padStart(2, '0')}`;
}

/** Frames per second from requestAnimationFrame timestamps (ms) that fall in the last `windowMs`. */
export function fpsFromFrames(times, now, windowMs = 1000) {
	const recent = times.filter((t) => t > now - windowMs && t <= now);
	if (recent.length < 2) return null;
	const span = recent[recent.length - 1] - recent[0];
	return span > 0 ? ((recent.length - 1) * 1000) / span : null;
}

/** Fraction (0..1) of [t0, t1] covered by long tasks ({ startTime, duration }). Overlap is clipped. */
export function longTaskLoad(tasks, t0, t1) {
	const span = t1 - t0;
	if (span <= 0) return 0;
	let busy = 0;
	for (const t of tasks) {
		const a = Math.max(t.startTime, t0);
		const b = Math.min(t.startTime + t.duration, t1);
		if (b > a) busy += b - a;
	}
	return Math.min(1, busy / span);
}

/** Fraction (0..1) of an interval a timer probe arrived late: a busy main thread delays timers. */
export function driftLoad(expectedMs, actualMs) {
	if (expectedMs <= 0) return 0;
	return Math.min(1, Math.max(0, (actualMs - expectedMs) / expectedMs));
}

/** Main-thread load estimate: the larger of what long tasks and timer drift each show. */
export function mainThreadLoad({ tasks = [], t0, t1, expectedMs, actualMs }) {
	return Math.max(longTaskLoad(tasks, t0, t1), driftLoad(expectedMs, actualMs));
}

/** Split a total across windows by weight. Returns shares that sum to the total (or zeros when weights are zero). */
export function shareTotal(total, weights) {
	const sum = weights.reduce((a, b) => a + b, 0);
	if (!sum || total == null) return weights.map(() => 0);
	return weights.map((w) => (total * w) / sum);
}

/** Approximate relative weight of a window for the estimated-memory split: its pixel area, floor of one 100x100 area. */
export const windowWeight = (rect) => Math.max(10000, (rect?.w || 0) * (rect?.h || 0));

/** Aggregate resource-timing entries into counts, bytes and slowest. */
export function summarizeResources(entries, top = 8) {
	const byType = {};
	let transfer = 0;
	for (const e of entries) {
		const t = e.initiatorType || 'other';
		const row = (byType[t] ||= { type: t, count: 0, bytes: 0 });
		row.count++;
		row.bytes += e.transferSize || 0;
		transfer += e.transferSize || 0;
	}
	const slowest = [...entries]
		.sort((a, b) => b.duration - a.duration)
		.slice(0, top)
		.map((e) => ({ name: e.name, type: e.initiatorType || 'other', duration: e.duration, bytes: e.transferSize || 0 }));
	return { total: entries.length, transfer, byType: Object.values(byType).sort((a, b) => b.count - a.count), slowest };
}

/** Short display name for a resource URL. */
export function shortUrl(url, max = 56) {
	let s = String(url);
	try {
		const u = new URL(s);
		s = (u.origin === (typeof location !== 'undefined' ? location.origin : '') ? '' : u.host) + u.pathname + u.search;
	} catch {
		/* keep raw */
	}
	return s.length > max ? `${s.slice(0, max / 2 - 1)}...${s.slice(-(max / 2 - 2))}` : s;
}

/** Sort rows by key. dir 1 ascending, -1 descending; nulls always last. */
export function sortRows(rows, key, dir = 1) {
	return [...rows].sort((a, b) => {
		const x = a[key];
		const y = b[key];
		if (x == null && y == null) return 0;
		if (x == null) return 1;
		if (y == null) return -1;
		return (typeof x === 'string' ? x.localeCompare(y, undefined, { sensitivity: 'base' }) : x - y) * dir;
	});
}

/** Navigation timing milestones in ms from the navigation start. */
export function pageTiming(nav) {
	if (!nav) return null;
	const rel = (v) => (v > 0 ? v : null);
	return {
		dns: nav.domainLookupEnd - nav.domainLookupStart,
		connect: nav.connectEnd - nav.connectStart,
		ttfb: rel(nav.responseStart),
		domInteractive: rel(nav.domInteractive),
		domContentLoaded: rel(nav.domContentLoadedEventEnd),
		load: rel(nav.loadEventEnd),
		transferSize: nav.transferSize || 0,
	};
}

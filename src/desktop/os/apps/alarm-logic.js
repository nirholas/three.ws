// Alarm, timer and stopwatch logic plus a tiny module-level scheduler.
//
// The scheduler runs while the page is open, not after it closes: Clock registers its listeners
// once on mount and the interval keeps ticking after the Clock window is closed, so a timer or
// alarm still rings if you close the app. Nothing here can wake a closed tab.

export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Next Date an alarm {h, m, days[]} fires strictly after `from`. days empty means one-shot. Null if disabled. */
export function nextAlarmTime(alarm, from = new Date()) {
	if (!alarm.on) return null;
	const days = alarm.days || [];
	for (let add = 0; add < 8; add++) {
		const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + add, alarm.h, alarm.m, 0, 0);
		if (d.getTime() <= from.getTime()) continue;
		if (!days.length || days.includes(d.getDay())) return d;
	}
	return null;
}

/** Human summary of repeat days. */
export function repeatLabel(days = []) {
	if (!days.length) return 'Once';
	if (days.length === 7) return 'Every day';
	const s = [...days].sort();
	if (s.join() === '1,2,3,4,5') return 'Weekdays';
	if (s.join() === '0,6') return 'Weekends';
	return s.map((d) => DAYS[d]).join(', ');
}

/** Time until `target` as "in 3 h 20 min". */
export function untilLabel(target, now = new Date()) {
	const ms = target - now;
	if (ms <= 0) return 'now';
	const m = Math.ceil(ms / 60000);
	const d = Math.floor(m / 1440);
	const h = Math.floor((m % 1440) / 60);
	const mm = m % 60;
	const parts = [];
	if (d) parts.push(`${d} d`);
	if (h) parts.push(`${h} h`);
	if (mm || !parts.length) parts.push(`${mm} min`);
	return `in ${parts.join(' ')}`;
}

/** mm:ss or h:mm:ss; `cs` adds centiseconds for the stopwatch. */
export function formatDuration(ms, cs = false) {
	const neg = ms < 0;
	let t = Math.abs(Math.floor(ms));
	const c = Math.floor((t % 1000) / 10);
	t = Math.floor(t / 1000);
	const s = t % 60;
	const m = Math.floor(t / 60) % 60;
	const h = Math.floor(t / 3600);
	const p = (n) => String(n).padStart(2, '0');
	const base = h ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
	return (neg ? '-' : '') + base + (cs ? `.${p(c)}` : '');
}

/** Parse "90", "1:30", "1:02:03" or "5m 30s" to milliseconds, or null. */
export function parseDuration(text) {
	const t = String(text).trim().toLowerCase();
	if (!t) return null;
	if (/^\d+(:\d{1,2}){1,2}$/.test(t)) {
		const p = t.split(':').map(Number);
		const sec = p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
		return sec * 1000;
	}
	if (/^\d+$/.test(t)) return Number(t) * 1000;
	const re = /(\d+(?:\.\d+)?)\s*(h|m|s)/g;
	let total = 0;
	let hit = false;
	for (let m = re.exec(t); m; m = re.exec(t)) {
		hit = true;
		total += Number(m[1]) * { h: 3600, m: 60, s: 1 }[m[2]] * 1000;
	}
	return hit ? Math.round(total) : null;
}

/** Stopwatch state helpers (pure): { running, startedAt, elapsed, laps[] }. */
export const stopwatch = {
	fresh: () => ({ running: false, startedAt: 0, elapsed: 0, laps: [] }),
	now: (s, t = Date.now()) => s.elapsed + (s.running ? t - s.startedAt : 0),
	start: (s, t = Date.now()) => (s.running ? s : { ...s, running: true, startedAt: t }),
	pause: (s, t = Date.now()) => (s.running ? { ...s, running: false, elapsed: s.elapsed + t - s.startedAt } : s),
	lap(s, t = Date.now()) {
		const total = stopwatch.now(s, t);
		const prev = s.laps.length ? s.laps[s.laps.length - 1].total : 0;
		return { ...s, laps: [...s.laps, { n: s.laps.length + 1, split: total - prev, total }] };
	},
};

/** Fastest and slowest lap numbers, only meaningful with 2+ laps. */
export function lapExtremes(laps) {
	if (laps.length < 2) return {};
	let min = laps[0];
	let max = laps[0];
	for (const l of laps) {
		if (l.split < min.split) min = l;
		if (l.split > max.split) max = l;
	}
	return { fastest: min.n, slowest: max.n };
}

/** Zone offset in minutes east of UTC for an IANA zone at `date`, via Intl. Throws RangeError for a bad zone. */
export function zoneOffsetMinutes(zone, date = new Date()) {
	const f = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
	const o = {};
	for (const p of f.formatToParts(date)) o[p.type] = p.value;
	const asUtc = Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour % 24, +o.minute, +o.second);
	return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

export function isValidZone(zone) {
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: zone });
		return true;
	} catch {
		return false;
	}
}

/** "UTC+5:30" label. */
export function offsetLabel(mins) {
	const sign = mins < 0 ? '-' : '+';
	const a = Math.abs(mins);
	const h = Math.floor(a / 60);
	const m = a % 60;
	return `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
}

/** "Same time", "+3 h", "-5 h 30 min" relative to the local zone. */
export function relativeOffset(zoneMins, localMins) {
	const d = zoneMins - localMins;
	if (d === 0) return 'Same time';
	const a = Math.abs(d);
	const h = Math.floor(a / 60);
	const m = a % 60;
	return `${d > 0 ? '+' : '-'}${h ? `${h} h` : ''}${h && m ? ' ' : ''}${m ? `${m} min` : ''}`;
}

/** Day or night at a zone, using a plain 06:00 to 18:00 rule on the zone's local hour. */
export function isDaytime(zone, date = new Date()) {
	const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', hour: 'numeric' }).format(date));
	return hour >= 6 && hour < 18;
}

// ---- scheduler ----

let timerId = null;
const listeners = new Set();
let started = 0;

/**
 * Start (reference counted) the 1 s scheduler and subscribe `fn(nowMs)`. Returns an unsubscribe.
 * The interval survives window close; it stops only when the last subscriber leaves, and the
 * Clock keeps a permanent subscriber for armed alarms and timers (see registerRinger).
 */
export function subscribeTick(fn) {
	listeners.add(fn);
	if (!timerId) {
		timerId = setInterval(tick, 500);
		if (typeof document !== 'undefined') document.addEventListener('visibilitychange', tick);
	}
	started++;
	return () => {
		listeners.delete(fn);
		if (!listeners.size && timerId) {
			clearInterval(timerId);
			timerId = null;
			if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', tick);
		}
	};
}

function tick() {
	const now = Date.now();
	for (const fn of [...listeners]) {
		try {
			fn(now);
		} catch (err) {
			console.error('[clock] tick listener failed', err);
		}
	}
}

export const schedulerStats = () => ({ running: !!timerId, listeners: listeners.size, started });

/**
 * Ringer: evaluates alarms and timers against the clock. Kept pure-ish so it can be tested:
 * `check(state, now, lastNow)` returns { fired: [...], state } where alarms that crossed their time
 * since `lastNow` (so a throttled background tab still fires on its next tick) are reported once.
 */
export function checkAlarms(alarms, now, lastNow) {
	const fired = [];
	const next = alarms.map((a) => {
		if (!a.on) return a;
		const t = nextAlarmTime(a, new Date(lastNow));
		if (t && t.getTime() <= now) {
			fired.push(a);
			return (a.days || []).length ? a : { ...a, on: false };
		}
		return a;
	});
	return { fired, alarms: next };
}

/** Timers: { id, label, total, endsAt|null, left, done }. Returns timers that finished at `now`. */
export function checkTimers(timers, now) {
	const fired = [];
	const next = timers.map((t) => {
		if (t.endsAt && !t.done && t.endsAt <= now) {
			fired.push(t);
			return { ...t, done: true, endsAt: null, left: 0 };
		}
		return t;
	});
	return { fired, timers: next };
}

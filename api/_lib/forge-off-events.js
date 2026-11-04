// Forge-Off themed events: config loader, validation and UTC window math.
//
// An event is a run of consecutive UTC calendar days, each with its own theme
// and its own board, over the same auth-free vote pipeline as the weekly
// Forge-Off. The config lives in data/forge-off-events.json and is validated at
// module load, so a malformed entry fails the boot instead of a request.
//
// All windows are half-open [from, to) in UTC and built from epoch
// milliseconds, so they are independent of the server timezone and of DST.

import { readFileSync } from 'node:fs';

const DAY_MS = 86_400_000;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T00:00:00Z$/;

function parseDate(s) {
	if (!DATE_RE.test(s)) return null;
	const t = Date.parse(`${s}T00:00:00Z`);
	if (!Number.isFinite(t)) return null;
	return new Date(t).toISOString().slice(0, 10) === s ? new Date(t) : null;
}

function requireText(v, label, max) {
	if (typeof v !== 'string' || !v.trim() || v.length > max) {
		throw new Error(`forge-off-events: ${label} must be a non-empty string up to ${max} characters`);
	}
	return v.trim();
}

function validateEvent(raw, i) {
	const at = `events[${i}]`;
	if (!raw || typeof raw !== 'object') throw new Error(`forge-off-events: ${at} must be an object`);
	if (typeof raw.slug !== 'string' || !SLUG_RE.test(raw.slug)) {
		throw new Error(`forge-off-events: ${at}.slug must match ${SLUG_RE}`);
	}
	const title = requireText(raw.title, `${at}.title`, 120);
	const summary = requireText(raw.summary, `${at}.summary`, 400);
	const prizes = requireText(raw.prizes_note, `${at}.prizes_note`, 400);
	if (typeof raw.starts_at !== 'string' || !ISO_UTC_RE.test(raw.starts_at)) {
		throw new Error(`forge-off-events: ${at}.starts_at must be a UTC midnight like 2026-01-05T00:00:00Z`);
	}
	if (typeof raw.ends_at !== 'string' || !ISO_UTC_RE.test(raw.ends_at)) {
		throw new Error(`forge-off-events: ${at}.ends_at must be a UTC midnight like 2026-01-06T00:00:00Z`);
	}
	const start = new Date(raw.starts_at);
	const end = new Date(raw.ends_at);
	if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
		throw new Error(`forge-off-events: ${at}.ends_at must be after starts_at`);
	}
	if (!Array.isArray(raw.days) || raw.days.length < 1 || raw.days.length > 31) {
		throw new Error(`forge-off-events: ${at}.days must hold 1 to 31 entries`);
	}
	const days = raw.days.map((d, n) => {
		const dat = `${at}.days[${n}]`;
		const date = parseDate(d?.date);
		if (!date) throw new Error(`forge-off-events: ${dat}.date must be a real YYYY-MM-DD date`);
		const from = new Date(start.getTime() + n * DAY_MS);
		if (date.getTime() !== from.getTime()) {
			throw new Error(`forge-off-events: ${dat}.date must be consecutive from starts_at (expected ${from.toISOString().slice(0, 10)})`);
		}
		const href = d.surface_href;
		if (typeof href !== 'string' || !/^\/[A-Za-z0-9]/.test(href) || href.startsWith('//')) {
			throw new Error(`forge-off-events: ${dat}.surface_href must be a same-site path starting with /`);
		}
		return {
			index: n + 1,
			date: d.date,
			theme: requireText(d.theme, `${dat}.theme`, 120),
			surface: requireText(d.surface, `${dat}.surface`, 60),
			surface_href: href,
			start: from,
			end: new Date(from.getTime() + DAY_MS),
		};
	});
	if (days[days.length - 1].end.getTime() !== end.getTime()) {
		throw new Error(`forge-off-events: ${at}.ends_at must equal the end of the last day (${days[days.length - 1].end.toISOString()})`);
	}
	return { slug: raw.slug, title, summary, prizes_note: prizes, start, end, days };
}

export function validateEvents(config) {
	if (!config || !Array.isArray(config.events)) {
		throw new Error('forge-off-events: config must hold an events array');
	}
	const seen = new Set();
	return config.events.map((raw, i) => {
		const e = validateEvent(raw, i);
		if (seen.has(e.slug)) throw new Error(`forge-off-events: duplicate slug ${e.slug}`);
		seen.add(e.slug);
		return e;
	});
}

const EVENTS = validateEvents(
	JSON.parse(readFileSync(new URL('../../data/forge-off-events.json', import.meta.url), 'utf8')),
);

export function listEvents() {
	return EVENTS;
}

export function isValidSlug(s) {
	return typeof s === 'string' && SLUG_RE.test(s);
}

export function getEvent(slug) {
	return EVENTS.find((e) => e.slug === slug) || null;
}

// The UTC calendar day containing `ref`.
export function currentDayWindow(ref = new Date()) {
	const from = new Date(Math.floor(new Date(ref).getTime() / DAY_MS) * DAY_MS);
	return { from, to: new Date(from.getTime() + DAY_MS) };
}

export function eventPhase(event, ref = new Date()) {
	const t = new Date(ref).getTime();
	if (t < event.start.getTime()) return 'upcoming';
	if (t >= event.end.getTime()) return 'ended';
	return 'live';
}

export function activeDay(event, ref = new Date()) {
	const t = new Date(ref).getTime();
	return event.days.find((d) => t >= d.start.getTime() && t < d.end.getTime()) || null;
}

// Days whose window has fully closed at `ref`.
export function closedDays(event, ref = new Date()) {
	const t = new Date(ref).getTime();
	return event.days.filter((d) => d.end.getTime() <= t);
}

// The event to show by default: the live one, else the next upcoming, else the
// most recently ended. Null when no events are configured.
export function pickDefaultEvent(ref = new Date()) {
	const live = EVENTS.find((e) => eventPhase(e, ref) === 'live');
	if (live) return live;
	const upcoming = EVENTS.filter((e) => eventPhase(e, ref) === 'upcoming').sort((a, b) => a.start - b.start)[0];
	if (upcoming) return upcoming;
	return [...EVENTS].sort((a, b) => b.end - a.end)[0] || null;
}

export function publicEvent(event) {
	return {
		slug: event.slug,
		title: event.title,
		summary: event.summary,
		prizes_note: event.prizes_note,
		starts_at: event.start.toISOString(),
		ends_at: event.end.toISOString(),
		days: event.days.map((d) => ({
			index: d.index,
			date: d.date,
			theme: d.theme,
			surface: d.surface,
			surface_href: d.surface_href,
			starts_at: d.start.toISOString(),
			ends_at: d.end.toISOString(),
		})),
	};
}

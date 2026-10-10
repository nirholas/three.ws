// Shared helpers for the Event Markets pages: DOM builder, API client, formatting.

export const SOURCE_LABELS = {
	arena_tournament: 'Arena tournament',
	event_leaderboard: 'Event leaderboard',
	launch_cohort: 'Launch cohort',
	build_round: 'Build round',
	bounty: 'Bounty',
	custom: 'Special',
};

export const SERIES = ['var(--em-s1)', 'var(--em-s2)', 'var(--em-s3)', 'var(--em-s4)', 'var(--em-s5)', 'var(--em-s6)'];
export const seriesColor = (i) => (i < SERIES.length ? SERIES[i] : 'var(--em-other)');

export function h(tag, attrs, ...kids) {
	const el = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs || {})) {
		if (v == null || v === false) continue;
		if (k === 'class') el.className = v;
		else if (k === 'style') el.style.cssText = v;
		else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
		else el.setAttribute(k, v === true ? '' : v);
	}
	for (const kid of kids.flat()) {
		if (kid == null || kid === false) continue;
		el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
	}
	return el;
}

export class ApiError extends Error {
	constructor(status, code, message, details) {
		super(message);
		this.status = status;
		this.code = code;
		this.details = details;
	}
}

let csrf = null;
async function csrfToken() {
	if (csrf) return csrf;
	const r = await fetch('/api/csrf-token', { credentials: 'include' });
	if (!r.ok) throw new ApiError(r.status, 'csrf_unavailable', 'Could not start a secure session. Reload and try again.');
	const j = await r.json();
	csrf = j.token || j.csrfToken || j.data?.token || null;
	return csrf;
}

/** Calls /api/event-markets/*. Unwraps the {data, meta} envelope. */
export async function api(path, { method = 'GET', body, signal } = {}) {
	const headers = { accept: 'application/json' };
	const opts = { method, credentials: 'include', headers, signal };
	if (method !== 'GET') {
		headers['content-type'] = 'application/json';
		headers['x-csrf-token'] = (await csrfToken()) || '';
		if (body !== undefined) opts.body = JSON.stringify(body);
	}
	let res;
	try {
		res = await fetch(`/api/event-markets${path}`, opts);
	} catch (err) {
		if (err.name === 'AbortError') throw err;
		throw new ApiError(0, 'network', 'Could not reach three.ws. Check your connection and retry.');
	}
	const json = await res.json().catch(() => null);
	if (!res.ok) {
		const e = json?.error || {};
		if (res.status === 403 && /csrf/i.test(e.code || e.message || '')) csrf = null;
		throw new ApiError(res.status, e.code || 'error', e.message || `Request failed (${res.status}).`, e.details);
	}
	return json && 'data' in json ? json.data : json;
}

export const pct = (p) => {
	const n = Number(p);
	if (!Number.isFinite(n)) return '0%';
	return n >= 10 || Number.isInteger(n) ? `${Math.round(n)}%` : `${n.toFixed(1)}%`;
};

export function countdown(totalSec) {
	let s = Math.max(0, Math.floor(totalSec));
	const d = Math.floor(s / 86400); s -= d * 86400;
	const hr = Math.floor(s / 3600); s -= hr * 3600;
	const m = Math.floor(s / 60); s -= m * 60;
	const p = (n) => String(n).padStart(2, '0');
	if (d > 0) return `${d}d ${p(hr)}h ${p(m)}m`;
	if (hr > 0) return `${hr}h ${p(m)}m ${p(s)}s`;
	return `${p(m)}m ${p(s)}s`;
}

export function when(iso) {
	if (!iso) return '';
	return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export const initials = (label) => String(label || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

/** Profile link for an entrant, or null when the entrant has no public page. */
export function profileHref(o) {
	if (!o?.ref_kind || !o.ref_id) return null;
	const id = encodeURIComponent(o.ref_id);
	if (o.ref_kind === 'agent') return `/agent/${id}`;
	if (o.ref_kind === 'project') return `/launches/${id}`;
	if (o.ref_kind === 'wallet') return `https://solscan.io/account/${id}`;
	return null;
}

export const statusLabel = { open: 'Open', locked: 'Locked', resolved: 'Resolved', void: 'Void' };
export const marketHref = (m) => `/event-markets/${encodeURIComponent(m.slug)}`;

/** Unwrap a list response in either of its shapes. */
export function listOf(data) {
	const items = data?.items ?? data?.markets ?? (Array.isArray(data) ? data : []);
	return { items, nextCursor: data?.nextCursor ?? data?.next_cursor ?? null };
}

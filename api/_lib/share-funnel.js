// Share funnel counters: aggregate, non-identifying.
//
// After a creation is shared, is the link opened, is the AR button pressed, does
// an unfurl card render, and does a "make your own" click follow? This module
// records those counts into share_funnel_daily, one row per (day, surface, kind).
//
// Privacy: the only values ever written are the UTC day, a surface from the
// allowlist and a kind from the allowlist. No IP, user id, creation id or URL
// path is accepted by this module, so none can be stored by it.
//
// Fail open: a counter outage must never break an unfurl, an AR launch or a
// page load. recordShareEvent never throws and never blocks the caller.

import { sql } from './db.js';

export const SHARE_SURFACES = Object.freeze([
	'ar',
	'oembed_agent',
	'oembed_play',
	'creation_page',
	'og_image',
	'diorama_share',
]);
export const SHARE_KINDS = Object.freeze(['view', 'action', 'cta_click']);

const SURFACES = new Set(SHARE_SURFACES);
const KINDS = new Set(SHARE_KINDS);

/** True when (surface, kind) are both on the allowlist. */
export function isShareEvent(surface, kind) {
	return SURFACES.has(surface) && KINDS.has(kind);
}

/**
 * Count one share event. Fire-and-forget: returns a promise that always
 * resolves (true when counted, false when rejected or the write failed), so a
 * caller may `void` it or await it in a test.
 * @param {string} surface
 * @param {string} kind
 * @returns {Promise<boolean>}
 */
export async function recordShareEvent(surface, kind) {
	if (!isShareEvent(surface, kind)) return false;
	try {
		await sql`
			insert into share_funnel_daily (day, surface, kind, count)
			values ((now() at time zone 'utc')::date, ${surface}, ${kind}, 1)
			on conflict (day, surface, kind)
			do update set count = share_funnel_daily.count + 1
		`;
		return true;
	} catch (err) {
		console.warn('[share-funnel] counter write skipped:', String(err?.message || err).slice(0, 160));
		return false;
	}
}

/**
 * Per-surface totals over a window, for the funnel report. Read-only.
 * @param {number} days whole days, already clamped by the caller
 */
export async function readShareFunnel(days) {
	return sql`
		select surface, kind, coalesce(sum(count), 0)::bigint as count
		from share_funnel_daily
		where day > (now() at time zone 'utc')::date - ${days}::int
		group by surface, kind
		order by surface, kind
	`;
}

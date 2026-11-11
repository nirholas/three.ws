/**
 * Engine deep links for the Forge: `/forge?engine=<lane id>` lands with that
 * engine picked, the way `?tier=` presets the quality row. Partner pages use it
 * (the /microsoft hub's "Try it" sends `?mode=image&engine=trellis2`).
 *
 * Lane ids are the lowercase snake_case ids of api/_lib/forge-tiers.js. Anything
 * else is ignored, and so is a well-formed id the live catalog does not offer:
 * the caller only applies it when a usable engine button exists.
 */

const LANE_ID = /^[a-z0-9_]{1,40}$/;

/** The requested engine lane from a query string, or null. */
export function engineFromQuery(search) {
	const raw = new URLSearchParams(search || '').get('engine');
	const id = String(raw || '').trim().toLowerCase();
	return LANE_ID.test(id) ? id : null;
}

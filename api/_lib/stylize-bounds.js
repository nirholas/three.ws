// Density bounds per geometric stylize filter: the one server-side copy of the
// table workers/stylize STYLE_CATALOG clamps against (src/shared/stylize-filters.js
// carries the client-side copy with its UI copy and icons).
//
// The free /api/forge-stylize route and the paid /api/x402/pipeline-stylize
// stage clamp with it, and the listings (the service-catalog descriptor and
// the pipeline stage options schema) derive their ranges from it, so an
// advertised range cannot drift from the one the handler applies.
//
// Pure data, no imports: safe for lightweight discovery routes to load.

export const STYLE_BOUNDS = Object.freeze({
	voxel: Object.freeze({ def: 32, min: 8, max: 96 }),
	brick: Object.freeze({ def: 24, min: 8, max: 64 }),
	voronoi: Object.freeze({ def: 48, min: 12, max: 120 }),
	lowpoly: Object.freeze({ def: 40, min: 8, max: 120 }),
});

export const STYLE_IDS = Object.freeze(Object.keys(STYLE_BOUNDS));
export const DEFAULT_STYLE = 'voxel';

// Widest density any filter accepts (the envelope of every per-style range).
export const RESOLUTION_MIN = Math.min(...STYLE_IDS.map((id) => STYLE_BOUNDS[id].min));
export const RESOLUTION_MAX = Math.max(...STYLE_IDS.map((id) => STYLE_BOUNDS[id].max));

// "voxel 8-96, brick 8-64, ..." for listing copy; withDefaults appends each
// style's default density: "voxel 8-96 (default 32), ...".
export function styleRangesText({ withDefaults = false } = {}) {
	return STYLE_IDS.map((id) => {
		const b = STYLE_BOUNDS[id];
		return `${id} ${b.min}-${b.max}${withDefaults ? ` (default ${b.def})` : ''}`;
	}).join(', ');
}

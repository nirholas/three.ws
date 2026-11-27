// What the Forge page and the home widget may send for the engine that is
// selected, read from the same control record the API checks
// (api/_lib/forge-controls.js). Pure functions, no DOM, so both surfaces share
// them and tests/forge-control-state.test.js can cross every lane with every
// control.
//
// Three jobs:
//   1. The page's engine before the catalog renders sends no backend, so the
//      server routes to its own default lane instead of one the page guessed.
//   2. controlStateFor() says which controls to lock, hide or relabel for the
//      selected engine, with the one-line reason the API would give.
//   3. honoredRequest() drops what the selected lane would ignore (a seed, an
//      aspect ratio, a non-Standard tier, fill_other_sides), so a submit never
//      meets the 400 the API returns for those combinations.

import {
	laneHonorsTier,
	laneHonorsSeed,
	laneUsesAspect,
	laneFillsOtherSides,
	tierIgnoredReason,
	seedIgnoredReason,
	guidancePlaceholder,
} from '../api/_lib/forge-controls.js';

export const PAGE_DEFAULT_TIER = 'standard';
export const PAGE_DEFAULT_ASPECT = '1:1';

// No backend: the API's default for the image path (trellis_selfhost, with its
// own free fallbacks) serves the request, the same lane a bare API call gets.
export const PAGE_DEFAULT_ENGINE = Object.freeze({
	id: null,
	path: 'image',
	backend: null,
	byok: null,
	polyControl: false,
	modly: false,
	modelId: null,
});

const TIER_LABELS = { draft: 'Draft', standard: 'Standard', high: 'High' };

function named(backend) {
	return Boolean(backend) && backend !== 'auto';
}

/**
 * @param {{ backend?: string | null, label?: string, mode?: 'text' | 'image' | 'sketch' }} sel
 */
export function controlStateFor({ backend = null, label = '', mode = 'text' } = {}) {
	const name = label || 'This engine';
	const tierLocked = named(backend) && !laneHonorsTier(backend);
	const seedDisabled = named(backend) && !laneHonorsSeed(backend);
	return {
		tierLocked,
		tierReason: tierLocked ? tierIgnoredReason(name) : '',
		seedDisabled,
		seedReason: seedDisabled ? seedIgnoredReason(name) : '',
		aspectVisible: mode === 'text' && (!named(backend) || laneUsesAspect(backend)),
		guidancePlaceholder: guidancePlaceholder(named(backend) ? backend : null),
	};
}

/**
 * The request body with every control the named lane would ignore taken out.
 * Auto (no backend) is returned unchanged: the router picks the lane.
 *
 * @template {Record<string, any>} T
 * @param {T} body
 * @returns {T}
 */
export function honoredRequest(body) {
	if (!body || !named(body.backend)) return body;
	const out = { ...body };
	if (!laneHonorsTier(out.backend)) out.tier = PAGE_DEFAULT_TIER;
	if (!laneHonorsSeed(out.backend)) delete out.seed;
	if (!laneUsesAspect(out.backend)) delete out.aspect_ratio;
	if (!laneFillsOtherSides(out.backend)) delete out.fill_other_sides;
	return out;
}

/**
 * The options a model was made with, as short labels, leaving out any option
 * the lane did not honor so the line never claims control it did not have.
 *
 * @param {{ tier?: string, engineLabel?: string, backend?: string | null,
 *   aspect?: string, seed?: number | null, fromText?: boolean } | null} made
 * @returns {string[]}
 */
export function madeWithParts(made) {
	if (!made) return [];
	const parts = [];
	const tier = named(made.backend) && !laneHonorsTier(made.backend) ? PAGE_DEFAULT_TIER : made.tier;
	if (TIER_LABELS[tier]) parts.push(TIER_LABELS[tier]);
	if (made.engineLabel) parts.push(made.engineLabel);
	if (made.fromText && made.aspect && (!named(made.backend) || laneUsesAspect(made.backend))) {
		parts.push(`${made.aspect} reference`);
	}
	if (Number.isInteger(made.seed) && (!named(made.backend) || laneHonorsSeed(made.backend))) {
		parts.push(`seed ${made.seed}`);
	}
	return parts;
}

export function madeWithSummary(made) {
	const parts = madeWithParts(made);
	return parts.length ? `Made with ${parts.join(', ')}` : '';
}

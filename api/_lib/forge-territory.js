/**
 * Forge territory router
 * ----------------------
 * Some model licences exclude whole regions. The Hunyuan3D 2.1 community
 * licence (Territory clause) does not grant any rights in the European Union,
 * the United Kingdom or South Korea, for the model or for its output. three.ws
 * serves those regions, so a request that originates there must never be
 * routed to a lane that runs a Tencent model.
 *
 * The country is resolved server side from the edge geo header
 * (api/_lib/client-geo.js), never from a field the caller controls. An unknown
 * country fails closed: the request is treated as restricted, because the
 * alternative is shipping a licensed-out model to a region we could not rule
 * out.
 *
 * Lanes that run a Tencent model:
 *   - hunyuan3d    our own Hunyuan3D 2.1 worker.
 *   - huggingface  the free Spaces lane, whose chain is Hunyuan Spaces.
 */

import { clientCountry } from './client-geo.js';

export const TENCENT_LANES = Object.freeze(['hunyuan3d', 'huggingface']);

// ISO 3166-1 alpha-2. EU member states, the UK and South Korea.
export const RESTRICTED_COUNTRIES = Object.freeze([
	'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
	'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
	'GB', 'KR',
]);

const RESTRICTED = new Set(RESTRICTED_COUNTRIES);

/** True when the country is in a restricted territory or could not be resolved. */
export function isRestrictedTerritory(country) {
	if (typeof country !== 'string' || !/^[A-Za-z]{2}$/.test(country)) return true;
	return RESTRICTED.has(country.toUpperCase());
}

export function isTencentLane(laneId) {
	return TENCENT_LANES.includes(laneId);
}

/** Whether `laneId` may serve a request from `country`. */
export function laneAllowedInTerritory(laneId, country) {
	return !isTencentLane(laneId) || !isRestrictedTerritory(country);
}

/** Drop every lane the territory rule forbids, preserving order. */
export function filterLanesForTerritory(laneIds, country) {
	return laneIds.filter((id) => laneAllowedInTerritory(id, country));
}

/** Country of the requester, resolved from the edge header; null when unknown. */
export function requestTerritory(req) {
	return clientCountry(req);
}

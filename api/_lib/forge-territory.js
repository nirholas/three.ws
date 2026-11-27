/**
 * Forge territory router
 * ----------------------
 * Some model licences exclude whole regions. The Hunyuan3D 2.1 and 2.0
 * community licences (Territory clause) do not grant any rights in the European Union,
 * the United Kingdom or South Korea, for the model or for its output. three.ws
 * serves those regions, so a request that originates there must never be
 * routed to a lane that runs a Tencent model.
 *
 * The country is resolved server side from the headers our own load balancer
 * sets (GEO_TRUSTED_HEADERS), never from a field the caller controls. Cloud
 * Run does not strip a client-sent cf-ipcountry or x-vercel-ip-country, so
 * those two are ignored here even though analytics still reads them. An
 * unknown country fails closed: the request is treated as restricted, because
 * the alternative is shipping a licensed-out model to a region we could not
 * rule out. Setup and verification: docs/ops/gcp-production.md.
 *
 * Lanes that run a Tencent model:
 *   - hunyuan3d    our own Hunyuan3D 2.1 worker.
 *   - huggingface  the free Spaces lane, whose chain is Hunyuan Spaces.
 *   - modly_hunyuan  our own Modly worker running Hunyuan3D 2 Mini Turbo. Its
 *                    sibling lane `modly` runs TripoSG (MIT) on the same
 *                    worker and is served everywhere.
 */

import { clientCountry } from './client-geo.js';

export const TENCENT_LANES = Object.freeze(['hunyuan3d', 'huggingface', 'modly_hunyuan']);

// ISO 3166-1 alpha-2. EU member states, the UK and South Korea.
export const RESTRICTED_COUNTRIES = Object.freeze([
	'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
	'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
	'GB', 'KR',
]);

// Codes that are inside a restricted territory without being one of the listed
// countries: Aland and the EU outermost regions (French overseas departments,
// which are EU soil with their own ISO code), plus the pseudo codes geo
// databases emit for a region (EU, UK), an anonymous proxy (A1), a satellite
// link (A2), the Asia/Pacific block (AP) and "other" (O1). A pseudo code names
// no country we can rule out, so it is restricted like an unknown one.
const RESTRICTED_EXTRA = ['AX', 'GP', 'MQ', 'GF', 'RE', 'YT', 'MF', 'EU', 'UK', 'A1', 'A2', 'AP', 'O1'];

const RESTRICTED = new Set([...RESTRICTED_COUNTRIES, ...RESTRICTED_EXTRA]);

/** True when the country is in a restricted territory or could not be resolved. */
export function isRestrictedTerritory(country) {
	if (typeof country !== 'string' || !/^[A-Za-z0-9]{2}$/.test(country)) return true;
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

/** The headers our own load balancer sets. Nothing else may decide the gate. */
export const GEO_TRUSTED_HEADERS = Object.freeze(['x-client-geo-location', 'x-client-region']);

/** Country of the requester, resolved from the load balancer header; null when unknown. */
export function requestTerritory(req) {
	return clientCountry(req, GEO_TRUSTED_HEADERS);
}

/**
 * The reason a refused Tencent lane gives the caller. With no resolved country
 * it does not name a region: the caller may be somewhere the licence allows and
 * the missing piece is our location signal, so the message says that instead.
 */
export function regionRestrictedMessage(country) {
	return country
		? 'This engine is not available in your region because its model licence excludes it. Use the default engine, which is available everywhere.'
		: 'This engine is off because we could not confirm your location, and its model licence excludes some regions. Use the default engine, which is available everywhere.';
}

/**
 * What this requester may not use, for GET /api/forge?territory. The answer is
 * per visitor, so it must never share the catalog's edge cache. The country
 * itself is not echoed back, only whether one resolved.
 */
export function territoryReport(req) {
	const country = requestTerritory(req);
	return {
		country_resolved: country != null,
		restricted_backends: TENCENT_LANES.filter((id) => !laneAllowedInTerritory(id, country)),
	};
}

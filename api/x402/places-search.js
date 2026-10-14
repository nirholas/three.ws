// GET /api/x402/places-search?lat=42.3519&lon=-71.0552&radius=500&category=cafe
//
// Places Search: $0.002 USDC per call (free daily per-IP quota runs first).
// Live OpenStreetMap Overpass POI search. No API key.

import { cors, method, error, json, wrap } from '../_lib/http.js';
import { clientIp, limits } from '../_lib/rate-limit.js';
import { paidEndpoint } from '../_lib/x402-paid-endpoint.js';
import { buildBazaarSchema } from '../_lib/x402-spec.js';
import { installAccessControl } from '../_lib/x402/access-control.js';
import { withService } from '../_lib/x402/bazaar-helpers.js';
import { priceFor } from '../_lib/x402-prices.js';
import { searchPlaces } from '../_lib/x402-services/places.js';
import listing from '../_lib/service-catalog/services/places-search.js';

const ROUTE = '/api/x402/places-search';
const DESCRIPTION = listing.description;

export const INPUT_SCHEMA = { $schema: 'https://json-schema.org/draft/2020-12/schema', ...listing.inputSchema };
export const OUTPUT_SCHEMA = {
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	type: 'object',
	required: ['source', 'count', 'places'],
	properties: {
		source: { type: 'string' },
		count: { type: 'integer' },
		places: { type: 'array' },
		tier: { type: 'string', enum: ['free', 'paid'] },
		free_remaining_today: { type: 'integer' },
	},
};

export const BAZAAR = {
	description: DESCRIPTION,
	useCases: ['local discovery', 'mapping agents', 'delivery and logistics'],
	input: { type: 'query', example: listing.input, schema: INPUT_SCHEMA },
	output: { type: 'json', example: listing.outputExample },
	schema: buildBazaarSchema({ method: 'GET', queryParamsSchema: INPUT_SCHEMA, outputSchema: OUTPUT_SCHEMA }),
};

function parseParams(req) {
	const params = new URL(req.url, 'http://x').searchParams;
	const lat = Number(params.get('lat'));
	const lon = Number(params.get('lon'));
	const radiusRaw = Number(params.get('radius') || '500');
	const limitRaw = Number(params.get('limit') || '20');
	const category = params.get('category') || null;
	return {
		lat,
		lon,
		radius: Math.round(Number.isFinite(radiusRaw) ? radiusRaw : 500),
		limit: Math.round(Number.isFinite(limitRaw) ? limitRaw : 20),
		category,
	};
}

function validate({ lat, lon, radius, limit, category }) {
	if (!Number.isFinite(lat) || lat < -90 || lat > 90) return { code: 'invalid_lat', message: "query param 'lat' must be a number between -90 and 90" };
	if (!Number.isFinite(lon) || lon < -180 || lon > 180) return { code: 'invalid_lon', message: "query param 'lon' must be a number between -180 and 180" };
	if (!Number.isFinite(radius) || radius <= 0 || radius > 5000) return { code: 'invalid_radius', message: "query param 'radius' must be a number of metres between 1 and 5000" };
	if (!Number.isFinite(limit) || limit < 1 || limit > 50) return { code: 'invalid_limit', message: "query param 'limit' must be an integer between 1 and 50" };
	if (category !== null && !/^[a-z0-9_]{1,40}$/.test(category)) return { code: 'invalid_category', message: "query param 'category' must be an OSM tag value such as cafe, restaurant, pharmacy, bar, museum" };
	return null;
}

let _paid = null;
function paidHandler() {
	if (_paid) return _paid;
	_paid = paidEndpoint({
		route: ROUTE,
		method: 'GET',
		priceAtomics: priceFor('places-search', '2000'), // $0.002 USDC
		networks: ['solana', 'base'],
		description: DESCRIPTION,
		bazaar: BAZAAR,
		service: withService({ serviceName: listing.serviceName, tags: listing.tags }),
		accessControl: installAccessControl({ requiredScope: 'x402:bypass' }),
		async handler({ req }) {
			const params = parseParams(req);
			const invalid = validate(params);
			if (invalid) {
				const err = new Error(invalid.message);
				err.status = 400;
				err.code = invalid.code;
				throw err;
			}
			const data = await searchPlaces(params.lat, params.lon, params.radius, params.category, params.limit);
			return { ...data, tier: 'paid' };
		},
	});
	return _paid;
}

export default wrap(async function handler(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	const paymentPresent = Boolean(req.headers['x-payment'] || req.headers['payment-signature']);
	if (paymentPresent) return paidHandler()(req, res);

	const rl = await limits.placesFreeIp(clientIp(req));
	if (!rl.success) return paidHandler()(req, res);

	const params = parseParams(req);
	const invalid = validate(params);
	if (invalid) return error(res, 400, invalid.code, invalid.message);

	try {
		const data = await searchPlaces(params.lat, params.lon, params.radius, params.category, params.limit);
		return json(res, 200, { ...data, tier: 'free', free_remaining_today: Math.max(0, rl.remaining) }, { 'cache-control': 'no-store' });
	} catch (e) {
		return error(res, e.status || 502, e.code || 'provider_error', e.message);
	}
});

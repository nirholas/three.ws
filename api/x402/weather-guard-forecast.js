// GET /api/x402/weather-guard-forecast?lat=..&lon=..
//
// Weather Guard: Forecast: $0.001 USDC per call (free daily per-IP quota
// runs first). Live 24h hourly forecast from Open-Meteo, failing over to the
// US National Weather Service when Open-Meteo is unreachable, with active
// NWS severe-weather alerts layered in for US coordinates. No API key
// anywhere in the chain; no fixture mode.

import { cors, method, error, json, wrap } from '../_lib/http.js';
import { clientIp, limits } from '../_lib/rate-limit.js';
import { paidEndpoint } from '../_lib/x402-paid-endpoint.js';
import { buildBazaarSchema } from '../_lib/x402-spec.js';
import { installAccessControl } from '../_lib/x402/access-control.js';
import { withService } from '../_lib/x402/bazaar-helpers.js';
import { priceFor } from '../_lib/x402-prices.js';
import { forecast } from '../_lib/x402-services/weather-guard.js';
import listing from '../_lib/service-catalog/services/weather-guard-forecast.js';

const ROUTE = '/api/x402/weather-guard-forecast';
const DESCRIPTION = listing.description;

export const INPUT_SCHEMA = { $schema: 'https://json-schema.org/draft/2020-12/schema', ...listing.inputSchema };
export const OUTPUT_SCHEMA = {
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	type: 'object',
	required: ['source', 'lat', 'lon', 'current', 'hourly', 'alerts'],
	properties: {
		source: { type: 'string', enum: ['open-meteo', 'nws'] },
		lat: { type: 'number' },
		lon: { type: 'number' },
		failedOver: { type: 'boolean' },
		current: { type: ['object', 'null'] },
		hourly: { type: 'array' },
		alerts: { type: 'array' },
		tier: { type: 'string', enum: ['free', 'paid'] },
		free_remaining_today: { type: 'integer' },
	},
};

export const BAZAAR = {
	description: DESCRIPTION,
	useCases: ['go/no-go planning', 'agronomy', 'logistics routing', 'outdoor events'],
	input: { type: 'query', example: listing.input, schema: INPUT_SCHEMA },
	output: { type: 'json', example: listing.outputExample },
	schema: buildBazaarSchema({ method: 'GET', queryParamsSchema: INPUT_SCHEMA, outputSchema: OUTPUT_SCHEMA }),
};

function parseCoords(params) {
	const lat = params.get('lat');
	const lon = params.get('lon');
	if (lat == null || lon == null || lat === '' || lon === '') {
		throw Object.assign(new Error('lat and lon query params are required'), { status: 400, code: 'bad_request' });
	}
	return { lat, lon };
}

let _paid = null;
function paidHandler() {
	if (_paid) return _paid;
	_paid = paidEndpoint({
		route: ROUTE,
		method: 'GET',
		priceAtomics: priceFor('weather-guard-forecast', '1000'), // $0.001 USDC
		networks: ['solana', 'base'],
		description: DESCRIPTION,
		bazaar: BAZAAR,
		service: withService({ serviceName: listing.serviceName, tags: listing.tags }),
		accessControl: installAccessControl({ requiredScope: 'x402:bypass' }),
		async handler({ req }) {
			const params = new URL(req.url, 'http://x').searchParams;
			const { lat, lon } = parseCoords(params);
			const data = await forecast(lat, lon);
			return { ...data, tier: 'paid' };
		},
	});
	return _paid;
}

export default wrap(async function handler(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	const params = new URL(req.url, 'http://x').searchParams;
	let coords;
	try {
		coords = parseCoords(params);
	} catch (e) {
		return error(res, e.status || 400, e.code || 'bad_request', e.message);
	}

	const paymentPresent = Boolean(req.headers['x-payment'] || req.headers['payment-signature']);
	if (paymentPresent) return paidHandler()(req, res);

	const rl = await limits.weatherGuardFreeIp(clientIp(req));
	if (!rl.success) return paidHandler()(req, res);

	try {
		const data = await forecast(coords.lat, coords.lon);
		return json(
			res,
			200,
			{ ...data, tier: 'free', free_remaining_today: Math.max(0, rl.remaining) },
			{ 'cache-control': 'no-store' },
		);
	} catch (e) {
		return error(res, e.status || 502, e.code || 'provider_error', e.message);
	}
});

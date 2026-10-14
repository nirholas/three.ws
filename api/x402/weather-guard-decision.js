// GET /api/x402/weather-guard-decision?lat=..&lon=..&activity=running
//
// Weather Guard: Activity Decision: $0.002 USDC per call, always paid (the
// free quota lives on weather-guard-forecast). Turns the live forecast into
// a go/caution/no-go verdict for a named outdoor activity.

import { paidEndpoint } from '../_lib/x402-paid-endpoint.js';
import { buildBazaarSchema } from '../_lib/x402-spec.js';
import { installAccessControl } from '../_lib/x402/access-control.js';
import { withService } from '../_lib/x402/bazaar-helpers.js';
import { priceFor } from '../_lib/x402-prices.js';
import { decision, WEATHER_GUARD_ACTIVITIES } from '../_lib/x402-services/weather-guard.js';
import listing from '../_lib/service-catalog/services/weather-guard-decision.js';

const ROUTE = '/api/x402/weather-guard-decision';
const DESCRIPTION = listing.description;

export const INPUT_SCHEMA = { $schema: 'https://json-schema.org/draft/2020-12/schema', ...listing.inputSchema };
export const OUTPUT_SCHEMA = {
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	type: 'object',
	required: ['activity', 'verdict', 'reasons', 'source', 'window', 'alerts'],
	properties: {
		activity: { type: 'string' },
		verdict: { type: 'string', enum: ['go', 'caution', 'no-go'] },
		reasons: { type: 'array', items: { type: 'string' } },
		source: { type: 'string', enum: ['open-meteo', 'nws'] },
		failedOver: { type: 'boolean' },
		window: { type: 'array' },
		alerts: { type: 'array' },
	},
};

export const BAZAAR = {
	description: DESCRIPTION,
	useCases: ['go/no-go planning', 'drone operations', 'event logistics'],
	input: { type: 'query', example: listing.input, schema: INPUT_SCHEMA },
	output: { type: 'json', example: listing.outputExample },
	schema: buildBazaarSchema({ method: 'GET', queryParamsSchema: INPUT_SCHEMA, outputSchema: OUTPUT_SCHEMA }),
};

export default paidEndpoint({
	route: ROUTE,
	method: 'GET',
	priceAtomics: priceFor('weather-guard-decision', '2000'), // $0.002 USDC
	networks: ['solana', 'base'],
	description: DESCRIPTION,
	bazaar: BAZAAR,
	service: withService({ serviceName: listing.serviceName, tags: listing.tags }),
	accessControl: installAccessControl({ requiredScope: 'x402:bypass' }),
	async handler({ req }) {
		const params = new URL(req.url, 'http://x').searchParams;
		const lat = params.get('lat');
		const lon = params.get('lon');
		const activity = (params.get('activity') || '').trim();
		if (lat == null || lon == null || lat === '' || lon === '') {
			throw Object.assign(new Error('lat and lon query params are required'), { status: 400, code: 'bad_request' });
		}
		if (!WEATHER_GUARD_ACTIVITIES.includes(activity)) {
			throw Object.assign(
				new Error(`activity must be one of: ${WEATHER_GUARD_ACTIVITIES.join(', ')}`),
				{ status: 422, code: 'invalid_activity' },
			);
		}
		return decision(lat, lon, activity);
	},
});

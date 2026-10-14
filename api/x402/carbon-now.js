// GET /api/x402/carbon-now?postcode=SW1A
//
// Grid Carbon: Now: $0.001 USDC per call (free daily per-IP quota runs
// first). Live UK grid carbon intensity + generation mix from the National
// Grid ESO Carbon Intensity API. No API key, no fixture mode.

import { cors, method, error, json, wrap } from '../_lib/http.js';
import { clientIp, limits } from '../_lib/rate-limit.js';
import { paidEndpoint } from '../_lib/x402-paid-endpoint.js';
import { buildBazaarSchema } from '../_lib/x402-spec.js';
import { installAccessControl } from '../_lib/x402/access-control.js';
import { withService } from '../_lib/x402/bazaar-helpers.js';
import { priceFor } from '../_lib/x402-prices.js';
import { now as carbonNow } from '../_lib/x402-services/carbon.js';
import listing from '../_lib/service-catalog/services/carbon-now.js';

const ROUTE = '/api/x402/carbon-now';
const DESCRIPTION = listing.description;

export const INPUT_SCHEMA = { $schema: 'https://json-schema.org/draft/2020-12/schema', ...listing.inputSchema };
export const OUTPUT_SCHEMA = {
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	type: 'object',
	required: ['scope', 'intensity'],
	properties: {
		scope: { type: 'string', enum: ['national', 'regional'] },
		postcode: { type: 'string' },
		region: { type: 'string' },
		from: { type: 'string' },
		to: { type: 'string' },
		intensity: { type: 'object' },
		generationmix: { type: 'array' },
		tier: { type: 'string', enum: ['free', 'paid'] },
		free_remaining_today: { type: 'integer' },
	},
};

export const BAZAAR = {
	description: DESCRIPTION,
	useCases: ['load scheduling', 'carbon reporting', 'grid-aware automation'],
	input: { type: 'query', example: listing.input, schema: INPUT_SCHEMA },
	output: { type: 'json', example: listing.outputExample },
	schema: buildBazaarSchema({ method: 'GET', queryParamsSchema: INPUT_SCHEMA, outputSchema: OUTPUT_SCHEMA }),
};

function readPostcode(params) {
	const raw = params.get('postcode');
	return raw && raw.trim() ? raw.trim() : undefined;
}

let _paid = null;
function paidHandler() {
	if (_paid) return _paid;
	_paid = paidEndpoint({
		route: ROUTE,
		method: 'GET',
		priceAtomics: priceFor('carbon-now', '1000'), // $0.001 USDC
		networks: ['solana', 'base'],
		description: DESCRIPTION,
		bazaar: BAZAAR,
		service: withService({ serviceName: listing.serviceName, tags: listing.tags }),
		accessControl: installAccessControl({ requiredScope: 'x402:bypass' }),
		async handler({ req }) {
			const params = new URL(req.url, 'http://x').searchParams;
			const data = await carbonNow(readPostcode(params));
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

	const rl = await limits.carbonFreeIp(clientIp(req));
	if (!rl.success) return paidHandler()(req, res);

	try {
		const params = new URL(req.url, 'http://x').searchParams;
		const data = await carbonNow(readPostcode(params));
		return json(res, 200, { ...data, tier: 'free', free_remaining_today: Math.max(0, rl.remaining) }, { 'cache-control': 'no-store' });
	} catch (e) {
		return error(res, e.status || 502, e.code || 'provider_error', e.message);
	}
});

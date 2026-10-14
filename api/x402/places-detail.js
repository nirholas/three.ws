// GET /api/x402/places-detail?id=node-1072800838
//
// Place Detail: $0.002 USDC per call, always paid (the free quota lives on
// places-search). Live OpenStreetMap record, no Yelp fixture enrichment.

import { paidEndpoint } from '../_lib/x402-paid-endpoint.js';
import { buildBazaarSchema } from '../_lib/x402-spec.js';
import { installAccessControl } from '../_lib/x402/access-control.js';
import { withService } from '../_lib/x402/bazaar-helpers.js';
import { priceFor } from '../_lib/x402-prices.js';
import { parsePoiId, placeDetail } from '../_lib/x402-services/places.js';
import listing from '../_lib/service-catalog/services/places-detail.js';

const ROUTE = '/api/x402/places-detail';
const DESCRIPTION = listing.description;

export const INPUT_SCHEMA = { $schema: 'https://json-schema.org/draft/2020-12/schema', ...listing.inputSchema };
export const OUTPUT_SCHEMA = {
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	type: 'object',
	required: ['source', 'place'],
	properties: { source: { type: 'string' }, place: { type: 'object' } },
};

export const BAZAAR = {
	description: DESCRIPTION,
	useCases: ['local discovery', 'mapping agents', 'delivery and logistics'],
	input: { type: 'query', example: listing.input, schema: INPUT_SCHEMA },
	output: { type: 'json', example: listing.outputExample },
	schema: buildBazaarSchema({ method: 'GET', queryParamsSchema: INPUT_SCHEMA, outputSchema: OUTPUT_SCHEMA }),
};

export default paidEndpoint({
	route: ROUTE,
	method: 'GET',
	priceAtomics: priceFor('places-detail', '2000'), // $0.002 USDC
	networks: ['solana', 'base'],
	description: DESCRIPTION,
	bazaar: BAZAAR,
	service: withService({ serviceName: listing.serviceName, tags: listing.tags }),
	accessControl: installAccessControl({ requiredScope: 'x402:bypass' }),
	async handler({ req }) {
		const params = new URL(req.url, 'http://x').searchParams;
		const id = String(params.get('id') || '').trim();
		const parsed = id ? parsePoiId(id) : null;
		if (!parsed) {
			const err = new Error("query param 'id' must look like 'node-123', 'way-123', or 'relation-123' (as returned by Places Search)");
			err.status = 400;
			err.code = 'invalid_id';
			throw err;
		}
		const detail = await placeDetail(parsed.osmType, parsed.osmId);
		if (!detail) {
			const err = new Error(`no OpenStreetMap ${parsed.osmType} with id ${parsed.osmId}`);
			err.status = 404;
			err.code = 'not_found';
			throw err;
		}
		return detail;
	},
});

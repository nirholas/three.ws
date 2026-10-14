// GET /api/x402/carbon-best-window?hours=4&postcode=SW1A
//
// Grid Carbon: Best Window: $0.002 USDC per call, always paid (the free
// quota lives on carbon-now). Scans the live 48h National Grid ESO forecast
// for the lowest-carbon window.

import { paidEndpoint } from '../_lib/x402-paid-endpoint.js';
import { buildBazaarSchema } from '../_lib/x402-spec.js';
import { installAccessControl } from '../_lib/x402/access-control.js';
import { withService } from '../_lib/x402/bazaar-helpers.js';
import { priceFor } from '../_lib/x402-prices.js';
import { bestWindow } from '../_lib/x402-services/carbon.js';
import listing from '../_lib/service-catalog/services/carbon-best-window.js';

const ROUTE = '/api/x402/carbon-best-window';
const DESCRIPTION = listing.description;

export const INPUT_SCHEMA = { $schema: 'https://json-schema.org/draft/2020-12/schema', ...listing.inputSchema };
export const OUTPUT_SCHEMA = {
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	type: 'object',
	required: ['scope', 'best', 'worst', 'runnersUp', 'recommendation'],
	properties: {
		scope: { type: 'string', enum: ['national', 'regional'] },
		postcode: { type: 'string' },
		hoursRequested: { type: 'number' },
		best: { type: 'object' },
		worst: { type: 'object' },
		runnersUp: { type: 'array' },
		recommendation: { type: 'string' },
	},
};

export const BAZAAR = {
	description: DESCRIPTION,
	useCases: ['load scheduling', 'ev charging', 'battery dispatch'],
	input: { type: 'query', example: listing.input, schema: INPUT_SCHEMA },
	output: { type: 'json', example: listing.outputExample },
	schema: buildBazaarSchema({ method: 'GET', queryParamsSchema: INPUT_SCHEMA, outputSchema: OUTPUT_SCHEMA }),
};

export default paidEndpoint({
	route: ROUTE,
	method: 'GET',
	priceAtomics: priceFor('carbon-best-window', '2000'), // $0.002 USDC
	networks: ['solana', 'base'],
	description: DESCRIPTION,
	bazaar: BAZAAR,
	service: withService({ serviceName: listing.serviceName, tags: listing.tags }),
	accessControl: installAccessControl({ requiredScope: 'x402:bypass' }),
	async handler({ req }) {
		const params = new URL(req.url, 'http://x').searchParams;
		const hoursRaw = Number(params.get('hours') || '4');
		const hours = Math.min(12, Math.max(1, Number.isFinite(hoursRaw) ? hoursRaw : 4));
		const postcode = params.get('postcode');
		return bestWindow({ hours, postcode: postcode && postcode.trim() ? postcode.trim() : undefined });
	},
});

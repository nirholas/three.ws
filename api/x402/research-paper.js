// GET /api/x402/research-paper?id=10.48550/arXiv.1706.03762
//
// Paper Detail & Citation Graph: $0.003 USDC per call, always paid (the
// free quota lives on research-search). Semantic Scholar primary, Crossref
// fallback for DOIs.

import { paidEndpoint } from '../_lib/x402-paid-endpoint.js';
import { buildBazaarSchema } from '../_lib/x402-spec.js';
import { installAccessControl } from '../_lib/x402/access-control.js';
import { withService } from '../_lib/x402/bazaar-helpers.js';
import { priceFor } from '../_lib/x402-prices.js';
import { paperDetail } from '../_lib/x402-services/research.js';
import listing from '../_lib/service-catalog/services/research-paper.js';

const ROUTE = '/api/x402/research-paper';
const DESCRIPTION = listing.description;

export const INPUT_SCHEMA = { $schema: 'https://json-schema.org/draft/2020-12/schema', ...listing.inputSchema };
export const OUTPUT_SCHEMA = { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', required: ['id'], properties: { id: { type: 'string' } } };

export const BAZAAR = {
	description: DESCRIPTION,
	useCases: ['literature review', 'citation graph traversal', 'research agents'],
	input: { type: 'query', example: listing.input, schema: INPUT_SCHEMA },
	output: { type: 'json', example: listing.outputExample },
	schema: buildBazaarSchema({ method: 'GET', queryParamsSchema: INPUT_SCHEMA, outputSchema: OUTPUT_SCHEMA }),
};

export default paidEndpoint({
	route: ROUTE,
	method: 'GET',
	priceAtomics: priceFor('research-paper', '3000'), // $0.003 USDC
	networks: ['solana', 'base'],
	description: DESCRIPTION,
	bazaar: BAZAAR,
	service: withService({ serviceName: listing.serviceName, tags: listing.tags }),
	accessControl: installAccessControl({ requiredScope: 'x402:bypass' }),
	async handler({ req }) {
		const params = new URL(req.url, 'http://x').searchParams;
		const id = String(params.get('id') || '').trim();
		if (!id) {
			const err = new Error('query param "id" is required');
			err.status = 400;
			err.code = 'missing_id';
			throw err;
		}
		return paperDetail(id);
	},
});

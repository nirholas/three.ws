// GET /api/x402/news-wire-pulse?q=earthquake+relief&cursor=20261014000000
//
// Global News Wire Pulse: $0.002 USDC per call, always paid (the free
// quota lives on news-wire-query). Delta poll since a cursor, via GDELT.

import { paidEndpoint } from '../_lib/x402-paid-endpoint.js';
import { buildBazaarSchema } from '../_lib/x402-spec.js';
import { installAccessControl } from '../_lib/x402/access-control.js';
import { withService } from '../_lib/x402/bazaar-helpers.js';
import { priceFor } from '../_lib/x402-prices.js';
import { pulse } from '../_lib/x402-services/news-wire.js';
import listing from '../_lib/service-catalog/services/news-wire-pulse.js';

const ROUTE = '/api/x402/news-wire-pulse';
const DESCRIPTION = listing.description;

export const INPUT_SCHEMA = { $schema: 'https://json-schema.org/draft/2020-12/schema', ...listing.inputSchema };
export const OUTPUT_SCHEMA = {
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	type: 'object',
	required: ['query', 'cursor', 'nextCursor', 'articles'],
	properties: {
		query: { type: 'string' },
		cursor: { type: 'string' },
		nextCursor: { type: 'string' },
		newArticleCount: { type: 'integer' },
		truncated: { type: 'boolean' },
		articles: { type: 'array' },
	},
};

export const BAZAAR = {
	description: DESCRIPTION,
	useCases: ['media monitoring', 'live news feeds', 'polling agents'],
	input: { type: 'query', example: listing.input, schema: INPUT_SCHEMA },
	output: { type: 'json', example: listing.outputExample },
	schema: buildBazaarSchema({ method: 'GET', queryParamsSchema: INPUT_SCHEMA, outputSchema: OUTPUT_SCHEMA }),
};

export default paidEndpoint({
	route: ROUTE,
	method: 'GET',
	priceAtomics: priceFor('news-wire-pulse', '2000'), // $0.002 USDC
	networks: ['solana', 'base'],
	description: DESCRIPTION,
	bazaar: BAZAAR,
	service: withService({ serviceName: listing.serviceName, tags: listing.tags }),
	accessControl: installAccessControl({ requiredScope: 'x402:bypass' }),
	async handler({ req }) {
		const params = new URL(req.url, 'http://x').searchParams;
		const q = String(params.get('q') || '').trim();
		const cursor = String(params.get('cursor') || '').trim();
		const maxRecordsRaw = Number(params.get('maxRecords') || '50');
		const maxRecords = Number.isFinite(maxRecordsRaw) ? maxRecordsRaw : 50;
		if (!q) {
			const err = new Error('query param "q" is required');
			err.status = 400;
			err.code = 'missing_query';
			throw err;
		}
		if (!cursor) {
			const err = new Error('query param "cursor" is required');
			err.status = 400;
			err.code = 'missing_cursor';
			throw err;
		}
		return pulse(q, cursor, maxRecords);
	},
});

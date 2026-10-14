// POST /api/x402/domains-bulk  body: {"domains":["example.com", ...]}
//
// Domain Check Bulk: $0.002 per domain, $0.005 USDC minimum per call, always
// paid (the free quota lives on domains-check). Checks up to 50 domains in
// one RDAP sweep with bounded concurrency.

import { readBody } from '../_lib/http.js';
import { paidEndpoint } from '../_lib/x402-paid-endpoint.js';
import { buildBazaarSchema } from '../_lib/x402-spec.js';
import { installAccessControl } from '../_lib/x402/access-control.js';
import { withService } from '../_lib/x402/bazaar-helpers.js';
import { priceFor } from '../_lib/x402-prices.js';
import { checkBulk } from '../_lib/x402-services/domains.js';
import listing from '../_lib/service-catalog/services/domains-bulk.js';

const ROUTE = '/api/x402/domains-bulk';
const DESCRIPTION = listing.description;

export const INPUT_SCHEMA = { $schema: 'https://json-schema.org/draft/2020-12/schema', ...listing.inputSchema };
export const OUTPUT_SCHEMA = {
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	type: 'object',
	required: ['count', 'registered', 'available', 'unknown', 'results'],
	properties: {
		count: { type: 'integer' },
		registered: { type: 'integer' },
		available: { type: 'integer' },
		unknown: { type: 'integer' },
		results: { type: 'array' },
	},
};

export const BAZAAR = {
	description: DESCRIPTION,
	useCases: ['domain portfolio audit', 'brand protection', 'bulk availability scan'],
	input: { type: 'body', example: listing.input, schema: INPUT_SCHEMA },
	output: { type: 'json', example: listing.outputExample },
	schema: buildBazaarSchema({ method: 'POST', bodySchema: INPUT_SCHEMA, outputSchema: OUTPUT_SCHEMA }),
};

async function readJsonBody(req) {
	const chunk = await readBody(req, 500_000);
	return JSON.parse((chunk ? chunk.toString('utf8') : '') || '{}');
}

export default paidEndpoint({
	route: ROUTE,
	method: 'POST',
	priceAtomics: priceFor('domains-bulk', '5000'), // $0.005 USDC
	networks: ['solana', 'base'],
	description: DESCRIPTION,
	bazaar: BAZAAR,
	service: withService({ serviceName: listing.serviceName, tags: listing.tags }),
	accessControl: installAccessControl({ requiredScope: 'x402:bypass' }),
	async handler({ req }) {
		let body;
		try {
			body = await readJsonBody(req);
		} catch {
			const err = new Error('request body must be valid JSON');
			err.status = 400;
			err.code = 'invalid_json';
			throw err;
		}
		const domains = body?.domains;
		if (!Array.isArray(domains) || domains.length === 0) {
			const err = new Error('body must be {"domains": ["example.com", ...]} with 1-50 entries');
			err.status = 400;
			err.code = 'invalid_domains';
			throw err;
		}
		const results = await checkBulk(domains.map(String));
		return {
			count: results.length,
			registered: results.filter((r) => r.status === 'registered').length,
			available: results.filter((r) => r.status === 'available').length,
			unknown: results.filter((r) => r.status === 'unknown').length,
			results,
		};
	},
});

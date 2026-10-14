// POST /api/x402/research-bibliography  body: {"dois":[...],"format":"both"}
//
// Bibliography Formatter: $0.005 USDC per call, always paid. Formatted
// BibTeX and/or APA 7 entries for up to 25 DOIs, sourced live from Crossref.

import { readBody } from '../_lib/http.js';
import { paidEndpoint } from '../_lib/x402-paid-endpoint.js';
import { buildBazaarSchema } from '../_lib/x402-spec.js';
import { installAccessControl } from '../_lib/x402/access-control.js';
import { withService } from '../_lib/x402/bazaar-helpers.js';
import { priceFor } from '../_lib/x402-prices.js';
import { bibliography } from '../_lib/x402-services/research.js';
import listing from '../_lib/service-catalog/services/research-bibliography.js';

const ROUTE = '/api/x402/research-bibliography';
const DESCRIPTION = listing.description;

export const INPUT_SCHEMA = { $schema: 'https://json-schema.org/draft/2020-12/schema', ...listing.inputSchema };
export const OUTPUT_SCHEMA = {
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	type: 'object',
	required: ['format', 'count', 'entries'],
	properties: { format: { type: 'string' }, count: { type: 'integer' }, entries: { type: 'array' } },
};

export const BAZAAR = {
	description: DESCRIPTION,
	useCases: ['citation formatting', 'literature review', 'paper writing tools'],
	input: { type: 'body', example: listing.input, schema: INPUT_SCHEMA },
	output: { type: 'json', example: listing.outputExample },
	schema: buildBazaarSchema({ method: 'POST', bodySchema: INPUT_SCHEMA, outputSchema: OUTPUT_SCHEMA }),
};

async function readJsonBody(req) {
	const chunk = await readBody(req, 200_000);
	return JSON.parse((chunk ? chunk.toString('utf8') : '') || '{}');
}

export default paidEndpoint({
	route: ROUTE,
	method: 'POST',
	priceAtomics: priceFor('research-bibliography', '5000'), // $0.005 USDC
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
		const dois = body?.dois;
		if (!Array.isArray(dois) || dois.length === 0) {
			const err = new Error('body must be {"dois": [...]} with 1-25 entries');
			err.status = 400;
			err.code = 'invalid_dois';
			throw err;
		}
		const format = ['bibtex', 'apa', 'both'].includes(body?.format) ? body.format : 'both';
		return bibliography(dois, format);
	},
});

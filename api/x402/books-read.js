// GET /api/x402/books-read?gutenbergId=1342
//
// Book Read: $0.01 USDC per call, always paid (the free quota lives on
// books-search). Cleaned, chaptered Project Gutenberg full text.

import { paidEndpoint } from '../_lib/x402-paid-endpoint.js';
import { buildBazaarSchema } from '../_lib/x402-spec.js';
import { installAccessControl } from '../_lib/x402/access-control.js';
import { withService } from '../_lib/x402/bazaar-helpers.js';
import { priceFor } from '../_lib/x402-prices.js';
import { readBook } from '../_lib/x402-services/books.js';
import listing from '../_lib/service-catalog/services/books-read.js';

const ROUTE = '/api/x402/books-read';
const DESCRIPTION = listing.description;

export const INPUT_SCHEMA = { $schema: 'https://json-schema.org/draft/2020-12/schema', ...listing.inputSchema };
export const OUTPUT_SCHEMA = {
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	type: 'object',
	required: ['source', 'gutenbergId', 'title', 'chapters'],
	properties: {
		source: { type: 'string' },
		gutenbergId: { type: 'integer' },
		title: { type: 'string' },
		chapterCount: { type: 'integer' },
		wordCount: { type: 'integer' },
		chapters: { type: 'array' },
	},
};

export const BAZAAR = {
	description: DESCRIPTION,
	useCases: ['reading agents', 'text analysis', 'public-domain archiving'],
	input: { type: 'query', example: listing.input, schema: INPUT_SCHEMA },
	output: { type: 'json', example: listing.outputExample },
	schema: buildBazaarSchema({ method: 'GET', queryParamsSchema: INPUT_SCHEMA, outputSchema: OUTPUT_SCHEMA }),
};

export default paidEndpoint({
	route: ROUTE,
	method: 'GET',
	priceAtomics: priceFor('books-read', '10000'), // $0.01 USDC
	networks: ['solana', 'base'],
	description: DESCRIPTION,
	bazaar: BAZAAR,
	service: withService({ serviceName: listing.serviceName, tags: listing.tags }),
	accessControl: installAccessControl({ requiredScope: 'x402:bypass' }),
	async handler({ req }) {
		const params = new URL(req.url, 'http://x').searchParams;
		const idRaw = Number(params.get('gutenbergId'));
		if (!Number.isFinite(idRaw) || idRaw <= 0) {
			const err = new Error('query param "gutenbergId" must be a positive integer');
			err.status = 400;
			err.code = 'invalid_gutenberg_id';
			throw err;
		}
		const book = await readBook(Math.floor(idRaw));
		if (!book) {
			const err = new Error(`no readable Project Gutenberg text found for id ${idRaw}`);
			err.status = 404;
			err.code = 'not_found';
			throw err;
		}
		return book;
	},
});

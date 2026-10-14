// GET /api/x402/books-search?q=pride+and+prejudice&limit=5
//
// Book Search: $0.001 USDC per call (free daily per-IP quota runs first).
// Live OpenLibrary editions annotated with Gutenberg full-text availability.

import { cors, method, error, json, wrap } from '../_lib/http.js';
import { clientIp, limits } from '../_lib/rate-limit.js';
import { paidEndpoint } from '../_lib/x402-paid-endpoint.js';
import { buildBazaarSchema } from '../_lib/x402-spec.js';
import { installAccessControl } from '../_lib/x402/access-control.js';
import { withService } from '../_lib/x402/bazaar-helpers.js';
import { priceFor } from '../_lib/x402-prices.js';
import { searchBooks } from '../_lib/x402-services/books.js';
import listing from '../_lib/service-catalog/services/books-search.js';

const ROUTE = '/api/x402/books-search';
const DESCRIPTION = listing.description;

export const INPUT_SCHEMA = { $schema: 'https://json-schema.org/draft/2020-12/schema', ...listing.inputSchema };
export const OUTPUT_SCHEMA = {
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	type: 'object',
	required: ['source', 'count', 'editions'],
	properties: {
		source: { type: 'string' },
		totalFound: { type: 'integer' },
		count: { type: 'integer' },
		editions: { type: 'array' },
		tier: { type: 'string', enum: ['free', 'paid'] },
		free_remaining_today: { type: 'integer' },
	},
};

export const BAZAAR = {
	description: DESCRIPTION,
	useCases: ['book discovery', 'reading list building', 'library agents'],
	input: { type: 'query', example: listing.input, schema: INPUT_SCHEMA },
	output: { type: 'json', example: listing.outputExample },
	schema: buildBazaarSchema({ method: 'GET', queryParamsSchema: INPUT_SCHEMA, outputSchema: OUTPUT_SCHEMA }),
};

function parseParams(req) {
	const params = new URL(req.url, 'http://x').searchParams;
	const q = String(params.get('q') || '').trim();
	const author = params.get('author');
	const limitRaw = Number(params.get('limit') || '5');
	const limit = Math.min(25, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 5));
	return { q, author: author && author.trim() ? author.trim() : null, limit };
}

let _paid = null;
function paidHandler() {
	if (_paid) return _paid;
	_paid = paidEndpoint({
		route: ROUTE,
		method: 'GET',
		priceAtomics: priceFor('books-search', '1000'), // $0.001 USDC
		networks: ['solana', 'base'],
		description: DESCRIPTION,
		bazaar: BAZAAR,
		service: withService({ serviceName: listing.serviceName, tags: listing.tags }),
		accessControl: installAccessControl({ requiredScope: 'x402:bypass' }),
		async handler({ req }) {
			const { q, author, limit } = parseParams(req);
			if (!q) {
				const err = new Error('query param "q" is required');
				err.status = 400;
				err.code = 'missing_query';
				throw err;
			}
			const data = await searchBooks(q, author, limit);
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

	const rl = await limits.booksFreeIp(clientIp(req));
	if (!rl.success) return paidHandler()(req, res);

	const { q, author, limit } = parseParams(req);
	if (!q) return error(res, 400, 'missing_query', 'query param "q" is required');

	try {
		const data = await searchBooks(q, author, limit);
		return json(res, 200, { ...data, tier: 'free', free_remaining_today: Math.max(0, rl.remaining) }, { 'cache-control': 'no-store' });
	} catch (e) {
		return error(res, e.status || 502, e.code || 'provider_error', e.message);
	}
});

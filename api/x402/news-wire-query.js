// GET /api/x402/news-wire-query?q=earthquake+relief&timespan=3d
//
// Global News Wire Search: $0.003 USDC per call (free daily per-IP quota
// runs first). Live worldwide news search via the GDELT Project. No API
// key. Route name uses "news-wire-*" to avoid colliding with the
// unrelated pre-existing "news-pulse" ticker-sentiment service.

import { cors, method, error, json, wrap } from '../_lib/http.js';
import { clientIp, limits } from '../_lib/rate-limit.js';
import { paidEndpoint } from '../_lib/x402-paid-endpoint.js';
import { buildBazaarSchema } from '../_lib/x402-spec.js';
import { installAccessControl } from '../_lib/x402/access-control.js';
import { withService } from '../_lib/x402/bazaar-helpers.js';
import { priceFor } from '../_lib/x402-prices.js';
import { query } from '../_lib/x402-services/news-wire.js';
import listing from '../_lib/service-catalog/services/news-wire-query.js';

const ROUTE = '/api/x402/news-wire-query';
const DESCRIPTION = listing.description;

export const INPUT_SCHEMA = { $schema: 'https://json-schema.org/draft/2020-12/schema', ...listing.inputSchema };
export const OUTPUT_SCHEMA = {
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	type: 'object',
	required: ['query', 'count', 'articles'],
	properties: {
		query: { type: 'string' },
		effectiveQuery: { type: 'string' },
		timespan: { type: 'string' },
		count: { type: 'integer' },
		articles: { type: 'array' },
		volumeTimeline: { type: ['array', 'null'] },
		timelineStatus: { type: 'string' },
		tier: { type: 'string', enum: ['free', 'paid'] },
		free_remaining_today: { type: 'integer' },
	},
};

export const BAZAAR = {
	description: DESCRIPTION,
	useCases: ['media monitoring', 'narrative tracking', 'research agents'],
	input: { type: 'query', example: listing.input, schema: INPUT_SCHEMA },
	output: { type: 'json', example: listing.outputExample },
	schema: buildBazaarSchema({ method: 'GET', queryParamsSchema: INPUT_SCHEMA, outputSchema: OUTPUT_SCHEMA }),
};

function parseParams(req) {
	const params = new URL(req.url, 'http://x').searchParams;
	const q = String(params.get('q') || '').trim();
	const timespan = params.get('timespan') || '3d';
	const maxRecordsRaw = Number(params.get('maxRecords') || '25');
	const maxRecords = Number.isFinite(maxRecordsRaw) ? maxRecordsRaw : 25;
	const sourceLang = params.get('sourceLang') || null;
	const sourceCountry = params.get('sourceCountry') || null;
	const includeTimeline = params.get('includeTimeline') !== 'false';
	return { q, timespan, maxRecords, sourceLang, sourceCountry, includeTimeline };
}

let _paid = null;
function paidHandler() {
	if (_paid) return _paid;
	_paid = paidEndpoint({
		route: ROUTE,
		method: 'GET',
		priceAtomics: priceFor('news-wire-query', '3000'), // $0.003 USDC
		networks: ['solana', 'base'],
		description: DESCRIPTION,
		bazaar: BAZAAR,
		service: withService({ serviceName: listing.serviceName, tags: listing.tags }),
		accessControl: installAccessControl({ requiredScope: 'x402:bypass' }),
		async handler({ req }) {
			const { q, ...opts } = parseParams(req);
			if (!q) {
				const err = new Error('query param "q" is required');
				err.status = 400;
				err.code = 'missing_query';
				throw err;
			}
			const data = await query(q, opts);
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

	const rl = await limits.newsWireFreeIp(clientIp(req));
	if (!rl.success) return paidHandler()(req, res);

	const { q, ...opts } = parseParams(req);
	if (!q) return error(res, 400, 'missing_query', 'query param "q" is required');

	try {
		const data = await query(q, opts);
		return json(res, 200, { ...data, tier: 'free', free_remaining_today: Math.max(0, rl.remaining) }, { 'cache-control': 'no-store' });
	} catch (e) {
		return error(res, e.status || 502, e.code || 'provider_error', e.message);
	}
});

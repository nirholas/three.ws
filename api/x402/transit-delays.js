// GET /api/x402/transit-delays?stop=South+Station&limit=20
//
// Transit Delay Snapshot: $0.001 USDC per call, always paid (the free
// quota lives on transit-plan). Live MBTA GTFS-Realtime vs schedule.

import { paidEndpoint } from '../_lib/x402-paid-endpoint.js';
import { buildBazaarSchema } from '../_lib/x402-spec.js';
import { installAccessControl } from '../_lib/x402/access-control.js';
import { withService } from '../_lib/x402/bazaar-helpers.js';
import { priceFor } from '../_lib/x402-prices.js';
import { resolvePlace, delaySnapshot, BadRequestError, NotFoundError, UpstreamError } from '../_lib/x402-services/transit.js';
import listing from '../_lib/service-catalog/services/transit-delays.js';

const ROUTE = '/api/x402/transit-delays';
const DESCRIPTION = listing.description;

export const INPUT_SCHEMA = { $schema: 'https://json-schema.org/draft/2020-12/schema', ...listing.inputSchema };
export const OUTPUT_SCHEMA = {
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	type: 'object',
	required: ['source', 'summary', 'arrivals'],
	properties: {
		source: { type: 'string' },
		agency: { type: 'string' },
		summary: { type: 'object' },
		arrivals: { type: 'array' },
	},
};

export const BAZAAR = {
	description: DESCRIPTION,
	useCases: ['service monitoring', 'commute automation', 'mobility agents'],
	input: { type: 'query', example: listing.input, schema: INPUT_SCHEMA },
	output: { type: 'json', example: listing.outputExample },
	schema: buildBazaarSchema({ method: 'GET', queryParamsSchema: INPUT_SCHEMA, outputSchema: OUTPUT_SCHEMA }),
};

function clamp(n, lo, hi) {
	return Math.max(lo, Math.min(hi, Math.round(n)));
}

export default paidEndpoint({
	route: ROUTE,
	method: 'GET',
	priceAtomics: priceFor('transit-delays', '1000'), // $0.001 USDC
	networks: ['solana', 'base'],
	description: DESCRIPTION,
	bazaar: BAZAAR,
	service: withService({ serviceName: listing.serviceName, tags: listing.tags }),
	accessControl: installAccessControl({ requiredScope: 'x402:bypass' }),
	async handler({ req }) {
		const params = new URL(req.url, 'http://x').searchParams;
		const stopRaw = String(params.get('stop') || '').trim();
		if (!stopRaw) {
			const err = new Error('query param "stop" is required');
			err.status = 400;
			err.code = 'missing_stop';
			throw err;
		}
		const routeId = params.get('route') || null;
		const limitRaw = Number(params.get('limit') || '20');
		const limit = clamp(Number.isFinite(limitRaw) ? limitRaw : 20, 1, 100);

		try {
			const stop = await resolvePlace(stopRaw, 'stop');
			return await delaySnapshot(stop, routeId, limit);
		} catch (err) {
			if (err instanceof BadRequestError) {
				const e = new Error(err.message);
				e.status = 400;
				e.code = 'bad_request';
				throw e;
			}
			if (err instanceof NotFoundError) {
				const e = new Error(err.message);
				e.status = 404;
				e.code = 'not_found';
				throw e;
			}
			if (err instanceof UpstreamError) {
				const e = new Error(err.message);
				e.status = 502;
				e.code = 'upstream_error';
				throw e;
			}
			throw err;
		}
	},
});

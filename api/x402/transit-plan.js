// GET /api/x402/transit-plan?from=South+Station&to=Alewife&max=3
//
// Transit Trip Plan: $0.002 USDC per call (free daily per-IP quota runs
// first). Live MBTA GTFS schedule plus GTFS-Realtime predictions. No key.

import { cors, method, error, json, wrap } from '../_lib/http.js';
import { clientIp, limits } from '../_lib/rate-limit.js';
import { paidEndpoint } from '../_lib/x402-paid-endpoint.js';
import { buildBazaarSchema } from '../_lib/x402-spec.js';
import { installAccessControl } from '../_lib/x402/access-control.js';
import { withService } from '../_lib/x402/bazaar-helpers.js';
import { priceFor } from '../_lib/x402-prices.js';
import { resolvePlace, planTrip, parseWhen, BadRequestError, NotFoundError, UpstreamError } from '../_lib/x402-services/transit.js';
import listing from '../_lib/service-catalog/services/transit-plan.js';

const ROUTE = '/api/x402/transit-plan';
const DESCRIPTION = listing.description;

export const INPUT_SCHEMA = { $schema: 'https://json-schema.org/draft/2020-12/schema', ...listing.inputSchema };
export const OUTPUT_SCHEMA = {
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	type: 'object',
	required: ['source', 'agency', 'itineraries'],
	properties: {
		source: { type: 'string' },
		agency: { type: 'string' },
		feed: { type: 'string' },
		itineraries: { type: 'array' },
		note: { type: 'string' },
		tier: { type: 'string', enum: ['free', 'paid'] },
		free_remaining_today: { type: 'integer' },
	},
};

export const BAZAAR = {
	description: DESCRIPTION,
	useCases: ['trip planning', 'mobility agents', 'commute automation'],
	input: { type: 'query', example: listing.input, schema: INPUT_SCHEMA },
	output: { type: 'json', example: listing.outputExample },
	schema: buildBazaarSchema({ method: 'GET', queryParamsSchema: INPUT_SCHEMA, outputSchema: OUTPUT_SCHEMA }),
};

function clamp(n, lo, hi) {
	return Math.max(lo, Math.min(hi, Math.round(n)));
}

async function resolveAndPlan(req) {
	const params = new URL(req.url, 'http://x').searchParams;
	const fromRaw = String(params.get('from') || '').trim();
	const toRaw = String(params.get('to') || '').trim();
	if (!fromRaw || !toRaw) {
		const err = new Error('"from" and "to" are required. Each accepts a stop id, a station name, or "lat,lon".');
		err.status = 400;
		err.code = 'missing_place';
		throw err;
	}
	const maxRaw = Number(params.get('max') || '3');
	const max = clamp(Number.isFinite(maxRaw) ? maxRaw : 3, 1, 10);
	const departAfter = parseWhen(params.get('departAfter') || undefined);

	const [from, to] = await Promise.all([resolvePlace(fromRaw, 'from'), resolvePlace(toRaw, 'to')]);
	return planTrip(from, to, departAfter, max);
}

function toHttpError(err) {
	if (err instanceof BadRequestError) return { status: 400, code: 'bad_request', message: err.message };
	if (err instanceof NotFoundError) return { status: 404, code: 'not_found', message: err.message };
	if (err instanceof UpstreamError) return { status: 502, code: 'upstream_error', message: err.message };
	return { status: err.status || 500, code: err.code || 'internal_error', message: err.message };
}

let _paid = null;
function paidHandler() {
	if (_paid) return _paid;
	_paid = paidEndpoint({
		route: ROUTE,
		method: 'GET',
		priceAtomics: priceFor('transit-plan', '2000'), // $0.002 USDC
		networks: ['solana', 'base'],
		description: DESCRIPTION,
		bazaar: BAZAAR,
		service: withService({ serviceName: listing.serviceName, tags: listing.tags }),
		accessControl: installAccessControl({ requiredScope: 'x402:bypass' }),
		async handler({ req }) {
			try {
				const data = await resolveAndPlan(req);
				return { ...data, tier: 'paid' };
			} catch (err) {
				const { status, code, message } = toHttpError(err);
				const e = new Error(message);
				e.status = status;
				e.code = code;
				throw e;
			}
		},
	});
	return _paid;
}

export default wrap(async function handler(req, res) {
	if (cors(req, res, { methods: 'GET,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET'])) return;

	const paymentPresent = Boolean(req.headers['x-payment'] || req.headers['payment-signature']);
	if (paymentPresent) return paidHandler()(req, res);

	const rl = await limits.transitFreeIp(clientIp(req));
	if (!rl.success) return paidHandler()(req, res);

	try {
		const data = await resolveAndPlan(req);
		return json(res, 200, { ...data, tier: 'free', free_remaining_today: Math.max(0, rl.remaining) }, { 'cache-control': 'no-store' });
	} catch (err) {
		const { status, code, message } = toHttpError(err);
		return error(res, status, code, message);
	}
});

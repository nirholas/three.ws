import { sql } from '../_lib/db.js';
import { getSessionUser, authenticateBearer, extractBearer } from '../_lib/auth.js';
import { cors, json, error, wrap } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';

const PUBLIC_CACHE = 'public, max-age=30, s-maxage=60';

const VALID_STATUSES = new Set(['active', 'revoked', 'expired', 'all']);

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,OPTIONS', credentials: true })) return;

	if (req.method !== 'GET') {
		res.setHeader('allow', 'GET, OPTIONS');
		return error(res, 405, 'method_not_allowed', 'method not allowed');
	}

	const rl = await limits.read(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const url = new URL(req.url, 'http://x');
	const agentId = url.searchParams.get('agentId') || null;
	const delegator = url.searchParams.get('delegator') || null;

	if (!agentId && !delegator) {
		return error(res, 400, 'missing_filter', 'agentId or delegator query param is required');
	}

	const statusParam = url.searchParams.get('status') || 'active';
	if (!VALID_STATUSES.has(statusParam)) {
		return error(
			res,
			400,
			'validation_error',
			'status must be active, revoked, expired, or all',
		);
	}

	const chainIdParam = url.searchParams.get('chainId');
	const chainId = chainIdParam ? parseInt(chainIdParam, 10) : null;
	if (chainIdParam && (Number.isNaN(chainId) || chainId <= 0)) {
		return error(res, 400, 'validation_error', 'chainId must be a positive integer');
	}

	const limitParam = Math.min(
		200,
		Math.max(1, parseInt(url.searchParams.get('limit') || '50', 10)),
	);
	const offset = Math.max(0, parseInt(url.searchParams.get('offset') || '0', 10));

	// agentId-only path: public, no auth required
	if (agentId && !delegator) {
		const rows = await sql`
			SELECT
				id, chain_id, delegator_address, delegate_address, delegation_hash,
				scope, status, expires_at, created_at, last_redeemed_at, redemption_count
			FROM agent_delegations
			WHERE agent_id = ${agentId}
			  AND (${statusParam} = 'all' OR status = ${statusParam})
			  AND (${chainId}::integer IS NULL OR chain_id = ${chainId}::integer)
			ORDER BY created_at DESC
			LIMIT ${limitParam} OFFSET ${offset}
		`;

		const delegations = rows.map(toPublicShape);
		const body = { ok: true, delegations };
		if (rows.length === limitParam) body.nextOffset = offset + limitParam;

		return json(res, 200, body, { 'cache-control': PUBLIC_CACHE });
	}

	// delegator path (or both provided): session required
	const session = await getSessionUser(req, res);
	const bearer = session ? null : await authenticateBearer(extractBearer(req));
	if (!session && !bearer) {
		return error(res, 401, 'unauthorized', 'sign in required to list delegations by delegator');
	}
	const userId = session?.id ?? bearer?.userId;

	// Verify the session user owns this delegator address
	const targetDelegator = delegator || null;
	if (targetDelegator) {
		const [wallet] = await sql`
			SELECT 1 FROM user_wallets
			WHERE user_id = ${userId}
			  AND lower(address) = lower(${targetDelegator})
			LIMIT 1
		`;
		if (!wallet) {
			return error(
				res,
				403,
				'forbidden',
				'delegator address does not belong to your account',
			);
		}
	}

	const whereAgentId = agentId;
	const rows = await sql`
		SELECT
			id, chain_id, delegator_address, delegate_address, delegation_hash,
			delegation_json, scope, status, expires_at, created_at, last_redeemed_at, redemption_count
		FROM agent_delegations
		WHERE (${whereAgentId}::uuid IS NULL OR agent_id = ${whereAgentId}::uuid)
		  AND (${targetDelegator}::text IS NULL OR lower(delegator_address) = lower(${targetDelegator}::text))
		  AND (${statusParam} = 'all' OR status = ${statusParam})
		  AND (${chainId}::integer IS NULL OR chain_id = ${chainId}::integer)
		ORDER BY created_at DESC
		LIMIT ${limitParam} OFFSET ${offset}
	`;

	const delegations = rows.map(toAuthShape);
	const body = { ok: true, delegations };
	if (rows.length === limitParam) body.nextOffset = offset + limitParam;

	return json(res, 200, body);
});

function toPublicShape(row) {
	return {
		id: row.id,
		chainId: row.chain_id,
		delegator: row.delegator_address,
		delegate: row.delegate_address,
		delegationHash: row.delegation_hash,
		scope: row.scope,
		status: row.status,
		expiresAt: row.expires_at,
		createdAt: row.created_at,
		lastRedeemedAt: row.last_redeemed_at,
		redemptionCount: row.redemption_count,
	};
}

function toAuthShape(row) {
	return {
		...toPublicShape(row),
		delegationJson: row.delegation_json,
	};
}

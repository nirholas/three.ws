import { createHash } from 'node:crypto';
import { sql } from '../_lib/db.js';
import { json, error, wrap } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';

// Populated by task 03 (src/erc7710/abi.js). Until that ships, unknown chains get null.
let DELEGATION_MANAGER_DEPLOYMENTS = {};
try {
	const mod = await import('../../src/erc7710/abi.js');
	DELEGATION_MANAGER_DEPLOYMENTS = mod.DELEGATION_MANAGER_DEPLOYMENTS ?? {};
} catch {
	// abi.js not yet present — delegationManager will be null
}

function corsHeaders(res) {
	res.setHeader('access-control-allow-origin', '*');
	res.setHeader('access-control-allow-methods', 'GET, OPTIONS');
	res.setHeader('access-control-allow-headers', 'content-type');
	res.setHeader('access-control-max-age', '86400');
}

export default wrap(async (req, res) => {
	if (req.method === 'OPTIONS') {
		corsHeaders(res);
		res.statusCode = 204;
		res.end();
		return;
	}

	corsHeaders(res);

	if (req.method !== 'GET') {
		res.setHeader('allow', 'GET, OPTIONS');
		return error(res, 405, 'method_not_allowed', 'method not allowed');
	}

	const rl = await limits.read(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const url = new URL(req.url, 'http://x');
	const agentId = url.searchParams.get('agentId');
	if (!agentId) return error(res, 400, 'missing_param', 'agentId is required');

	const chainIdParam = url.searchParams.get('chainId');
	const chainId = chainIdParam ? parseInt(chainIdParam, 10) : null;
	if (chainIdParam && (Number.isNaN(chainId) || chainId <= 0)) {
		return error(res, 400, 'validation_error', 'chainId must be a positive integer');
	}

	// Verify agent exists
	const [agent] = await sql`
		SELECT id FROM agent_identities
		WHERE id = ${agentId} AND deleted_at IS NULL
		LIMIT 1
	`;
	if (!agent) {
		return json(res, 404, { ok: false, error: 'agent_not_found' });
	}

	const rows = await sql`
		SELECT
			chain_id, delegator_address, delegate_address, delegation_hash,
			delegation_json, scope, expires_at, created_at, revoked_at
		FROM agent_delegations
		WHERE agent_id = ${agentId}
		  AND status = 'active'
		  AND (${chainId}::integer IS NULL OR chain_id = ${chainId}::integer)
		ORDER BY expires_at DESC
	`;

	const delegations = rows.map((r) => ({
		chainId: r.chain_id,
		delegator: r.delegator_address,
		delegate: r.delegate_address,
		hash: r.delegation_hash,
		scope: r.scope,
		expiresAt: r.expires_at,
		createdAt: r.created_at,
		envelope: r.delegation_json,
	}));

	// delegationManager: use the filtered chain if provided, otherwise first delegation's chain
	const resolveChain = chainId ?? rows[0]?.chain_id ?? null;
	const delegationManager = resolveChain
		? (DELEGATION_MANAGER_DEPLOYMENTS[resolveChain] ?? null)
		: null;

	// Last-Modified: max of created_at and revoked_at across returned rows
	let lastModified = null;
	for (const r of rows) {
		const candidates = [r.created_at, r.revoked_at].filter(Boolean);
		for (const d of candidates) {
			if (!lastModified || d > lastModified) lastModified = d;
		}
	}

	const body = {
		ok: true,
		agentId,
		spec: 'erc-7715/0.1',
		delegationManager,
		delegations,
	};

	const bodyStr = JSON.stringify(body);
	const etag = `"${createHash('sha256').update(bodyStr).digest('hex').slice(0, 32)}"`;

	res.setHeader('cache-control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600');
	res.setHeader('etag', etag);
	if (lastModified) res.setHeader('last-modified', new Date(lastModified).toUTCString());

	// ETag short-circuit
	if (req.headers['if-none-match'] === etag) {
		res.statusCode = 304;
		res.end();
		return;
	}

	res.statusCode = 200;
	res.setHeader('content-type', 'application/json; charset=utf-8');
	res.end(bodyStr);
});

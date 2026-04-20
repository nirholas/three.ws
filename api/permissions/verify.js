import { createHash } from 'node:crypto';
import { Contract, JsonRpcProvider } from 'ethers';
import { sql } from '../_lib/db.js';
import { error, wrap } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { DELEGATION_MANAGER_DEPLOYMENTS, DELEGATION_MANAGER_ABI } from '../../src/erc7710/abi.js';

const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const CACHE_VALID = 'public, max-age=30, s-maxage=60';
const CACHE_INVALID = 'public, max-age=300, s-maxage=600';

export default wrap(async (req, res) => {
	res.setHeader('access-control-allow-origin', '*');
	res.setHeader('access-control-allow-methods', 'GET, OPTIONS');
	res.setHeader('access-control-allow-headers', 'content-type');
	res.setHeader('access-control-max-age', '86400');
	if (req.method === 'OPTIONS') {
		res.statusCode = 204;
		res.end();
		return;
	}

	if (req.method !== 'GET') {
		res.setHeader('allow', 'GET, OPTIONS');
		return error(res, 405, 'method_not_allowed', 'method not allowed');
	}

	const rl = await limits.read(clientIp(req));
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const url = new URL(req.url, 'http://x');
	const hash = url.searchParams.get('hash');
	const chainIdRaw = url.searchParams.get('chainId');

	if (!hash) return error(res, 400, 'validation_error', 'hash query param is required');
	if (!HASH_RE.test(hash))
		return error(res, 400, 'validation_error', 'hash must be 0x + 64 hex chars');
	if (!chainIdRaw) return error(res, 400, 'validation_error', 'chainId query param is required');

	const chainId = parseInt(chainIdRaw, 10);
	if (Number.isNaN(chainId) || chainId <= 0)
		return error(res, 400, 'validation_error', 'chainId must be a positive integer');
	if (!DELEGATION_MANAGER_DEPLOYMENTS[chainId])
		return error(res, 400, 'validation_error', `chainId ${chainId} is not supported`);

	const checkedAt = new Date().toISOString();

	const [row] = await sql`
		SELECT status, expires_at
		FROM agent_delegations
		WHERE delegation_hash = ${hash} AND chain_id = ${chainId}
		LIMIT 1
	`;

	if (row?.status === 'revoked') {
		return respond(
			res,
			{ ok: true, valid: false, reason: 'delegation_revoked', checkedAt, chainId, hash },
			CACHE_INVALID,
		);
	}

	if (row?.status === 'expired' || (row?.expires_at && new Date(row.expires_at) <= new Date())) {
		return respond(
			res,
			{ ok: true, valid: false, reason: 'delegation_expired', checkedAt, chainId, hash },
			CACHE_INVALID,
		);
	}

	// On-chain check — 5 s timeout
	let disabled;
	try {
		disabled = await withTimeout(checkDisabled(hash, chainId), 5000);
	} catch (err) {
		console.error('[verify] rpc error', err);
		res.statusCode = 502;
		res.setHeader('content-type', 'application/json; charset=utf-8');
		res.setHeader('cache-control', 'no-store');
		res.end(JSON.stringify({ ok: false, error: 'rpc_error', message: err.message }));
		return;
	}

	if (disabled) {
		// Self-heal: if DB still tracks it as active, flip to revoked without blocking the response.
		if (row?.status === 'active') {
			console.log(`[verify] self-heal queued for ${hash}`);
			queueMicrotask(() => {
				sql`
					UPDATE agent_delegations
					SET status = 'revoked', revoked_at = NOW()
					WHERE delegation_hash = ${hash} AND status = 'active'
				`.catch((e) => console.error('[verify] self-heal failed', e));
			});
		}
		return respond(
			res,
			{ ok: true, valid: false, reason: 'delegation_revoked', checkedAt, chainId, hash },
			CACHE_INVALID,
		);
	}

	const body = { ok: true, valid: true, checkedAt, chainId, hash };
	if (!row) body.reason = 'unknown_to_platform';
	return respond(res, body, CACHE_VALID);
});

async function checkDisabled(hash, chainId) {
	const rpcUrl = process.env[`RPC_URL_${chainId}`];
	if (!rpcUrl) throw new Error(`no RPC configured for chainId ${chainId}`);
	const provider = new JsonRpcProvider(rpcUrl);
	const manager = new Contract(
		DELEGATION_MANAGER_DEPLOYMENTS[chainId],
		DELEGATION_MANAGER_ABI,
		provider,
	);
	return manager.isDelegationDisabled(hash);
}

function withTimeout(promise, ms) {
	return Promise.race([
		promise,
		new Promise((_, reject) =>
			setTimeout(() => reject(new Error(`RPC timeout after ${ms}ms`)), ms),
		),
	]);
}

function respond(res, body, cacheControl) {
	const str = JSON.stringify(body);
	const etag = `"${createHash('sha256').update(str).digest('hex').slice(0, 16)}"`;
	res.statusCode = 200;
	res.setHeader('content-type', 'application/json; charset=utf-8');
	res.setHeader('cache-control', cacheControl);
	res.setHeader('etag', etag);
	res.end(str);
}

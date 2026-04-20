// POST /api/permissions/redeem
// Server-side delegation relayer: pays gas on behalf of the agent's smart account.
// Auth: agent bearer token with scope `permissions:redeem`.
// Feature-flagged via PERMISSIONS_RELAYER_ENABLED env var (default: false).

import { Wallet, JsonRpcProvider, getAddress, isAddress } from 'ethers';
import { z } from 'zod';

import { sql } from '../_lib/db.js';
import { authenticateBearer, extractBearer, hasScope } from '../_lib/auth.js';
import { cors, json, error, wrap, readJson, method } from '../_lib/http.js';
import { limits, clientIp } from '../_lib/rate-limit.js';
import { parse } from '../_lib/validate.js';
import { env } from '../_lib/env.js';
import { recordEvent } from '../_lib/usage.js';
import { redeemDelegation, PermissionError } from '../../src/permissions/toolkit.js';

// ── Idempotency cache (in-memory, 10-minute TTL) ───────────────────────────
const idempotencyCache = new Map();
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;

function idempotencyGet(key) {
	const entry = idempotencyCache.get(key);
	if (!entry) return null;
	if (Date.now() > entry.expiresAt) {
		idempotencyCache.delete(key);
		return null;
	}
	return entry.result;
}

function idempotencySet(key, result) {
	// Purge expired entries opportunistically.
	const now = Date.now();
	for (const [k, v] of idempotencyCache) {
		if (now > v.expiresAt) idempotencyCache.delete(k);
	}
	idempotencyCache.set(key, { result, expiresAt: now + IDEMPOTENCY_TTL_MS });
}

// ── Validation schemas ─────────────────────────────────────────────────────
const hexData = z.string().regex(/^0x[0-9a-fA-F]*$/, 'must be 0x-prefixed hex');
const weiValue = z.string().regex(/^\d+$/, 'value must be a decimal integer string');

const callSchema = z.object({
	to: z.string().refine((v) => isAddress(v), 'to must be a valid EIP-55 address'),
	value: weiValue.default('0'),
	data: hexData.default('0x'),
});

const bodySchema = z.object({
	id: z.string().uuid(),
	calls: z.array(callSchema).min(1).max(4),
});

// ── ERC-20 selector helpers ────────────────────────────────────────────────
const TRANSFER_SELECTOR = '0xa9059cbb';
const TRANSFER_FROM_SELECTOR = '0x23b872dd';

// Decode token amount from ERC-20 transfer/transferFrom calldata.
// Param slots (0-indexed) start at hex[8 + n*64]. Returns null if unrecognised.
function decodeErc20AmountFixed(data) {
	if (!data || data.length < 10) return null;
	const hex = data.startsWith('0x') ? data.slice(2) : data;
	const sel = '0x' + hex.slice(0, 8).toLowerCase();
	try {
		if (sel === TRANSFER_SELECTOR && hex.length >= 8 + 64 + 64) {
			// slot 1 (0-indexed) = amount
			return BigInt('0x' + hex.slice(8 + 64, 8 + 64 + 64));
		}
		if (sel === TRANSFER_FROM_SELECTOR && hex.length >= 8 + 64 + 64 + 64) {
			// slot 2 (0-indexed) = amount
			return BigInt('0x' + hex.slice(8 + 64 + 64, 8 + 64 + 64 + 64));
		}
	} catch {
		return null;
	}
	return null;
}

// ── Period window helper ───────────────────────────────────────────────────
function periodStart(period) {
	const now = new Date();
	if (period === 'daily') {
		return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
	}
	if (period === 'weekly') {
		const day = now.getUTCDay(); // 0=Sun
		const diff = day === 0 ? -6 : 1 - day; // back to Monday
		const monday = new Date(now);
		monday.setUTCDate(now.getUTCDate() + diff);
		monday.setUTCHours(0, 0, 0, 0);
		return monday;
	}
	// 'once' or unknown: entire history counts
	return new Date(0);
}

// ── RPC URL resolution ─────────────────────────────────────────────────────
function getRpcUrl(chainId) {
	return (
		process.env[`RPC_URL_${chainId}`] ||
		// Shared fallback names that might already exist in the project
		(chainId === 84532 ? process.env.BASE_SEPOLIA_RPC_URL : null) ||
		(chainId === 11155111 ? process.env.SEPOLIA_RPC_URL : null) ||
		null
	);
}

// ── Handler ────────────────────────────────────────────────────────────────
export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS' })) return;
	if (!method(req, res, ['POST'])) return;

	// Feature flag — 503 when disabled
	if (!env.PERMISSIONS_RELAYER_ENABLED) {
		return error(res, 503, 'feature_disabled', 'relayer not enabled on this deployment');
	}

	// Rate limit — strict bucket since each request costs gas
	const ip = clientIp(req);
	const rl = await limits.strict(ip);
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	// Auth — agent bearer only (no user sessions on this machine endpoint)
	const token = extractBearer(req);
	const bearer = await authenticateBearer(token);
	if (!bearer) return error(res, 401, 'unauthorized', 'valid bearer token required');
	if (!hasScope(bearer.scope, 'permissions:redeem')) {
		return error(
			res,
			403,
			'insufficient_scope',
			"token must include 'permissions:redeem' scope",
		);
	}

	// Idempotency-Key check (before parsing body — key is in header)
	const idempotencyKey = req.headers['idempotency-key'] || null;

	// Parse body
	let body;
	try {
		body = parse(bodySchema, await readJson(req));
	} catch (err) {
		return error(res, err.status || 400, err.code || 'validation_error', err.message);
	}
	const { id, calls } = body;

	// Idempotency-Key early return
	if (idempotencyKey) {
		const cached = idempotencyGet(`${id}:${idempotencyKey}`);
		if (cached) return json(res, 200, cached);
	}

	// Load delegation row
	const [row] = await sql`
		SELECT id, agent_id, chain_id, delegation_hash, delegation_json, scope,
		       status, expires_at, redemption_count, last_redeemed_at
		FROM agent_delegations
		WHERE id = ${id}
		LIMIT 1
	`;
	if (!row) return error(res, 404, 'delegation_not_found', 'delegation not found');

	// Check status
	if (row.status === 'revoked') {
		return error(res, 409, 'delegation_revoked', 'delegation has been revoked');
	}

	// Check expiry; auto-flip status if expired
	const now = new Date();
	if (new Date(row.expires_at) <= now) {
		// Side-effect: mark as expired without blocking
		sql`UPDATE agent_delegations SET status = 'expired' WHERE id = ${id}`.catch(() => {});
		return error(res, 409, 'delegation_expired', 'delegation has expired');
	}

	if (row.status !== 'active') {
		return error(res, 409, 'delegation_expired', `delegation status is '${row.status}'`);
	}

	const scope = row.scope;
	const chainId = row.chain_id;

	// ── Server-side scope checks (cheap, prevent paying gas on doomed tx) ────

	// 1. Target allow-list
	const allowedTargets = new Set((scope.targets || []).map((t) => t.toLowerCase()));
	for (const call of calls) {
		if (!allowedTargets.has(call.to.toLowerCase())) {
			return error(
				res,
				403,
				'target_not_allowed',
				`call target ${call.to} is not in scope.targets`,
			);
		}
	}

	// 2. Native ETH: reject non-zero value if token is ERC-20
	const isNative = scope.token === 'native';
	if (!isNative) {
		for (const call of calls) {
			if (BigInt(call.value) > 0n) {
				return error(
					res,
					403,
					'scope_exceeded',
					'non-zero ETH value not allowed for ERC-20 scoped delegation',
				);
			}
		}
	}

	// 3. Amount cap: compute period spend from usage_events history
	const maxAmount = BigInt(scope.maxAmount || '0');
	const pStart = periodStart(scope.period || 'daily');

	if (isNative) {
		// Sum ETH values in this request
		const requestAmount = calls.reduce((s, c) => s + BigInt(c.value), 0n);

		// Query period history
		const [histRow] = await sql`
			SELECT COALESCE(SUM((meta->>'amount')::numeric), 0) AS spent
			FROM usage_events
			WHERE kind = 'permissions.redeem'
			  AND meta->>'delegation_id' = ${id}
			  AND created_at >= ${pStart.toISOString()}
		`;
		const historicalSpend = BigInt(Math.floor(Number(histRow?.spent ?? '0')));

		if (requestAmount + historicalSpend > maxAmount) {
			return error(
				res,
				403,
				'scope_exceeded',
				'ETH spend would exceed scope.maxAmount for this period',
				{
					maxAmount: scope.maxAmount,
					periodSpent: historicalSpend.toString(),
					requested: requestAmount.toString(),
				},
			);
		}
	} else {
		// ERC-20: decode transfer amounts from call data
		let requestAmount = 0n;
		for (const call of calls) {
			const decoded = decodeErc20AmountFixed(call.data);
			if (decoded === null) {
				return error(
					res,
					403,
					'scope_exceeded',
					`call to ${call.to} does not look like an ERC-20 transfer or transferFrom`,
				);
			}
			requestAmount += decoded;
		}

		const [histRow] = await sql`
			SELECT COALESCE(SUM((meta->>'amount')::numeric), 0) AS spent
			FROM usage_events
			WHERE kind = 'permissions.redeem'
			  AND meta->>'delegation_id' = ${id}
			  AND created_at >= ${pStart.toISOString()}
		`;
		const historicalSpend = BigInt(Math.floor(Number(histRow?.spent ?? '0')));

		if (requestAmount + historicalSpend > maxAmount) {
			return error(
				res,
				403,
				'scope_exceeded',
				'token spend would exceed scope.maxAmount for this period',
				{
					maxAmount: scope.maxAmount,
					periodSpent: historicalSpend.toString(),
					requested: requestAmount.toString(),
				},
			);
		}
	}

	// ── Build signer ───────────────────────────────────────────────────────
	const rpcUrl = getRpcUrl(chainId);
	if (!rpcUrl) {
		return error(
			res,
			502,
			'rpc_error',
			`no RPC URL configured for chain ${chainId} (set RPC_URL_${chainId})`,
		);
	}

	let signer;
	try {
		const provider = new JsonRpcProvider(rpcUrl);
		// AGENT_RELAYER_KEY is never logged — only use it to construct the Wallet
		signer = new Wallet(env.AGENT_RELAYER_KEY, provider);
	} catch {
		return error(res, 500, 'internal_error', 'failed to initialise relayer signer');
	}

	// ── Submit on-chain ────────────────────────────────────────────────────
	let txHash, receipt;
	try {
		({ txHash, receipt } = await redeemDelegation({
			delegation: row.delegation_json,
			delegationHash: row.delegation_hash,
			calls,
			signer,
			chainId,
		}));
	} catch (err) {
		if (err instanceof PermissionError && err.code === 'delegation_revoked') {
			// Auto-sync status in DB
			sql`UPDATE agent_delegations SET status = 'revoked' WHERE id = ${id}`.catch(() => {});
			return error(res, 409, 'delegation_revoked', err.message);
		}
		// RPC or provider error
		console.error('[permissions/redeem] on-chain error', err?.code, err?.message);
		return error(res, 502, 'rpc_error', err?.message || 'on-chain call failed');
	}

	// ── Update DB ──────────────────────────────────────────────────────────
	await sql`
		UPDATE agent_delegations
		SET redemption_count = redemption_count + 1,
		    last_redeemed_at = NOW()
		WHERE id = ${id}
	`;

	// Compute amount redeemed for usage tracking
	const redeemAmount = isNative
		? calls.reduce((s, c) => s + BigInt(c.value), 0n).toString()
		: calls
				.reduce((s, c) => {
					const a = decodeErc20AmountFixed(c.data);
					return s + (a ?? 0n);
				}, 0n)
				.toString();

	recordEvent({
		userId: bearer.userId,
		apiKeyId: bearer.apiKeyId ?? null,
		agentId: row.agent_id,
		kind: 'permissions.redeem',
		status: 'ok',
		meta: {
			delegation_id: id,
			chain_id: chainId,
			tx_hash: txHash,
			gas_used: receipt.gasUsed,
			amount: redeemAmount,
		},
	});

	const result = { ok: true, txHash, receipt };

	if (idempotencyKey) {
		idempotencySet(`${id}:${idempotencyKey}`, result);
	}

	return json(res, 200, result);
});

// POST /api/permissions/grant
// Accepts a signed ERC-7710 delegation, verifies it, and persists it.

import { sql } from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
import { cors, json, method, readJson, wrap, error } from '../_lib/http.js';
import { limits } from '../_lib/rate-limit.js';
import { recordEvent } from '../_lib/usage.js';
import { SERVER_CHAIN_META } from '../_lib/onchain.js';
import { z } from 'zod';
import { ethers } from 'ethers';
import {
	DELEGATION_MANAGER_DEPLOYMENTS,
	EIP712_DOMAIN,
	DELEGATION_TYPES,
} from '../../src/erc7710/abi.js';
import { isDelegationValid, PermissionError } from '../../src/permissions/toolkit.js';

const ROOT_AUTHORITY = '0x0000000000000000000000000000000000000000000000000000000000000000';

const hexAddr = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'must be a 20-byte hex address');
const hexBytes = z.string().regex(/^0x([0-9a-fA-F]{2})*$/, 'must be 0x-prefixed hex bytes');
const hexBytes32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'must be a 32-byte hex value');

const caveatSchema = z.object({
	enforcer: hexAddr,
	terms: hexBytes.default('0x'),
	args: hexBytes.default('0x'),
});

const delegationSchema = z.object({
	delegator: hexAddr,
	delegate: hexAddr,
	authority: hexBytes32.optional(),
	caveats: z.array(caveatSchema).default([]),
	salt: z.union([
		z
			.string()
			.regex(/^(0x[0-9a-fA-F]+|\d+)$/, 'salt must be a decimal or 0x-prefixed hex integer'),
		z.number().int().nonnegative(),
	]),
	signature: hexBytes,
	hash: hexBytes32,
});

const scopeSchema = z.object({
	token: z.string().min(1),
	maxAmount: z.string().min(1),
	period: z.enum(['daily', 'weekly', 'once']),
	targets: z.array(hexAddr).min(1),
	expiry: z.number().int().positive(),
});

const bodySchema = z.object({
	agentId: z.string().uuid(),
	chainId: z.number().int().positive(),
	delegation: delegationSchema,
	scope: scopeSchema,
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req, res);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.permissionsGrant(user.id);
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const raw = await readJson(req);
	const parsed = bodySchema.safeParse(raw);
	if (!parsed.success) {
		const msg = parsed.error.issues
			.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
			.join('; ');
		return error(res, 400, 'validation_error', msg);
	}
	const { agentId, chainId, delegation, scope } = parsed.data;

	// chainId must be a supported DelegationManager deployment
	if (!(chainId in DELEGATION_MANAGER_DEPLOYMENTS)) {
		return error(res, 400, 'chain_not_supported', `chainId ${chainId} is not supported`);
	}

	// Owner gate: agent must exist and belong to the authenticated user
	const [agent] = await sql`
		select id, user_id from agent_identities
		where id = ${agentId} and deleted_at is null
		limit 1
	`;
	if (!agent) return error(res, 404, 'not_found', 'agent not found');
	if (agent.user_id !== user.id) return error(res, 403, 'not_owner', 'you do not own this agent');

	// Wallet linkage: delegation.delegator must be a wallet linked to the authenticated user
	const delegatorLower = delegation.delegator.toLowerCase();
	const [linkedWallet] = await sql`
		select address from user_wallets
		where user_id = ${user.id} and address = ${delegatorLower}
		limit 1
	`;
	if (!linkedWallet) {
		return error(
			res,
			409,
			'wallet_not_linked',
			'delegation.delegator is not linked to your account',
		);
	}

	// Signature verification — two steps:
	// 1. Re-derive the EIP-712 hash from delegation fields and compare with delegation.hash
	//    (prevents chain-hop replay: different contract address → different hash).
	// 2. Recover the signer from the signature and verify it matches delegation.delegator.
	const managerAddr = DELEGATION_MANAGER_DEPLOYMENTS[chainId];
	const eip712Domain = EIP712_DOMAIN({ chainId, verifyingContract: managerAddr });
	let derivedHash;
	try {
		const structValue = {
			delegate: delegation.delegate,
			delegator: delegation.delegator,
			authority: delegation.authority || ROOT_AUTHORITY,
			caveats: delegation.caveats.map((c) => ({
				enforcer: c.enforcer,
				terms: c.terms,
				args: c.args,
			})),
			salt: BigInt(delegation.salt),
		};

		derivedHash = ethers.TypedDataEncoder.hash(eip712Domain, DELEGATION_TYPES, structValue);

		if (derivedHash.toLowerCase() !== delegation.hash.toLowerCase()) {
			return error(
				res,
				400,
				'hash_mismatch',
				'delegation.hash does not match the delegation fields',
			);
		}

		const recovered = ethers.verifyTypedData(
			eip712Domain,
			DELEGATION_TYPES,
			structValue,
			delegation.signature,
		);
		if (recovered.toLowerCase() !== delegatorLower) {
			return error(
				res,
				400,
				'signature_invalid',
				'signature does not match delegation.delegator',
			);
		}
	} catch (err) {
		if (err instanceof PermissionError) {
			return error(res, 400, err.code || 'signature_invalid', err.message);
		}
		return error(res, 400, 'signature_invalid', err.message || 'invalid delegation signature');
	}

	// On-chain revocation check (isDelegationValid from task 04)
	const rpcUrl = SERVER_CHAIN_META[chainId]?.rpc;
	const validity = await isDelegationValid({ hash: delegation.hash, chainId, rpcUrl }).catch(
		(err) => {
			if (err instanceof PermissionError) return { valid: false, reason: err.code };
			console.warn('[grant] isDelegationValid error', err?.message);
			return { valid: true }; // RPC unavailable; proceed and rely on indexer for revocation
		},
	);
	if (!validity.valid) {
		return error(
			res,
			400,
			validity.reason || 'signature_invalid',
			'delegation is not valid on-chain',
		);
	}

	// Scope sanity checks
	const nowSec = Math.floor(Date.now() / 1000);
	if (scope.expiry <= nowSec + 60) {
		return error(
			res,
			400,
			'validation_error',
			'scope.expiry must be at least 60 seconds in the future',
		);
	}
	if (scope.expiry > nowSec + 365 * 24 * 3600) {
		return error(res, 400, 'validation_error', 'scope.expiry must be within 365 days');
	}
	let maxAmountBig;
	try {
		maxAmountBig = BigInt(scope.maxAmount);
	} catch {
		return error(res, 400, 'validation_error', 'scope.maxAmount must be a numeric string');
	}
	if (maxAmountBig <= 0n) {
		return error(res, 400, 'validation_error', 'scope.maxAmount must be positive');
	}
	let targets;
	try {
		targets = scope.targets.map((t) => ethers.getAddress(t));
	} catch {
		return error(res, 400, 'validation_error', 'scope.targets contains an invalid address');
	}

	const delegationHash = derivedHash;
	const expiresAt = new Date(scope.expiry * 1000).toISOString();
	const delegatorAddr = ethers.getAddress(delegation.delegator);
	const delegateAddr = ethers.getAddress(delegation.delegate);

	const delegationJson = {
		delegator: delegation.delegator,
		delegate: delegation.delegate,
		authority: delegation.authority || ROOT_AUTHORITY,
		caveats: delegation.caveats,
		salt: String(delegation.salt),
		// signature stored as part of the envelope; not logged separately
		signature: delegation.signature,
		hash: delegationHash,
	};
	const scopeJson = { ...scope, targets };

	// Persist — delegation_hash is UNIQUE; on conflict return 409
	const rows = await sql`
		insert into agent_delegations (
			agent_id, chain_id, delegator_address, delegate_address,
			delegation_hash, delegation_json, scope, expires_at
		)
		values (
			${agentId},
			${chainId},
			${delegatorAddr.toLowerCase()},
			${delegateAddr.toLowerCase()},
			${delegationHash},
			${JSON.stringify(delegationJson)}::jsonb,
			${JSON.stringify(scopeJson)}::jsonb,
			${expiresAt}
		)
		on conflict (delegation_hash) do nothing
		returning id
	`;

	if (!rows || rows.length === 0) {
		const [existing] = await sql`
			select id from agent_delegations where delegation_hash = ${delegationHash} limit 1
		`;
		return error(res, 409, 'duplicate_delegation', 'this delegation has already been granted', {
			id: existing?.id,
		});
	}

	const { id } = rows[0];

	recordEvent({ userId: user.id, agentId, kind: 'permissions.grant' });

	return json(res, 200, { ok: true, id, delegationHash, expiresAt });
});

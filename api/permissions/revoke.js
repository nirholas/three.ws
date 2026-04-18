// POST /api/permissions/revoke
// Mirrors an on-chain DelegationManager.disableDelegation() call into the DB.

import { sql } from '../_lib/db.js';
import { getSessionUser } from '../_lib/auth.js';
import { cors, method, readJson, wrap, error, json } from '../_lib/http.js';
import { limits } from '../_lib/rate-limit.js';
import { recordEvent } from '../_lib/usage.js';
import { SERVER_CHAIN_META } from '../_lib/onchain.js';
import {
	DELEGATION_MANAGER_ABI,
	DELEGATION_MANAGER_DEPLOYMENTS,
} from '../../src/erc7710/abi.js';
import { z } from 'zod';
import { JsonRpcProvider, Contract, Interface } from 'ethers';

const bodySchema = z.object({
	id: z.string().uuid(),
	txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'must be a 66-char 0x-prefixed hex string'),
});

const iface = new Interface(DELEGATION_MANAGER_ABI);
const DISABLED_TOPIC = iface.getEvent('DelegationDisabled').topicHash;

const RPC_TIMEOUT_MS = 5000;

function withTimeout(promise, ms) {
	return new Promise((resolve, reject) => {
		const t = setTimeout(() => reject(new Error(`rpc timeout after ${ms}ms`)), ms);
		Promise.resolve(promise).then(
			(v) => { clearTimeout(t); resolve(v); },
			(e) => { clearTimeout(t); reject(e); },
		);
	});
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const user = await getSessionUser(req, res);
	if (!user) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.permissionsRevoke(user.id);
	if (!rl.success) return error(res, 429, 'rate_limited', 'too many requests');

	const raw = await readJson(req);
	const parsed = bodySchema.safeParse(raw);
	if (!parsed.success) {
		const msg = parsed.error.issues
			.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`)
			.join('; ');
		return error(res, 400, 'validation_error', msg);
	}
	const { id, txHash } = parsed.data;

	// Lookup delegation + agent owner in one join
	const [row] = await sql`
		SELECT d.*, a.user_id AS agent_owner_user_id
		FROM agent_delegations d
		JOIN agent_identities a ON a.id = d.agent_id AND a.deleted_at IS NULL
		WHERE d.id = ${id}
		LIMIT 1
	`;
	if (!row) return error(res, 404, 'delegation_not_found', 'delegation not found');

	// Authorization: agent owner OR the delegator wallet linked to this user
	const isAgentOwner = row.agent_owner_user_id === user.id;
	let isDelegator = false;
	if (!isAgentOwner) {
		const [wallet] = await sql`
			SELECT address FROM user_wallets
			WHERE user_id = ${user.id} AND address = ${row.delegator_address}
			LIMIT 1
		`;
		isDelegator = !!wallet;
	}
	if (!isAgentOwner && !isDelegator) {
		return error(res, 403, 'forbidden', 'you are not authorized to revoke this delegation');
	}

	// Build a read-only provider for the delegation's chain
	const chainMeta = SERVER_CHAIN_META[row.chain_id];
	if (!chainMeta) {
		return error(res, 400, 'chain_not_supported', `chainId ${row.chain_id} is not supported`);
	}
	const managerAddr = DELEGATION_MANAGER_DEPLOYMENTS[row.chain_id];
	if (!managerAddr) {
		return error(res, 400, 'chain_not_supported', `no DelegationManager for chainId ${row.chain_id}`);
	}

	const provider = new JsonRpcProvider(chainMeta.rpc, row.chain_id, { staticNetwork: true });

	// Fetch receipt (up to 3 attempts with short back-off for propagation lag)
	let receipt = null;
	for (let attempt = 0; attempt < 3 && !receipt; attempt++) {
		if (attempt > 0) await new Promise((r) => setTimeout(r, 800));
		receipt = await withTimeout(provider.getTransactionReceipt(txHash), RPC_TIMEOUT_MS).catch(() => null);
	}
	if (!receipt) return error(res, 400, 'tx_not_found', 'transaction receipt not found');

	if (receipt.status === 0) {
		return error(res, 400, 'tx_reverted', 'transaction was reverted on-chain');
	}

	// Decode DelegationDisabled event: (address indexed delegationManager, bytes32 indexed delegationHash)
	// topics[0] = event sig, topics[1] = delegationManager, topics[2] = delegationHash
	const disabledLog = receipt.logs.find((log) => log.topics[0] === DISABLED_TOPIC);
	if (!disabledLog) {
		return error(res, 400, 'tx_mismatch', 'transaction contains no DelegationDisabled event');
	}

	const loggedHash = disabledLog.topics[2]; // bytes32 indexed — raw topic IS the value
	if (loggedHash.toLowerCase() !== row.delegation_hash.toLowerCase()) {
		return error(res, 400, 'tx_mismatch', 'transaction revoked a different delegation hash');
	}

	// Second confirmation: call disabledDelegations(hash) on-chain
	const manager = new Contract(managerAddr, DELEGATION_MANAGER_ABI, provider);
	const isDisabled = await withTimeout(manager.disabledDelegations(row.delegation_hash), RPC_TIMEOUT_MS).catch(() => null);
	if (!isDisabled) {
		return error(res, 400, 'not_yet_disabled', 'delegation is not yet marked disabled on-chain');
	}

	// Flip status active → revoked; 0 rows = already revoked / never active
	const updated = await sql`
		UPDATE agent_delegations
		SET status = 'revoked', revoked_at = NOW(), tx_hash_revoke = ${txHash}
		WHERE id = ${id} AND status = 'active'
		RETURNING revoked_at
	`;
	if (!updated || updated.length === 0) {
		const [current] = await sql`SELECT status FROM agent_delegations WHERE id = ${id} LIMIT 1`;
		const currentStatus = current?.status ?? 'unknown';
		return error(res, 409, 'already_revoked', `delegation cannot be revoked (current status: ${currentStatus})`);
	}

	const revokedAt = updated[0].revoked_at;

	recordEvent({ userId: user.id, agentId: row.agent_id, kind: 'permissions.revoke' });

	return json(res, 200, { ok: true, status: 'revoked', revokedAt });
});
